//! Domain model shared with the renderer. Mirrors `src/shared/domain.ts`; field
//! names are camelCase on the wire so the renderer sees exactly the same shapes.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// ---------- Configuration ----------

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct JiraConfig {
    pub base_url: String,
    pub email: String,
    pub api_token: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TempoConfig {
    pub api_token: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct JiraConnection {
    pub id: String,
    pub name: String,
    pub jira: JiraConfig,
    pub tempo: TempoConfig,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OpenAiConfig {
    pub api_key: String,
    pub model: String,
    pub base_url: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LlmConfig {
    pub backend: String,
    pub open_ai: OpenAiConfig,
    pub claude_cli_path: String,
    pub claude_model: String,
    pub copilot_cli_path: String,
    pub copilot_model: String,
    pub additional_instructions: String,
    pub enable_thinking: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GitFolder {
    pub path: String,
    pub label: String,
    pub author: String,
    pub include_all_authors: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectTarget {
    pub id: String,
    pub connection_id: String,
    pub jira_project_key: String,
    pub instruction: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectConfig {
    pub id: String,
    pub name: String,
    pub targets: Vec<ProjectTarget>,
    pub git_folders: Vec<GitFolder>,
    pub color: String,
    pub archived: bool,
}

pub const PROJECT_COLOR_PALETTE: [&str; 8] =
    ["#6d9eff", "#4fd28a", "#ffc857", "#ff6b6b", "#b78bff", "#4dd0e1", "#ff9e64", "#f06292"];

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CustomFieldConfig {
    pub id: String,
    pub connection_id: String,
    pub key: String,
    pub label: String,
    /// "string" or "boolean".
    #[serde(rename = "type")]
    pub field_type: String,
    pub auto_fill: bool,
    pub instruction: String,
    pub show_in_calendar: bool,
    pub calendar_icon: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TempoWorkAttribute {
    pub key: String,
    pub name: String,
    #[serde(rename = "type")]
    pub attribute_type: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AutoLoggerConfig {
    pub mode: String,
    pub run_at: String,
    pub launch_at_login: bool,
    pub minimize_to_tray: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoLoggerPrompt {
    pub date: String,
    pub auto_start: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoLoggerRunResult {
    /// "review" or "completed".
    pub kind: String,
    pub created_count: usize,
    pub total_seconds: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IssuePoolConfig {
    pub lookback_days: f64,
    pub max_issues: f64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateConfig {
    pub mode: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TelemetryConfig {
    pub enabled: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReportConfig {
    pub output_directory: String,
    pub filename_template: String,
    pub reminder_offset_days: Option<i64>,
    pub default_grouping: String,
    pub default_layout: String,
    pub default_groupings: Vec<String>,
    pub default_columns: Vec<String>,
    pub default_time_format: String,
    pub default_orientation: String,
    pub include_summary: bool,
    pub accent_color: String,
    pub title: String,
    pub show_generated_at: bool,
    pub show_page_numbers: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectSelection {
    pub project_id: String,
    pub note: String,
    pub use_commits: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LastUsedSelection {
    pub selections: Vec<ProjectSelection>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub connections: Vec<JiraConnection>,
    pub active_connection_ids: Vec<String>,
    pub projects: Vec<ProjectConfig>,
    pub custom_fields: Vec<CustomFieldConfig>,
    pub llm: LlmConfig,
    pub language: String,
    pub theme_id: String,
    pub working_hours_per_day: f64,
    pub workday_start: String,
    pub show_weekends: bool,
    pub issue_pool: IssuePoolConfig,
    pub updates: UpdateConfig,
    pub telemetry: TelemetryConfig,
    pub reports: ReportConfig,
    pub auto_logger: AutoLoggerConfig,
    pub last_used: LastUsedSelection,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub status: String,
    pub current_version: String,
    pub available_version: String,
    pub progress_percent: f64,
    pub release_url: String,
    pub can_auto_update: bool,
    pub error_message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNote {
    pub version: String,
    pub name: String,
    pub notes: String,
    pub url: String,
    pub published_at: String,
    pub prerelease: bool,
}

// ---------- Jira / Tempo ----------

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraProject {
    pub id: String,
    pub key: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssue {
    pub id: String,
    pub key: String,
    pub summary: String,
    pub type_name: String,
    pub is_subtask: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraUser {
    pub account_id: String,
    pub display_name: String,
}

/// A custom field / work attribute value: Tempo stores text or yes/no.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AttrValue {
    Bool(bool),
    Text(String),
}

impl AttrValue {
    pub fn is_truthy(&self) -> bool {
        match self {
            AttrValue::Bool(b) => *b,
            AttrValue::Text(s) => !s.is_empty(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attribute {
    pub key: String,
    pub value: AttrValue,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worklog {
    pub tempo_worklog_id: i64,
    pub issue_id: String,
    pub issue_key: String,
    pub issue_summary: String,
    pub description: String,
    pub time_spent_seconds: i64,
    pub start_date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<String>,
    pub attributes: Vec<Attribute>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewWorklog {
    pub issue_key: String,
    pub description: String,
    pub time_spent_seconds: i64,
    pub start_date: String,
    #[serde(default)]
    pub attributes: Vec<Attribute>,
}

// ---------- Reports ----------

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRequest {
    pub month: String,
    pub connection_ids: Vec<String>,
    pub project_ids: Vec<String>,
    pub layout: String,
    pub filename_template: String,
    pub groupings: Vec<String>,
    pub columns: Vec<String>,
    pub time_format: String,
    pub orientation: String,
    pub include_summary: bool,
    pub accent_color: String,
    pub title: String,
    pub show_generated_at: bool,
    pub show_page_numbers: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportResult {
    pub file_path: String,
    pub entry_count: usize,
    pub total_seconds: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportReminder {
    pub month: Option<String>,
    pub due_date: Option<String>,
}

// ---------- Git ----------

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub hash: String,
    pub date: String,
    pub message: String,
    pub repo_label: String,
}

// ---------- LLM suggestions ----------

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionRequest {
    pub dates: Vec<String>,
    pub selections: Vec<ProjectSelection>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSuggestions {
    pub project_id: String,
    pub project_name: String,
    pub target_id: String,
    pub connection_id: String,
    pub connection_name: String,
    pub jira_project_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub suggestions: Vec<WorklogSuggestion>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorklogSuggestion {
    pub id: String,
    pub date: String,
    pub project_key: String,
    pub issue_key: String,
    pub issue_summary: String,
    pub issue_type_name: String,
    pub issue_is_subtask: bool,
    pub description: String,
    pub hours: f64,
    pub custom_fields: BTreeMap<String, AttrValue>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPreview {
    pub label: String,
    pub prompt: String,
    pub approx_tokens: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegenerateDescriptionRequest {
    pub suggestion: WorklogSuggestion,
    pub hint: String,
    pub free_text: String,
    pub commits: Vec<CommitInfo>,
}
