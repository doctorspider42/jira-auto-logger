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
        // Legacy configs may have an empty author; fall back to the repo's own user.
        let author = if folder.include_all_authors {
            String::new()
        } else if !folder.author.is_empty() {
            folder.author.clone()
        } else {
            git(&folder.path, &["config", "user.email"]).await.map(|s| s.trim().to_string()).unwrap_or_default()
        };
        let format = format!("--pretty=format:%H{FIELD_SEPARATOR}%aI{FIELD_SEPARATOR}%s{RECORD_SEPARATOR}");
        let since = format!("--since={since}");
        let until = format!("--until={until}");
        let author_arg = format!("--author={author}");
        let mut args = vec!["log", "--all", since.as_str(), until.as_str(), format.as_str()];
        if !author.is_empty() {
            args.push(author_arg.as_str());
        }
        let stdout = git(&folder.path, &args).await?;
        let label = if folder.label.is_empty() { folder_label(&folder.path) } else { folder.label.clone() };
        let commits: Vec<CommitInfo> = stdout
            .split(RECORD_SEPARATOR)
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .filter_map(|record| {
                // Guard against malformed records so one odd line cannot crash parsing.
                let mut parts = record.split(FIELD_SEPARATOR);
                let (hash, date, message) = (parts.next()?, parts.next()?, parts.next()?);
                if hash.is_empty() || date.is_empty() {
                    return None;
                }
                Some(CommitInfo { hash: hash.into(), date: date.into(), message: message.into(), repo_label: label.clone() })
            })
            .collect();
        logger::debug(
            "git",
            &format!("{label}: {} commits", commits.len()),
            Some(json!({ "author": if author.is_empty() { "(all)" } else { author.as_str() } })),
        );
        Ok(commits)
    }
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
