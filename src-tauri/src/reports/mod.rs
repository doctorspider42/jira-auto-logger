//! PDF timesheet reports and the end-of-month reminder. Port of
//! `ReportService.ts`: the report is HTML printed to PDF by the system
//! webview (see `pdf`), so it looks exactly as it did in Electron.

mod html;
mod pdf;

use crate::config::ConfigService;
use crate::domain::*;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::report_filename::{format_filename, validate_template};
use crate::services::connections::ConnectionManager;
use chrono::{Datelike, Duration, Local, NaiveDate};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub(crate) struct ReportEntry {
    pub worklog: Worklog,
    pub connection: JiraConnection,
    pub project_id: String,
    pub jira_project_name: String,
    pub jira_project_key: String,
}

pub(crate) struct MonthRange {
    pub from_date: String,
    pub to_date: String,
}

const BASE_GROUPINGS: [&str; 5] = ["project", "issue", "day", "connection", "worklog"];
const BASE_COLUMNS: [&str; 5] = ["date", "project", "issue", "description", "connection"];

fn last_day_of_month(year: i32, month: u32) -> NaiveDate {
    let (y, m) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    NaiveDate::from_ymd_opt(y, m, 1).unwrap() - Duration::days(1)
}

fn parse_month(month: &str) -> AppResult<(MonthRange, i32, u32)> {
    let invalid = || AppError::new(ErrorCode::ConfigInvalid, "Report month must use yyyy-MM.");
    let (year, number) = month.split_once('-').ok_or_else(invalid)?;
    let (year, number): (i32, u32) = (year.parse().map_err(|_| invalid())?, number.parse().map_err(|_| invalid())?);
    if month.len() != 7 || !(1..=12).contains(&number) {
        return Err(AppError::new(ErrorCode::ConfigInvalid, "Report month is outside the valid range."));
    }
    let to = last_day_of_month(year, number);
    Ok((MonthRange { from_date: format!("{month}-01"), to_date: to.format("%Y-%m-%d").to_string() }, year, number))
}

fn default_output_directory() -> PathBuf {
    dirs::document_dir().unwrap_or_else(std::env::temp_dir).join("Jira Auto Logger Reports")
}

pub struct ReportService {
    config: Arc<ConfigService>,
    connections: Arc<ConnectionManager>,
}

impl ReportService {
    pub fn new(config: Arc<ConfigService>, connections: Arc<ConnectionManager>) -> Self {
        Self { config, connections }
    }

    fn output_directory(&self) -> PathBuf {
        let configured = self.config.get().reports.output_directory;
        if configured.trim().is_empty() { default_output_directory() } else { PathBuf::from(configured.trim()) }
    }

    pub async fn generate(&self, app: &tauri::AppHandle, request: ReportRequest) -> AppResult<ReportResult> {
        let (range, _, _) = parse_month(&request.month)?;
        let config = self.config.get();
        validate_request(&request, &config)?;

        let ids: Vec<String> = if !request.connection_ids.is_empty() {
            request.connection_ids.clone()
        } else if !config.active_connection_ids.is_empty() {
            config.active_connection_ids.clone()
        } else {
            config.connections.iter().map(|c| c.id.clone()).collect()
        };
        let mut unique: Vec<String> = Vec::new();
        for id in ids {
            if !unique.contains(&id) {
                unique.push(id);
            }
        }
        if unique.is_empty() {
            return Err(AppError::new(ErrorCode::ConfigInvalid, "Configure at least one Jira and Tempo connection."));
        }

        let mut entries: Vec<ReportEntry> = Vec::new();
        for id in &unique {
            let connection = self.connections.connection(id)?;
            let account = self.connections.account_id(id).await?;
            let worklogs = self.connections.tempo(id).get_worklogs(&account, &range.from_date, &range.to_date).await?;
            let projects = self.connections.jira(id).get_projects().await?;
            let names: HashMap<String, String> = projects.into_iter().map(|p| (p.key, p.name)).collect();
            for worklog in worklogs {
                let key = worklog.issue_key.split('-').next().unwrap_or_default().to_string();
                entries.push(ReportEntry {
                    project_id: project_match(&config, id, &worklog.issue_key).unwrap_or_default(),
                    jira_project_name: names.get(&key).cloned().unwrap_or_default(),
                    jira_project_key: key,
                    connection: connection.clone(),
                    worklog,
                });
            }
        }
        let selected: HashSet<&String> = request.project_ids.iter().collect();
        entries.retain(|e| selected.is_empty() || selected.contains(&e.project_id));
        entries.sort_by(|a, b| {
            a.worklog
                .start_date
                .cmp(&b.worklog.start_date)
                .then_with(|| a.worklog.start_time.clone().unwrap_or_default().cmp(&b.worklog.start_time.clone().unwrap_or_default()))
                .then_with(|| a.worklog.issue_key.cmp(&b.worklog.issue_key))
        });

        let directory = self.output_directory();
        std::fs::create_dir_all(&directory)
            .map_err(|e| AppError::with_details(ErrorCode::Unknown, "Could not create the report folder.", e.to_string()))?;
        let base = format_filename(&request.filename_template, &request.month, &request.layout)
            .map_err(|e| AppError::new(ErrorCode::ConfigInvalid, format!("Report filename template is invalid ({e}).")))?;
        let file_path = available_file_path(&directory, &base)?;
        let footer_left = if request.show_generated_at { Local::now().format("%Y-%m-%d %H:%M").to_string() } else { String::new() };
        let rendered = html::render(&entries, &request, &range, &config, &footer_left);
        pdf::print(app, &rendered, &file_path, request.orientation == "landscape").await?;

        Ok(ReportResult {
            file_path: file_path.display().to_string(),
            entry_count: entries.len(),
            total_seconds: entries.iter().map(|e| e.worklog.time_spent_seconds).sum(),
        })
    }

    pub fn get_reminder(&self) -> ReportReminder {
        let none = ReportReminder { month: None, due_date: None };
        let Some(offset) = self.config.get().reports.reminder_offset_days else { return none };
        let today = Local::now().date_naive();
        let previous = if today.month() == 1 { (today.year() - 1, 12) } else { (today.year(), today.month() - 1) };
        for (year, month) in [previous, (today.year(), today.month())] {
            let end = last_day_of_month(year, month);
            let due = end + Duration::days(offset);
            let expires = end + Duration::days(7);
            let key = format!("{year}-{month:02}");
            if today >= due && today <= expires && !self.has_report(&key) {
                return ReportReminder { month: Some(key), due_date: Some(due.format("%Y-%m-%d").to_string()) };
            }
        }
        none
    }

    fn has_report(&self, month: &str) -> bool {
        let directory = self.output_directory();
        let template = self.config.get().reports.filename_template;
        let Ok(files) = std::fs::read_dir(&directory) else { return false };
        let expected: Vec<String> = ["summary", "detailed"].iter().filter_map(|layout| format_filename(&template, month, layout).ok()).collect();
        files.filter_map(|f| f.ok()).any(|file| {
            let name = file.file_name().to_string_lossy().into_owned();
            expected.iter().any(|e| {
                let (stem, ext) = split_extension(e);
                name == *e || (name.starts_with(&format!("{stem} (")) && name.ends_with(&format!("){ext}")))
            })
        })
    }
}

fn split_extension(file_name: &str) -> (String, String) {
    let path = Path::new(file_name);
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (stem, ext)
}

fn available_file_path(directory: &Path, file_name: &str) -> AppResult<PathBuf> {
    let preferred = directory.join(file_name);
    if !preferred.exists() {
        return Ok(preferred);
    }
    let (stem, ext) = split_extension(file_name);
    (2..10_000)
        .map(|copy| directory.join(format!("{stem} ({copy}){ext}")))
        .find(|candidate| !candidate.exists())
        .ok_or_else(|| AppError::unknown("Could not choose a unique report filename."))
}

fn project_match(config: &AppConfig, connection_id: &str, issue_key: &str) -> Option<String> {
    config
        .projects
        .iter()
        .find(|p| p.targets.iter().any(|t| t.connection_id == connection_id && issue_key.starts_with(&format!("{}-", t.jira_project_key))))
        .map(|p| p.id.clone())
}

fn validate_request(request: &ReportRequest, config: &AppConfig) -> AppResult<()> {
    let invalid = |message: &str| Err(AppError::new(ErrorCode::ConfigInvalid, message));
    if !["summary", "detailed"].contains(&request.layout.as_str()) {
        return invalid("Unknown report layout.");
    }
    if let Some(error) = validate_template(&request.filename_template) {
        return Err(AppError::new(ErrorCode::ConfigInvalid, format!("Report filename template is invalid ({error}).")));
    }
    let unique: HashSet<&String> = request.groupings.iter().collect();
    if request.groupings.len() > 5 || unique.len() != request.groupings.len() {
        return invalid("Report grouping hierarchy is invalid.");
    }
    let custom: HashSet<&str> = config.custom_fields.iter().map(|f| f.id.as_str()).collect();
    let dynamic = |key: &str| key.strip_prefix("custom:").is_some_and(|id| custom.contains(id));
    if request.groupings.iter().any(|k| !BASE_GROUPINGS.contains(&k.as_str()) && !dynamic(k)) {
        return invalid("Report contains an unknown grouping.");
    }
    if request.columns.iter().any(|k| !BASE_COLUMNS.contains(&k.as_str()) && !dynamic(k)) {
        return invalid("Report contains an unknown column.");
    }
    if !["hours", "hours-minutes"].contains(&request.time_format.as_str()) {
        return invalid("Unknown report time format.");
    }
    if !["portrait", "landscape"].contains(&request.orientation.as_str()) {
        return invalid("Unknown report orientation.");
    }
    Ok(())
}
