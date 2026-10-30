//! Port of `ConfigService`: persists the app configuration as JSON in the
//! userData folder, with API tokens encrypted (see `secrets`). All shape
//! migrations live in `load()`, as in the Electron version.

use crate::domain::AppConfig;
use crate::report_filename::{validate_template, DEFAULT_TEMPLATE};
use crate::{logger, mock, paths, secrets};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

const LEGACY_DEFAULT_MAIN_PROMPT: &str = include_str!("legacy_prompt.txt");

pub fn default_config_value() -> Value {
    json!({
        "connections": [],
        "activeConnectionIds": [],
        "projects": [],
        "customFields": [],
        "llm": {
            "backend": "claude-cli",
            "openAi": { "apiKey": "", "model": "gpt-4o-mini", "baseUrl": "" },
            "claudeCliPath": "claude",
            "claudeModel": "",
            "copilotCliPath": "copilot",
            "copilotModel": "",
            "additionalInstructions": "",
            "enableThinking": true
        },
        "language": "pl",
        "themeId": "dark",
        "workingHoursPerDay": 8,
        "workdayStart": "09:00",
        "showWeekends": true,
        "issuePool": { "lookbackDays": 60, "maxIssues": 100 },
        "updates": { "mode": "ask" },
        "telemetry": { "enabled": true },
        "reports": {
            "outputDirectory": "",
            "filenameTemplate": DEFAULT_TEMPLATE,
            "reminderOffsetDays": 0,
            "defaultGrouping": "project",
            "defaultLayout": "summary",
            "defaultGroupings": ["project", "issue"],
            "defaultColumns": ["date", "issue", "description", "connection"],
            "defaultTimeFormat": "hours",
            "defaultOrientation": "portrait",
            "includeSummary": false,
            "accentColor": "#172b4d",
            "title": "",
            "showGeneratedAt": true,
            "showPageNumbers": true
        },
        "autoLogger": { "mode": "off", "runAt": "17:00", "launchAtLogin": false, "minimizeToTray": false },
        "lastUsed": { "selections": [] }
    })
}

pub fn default_config() -> AppConfig {
    serde_json::from_value(default_config_value()).expect("default config is valid")
}

pub struct ConfigService {
    cached: RwLock<Option<AppConfig>>,
}

impl ConfigService {
    pub fn new() -> Self {
        Self { cached: RwLock::new(None) }
    }

    pub fn file_path(&self) -> PathBuf {
        paths::user_data_dir().join("config.json")
    }

    pub fn get(&self) -> AppConfig {
        if let Some(config) = self.cached.read().unwrap().clone() {
            return config;
        }
        let mut config = if paths::is_mock_mode() { mock::data::mock_config() } else { self.load() };
        // Dev/test affordance: `JAL_THEME=<id>` forces a theme at launch.
        if let Ok(theme) = std::env::var("JAL_THEME") {
            if !theme.trim().is_empty() {
                config.theme_id = theme.trim().to_string();
            }
        }
        *self.cached.write().unwrap() = Some(config.clone());
        config
    }

    pub fn set(&self, config: AppConfig) -> Result<(), String> {
        *self.cached.write().unwrap() = Some(config.clone());
        // Mock mode never touches the real config file.
        if paths::is_mock_mode() {
            return Ok(());
        }
        let mut plain = config;
        let mut secrets_map = Map::new();
        if secrets::is_available() {
            for connection in plain.connections.iter_mut() {
                secrets_map.insert(format!("jira:{}", connection.id), json!(secrets::encrypt(&connection.jira.api_token)));
                secrets_map.insert(format!("tempo:{}", connection.id), json!(secrets::encrypt(&connection.tempo.api_token)));
                connection.jira.api_token.clear();
                connection.tempo.api_token.clear();
            }
            secrets_map.insert("openAiApiKey".into(), json!(secrets::encrypt(&plain.llm.open_ai.api_key)));
            plain.llm.open_ai.api_key.clear();
        }
        let stored = json!({ "config": plain, "secrets": secrets_map });
        let path = self.file_path();
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let text = serde_json::to_string_pretty(&stored).map_err(|e| e.to_string())?;
        fs::write(&path, text).map_err(|e| e.to_string())
    }

    fn load(&self) -> AppConfig {
        let Ok(text) = fs::read_to_string(self.file_path()) else { return default_config() };
        match serde_json::from_str::<Value>(&text).map(|stored| migrate(&stored)) {
            Ok(value) => serde_json::from_value(value).unwrap_or_else(|e| {
                logger::error("config", "config does not match the expected shape", Some(json!(e.to_string())));
                default_config()
            }),
            Err(_) => default_config(),
        }
    }
}

fn merge(defaults: &Value, stored: Option<&Value>) -> Value {
    let mut out = defaults.as_object().cloned().unwrap_or_default();
    if let Some(Value::Object(stored)) = stored {
        for (k, v) in stored {
            out.insert(k.clone(), v.clone());
        }
    }
    Value::Object(out)
}

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn string_list(value: &Value) -> Vec<String> {
    value.as_array().map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default()
}

/// Maps a stored config (`{ config, secrets }`) of any past version onto the
/// current shape. Mirrors `ConfigService.load()` step by step.
pub fn migrate(stored: &Value) -> Value {
    let defaults = default_config_value();
    let sc = &stored["config"];
    let secrets_map = stored["secrets"].as_object().cloned().unwrap_or_default();
    let secret = |name: &str| secrets_map.get(name).and_then(Value::as_str).map(String::from);

    let mut config = merge(&defaults, Some(sc));
    config["llm"] = merge(&defaults["llm"], sc.get("llm"));
    config["llm"]["openAi"] = merge(&defaults["llm"]["openAi"], sc["llm"].get("openAi"));
    migrate_legacy_main_prompt(&mut config);
    for section in ["issuePool", "updates", "telemetry", "reports", "autoLogger"] {
        config[section] = merge(&defaults[section], sc.get(section));
    }

    let auto = &mut config["autoLogger"];
    if !["off", "notify", "confirm", "auto"].contains(&str_of(auto, "mode")) {
        auto["mode"] = json!("off");
    }
    let run_at = Regex::new(r"^([01]\d|2[0-3]):[0-5]\d$").unwrap();
    if !run_at.is_match(str_of(auto, "runAt")) {
        auto["runAt"] = defaults["autoLogger"]["runAt"].clone();
    }

    let reports = &mut config["reports"];
    if validate_template(str_of(reports, "filenameTemplate")).is_some() {
        reports["filenameTemplate"] = defaults["reports"]["filenameTemplate"].clone();
    }
    if !reports["defaultGroupings"].is_array() {
        let legacy = str_of(reports, "defaultGrouping").to_string();
        reports["defaultGroupings"] = if legacy == "none" { json!([]) } else { json!([legacy]) };
    }
    if !reports["defaultColumns"].is_array() {
        reports["defaultColumns"] = defaults["reports"]["defaultColumns"].clone();
    }
    for (field, allowed) in [
        ("defaultLayout", &["summary", "detailed"][..]),
        ("defaultTimeFormat", &["hours", "hours-minutes"][..]),
        ("defaultOrientation", &["portrait", "landscape"][..]),
    ] {
        if !allowed.contains(&str_of(reports, field)) {
            reports[field] = defaults["reports"][field].clone();
        }
    }
    let hex = Regex::new(r"(?i)^#[0-9a-f]{6}$").unwrap();
    if !hex.is_match(str_of(reports, "accentColor")) {
        reports["accentColor"] = defaults["reports"]["accentColor"].clone();
    }
    let offset = &reports["reminderOffsetDays"];
    if !offset.is_null() && !offset.as_i64().is_some_and(|d| (-7..=7).contains(&d)) {
        reports["reminderOffsetDays"] = json!(0);
    }

    config["connections"] = sc.get("connections").filter(|c| c.is_array()).cloned().unwrap_or(json!([]));
    config["lastUsed"] = json!({ "selections": sc["lastUsed"]["selections"].as_array().cloned().unwrap_or_default() });

    // Repositories used to live in a standalone registry with a global author
    // filter; projects used to pin a single connection/Jira project and folder.
    let legacy_author = str_of(sc, "gitAuthor").to_string();
    let legacy_folders = sc["gitFolders"].as_array().cloned().unwrap_or_default();
    let projects: Vec<Value> = sc["projects"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(index, mut project)| {
            let mut folders: Vec<Value> = project["gitFolders"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|f| !str_of(f, "path").is_empty())
                .collect();
            if folders.is_empty() {
                let mut git_folder = project.get("gitFolder").filter(|f| !f.is_null()).cloned();
                let legacy_path = str_of(&project, "gitFolderPath").to_string();
                if git_folder.is_none() && !legacy_path.is_empty() {
                    git_folder = Some(
                        legacy_folders
                            .iter()
                            .find(|f| str_of(f, "path") == legacy_path)
                            .cloned()
                            .unwrap_or_else(|| json!({ "path": legacy_path, "label": "", "author": legacy_author, "includeAllAuthors": false })),
                    );
                }
                folders.extend(git_folder);
            }
            let folders: Vec<Value> = folders
                .into_iter()
                .map(|f| {
                    json!({
                        "path": str_of(&f, "path"),
                        "label": str_of(&f, "label"),
                        "author": f.get("author").and_then(Value::as_str).unwrap_or(&legacy_author),
                        "includeAllAuthors": f["includeAllAuthors"].as_bool().unwrap_or(false),
                    })
                })
                .collect();

            let mut targets: Vec<Value> = project["targets"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|t| !str_of(t, "connectionId").is_empty() && !str_of(t, "jiraProjectKey").is_empty())
                .collect();
            if targets.is_empty() && !str_of(&project, "connectionId").is_empty() && !str_of(&project, "jiraProjectKey").is_empty() {
                targets.push(json!({
                    "id": new_id(),
                    "connectionId": str_of(&project, "connectionId"),
                    "jiraProjectKey": str_of(&project, "jiraProjectKey"),
                }));
            }
            for target in targets.iter_mut() {
                if str_of(target, "id").is_empty() {
                    target["id"] = json!(new_id());
                }
            }

            project["targets"] = json!(targets);
            project["gitFolders"] = json!(folders);
            if !project["color"].is_string() {
                project["color"] = json!(crate::domain::PROJECT_COLOR_PALETTE[index % 8]);
            }
            if !project["archived"].is_boolean() {
                project["archived"] = json!(false);
            }
            project
        })
        .collect();
    config["projects"] = json!(projects);

    migrate_legacy_connection(&mut config, sc, &secret);

    if secrets::is_available() {
        if let Some(connections) = config["connections"].as_array_mut() {
            for connection in connections.iter_mut() {
                let id = str_of(connection, "id").to_string();
                let jira = secrets::decrypt(secret(&format!("jira:{id}")).as_deref());
                if !jira.is_empty() {
                    connection["jira"]["apiToken"] = json!(jira);
                }
                let tempo = secrets::decrypt(secret(&format!("tempo:{id}")).as_deref());
                if !tempo.is_empty() {
                    connection["tempo"]["apiToken"] = json!(tempo);
                }
            }
        }
        let open_ai = secrets::decrypt(secret("openAiApiKey").as_deref());
        if !open_ai.is_empty() {
            config["llm"]["openAi"]["apiKey"] = json!(open_ai);
        }
    }

    // Projects, custom fields and active ids must reference an existing connection.
    let known: HashSet<String> = config["connections"]
        .as_array()
        .map(|c| c.iter().map(|c| str_of(c, "id").to_string()).collect())
        .unwrap_or_default();
    let projects: Vec<Value> = config["projects"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|mut p| {
            let targets: Vec<Value> = p["targets"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|t| known.contains(str_of(t, "connectionId")))
                .collect();
            if targets.is_empty() {
                return None;
            }
            p["targets"] = json!(targets);
            Some(p)
        })
        .collect();
    config["projects"] = json!(projects);

    let fields: Vec<Value> = sc["customFields"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|f| known.contains(str_of(f, "connectionId")))
        .map(|mut f| {
            for (key, default) in [("instruction", json!("")), ("showInCalendar", json!(false)), ("calendarIcon", json!(""))] {
                if f[key].is_null() {
                    f[key] = default;
                }
            }
            f
        })
        .collect();
    config["customFields"] = json!(fields);

    let custom_ids: HashSet<String> = fields.iter().map(|f| str_of(f, "id").to_string()).collect();
    let keep_valid = |values: Vec<String>, base: &[&str], limit: usize| -> Value {
        let mut seen = HashSet::new();
        let kept: Vec<String> = values
            .into_iter()
            .filter(|k| {
                let valid = base.contains(&k.as_str())
                    || k.strip_prefix("custom:").is_some_and(|id| custom_ids.contains(id));
                valid && seen.insert(k.clone())
            })
            .take(limit)
            .collect();
        json!(kept)
    };
    let groupings = string_list(&config["reports"]["defaultGroupings"]);
    config["reports"]["defaultGroupings"] =
        keep_valid(groupings, &["project", "issue", "day", "connection", "worklog"], 5);
    let columns = string_list(&config["reports"]["defaultColumns"]);
    config["reports"]["defaultColumns"] =
        keep_valid(columns, &["date", "project", "issue", "description", "connection"], usize::MAX);

    let mut active: Vec<Value> = config["activeConnectionIds"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|id| id.as_str().is_some_and(|id| known.contains(id)))
        .collect();
    if active.is_empty() {
        active = config["connections"]
            .as_array()
            .map(|c| c.iter().map(|c| c["id"].clone()).collect())
            .unwrap_or_default();
    }
    config["activeConnectionIds"] = json!(active);

    config
}

/// The main prompt used to live in `llm.mainPrompt`, fully editable. Its own
/// lines - the ones not in the old default - move to `additionalInstructions`
/// so rules the user wrote there keep applying. See ConfigService.ts.
fn migrate_legacy_main_prompt(config: &mut Value) {
    let Some(llm) = config["llm"].as_object_mut() else { return };
    let stored = llm.remove("mainPrompt").and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
    let existing = llm.get("additionalInstructions").and_then(Value::as_str).unwrap_or("");
    if stored.trim().is_empty() || !existing.trim().is_empty() {
        return;
    }
    let placeholder = Regex::new(r"\{\{\w+\}\}").unwrap();
    let spaces = Regex::new(r"\s+").unwrap();
    let normalize = |line: &str| spaces.replace_all(&placeholder.replace_all(line, ""), " ").trim().to_string();
    let built_in: HashSet<String> = LEGACY_DEFAULT_MAIN_PROMPT.split('\n').map(normalize).collect();
    let custom: Vec<String> = stored
        .split('\n')
        .map(normalize)
        .filter(|line| !line.is_empty() && !built_in.contains(line))
        .collect();
    if !custom.is_empty() {
        llm.insert("additionalInstructions".into(), json!(custom.join("\n")));
    }
}

/// Wraps a single-Jira config (pre-multi-connection) into a connection.
fn migrate_legacy_connection(config: &mut Value, sc: &Value, secret: &dyn Fn(&str) -> Option<String>) {
    let has_connections = config["connections"].as_array().is_some_and(|c| !c.is_empty());
    let base_url = str_of(&sc["jira"], "baseUrl");
    if has_connections || base_url.is_empty() {
        return;
    }
    let mut jira = sc["jira"].clone();
    let mut tempo = if sc["tempo"].is_object() { sc["tempo"].clone() } else { json!({ "apiToken": "" }) };
    if secrets::is_available() {
        let token = secrets::decrypt(secret("jiraApiToken").as_deref());
        if !token.is_empty() {
            jira["apiToken"] = json!(token);
        }
        let token = secrets::decrypt(secret("tempoApiToken").as_deref());
        if !token.is_empty() {
            tempo["apiToken"] = json!(token);
        }
    }
    let name = reqwest::Url::parse(base_url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.split('.').next().unwrap_or("Jira").to_string()))
        .unwrap_or_else(|| "Jira".into());
    let id = new_id();
    config["connections"] = json!([{ "id": id, "name": name, "jira": jira, "tempo": tempo }]);
    config["activeConnectionIds"] = json!([id]);
}
