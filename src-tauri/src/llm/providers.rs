//! LLM backends. Each provider only turns a fully built prompt into the raw
//! model text; parsing and validation happen in `LlmService`.

use crate::domain::OpenAiConfig;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::logger;
use async_trait::async_trait;
use regex::Regex;
use serde_json::{json, Value};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

/// Raw model answer plus the model that produced it, when the backend says.
pub struct LlmCompletion {
    pub text: String,
    pub model: Option<String>,
}

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn complete(&self, prompt: &str) -> AppResult<LlmCompletion>;
}

struct CliResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

/// Runs a CLI tool feeding the prompt through stdin (avoids argv length
/// limits and quoting issues with large prompts).
async fn run_cli(command: &str, args: &[String], stdin: &str, env: &[(&str, &str)]) -> AppResult<CliResult> {
    const TIMEOUT: Duration = Duration::from_secs(180);
    let started = Instant::now();
    logger::info(
        "cli",
        &format!("spawn: {command} {}", args.join(" ")),
        Some(json!({ "stdinLength": stdin.len(), "env": env.iter().map(|(k, _)| *k).collect::<Vec<_>>() })),
    );
    // npm-installed CLIs are .cmd shims on Windows; resolving the full path
    // lets the standard library run them through cmd with safe quoting.
    let program = which::which(command).map_err(|_| AppError::new(ErrorCode::LlmCliNotFound, format!("CLI not found: {command}")))?;
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args)
        .envs(env.iter().copied())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::with_details(ErrorCode::LlmFailed, format!("Failed to start {command}"), e.to_string()))?;
    if let Some(mut input) = child.stdin.take() {
        let _ = input.write_all(stdin.as_bytes()).await;
        drop(input);
    }
    let output = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| AppError::new(ErrorCode::LlmFailed, format!("{command} timed out after {}s", TIMEOUT.as_secs())))?
        .map_err(|e| AppError::with_details(ErrorCode::LlmFailed, format!("Failed to run {command}"), e.to_string()))?;
    let result = CliResult {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        exit_code: output.status.code().unwrap_or(-1),
    };
    let mut details = json!({ "stdoutLength": result.stdout.len(), "stderrLength": result.stderr.len() });
    if result.exit_code != 0 {
        details["stderr"] = json!(result.stderr.chars().take(1000).collect::<String>());
    }
    logger::info("cli", &format!("{command} exited {} in {}ms", result.exit_code, started.elapsed().as_millis()), Some(details));
    let not_found = Regex::new(r"(?i)not (found|recognized)").unwrap();
    if result.exit_code != 0 && result.stdout.trim().is_empty() && not_found.is_match(&result.stderr) {
        return Err(AppError::with_details(ErrorCode::LlmCliNotFound, format!("CLI not found: {command}"), result.stderr));
    }
    Ok(result)
}

fn head(text: &str) -> String {
    text.chars().take(2000).collect()
}

fn matches_any(patterns: &[&str], text: &str) -> bool {
    patterns.iter().any(|p| Regex::new(p).unwrap().is_match(text))
}

/// Runs prompts through the Claude Code CLI in non-interactive (`-p`) mode.
pub struct ClaudeCli {
    pub cli_path: String,
    pub model: String,
    pub enable_thinking: bool,
}

/// The model that wrote the answer. The CLI can bill a small helper model in
/// the same run, so the one that produced the most output is the answering one.
fn answering_model(usage: &Value) -> Option<String> {
    usage
        .as_object()?
        .iter()
        .max_by_key(|(_, u)| u["outputTokens"].as_i64().unwrap_or(0))
        .map(|(model, _)| model.clone())
}

#[async_trait]
impl LlmProvider for ClaudeCli {
    async fn complete(&self, prompt: &str) -> AppResult<LlmCompletion> {
        let mut args: Vec<String> = vec!["-p".into(), "--output-format".into(), "json".into()];
        if !self.model.is_empty() {
            args.extend(["--model".into(), self.model.clone()]);
        }
        // A zero thinking budget turns extended thinking off entirely.
        let env: &[(&str, &str)] = if self.enable_thinking { &[] } else { &[("MAX_THINKING_TOKENS", "0")] };
        let result = run_cli(&self.cli_path, &args, prompt, env).await?;
        let combined = format!("{}\n{}", result.stdout, result.stderr);
        const AUTH: [&str; 6] = [
            r"(?i)invalid.{0,20}(api key|token)",
            r"(?i)token.{0,20}expired",
            r"(?i)not (logged in|authenticated)",
            r"(?i)please run.{0,10}/?login",
            r"(?i)oauth.{0,20}(expired|revoked|invalid)",
            r"(?i)authentication[_ ]error",
        ];
        if matches_any(&AUTH, &combined) {
            return Err(AppError::with_details(ErrorCode::LlmAuthExpired, "Claude CLI session expired", head(&combined)));
        }
        let fallback = (!self.model.is_empty()).then(|| self.model.clone());
        // --output-format json wraps the answer in an envelope: { result: "..." }.
        if let Ok(envelope) = serde_json::from_str::<Value>(&result.stdout) {
            if envelope["is_error"].as_bool() == Some(true) {
                let subtype = envelope["subtype"].as_str().unwrap_or("unknown");
                return Err(AppError::with_details(ErrorCode::LlmFailed, format!("Claude CLI error: {subtype}"), head(&result.stdout)));
            }
            if let Some(text) = envelope["result"].as_str() {
                return Ok(LlmCompletion { text: text.to_string(), model: answering_model(&envelope["modelUsage"]).or(fallback) });
            }
        }
        // Some CLI versions print plain text despite the flag.
        if result.exit_code != 0 {
            return Err(AppError::with_details(ErrorCode::LlmFailed, "Claude CLI failed", head(&combined)));
        }
        Ok(LlmCompletion { text: result.stdout, model: fallback })
    }
}

/// Runs prompts through the GitHub Copilot CLI in programmatic (`-p`) mode.
pub struct CopilotCli {
    pub cli_path: String,
    pub model: String,
}

#[async_trait]
impl LlmProvider for CopilotCli {
    async fn complete(&self, prompt: &str) -> AppResult<LlmCompletion> {
        let mut args: Vec<String> = vec!["-p".into(), "-s".into()];
        if !self.model.is_empty() {
            args.extend(["--model".into(), self.model.clone()]);
        }
        let result = run_cli(&self.cli_path, &args, prompt, &[]).await?;
        let combined = format!("{}\n{}", result.stdout, result.stderr);
        const AUTH: [&str; 4] = [
            r"(?i)not (logged in|authenticated)",
            r"(?i)gh auth login",
            r"(?i)copilot.{0,30}(login|authenticate)",
            r"(?i)token.{0,20}(expired|invalid)",
        ];
        if matches_any(&AUTH, &combined) {
            return Err(AppError::with_details(ErrorCode::LlmAuthExpired, "Copilot CLI session expired", head(&combined)));
        }
        if result.exit_code != 0 {
            return Err(AppError::with_details(ErrorCode::LlmFailed, "Copilot CLI failed", head(&combined)));
        }
        // Silent mode prints only the answer, so the configured name is all we know.
        Ok(LlmCompletion { text: result.stdout, model: (!self.model.is_empty()).then(|| self.model.clone()) })
    }
}

/// Calls the OpenAI Chat Completions API (or any compatible endpoint).
pub struct OpenAiApi {
    pub config: OpenAiConfig,
    pub enable_thinking: bool,
    pub http: reqwest::Client,
}

impl OpenAiApi {
    /// Effort sent to reasoning models when thinking is disabled. Other models
    /// reject the parameter, so it is only sent for reasoning families.
    fn reasoning_effort(&self, model: &str) -> Option<&'static str> {
        if self.enable_thinking {
            return None;
        }
        let lower = model.to_lowercase();
        if lower.starts_with("gpt-5") {
            return Some("minimal");
        }
        if Regex::new(r"^o\d").unwrap().is_match(&lower) {
            return Some("low");
        }
        None
    }
}

#[async_trait]
impl LlmProvider for OpenAiApi {
    async fn complete(&self, prompt: &str) -> AppResult<LlmCompletion> {
        let OpenAiConfig { api_key, model, base_url } = &self.config;
        if api_key.is_empty() {
            return Err(AppError::new(ErrorCode::ConfigInvalid, "OpenAI API key is not configured"));
        }
        let model = if model.is_empty() { "gpt-4o-mini" } else { model.as_str() };
        let base = if base_url.is_empty() { "https://api.openai.com" } else { base_url.trim_end_matches('/') };
        let url = format!("{base}/v1/chat/completions");
        let started = Instant::now();
        logger::info("openai", &format!("POST {url}"), Some(json!({ "model": model, "promptLength": prompt.len() })));
        let mut body = json!({ "model": model, "messages": [{ "role": "user", "content": prompt }], "temperature": 0.2 });
        if let Some(effort) = self.reasoning_effort(model) {
            body["reasoning_effort"] = json!(effort);
        }
        let response = self
            .http
            .post(&url)
            .bearer_auth(api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::with_details(ErrorCode::LlmFailed, "Cannot reach the OpenAI API", e.to_string()))?;
        let status = response.status().as_u16();
        logger::info("openai", &format!("HTTP {status} in {}ms", started.elapsed().as_millis()), None);
        if status == 401 {
            return Err(AppError::new(ErrorCode::LlmAuthExpired, "OpenAI rejected the API key"));
        }
        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(AppError::with_details(ErrorCode::LlmFailed, format!("OpenAI returned HTTP {status}"), text));
        }
        let dto: Value = response
            .json()
            .await
            .map_err(|e| AppError::with_details(ErrorCode::LlmBadResponse, "OpenAI returned an unreadable response", e.to_string()))?;
        let content = dto["choices"][0]["message"]["content"].as_str().unwrap_or_default();
        if content.is_empty() {
            return Err(AppError::new(ErrorCode::LlmBadResponse, "OpenAI returned an empty response"));
        }
        let reported = dto["model"].as_str().filter(|m| !m.is_empty()).unwrap_or(model);
        Ok(LlmCompletion { text: content.to_string(), model: Some(reported.to_string()) })
    }
}
