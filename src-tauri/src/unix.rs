//! macOS and Linux integration. Never fall back to an unprotected vault key.
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
    Aes256Gcm, Nonce,
};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use sysinfo::{
    Pid, ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, Signal, System, UpdateKind,
};
use zeroize::Zeroizing;

type R<T> = Result<T, String>;
const HEADER: &[u8] = b"CodexHarbor/AEAD/v1\0";

pub fn vault_root() -> R<PathBuf> {
    let home = super::user_home()?;
    if cfg!(target_os = "macos") {
        Ok(home.join("Library/Application Support/CodexHarbor"))
    } else {
        Ok(std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .unwrap_or_else(|| home.join(".local/share"))
            .join("CodexHarbor"))
    }
}

pub fn preferred_languages() -> Vec<String> {
    sys_locale::get_locales().collect()
}

pub fn secure_dir(path: &Path) -> R<()> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "Could not inspect vault directory.")?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Vault directory must be a real directory, not a symbolic link.".into());
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| "Could not restrict vault directory access.".into())
}

pub fn atomic(path: &Path, bytes: &[u8]) -> R<()> {
    let parent = path.parent().ok_or("Missing file directory.")?;
    let temporary = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let outcome = (|| {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|_| "Could not create private temporary file.")?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Could not save file.")?;
        drop(file);
        fs::rename(&temporary, path).map_err(|_| "Could not atomically replace file.")?;
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| "Could not synchronize file directory.")?;
        Ok(())
    })();
    if outcome.is_err() {
        let _ = fs::remove_file(temporary);
    }
    outcome
}

#[cfg(not(test))]
fn vault_key(decrypt: bool) -> R<Zeroizing<Vec<u8>>> {
    let entry = keyring::Entry::new("local.codexharbor.desktop", "vault-key-v1")
        .map_err(|_| "Could not access the system credential store.")?;
    let key = match entry.get_secret() {
        Ok(key) => Zeroizing::new(key),
        Err(keyring::Error::NoEntry) if !decrypt => {
            // An existing vault without its key is unrecoverable. Never silently replace its key.
            let root = vault_root()?;
            if fs::read_dir(root).into_iter().flatten().flatten().any(|entry| {
                entry.path().extension().is_some_and(|extension| {
                    extension == "vault" || extension == "previous" || extension == "dpapi"
                })
            }) {
                return Err("The vault encryption key is missing from your system credential store. Restore the original key before saving accounts.".into());
            }
            let key = Zeroizing::new(Aes256Gcm::generate_key(&mut OsRng).to_vec());
            entry.set_secret(&key).map_err(|_| "Could not save the vault key. Unlock macOS Keychain or your Linux Secret Service (GNOME Keyring/KWallet) and try again.")?;
            key
        }
        Err(_) => return Err("Could not unlock the vault key. Unlock macOS Keychain or your Linux Secret Service (GNOME Keyring/KWallet) and try again.".into()),
    };
    if key.len() != 32 {
        return Err("The system credential store contains an invalid vault key.".into());
    }
    Ok(key)
}

// Unit tests use synthetic keys and never access a developer's or CI user's keychain.
#[cfg(test)]
fn vault_key(_: bool) -> R<Zeroizing<Vec<u8>>> {
    Ok(Zeroizing::new(vec![42; 32]))
}

pub fn protect(bytes: &[u8], entropy: &[u8], decrypt: bool) -> R<Vec<u8>> {
    let key = vault_key(decrypt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "Invalid vault key.")?;
    if decrypt {
        let encrypted = bytes
            .strip_prefix(HEADER)
            .ok_or("Unrecognized vault format.")?;
        if encrypted.len() < 12 + 16 {
            return Err("Truncated vault data.".into());
        }
        cipher
            .decrypt(
                Nonce::from_slice(&encrypted[..12]),
                Payload {
                    msg: &encrypted[12..],
                    aad: entropy,
                },
            )
            .map_err(|_| "Could not authenticate or decrypt the vault.".into())
    } else {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let encrypted = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: bytes,
                    aad: entropy,
                },
            )
            .map_err(|_| "Could not encrypt the vault.")?;
        let mut output = HEADER.to_vec();
        output.extend_from_slice(&nonce);
        output.extend_from_slice(&encrypted);
        Ok(output)
    }
}

fn executable(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

fn from_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .filter(|directory| directory.is_absolute())
        .map(|directory| directory.join(name))
        .find(|path| executable(path))
}

/// A configured path is a single executable path, never shell command text.
fn override_path(variable: &str) -> R<Option<PathBuf>> {
    let Some(path) = std::env::var_os(variable) else {
        return Ok(None);
    };
    let path = PathBuf::from(path);
    if !path.is_absolute() || !executable(&path) {
        return Err(format!(
            "{variable} must be an absolute path to an installed executable."
        ));
    }
    fs::canonicalize(path)
        .map(Some)
        .map_err(|_| format!("Could not resolve {variable}."))
}

fn desktop() -> R<PathBuf> {
    if let Some(path) = override_path("CODEX_DESKTOP_PATH")? {
        return Ok(path);
    }
    let home = super::user_home()?;
    let candidates = if cfg!(target_os = "macos") {
        [PathBuf::from("/Applications"), home.join("Applications")]
            .into_iter()
            .flat_map(|root| {
                [
                    root.join("Codex.app/Contents/MacOS/Codex"),
                    root.join("ChatGPT.app/Contents/MacOS/ChatGPT"),
                ]
            })
            .collect::<Vec<_>>()
    } else {
        let mut candidates = [
            "/opt/ChatGPT/chatgpt",
            "/opt/chatgpt/chatgpt",
            "/opt/Codex/codex",
            "/opt/codex/codex",
            "/usr/lib/chatgpt/chatgpt",
        ]
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
        candidates.extend(from_path("chatgpt"));
        candidates
    };
    let mut candidates: Vec<_> = candidates
        .into_iter()
        .filter(|path| executable(path))
        .filter_map(|path| fs::canonicalize(path).ok())
        .collect();
    candidates.dedup();
    let system = processes();
    let running: Vec<_> = candidates
        .iter()
        .filter(|app| {
            system
                .processes()
                .values()
                .any(|process| matches_app(process, app))
        })
        .collect();
    match running.as_slice() {
        [app] => Ok((*app).clone()),
        [] => candidates.into_iter().next().ok_or_else(|| "Could not find the Codex desktop app. Install it first, or set CODEX_DESKTOP_PATH to its executable (inside Contents/MacOS on macOS).".into()),
        _ => Err("Multiple Codex desktop installations are running. Close all but the installation you want to switch.".into()),
    }
}

pub fn find_cli() -> R<PathBuf> {
    if let Some(path) = override_path("CODEX_CLI_PATH")? {
        return Ok(path);
    }
    if let Ok(app) = desktop() {
        if let Some(parent) = app.parent() {
            for path in [
                parent.join("../Resources/codex"),
                parent.join("resources/codex"),
                parent.join("resources/bin/codex"),
            ] {
                if executable(&path) {
                    return Ok(path);
                }
            }
        }
    }
    let home = super::user_home()?;
    from_path("codex").or_else(|| [home.join(".local/bin/codex"), PathBuf::from("/opt/homebrew/bin/codex"), PathBuf::from("/usr/local/bin/codex")].into_iter().find(|path| executable(path))).ok_or_else(|| "Could not find the official Codex CLI. Install it and add it to PATH, or set CODEX_CLI_PATH to its executable.".into())
}

fn refresh(system: &mut System) {
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_exe(UpdateKind::Always)
            .with_user(UpdateKind::Always)
            .with_cmd(UpdateKind::Always),
    );
}

fn processes() -> System {
    let mut system = System::new();
    refresh(&mut system);
    system
}

fn owned(process: &sysinfo::Process) -> bool {
    // Only manage this user's desktop, even on multi-user Linux systems.
    !matches!(
        process.status(),
        ProcessStatus::Zombie | ProcessStatus::Dead
    ) && process
        .user_id()
        .is_some_and(|uid| **uid == unsafe { libc::geteuid() })
}

fn matches_app(process: &sysinfo::Process, app: &Path) -> bool {
    owned(process)
        && process.exe().is_some_and(|exe| exe == app)
        && !process
            .cmd()
            .iter()
            .any(|arg| arg.to_string_lossy().starts_with("--type="))
}

fn targets(system: &System, app: &Path) -> HashSet<Pid> {
    let mut targets: HashSet<_> = system
        .processes()
        .iter()
        .filter(|(_, process)| matches_app(process, app))
        .map(|(pid, _)| *pid)
        .collect();
    // Include a surviving bundled app-server, but never independently installed CLI sessions.
    if let Some(parent) = app.parent() {
        let resources = if cfg!(target_os = "macos") {
            parent.join("../Resources")
        } else {
            parent.join("resources")
        };
        if let Ok(resources) = fs::canonicalize(resources) {
            targets.extend(
                system
                    .processes()
                    .iter()
                    .filter(|(_, process)| {
                        owned(process)
                            && process.exe().is_some_and(|exe| exe.starts_with(&resources))
                            && process.cmd().iter().any(|arg| arg == "app-server")
                    })
                    .map(|(pid, _)| *pid),
            );
        }
    }
    loop {
        let children: Vec<_> = system
            .processes()
            .iter()
            .filter(|(pid, process)| {
                !targets.contains(pid)
                    && owned(process)
                    && process.exe().is_some_and(|exe| {
                        exe == app
                            || exe.file_name().is_some_and(|name| {
                                let name = name.to_string_lossy();
                                name.starts_with("Codex Helper")
                                    || name.starts_with("ChatGPT Helper")
                                    || name == "chrome_crashpad_handler"
                                    || name == "codex"
                                        && process.cmd().iter().any(|arg| arg == "app-server")
                            })
                    })
                    && process
                        .parent()
                        .is_some_and(|parent| targets.contains(&parent))
            })
            .map(|(pid, _)| *pid)
            .collect();
        if children.is_empty() {
            break;
        }
        targets.extend(children);
    }
    targets
}

pub fn stop() -> R<()> {
    stop_desktop(&desktop()?)
}

fn stop_desktop(app: &Path) -> R<()> {
    let mut system = processes();
    // Keep start times to avoid signalling an unrelated process after PID reuse.
    let original: Vec<_> = targets(&system, app)
        .into_iter()
        .filter_map(|pid| system.process(pid).map(|p| (pid, p.start_time())))
        .collect();
    for (pid, _) in &original {
        if let Some(process) = system.process(*pid) {
            process.kill_with(Signal::Term);
        }
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        refresh(&mut system);
        let remaining: Vec<_> = original
            .iter()
            .filter_map(|(pid, started)| {
                system
                    .process(*pid)
                    .filter(|process| process.start_time() == *started && owned(process))
            })
            .collect();
        if remaining.is_empty() && targets(&system, app).is_empty() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            for process in remaining {
                process.kill_with(Signal::Kill);
            }
            std::thread::sleep(Duration::from_millis(500));
            refresh(&mut system);
            if original.iter().any(|(pid, started)| {
                system
                    .process(*pid)
                    .is_some_and(|p| p.start_time() == *started && owned(p))
            }) || !targets(&system, app).is_empty()
            {
                return Err(
                    "Codex is still running. Close it fully before switching accounts.".into(),
                );
            }
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

pub fn launch() -> R<()> {
    let app = desktop()?;
    if processes()
        .processes()
        .values()
        .any(|p| matches_app(p, &app))
    {
        return Ok(());
    }
    // Direct execution preserves CODEX_HOME and avoids shell expansion or name-based launching.
    let mut child = Command::new(&app)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Could not launch the Codex desktop app.")?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if processes()
            .processes()
            .values()
            .any(|p| matches_app(p, &app))
        {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err("Codex did not start. Check CODEX_DESKTOP_PATH and your desktop session.".into())
}

pub fn show_error(error: &str) {
    eprintln!("ChatGPT Account Switcher: {error}");
    #[cfg(target_os = "macos")]
    let _ = Command::new("osascript").args(["-e", "on run argv\ndisplay alert \"ChatGPT Account Switcher\" message (item 1 of argv)\nend run", "--", error]).status();
    #[cfg(target_os = "linux")]
    let _ = Command::new("zenity")
        .args([
            "--error",
            "--title=ChatGPT Account Switcher",
            "--text",
            error,
        ])
        .status();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_current_user_processes_and_stops_only_the_selected_executable() {
        struct Fixture {
            root: PathBuf,
            children: Vec<std::process::Child>,
        }
        impl Drop for Fixture {
            fn drop(&mut self) {
                for child in &mut self.children {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                for name in ["desktop", "other-session"] {
                    let _ = fs::remove_file(self.root.join(name));
                }
                let _ = fs::remove_dir(&self.root);
            }
        }
        let root = std::env::temp_dir().join(format!("switcher-process-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let mut fixture = Fixture {
            root: fs::canonicalize(root).unwrap(),
            children: Vec::new(),
        };
        // Unique executable copies ensure this test cannot match the user's other sleep processes.
        for name in ["desktop", "other-session"] {
            let path = fixture.root.join(name);
            fs::copy("/bin/sleep", &path).unwrap();
            fixture
                .children
                .push(Command::new(path).arg("30").spawn().unwrap());
        }
        let app = fixture.root.join("desktop");
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let system = processes();
            if system
                .processes()
                .values()
                .any(|process| matches_app(process, &app))
            {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "Could not identify synthetic desktop process"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
        stop_desktop(&app).unwrap();
        assert!(fixture.children[0].wait().unwrap().code() != Some(0));
        assert!(fixture.children[1].try_wait().unwrap().is_none());
    }

    #[test]
    fn encrypted_vault_rejects_tampering_and_truncation_and_uses_fresh_nonces() {
        let first = protect(b"synthetic", b"context", false).unwrap();
        assert_ne!(first, protect(b"synthetic", b"context", false).unwrap());
        for length in 0..first.len() {
            assert!(protect(&first[..length], b"context", true).is_err());
        }
        let mut changed = first;
        *changed.last_mut().unwrap() ^= 1;
        assert!(protect(&changed, b"context", true).is_err());
    }

    #[test]
    fn private_atomic_files_and_directories() {
        let root = std::env::temp_dir().join(format!("switcher-unix-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        secure_dir(&root).unwrap();
        let path = root.join("auth.json");
        atomic(&path, b"one").unwrap();
        atomic(&path, b"two").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"two");
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(&root).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let link = root.join("link");
        std::os::unix::fs::symlink(&root, &link).unwrap();
        assert!(secure_dir(&link).is_err());
        fs::remove_file(link).unwrap();
        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
