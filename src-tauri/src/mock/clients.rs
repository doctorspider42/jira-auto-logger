//! In-memory Jira, Tempo and git for mock mode. Port of
//! `src/main/services/mock/clients.ts`.

use super::data::{generate_worklogs, mock_issues, mulberry32, projects_by_connection, work_attributes};
use crate::domain::{CommitInfo, CreateIssueRequest, JiraIssue, JiraIssueType, JiraProject, JiraUser, NewWorklog, TempoWorkAttribute, Worklog};
use crate::error::{AppError, AppResult};
use crate::services::git::{folder_label, CommitSource};
use crate::services::jira::{default_issue_type, JiraApi};
use crate::services::tempo::TempoApi;
use async_trait::async_trait;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

async fn sleep(ms: u64) {
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

/// Issues created during the session, per connection; they live as long as
/// the app, like the worklogs mock Tempo keeps.
fn created_issues() -> &'static Mutex<Vec<(String, JiraIssue)>> {
    static CREATED: OnceLock<Mutex<Vec<(String, JiraIssue)>>> = OnceLock::new();
    CREATED.get_or_init(|| Mutex::new(Vec::new()))
}

/// The static issues of a project plus the ones created in it, newest first.
fn project_issues(connection_id: &str, project_key: &str) -> Vec<JiraIssue> {
    let prefix = format!("{project_key}-");
    let mut issues: Vec<JiraIssue> = created_issues()
        .lock()
        .unwrap()
        .iter()
        .filter(|(c, i)| c == connection_id && i.key.starts_with(&prefix))
        .map(|(_, i)| i.clone())
        .collect();
    issues.reverse();
    issues.extend(mock_issues(project_key));
    issues
}

fn connection_issues(connection_id: &str) -> Vec<JiraIssue> {
    projects_by_connection(connection_id).iter().flat_map(|(key, _)| project_issues(connection_id, key)).collect()
}

fn mock_issue_types() -> Vec<JiraIssueType> {
    [("10001", "Task", false), ("10002", "Bug", false), ("10003", "Story", false), ("10004", "Sub-task", true)]
        .iter()
        .map(|(id, name, subtask)| JiraIssueType { id: id.to_string(), name: name.to_string(), subtask: *subtask })
        .collect()
}

/// In-memory Jira backed by the static mock data of one connection.
pub struct MockJira {
    connection_id: String,
}

#[async_trait]
impl JiraApi for MockJira {
    async fn get_myself(&self) -> AppResult<JiraUser> {
        Ok(JiraUser { account_id: format!("mock-account-{}", self.connection_id), display_name: "Alex Developer".into() })
    }

    async fn get_projects(&self) -> AppResult<Vec<JiraProject>> {
        Ok(projects_by_connection(&self.connection_id)
            .iter()
            .enumerate()
            .map(|(i, (key, name))| JiraProject { id: format!("mock-{}-{i}", self.connection_id), key: key.to_string(), name: name.to_string() })
            .collect())
    }

    async fn search_issues(&self, query: &str, project_keys: &[String]) -> AppResult<Vec<JiraIssue>> {
        let needle = query.trim().to_lowercase();
        Ok(connection_issues(&self.connection_id)
            .into_iter()
            .filter(|i| project_keys.is_empty() || project_keys.iter().any(|k| i.key.starts_with(&format!("{k}-"))))
            .filter(|i| needle.is_empty() || format!("{} {}", i.key, i.summary).to_lowercase().contains(&needle))
            .take(30)
            .collect())
    }

    async fn get_project_issues(&self, project_key: &str) -> AppResult<Vec<JiraIssue>> {
        Ok(project_issues(&self.connection_id, project_key))
    }

    async fn get_recent_issues(&self, project_keys: &[String], _lookback: f64, _max: f64) -> AppResult<Vec<JiraIssue>> {
        Ok(project_keys.iter().flat_map(|k| project_issues(&self.connection_id, k)).collect())
    }

    async fn get_issue_types(&self, _project_key: &str) -> AppResult<Vec<JiraIssueType>> {
        Ok(mock_issue_types())
    }

    async fn create_issue(&self, request: &CreateIssueRequest) -> AppResult<JiraIssue> {
        sleep(400).await;
        let types = mock_issue_types();
        let issue_type = types
            .iter()
            .find(|t| t.id == request.issue_type_id)
            .or_else(|| default_issue_type(&types))
            .cloned()
            .expect("mock types include Task");
        let next = project_issues(&self.connection_id, &request.project_key)
            .iter()
            .filter_map(|i| i.key.rsplit('-').next()?.parse::<u32>().ok())
            .max()
            .unwrap_or(0)
            + 1;
        let issue = JiraIssue {
            id: format!("mock-new-{}-{next}", request.project_key),
            key: format!("{}-{next}", request.project_key),
            summary: request.summary.trim().to_string(),
            type_name: issue_type.name,
            is_subtask: issue_type.subtask,
        };
        created_issues().lock().unwrap().push((self.connection_id.clone(), issue.clone()));
        Ok(issue)
    }

    async fn get_issue(&self, key: &str) -> AppResult<JiraIssue> {
        connection_issues(&self.connection_id)
            .into_iter()
            .find(|i| i.key == key)
            .ok_or_else(|| AppError::unknown(format!("Mock issue not found: {key}")))
    }

    async fn get_issues_by_ids(&self, ids: &[String]) -> AppResult<Vec<JiraIssue>> {
        let wanted: HashSet<&String> = ids.iter().collect();
        Ok(connection_issues(&self.connection_id).into_iter().filter(|i| wanted.contains(&i.id)).collect())
    }
}

/// In-memory Tempo: generated history + entries created during the session.
pub struct MockTempo {
    connection_id: String,
    history: Mutex<Vec<Worklog>>,
    next_id: Mutex<i64>,
}

impl MockTempo {
    fn issue_for(&self, key: &str) -> Option<JiraIssue> {
        connection_issues(&self.connection_id).into_iter().find(|i| i.key == key)
    }
}

#[async_trait]
impl TempoApi for MockTempo {
    async fn test_connection(&self, _account_id: &str) -> AppResult<()> {
        sleep(300).await;
        Ok(())
    }

    async fn get_worklogs(&self, _account_id: &str, from: &str, to: &str) -> AppResult<Vec<Worklog>> {
        sleep(150).await;
        Ok(self.history.lock().unwrap().iter().filter(|w| w.start_date.as_str() >= from && w.start_date.as_str() <= to).cloned().collect())
    }

    async fn create_worklogs(&self, _account_id: &str, worklogs: &[NewWorklog]) -> AppResult<Vec<Worklog>> {
        sleep(400).await;
        let created: Vec<Worklog> = worklogs
            .iter()
            .map(|w| {
                let issue = self.issue_for(&w.issue_key);
                let mut next = self.next_id.lock().unwrap();
                *next += 1;
                Worklog {
                    tempo_worklog_id: *next - 1,
                    issue_id: issue.as_ref().map(|i| i.id.clone()).unwrap_or_else(|| "0".into()),
                    issue_key: w.issue_key.clone(),
                    issue_summary: issue.map(|i| i.summary).unwrap_or_default(),
                    description: w.description.clone(),
                    time_spent_seconds: w.time_spent_seconds,
                    start_date: w.start_date.clone(),
                    start_time: None,
                    attributes: w.attributes.clone(),
                }
            })
            .collect();
        self.history.lock().unwrap().extend(created.clone());
        Ok(created)
    }

    async fn update_worklog(&self, _account_id: &str, tempo_worklog_id: i64, worklog: &NewWorklog) -> AppResult<Worklog> {
        sleep(300).await;
        let issue = self.issue_for(&worklog.issue_key);
        let mut history = self.history.lock().unwrap();
        let index = history.iter().position(|w| w.tempo_worklog_id == tempo_worklog_id);
        let updated = Worklog {
            tempo_worklog_id,
            issue_id: issue
                .as_ref()
                .map(|i| i.id.clone())
                .or_else(|| index.map(|i| history[i].issue_id.clone()))
                .unwrap_or_else(|| "0".into()),
            issue_key: worklog.issue_key.clone(),
            issue_summary: issue.map(|i| i.summary).unwrap_or_default(),
            description: worklog.description.clone(),
            time_spent_seconds: worklog.time_spent_seconds,
            start_date: worklog.start_date.clone(),
            start_time: None,
            attributes: worklog.attributes.clone(),
        };
        match index {
            Some(i) => history[i] = updated.clone(),
            None => history.push(updated.clone()),
        }
        Ok(updated)
    }

    async fn delete_worklog(&self, _account_id: &str, tempo_worklog_id: i64) -> AppResult<()> {
        sleep(200).await;
        self.history.lock().unwrap().retain(|w| w.tempo_worklog_id != tempo_worklog_id);
        Ok(())
    }

    async fn get_work_attributes(&self) -> AppResult<Vec<TempoWorkAttribute>> {
        sleep(200).await;
        Ok(work_attributes(&self.connection_id))
    }
}

/// Singletons per connection so created worklogs survive within the session.
pub fn mock_jira(connection_id: &str) -> Arc<dyn JiraApi> {
    Arc::new(MockJira { connection_id: connection_id.to_string() })
}

pub fn mock_tempo(connection_id: &str) -> Arc<dyn TempoApi> {
    static TEMPOS: OnceLock<Mutex<HashMap<String, Arc<MockTempo>>>> = OnceLock::new();
    let mut map = TEMPOS.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap();
    map.entry(connection_id.to_string())
        .or_insert_with(|| {
            Arc::new(MockTempo {
                connection_id: connection_id.to_string(),
                history: Mutex::new(generate_worklogs(connection_id)),
                next_id: Mutex::new(999_000),
            })
        })
        .clone()
}

fn commit_messages(label: &str) -> &'static [&'static str] {
    match label {
        "shop-frontend" => &[
            "SHOP-201 BLIK payment confirmation screen",
            "SHOP-202 fix rounding for mixed VAT carts",
            "SHOP-204 discount codes: expiry validation",
            "refactor product gallery grid",
        ],
        "shop-backend" => &[
            "SHOP-201 BLIK payment webhook handling",
            "SHOP-204 discount codes: persistence layer",
            "fix: race condition in order status updates",
            "chore: upgrade payment SDK",
        ],
        _ => &[
            "APP-101: biometric login happy path",
            "APP-101: handle lockout after failed attempts",
            "APP-102 fix camera crash on Android 15",
            "APP-104 move session storage to encrypted prefs",
            "chore: bump dependencies",
        ],
    }
}

/// Fake commit history keyed by folder name.
pub struct MockGit;

#[async_trait]
impl CommitSource for MockGit {
    async fn get_commits(&self, folder_paths: &[String], dates: &[String]) -> AppResult<Vec<CommitInfo>> {
        let mut commits = Vec::new();
        for path in folder_paths {
            let label = folder_label(path);
            let messages = commit_messages(&label);
            let mut random = mulberry32(label.chars().count() as u32 * 1000);
            for date in dates {
                let count = 2 + (random() * 3.0).floor() as usize;
                for i in 0..count {
                    let message = messages[((random() * messages.len() as f64).floor() as usize).min(messages.len() - 1)];
                    commits.push(CommitInfo {
                        hash: format!("{}{i}mock", date.replace('-', "")),
                        date: format!("{date}T{:02}:15:00+01:00", 9 + i * 2),
                        message: message.to_string(),
                        repo_label: label.clone(),
                    });
                }
            }
        }
        Ok(commits)
    }
}
