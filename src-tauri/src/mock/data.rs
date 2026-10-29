//! Deterministic fake data for mock mode (`--mock`, `JAL_MOCK=1`): two Jira
//! connections, three projects, issues, six weeks of Tempo history and work
//! attributes. Everything lives in memory; nothing is persisted or sent.
//! Port of `src/main/services/mock/data.ts`.

use crate::domain::{AppConfig, AttrValue, Attribute, JiraIssue, TempoWorkAttribute, Worklog};
use chrono::{Datelike, Duration, Local, Weekday};
use serde_json::json;

pub const CONN_MAIN: &str = "mock-conn-acme";
pub const CONN_CLIENT: &str = "mock-conn-client";

/// Seeded PRNG so mock data (and screenshots) are reproducible. Same output
/// as the TypeScript `mulberry32`.
pub fn mulberry32(seed: u32) -> impl FnMut() -> f64 {
    let mut a = seed as i32;
    move || {
        a = a.wrapping_add(0x6d2b79f5u32 as i32);
        let mut t = ((a ^ ((a as u32) >> 15) as i32) as i32).wrapping_mul(1 | a);
        t = (t.wrapping_add((t ^ ((t as u32) >> 7) as i32).wrapping_mul(61 | t))) ^ t;
        ((t ^ ((t as u32) >> 14) as i32) as u32) as f64 / 4294967296.0
    }
}

pub fn mock_config() -> AppConfig {
    let value = json!({
        "connections": [
            { "id": CONN_MAIN, "name": "Acme (company)",
              "jira": { "baseUrl": "https://acme.atlassian.net", "email": "dev@acme.dev", "apiToken": "mock" },
              "tempo": { "apiToken": "mock" } },
            { "id": CONN_CLIENT, "name": "Client X",
              "jira": { "baseUrl": "https://clientx.atlassian.net", "email": "dev@acme.dev", "apiToken": "mock" },
              "tempo": { "apiToken": "mock" } }
        ],
        "activeConnectionIds": [CONN_MAIN, CONN_CLIENT],
        "projects": [
            { "id": "mock-project-app", "name": "Mobile App",
              "targets": [{ "id": "mock-target-app", "connectionId": CONN_MAIN, "jiraProjectKey": "APP",
                            "instruction": "Prefer logging to stories over the epic." }],
              "gitFolders": [{ "path": "C:\\dev\\mobile-app", "label": "mobile-app", "author": "dev@acme.dev", "includeAllAuthors": false }],
              "color": "#6d9eff", "archived": false },
            { "id": "mock-project-int", "name": "Internal Tools",
              "targets": [{ "id": "mock-target-int", "connectionId": CONN_MAIN, "jiraProjectKey": "INT", "instruction": "" }],
              "gitFolders": [], "color": "#ffc857", "archived": false },
            // Multi-target and multi-repo: client work is logged in the client's
            // Jira (SHOP) AND mirrored in the company Jira (CLX).
            { "id": "mock-project-shop", "name": "Client X Shop",
              "targets": [
                  { "id": "mock-target-shop", "connectionId": CONN_CLIENT, "jiraProjectKey": "SHOP",
                    "instruction": "Descriptions must be client-friendly, no internal jargon." },
                  { "id": "mock-target-clx", "connectionId": CONN_MAIN, "jiraProjectKey": "CLX",
                    "instruction": "Short internal notes are fine; name the client ticket when there is one." }
              ],
              "gitFolders": [
                  { "path": "C:\\dev\\shop-frontend", "label": "shop-frontend", "author": "dev@acme.dev", "includeAllAuthors": false },
                  { "path": "C:\\dev\\shop-backend", "label": "shop-backend", "author": "dev@acme.dev", "includeAllAuthors": false }
              ],
              "color": "#4fd28a", "archived": false }
        ],
        "customFields": [
            { "id": "mock-field-overtime", "connectionId": CONN_MAIN, "key": "_Overtime_", "label": "Overtime",
              "type": "boolean", "autoFill": true, "instruction": "Set only when the notes explicitly mention overtime.",
              "showInCalendar": true, "calendarIcon": "🔥" },
            { "id": "mock-field-remote", "connectionId": CONN_CLIENT, "key": "_Remote_", "label": "Remote work",
              "type": "boolean", "autoFill": true, "instruction": "", "showInCalendar": true, "calendarIcon": "🏠" }
        ],
        "llm": {
            "backend": "claude-cli",
            "openAi": { "apiKey": "", "model": "gpt-4o-mini", "baseUrl": "" },
            "claudeCliPath": "claude", "claudeModel": "", "copilotCliPath": "copilot", "copilotModel": "",
            "additionalInstructions": "", "enableThinking": true
        },
        "language": "en",
        "themeId": "dark",
        "workingHoursPerDay": 8,
        "workdayStart": "09:00",
        "showWeekends": true,
        "issuePool": { "lookbackDays": 60, "maxIssues": 100 },
        "updates": { "mode": "ask" },
        "reports": {
            "outputDirectory": "", "filenameTemplate": "{MM}.{YYYY}.pdf", "reminderOffsetDays": 0,
            "defaultGrouping": "project", "defaultLayout": "summary",
            "defaultGroupings": ["custom:mock-field-overtime", "project", "issue"],
            "defaultColumns": ["date", "issue", "description", "connection"],
            "defaultTimeFormat": "hours", "defaultOrientation": "portrait", "includeSummary": false,
            "accentColor": "#172b4d", "title": "", "showGeneratedAt": true, "showPageNumbers": true
        },
        // Mock mode never phones home regardless; keep it explicitly off.
        "telemetry": { "enabled": false },
        "autoLogger": { "mode": "off", "runAt": "17:00", "launchAtLogin": false, "minimizeToTray": false },
        "lastUsed": { "selections": [] }
    });
    serde_json::from_value(value).expect("mock config is valid")
}

fn issue(id: u32, key: &str, summary: &str, type_name: &str, is_subtask: bool) -> JiraIssue {
    JiraIssue { id: id.to_string(), key: key.into(), summary: summary.into(), type_name: type_name.into(), is_subtask }
}

pub fn mock_issues(project_key: &str) -> Vec<JiraIssue> {
    match project_key {
        "APP" => vec![
            issue(10101, "APP-101", "Implement biometric login", "Story", false),
            issue(10102, "APP-102", "Crash on Android 15 when opening camera", "Bug", false),
            issue(10103, "APP-103", "Push notification settings screen", "Story", false),
            issue(10104, "APP-104", "Refactor session storage", "Task", false),
            issue(10105, "APP-105", "Migrate to SDK 52", "Epic", false),
            issue(10106, "APP-106", "Write UI tests for the login flow", "Sub-task", true),
            issue(10107, "APP-107", "Dark mode for the paywall screens", "Story", false),
        ],
        "INT" => vec![
            issue(10201, "INT-11", "Quarterly access review automation", "Task", false),
            issue(10202, "INT-12", "Flaky tests in the CI pipeline", "Bug", false),
            issue(10203, "INT-13", "Onboarding checklist app", "Story", false),
        ],
        "CLX" => vec![
            issue(10401, "CLX-1", "Client X — development", "Task", false),
            issue(10402, "CLX-2", "Client X — meetings and support", "Task", false),
            issue(10403, "CLX-3", "Client X — code review", "Task", false),
        ],
        "SHOP" => vec![
            issue(10301, "SHOP-201", "Checkout: BLIK payments", "Story", false),
            issue(10302, "SHOP-202", "Cart total rounding bug", "Bug", false),
            issue(10303, "SHOP-203", "Product page redesign", "Epic", false),
            issue(10304, "SHOP-204", "Discount codes service", "Story", false),
            issue(10305, "SHOP-205", "Update GDPR consent banner", "Task", false),
        ],
        _ => Vec::new(),
    }
}

pub fn projects_by_connection(connection_id: &str) -> Vec<(&'static str, &'static str)> {
    match connection_id {
        CONN_MAIN => vec![("APP", "Mobile App"), ("INT", "Internal Tools"), ("CLX", "Client X (internal mirror)"), ("HR", "HR Requests")],
        CONN_CLIENT => vec![("SHOP", "Client X Shop"), ("CRM", "Client X CRM")],
        _ => Vec::new(),
    }
}

pub fn work_attributes(connection_id: &str) -> Vec<TempoWorkAttribute> {
    let attr = |key: &str, name: &str, t: &str| TempoWorkAttribute { key: key.into(), name: name.into(), attribute_type: t.into() };
    match connection_id {
        CONN_MAIN => vec![attr("_Overtime_", "Overtime", "CHECKBOX"), attr("_OnCall_", "On call", "CHECKBOX"), attr("_Notes_", "Billing notes", "INPUT_FIELD")],
        CONN_CLIENT => vec![attr("_Remote_", "Remote work", "CHECKBOX"), attr("_Phase_", "Project phase", "INPUT_FIELD")],
        _ => Vec::new(),
    }
}

fn descriptions(project_key: &str) -> &'static [&'static str] {
    match project_key {
        "APP" => &[
            "Implemented the biometric login flow and error states",
            "Fixed the camera crash reported on Android 15",
            "Built the notification settings screen",
            "Refactored session storage to encrypted preferences",
            "Reviewed pull requests and updated UI tests",
        ],
        "INT" => &[
            "Automated the quarterly access review export",
            "Stabilized flaky integration tests in CI",
            "Prepared the onboarding checklist data model",
        ],
        "CLX" => &[
            "Client X: checkout and payments development",
            "Client X: sync meeting and code review",
            "Client X: bugfixing on the shop frontend",
        ],
        _ => &[
            "Integrated BLIK payment confirmation in checkout",
            "Fixed rounding of cart totals for mixed VAT rates",
            "Implemented the redesigned product gallery",
            "Extended the discount codes service with expiry rules",
            "Updated the GDPR consent banner texts",
        ],
    }
}

fn pick<T: Clone>(items: &[T], random: &mut impl FnMut() -> f64) -> T {
    items[((random() * items.len() as f64).floor() as usize).min(items.len() - 1)].clone()
}

/// Six weeks of plausible weekday history for one connection.
pub fn generate_worklogs(connection_id: &str) -> Vec<Worklog> {
    let main = connection_id == CONN_MAIN;
    let project_keys: &[&str] = if main { &["APP", "INT", "CLX"] } else { &["SHOP"] };
    let mut random = mulberry32(if main { 1337 } else { 4242 });
    let mut worklogs = Vec::new();
    let mut id: i64 = if main { 90_000 } else { 95_000 };
    let today = Local::now().date_naive();
    for days_back in 1..=42 {
        let day = today - Duration::days(days_back);
        if matches!(day.weekday(), Weekday::Sat | Weekday::Sun) {
            continue;
        }
        // The client project is worked on ~3 days a week.
        if !main && random() < 0.4 {
            continue;
        }
        let splits: &[i64] = if random() < 0.6 { &[5, 3] } else { &[8] };
        // Entries of a day sit back-to-back starting at 09:00, like Tempo lays them.
        let mut offset = 9 * 3600;
        for hours in splits {
            let key = pick(project_keys, &mut random);
            let picked = pick(&mock_issues(key), &mut random);
            let text = pick(descriptions(key), &mut random);
            let overtime = random() < 0.15;
            let attributes = if main {
                vec![Attribute { key: "_Overtime_".into(), value: AttrValue::Bool(overtime) }]
            } else {
                vec![Attribute { key: "_Remote_".into(), value: AttrValue::Bool(random() < 0.5) }]
            };
            worklogs.push(Worklog {
                tempo_worklog_id: id,
                issue_id: picked.id,
                issue_key: picked.key,
                issue_summary: picked.summary,
                description: text.to_string(),
                time_spent_seconds: hours * 3600,
                start_date: day.format("%Y-%m-%d").to_string(),
                start_time: Some(format!("{:02}:00:00", offset / 3600)),
                attributes,
            });
            id += 1;
            offset += hours * 3600;
        }
    }
    worklogs
}
