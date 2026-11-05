//! Only the native process handles update URLs, signatures, and installer execution.
use crate::core::Store;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<Update>>,
    activity: AtomicBool,
    checking: AtomicBool,
}

pub struct Activity<'a>(&'a AtomicBool);
impl Drop for Activity<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl Updates {
    pub fn begin(&self) -> Result<Activity<'_>, String> {
        claim(&self.activity)
    }
    pub fn is_installing(&self) -> bool {
        self.activity.load(Ordering::Acquire)
    }
}
fn claim(flag: &AtomicBool) -> Result<Activity<'_>, String> {
    flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map(|_| Activity(flag))
        .map_err(|_| "Another operation is in progress.".into())
}

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> Value {
    json!({"version": app.package_info().version.to_string()})
}

#[tauri::command]
pub async fn check_for_updates(
    app: tauri::AppHandle,
    state: tauri::State<'_, Updates>,
) -> Result<Value, String> {
    let _checking = claim(&state.checking)?;
    let update = app
        .updater_builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Could not initialize the updater.".to_string())?
        .check()
        .await
        .map_err(|_| "Could not check for updates. Please try again later.".to_string())?;
    if update
        .as_ref()
        .is_some_and(|u| u.download_url.scheme() != "https")
    {
        return Err("The release contains an insecure download URL.".into());
    }
    let result = update.as_ref().map(|u| {
        json!({
            "version": u.version, "currentVersion": u.current_version,
            "notes": u.body, "date": u.date.map(|d| d.unix_timestamp())
        })
    });
    *state
        .pending
        .lock()
        .map_err(|_| "Updater lock unavailable.")? = update;
    Ok(json!({"update": result}))
}

#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, Updates>,
) -> Result<(), String> {
    // The same gate protects account actions, including browser sign-in and switching.
    let _activity = state.begin()?;
    let store = app.state::<Arc<Mutex<Store>>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = store.lock().map_err(|_| "Account storage unavailable.")?;
        if store.snapshot()?.login.is_some() {
            return Err("Finish or cancel browser sign-in before updating.".into());
        }
        Ok::<_, String>(())
    })
    .await
    .map_err(|_| "Could not prepare the update.")??;
    let mut update = state
        .pending
        .lock()
        .map_err(|_| "Updater lock unavailable.")?
        .clone()
        .ok_or("Check for updates before installing.")?;
    // Checking should be quick; downloading an installer may take several minutes.
    update.timeout = Some(Duration::from_secs(600));
    let mut downloaded = 0u64;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                let _ = app.emit(
                    "update-progress",
                    json!({"phase":"downloading", "downloaded":downloaded, "total":total}),
                );
            },
            || {},
        )
        .await
        .map_err(|_| "Download or signature verification failed. Please retry.".to_string())?;
    let _ = app.emit("update-progress", json!({"phase":"installing"}));
    // On Windows the verified installer takes over, closes this app, and relaunches it.
    tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|_| "Could not start the installer.")?
        .map_err(|_| "Could not install the update. Please retry.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actions_and_installation_are_mutually_exclusive_and_unlock_on_failure() {
        let state = Updates::default();
        let operation = state.begin().unwrap();
        assert!(state.begin().is_err());
        drop(operation);
        assert!(state.begin().is_ok());
    }
}
