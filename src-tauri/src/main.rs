#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod core;
mod runtime;
mod updates;
mod windows;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
#[tauri::command]
fn system_languages() -> Vec<String> {
    windows::preferred_languages()
}
#[tauri::command]
async fn action(
    state: tauri::State<'_, Arc<Mutex<core::Store>>>,
    updates: tauri::State<'_, updates::Updates>,
    command: String,
    label: Option<String>,
    id: Option<String>,
) -> Result<Value, String> {
    let _activity = if command == "snapshot" {
        None
    } else {
        Some(updates.begin()?)
    };
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = state
            .lock()
            .map_err(|_| "Ο πυρήνας χρειάζεται επανεκκίνηση")?;
        let msg = match command.as_str() {
            "snapshot" => {
                return serde_json::to_value(s.snapshot()?).map_err(|_| "Αδυναμία προβολής".into())
            }
            "login" => s.start_login(label.unwrap_or_default(), id)?,
            "cancel_login" => s.cancel_login()?,
            "switch" => s.switch(id.as_deref().ok_or("Λείπει προφίλ")?)?,
            "recover" => s.recover()?,
            "remove" => s.remove(id.as_deref().ok_or("Λείπει προφίλ")?)?,
            "open" => {
                windows::launch()?;
                "Το Codex άνοιξε.".into()
            }
            _ => return Err("Άγνωστη ενέργεια".into()),
        };
        Ok(json!({"message":msg}))
    })
    .await
    .map_err(|_| "Η ενέργεια διακόπηκε".to_string())?
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let store = match core::Store::new() {
        Ok(s) => Arc::new(Mutex::new(s)),
        Err(e) => {
            if args.get(1).is_some_and(|x| x == "--self-check") {
                if let Some(path) = args.get(2) {
                    let _ = std::fs::write(path, serde_json::to_vec(&json!({"error":e})).unwrap());
                }
                return;
            }
            let msg = e.replace('\'', "''");
            let _=windows::ps(&format!("Add-Type -AssemblyName PresentationFramework;[System.Windows.MessageBox]::Show('{}','ChatGPT Account Switcher')",msg));
            return;
        }
    };
    if args.get(1).is_some_and(|x| x == "--self-check") {
        let result = (|| -> Result<Value, String> {
            let mut s = store.lock().map_err(|_| "lock")?;
            let mut snap = s.snapshot()?;
            if args.iter().any(|x| x == "--online") {
                for p in &snap.profiles {
                    let _ = s.check(&p.id)?;
                }
                snap = s.snapshot()?;
            }
            Ok(json!({"snapshot":snap}))
        })();
        if let Some(path) = args.get(2) {
            let value = match result {
                Ok(v) => v,
                Err(e) => json!({"error":e}),
            };
            let _ = std::fs::write(path, serde_json::to_vec_pretty(&value).unwrap());
        }
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Updates::default())
        .manage(store)
        .setup(|app| {
            runtime::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                use tauri::Manager;
                if window.state::<updates::Updates>().is_installing() {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                    }
                    return;
                }
                let state = window.state::<Arc<Mutex<core::Store>>>();
                if let Ok(mut s) = state.lock() {
                    let _ = s.cancel_login();
                };
            }
        })
        .invoke_handler(tauri::generate_handler![
            action,
            system_languages,
            updates::app_info,
            updates::check_for_updates,
            updates::install_update
        ])
        .run(tauri::generate_context!())
        .expect("Could not start ChatGPT Account Switcher");
}
