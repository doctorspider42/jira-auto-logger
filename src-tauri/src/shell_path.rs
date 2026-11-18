//! Apps started from Finder, the Dock or a LaunchAgent get launchd's bare
//! PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), so CLIs installed in
//! `~/.local/bin`, Homebrew or nvm are invisible to `which` - and npm CLIs
//! can't find `node` either. At startup we merge in the PATH the user's login
//! shell would have, plus the usual install folders as a fallback.

#[cfg(unix)]
pub fn extend_from_login_shell() {
    use std::collections::HashSet;
    use std::path::PathBuf;

    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut dirs: Vec<PathBuf> = std::env::split_paths(&current).collect();
    let mut extra: Vec<PathBuf> = login_shell_path().map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if let Some(home) = dirs::home_dir() {
        for rel in [".local/bin", ".claude/local", ".npm-global/bin", ".volta/bin", ".bun/bin", ".cargo/bin"] {
            extra.push(home.join(rel));
        }
    }
    extra.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));

    let mut seen: HashSet<PathBuf> = dirs.iter().cloned().collect();
    for dir in extra {
        if !dir.as_os_str().is_empty() && seen.insert(dir.clone()) {
            dirs.push(dir);
        }
    }
    if let Ok(joined) = std::env::join_paths(dirs) {
        // Called first thing in main, before any other thread exists.
        std::env::set_var("PATH", joined);
    }
}

#[cfg(not(unix))]
pub fn extend_from_login_shell() {}

/// Asks the user's login + interactive shell for its PATH. Interactive rc
/// files may print banners, so the value is fenced with markers. Gives up
/// after a few seconds so a slow rc file can't hang the launch.
#[cfg(unix)]
fn login_shell_path() -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    const START: &str = "__JAL_PATH_START__";
    const END: &str = "__JAL_PATH_END__";
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .args(["-ilc", &format!("printf '%s%s%s' '{START}' \"$PATH\" '{END}'")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    let start = out.find(START)? + START.len();
    let end = out[start..].find(END)? + start;
    Some(out[start..end].to_string())
}
