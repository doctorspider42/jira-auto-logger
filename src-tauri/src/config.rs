//! Port of `ConfigService.load()`: reads the config the Electron app saved, merges
//! it over the defaults and decrypts the tokens Electron encrypted with
//! `safeStorage`. Legacy shape migrations (single-Jira configs, old project and
//! prompt fields) are not ported in this trial.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

/// Electron's userData folder, named after the package. It sits in the same
/// base folder Electron uses: %APPDATA% on Windows, ~/Library/Application
/// Support on macOS, ~/.config on Linux.
fn user_data_dir() -> Option<PathBuf> {
    Some(dirs::config_dir()?.join("jira-auto-logger"))
}

pub fn file_path() -> Option<PathBuf> {
    Some(user_data_dir()?.join("config.json"))
}

/// Mirrors `defaultConfig()` in ConfigService.ts.
fn default_config() -> Value {
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
            "filenameTemplate": "{MM}.{YYYY}.pdf",
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

/// Shallow merge, like `{ ...defaults, ...stored }`.
fn merge(defaults: &Value, stored: Option<&Value>) -> Value {
    let mut out = defaults.as_object().cloned().unwrap_or_default();
    if let Some(Value::Object(stored)) = stored {
        for (k, v) in stored {
            out.insert(k.clone(), v.clone());
        }
    }
    Value::Object(out)
}

pub fn load() -> Value {
    let defaults = default_config();
    let Some(path) = file_path() else { return defaults };
    let Ok(text) = fs::read_to_string(&path) else { return defaults };
    let Ok(stored) = serde_json::from_str::<Value>(&text) else { return defaults };
    let stored_config = &stored["config"];
    let secrets = stored["secrets"].as_object().cloned().unwrap_or_default();

    let mut config = merge(&defaults, Some(stored_config));
    for section in ["llm", "issuePool", "updates", "telemetry", "reports", "autoLogger"] {
        config[section] = merge(&defaults[section], stored_config.get(section));
    }
    if let Some(llm) = config["llm"].as_object_mut() {
        llm.remove("mainPrompt");
    }
    config["connections"] = stored_config.get("connections").cloned().unwrap_or(json!([]));
    config["lastUsed"] = json!({ "selections": stored_config["lastUsed"]["selections"].as_array().cloned().unwrap_or_default() });

    let key = os_crypt_key();
    let reveal = |name: String| -> Option<String> {
        decrypt(secrets.get(&name)?.as_str()?, key.as_deref())
    };
    if let Some(connections) = config["connections"].as_array_mut() {
        for connection in connections.iter_mut() {
            let id = connection["id"].as_str().unwrap_or_default().to_string();
            if let Some(token) = reveal(format!("jira:{id}")) {
                connection["jira"]["apiToken"] = json!(token);
            }
            if let Some(token) = reveal(format!("tempo:{id}")) {
                connection["tempo"]["apiToken"] = json!(token);
            }
        }
    }
    if let Some(token) = reveal("openAiApiKey".into()) {
        config["llm"]["openAi"]["apiKey"] = json!(token);
    }

    // Projects, custom fields and active ids must reference an existing connection.
    let known: HashSet<String> = config["connections"]
        .as_array()
        .map(|c| c.iter().filter_map(|c| c["id"].as_str().map(String::from)).collect())
        .unwrap_or_default();
    let references_known = |v: &Value, field: &str| v[field].as_str().is_some_and(|id| known.contains(id));

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
                .filter(|t| references_known(t, "connectionId"))
                .collect();
            if targets.is_empty() {
                return None;
            }
            p["targets"] = json!(targets);
            if p["archived"].is_null() {
                p["archived"] = json!(false);
            }
            Some(p)
        })
        .collect();
    config["projects"] = json!(projects);

    let fields: Vec<Value> = config["customFields"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|f| references_known(f, "connectionId"))
        .collect();
    config["customFields"] = json!(fields);

    let mut active: Vec<Value> = config["activeConnectionIds"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|id| id.as_str().is_some_and(|id| known.contains(id)))
        .collect();
    if active.is_empty() {
        active = known.iter().map(|id| json!(id)).collect();
    }
    config["activeConnectionIds"] = json!(active);

    config
}

/// The AES key Chromium (and so Electron's `safeStorage`) keeps in "Local
/// State", itself protected with DPAPI for the current Windows user.
fn os_crypt_key() -> Option<Vec<u8>> {
    let text = fs::read_to_string(user_data_dir()?.join("Local State")).ok()?;
    let state: Map<String, Value> = serde_json::from_str(&text).ok()?;
    let encrypted = STANDARD.decode(state.get("os_crypt")?["encrypted_key"].as_str()?).ok()?;
    dpapi_unprotect(encrypted.strip_prefix(b"DPAPI")?)
}

/// `safeStorage.decryptString`: "v10" + 12-byte nonce + AES-256-GCM ciphertext,
/// or plain DPAPI for values written by older versions.
fn decrypt(value: &str, key: Option<&[u8]>) -> Option<String> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};

    if value.is_empty() {
        return None;
    }
    let raw = STANDARD.decode(value).ok()?;
    let plain = match raw.strip_prefix(b"v10") {
        Some(rest) if rest.len() > 12 => {
            let cipher = Aes256Gcm::new_from_slice(key?).ok()?;
            cipher.decrypt(Nonce::from_slice(&rest[..12]), &rest[12..]).ok()?
        }
        _ => dpapi_unprotect(&raw)?,
    };
    String::from_utf8(plain).ok()
}

#[cfg(windows)]
fn dpapi_unprotect(data: &[u8]) -> Option<Vec<u8>> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() };
    // SAFETY: input points at `data` for the duration of the call; on success
    // the output buffer is allocated by Windows and released with LocalFree.
    unsafe {
        if CryptUnprotectData(&input, null_mut(), null(), null(), null(), 0, &mut output) == 0 {
            return None;
        }
        let out = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData as _);
        Some(out)
    }
}

/// macOS (Keychain) and Linux (libsecret) keys are not ported in this trial.
#[cfg(not(windows))]
fn dpapi_unprotect(_data: &[u8]) -> Option<Vec<u8>> {
    None
}
