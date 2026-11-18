//! Auto mode: finds out which configured projects the user worked on, per
//! date, from deterministic evidence - commits, uncommitted changes, the
//! user's own Jira activity - and from habit (what Tempo shows they logged on
//! recent days). It also proposes a SOFT split of each day's remaining hours,
//! which the LLM pass receives as a starting point it may depart from.
//!
//! Every source is best effort: a repository git cannot read, a Jira that
//! rejects the query or a Tempo that is down only removes that evidence.

use crate::config::ConfigService;
use crate::domain::*;
use crate::logger;
use crate::services::connections::ConnectionManager;
use crate::services::git::{CommitSource, WorkingChanges};
use crate::services::jira::JiraActivity;
use chrono::{Datelike, NaiveDate, Weekday};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;

/// How many recent days with any worklog define the user's habits.
pub const RECENT_DAY_COUNT: usize = 5;
/// How far back to look for those days; covers a week or two off.
pub const RECENT_LOOKBACK_DAYS: i64 = 21;
/// Weight of a habit-only (`likely`) project at a 100% recent log rate;
/// evidence of real work weighs 1.5 and more, so habit gets the smaller share.
const LIKELY_WEIGHT: f64 = 1.0;

pub const EVIDENCE: &str = "evidence";
pub const LIKELY: &str = "likely";
pub const NONE: &str = "none";

fn parse_date(date: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

pub fn is_weekday(date: &str) -> bool {
    parse_date(date).is_some_and(|d| !matches!(d.weekday(), Weekday::Sat | Weekday::Sun))
}

pub fn shift_date(date: &str, days: i64) -> String {
    parse_date(date).map(|d| (d + chrono::Duration::days(days)).format("%Y-%m-%d").to_string()).unwrap_or_else(|| date.to_string())
}

/// The newest `count` dates before `first` on which anything was logged,
/// oldest first. Days off are skipped naturally - they have no worklogs.
pub fn previous_logged_days<'a>(logged_dates: impl IntoIterator<Item = &'a String>, first: &str, count: usize) -> Vec<String> {
    let unique: BTreeSet<&String> = logged_dates.into_iter().filter(|d| d.as_str() < first).collect();
    let mut days: Vec<String> = unique.into_iter().rev().take(count).cloned().collect();
    days.reverse();
    days
}

/// The `count` weekdays before `first`, oldest first - the fallback window
/// when Tempo shows nothing.
pub fn previous_weekdays(first: &str, count: usize) -> Vec<String> {
    let Some(mut day) = parse_date(first) else { return Vec::new() };
    let mut days = Vec::new();
    while days.len() < count {
        day -= chrono::Duration::days(1);
        if !matches!(day.weekday(), Weekday::Sat | Weekday::Sun) {
            days.push(day.format("%Y-%m-%d").to_string());
        }
    }
    days.reverse();
    days
}

/// Minutes from midnight of a local "HH:MM".
fn minutes(time: &str) -> Option<f64> {
    let (h, m) = time.split_once(':')?;
    Some(h.parse::<f64>().ok()? * 60.0 + m.parse::<f64>().ok()?)
}

/// How much work a day's evidence suggests, in arbitrary units. Change size
/// counts logarithmically (a 2000-line migration is more work than a typo fix,
/// but not 1000x more), the span between the first and last commit hints at
/// time spent, and Jira activity (reviews, comments, status moves) is work
/// that leaves no commit.
pub fn evidence_weight(day: &ProjectDayActivity) -> f64 {
    let mut weight = 0.0;
    let uncommitted_lines = day.uncommitted.as_ref().map_or(0, |u| u.additions + u.deletions);
    let has_code = day.commit_count > 0 || day.uncommitted.is_some();
    if has_code {
        let lines = (day.additions + day.deletions + uncommitted_lines) as f64;
        weight += 1.0 + (1.0 + lines).log10();
        if let (Some(first), Some(last)) = (minutes(&day.first_commit_at), minutes(&day.last_commit_at)) {
            weight += ((last - first).max(0.0) / 60.0).min(8.0) * 0.25;
        }
        weight += day.commit_count.min(10) as f64 * 0.1;
    }
    if day.jira_activity_count > 0 {
        weight += 1.0 + day.jira_activity_count.min(6) as f64 * 0.25;
    }
    weight
}

/// Splits `remaining` hours by weight in quarter hours, so the shares add up
/// exactly to the (quarter-rounded) budget; largest remainders get the
/// leftover quarters. Zero weights get zero.
pub fn split_hours(remaining: f64, weights: &[f64]) -> Vec<f64> {
    let units = (remaining.max(0.0) * 4.0).round() as i64;
    let total: f64 = weights.iter().filter(|w| **w > 0.0).sum();
    if units == 0 || total <= 0.0 {
        return vec![0.0; weights.len()];
    }
    let exact: Vec<f64> = weights.iter().map(|w| if *w > 0.0 { units as f64 * w / total } else { 0.0 }).collect();
    let mut shares: Vec<i64> = exact.iter().map(|e| e.floor() as i64).collect();
    let leftover = units - shares.iter().sum::<i64>();
    let mut order: Vec<usize> = (0..weights.len()).filter(|i| weights[*i] > 0.0).collect();
    order.sort_by(|a, b| (exact[*b] - exact[*b].floor()).total_cmp(&(exact[*a] - exact[*a].floor())).then(a.cmp(b)));
    for i in order.iter().cycle().take(leftover.max(0) as usize) {
        shares[*i] += 1;
    }
    shares.into_iter().map(|s| s as f64 / 4.0).collect()
}

/// One project on one date, as far as `classify_day` is concerned.
#[derive(Clone, Copy, Debug, Default)]
pub struct DayCandidate {
    pub has_evidence: bool,
    /// Recent days the user logged to this project.
    pub recent_days: u32,
    /// Hours logged to it over those days.
    pub recent_hours: f64,
}

/// Status per project for one date. Evidence wins; without it, a project the
/// user logged to on most recent days is `likely`. On a weekday nobody has
/// evidence for, the project with the most recent hours is `likely` anyway -
/// a thin day is still a working day. Weekends get no habit-based guesses.
pub fn classify_day(candidates: &[DayCandidate], window: u32, weekday: bool) -> Vec<&'static str> {
    let mut statuses: Vec<&'static str> = candidates
        .iter()
        .map(|c| {
            if c.has_evidence {
                EVIDENCE
            } else if weekday && window > 0 && c.recent_days * 2 > window {
                LIKELY
            } else {
                NONE
            }
        })
        .collect();
    if weekday && !candidates.iter().any(|c| c.has_evidence) && !statuses.contains(&LIKELY) {
        let best = candidates
            .iter()
            .enumerate()
            .filter(|(_, c)| c.recent_hours > 0.0)
            .max_by(|(ia, a), (ib, b)| a.recent_hours.total_cmp(&b.recent_hours).then(ib.cmp(ia)));
        if let Some((i, _)) = best {
            statuses[i] = LIKELY;
        }
    }
    statuses
}

/// Weight of a project on a date given its status.
fn day_weight(status: &str, day: &ProjectDayActivity, candidate: &DayCandidate, window: u32) -> f64 {
    match status {
        EVIDENCE => evidence_weight(day),
        LIKELY => {
            // The fallback pick may sit below the majority threshold; it still
            // needs a share, and it is the only one that day anyway.
            let rate = if window > 0 { candidate.recent_days as f64 / window as f64 } else { 0.0 };
            LIKELY_WEIGHT * rate.max(0.2)
        }
        _ => 0.0,
    }
}

/// Configured projects (non-archived) a worklog of `connection_id` belongs to.
pub fn projects_of_worklog<'a>(projects: &'a [ProjectConfig], connection_id: &str, issue_key: &str) -> Vec<&'a ProjectConfig> {
    projects
        .iter()
        .filter(|p| !p.archived)
        .filter(|p| {
            p.targets
                .iter()
                .any(|t| t.connection_id == connection_id && !t.jira_project_key.is_empty() && issue_key.starts_with(&format!("{}-", t.jira_project_key)))
        })
        .collect()
}

/// Every connection in play: the active ones plus those of the given projects' targets.
pub fn connection_ids<'a>(config: &AppConfig, projects: impl IntoIterator<Item = &'a ProjectConfig>) -> Vec<String> {
    let mut ids: Vec<String> = config.active_connection_ids.clone();
    for project in projects {
        for target in &project.targets {
            if !ids.contains(&target.connection_id) {
                ids.push(target.connection_id.clone());
            }
        }
    }
    ids
}

/// Tempo worklogs within [from, to] per connection; a connection whose Tempo
/// cannot answer is left out.
pub async fn fetch_worklogs(connections: &ConnectionManager, ids: &[String], from: &str, to: &str) -> HashMap<String, Vec<Worklog>> {
    let mut out = HashMap::new();
    for id in ids {
        let Ok(account) = connections.account_id(id).await else { continue };
        match connections.tempo(id).get_worklogs(&account, from, to).await {
            Ok(worklogs) => {
                out.insert(id.clone(), worklogs);
            }
            Err(e) => logger::info("activity", &format!("Tempo unavailable for {id}: {}", e.message), None),
        }
    }
    out
}

fn hours(seconds: i64) -> f64 {
    seconds as f64 / 3600.0
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

pub struct ActivityService {
    config: Arc<ConfigService>,
    git: Arc<dyn CommitSource>,
    connections: Arc<ConnectionManager>,
}

impl ActivityService {
    pub fn new(config: Arc<ConfigService>, git: Arc<dyn CommitSource>, connections: Arc<ConnectionManager>) -> Self {
        Self { config, git, connections }
    }

    pub async fn scan(&self, request: &ActivityScanRequest) -> ActivityScanResult {
        let config = self.config.get();
        let dates: Vec<String> = request.dates.iter().cloned().collect::<BTreeSet<_>>().into_iter().filter(|d| parse_date(d).is_some()).collect();
        let (Some(first), Some(last)) = (dates.first().cloned(), dates.last().cloned()) else { return ActivityScanResult::default() };
        let projects: Vec<ProjectConfig> = config.projects.iter().filter(|p| !p.archived).cloned().collect();
        let ids = connection_ids(&config, &projects);

        // One Tempo fetch per connection covers both the habit window and the
        // hours already logged on the requested dates.
        let worklogs = fetch_worklogs(&self.connections, &ids, &shift_date(&first, -RECENT_LOOKBACK_DAYS), &last).await;
        let mut logged: HashMap<&str, f64> = HashMap::new();
        for w in worklogs.values().flatten() {
            if dates.contains(&w.start_date) {
                *logged.entry(w.start_date.as_str()).or_insert(0.0) += hours(w.time_spent_seconds);
            }
        }
        let window = previous_logged_days(worklogs.values().flatten().map(|w| &w.start_date), &first, RECENT_DAY_COUNT);
        let mut habits: HashMap<&str, (BTreeSet<&str>, f64)> = HashMap::new();
        // project id -> date -> issue key -> hours, for the continuation hint.
        let mut recent: HashMap<&str, BTreeMap<&str, HashMap<&str, f64>>> = HashMap::new();
        for (connection_id, list) in &worklogs {
            for w in list.iter().filter(|w| window.contains(&w.start_date)) {
                for project in projects_of_worklog(&projects, connection_id, &w.issue_key) {
                    let entry = habits.entry(project.id.as_str()).or_default();
                    entry.0.insert(w.start_date.as_str());
                    entry.1 += hours(w.time_spent_seconds);
                    *recent
                        .entry(project.id.as_str())
                        .or_default()
                        .entry(w.start_date.as_str())
                        .or_default()
                        .entry(w.issue_key.as_str())
                        .or_insert(0.0) += hours(w.time_spent_seconds);
                }
            }
        }

        let activity = self.jira_activity(&projects, &first, &last).await;
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let mut rows: Vec<ProjectActivity> = Vec::new();
        for project in &projects {
            let commits = self.commits(project, &dates).await;
            let working = if dates.contains(&today) && !project.git_folders.is_empty() {
                let paths: Vec<String> = project.git_folders.iter().map(|f| f.path.clone()).collect();
                self.git.get_working_changes(&paths).await
            } else {
                Vec::new()
            };
            let project_activity: Vec<&JiraActivity> = activity.get(project.id.as_str()).map(|a| a.iter().collect()).unwrap_or_default();
            let (recent_days, _) = habits.get(project.id.as_str()).map(|(d, h)| (d.len() as u32, *h)).unwrap_or_default();
            rows.push(ProjectActivity {
                project_id: project.id.clone(),
                project_name: project.name.clone(),
                status: NONE.into(),
                recent_logged_days: recent_days,
                recent_day_count: window.len() as u32,
                recent_days: recent.get(project.id.as_str()).map(recent_day_list).unwrap_or_default(),
                days: dates.iter().map(|d| day_activity(d, &commits, if *d == today { &working } else { &[] }, &project_activity)).collect(),
            });
        }

        // Classify and split per date, across projects.
        let working_hours = config.working_hours_per_day;
        let mut budgets = Vec::new();
        for (i, date) in dates.iter().enumerate() {
            let candidates: Vec<DayCandidate> = rows
                .iter()
                .map(|row| {
                    let day = &row.days[i];
                    let (recent_days, recent_hours) = habits.get(row.project_id.as_str()).map(|(d, h)| (d.len() as u32, *h)).unwrap_or_default();
                    DayCandidate { has_evidence: evidence_weight(day) > 0.0, recent_days, recent_hours }
                })
                .collect();
            let statuses = classify_day(&candidates, window.len() as u32, is_weekday(date));
            let weights: Vec<f64> = rows.iter().enumerate().map(|(p, row)| day_weight(statuses[p], &row.days[i], &candidates[p], window.len() as u32)).collect();
            let logged_hours = round2(logged.get(date.as_str()).copied().unwrap_or(0.0));
            let remaining = round2((working_hours - logged_hours).max(0.0));
            let shares = split_hours(remaining, &weights);
            for (p, row) in rows.iter_mut().enumerate() {
                row.days[i].status = statuses[p].into();
                row.days[i].hours_hint = shares[p];
            }
            budgets.push(DayBudget { date: date.clone(), working_hours, logged_hours, remaining_hours: remaining });
        }
        for row in &mut rows {
            row.status = if row.days.iter().any(|d| d.status == EVIDENCE) {
                EVIDENCE
            } else if row.days.iter().any(|d| d.status == LIKELY) {
                LIKELY
            } else {
                NONE
            }
            .into();
        }
        logger::info(
            "activity",
            "scan finished",
            Some(json!({
                "dates": dates.len(),
                "projects": rows.len(),
                "evidence": rows.iter().filter(|r| r.status == EVIDENCE).count(),
                "likely": rows.iter().filter(|r| r.status == LIKELY).count(),
                "recentDays": window.len(),
            })),
        );
        ActivityScanResult { days: budgets, projects: rows }
    }

    /// Commits of every repository of the project on the dates, repo by repo
    /// so one unreadable folder does not hide the others.
    async fn commits(&self, project: &ProjectConfig, dates: &[String]) -> Vec<CommitInfo> {
        let mut all = Vec::new();
        for folder in &project.git_folders {
            match self.git.get_commits(std::slice::from_ref(&folder.path), dates).await {
                Ok(found) => all.extend(found),
                Err(e) => logger::info("activity", &format!("git skipped for {}: {}", folder.path, e.message), None),
            }
        }
        all
    }

    /// The user's Jira activity per project id: ONE query per connection
    /// covering all its project keys, grouped back by issue key prefix.
    async fn jira_activity(&self, projects: &[ProjectConfig], from: &str, to: &str) -> HashMap<String, Vec<JiraActivity>> {
        let mut keys_by_connection: Vec<(String, Vec<String>)> = Vec::new();
        for target in projects.iter().flat_map(|p| &p.targets) {
            if target.jira_project_key.is_empty() {
                continue;
            }
            match keys_by_connection.iter_mut().find(|(c, _)| *c == target.connection_id) {
                Some((_, keys)) if !keys.contains(&target.jira_project_key) => keys.push(target.jira_project_key.clone()),
                Some(_) => {}
                None => keys_by_connection.push((target.connection_id.clone(), vec![target.jira_project_key.clone()])),
            }
        }
        let mut out: HashMap<String, Vec<JiraActivity>> = HashMap::new();
        for (connection_id, keys) in keys_by_connection {
            let Ok(account) = self.connections.account_id(&connection_id).await else { continue };
            let found = match self.connections.jira(&connection_id).get_my_activity_in(&account, &keys, from, to).await {
                Ok(found) => found,
                Err(e) => {
                    logger::info("activity", &format!("Jira activity unavailable for {connection_id}: {}", e.message), None);
                    continue;
                }
            };
            for a in found {
                for project in projects_of_worklog(projects, &connection_id, &a.issue_key) {
                    let list = out.entry(project.id.clone()).or_default();
                    if !list.contains(&a) {
                        list.push(a.clone());
                    }
                }
            }
        }
        out
    }
}

/// How many recent days a thin day's continuation hint shows.
const CONTINUATION_DAYS: usize = 3;

/// Per-date hours of one project, newest `CONTINUATION_DAYS`, oldest first.
fn recent_day_list(by_date: &BTreeMap<&str, HashMap<&str, f64>>) -> Vec<RecentDay> {
    let mut days: Vec<RecentDay> = by_date
        .iter()
        .rev()
        .take(CONTINUATION_DAYS)
        .map(|(date, issues)| {
            let top = issues.iter().max_by(|a, b| a.1.total_cmp(b.1).then_with(|| b.0.cmp(a.0))).map(|(k, _)| k.to_string()).unwrap_or_default();
            RecentDay { date: date.to_string(), hours: round2(issues.values().sum()), issue_key: top }
        })
        .collect();
    days.reverse();
    days
}

/// The evidence of one project on one date.
fn day_activity(date: &str, commits: &[CommitInfo], working: &[WorkingChanges], activity: &[&JiraActivity]) -> ProjectDayActivity {
    let day: Vec<&CommitInfo> = commits.iter().filter(|c| c.date.get(..10) == Some(date)).collect();
    let mut times: Vec<&str> = day.iter().filter_map(|c| c.date.get(11..16)).collect();
    times.sort();
    let uncommitted = (!working.is_empty()).then(|| UncommittedSummary {
        files: working.iter().map(|w| (w.files.len() + w.untracked.len()) as u32).sum(),
        additions: working.iter().map(|w| w.additions).sum(),
        deletions: working.iter().map(|w| w.deletions).sum(),
    });
    let on_date: Vec<&&JiraActivity> = activity.iter().filter(|a| a.date == date).collect();
    let mut keys: Vec<String> = Vec::new();
    for a in &on_date {
        if !keys.contains(&a.issue_key) {
            keys.push(a.issue_key.clone());
        }
    }
    let mut events: Vec<ActivityEvent> = day
        .iter()
        .map(|c| ActivityEvent {
            time: c.date.get(11..16).unwrap_or_default().to_string(),
            kind: "commit".into(),
            text: c.message.clone(),
            additions: c.additions,
            deletions: c.deletions,
            ..Default::default()
        })
        .collect();
    events.extend(on_date.iter().map(|a| ActivityEvent {
        time: a.time.clone(),
        kind: "jira".into(),
        text: a.action.clone(),
        issue_key: a.issue_key.clone(),
        ..Default::default()
    }));
    // Newest first; uncommitted work is "now", so it leads.
    events.sort_by(|a, b| b.time.cmp(&a.time));
    if let Some(u) = &uncommitted {
        events.insert(0, ActivityEvent { kind: "uncommitted".into(), additions: u.additions, deletions: u.deletions, files: u.files, ..Default::default() });
    }
    let branch = day.iter().max_by(|a, b| a.date.cmp(&b.date)).map(|c| c.branch.clone()).unwrap_or_default();
    ProjectDayActivity {
        date: date.to_string(),
        branch,
        events,
        status: NONE.into(),
        commit_count: day.len() as u32,
        additions: day.iter().map(|c| c.additions).sum(),
        deletions: day.iter().map(|c| c.deletions).sum(),
        first_commit_at: times.first().map(|t| t.to_string()).unwrap_or_default(),
        last_commit_at: times.last().map(|t| t.to_string()).unwrap_or_default(),
        uncommitted,
        jira_activity_count: on_date.len() as u32,
        jira_issue_keys: keys,
        hours_hint: 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(commits: u32, lines: u32, first: &str, last: &str, jira: u32) -> ProjectDayActivity {
        ProjectDayActivity {
            commit_count: commits,
            additions: lines,
            first_commit_at: first.into(),
            last_commit_at: last.into(),
            jira_activity_count: jira,
            ..Default::default()
        }
    }

    #[test]
    fn events_run_newest_first_with_uncommitted_work_on_top() {
        let commit = |time: &str, message: &str| CommitInfo {
            date: format!("2026-11-18T{time}:00+01:00"),
            message: message.into(),
            branch: "feature/A-1".into(),
            additions: 10,
            ..Default::default()
        };
        let jira = JiraActivity { date: "2026-11-18".into(), time: "12:00".into(), issue_key: "A-1".into(), action: "status: To Do -> Done".into(), ..Default::default() };
        let working = WorkingChanges { files: vec!["a.rs".into()], additions: 3, ..Default::default() };
        let day = day_activity("2026-11-18", &[commit("09:00", "first"), commit("15:30", "last")], &[working], &[&jira]);
        let kinds: Vec<(&str, &str)> = day.events.iter().map(|e| (e.kind.as_str(), e.time.as_str())).collect();
        assert_eq!(kinds, vec![("uncommitted", ""), ("commit", "15:30"), ("jira", "12:00"), ("commit", "09:00")]);
        assert_eq!(day.branch, "feature/A-1");
    }

    #[test]
    fn recent_days_keep_the_newest_and_name_the_main_issue() {
        let mut by_date: BTreeMap<&str, HashMap<&str, f64>> = BTreeMap::new();
        for (date, issue, hours) in [("2026-11-10", "A-1", 8.0), ("2026-11-11", "A-1", 2.0), ("2026-11-11", "A-2", 5.0), ("2026-11-12", "A-2", 6.0), ("2026-11-13", "A-2", 4.0)] {
            *by_date.entry(date).or_default().entry(issue).or_insert(0.0) += hours;
        }
        let days = recent_day_list(&by_date);
        let summary: Vec<(&str, f64, &str)> = days.iter().map(|d| (d.date.as_str(), d.hours, d.issue_key.as_str())).collect();
        assert_eq!(summary, vec![("2026-11-11", 7.0, "A-2"), ("2026-11-12", 6.0, "A-2"), ("2026-11-13", 4.0, "A-2")]);
    }

    #[test]
    fn no_evidence_weighs_nothing() {
        assert_eq!(evidence_weight(&ProjectDayActivity::default()), 0.0);
    }

    #[test]
    fn bigger_and_longer_work_weighs_more() {
        let typo = evidence_weight(&day(1, 2, "10:00", "10:00", 0));
        let migration = evidence_weight(&day(1, 2000, "10:00", "10:00", 0));
        let long_day = evidence_weight(&day(3, 2, "09:00", "17:00", 0));
        assert!(migration > typo);
        assert!(long_day > typo);
        // Logarithmic: 1000x the lines is nowhere near 1000x the weight.
        assert!(migration < typo * 3.0);
    }

    #[test]
    fn jira_only_counts_and_uncommitted_counts() {
        assert!(evidence_weight(&day(0, 0, "", "", 2)) > 0.0);
        let working = ProjectDayActivity { uncommitted: Some(UncommittedSummary { files: 3, additions: 50, deletions: 5 }), ..Default::default() };
        assert!(evidence_weight(&working) > 1.0);
    }

    #[test]
    fn split_adds_up_to_the_budget_in_quarters() {
        let shares = split_hours(8.0, &[1.0, 1.0, 1.0]);
        assert_eq!(shares.iter().sum::<f64>(), 8.0);
        assert!(shares.iter().all(|s| (s * 4.0).fract() == 0.0));
        assert_eq!(split_hours(6.0, &[3.0, 1.0]), vec![4.5, 1.5]);
        assert_eq!(split_hours(5.3, &[1.0, 0.0]), vec![5.25, 0.0]);
    }

    #[test]
    fn split_handles_nothing_to_split() {
        assert_eq!(split_hours(0.0, &[1.0, 2.0]), vec![0.0, 0.0]);
        assert_eq!(split_hours(8.0, &[0.0, 0.0]), vec![0.0, 0.0]);
        assert_eq!(split_hours(-2.0, &[1.0]), vec![0.0]);
        assert!(split_hours(8.0, &[]).is_empty());
    }

    #[test]
    fn evidence_wins_and_habit_needs_a_majority() {
        let c = |has_evidence, recent_days, recent_hours| DayCandidate { has_evidence, recent_days, recent_hours };
        let statuses = classify_day(&[c(true, 0, 0.0), c(false, 3, 20.0), c(false, 2, 10.0)], 5, true);
        assert_eq!(statuses, vec![EVIDENCE, LIKELY, NONE]);
    }

    #[test]
    fn empty_weekday_falls_back_to_most_logged_project() {
        let c = |recent_days, recent_hours| DayCandidate { has_evidence: false, recent_days, recent_hours };
        assert_eq!(classify_day(&[c(2, 6.0), c(2, 12.0), c(0, 0.0)], 5, true), vec![NONE, LIKELY, NONE]);
        // A majority project already covers the day - no extra pick.
        assert_eq!(classify_day(&[c(4, 6.0), c(2, 30.0)], 5, true), vec![LIKELY, NONE]);
        // No history at all: nothing to guess from.
        assert_eq!(classify_day(&[c(0, 0.0)], 0, true), vec![NONE]);
    }

    #[test]
    fn weekends_get_no_guesses() {
        let c = DayCandidate { has_evidence: false, recent_days: 5, recent_hours: 40.0 };
        assert_eq!(classify_day(&[c], 5, false), vec![NONE]);
        let e = DayCandidate { has_evidence: true, ..c };
        assert_eq!(classify_day(&[e], 5, false), vec![EVIDENCE]);
    }

    #[test]
    fn likely_gets_a_smaller_share_than_evidence() {
        let evidence = day(4, 300, "09:00", "16:00", 1);
        let habit = DayCandidate { has_evidence: false, recent_days: 4, recent_hours: 20.0 };
        let weights = [day_weight(EVIDENCE, &evidence, &DayCandidate::default(), 5), day_weight(LIKELY, &ProjectDayActivity::default(), &habit, 5)];
        let shares = split_hours(8.0, &weights);
        assert!(shares[0] > shares[1] && shares[1] > 0.0);
        assert_eq!(shares[0] + shares[1], 8.0);
    }

    #[test]
    fn recent_window_skips_days_off_and_requested_dates() {
        let dates: Vec<String> = ["2026-11-02", "2026-11-03", "2026-11-03", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-18"]
            .iter()
            .map(|d| d.to_string())
            .collect();
        assert_eq!(previous_logged_days(&dates, "2026-11-18", 5), vec!["2026-11-03", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
        assert_eq!(previous_weekdays("2026-11-18", 5), vec!["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17"]);
        assert!(is_weekday("2026-11-18") && !is_weekday("2026-11-21"));
    }
}

