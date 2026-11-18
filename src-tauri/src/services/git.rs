//! Reads commit history from local repositories using the system `git`.

use crate::domain::{CommitInfo, GitFolder};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::logger;
use async_trait::async_trait;
use serde_json::json;
use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::Arc;

// Explicit escapes (unit/record separator) - literal control chars in source
// are invisible and easy to lose in editors, which silently breaks parsing.
const FIELD_SEPARATOR: char = '\x1f';
const RECORD_SEPARATOR: char = '\x1e';

/// Anything that can provide commits for folders and dates (real git or mock).
#[async_trait]
pub trait CommitSource: Send + Sync {
    async fn get_commits(&self, folder_paths: &[String], dates: &[String]) -> AppResult<Vec<CommitInfo>>;
    /// Uncommitted work sitting in each repository right now.
    async fn get_working_changes(&self, _folder_paths: &[String]) -> Vec<WorkingChanges> {
        Vec::new()
    }
    /// Date (yyyy-MM-dd) of the first commit on `branch` that the mainline
    /// does not have - how long the work on that branch has been going on.
    /// None when it cannot be told cheaply.
    async fn branch_started(&self, _folder_path: &str, _branch: &str) -> Option<String> {
        None
    }
}

/// Branches that are a mainline, not a topic - their age says nothing.
pub fn is_mainline(branch: &str) -> bool {
    let name = branch.trim_start_matches("origin/");
    branch.is_empty() || matches!(name, "HEAD" | "main" | "master" | "develop" | "development" | "dev" | "trunk")
}

/// Work in a repository's working tree that no commit shows yet.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WorkingChanges {
    pub repo_label: String,
    pub branch: String,
    pub files: Vec<String>,
    pub additions: u32,
    pub deletions: u32,
    pub untracked: Vec<String>,
}

/// `--numstat` lines (`added<TAB>removed<TAB>path`, `-` for binary files)
/// -> paths and line totals.
fn parse_numstat(text: &str) -> (Vec<String>, u32, u32) {
    let (mut files, mut additions, mut deletions) = (Vec::new(), 0, 0);
    for line in text.lines() {
        let mut parts = line.splitn(3, '\t');
        let (Some(added), Some(removed), Some(path)) = (parts.next(), parts.next(), parts.next()) else { continue };
        additions += added.trim().parse::<u32>().unwrap_or(0);
        deletions += removed.trim().parse::<u32>().unwrap_or(0);
        files.push(path.trim().to_string());
    }
    (files, additions, deletions)
}

pub fn folder_label(path: &str) -> String {
    Path::new(path.trim_end_matches(['/', '\\']))
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

pub struct GitService {
    folders: Arc<dyn Fn() -> Vec<GitFolder> + Send + Sync>,
}

impl GitService {
    pub fn new(folders: Arc<dyn Fn() -> Vec<GitFolder> + Send + Sync>) -> Self {
        Self { folders }
    }

    async fn repo_commits(&self, folder: GitFolder, since: &str, until: &str) -> AppResult<Vec<CommitInfo>> {
        let authors = if folder.include_all_authors { Vec::new() } else { author_patterns(&folder).await };
        // The record separator leads each record because `--numstat` prints
        // the file list after the formatted header.
        let format = format!("--pretty=format:{RECORD_SEPARATOR}%H{FIELD_SEPARATOR}%aI{FIELD_SEPARATOR}%s{FIELD_SEPARATOR}%b{FIELD_SEPARATOR}%S{FIELD_SEPARATOR}");
        let since = format!("--since={since}");
        let until = format!("--until={until}");
        let author_args: Vec<String> = authors.iter().map(|a| format!("--author={a}")).collect();
        let mut args = vec!["log", "--all", "--source", "--numstat", since.as_str(), until.as_str(), format.as_str()];
        // Several --author flags match a commit by ANY of them.
        args.extend(author_args.iter().map(String::as_str));
        let stdout = git(&folder.path, &args).await?;
        let label = if folder.label.is_empty() { folder_label(&folder.path) } else { folder.label.clone() };
        let commits: Vec<CommitInfo> = stdout.split(RECORD_SEPARATOR).filter_map(|record| parse_record(record, &label)).collect();
        logger::debug("git", &format!("{label}: {} commits", commits.len()), Some(json!({ "authors": if authors.is_empty() { vec!["(all)".to_string()] } else { authors } })));
        Ok(commits)
    }
}

/// `--author` patterns for one folder: the configured author plus the name
/// and email git itself stamps on new commits in that repo. A repo without
/// `user.email` commits as `name <user@host.local>`, so filtering by the
/// configured work email alone silently found nothing.
async fn author_patterns(folder: &GitFolder) -> Vec<String> {
    let mut patterns = Vec::new();
    if !folder.author.trim().is_empty() {
        patterns.push(folder.author.trim().to_string());
    }
    if let Ok(ident) = git(&folder.path, &["var", "GIT_AUTHOR_IDENT"]).await {
        if let Some((name, email)) = parse_ident(&ident) {
            for value in [email, name] {
                let pattern = escape_basic_regex(&value);
                if !value.is_empty() && !patterns.contains(&pattern) {
                    patterns.push(pattern);
                }
            }
        }
    }
    patterns
}

/// `Name <email> 1700000000 +0100` -> (name, email).
fn parse_ident(ident: &str) -> Option<(String, String)> {
    let open = ident.find('<')?;
    let close = ident[open..].find('>')? + open;
    Some((ident[..open].trim().to_string(), ident[open + 1..close].trim().to_string()))
}

/// `--author` takes a POSIX basic regex; identities are literal text.
fn escape_basic_regex(value: &str) -> String {
    value.chars().fold(String::new(), |mut out, c| {
        if matches!(c, '.' | '[' | ']' | '*' | '^' | '$' | '\\') {
            out.push('\\');
        }
        out.push(c);
        out
    })
}

/// One `git log` record: header fields, then one numstat line per touched path.
/// Malformed records are skipped so one odd line cannot break the rest.
fn parse_record(record: &str, label: &str) -> Option<CommitInfo> {
    let mut parts = record.split(FIELD_SEPARATOR);
    let (hash, date, message, body, source) = (parts.next()?.trim(), parts.next()?, parts.next()?, parts.next()?, parts.next()?);
    if hash.is_empty() || date.is_empty() {
        return None;
    }
    let (files, additions, deletions) = parse_numstat(parts.next().unwrap_or(""));
    let branch = source.trim().trim_start_matches("refs/heads/").trim_start_matches("refs/remotes/").to_string();
    Some(CommitInfo {
        hash: hash.into(),
        date: date.into(),
        message: message.into(),
        repo_label: label.into(),
        body: body.trim().into(),
        branch,
        files,
        additions,
        deletions,
    })
}

#[async_trait]
impl CommitSource for GitService {
    /// Commits authored on any of the given ISO dates, across all folders.
    /// Each folder has its own author filter; `includeAllAuthors` folders
    /// return everyone's commits.
    async fn get_commits(&self, folder_paths: &[String], dates: &[String]) -> AppResult<Vec<CommitInfo>> {
        if folder_paths.is_empty() || dates.is_empty() {
            return Ok(Vec::new());
        }
        let wanted: BTreeSet<String> = dates.iter().cloned().collect();
        let since = format!("{}T00:00:00", wanted.first().unwrap());
        let until = format!("{}T23:59:59", wanted.last().unwrap());
        let configured: HashMap<String, GitFolder> = (self.folders)().into_iter().map(|f| (f.path.clone(), f)).collect();

        let mut all = Vec::new();
        // One repository at a time: git calls are short and this keeps the
        // first failure the reported one, like Promise.all.
        for path in folder_paths {
            let folder = configured.get(path).cloned().unwrap_or_else(|| GitFolder {
                path: path.clone(),
                label: folder_label(path),
                author: String::new(),
                include_all_authors: false,
            });
            all.extend(self.repo_commits(folder, &since, &until).await?);
        }
        all.retain(|c| wanted.contains(c.date.get(..10).unwrap_or("")));
        all.sort_by(|a, b| a.date.cmp(&b.date));
        Ok(all)
    }

    /// Best effort per repo: a folder git cannot read simply contributes nothing.
    async fn get_working_changes(&self, folder_paths: &[String]) -> Vec<WorkingChanges> {
        let configured: HashMap<String, GitFolder> = (self.folders)().into_iter().map(|f| (f.path.clone(), f)).collect();
        let mut out = Vec::new();
        for path in folder_paths {
            // Staged and unstaged together; fails on a repo without commits.
            let Ok(diff) = git(path, &["diff", "HEAD", "--numstat"]).await else { continue };
            let (files, additions, deletions) = parse_numstat(&diff);
            let untracked: Vec<String> = git(path, &["ls-files", "--others", "--exclude-standard"])
                .await
                .unwrap_or_default()
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .map(String::from)
                .collect();
            if files.is_empty() && untracked.is_empty() {
                continue;
            }
            let branch = git(path, &["rev-parse", "--abbrev-ref", "HEAD"]).await.map(|b| b.trim().to_string()).unwrap_or_default();
            let label = configured.get(path).map(|f| f.label.clone()).filter(|l| !l.is_empty()).unwrap_or_else(|| folder_label(path));
            out.push(WorkingChanges { repo_label: label, branch, files, additions, deletions, untracked });
        }
        out
    }
    async fn branch_started(&self, folder_path: &str, branch: &str) -> Option<String> {
        if is_mainline(branch) || branch.starts_with('-') || branch.starts_with("refs/tags/") {
            return None;
        }
        let mut base = None;
        for candidate in ["origin/HEAD", "origin/main", "origin/master", "origin/develop", "main", "master", "develop"] {
            if candidate != branch && git(folder_path, &["rev-parse", "--verify", "--quiet", candidate]).await.is_ok() {
                base = Some(candidate);
                break;
            }
        }
        let range = format!("{}..{branch}", base?);
        let out = git(folder_path, &["log", "--reverse", "--format=%aI", &range]).await.ok()?;
        out.lines().next().and_then(|l| l.get(..10)).map(String::from)
    }
}

async fn git(folder: &str, args: &[&str]) -> AppResult<String> {
    let mut command = tokio::process::Command::new("git");
    command.arg("-C").arg(folder).args(args);
    #[cfg(windows)]
    {
        // No console window flashing up for every git call.
        command.creation_flags(0x0800_0000);
    }
    let output = command
        .output()
        .await
        .map_err(|e| AppError::with_details(ErrorCode::GitFailed, format!("git failed in {folder}"), e.to_string()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        if stderr.contains("not a git repository") {
            return Err(AppError::new(ErrorCode::GitNotARepo, format!("Not a git repository: {folder}")));
        }
        return Err(AppError::with_details(ErrorCode::GitFailed, format!("git failed in {folder}"), stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_identity() {
        let ident = "Paweł Pająk <papaj@host.local> 1700000000 +0100\n";
        assert_eq!(parse_ident(ident), Some(("Paweł Pająk".into(), "papaj@host.local".into())));
    }

    #[test]
    fn escapes_identity_for_author_regex() {
        assert_eq!(escape_basic_regex("a.b@c.local"), "a\\.b@c\\.local");
    }

    #[test]
    fn parses_record_with_body_branch_and_files() {
        let record = format!("abc{FIELD_SEPARATOR}2026-11-18T17:09:08+01:00{FIELD_SEPARATOR}Subject{FIELD_SEPARATOR}Line one\nLine two\n{FIELD_SEPARATOR}refs/heads/feature/FOP-1{FIELD_SEPARATOR}\n10\t2\tsrc/a.rs\n-\t-\tlogo.png\n\n");
        let commit = parse_record(&record, "repo").unwrap();
        assert_eq!(commit.message, "Subject");
        assert_eq!(commit.body, "Line one\nLine two");
        assert_eq!(commit.branch, "feature/FOP-1");
        assert_eq!(commit.files, vec!["src/a.rs", "logo.png"]);
        assert_eq!((commit.additions, commit.deletions), (10, 2));
        assert!(parse_record("\n", "repo").is_none());
    }
}
