//! Fake LLM for mock mode: reads the input JSON embedded in the prompt and
//! answers with deterministic, plausible suggestions after a short delay. The
//! answer goes through the real parsing and validation.

use super::providers::{LlmCompletion, LlmProvider};
use crate::error::AppResult;
use crate::mock::data::mulberry32;
use async_trait::async_trait;
use serde_json::{json, Map, Value};
use std::time::Duration;

pub struct MockLlm;

#[async_trait]
impl LlmProvider for MockLlm {
    async fn complete(&self, prompt: &str) -> AppResult<LlmCompletion> {
        tokio::time::sleep(Duration::from_millis(1500)).await;
        Ok(LlmCompletion { text: respond(prompt), model: Some("mock-model".into()) })
    }
}

fn respond(prompt: &str) -> String {
    if prompt.contains("ONLY a JSON object") {
        return regenerate(prompt);
    }
    if !prompt.contains("JSON array") {
        return "Adjusted the implementation according to review feedback and extended the tests.".into();
    }
    // The input is a single-line compact JSON object containing "dates".
    let Some(input) = prompt
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with('{') && l.contains("\"dates\""))
        .and_then(|l| serde_json::from_str::<Value>(l).ok())
    else {
        return "[]".into();
    };
    let issues = input["issues"].as_array().cloned().unwrap_or_default();
    let dates = input["dates"].as_array().cloned().unwrap_or_default();
    let fields = input["customFields"].as_array().cloned().unwrap_or_default();
    let mut random = mulberry32((issues.len() * 7 + dates.len()) as u32);
    let per_day: &[f64] = if input["projectCount"].as_u64().unwrap_or(1) > 1 { &[4.0] } else { &[5.0, 3.0] };
    let day_target: f64 = per_day.iter().sum();

    let mut entries = Vec::new();
    for date in dates.iter().filter_map(Value::as_str) {
        // Only fill the day's remaining budget, mirroring the real prompt.
        let remaining = (day_target - input["hoursAlreadyLogged"][date].as_f64().unwrap_or(0.0)).max(0.0);
        if remaining <= 0.0 {
            continue;
        }
        let scale = remaining / day_target;
        for (slot, hours) in per_day.iter().enumerate() {
            let scaled = (hours * scale * 4.0).round() / 4.0;
            if scaled <= 0.0 {
                continue;
            }
            let index = (random() * issues.len().max(1) as f64).floor() as usize;
            let issue = issues.get(index);
            let custom: Map<String, Value> = fields
                .iter()
                .map(|f| {
                    let key = f["key"].as_str().unwrap_or_default().to_string();
                    let value = if f["type"] == "boolean" { json!(random() < 0.2) } else { json!("") };
                    (key, value)
                })
                .collect();
            let mut entry = json!({
                "date": date,
                "issueKey": issue.and_then(|i| i["key"].as_str()).unwrap_or(""),
                "description": match issue {
                    Some(i) => format!(
                        "{} {}; addressed review remarks",
                        if slot == 0 { "Worked on" } else { "Continued" },
                        i["summary"].as_str().unwrap_or_default().to_lowercase()
                    ),
                    None => "Project work".into(),
                },
                "hours": scaled,
            });
            if !fields.is_empty() {
                entry["customFields"] = Value::Object(custom);
            }
            entries.push(entry);
        }
    }
    // With new issues allowed, the last entry of the first day becomes work no
    // existing issue covers - enough to exercise the whole create flow.
    if input["allowNewIssues"].as_bool().unwrap_or(false) {
        if let Some(entry) = dates.first().and_then(|first| entries.iter_mut().rev().find(|e| &e["date"] == first)) {
            entry["issueKey"] = json!("");
            entry["description"] = json!("Tracked down the flaky login e2e test and added retries around the mock server start");
            entry["newIssue"] = json!({
                "summary": "Fix flaky end-to-end tests on CI",
                "description": "The login e2e test fails intermittently because the mock server is not ready when the suite starts."
            });
        }
    }
    Value::Array(entries).to_string()
}

/// Regenerate answer: moves the entry to an issue key named in the change
/// request (so the issue switch can be tried in mock mode), else keeps it.
fn regenerate(prompt: &str) -> String {
    let line_after = |label: &str| prompt.split(label).nth(1).and_then(|rest| rest.lines().map(str::trim).find(|l| !l.is_empty())).unwrap_or("");
    let current = serde_json::from_str::<Value>(line_after("Current entry:")).ok();
    let current_key = current.as_ref().and_then(|v| v["issueKey"].as_str()).unwrap_or("").to_string();
    let hint = line_after("Change request from the developer:").to_uppercase();
    let named = hint
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
        .find(|w| w.contains('-') && prompt.contains(&format!("- {w}:")))
        .map(str::to_string);
    json!({
        "issueKey": named.unwrap_or(current_key),
        "description": "Adjusted the implementation according to review feedback and extended the tests.",
    })
    .to_string()
}
