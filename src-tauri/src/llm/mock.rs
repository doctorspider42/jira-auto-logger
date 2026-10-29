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
    Value::Array(entries).to_string()
}
