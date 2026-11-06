//! Desktop OS boundary. Windows vault paths and DPAPI bytes remain compatible.
use std::{path::PathBuf, process::Command};

#[cfg(target_os = "windows")]
#[path = "windows.rs"]
mod native;
#[cfg(any(target_os = "macos", target_os = "linux"))]
#[path = "unix.rs"]
mod native;
pub use native::*;

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
compile_error!("ChatGPT Account Switcher supports Windows, macOS, and Linux desktops.");

pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

pub fn codex_home() -> Result<PathBuf, String> {
    if let Some(home) = std::env::var_os("CODEX_HOME").filter(|v| !v.is_empty()) {
        let home = PathBuf::from(home);
        if !home.is_absolute() {
            return Err("CODEX_HOME must be an absolute directory path.".into());
        }
        return Ok(home);
    }
    user_home().map(|home| home.join(".codex"))
}

pub fn user_home() -> Result<PathBuf, String> {
    let variable = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(variable)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| format!("{variable} must identify your home directory."))
}

/// Never overwrite a file that Codex is configured to ignore in favor of keyring.
/// Do not rewrite the user's Codex configuration or change managed requirements.
pub fn ensure_file_auth(home: &std::path::Path) -> Result<(), String> {
    let path = home.join("config.toml");
    let config = match std::fs::read_to_string(path) {
        Ok(config) => config,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("Could not read Codex config.toml. Switching was cancelled.".into()),
    };
    validate_auth_config(&config)
}

fn validate_auth_config(config: &str) -> Result<(), String> {
    let config: toml::Value = toml::from_str(config)
        .map_err(|_| "Could not parse Codex config.toml. Switching was cancelled.")?;
    match config.get("cli_auth_credentials_store") {
        None => Ok(()), // Codex's default is file storage.
        Some(toml::Value::String(value)) if value == "file" => Ok(()),
        _ => Err("Account switching requires Codex file credential storage. Set cli_auth_credentials_store = \"file\" in your Codex config.toml, restart Codex, and sign in there once. Keyring, auto, and ephemeral credential storage are not supported.".into()),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn auth_storage_guard_parses_toml_and_refuses_ambiguous_storage() {
        for config in [
            "",
            "# cli_auth_credentials_store = 'keyring'",
            "cli_auth_credentials_store = 'file' # supported",
            "[profiles.work]\ncli_auth_credentials_store = 'keyring'",
        ] {
            assert!(super::validate_auth_config(config).is_ok());
        }
        for config in [
            "cli_auth_credentials_store = 'keyring'",
            "cli_auth_credentials_store = 'auto'",
            "cli_auth_credentials_store = 'ephemeral'",
            "cli_auth_credentials_store = 1",
            "invalid toml [",
        ] {
            assert!(super::validate_auth_config(config).is_err());
        }
    }
}
