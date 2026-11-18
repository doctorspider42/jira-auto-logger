//! Orchestrates suggestion generation. The user declares which configured
//! projects they worked on; every target (Jira project) of every selected
//! project gets its own isolated LLM pass with ONLY that target's issues,
//! commits and notes in the context. Port of `LlmService.ts`.

pub mod mock;
pub mod providers;

use crate::config::ConfigService;
use crate::domain::*;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::logger;
use crate::paths;
use crate::services::connections::ConnectionManager;
use crate::services::git::{CommitSource, WorkingChanges};
use crate::services::jira::JiraActivity;
use providers::{ClaudeCli, CopilotCli, LlmCompletion, LlmProvider, OpenAiApi};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::Arc;

const MAIN_PROMPT: &str = include_str!("main_prompt.txt");
const REGENERATE_PROMPT: &str = include_str!("regenerate_prompt.txt");

/// Appended to the prompt when the first answer was empty although the day
/// still had hours to fill.
const EMPTY_ANSWER_RETRY: &str = "Your previous answer was an empty array, but at least one date still has remaining budget and the developer confirmed they worked on this project. That is not allowed. Answer again following rule 2: return at least one entry for every date with remaining budget that has commits or notes - or, when no date has any, for every date with remaining budget.";

/// How many recent worklogs are sent to the LLM as style examples.
const EXAMPLE_WORKLOG_COUNT: usize = 10;

/// Cap on a standing instruction (a target's or a custom field's). Generous on
/// purpose: a rule that arrives half-cut is worse than none - an earlier
/// 300-char cap silently dropped the second half of a policy.
const INSTRUCTION_LIMIT: usize = 4000;

fn language_name(code: &str) -> &'static str {
    match code {
        "pl" => "Polish",
        _ => "English",
    }
}

/// Truncates free text going into the prompt; long tails add tokens, not signal.
fn clip(text: &str, max: usize) -> String {
    if text.chars().count() > max {
        format!("{}…", text.chars().take(max - 1).collect::<String>())
    } else {
        text.to_string()
    }
}

/// A number the way JavaScript prints it: 8, not 8.0.
fn js_number(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() < 1e15 {
        json!(value as i64)
    } else {
        json!(value)
    }
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

struct BuiltPrompt {
    prompt: String,
    candidates: Vec<JiraIssue>,
    activity_count: usize,
    git_repos: Vec<String>,
}

pub struct LlmService {
    config: Arc<ConfigService>,
    git: Arc<dyn CommitSource>,
    connections: Arc<ConnectionManager>,
    http: reqwest::Client,
}

impl LlmService {
    pub fn new(config: Arc<ConfigService>, git: Arc<dyn CommitSource>, connections: Arc<ConnectionManager>, http: reqwest::Client) -> Self {
        Self { config, git, connections, http }
    }

    pub async fn generate_suggestions(&self, request: &SuggestionRequest) -> AppResult<Vec<ProjectSuggestions>> {
        let mut results = Vec::new();
        let logged = self.fetch_logged_hours_by_date(request).await;
        // Sequential on purpose: CLI backends dislike concurrent invocations.
        // Hours are NOT split between targets - each Jira gets full entries.
        for selection in valid_selections(request)? {
            let project = self.project(&selection.project_id)?;
            let commits = self.fetch_commits(request, selection, &project).await?;
            let working = self.fetch_working_changes(request, selection, &project).await;
            for target in &project.targets {
                let connection = self.connections.connection(&target.connection_id)?;
                let label = pass_label(&project, target, &connection.name);
                let built = self.build_target_prompt(request, selection, &project, target, &commits, &working, &logged).await;
                logger::info(
                    "llm",
                    &format!("generate for \"{label}\""),
                    Some(json!({
                        "backend": self.config.get().llm.backend,
                        "dates": request.dates.len(),
                        "commits": commits.len(),
                        "candidateIssues": built.candidates.len(),
                        "jiraActivity": built.activity_count,
                        "uncommittedRepos": working.len(),
                        "promptLength": built.prompt.len(),
                    })),
                );
                let LlmCompletion { text, mut model } = self.complete_for(&label, &built.prompt, &built.git_repos).await?;
                let mut suggestions = self.parse_suggestions(&text, &request.dates, &built.candidates, target, selection.allow_new_issues)?;
                // The user picked this project for these dates, so an empty
                // answer with hours still free is a miss, not a verdict: ask
                // once more, pointing at the rule it skipped.
                if suggestions.is_empty() && has_remaining_budget(&request.dates, &logged, self.config.get().working_hours_per_day) {
                    logger::info("llm", &format!("\"{label}\": empty answer with budget left, retrying once"), None);
                    let retry = format!("{}\n\n{EMPTY_ANSWER_RETRY}", built.prompt);
                    let again = self.complete_for(&label, &retry, &built.git_repos).await?;
                    suggestions = self.parse_suggestions(&again.text, &request.dates, &built.candidates, target, selection.allow_new_issues)?;
                    model = again.model.or(model);
                }
                logger::info("llm", &format!("\"{label}\": {} suggestions parsed", suggestions.len()), Some(json!({ "model": model })));
                results.push(ProjectSuggestions {
                    project_id: project.id.clone(),
                    project_name: project.name.clone(),
                    target_id: target.id.clone(),
                    connection_id: connection.id.clone(),
                    connection_name: connection.name.clone(),
                    jira_project_key: target.jira_project_key.clone(),
                    model,
                    suggestions,
                });
            }
        }
        Ok(results)
    }

    /// Debug: the exact prompts `generate_suggestions` would send, per target.
    pub async fn preview_prompt(&self, request: &SuggestionRequest) -> AppResult<Vec<PromptPreview>> {
        let mut previews = Vec::new();
        let logged = self.fetch_logged_hours_by_date(request).await;
        for selection in valid_selections(request)? {
            let project = self.project(&selection.project_id)?;
            let commits = self.fetch_commits(request, selection, &project).await?;
            let working = self.fetch_working_changes(request, selection, &project).await;
            for target in &project.targets {
                let connection = self.connections.connection(&target.connection_id)?;
                let built = self.build_target_prompt(request, selection, &project, target, &commits, &working, &logged).await;
                previews.push(PromptPreview {
                    label: pass_label(&project, target, &connection.name),
                    // ~4 chars per token is a common rough heuristic.
                    approx_tokens: built.prompt.len().div_ceil(4),
                    prompt: built.prompt,
                });
            }
        }
        Ok(previews)
    }

    pub async fn regenerate_description(&self, request: &RegenerateDescriptionRequest) -> AppResult<String> {
        let s = &request.suggestion;
        let entry = json!({ "issueKey": s.issue_key, "date": s.date, "description": s.description, "hours": js_number(s.hours) });
        let prompt = REGENERATE_PROMPT
            .replace("{{language}}", language_name(&self.config.get().language))
            .replace("{{entry}}", &entry.to_string())
            .replace("{{commits}}", &format_commits(&request.commits, &s.date))
            .replace("{{notes}}", if request.free_text.is_empty() { "(none)" } else { &request.free_text })
            .replace("{{hint}}", if request.hint.is_empty() { "Rewrite it to be clearer." } else { &request.hint });
        let text = self.provider(&[]).complete(&prompt).await?.text.trim().to_string();
        if text.is_empty() {
            return Err(AppError::new(ErrorCode::LlmBadResponse, "The model returned an empty description"));
        }
        // Strip accidental wrapping quotes/fences.
        let fences = Regex::new(r"^```[a-z]*\n?|```$").unwrap();
        let unfenced = fences.replace_all(&text, "").to_string();
        let unquoted = unfenced.strip_prefix('"').unwrap_or(&unfenced);
        let unquoted = unquoted.strip_suffix('"').unwrap_or(unquoted);
        Ok(unquoted.trim().to_string())
    }

    /// Opens a system terminal running the Claude CLI login flow.
    pub fn start_claude_login(&self) -> AppResult<()> {
        let configured = self.config.get().llm.claude_cli_path;
        let cli = if configured.is_empty() { "claude".to_string() } else { configured };
        if cli.contains(['"', '\r', '\n']) {
            return Err(AppError::new(ErrorCode::ConfigInvalid, "Claude CLI path cannot contain quotes or line breaks"));
        }
        let spawned = {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                // `start` treats its first quoted argument as a window title,
                // so it gets an explicit empty one; the whole command reaches
                // cmd verbatim (cmd does not understand escaped quotes).
                std::process::Command::new("cmd.exe")
                    .raw_arg(format!("/d /s /c start \"\" cmd.exe /k \"{cli}\""))
                    .creation_flags(0x0800_0000)
                    .spawn()
            }
            #[cfg(target_os = "macos")]
            {
                std::process::Command::new("open").args(["-a", "Terminal", &cli]).spawn()
            }
            #[cfg(all(unix, not(target_os = "macos")))]
            {
                std::process::Command::new("x-terminal-emulator").args(["-e", &cli]).spawn()
            }
        };
        spawned
            .map(|_| ())
            .map_err(|e| AppError::with_details(ErrorCode::LlmFailed, "Could not open a terminal for Claude login", e.to_string()))
    }

    fn project(&self, id: &str) -> AppResult<ProjectConfig> {
        self.config
            .get()
            .projects
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| AppError::new(ErrorCode::ConfigInvalid, format!("Unknown project: {id}")))
    }

    /// Adds the project name so the user knows which pass failed.
    async fn complete_for(&self, label: &str, prompt: &str, git_repos: &[String]) -> AppResult<LlmCompletion> {
        self.provider(git_repos).complete(prompt).await.map_err(|e| AppError { message: format!("[{label}] {}", e.message), ..e })
    }

    /// Commits are shared by all targets of a project - fetched once per selection.
    async fn fetch_commits(&self, request: &SuggestionRequest, selection: &ProjectSelection, project: &ProjectConfig) -> AppResult<Vec<CommitInfo>> {
        if !selection.use_commits || project.git_folders.is_empty() {
            return Ok(Vec::new());
        }
        let paths: Vec<String> = project.git_folders.iter().map(|f| f.path.clone()).collect();
        self.git.get_commits(&paths, &request.dates).await
    }

    /// Uncommitted work only matters when today is among the dates: it is
    /// today's work that has no commit yet, never an older day's.
    async fn fetch_working_changes(&self, request: &SuggestionRequest, selection: &ProjectSelection, project: &ProjectConfig) -> Vec<WorkingChanges> {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        if !selection.use_commits || project.git_folders.is_empty() || !request.dates.contains(&today) {
            return Vec::new();
        }
        let paths: Vec<String> = project.git_folders.iter().map(|f| f.path.clone()).collect();
        self.git.get_working_changes(&paths).await
    }

    /// The user's own Jira activity in the target project on the requested
    /// dates; empty when Jira cannot answer (it is extra evidence, not required).
    async fn fetch_jira_activity(&self, request: &SuggestionRequest, target: &ProjectTarget) -> Vec<JiraActivity> {
        let sorted: BTreeSet<&String> = request.dates.iter().collect();
        let (Some(from), Some(to)) = (sorted.first(), sorted.last()) else { return Vec::new() };
        let Ok(account) = self.connections.account_id(&target.connection_id).await else { return Vec::new() };
        let jira = self.connections.jira(&target.connection_id);
        match jira.get_my_activity(&account, &target.jira_project_key, from, to).await {
            Ok(activity) => activity.into_iter().filter(|a| sorted.contains(&a.date)).collect(),
            Err(e) => {
                logger::info("llm", &format!("Jira activity unavailable for {}: {}", target.jira_project_key, e.message), None);
                Vec::new()
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn build_target_prompt(
        &self,
        request: &SuggestionRequest,
        selection: &ProjectSelection,
        project: &ProjectConfig,
        target: &ProjectTarget,
        commits: &[CommitInfo],
        working: &[WorkingChanges],
        logged: &HashMap<String, f64>,
    ) -> BuiltPrompt {
        let config = self.config.get();
        let prefix = format!("{}-", target.jira_project_key);
        let project_worklogs: Vec<Worklog> = self
            .fetch_recent_worklogs(&target.connection_id)
            .await
            .into_iter()
            .filter(|w| w.issue_key.starts_with(&prefix))
            .collect();
        let activity = self.fetch_jira_activity(request, target).await;
        let candidates = self.collect_target_candidates(target, commits, &project_worklogs, &activity).await;
        let auto_fill: Vec<CustomFieldConfig> = fields_for(&config, target).into_iter().filter(|f| f.auto_fill).collect();

        // Few-shot examples: the newest entries show the user's real logging style.
        let mut examples: Vec<&Worklog> = project_worklogs.iter().filter(|w| !w.description.trim().is_empty()).collect();
        examples.sort_by(|a, b| b.start_date.cmp(&a.start_date));
        let examples: Vec<Value> = examples
            .into_iter()
            .take(EXAMPLE_WORKLOG_COUNT)
            .map(|w| {
                json!({
                    "date": w.start_date,
                    "issueKey": w.issue_key,
                    "description": clip(&w.description, 240),
                    "hours": js_number(round2(w.time_spent_seconds as f64 / 3600.0)),
                })
            })
            .collect();

        // Hours already logged on the requested dates so the model fills only
        // the day's remaining budget. Only nonzero dates are sent.
        let mut already = Map::new();
        for date in &request.dates {
            let hours = round2(logged.get(date).copied().unwrap_or(0.0));
            if hours > 0.0 {
                already.insert(date.clone(), js_number(hours));
            }
        }

        // Compact JSON on purpose: pretty-printing burns 25-30% more tokens.
        let mut input = Map::new();
        input.insert("dates".into(), json!(request.dates));
        if !already.is_empty() {
            input.insert("hoursAlreadyLogged".into(), Value::Object(already));
        }
        let mut project_info = Map::new();
        project_info.insert("key".into(), json!(target.jira_project_key));
        project_info.insert("name".into(), json!(project.name));
        if !target.instruction.trim().is_empty() {
            project_info.insert("instructions".into(), json!(clip(&target.instruction, INSTRUCTION_LIMIT)));
        }
        input.insert("project".into(), Value::Object(project_info));
        input.insert("projectCount".into(), json!(request.selections.len()));
        if !auto_fill.is_empty() {
            let fields: Vec<Value> = auto_fill
                .iter()
                .map(|f| {
                    let mut field = json!({ "key": f.key, "label": clip(&f.label, 80), "type": f.field_type });
                    if !f.instruction.trim().is_empty() {
                        field["instruction"] = json!(clip(&f.instruction, INSTRUCTION_LIMIT));
                    }
                    field
                })
                .collect();
            input.insert("customFields".into(), json!(fields));
        }
        input.insert(
            "issues".into(),
            json!(candidates.iter().map(|i| json!({ "key": i.key, "summary": clip(&i.summary, 120) })).collect::<Vec<_>>()),
        );
        input.insert("recentWorklogs".into(), json!(examples));
        let git_repos = self.git_tool_repos(selection, project);
        input.insert(
            "commits".into(),
            json!(commits
                .iter()
                .map(|c| {
                    let mut commit = commit_for_prompt(c);
                    // Only worth the tokens when the model can `git show` it.
                    if !git_repos.is_empty() {
                        commit["hash"] = json!(c.hash.get(..10).unwrap_or(&c.hash));
                        commit["repo"] = json!(c.repo_label);
                    }
                    commit
                })
                .collect::<Vec<_>>()),
        );
        if !working.is_empty() {
            input.insert("uncommittedChanges".into(), json!(working.iter().map(working_for_prompt).collect::<Vec<_>>()));
        }
        if !activity.is_empty() {
            input.insert("jiraActivity".into(), activity_for_prompt(&activity));
        }
        input.insert("notes".into(), json!(selection.note));
        if selection.allow_new_issues {
            input.insert("allowNewIssues".into(), json!(true));
        }

        // The user's extra guidance overrides the built-in defaults; a blank
        // field leaves the placeholder empty so the base prompt is unchanged.
        let extra = config.llm.additional_instructions.trim();
        let additional = if extra.is_empty() {
            String::new()
        } else {
            format!("\nADDITIONAL INSTRUCTIONS FROM THE DEVELOPER (highest priority - follow them even when they conflict with the rules above):\n{extra}\n")
        };
        let prompt = MAIN_PROMPT
            .replace("{{workingHoursPerDay}}", &js_number(config.working_hours_per_day).to_string())
            .replace("{{language}}", language_name(&config.language))
            .replace("{{additionalInstructions}}", &format!("{}{additional}", git_tools_section(&git_repos)))
            .replace("{{input}}", &Value::Object(input).to_string());
        BuiltPrompt { prompt, candidates, activity_count: activity.len(), git_repos }
    }

    /// Hours already logged in Tempo on each requested date, summed across
    /// every connection in play, so suggestions top a day up instead of
    /// adding a full day on top of what is already there.
    async fn fetch_logged_hours_by_date(&self, request: &SuggestionRequest) -> HashMap<String, f64> {
        let config = self.config.get();
        let requested: HashSet<&String> = request.dates.iter().collect();
        let sorted: BTreeSet<&String> = request.dates.iter().collect();
        let (Some(from), Some(to)) = (sorted.first(), sorted.last()) else { return HashMap::new() };
        let mut ids: Vec<String> = config.active_connection_ids.clone();
        for selection in &request.selections {
            if let Some(project) = config.projects.iter().find(|p| p.id == selection.project_id) {
                for target in &project.targets {
                    if !ids.contains(&target.connection_id) {
                        ids.push(target.connection_id.clone());
                    }
                }
            }
        }
        let mut totals = HashMap::new();
        for id in ids {
            // Tempo unavailable or not configured for this connection - skip it.
            let Ok(account) = self.connections.account_id(&id).await else { continue };
            let Ok(worklogs) = self.connections.tempo(&id).get_worklogs(&account, from, to).await else { continue };
            for w in worklogs {
                if requested.contains(&w.start_date) {
                    *totals.entry(w.start_date).or_insert(0.0) += w.time_spent_seconds as f64 / 3600.0;
                }
            }
        }
        totals
    }

    /// Tempo worklogs from the lookback window; empty when Tempo is unavailable.
    async fn fetch_recent_worklogs(&self, connection_id: &str) -> Vec<Worklog> {
        let lookback = self.config.get().issue_pool.lookback_days;
        let Ok(account) = self.connections.account_id(connection_id).await else { return Vec::new() };
        let to = chrono::Utc::now();
        let from = to - chrono::Duration::milliseconds((lookback * 86_400_000.0) as i64);
        self.connections
            .tempo(connection_id)
            .get_worklogs(&account, &from.format("%Y-%m-%d").to_string(), &to.format("%Y-%m-%d").to_string())
            .await
            .unwrap_or_default()
    }

    /// The pool of existing issues of THIS target the model may assign work
    /// to: the user's recent worklog targets, issues referenced in commit
    /// messages and recently updated issues.
    async fn collect_target_candidates(
        &self,
        target: &ProjectTarget,
        commits: &[CommitInfo],
        project_worklogs: &[Worklog],
        activity: &[JiraActivity],
    ) -> Vec<JiraIssue> {
        let pool = self.config.get().issue_pool;
        let jira = self.connections.jira(&target.connection_id);
        let prefix = format!("{}-", target.jira_project_key);
        let mut candidates: Vec<JiraIssue> = Vec::new();
        let mut known: HashSet<String> = HashSet::new();
        let mut add = |issue: JiraIssue, candidates: &mut Vec<JiraIssue>| {
            if known.insert(issue.key.clone()) {
                candidates.push(issue);
            }
        };
        for w in project_worklogs {
            add(
                JiraIssue { id: w.issue_id.clone(), key: w.issue_key.clone(), summary: w.issue_summary.clone(), type_name: String::new(), is_subtask: false },
                &mut candidates,
            );
        }
        // Issues the user touched in Jira on these days are as strong a hint
        // as a commit reference, and they come with their summary already.
        let before_activity = candidates.len();
        for a in activity {
            add(
                JiraIssue { id: a.issue_id.clone(), key: a.issue_key.clone(), summary: a.summary.clone(), type_name: String::new(), is_subtask: false },
                &mut candidates,
            );
        }
        let active = candidates.len() - before_activity;
        // Issues referenced explicitly in commits (subject, body or branch
        // name like `feature/ABC-12-login`) are the strongest signal.
        let key_pattern = Regex::new(r"[A-Z][A-Z0-9]+-\d+").unwrap();
        let mut referenced: Vec<String> = Vec::new();
        for c in commits {
            let text = format!("{}\n{}\n{}", c.message, c.body, c.branch).to_uppercase();
            for m in key_pattern.find_iter(&text) {
                let key = m.as_str().to_string();
                if key.starts_with(&prefix) && !referenced.contains(&key) {
                    referenced.push(key);
                }
            }
        }
        for key in &referenced {
            if candidates.iter().any(|c| &c.key == key) {
                continue;
            }
            // A key that does not exist in Jira is skipped.
            if let Ok(issue) = jira.get_issue(key).await {
                add(issue, &mut candidates);
            }
        }
        // A stale project key can break the JQL - the pool still works without it.
        if let Ok(recent) = jira.get_recent_issues(&[target.jira_project_key.clone()], pool.lookback_days, pool.max_issues).await {
            for issue in recent {
                add(issue, &mut candidates);
            }
        }
        let limit = (pool.max_issues.max(0.0) as usize).max(referenced.len() + active);
        candidates.truncate(limit);
        candidates
    }

    /// Repositories the model may read itself: only with the setting on, the
    /// Claude CLI backend (the one that can run tools) and commits in use.
    fn git_tool_repos(&self, selection: &ProjectSelection, project: &ProjectConfig) -> Vec<String> {
        let llm = self.config.get().llm;
        if !llm.git_tools || paths::is_mock_mode() || !matches!(llm.backend.as_str(), "claude-cli" | "") || !selection.use_commits {
            return Vec::new();
        }
        project.git_folders.iter().map(|f| f.path.clone()).filter(|p| std::path::Path::new(p).is_dir()).collect()
    }

    fn provider(&self, git_repos: &[String]) -> Box<dyn LlmProvider> {
        if paths::is_mock_mode() {
            return Box::new(mock::MockLlm);
        }
        let llm = self.config.get().llm;
        let or = |value: &str, fallback: &str| if value.is_empty() { fallback.to_string() } else { value.to_string() };
        match llm.backend.as_str() {
            // The Copilot CLI does not expose a thinking switch.
            "copilot-cli" => Box::new(CopilotCli { cli_path: or(&llm.copilot_cli_path, "copilot"), model: llm.copilot_model }),
            "openai-api" => Box::new(OpenAiApi { config: llm.open_ai, enable_thinking: llm.enable_thinking, http: self.http.clone() }),
            _ => Box::new(ClaudeCli {
                cli_path: or(&llm.claude_cli_path, "claude"),
                model: llm.claude_model,
                enable_thinking: llm.enable_thinking,
                git_repos: git_repos.to_vec(),
            }),
        }
    }

    fn parse_suggestions(
        &self,
        text: &str,
        allowed_dates: &[String],
        candidates: &[JiraIssue],
        target: &ProjectTarget,
        allow_new_issues: bool,
    ) -> AppResult<Vec<WorklogSuggestion>> {
        let raw = extract_json_array(text)?;
        let dates: HashSet<&String> = allowed_dates.iter().collect();
        let by_key: HashMap<&str, &JiraIssue> = candidates.iter().map(|i| (i.key.as_str(), i)).collect();
        let fields = fields_for(&self.config.get(), target);
        let suggestions: Vec<WorklogSuggestion> = raw
            .iter()
            .filter(|s| s.is_object())
            .map(|s| {
                // Ground the suggestion in reality: only existing issues survive.
                let raw_key = s["issueKey"].as_str().map(|k| k.trim().to_uppercase()).unwrap_or_default();
                let issue = by_key.get(raw_key.as_str());
                // A proposed new issue only counts when the user allowed them
                // and no existing issue was matched.
                let new_issue = match (issue, allow_new_issues, s["newIssue"]["summary"].as_str()) {
                    (None, true, Some(summary)) if !summary.trim().is_empty() => Some(NewIssueDraft {
                        summary: clip(summary.trim(), 255),
                        description: s["newIssue"]["description"].as_str().map(|d| d.trim().to_string()).unwrap_or_default(),
                        ..Default::default()
                    }),
                    _ => None,
                };
                WorklogSuggestion {
                    id: uuid::Uuid::new_v4().to_string(),
                    date: s["date"].as_str().unwrap_or_default().to_string(),
                    // The project is fixed by configuration - the model never picks it.
                    project_key: target.jira_project_key.clone(),
                    issue_key: issue.map(|i| i.key.clone()).unwrap_or_default(),
                    issue_summary: issue.map(|i| i.summary.clone()).unwrap_or_default(),
                    issue_type_name: issue.map(|i| i.type_name.clone()).unwrap_or_default(),
                    issue_is_subtask: issue.is_some_and(|i| i.is_subtask),
                    description: s["description"].as_str().map(|d| d.trim().to_string()).unwrap_or_default(),
                    hours: normalize_hours(&s["hours"]),
                    custom_fields: normalize_custom_fields(&fields, &s["customFields"]),
                    new_issue,
                }
            })
            .filter(|s| dates.contains(&s.date) && !s.description.is_empty())
            .collect();
        // An empty array is a valid answer when every day is already full. A
        // non-empty response where every row was rejected is still malformed.
        if suggestions.is_empty() && !raw.is_empty() {
            return Err(AppError::with_details(ErrorCode::LlmBadResponse, "The model returned no usable suggestions", text.chars().take(2000).collect::<String>()));
        }
        Ok(suggestions)
    }
}

/// Whether any requested date still has hours left to log.
fn has_remaining_budget(dates: &[String], logged: &HashMap<String, f64>, hours_per_day: f64) -> bool {
    dates.iter().any(|d| hours_per_day - logged.get(d).copied().unwrap_or(0.0) > 0.01)
}

fn valid_selections(request: &SuggestionRequest) -> AppResult<&[ProjectSelection]> {
    if request.selections.is_empty() {
        return Err(AppError::new(ErrorCode::ConfigInvalid, "No project selected"));
    }
    Ok(&request.selections)
}

/// Distinguishes the passes of a multi-target project in logs and previews.
fn pass_label(project: &ProjectConfig, target: &ProjectTarget, connection_name: &str) -> String {
    if project.targets.len() < 2 {
        project.name.clone()
    } else {
        format!("{} ({} · {connection_name})", project.name, target.jira_project_key)
    }
}

/// Custom fields of the target's connection.
fn fields_for(config: &AppConfig, target: &ProjectTarget) -> Vec<CustomFieldConfig> {
    config.custom_fields.iter().filter(|f| f.connection_id == target.connection_id).cloned().collect()
}

/// Every configured field ends up present with a value of its declared type
/// (LLM output is never trusted).
fn normalize_custom_fields(fields: &[CustomFieldConfig], raw: &Value) -> BTreeMap<String, AttrValue> {
    fields
        .iter()
        .map(|f| {
            let value = &raw[&f.key];
            let normalized = if f.field_type == "boolean" {
                AttrValue::Bool(value.as_bool().unwrap_or(value.as_str() == Some("true")))
            } else {
                AttrValue::Text(value.as_str().map(|v| clip(v.trim(), 255)).unwrap_or_default())
            };
            (f.key.clone(), normalized)
        })
        .collect()
}

fn normalize_hours(hours: &Value) -> f64 {
    let value = match hours {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => s.trim().parse().unwrap_or(f64::NAN),
        _ => f64::NAN,
    };
    if !value.is_finite() || value <= 0.0 {
        return 1.0;
    }
    // Quarter-hour precision, capped at a sane day length.
    ((value * 4.0).round() / 4.0).min(24.0)
}

/// Paths listed per commit; the rest is summarised as a count.
const COMMIT_FILE_LIMIT: usize = 12;

/// A commit as the model sees it. The subject alone is often too terse to
/// describe a day, so the body, the branch (often named after the ticket) and
/// the touched paths go along - each clipped, empty ones left out.
fn commit_for_prompt(c: &CommitInfo) -> Value {
    // Date only - the time of day and zone offset carry no signal here.
    let mut commit = json!({ "date": c.date.get(..10).unwrap_or(&c.date), "message": clip(&c.message, 200) });
    // Local time of day: gaps between a day's commits hint at how long each took.
    if let Some(time) = c.date.get(11..16) {
        commit["time"] = json!(time);
    }
    if c.additions + c.deletions > 0 {
        commit["changes"] = json!(format!("+{}/-{}", c.additions, c.deletions));
    }
    // Trailers (Co-Authored-By, Signed-off-by) are noise for a worklog.
    let body: Vec<&str> = c.body.lines().filter(|l| !is_trailer(l)).collect();
    let body = body.join("\n");
    if !body.trim().is_empty() {
        commit["body"] = json!(clip(body.trim(), 600));
    }
    if !c.branch.is_empty() && !matches!(c.branch.as_str(), "HEAD" | "main" | "master" | "develop" | "origin/main" | "origin/master" | "origin/develop") {
        commit["branch"] = json!(clip(&c.branch, 80));
    }
    if !c.files.is_empty() {
        commit["files"] = json!(clipped_list(&c.files, COMMIT_FILE_LIMIT));
    }
    commit
}

/// Tells the model it may dig into the repositories itself, and how far.
fn git_tools_section(repos: &[String]) -> String {
    if repos.is_empty() {
        return String::new();
    }
    let list = repos.iter().map(|r| format!("- {r}")).collect::<Vec<_>>().join("\n");
    format!(
        "\nGIT ACCESS: you can run read-only git commands (git log, git show, git diff, git branch, git status) with the Bash tool in these repositories:\n{list}\n\
The working directory is the first one; for another use `cd <path> && git ...`. Use it only when the input is not enough to tell what a commit did or how big it was - e.g. `git show --stat <hash>`, or `git show <hash> -- <file>` for a closer look. A few commands at most, never anything that changes a repository. Your final message must still be ONLY the JSON array.\n"
    )
}

fn clipped_list(items: &[String], limit: usize) -> Vec<String> {
    let mut list: Vec<String> = items.iter().take(limit).map(|f| clip(f, 120)).collect();
    if items.len() > limit {
        list.push(format!("(+{} more)", items.len() - limit));
    }
    list
}

fn working_for_prompt(w: &WorkingChanges) -> Value {
    let mut repo = json!({ "repo": w.repo_label, "branch": w.branch });
    if !w.files.is_empty() {
        repo["changes"] = json!(format!("+{}/-{}", w.additions, w.deletions));
        repo["files"] = json!(clipped_list(&w.files, COMMIT_FILE_LIMIT));
    }
    if !w.untracked.is_empty() {
        repo["newFiles"] = json!(clipped_list(&w.untracked, COMMIT_FILE_LIMIT));
    }
    repo
}

/// Activity grouped per issue and day, so one busy ticket is one row.
fn activity_for_prompt(activity: &[JiraActivity]) -> Value {
    let mut rows: Vec<(String, String, String, Vec<String>)> = Vec::new();
    for a in activity {
        match rows.iter_mut().find(|r| r.0 == a.date && r.1 == a.issue_key) {
            Some(row) => row.3.push(a.action.clone()),
            None => rows.push((a.date.clone(), a.issue_key.clone(), a.summary.clone(), vec![a.action.clone()])),
        }
    }
    rows.sort_by(|a, b| a.0.cmp(&b.0));
    json!(rows
        .into_iter()
        .map(|(date, key, summary, actions)| json!({ "date": date, "issueKey": key, "summary": clip(&summary, 120), "actions": actions.into_iter().take(8).collect::<Vec<_>>() }))
        .collect::<Vec<_>>())
}

fn is_trailer(line: &str) -> bool {
    let lower = line.trim().to_lowercase();
    ["co-authored-by:", "signed-off-by:", "reviewed-by:", "change-id:"].iter().any(|t| lower.starts_with(t))
}

fn format_commits(commits: &[CommitInfo], date: &str) -> String {
    let relevant: Vec<&CommitInfo> = commits.iter().filter(|c| c.date.starts_with(date)).collect();
    let list: Vec<&CommitInfo> = if relevant.is_empty() { commits.iter().collect() } else { relevant };
    if list.is_empty() {
        return "(none)".into();
    }
    list.iter()
        .map(|c| format!("- [{}] {}: {}", c.repo_label, c.date.get(..10).unwrap_or(&c.date), c.message))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Every top-level `[...]` substring with balanced brackets, string literals
/// respected so a `]` inside a description doesn't end the scan early.
fn balanced_arrays(text: &str) -> Vec<&str> {
    let bytes = text.as_bytes();
    let mut found = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'[' {
            i += 1;
            continue;
        }
        let (mut depth, mut in_string, mut escaped) = (0i32, false, false);
        let mut end = None;
        for (j, &ch) in bytes.iter().enumerate().skip(i) {
            if in_string {
                if escaped {
                    escaped = false;
                } else if ch == b'\\' {
                    escaped = true;
                } else if ch == b'"' {
                    in_string = false;
                }
                continue;
            }
            match ch {
                b'"' => in_string = true,
                b'[' | b'{' => depth += 1,
                b']' | b'}' => {
                    depth -= 1;
                    if depth <= 0 {
                        end = Some(j);
                        break;
                    }
                }
                _ => {}
            }
        }
        match end {
            Some(j) => {
                found.push(&text[i..=j]);
                i = j + 1;
            }
            None => i += 1,
        }
    }
    found
}

/// Rows the model actually meant as suggestions, as opposed to prose brackets.
fn looks_like_suggestion(row: &Value) -> bool {
    row.is_object() && (row.get("issueKey").is_some() || row.get("description").is_some() || row.get("hours").is_some())
}

/// Models wrap JSON in fences, add remarks, or split the answer into one array
/// per day. Scanning for balanced arrays tolerates anything around the answer.
fn extract_json_array(text: &str) -> AppResult<Vec<Value>> {
    let candidates = balanced_arrays(text);
    let arrays: Vec<Vec<Value>> = candidates
        .iter()
        .filter_map(|c| serde_json::from_str::<Value>(c).ok())
        .filter_map(|v| v.as_array().cloned())
        .collect();
    if arrays.is_empty() {
        let message = if candidates.is_empty() { "The model response contains no JSON array" } else { "The model returned malformed JSON" };
        return Err(AppError::with_details(ErrorCode::LlmBadResponse, message, text.chars().take(2000).collect::<String>()));
    }
    // Keep every array that carries rows (a per-day split must not be cut to
    // its first chunk); no rows anywhere means the legitimate empty answer.
    let with_rows: Vec<Value> = arrays.iter().filter(|rows| rows.iter().any(looks_like_suggestion)).flatten().cloned().collect();
    Ok(if with_rows.is_empty() { arrays[0].clone() } else { with_rows })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_rows_around_prose_and_split_days() {
        let text = "Here you go:\n```json\n[{\"date\":\"2026-01-02\",\"issueKey\":\"A-1\",\"description\":\"x]\",\"hours\":4}]\n```\n[{\"date\":\"2026-01-03\",\"issueKey\":\"A-2\",\"description\":\"y\",\"hours\":4}]\nSee [A-12].";
        let rows = extract_json_array(text).unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn empty_array_is_a_valid_answer() {
        assert!(extract_json_array("[]").unwrap().is_empty());
        assert!(extract_json_array("no json here").is_err());
    }

    #[test]
    fn hours_are_quarter_rounded_and_capped() {
        assert_eq!(normalize_hours(&json!(2.1)), 2.0);
        assert_eq!(normalize_hours(&json!("3.4")), 3.5);
        assert_eq!(normalize_hours(&json!(-1)), 1.0);
        assert_eq!(normalize_hours(&json!(30)), 24.0);
    }

    #[test]
    fn numbers_print_like_javascript() {
        assert_eq!(js_number(8.0).to_string(), "8");
        assert_eq!(js_number(7.5).to_string(), "7.5");
    }
}
