//! Client for the Tempo Timesheets REST API v4. Tempo identifies issues by
//! numeric Jira id, so the Jira client translates ids <-> keys.

use crate::domain::{AttrValue, Attribute, NewWorklog, TempoConfig, TempoWorkAttribute, Worklog};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::services::jira::{url_encode, JiraApi};
use async_trait::async_trait;
use regex::Regex;
use reqwest::Method;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

const TEMPO_BASE_URL: &str = "https://api.tempo.io/4";

/// Surface of the Tempo client used by the app; implemented by mocks too.
#[async_trait]
pub trait TempoApi: Send + Sync {
    async fn test_connection(&self, account_id: &str) -> AppResult<()>;
    async fn get_worklogs(&self, account_id: &str, from: &str, to: &str) -> AppResult<Vec<Worklog>>;
    async fn create_worklogs(&self, account_id: &str, worklogs: &[NewWorklog]) -> AppResult<Vec<Worklog>>;
    async fn update_worklog(&self, account_id: &str, tempo_worklog_id: i64, worklog: &NewWorklog) -> AppResult<Worklog>;
    async fn delete_worklog(&self, account_id: &str, tempo_worklog_id: i64) -> AppResult<()>;
    async fn get_work_attributes(&self) -> AppResult<Vec<TempoWorkAttribute>>;
}

/// "HH:MM" -> seconds from midnight; falls back to 09:00 when malformed.
pub fn parse_workday_start(value: &str) -> i64 {
    let pattern = Regex::new(r"^(\d{1,2}):(\d{2})$").unwrap();
    match pattern.captures(value.trim()) {
        Some(caps) => {
            let hours: i64 = caps[1].parse::<i64>().unwrap_or(9).min(23);
            let minutes: i64 = caps[2].parse::<i64>().unwrap_or(0).min(59);
            hours * 3600 + minutes * 60
        }
        None => 9 * 3600,
    }
}

/// Seconds-from-midnight -> "HH:MM:SS", clamped to stay within the day.
fn to_start_time(seconds: i64) -> String {
    let s = seconds.min(23 * 3600 + 59 * 60);
    format!("{:02}:{:02}:{:02}", s / 3600, (s % 3600) / 60, s % 60)
}

fn to_attributes(dto: &Value) -> Vec<Attribute> {
    dto["attributes"]["values"]
        .as_array()
        .map(|values| {
            values
                .iter()
                .map(|a| Attribute {
                    key: a["key"].as_str().unwrap_or_default().to_string(),
                    value: match &a["value"] {
                        Value::Bool(b) => AttrValue::Bool(*b),
                        Value::Null => AttrValue::Text(String::new()),
                        Value::String(s) => AttrValue::Text(s.clone()),
                        other => AttrValue::Text(other.to_string()),
                    },
                })
                .collect()
        })
        .unwrap_or_default()
}

fn issue_id_of(dto: &Value) -> String {
    match &dto["issue"]["id"] {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        _ => String::new(),
    }
}

pub type TempoConfigSource = Arc<dyn Fn() -> AppResult<TempoConfig> + Send + Sync>;

pub struct TempoClient {
    config: TempoConfigSource,
    jira: Arc<dyn JiraApi>,
    /// Configured start of the workday, in seconds from midnight.
    workday_start: Arc<dyn Fn() -> i64 + Send + Sync>,
    http: reqwest::Client,
}

impl TempoClient {
    pub fn new(
        config: TempoConfigSource,
        jira: Arc<dyn JiraApi>,
        workday_start: Arc<dyn Fn() -> i64 + Send + Sync>,
        http: reqwest::Client,
    ) -> Self {
        Self { config, jira, workday_start, http }
    }

    async fn request(&self, url: &str, method: Method, body: Option<Value>) -> AppResult<Value> {
        let token = (self.config)()?.api_token;
        if token.is_empty() {
            return Err(AppError::new(ErrorCode::ConfigInvalid, "Tempo API token is not configured"));
        }
        let mut request = self
            .http
            .request(method, url)
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/json");
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .await
            .map_err(|e| AppError::with_details(ErrorCode::TempoUnreachable, "Cannot reach Tempo", e.to_string()))?;
        let status = response.status().as_u16();
        if status == 401 || status == 403 {
            return Err(AppError::new(ErrorCode::TempoAuth, "Tempo rejected the API token"));
        }
        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(AppError::with_details(ErrorCode::TempoUnreachable, format!("Tempo returned HTTP {status}"), text));
        }
        // DELETE (and some PUTs) answer 204 with no body.
        let text = response.text().await.unwrap_or_default();
        if text.is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text)
            .map_err(|e| AppError::with_details(ErrorCode::TempoUnreachable, "Tempo sent an unreadable response", e.to_string()))
    }

    /// Start-of-day offsets per date: workday start plus whatever is already
    /// logged that day, so new entries continue after existing ones.
    async fn initial_start_offsets(&self, account_id: &str, worklogs: &[NewWorklog]) -> HashMap<String, i64> {
        let mut offsets = HashMap::new();
        let dates: BTreeSet<String> = worklogs.iter().map(|w| w.start_date.clone()).collect();
        let (Some(first), Some(last)) = (dates.first(), dates.last()) else { return offsets };
        let mut logged: HashMap<String, i64> = HashMap::new();
        // Best-effort: on failure entries simply start at the workday start.
        if let Ok(existing) = self.get_worklogs(account_id, first, last).await {
            for w in existing {
                *logged.entry(w.start_date).or_default() += w.time_spent_seconds;
            }
        }
        for date in dates {
            let already = logged.get(&date).copied().unwrap_or(0);
            offsets.insert(date, (self.workday_start)() + already);
        }
        offsets
    }
}

#[async_trait]
impl TempoApi for TempoClient {
    /// Cheapest call that proves the token works: one worklog page of size 1.
    async fn test_connection(&self, account_id: &str) -> AppResult<()> {
        let today = chrono::Utc::now().format("%Y-%m-%d");
        let url = format!("{TEMPO_BASE_URL}/worklogs/user/{}?from={today}&to={today}&limit=1", url_encode(account_id));
        self.request(&url, Method::GET, None).await.map(|_| ())
    }

    async fn get_worklogs(&self, account_id: &str, from: &str, to: &str) -> AppResult<Vec<Worklog>> {
        let mut dtos: Vec<Value> = Vec::new();
        let mut url = Some(format!("{TEMPO_BASE_URL}/worklogs/user/{}?from={from}&to={to}&limit=200", url_encode(account_id)));
        while let Some(current) = url {
            let page = self.request(&current, Method::GET, None).await?;
            dtos.extend(page["results"].as_array().cloned().unwrap_or_default());
            url = page["metadata"]["next"].as_str().map(String::from);
        }
        let ids: Vec<String> = dtos.iter().map(issue_id_of).collect();
        let issues = self.jira.get_issues_by_ids(&ids).await?;
        let by_id: HashMap<String, _> = issues.into_iter().map(|i| (i.id.clone(), i)).collect();
        Ok(dtos
            .iter()
            .map(|d| {
                let issue_id = issue_id_of(d);
                let issue = by_id.get(&issue_id);
                Worklog {
                    tempo_worklog_id: d["tempoWorklogId"].as_i64().unwrap_or_default(),
                    issue_key: issue.map(|i| i.key.clone()).unwrap_or_else(|| format!("#{issue_id}")),
                    issue_summary: issue.map(|i| i.summary.clone()).unwrap_or_default(),
                    issue_id,
                    description: d["description"].as_str().unwrap_or_default().to_string(),
                    time_spent_seconds: d["timeSpentSeconds"].as_i64().unwrap_or_default(),
                    start_date: d["startDate"].as_str().unwrap_or_default().to_string(),
                    start_time: d["startTime"].as_str().map(String::from),
                    attributes: to_attributes(d),
                }
            })
            .collect())
    }

    async fn create_worklogs(&self, account_id: &str, worklogs: &[NewWorklog]) -> AppResult<Vec<Worklog>> {
        let mut created = Vec::new();
        // Entries of one day are laid out back-to-back instead of all starting
        // at the same hour; days with existing worklogs continue after them.
        let mut offsets = self.initial_start_offsets(account_id, worklogs).await;
        for worklog in worklogs {
            let offset = offsets.get(&worklog.start_date).copied().unwrap_or_else(|| (self.workday_start)());
            offsets.insert(worklog.start_date.clone(), offset + worklog.time_spent_seconds);

            let issue = self.jira.get_issue(&worklog.issue_key).await?;
            let mut body = json!({
                "issueId": issue.id.parse::<i64>().unwrap_or_default(),
                "timeSpentSeconds": worklog.time_spent_seconds,
                "startDate": worklog.start_date,
                "startTime": to_start_time(offset),
                "description": worklog.description,
                "authorAccountId": account_id,
            });
            if !worklog.attributes.is_empty() {
                body["attributes"] = json!(worklog.attributes);
            }
            let dto = self.request(&format!("{TEMPO_BASE_URL}/worklogs"), Method::POST, Some(body)).await?;
            created.push(Worklog {
                tempo_worklog_id: dto["tempoWorklogId"].as_i64().unwrap_or_default(),
                issue_id: issue.id.clone(),
                issue_key: issue.key.clone(),
                issue_summary: issue.summary.clone(),
                description: dto["description"].as_str().map(String::from).unwrap_or_else(|| worklog.description.clone()),
                time_spent_seconds: dto["timeSpentSeconds"].as_i64().unwrap_or(worklog.time_spent_seconds),
                start_date: dto["startDate"].as_str().map(String::from).unwrap_or_else(|| worklog.start_date.clone()),
                start_time: None,
                attributes: to_attributes(&dto),
            });
        }
        Ok(created)
    }

    /// Overwrites an existing worklog, keeping its position within the day.
    async fn update_worklog(&self, account_id: &str, tempo_worklog_id: i64, worklog: &NewWorklog) -> AppResult<Worklog> {
        let issue = self.jira.get_issue(&worklog.issue_key).await?;
        // The v4 API has no partial update: PUT replaces the whole worklog, so
        // the existing start time is preserved instead of moving the entry.
        let url = format!("{TEMPO_BASE_URL}/worklogs/{tempo_worklog_id}");
        let mut start_time = to_start_time((self.workday_start)());
        if let Ok(existing) = self.request(&url, Method::GET, None).await {
            if let Some(time) = existing["startTime"].as_str() {
                start_time = time.to_string();
            }
        }
        let body = json!({
            "issueId": issue.id.parse::<i64>().unwrap_or_default(),
            "timeSpentSeconds": worklog.time_spent_seconds,
            "startDate": worklog.start_date,
            "startTime": start_time,
            "description": worklog.description,
            "authorAccountId": account_id,
            // Always sent so cleared fields are dropped (PUT replaces attributes).
            "attributes": worklog.attributes,
        });
        let dto = self.request(&url, Method::PUT, Some(body)).await?;
        Ok(Worklog {
            tempo_worklog_id: dto["tempoWorklogId"].as_i64().unwrap_or(tempo_worklog_id),
            issue_id: issue.id,
            issue_key: issue.key,
            issue_summary: issue.summary,
            description: dto["description"].as_str().map(String::from).unwrap_or_else(|| worklog.description.clone()),
            time_spent_seconds: dto["timeSpentSeconds"].as_i64().unwrap_or(worklog.time_spent_seconds),
            start_date: dto["startDate"].as_str().map(String::from).unwrap_or_else(|| worklog.start_date.clone()),
            start_time: None,
            attributes: to_attributes(&dto),
        })
    }

    async fn delete_worklog(&self, _account_id: &str, tempo_worklog_id: i64) -> AppResult<()> {
        self.request(&format!("{TEMPO_BASE_URL}/worklogs/{tempo_worklog_id}"), Method::DELETE, None).await.map(|_| ())
    }

    /// Custom worklog fields defined in this Tempo instance.
    async fn get_work_attributes(&self) -> AppResult<Vec<TempoWorkAttribute>> {
        let page = self.request(&format!("{TEMPO_BASE_URL}/work-attributes"), Method::GET, None).await?;
        Ok(page["results"]
            .as_array()
            .map(|results| {
                results
                    .iter()
                    .map(|a| TempoWorkAttribute {
                        key: a["key"].as_str().unwrap_or_default().to_string(),
                        name: a["name"].as_str().unwrap_or_default().to_string(),
                        attribute_type: a["type"].as_str().unwrap_or_default().to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default())
    }
}
