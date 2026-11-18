//! Thin client for the Jira Cloud REST API v3 (Basic auth: email + API token).

use crate::domain::{CreateIssueRequest, JiraConfig, JiraIssue, JiraIssueType, JiraProject, JiraUser};
use crate::error::{AppError, AppResult, ErrorCode};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD, Engine};
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Arc;

/// Surface of the Jira client used by the app; implemented by mocks too.
#[async_trait]
pub trait JiraApi: Send + Sync {
    async fn get_myself(&self) -> AppResult<JiraUser>;
    async fn get_projects(&self) -> AppResult<Vec<JiraProject>>;
    async fn search_issues(&self, query: &str, project_keys: &[String]) -> AppResult<Vec<JiraIssue>>;
    async fn get_project_issues(&self, project_key: &str) -> AppResult<Vec<JiraIssue>>;
    async fn get_recent_issues(&self, project_keys: &[String], lookback_days: f64, max_issues: f64) -> AppResult<Vec<JiraIssue>>;
    async fn get_issue(&self, key: &str) -> AppResult<JiraIssue>;
    async fn get_issues_by_ids(&self, ids: &[String]) -> AppResult<Vec<JiraIssue>>;
    /// Issue types a new issue in this project can have.
    async fn get_issue_types(&self, project_key: &str) -> AppResult<Vec<JiraIssueType>>;
    async fn create_issue(&self, request: &CreateIssueRequest) -> AppResult<JiraIssue>;
    /// What the user did in a project between two dates (inclusive): status
    /// changes, comments, edits. Evidence of work that left no commit.
    async fn get_my_activity(&self, _account_id: &str, _project_key: &str, _from: &str, _to: &str) -> AppResult<Vec<JiraActivity>> {
        Ok(Vec::new())
    }
    /// The same across several projects at once - one query per Jira instead
    /// of one per project. Callers group the result by key prefix. The
    /// default asks project by project, so simple implementations only need
    /// `get_my_activity`; it fails only when every project failed.
    async fn get_my_activity_in(&self, account_id: &str, project_keys: &[String], from: &str, to: &str) -> AppResult<Vec<JiraActivity>> {
        let mut all = Vec::new();
        let (mut failed, mut last_error) = (0, None);
        for key in project_keys {
            match self.get_my_activity(account_id, key, from, to).await {
                Ok(found) => all.extend(found),
                Err(e) => {
                    failed += 1;
                    last_error = Some(e);
                }
            }
        }
        match last_error {
            Some(e) if failed == project_keys.len() => Err(e),
            _ => Ok(all),
        }
    }
}

/// The type a new issue gets when none was picked: Task, else the first type
/// that isn't a subtask (a subtask needs a parent).
pub fn default_issue_type(types: &[JiraIssueType]) -> Option<&JiraIssueType> {
    let regular: Vec<&JiraIssueType> = types.iter().filter(|t| !t.subtask).collect();
    regular
        .iter()
        .find(|t| t.name.eq_ignore_ascii_case("task") || t.name.eq_ignore_ascii_case("zadanie"))
        .or_else(|| regular.first())
        .copied()
}

/// Plain text as an Atlassian Document: one paragraph per line.
fn to_adf(text: &str) -> Value {
    let paragraphs: Vec<Value> = text
        .lines()
        .map(|line| {
            if line.trim().is_empty() {
                json!({ "type": "paragraph", "content": [] })
            } else {
                json!({ "type": "paragraph", "content": [{ "type": "text", "text": line }] })
            }
        })
        .collect();
    json!({ "type": "doc", "version": 1, "content": paragraphs })
}

#[derive(Deserialize)]
struct IssueTypeDto {
    name: Option<String>,
    subtask: Option<bool>,
}

#[derive(Deserialize)]
struct IssueFieldsDto {
    summary: Option<String>,
    issuetype: Option<IssueTypeDto>,
}

#[derive(Deserialize)]
struct IssueDto {
    id: String,
    key: String,
    fields: IssueFieldsDto,
}

#[derive(Deserialize)]
struct IssuePageDto {
    issues: Vec<IssueDto>,
}

const ISSUE_FIELDS: [&str; 2] = ["summary", "issuetype"];

fn to_issue(dto: IssueDto) -> JiraIssue {
    let issue_type = dto.fields.issuetype;
    JiraIssue {
        id: dto.id,
        key: dto.key,
        summary: dto.fields.summary.unwrap_or_default(),
        type_name: issue_type.as_ref().and_then(|t| t.name.clone()).unwrap_or_default(),
        is_subtask: issue_type.and_then(|t| t.subtask).unwrap_or(false),
    }
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    if value.is_finite() { value.clamp(min, max) } else { min }
}

/// JQL string literal, the way `JSON.stringify` quotes it.
fn quote(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

/// One thing the user did on an issue on a given day.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct JiraActivity {
    pub date: String,
    /// Local "HH:MM" of the change, as Jira reports it; empty when unknown.
    pub time: String,
    pub issue_id: String,
    pub issue_key: String,
    pub summary: String,
    pub action: String,
}

/// Issues pulled for activity; more is noise for one project and a few days.
const ACTIVITY_ISSUE_LIMIT: usize = 30;

/// Plain text of an Atlassian Document Format node (comment bodies in v3).
fn adf_text(node: &Value) -> String {
    let mut out = String::new();
    fn walk(node: &Value, out: &mut String) {
        if let Some(text) = node["text"].as_str() {
            out.push_str(text);
        }
        if let Some(children) = node["content"].as_array() {
            for child in children {
                walk(child, out);
            }
            if matches!(node["type"].as_str(), Some("paragraph" | "listItem" | "heading")) {
                out.push(' ');
            }
        }
    }
    walk(node, &mut out);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The user's own changelog entries and comments within [from, to].
fn parse_activity(issue: &Value, account_id: &str, from: &str, to: &str) -> Vec<JiraActivity> {
    let key = issue["key"].as_str().unwrap_or_default();
    let id = issue["id"].as_str().unwrap_or_default();
    let summary = issue["fields"]["summary"].as_str().unwrap_or_default();
    let in_range = |created: &str| -> Option<(String, String)> {
        let date = created.get(..10)?;
        let time = created.get(11..16).unwrap_or_default().to_string();
        (date >= from && date <= to).then(|| (date.to_string(), time))
    };
    let mine = |author: &Value| author["accountId"].as_str() == Some(account_id);
    let mut out = Vec::new();
    let mut push = |(date, time): (String, String), action: String| {
        let entry = JiraActivity { date, time, issue_id: id.into(), issue_key: key.into(), summary: summary.into(), action };
        if !out.contains(&entry) {
            out.push(entry);
        }
    };
    for history in issue["changelog"]["histories"].as_array().into_iter().flatten() {
        let Some(date) = history["created"].as_str().and_then(in_range) else { continue };
        if !mine(&history["author"]) {
            continue;
        }
        for item in history["items"].as_array().into_iter().flatten() {
            let field = item["field"].as_str().unwrap_or_default();
            let from_s = item["fromString"].as_str().unwrap_or_default();
            let to_s = item["toString"].as_str().unwrap_or_default();
            let action = match field {
                "status" => format!("status: {from_s} -> {to_s}"),
                "assignee" => format!("assignee: {to_s}"),
                // Time tracking moves with every worklog - says nothing new.
                "timespent" | "timeestimate" | "WorklogId" | "WorklogTimeSpent" => continue,
                _ => format!("edited {field}"),
            };
            push(date.clone(), action);
        }
    }
    for comment in issue["fields"]["comment"]["comments"].as_array().into_iter().flatten() {
        let Some(date) = comment["created"].as_str().and_then(in_range) else { continue };
        if !mine(&comment["author"]) {
            continue;
        }
        let text = adf_text(&comment["body"]);
        let text = if text.chars().count() > 200 { format!("{}…", text.chars().take(199).collect::<String>()) } else { text };
        push(date, format!("comment: {text}"));
    }
    out
}

pub type JiraConfigSource = Arc<dyn Fn() -> AppResult<JiraConfig> + Send + Sync>;

pub struct JiraClient {
    config: JiraConfigSource,
    http: reqwest::Client,
}

impl JiraClient {
    pub fn new(config: JiraConfigSource, http: reqwest::Client) -> Self {
        Self { config, http }
    }

    async fn request(&self, path: &str, body: Option<Value>) -> AppResult<Value> {
        let JiraConfig { base_url, email, api_token } = (self.config)()?;
        if base_url.is_empty() || email.is_empty() || api_token.is_empty() {
            return Err(AppError::new(ErrorCode::ConfigInvalid, "Jira connection is not configured"));
        }
        let url = reqwest::Url::parse(&base_url)
            .and_then(|base| base.join(path))
            .map_err(|e| AppError::with_details(ErrorCode::JiraUnreachable, "Cannot reach Jira", e.to_string()))?;
        let auth = format!("Basic {}", STANDARD.encode(format!("{email}:{api_token}")));
        let request = match &body {
            Some(body) => self.http.post(url).json(body),
            None => self.http.get(url),
        };
        let response = request
            .header("Authorization", auth)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| AppError::with_details(ErrorCode::JiraUnreachable, "Cannot reach Jira", e.to_string()))?;
        let status = response.status().as_u16();
        if status == 401 || status == 403 {
            return Err(AppError::new(ErrorCode::JiraAuth, "Jira rejected the credentials"));
        }
        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(AppError::with_details(ErrorCode::JiraUnreachable, format!("Jira returned HTTP {status}"), text));
        }
        response
            .json()
            .await
            .map_err(|e| AppError::with_details(ErrorCode::JiraUnreachable, "Jira sent an unreadable response", e.to_string()))
    }

    /// The user's activity in the given projects within [from, to].
    async fn activity_query(&self, account_id: &str, project_keys: &[String], from: &str, to: &str, limit: usize) -> AppResult<Vec<JiraActivity>> {
        // JQL date ranges end at midnight, so the last day needs the next one as the bound.
        let until = chrono::NaiveDate::parse_from_str(to, "%Y-%m-%d")
            .map(|d| (d + chrono::Duration::days(1)).format("%Y-%m-%d").to_string())
            .unwrap_or_else(|_| to.to_string());
        let scope = format!("project in ({})", project_keys.iter().map(|k| quote(k)).collect::<Vec<_>>().join(","));
        let account = quote(account_id);
        // updatedBy() catches comments and edits too; status CHANGED BY is the
        // narrower fallback for instances that reject it.
        let queries = [
            format!("{scope} AND issue in updatedBy({account}, \"{from}\", \"{until}\") ORDER BY updated DESC"),
            format!("{scope} AND status CHANGED BY {account} DURING (\"{from}\", \"{until}\") ORDER BY updated DESC"),
        ];
        let mut last_error = None;
        for jql in queries {
            let body = json!({ "jql": jql, "maxResults": limit, "fields": ["summary", "comment"], "expand": "changelog" });
            match self.request("/rest/api/3/search/jql", Some(body)).await {
                Ok(page) => {
                    let issues = page["issues"].as_array().cloned().unwrap_or_default();
                    return Ok(issues.iter().flat_map(|i| parse_activity(i, account_id, from, to)).collect());
                }
                Err(e) => last_error = Some(e),
            }
        }
        Err(last_error.unwrap())
    }

    async fn search(&self, jql: String, max_results: usize) -> AppResult<Vec<JiraIssue>> {
        let page = self
            .request("/rest/api/3/search/jql", Some(json!({ "jql": jql, "maxResults": max_results, "fields": ISSUE_FIELDS })))
            .await?;
        let page: IssuePageDto = serde_json::from_value(page)
            .map_err(|e| AppError::with_details(ErrorCode::JiraUnreachable, "Jira sent an unreadable response", e.to_string()))?;
        Ok(page.issues.into_iter().map(to_issue).collect())
    }
}

#[async_trait]
impl JiraApi for JiraClient {
    async fn get_myself(&self) -> AppResult<JiraUser> {
        let dto = self.request("/rest/api/3/myself", None).await?;
        Ok(JiraUser {
            account_id: dto["accountId"].as_str().unwrap_or_default().to_string(),
            display_name: dto["displayName"].as_str().unwrap_or_default().to_string(),
        })
    }

    async fn get_projects(&self) -> AppResult<Vec<JiraProject>> {
        let mut projects = Vec::new();
        let mut start_at = 0;
        loop {
            let page = self
                .request(&format!("/rest/api/3/project/search?startAt={start_at}&maxResults=100&orderBy=name"), None)
                .await?;
            let values = page["values"].as_array().cloned().unwrap_or_default();
            for p in &values {
                projects.push(JiraProject {
                    id: p["id"].as_str().unwrap_or_default().to_string(),
                    key: p["key"].as_str().unwrap_or_default().to_string(),
                    name: p["name"].as_str().unwrap_or_default().to_string(),
                });
            }
            if page["isLast"].as_bool().unwrap_or(true) || values.is_empty() {
                break;
            }
            start_at += values.len();
        }
        Ok(projects)
    }

    /// Server-side issue search. Jira's `~` operator only matches word
    /// prefixes, so every word of the query is matched independently; an
    /// exact-key query is additionally resolved directly.
    async fn search_issues(&self, query: &str, project_keys: &[String]) -> AppResult<Vec<JiraIssue>> {
        let scope = if project_keys.is_empty() {
            String::new()
        } else {
            format!("project in ({}) AND ", project_keys.iter().map(|k| quote(k)).collect::<Vec<_>>().join(","))
        };
        let trimmed = query.trim();
        let mut results = Vec::new();
        let mut seen = HashSet::new();
        let mut run = |found: AppResult<Vec<JiraIssue>>| {
            // A key-shaped query for a nonexistent project makes the JQL fail;
            // the remaining clauses can still produce matches.
            for issue in found.unwrap_or_default() {
                if seen.insert(issue.key.clone()) {
                    results.push(issue);
                }
            }
        };
        if Regex::new(r"^[A-Za-z][A-Za-z0-9]*-\d+$").unwrap().is_match(trimmed) {
            run(self.search(format!("{scope}key = {}", quote(&trimmed.to_uppercase())), 30).await);
        }
        let words: Vec<String> = trimmed
            .split_whitespace()
            .map(|w| w.replace(['"', '\\', '*'], ""))
            .filter(|w| !w.is_empty())
            .collect();
        if !words.is_empty() {
            // `text ~` covers the summary AND the description (also comments).
            let clauses = words.iter().map(|w| format!("text ~ {}", quote(&format!("{w}*")))).collect::<Vec<_>>().join(" AND ");
            run(self.search(format!("{scope}{clauses} ORDER BY updated DESC"), 30).await);
        }
        Ok(results)
    }

    /// Most recently updated issues of one project - the local haystack for
    /// substring filtering in the issue picker.
    async fn get_project_issues(&self, project_key: &str) -> AppResult<Vec<JiraIssue>> {
        self.search(format!("project = {} ORDER BY updated DESC", quote(project_key)), 200).await
    }

    /// Recently updated issues - the candidate pool the LLM may pick from.
    async fn get_recent_issues(&self, project_keys: &[String], lookback_days: f64, max_issues: f64) -> AppResult<Vec<JiraIssue>> {
        if project_keys.is_empty() {
            return Ok(Vec::new());
        }
        let days = clamp(lookback_days.round(), 1.0, 365.0) as i64;
        let keys = project_keys.iter().map(|k| quote(k)).collect::<Vec<_>>().join(",");
        let jql = format!("project in ({keys}) AND updated >= -{days}d ORDER BY updated DESC");
        self.search(jql, clamp(max_issues.round(), 1.0, 500.0) as usize).await
    }

    /// Resolves an issue key to its numeric id (required by the Tempo API).
    async fn get_issue(&self, key: &str) -> AppResult<JiraIssue> {
        let encoded: String = url_encode(key);
        let dto = self.request(&format!("/rest/api/3/issue/{encoded}?fields={}", ISSUE_FIELDS.join(",")), None).await?;
        let dto: IssueDto = serde_json::from_value(dto)
            .map_err(|e| AppError::with_details(ErrorCode::JiraUnreachable, "Jira sent an unreadable response", e.to_string()))?;
        Ok(to_issue(dto))
    }

    async fn get_issue_types(&self, project_key: &str) -> AppResult<Vec<JiraIssueType>> {
        let page = self
            .request(&format!("/rest/api/3/issue/createmeta/{}/issuetypes?maxResults=100", url_encode(project_key)), None)
            .await?;
        // Newer sites answer with `issueTypes`, older ones with `values`.
        let list = page["issueTypes"].as_array().or_else(|| page["values"].as_array()).cloned().unwrap_or_default();
        Ok(list
            .iter()
            .map(|t| JiraIssueType {
                id: t["id"].as_str().unwrap_or_default().to_string(),
                name: t["name"].as_str().unwrap_or_default().to_string(),
                subtask: t["subtask"].as_bool().unwrap_or(false),
            })
            .filter(|t| !t.id.is_empty())
            .collect())
    }

    async fn create_issue(&self, request: &CreateIssueRequest) -> AppResult<JiraIssue> {
        let types = self.get_issue_types(&request.project_key).await?;
        let issue_type = if request.issue_type_id.is_empty() {
            default_issue_type(&types)
        } else {
            types.iter().find(|t| t.id == request.issue_type_id)
        }
        .cloned()
        .ok_or_else(|| AppError::new(ErrorCode::JiraUnreachable, format!("No issue type to create issues in {}", request.project_key)))?;
        let mut fields = json!({
            "project": { "key": request.project_key },
            "issuetype": { "id": issue_type.id },
            "summary": request.summary.trim(),
        });
        if !request.description.trim().is_empty() {
            fields["description"] = to_adf(request.description.trim());
        }
        if request.assign_to_me {
            let me = self.get_myself().await?;
            fields["assignee"] = json!({ "accountId": me.account_id });
        }
        let created = self.request("/rest/api/3/issue", Some(json!({ "fields": fields }))).await?;
        Ok(JiraIssue {
            id: created["id"].as_str().unwrap_or_default().to_string(),
            key: created["key"].as_str().unwrap_or_default().to_string(),
            summary: request.summary.trim().to_string(),
            type_name: issue_type.name,
            is_subtask: issue_type.subtask,
        })
    }

    async fn get_my_activity(&self, account_id: &str, project_key: &str, from: &str, to: &str) -> AppResult<Vec<JiraActivity>> {
        self.activity_query(account_id, &[project_key.to_string()], from, to, ACTIVITY_ISSUE_LIMIT).await
    }

    async fn get_my_activity_in(&self, account_id: &str, project_keys: &[String], from: &str, to: &str) -> AppResult<Vec<JiraActivity>> {
        if project_keys.is_empty() {
            return Ok(Vec::new());
        }
        // One query spans several projects, so it gets a proportionally larger page.
        let limit = (ACTIVITY_ISSUE_LIMIT * project_keys.len()).min(100);
        self.activity_query(account_id, project_keys, from, to, limit).await
    }

    async fn get_issues_by_ids(&self, ids: &[String]) -> AppResult<Vec<JiraIssue>> {
        let mut unique: Vec<String> = Vec::new();
        for id in ids {
            if !unique.contains(id) {
                unique.push(id.clone());
            }
        }
        let mut issues = Vec::new();
        // JQL "id in (...)" handles batches; keep them modest.
        for batch in unique.chunks(100) {
            issues.extend(self.search(format!("id in ({})", batch.join(",")), batch.len()).await?);
        }
        Ok(issues)
    }
}

/// `encodeURIComponent` for the characters an issue key can contain.
pub fn url_encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_own_activity_in_range() {
        let issue = json!({
            "key": "FOP-7", "fields": { "summary": "Filters",
                "comment": { "comments": [
                    { "created": "2026-11-18T10:00:00.000+0100", "author": { "accountId": "me" },
                      "body": { "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Done, see PR" }] }] } },
                    { "created": "2026-11-18T11:00:00.000+0100", "author": { "accountId": "other" }, "body": {} }
                ] } },
            "changelog": { "histories": [
                { "created": "2026-11-18T09:00:00.000+0100", "author": { "accountId": "me" },
                  "items": [{ "field": "status", "fromString": "To Do", "toString": "In Progress" }, { "field": "timespent" }] },
                { "created": "2026-11-17T09:00:00.000+0100", "author": { "accountId": "me" },
                  "items": [{ "field": "status", "fromString": "Backlog", "toString": "To Do" }] }
            ] }
        });
        let actions: Vec<String> = parse_activity(&issue, "me", "2026-11-18", "2026-11-18").into_iter().map(|a| a.action).collect();
        assert_eq!(actions, vec!["status: To Do -> In Progress", "comment: Done, see PR"]);
    }
}
