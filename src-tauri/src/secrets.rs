//! Electron `safeStorage`-compatible encryption, so the Electron and Tauri
//! builds read each other's config. On Windows that is Chromium's OSCrypt:
//! an AES-256 key kept in "Local State", protected with DPAPI for the current
//! user, and values stored as "v10" + 12-byte nonce + AES-GCM ciphertext.
//!
//! macOS (Keychain) and Linux (libsecret) are not implemented yet; there
//! `is_available()` is false and tokens stay in the config, exactly as Electron
//! does when its encryption is unavailable.

use crate::paths;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::fs;
use std::sync::OnceLock;

static KEY: OnceLock<Option<Vec<u8>>> = OnceLock::new();

fn local_state_path() -> std::path::PathBuf {
    paths::user_data_dir().join("Local State")
}

/// The OSCrypt key, read from "Local State" or created there on first use.
fn key() -> Option<&'static [u8]> {
    KEY.get_or_init(|| read_key().or_else(create_key)).as_deref()
}

fn read_key() -> Option<Vec<u8>> {
    let state: Value = serde_json::from_str(&fs::read_to_string(local_state_path()).ok()?).ok()?;
    let encrypted = STANDARD.decode(state["os_crypt"]["encrypted_key"].as_str()?).ok()?;
    dpapi::unprotect(encrypted.strip_prefix(b"DPAPI")?)
}

/// Writes a new key into "Local State", keeping whatever else the file holds
/// (Chromium stores unrelated settings there too).
fn create_key() -> Option<Vec<u8>> {
    use rand::RngCore;
    let mut key = vec![0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    let protected = dpapi::protect(&key)?;
    let mut state: Value = fs::read_to_string(local_state_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| json!({}));
    let mut blob = b"DPAPI".to_vec();
    blob.extend_from_slice(&protected);
    if !state.is_object() {
        state = json!({});
    }
    state["os_crypt"] = json!({ "encrypted_key": STANDARD.encode(blob) });
    fs::create_dir_all(paths::user_data_dir()).ok()?;
    fs::write(local_state_path(), serde_json::to_string(&state).ok()?).ok()?;
    Some(key)
}

pub fn is_available() -> bool {
    cfg!(windows) && key().is_some()
}

/// `safeStorage.encryptString(value).toString('base64')`; '' stays ''.
pub fn encrypt(value: &str) -> String {
    use aes_gcm::aead::{Aead, KeyInit, OsRng};
    use aes_gcm::{AeadCore, Aes256Gcm};

    if value.is_empty() {
        return String::new();
    }
    let Some(key) = key() else { return String::new() };
    let Ok(cipher) = Aes256Gcm::new_from_slice(key) else { return String::new() };
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let Ok(sealed) = cipher.encrypt(&nonce, value.as_bytes()) else { return String::new() };
    let mut raw = b"v10".to_vec();
    raw.extend_from_slice(&nonce);
    raw.extend_from_slice(&sealed);
    STANDARD.encode(raw)
}

/// `safeStorage.decryptString`; '' when the value is missing or unreadable.
pub fn decrypt(value: Option<&str>) -> String {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};

    let Some(value) = value.filter(|v| !v.is_empty()) else { return String::new() };
    let Ok(raw) = STANDARD.decode(value) else { return String::new() };
    let plain = match raw.strip_prefix(b"v10") {
        Some(rest) if rest.len() > 12 => key().and_then(|key| {
            let cipher = Aes256Gcm::new_from_slice(key).ok()?;
            cipher.decrypt(Nonce::from_slice(&rest[..12]), &rest[12..]).ok()
        }),
        // Values written before OSCrypt keys were plain DPAPI blobs.
        _ => dpapi::unprotect(&raw),
    };
    plain.and_then(|p| String::from_utf8(p).ok()).unwrap_or_default()
}

#[cfg(windows)]
mod dpapi {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };

    fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
    }

    /// SAFETY (both functions): the input blob points at `data` for the
    /// duration of the call; on success Windows allocates the output buffer,
    /// which is copied and released with LocalFree.
    unsafe fn take(output: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let out = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData as _);
        out
    }

    pub fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
        let input = blob(data);
        let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() };
        unsafe {
            if CryptUnprotectData(&input, null_mut(), null(), null(), null(), 0, &mut output) == 0 {
                return None;
            }
            Some(take(output))
        }
    }

    pub fn protect(data: &[u8]) -> Option<Vec<u8>> {
        let input = blob(data);
        let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() };
        unsafe {
            if CryptProtectData(&input, null(), null(), null(), null(), 0, &mut output) == 0 {
                return None;
            }
            Some(take(output))
        }
    }
}

#[cfg(not(windows))]
mod dpapi {
    pub fn unprotect(_data: &[u8]) -> Option<Vec<u8>> {
        None
    }
    pub fn protect(_data: &[u8]) -> Option<Vec<u8>> {
        None
    }
}
