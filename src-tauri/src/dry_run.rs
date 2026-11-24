//! Dry run of auto mode against the real config, repos, Jira and Tempo:
//! the activity scan plus the exact prompts it leads to, without calling the
//! LLM or writing anything anywhere. Ignored by default; run it with
//!
//! ```sh
//! JAL_DRY_RUN_DATES=2026-11-18,2026-11-19 JAL_DRY_RUN_OUT=/tmp/dry-run.json \
//!   cargo test dry_run -- --ignored --nocapture
//! ```
//!
//! Only read requests reach Jira and Tempo (the same ones the wizard makes).

use crate::activity::{ActivityService, EVIDENCE, LIKELY};
use crate::config::ConfigService;
use crate::domain::*;
use crate::llm::LlmService;
use crate::services::connections::ConnectionManager;
use crate::services::git::{CommitSource, GitService};
use serde_json::json;
use std::sync::Arc;

#[tokio::test]
#[ignore]
async fn dry_run_auto_mode_on_real_data() {
    let config = Arc::new(ConfigService::new());
    let http = reqwest::Client::new();
    let connections = Arc::new(ConnectionManager::new(config.clone(), http.clone()));
    let folders = config.clone();
    // JAL_MOCK=1 runs the same flow on the mock fixtures (no network).
    let git: Arc<dyn CommitSource> = if crate::paths::is_mock_mode() {
        Arc::new(crate::mock::clients::MockGit)
    } else {
        Arc::new(GitService::new(Arc::new(move || folders.get().projects.into_iter().flat_map(|p| p.git_folders).collect())))
    };
    let activity = ActivityService::new(config.clone(), git.clone(), connections.clone());
    let llm = LlmService::new(config.clone(), git, connections, http);

    let dates: Vec<String> = std::env::var("JAL_DRY_RUN_DATES")
        .unwrap_or_else(|_| chrono::Local::now().format("%Y-%m-%d").to_string())
        .split(',')
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
        .collect();
    let scan = activity.scan(&ActivityScanRequest { dates: dates.clone() }).await;

    // What the auto wizard would submit: evidence and likely projects, each
    // with its scan hints.
    let selections: Vec<ProjectSelection> = scan
        .projects
        .iter()
        .filter(|p| p.status == EVIDENCE || p.status == LIKELY)
        .map(|p| ProjectSelection {
            project_id: p.project_id.clone(),
            use_commits: true,
            hours_hint: p.days.iter().filter(|d| d.hours_hint > 0.0).map(|d| (d.date.clone(), d.hours_hint)).collect(),
            ..Default::default()
        })
        .collect();
    let previews = if selections.is_empty() {
        Vec::new()
    } else {
        llm.preview_prompt(&SuggestionRequest { dates, selections: selections.clone() }).await.expect("prompt preview")
    };

    for p in &scan.projects {
        println!("{:<32} {:<9} recent {}/{}", p.project_name, p.status, p.recent_logged_days, p.recent_day_count);
        for d in &p.days {
            println!(
                "    {} {:<9} commits {} (+{}/-{}) {}-{} jira {} hint {} h, {} events",
                d.date, d.status, d.commit_count, d.additions, d.deletions, d.first_commit_at, d.last_commit_at, d.jira_activity_count, d.hours_hint, d.events.len()
            );
        }
    }
    for preview in &previews {
        println!("prompt \"{}\": ~{} tokens", preview.label, preview.approx_tokens);
    }
    if let Ok(path) = std::env::var("JAL_DRY_RUN_OUT") {
        let out = json!({ "config": config.get(), "scan": scan, "selections": selections, "prompts": previews });
        std::fs::write(&path, serde_json::to_string_pretty(&out).unwrap()).expect("write dry-run output");
        println!("written to {path}");
    }
}

/// Raw Jira activity over the last 30 days per connection, to tell "nothing
/// done in Jira" apart from a query that silently finds nothing.
#[tokio::test]
#[ignore]
async fn dry_run_jira_activity_probe() {
    let config = Arc::new(ConfigService::new());
    let connections = ConnectionManager::new(config.clone(), reqwest::Client::new());
    let to = chrono::Local::now().format("%Y-%m-%d").to_string();
    let from = (chrono::Local::now() - chrono::Duration::days(30)).format("%Y-%m-%d").to_string();
    let cfg = config.get();
    for connection in &cfg.connections {
        let keys: Vec<String> =
            cfg.projects.iter().flat_map(|p| &p.targets).filter(|t| t.connection_id == connection.id).map(|t| t.jira_project_key.clone()).collect();
        let account = connections.account_id(&connection.id).await;
        let found = match &account {
            Ok(account) => connections.jira(&connection.id).get_my_activity_in(account, &keys, &from, &to).await.map(|a| a.len()),
            Err(e) => Err(e.clone()),
        };
        println!("{} keys {:?} account ok {} -> {:?}", connection.name, keys, account.is_ok(), found.map_err(|e| format!("{}: {:?}", e.message, e.details)));
    }
}
