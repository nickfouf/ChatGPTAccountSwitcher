use crate::core;
use notify::{RecursiveMode, Watcher};
use std::{
    collections::HashMap,
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

type Shared = Arc<Mutex<core::Store>>;

pub fn start(app: tauri::AppHandle) {
    let state = app.state::<Shared>().inner().clone();
    let event_app = app.clone();
    let event_state = state.clone();
    std::thread::spawn(move || {
        let (tx, rx) = mpsc::sync_channel(1);
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                if result.is_err()
                    || result.is_ok_and(|e| {
                        !e.kind.is_access()
                            && e.paths.iter().any(|p| {
                                p.file_name().is_some_and(|n| n == "auth.json")
                                    || p.extension().is_some_and(|e| e == "vault")
                            })
                    })
                {
                    let _ = tx.try_send(());
                }
            })
            .ok();
        if let (Some(watcher), Ok(store)) = (&mut watcher, event_state.lock()) {
            for path in store.watch_paths() {
                let _ = watcher.watch(&path, RecursiveMode::NonRecursive);
            }
        }
        let mut last = String::new();
        loop {
            // Native file events handle auth replacement/rotation immediately.
            // A 1-second fallback also detects completed browser login and missed events.
            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(()) => {
                    std::thread::sleep(Duration::from_millis(80));
                    while rx.try_recv().is_ok() {}
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    std::thread::sleep(Duration::from_secs(1))
                }
                Err(mpsc::RecvTimeoutError::Timeout) => (),
            }
            if let Ok(mut store) = event_state.try_lock() {
                match store
                    .snapshot()
                    .and_then(|s| serde_json::to_value(s).map_err(|_| "snapshot".into()))
                {
                    Ok(snapshot) => {
                        let key = snapshot.to_string();
                        if key != last {
                            last = key;
                            let _ = event_app.emit("accounts-changed", snapshot);
                        }
                    }
                    Err(_) => {
                        let _ = event_app.emit("sync-error", ());
                    }
                }
            }
        }
    });
    std::thread::spawn(move || {
        let mut attempts: HashMap<String, Instant> = HashMap::new();
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let candidates = match state.try_lock() {
                Ok(mut s) => s.maintenance_candidates().unwrap_or_default(),
                Err(_) => continue,
            };
            for (id, renew) in candidates {
                if attempts
                    .get(&id)
                    .is_some_and(|t| t.elapsed() < Duration::from_secs(120))
                {
                    continue;
                }
                attempts.insert(id.clone(), Instant::now());
                if renew {
                    if let Ok(mut s) = state.lock() {
                        if let Err(e) = s.refresh_token(&id) {
                            s.renewal_failed(&id, &e);
                        }
                    }
                    continue;
                }
                let job = match state
                    .lock()
                    .ok()
                    .and_then(|mut s| s.prepare_check(&id).ok())
                {
                    Some(job) => job,
                    None => continue,
                };
                // Network IO does not hold the account-store lock: live auth events and
                // add/remove operations stay responsive while usage is being checked.
                match job.run() {
                    Ok(h) => {
                        let rejected = ["reauth", "expired"].contains(&h.status.as_str());
                        if let Ok(mut s) = state.lock() {
                            let _ = s.finish_check(&job, h);
                            if rejected {
                                if let Err(e) = s.refresh_token(&id) {
                                    s.renewal_failed(&id, &e);
                                }
                            }
                        }
                    }
                    Err(_) => {
                        if let Ok(mut s) = state.lock() {
                            s.renewal_failed(&id, "network");
                        }
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_events_detect_atomic_auth_replacement() {
        let root = std::env::temp_dir().join(format!("switcher-watch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let (tx, rx) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(tx).unwrap();
        watcher.watch(&root, RecursiveMode::NonRecursive).unwrap();
        let auth = root.join("auth.json");
        crate::platform::atomic(&auth, b"synthetic").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut found = false;
        while Instant::now() < deadline {
            if let Ok(Ok(event)) = rx.recv_timeout(Duration::from_millis(500)) {
                if event
                    .paths
                    .iter()
                    .any(|p| p.file_name().is_some_and(|n| n == "auth.json"))
                {
                    found = true;
                    break;
                }
            }
        }
        drop(watcher);
        std::fs::remove_file(auth).unwrap();
        std::fs::remove_dir(root).unwrap();
        assert!(found, "Windows watcher did not report the auth replacement");
    }
}
