//! `AppError` and the `Result` envelope every command returns, matching the
//! renderer's `Result<T>` = `{ ok: true, value } | { ok: false, error }`.

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    JiraAuth,
    JiraUnreachable,
    TempoAuth,
    TempoUnreachable,
    GitNotARepo,
    GitFailed,
    LlmAuthExpired,
    LlmCliNotFound,
    LlmBadResponse,
    LlmFailed,
    ConfigInvalid,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), details: None }
    }

    pub fn with_details(code: ErrorCode, message: impl Into<String>, details: impl Into<String>) -> Self {
        Self { code, message: message.into(), details: Some(details.into()) }
    }

    pub fn unknown(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unknown, message)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;

/// What a command hands to the renderer.
#[derive(Serialize)]
#[serde(untagged)]
pub enum Envelope<T: Serialize> {
    Ok { ok: bool, value: T },
    Err { ok: bool, error: AppError },
}

impl<T: Serialize> From<AppResult<T>> for Envelope<T> {
    fn from(result: AppResult<T>) -> Self {
        match result {
            Ok(value) => Envelope::Ok { ok: true, value },
            Err(error) => Envelope::Err { ok: false, error },
        }
    }
}
