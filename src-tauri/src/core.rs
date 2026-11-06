use crate::platform;
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::{Child, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};
use zeroize::Zeroizing;
type R<T> = Result<T, String>;
const ENTROPY: &[u8] = b"CodexHarbor/v1/credentials";
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct Identity {
    pub account_id: String,
    pub user_id: String,
    pub email: String,
    pub expires: u64,
    pub issued: u64,
}
impl Identity {
    pub fn key(&self) -> String {
        format!("{}:{}", self.account_id, self.user_id)
    }
}
fn jwt(s: &str) -> R<Value> {
    let part = s
        .split('.')
        .nth(1)
        .ok_or("Μη αναγνωρίσιμο token σύνδεσης")?;
    let bytes = URL_SAFE_NO_PAD
        .decode(part.trim_end_matches('='))
        .map_err(|_| "Μη αναγνωρίσιμο token")?;
    serde_json::from_slice(&bytes).map_err(|_| "Μη αναγνωρίσιμο token".into())
}
pub fn identity(raw: &[u8]) -> R<Identity> {
    let a: Value = serde_json::from_slice(raw).map_err(|_| "Κατεστραμμένο αρχείο σύνδεσης")?;
    let t = &a["tokens"];
    let access = jwt(t["access_token"]
        .as_str()
        .ok_or("Απαιτείται σύνδεση ChatGPT, όχι API key")?)?;
    let id = jwt(t["id_token"]
        .as_str()
        .ok_or("Λείπει η ταυτότητα λογαριασμού")?)?;
    let account = t["account_id"].as_str().ok_or("Λείπει το account ID")?;
    let claims = &access["https://api.openai.com/auth"];
    let idclaims = &id["https://api.openai.com/auth"];
    if claims["chatgpt_account_id"].as_str() != Some(account)
        || idclaims["chatgpt_account_id"].as_str() != Some(account)
    {
        return Err("Ασυμφωνία ταυτότητας μεταξύ των διαπιστευτηρίων. Δεν αποθηκεύτηκαν.".into());
    }
    let user = claims["chatgpt_user_id"]
        .as_str()
        .ok_or("Λείπει το user ID")?;
    if idclaims["chatgpt_user_id"].as_str() != Some(user) {
        return Err("Τα tokens ανήκουν σε διαφορετικούς χρήστες".into());
    }
    Ok(Identity {
        account_id: account.into(),
        user_id: user.into(),
        email: id["email"].as_str().unwrap_or("ChatGPT account").into(),
        expires: access["exp"].as_u64().ok_or("Λείπει η λήξη token")?,
        issued: access["iat"].as_u64().unwrap_or(0),
    })
}
#[derive(Serialize, Deserialize)]
struct Saved {
    id: String,
    label: String,
    auth: Value,
    saved: u64,
}
#[derive(Clone, Serialize, Default)]
pub struct Health {
    pub status: String,
    pub message: String,
    pub checked: u64,
    pub usage: Option<Value>,
}
#[derive(Serialize)]
pub struct Card {
    pub id: String,
    pub label: String,
    pub identity: Option<Identity>,
    pub saved: u64,
    pub active: bool,
    pub health: Health,
}
#[derive(Serialize)]
pub struct Snapshot {
    pub profiles: Vec<Card>,
    pub current: Option<Identity>,
    pub home: String,
    pub login: Option<String>,
    pub notice: Option<String>,
    pub recovery: bool,
}
struct Login {
    child: Child,
    path: PathBuf,
    label: String,
    expected: Option<String>,
    started: u64,
}
pub struct Store {
    root: PathBuf,
    home: PathBuf,
    _lock: fs::File,
    health: HashMap<String, Health>,
    login: Option<Login>,
    notice: Option<String>,
    excluded: HashSet<String>,
}
fn read(path: &Path) -> R<Zeroizing<Vec<u8>>> {
    fs::read(path)
        .map(Zeroizing::new)
        .map_err(|_| "Αδυναμία ανάγνωσης αρχείου".into())
}
fn enc(path: &Path, bytes: &[u8]) -> R<()> {
    platform::atomic(path, &platform::protect(bytes, ENTROPY, false)?)
}
fn dec(path: &Path) -> R<Zeroizing<Vec<u8>>> {
    Ok(Zeroizing::new(platform::protect(
        &read(path)?,
        ENTROPY,
        true,
    )?))
}
fn scrub_temporary_auth(root: &Path) {
    for entry in fs::read_dir(root).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let suffix = name
            .strip_prefix("login-")
            .or_else(|| name.strip_prefix("refresh-"));
        if !entry.file_type().is_ok_and(|kind| kind.is_dir())
            || suffix.is_none_or(|id| uuid::Uuid::parse_str(id).is_err())
        {
            continue;
        }
        let path = entry.path();
        // Delete only the known credential file inside our own UUID directory.
        // Never recursively delete logs, unknown files, symlinks or other homes.
        let auth = path.join("auth.json");
        if fs::symlink_metadata(&auth).is_ok_and(|m| m.file_type().is_file()) {
            let _ = fs::remove_file(auth);
        }
    }
}
impl Store {
    pub fn new() -> R<Self> {
        let root = platform::vault_root()?;
        fs::create_dir_all(&root).map_err(|_| "Αδυναμία δημιουργίας vault")?;
        platform::secure_dir(&root)?;
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join("vault.lock"))
            .map_err(|_| "Αδυναμία κλειδώματος vault")?;
        lock.try_lock_exclusive()
            .map_err(|_| "Το ChatGPT Account Switcher εκτελείται ήδη. Κλείσε το άλλο παράθυρο.")?;
        scrub_temporary_auth(&root);
        let home = platform::codex_home()?;
        platform::ensure_file_auth(&home)?;
        let excluded = Self::read_excluded(&root)?;
        Ok(Self {
            root,
            home,
            _lock: lock,
            health: HashMap::new(),
            login: None,
            notice: None,
            excluded,
        })
    }
    fn path(&self, id: &str) -> R<PathBuf> {
        uuid::Uuid::parse_str(id).map_err(|_| "Μη έγκυρο profile ID")?;
        Ok(self.root.join(format!("{}.vault", id)))
    }
    fn read_excluded(root: &Path) -> R<HashSet<String>> {
        let path = root.join("excluded.dpapi");
        if !path.exists() {
            return Ok(HashSet::new());
        }
        serde_json::from_slice(&dec(&path)?)
            .map_err(|_| "Δεν διαβάστηκε η λίστα αφαιρεμένων λογαριασμών".into())
    }
    fn write_excluded(&self, excluded: &HashSet<String>) -> R<()> {
        enc(
            &self.root.join("excluded.dpapi"),
            &serde_json::to_vec(excluded).map_err(|_| "Αδυναμία αποθήκευσης")?,
        )
    }
    pub fn watch_paths(&self) -> [PathBuf; 2] {
        [self.home.clone(), self.root.clone()]
    }
    pub fn remove(&mut self, id: &str) -> R<String> {
        if self.login.is_some() {
            return Err("Ολοκλήρωσε ή ακύρωσε πρώτα τη σύνδεση.".into());
        }
        let path = self.path(id)?;
        // A removed live account must not reappear during the next file event or restart.
        let mut excluded = self.excluded.clone();
        if let Ok(saved) = self.load(id) {
            if let Ok(i) =
                identity(&serde_json::to_vec(&saved.auth).map_err(|_| "Μη έγκυρο προφίλ")?)
            {
                excluded.insert(i.key());
            }
        }
        self.write_excluded(&excluded)?;
        self.excluded = excluded;
        for p in [path.with_extension("previous"), path] {
            match fs::remove_file(p) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => return Err("Δεν ολοκληρώθηκε η αφαίρεση. Δοκίμασε ξανά.".into()),
            }
        }
        self.health.remove(id);
        Ok("Ο λογαριασμός αφαιρέθηκε από τη λίστα.".into())
    }
    fn load(&self, id: &str) -> R<Saved> {
        serde_json::from_slice(&dec(&self.path(id)?)?).map_err(|_| "Κατεστραμμένο προφίλ".into())
    }
    fn all(&self) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(&self.root)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let p = e.path();
                if p.extension()?.to_str()? == "vault" {
                    Some(p.file_stem()?.to_str()?.to_string())
                } else {
                    None
                }
            })
            .collect();
        v.sort();
        v
    }
    fn write(&self, s: &Saved) -> R<()> {
        let path = self.path(&s.id)?;
        if path.exists() {
            platform::atomic(&path.with_extension("previous"), &read(&path)?)?;
        }
        let bytes = Zeroizing::new(serde_json::to_vec(s).map_err(|_| "Αδυναμία αποθήκευσης")?);
        enc(&path, &bytes)
    }
    fn live(&self) -> R<Zeroizing<Vec<u8>>> {
        read(&self.home.join("auth.json"))
    }
    fn save(&mut self, label: &str, raw: &[u8], expected: Option<&str>) -> R<String> {
        let ident = identity(raw)?;
        if let Some(key) = expected {
            if ident.key() != key {
                return Err(
                    "Συνδέθηκες σε διαφορετικό λογαριασμό. Το προηγούμενο προφίλ διατηρήθηκε."
                        .into(),
                );
            }
        }
        let label = label.trim();
        if label.is_empty() || label.chars().count() > 80 || label.chars().any(char::is_control) {
            return Err("Χρησιμοποίησε όνομα 1–80 χαρακτήρων".into());
        }
        let existing = self.all().into_iter().find(|id| {
            self.load(id)
                .ok()
                .and_then(|p| identity(&serde_json::to_vec(&p.auth).ok()?).ok())
                .is_some_and(|i| i.key() == ident.key())
        });
        let id = existing.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let auth = serde_json::from_slice(raw).map_err(|_| "Κατεστραμμένα διαπιστευτήρια")?;
        self.write(&Saved {
            id: id.clone(),
            label: label.into(),
            auth,
            saved: now(),
        })?;
        self.health.remove(&id);
        if self.excluded.contains(&ident.key()) {
            let mut excluded = self.excluded.clone();
            excluded.remove(&ident.key());
            self.write_excluded(&excluded)?;
            self.excluded = excluded;
        }
        Ok(id)
    }
    pub fn sync(&mut self) -> R<()> {
        let raw = match self.live() {
            Ok(v) => v,
            Err(_) => return Ok(()),
        };
        let i = match identity(&raw) {
            Ok(v) => v,
            Err(_) => return Ok(()),
        };
        let mut matched = false;
        for id in self.all() {
            if let Ok(mut s) = self.load(&id) {
                let old = Zeroizing::new(serde_json::to_vec(&s.auth).unwrap_or_default());
                if let Ok(o) = identity(&old) {
                    if o.key() == i.key() {
                        matched = true;
                    }
                    if o.key() == i.key()
                        && i.issued >= o.issued
                        && s.auth != serde_json::from_slice::<Value>(&raw).unwrap_or(Value::Null)
                    {
                        s.auth = serde_json::from_slice(&raw).map_err(|_| "Αδυναμία ανάγνωσης")?;
                        s.saved = now();
                        self.write(&s)?;
                        self.health.remove(&id);
                    }
                }
            }
        }
        if !matched && !self.excluded.contains(&i.key()) {
            self.save(&i.email, &raw, None)?;
            self.notice = Some("auto_added".into());
        }
        Ok(())
    }
    pub fn snapshot(&mut self) -> R<Snapshot> {
        self.poll_login()?;
        self.sync()?;
        let current = self.live().ok().and_then(|r| identity(&r).ok());
        let mut profiles = vec![];
        for id in self.all() {
            match self.load(&id) {
                Ok(s) => {
                    let i = identity(&Zeroizing::new(
                        serde_json::to_vec(&s.auth).unwrap_or_default(),
                    ))
                    .ok();
                    let active = i
                        .as_ref()
                        .zip(current.as_ref())
                        .is_some_and(|(a, b)| a.key() == b.key());
                    let mut h = self.health.get(&id).cloned().unwrap_or_default();
                    if h.status.is_empty()
                        || (h.status == "valid" && i.as_ref().is_some_and(|x| x.expires <= now()))
                    {
                        h.status = if i.as_ref().is_some_and(|x| x.expires <= now()) {
                            "expired"
                        } else {
                            "unchecked"
                        }
                        .into();
                        h.message = if h.status == "expired" {
                            "Το access token έληξε. Χρειάζεται ανανέωση ή νέο login."
                        } else {
                            "Δεν έχει γίνει έλεγχος αποδοχής από την OpenAI."
                        }
                        .into();
                    }
                    profiles.push(Card {
                        id,
                        label: s.label,
                        identity: i,
                        saved: s.saved,
                        active,
                        health: h,
                    });
                }
                Err(_) => profiles.push(Card {
                    id,
                    label: "Μη αναγνώσιμο προφίλ".into(),
                    identity: None,
                    saved: 0,
                    active: false,
                    health: Health {
                        status: "corrupt".into(),
                        message: "Το κρυπτογραφημένο αρχείο δεν διαβάζεται.".into(),
                        ..Default::default()
                    },
                }),
            }
        }
        Ok(Snapshot {
            profiles,
            current,
            home: self.home.to_string_lossy().into(),
            login: self.login.as_ref().map(|l| l.label.clone()),
            notice: self.notice.take(),
            recovery: self.root.join("transaction.dpapi").exists(),
        })
    }
    pub fn prepare_check(&mut self, id: &str) -> R<CheckJob> {
        self.sync()?;
        let s = self.load(id)?;
        identity(&serde_json::to_vec(&s.auth).map_err(|_| "Μη έγκυρο αρχείο")?)?;
        Ok(CheckJob {
            id: id.into(),
            auth: s.auth,
        })
    }
    pub fn finish_check(&mut self, job: &CheckJob, h: Health) -> R<()> {
        // Ignore a response if the account was removed or its credentials rotated in flight.
        if self.load(&job.id).is_ok_and(|s| s.auth == job.auth) {
            self.health.insert(job.id.clone(), h);
        }
        Ok(())
    }
    pub fn check(&mut self, id: &str) -> R<Health> {
        let job = self.prepare_check(id)?;
        let h = job.run()?;
        self.finish_check(&job, h.clone())?;
        Ok(h)
    }
    pub fn maintenance_candidates(&mut self) -> R<Vec<(String, bool)>> {
        let snapshot = self.snapshot()?;
        if let Some(notice) = snapshot.notice {
            self.notice = Some(notice);
        }
        Ok(snapshot
            .profiles
            .into_iter()
            .filter(|p| p.identity.is_some())
            .map(|p| {
                let refresh = p.identity.as_ref().is_some_and(|i| i.expires <= now() + 60)
                    || p.health.status == "reauth";
                (p.id, refresh)
            })
            .collect())
    }
    pub fn renewal_failed(&mut self, id: &str, message: &str) {
        let reauth = message.contains("νέο login");
        self.health.insert(
            id.into(),
            Health {
                status: if reauth { "reauth" } else { "service" }.into(),
                message: if reauth {
                    "Συνδέσου ξανά για να χρησιμοποιήσεις αυτόν τον λογαριασμό.".into()
                } else {
                    "Η αυτόματη ανανέωση δεν ολοκληρώθηκε. Θα ξαναδοκιμάσουμε.".into()
                },
                checked: now(),
                usage: None,
            },
        );
    }
    pub fn refresh_token(&mut self, id: &str) -> R<String> {
        use std::io::{BufRead, BufReader, Write};
        use std::sync::mpsc;
        if self.login.is_some() {
            return Err("Ολοκλήρωσε το login που εκκρεμεί".into());
        }
        self.sync()?;
        let saved = self.load(id)?;
        let expected =
            identity(&serde_json::to_vec(&saved.auth).map_err(|_| "Μη έγκυρο προφίλ")?)?.key();
        let path = self.root.join(format!("refresh-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).map_err(|_| "Αδυναμία δημιουργίας χώρου ανανέωσης")?;
        platform::secure_dir(&path)?;
        let auth_path = path.join("auth.json");
        let raw = Zeroizing::new(
            serde_json::to_vec(&saved.auth).map_err(|_| "Μη έγκυρα διαπιστευτήρια")?,
        );
        platform::atomic(&auth_path, &raw)?;
        let result = (|| -> R<()> {
            let mut child = platform::command(platform::find_cli()?)
                .args(["-c", "cli_auth_credentials_store=\"file\"", "app-server"])
                .env("CODEX_HOME", &path)
                .env_remove("OPENAI_API_KEY")
                .env_remove("CODEX_ACCESS_TOKEN")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|_| "Δεν ξεκίνησε ο μηχανισμός ανανέωσης Codex")?;
            let mut input = child.stdin.take().ok_or("Αδυναμία επικοινωνίας")?;
            let output = child.stdout.take().ok_or("Αδυναμία επικοινωνίας")?;
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(move || {
                for line in BufReader::new(output).lines().map_while(Result::ok) {
                    if let Ok(v) = serde_json::from_str::<Value>(&line) {
                        if tx.send(v).is_err() {
                            break;
                        }
                    }
                }
            });
            let rpc = (|| -> R<()> {
                writeln!(input,"{}",json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"codex_harbor","version":"0.1.0"}}})).map_err(|_|"Αδυναμία επικοινωνίας")?;
                let end = std::time::Instant::now() + std::time::Duration::from_secs(30);
                loop {
                    let v = rx
                        .recv_timeout(end.saturating_duration_since(std::time::Instant::now()))
                        .map_err(|_| "Η ανανέωση δεν απάντησε εγκαίρως")?;
                    if v["id"] == 1 {
                        if v.get("error").is_some() {
                            return Err("Το Codex απέρριψε την αρχικοποίηση ανανέωσης".into());
                        }
                        break;
                    }
                }
                writeln!(input, "{}", json!({"method":"initialized"}))
                    .map_err(|_| "Αδυναμία επικοινωνίας")?;
                writeln!(
                    input,
                    "{}",
                    json!({"id":2,"method":"account/read","params":{"refreshToken":true}})
                )
                .map_err(|_| "Αδυναμία επικοινωνίας")?;
                loop {
                    let v = rx
                        .recv_timeout(end.saturating_duration_since(std::time::Instant::now()))
                        .map_err(|_| "Η ανανέωση δεν απάντησε εγκαίρως")?;
                    if v["id"] == 2 {
                        if v.get("error").is_some()
                            || v.pointer("/result/account").is_none_or(Value::is_null)
                        {
                            return Err(
                                "Τα διαπιστευτήρια δεν ανανεώθηκαν. Χρειάζεται νέο login.".into()
                            );
                        }
                        break;
                    }
                }
                Ok(())
            })();
            let _ = child.kill();
            let _ = child.wait();
            rpc?;
            let updated = read(&auth_path)?;
            // Install a renewed live credential only if Codex has not changed it meanwhile.
            if let Ok(live) = self.live() {
                let current: Value = serde_json::from_slice(&live).unwrap_or(Value::Null);
                if current == saved.auth {
                    platform::atomic(&self.home.join("auth.json"), &updated)?;
                } else if identity(&live).is_ok_and(|i| i.key() == expected) {
                    self.sync()?;
                    return Ok(());
                }
            }
            self.save(&saved.label, &updated, Some(&expected))?;
            Ok(())
        })();
        let _ = fs::remove_file(auth_path);
        result?;
        let h = self.check(id)?;
        if h.status != "valid" {
            return Err(h.message);
        }
        Ok(
            "Η σύνδεση ανανεώθηκε μέσω του επίσημου Codex και έγινε αποδεκτή από την OpenAI."
                .into(),
        )
    }
    pub fn start_login(&mut self, label: String, id: Option<String>) -> R<String> {
        if self.login.is_some() {
            return Err("Υπάρχει ήδη σύνδεση σε εξέλιξη".into());
        }
        if label.chars().count() > 80 || label.chars().any(char::is_control) {
            return Err("Μη έγκυρο όνομα λογαριασμού".into());
        }
        let expected = if let Some(id) = id {
            let s = self.load(&id)?;
            Some(identity(&serde_json::to_vec(&s.auth).map_err(|_| "Μη έγκυρο προφίλ")?)?.key())
        } else {
            None
        };
        let cli = platform::find_cli()?;
        let path = self.root.join(format!("login-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).map_err(|_| "Αδυναμία δημιουργίας χώρου login")?;
        platform::secure_dir(&path)?;
        let child = platform::command(cli)
            .args(["login", "-c", "cli_auth_credentials_store=\"file\""])
            .env("CODEX_HOME", &path)
            .env_remove("OPENAI_API_KEY")
            .env_remove("CODEX_ACCESS_TOKEN")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Δεν ξεκίνησε το επίσημο login Codex")?;
        self.login = Some(Login {
            child,
            path,
            label,
            expected,
            started: now(),
        });
        Ok("Ολοκλήρωσε τη σύνδεση στον browser. Ο τρέχων λογαριασμός δεν άλλαξε.".into())
    }
    fn poll_login(&mut self) -> R<()> {
        if let Some(mut l) = self.login.take() {
            match l.child.try_wait() {
                Ok(Some(status)) => {
                    let result = if status.success() {
                        read(&l.path.join("auth.json")).and_then(|raw| {
                            let i = identity(&raw)?;
                            let label = if l.label.is_empty() {
                                i.email.as_str()
                            } else {
                                &l.label
                            };
                            self.save(label, &raw, l.expected.as_deref())
                                .map(|_| "login_saved".to_string())
                        })
                    } else {
                        Err("login_failed".into())
                    };
                    let _ = fs::remove_file(l.path.join("auth.json"));
                    self.notice = Some(result.unwrap_or_else(|e| e));
                }
                _ => {
                    if now() - l.started > 300 {
                        let _ = l.child.kill();
                        let _ = l.child.wait();
                        let _ = fs::remove_file(l.path.join("auth.json"));
                        self.notice = Some("login_timeout".into());
                    } else {
                        self.login = Some(l)
                    }
                }
            }
        }
        Ok(())
    }
    pub fn cancel_login(&mut self) -> R<String> {
        if let Some(mut l) = self.login.take() {
            let _ = l.child.kill();
            let _ = l.child.wait();
            let _ = fs::remove_file(l.path.join("auth.json"));
        }
        Ok("Το login ακυρώθηκε.".into())
    }
    pub fn switch(&mut self, id: &str) -> R<String> {
        platform::ensure_file_auth(&self.home)?;
        if self.login.is_some() {
            return Err("Ολοκλήρωσε ή ακύρωσε πρώτα το login".into());
        }
        if self.root.join("transaction.dpapi").exists() {
            return Err("Υπάρχει εκκρεμής ανάκτηση. Πάτησε Ανάκτηση πριν από νέα εναλλαγή.".into());
        }
        let mut h = self.check(id)?;
        if ["expired", "reauth"].contains(&h.status.as_str()) {
            if let Err(e) = self.refresh_token(id) {
                self.renewal_failed(id, &e);
                return Err(e);
            }
            h = self.check(id)?;
        }
        if h.status != "valid" {
            return Err(h.message);
        }
        let target = self.load(id)?;
        let bytes =
            Zeroizing::new(serde_json::to_vec(&target.auth).map_err(|_| "Μη έγκυρο προφίλ")?);
        let wanted = identity(&bytes)?;
        if let Err(e) = platform::stop() {
            let _ = platform::launch();
            return Err(e);
        }
        // Re-read after shutdown so the latest refresh is preserved.
        let previous = match fs::read(self.home.join("auth.json")) {
            Ok(bytes) => {
                // Refuse to replace an unreadable/unsupported original rather than
                // treating a read error as an absent login during rollback.
                if identity(&bytes).is_err() {
                    let _ = platform::launch();
                    return Err("Το τρέχον login δεν αναγνωρίζεται. Δεν αντικαταστάθηκε.".into());
                }
                Some(Zeroizing::new(bytes))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => {
                let _ = platform::launch();
                return Err("Δεν διαβάστηκε η προηγούμενη σύνδεση. Η εναλλαγή ακυρώθηκε.".into());
            }
        };
        if let Err(e) = self.sync() {
            let _ = platform::launch();
            return Err(e);
        }
        let journal = json!({"previous":previous.as_ref().map(|p|STANDARD.encode(p.as_slice())),"target":wanted.key(),"at":now()});
        let j = Zeroizing::new(serde_json::to_vec(&journal).map_err(|_| "Αδυναμία backup")?);
        if let Err(e) = enc(&self.root.join("transaction.dpapi"), &j) {
            let _ = platform::launch();
            return Err(e);
        }
        let outcome: R<()> = (|| {
            platform::atomic(&self.home.join("auth.json"), &bytes)?;
            let actual = identity(&self.live()?)?;
            if actual.key() != wanted.key() {
                return Err("Η ταυτότητα του εγκατεστημένου login δεν συμφωνεί".into());
            }
            platform::launch()?;
            std::thread::sleep(std::time::Duration::from_secs(2));
            if identity(&self.live()?)?.key() != wanted.key() {
                return Err("Το Codex άλλαξε τα διαπιστευτήρια μετά την εκκίνηση".into());
            }
            Ok(())
        })();
        if let Err(e) = outcome {
            let recovery = self.recover();
            return Err(format!(
                "Η εναλλαγή απέτυχε: {}. {}",
                e,
                if recovery.is_ok() {
                    "Ο προηγούμενος λογαριασμός αποκαταστάθηκε."
                } else {
                    "Χρειάζεται Ανάκτηση από το αντίγραφο."
                }
            ));
        }
        // Retain the encrypted transaction as the last rollback point.
        platform::atomic(
            &self.root.join("last-switch.dpapi"),
            &read(&self.root.join("transaction.dpapi"))?,
        )?;
        fs::remove_file(self.root.join("transaction.dpapi"))
            .map_err(|_| "Η εναλλαγή ολοκληρώθηκε, αλλά έμεινε εκκρεμές journal")?;
        Ok(format!("Η σύνδεση άλλαξε σε {}.", wanted.email))
    }
    pub fn recover(&mut self) -> R<String> {
        platform::ensure_file_auth(&self.home)?;
        let p = self.root.join("transaction.dpapi");
        let j: Value =
            serde_json::from_slice(&dec(&p)?).map_err(|_| "Κατεστραμμένο αρχείο ανάκτησης")?;
        let prev = if let Some(raw) = j["previous"].as_str() {
            let b = Zeroizing::new(STANDARD.decode(raw).map_err(|_| "Κατεστραμμένο backup")?);
            identity(&b)?;
            Some(b)
        } else {
            None
        };
        platform::stop()?;
        if let Some(bytes) = prev {
            platform::atomic(&self.home.join("auth.json"), &bytes)?;
        } else if self.home.join("auth.json").exists() {
            fs::remove_file(self.home.join("auth.json"))
                .map_err(|_| "Αδυναμία επαναφοράς απουσίας login")?;
        }
        platform::launch()?;
        fs::remove_file(p).map_err(|_| "Η επαναφορά έγινε, αλλά το journal δεν διαγράφηκε")?;
        Ok("Αποκαταστάθηκε η προηγούμενη σύνδεση και άνοιξε το Codex.".into())
    }
}
pub struct CheckJob {
    id: String,
    auth: Value,
}
impl CheckJob {
    pub fn run(&self) -> R<Health> {
        let i = identity(&serde_json::to_vec(&self.auth).map_err(|_| "Μη έγκυρο αρχείο")?)?;
        let token = self.auth["tokens"]["access_token"]
            .as_str()
            .ok_or("Λείπει token")?;
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(12))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "Αδυναμία δικτύου")?;
        let result = client
            .get("https://chatgpt.com/backend-api/wham/usage")
            .bearer_auth(token)
            .header("ChatGPT-Account-Id", &i.account_id)
            .header("User-Agent", "ChatGPTAccountSwitcher/0.1")
            .send();
        let mut h = Health {
            checked: now(),
            ..Default::default()
        };
        match result {
            Err(_) => {
                h.status = "network".into();
                h.message="Δεν έγινε σύνδεση με τον διακομιστή. Δεν σημαίνει ότι έληξαν τα διαπιστευτήρια.".into()
            }
            Ok(r) => match r.status().as_u16() {
                200 => {
                    let v = r
                        .json::<Value>()
                        .map_err(|_| "Μη αναγνωρίσιμη απάντηση ορίων")?;
                    h.status = "valid".into();
                    h.message = "Τα διαπιστευτήρια έγιναν αποδεκτά από την OpenAI.".into();
                    h.usage = Some(
                        json!({"five":v.pointer("/rate_limit/primary_window"),"week":v.pointer("/rate_limit/secondary_window")}),
                    );
                }
                401 => {
                    h.status = if i.expires <= now() {
                        "expired"
                    } else {
                        "reauth"
                    }
                    .into();
                    h.message = "Η OpenAI απορρίπτει τη σύνδεση. Απαιτείται νέο login.".into()
                }
                403 => {
                    h.status = "denied".into();
                    h.message="Η πρόσβαση απορρίφθηκε (403). Μπορεί να αφορά δικαιώματα ή προστασία δικτύου· δεν αποδεικνύει λήξη.".into()
                }
                code => {
                    h.status = "service".into();
                    h.message = format!("Ο έλεγχος επέστρεψε HTTP {}. Δοκίμασε ξανά.", code);
                }
            },
        }
        Ok(h)
    }
}
impl Drop for Store {
    fn drop(&mut self) {
        let _ = self.cancel_login();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(account: &str, user: &str, expired: bool) -> Vec<u8> {
        let claims = json!({"chatgpt_account_id":account,"chatgpt_user_id":user});
        let jwt = |v: Value| {
            format!(
                "e30.{}.test",
                URL_SAFE_NO_PAD.encode(serde_json::to_vec(&v).unwrap())
            )
        };
        serde_json::to_vec(&json!({"tokens":{"account_id":account,"access_token":jwt(json!({"https://api.openai.com/auth":claims,"exp":if expired{1}else{now()+3600},"iat":1})),"id_token":jwt(json!({"https://api.openai.com/auth":claims,"email":"test@example.test"}))}})).unwrap()
    }
    #[test]
    fn accepts_matching_identity() {
        let i = identity(&fixture("a", "u", false)).unwrap();
        assert_eq!(i.key(), "a:u");
    }
    #[test]
    fn rejects_mixed_account() {
        let mut v: Value = serde_json::from_slice(&fixture("a", "u", false)).unwrap();
        v["tokens"]["account_id"] = json!("other");
        assert!(identity(&serde_json::to_vec(&v).unwrap()).is_err());
    }
    #[test]
    fn separates_users_in_shared_workspace() {
        assert_ne!(
            identity(&fixture("a", "u1", false)).unwrap().key(),
            identity(&fixture("a", "u2", false)).unwrap().key()
        );
    }
    #[test]
    fn expiry_uses_access_not_id_token() {
        assert!(identity(&fixture("a", "u", true)).unwrap().expires < now());
    }
    #[test]
    fn rejects_api_key_and_malformed_tokens() {
        assert!(identity(br#"{"OPENAI_API_KEY":"test"}"#).is_err());
        assert!(identity(b"no").is_err());
    }
    #[test]
    fn vault_round_trip_and_wrong_entropy() {
        let e = platform::protect(b"secret", ENTROPY, false).unwrap();
        assert_ne!(e, b"secret");
        assert_eq!(platform::protect(&e, ENTROPY, true).unwrap(), b"secret");
        assert!(platform::protect(&e, b"wrong", true).is_err());
    }
    #[test]
    fn atomic_replaces_existing_file() {
        let d = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&d).unwrap();
        let p = d.join("auth.json");
        platform::atomic(&p, b"one").unwrap();
        platform::atomic(&p, b"two").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"two");
        fs::remove_file(p).unwrap();
        fs::remove_dir(d).unwrap();
    }
    struct Sandbox {
        store: Option<Store>,
        path: PathBuf,
    }
    impl Sandbox {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("harbor-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            let vault = path.join("vault");
            let home = path.join("home");
            fs::create_dir(&vault).unwrap();
            fs::create_dir(&home).unwrap();
            let lock = fs::OpenOptions::new()
                .create(true)
                .truncate(false)
                .read(true)
                .write(true)
                .open(vault.join("vault.lock"))
                .unwrap();
            lock.try_lock_exclusive().unwrap();
            Self {
                store: Some(Store {
                    root: vault,
                    home,
                    _lock: lock,
                    health: HashMap::new(),
                    login: None,
                    notice: None,
                    excluded: HashSet::new(),
                }),
                path,
            }
        }
        fn s(&mut self) -> &mut Store {
            self.store.as_mut().unwrap()
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            drop(self.store.take());
            for name in ["vault", "home"] {
                let p = self.path.join(name);
                for f in fs::read_dir(&p).unwrap() {
                    let f = f.unwrap();
                    if f.file_type().unwrap().is_file() {
                        let _ = fs::remove_file(f.path());
                    }
                }
                let _ = fs::remove_dir(p);
            }
            let _ = fs::remove_dir(&self.path);
        }
    }
    #[test]
    fn saving_same_identity_deduplicates_and_keeps_previous() {
        let mut t = Sandbox::new();
        let raw = fixture("a", "u", false);
        let a = t.s().save("Work", &raw, None).unwrap();
        let b = t.s().save("Renamed", &raw, None).unwrap();
        assert_eq!(a, b);
        assert_eq!(t.s().all().len(), 1);
        assert!(t.s().path(&a).unwrap().with_extension("previous").exists());
    }
    #[test]
    fn reconnect_cannot_overwrite_another_account() {
        let mut t = Sandbox::new();
        let id = t.s().save("Work", &fixture("a", "u", false), None).unwrap();
        assert!(t
            .s()
            .save("Work", &fixture("b", "u", false), Some("a:u"))
            .is_err());
        let s = t.s().load(&id).unwrap();
        assert_eq!(
            identity(&serde_json::to_vec(&s.auth).unwrap())
                .unwrap()
                .account_id,
            "a"
        );
        assert_eq!(t.s().all().len(), 1);
    }
    #[test]
    fn live_account_is_not_assigned_by_label() {
        let mut t = Sandbox::new();
        let a = t
            .s()
            .save("Wrong label", &fixture("a", "u", false), None)
            .unwrap();
        let b = t
            .s()
            .save("Wrong label", &fixture("b", "u", false), None)
            .unwrap();
        platform::atomic(&t.s().home.join("auth.json"), &fixture("b", "u", false)).unwrap();
        let snap = t.s().snapshot().unwrap();
        assert!(!snap.profiles.iter().find(|p| p.id == a).unwrap().active);
        assert!(snap.profiles.iter().find(|p| p.id == b).unwrap().active);
    }
    #[test]
    fn sync_preserves_other_profiles() {
        let mut t = Sandbox::new();
        let a = t.s().save("A", &fixture("a", "u", false), None).unwrap();
        let b = t.s().save("B", &fixture("b", "u", false), None).unwrap();
        let mut raw: Value = serde_json::from_slice(&fixture("a", "u", false)).unwrap();
        raw["last_refresh"] = json!("new");
        platform::atomic(
            &t.s().home.join("auth.json"),
            &serde_json::to_vec(&raw).unwrap(),
        )
        .unwrap();
        t.s().sync().unwrap();
        assert_eq!(t.s().load(&a).unwrap().auth["last_refresh"], "new");
        assert!(t.s().load(&b).unwrap().auth.get("last_refresh").is_none());
    }
    #[test]
    fn rejects_path_traversal() {
        let mut t = Sandbox::new();
        assert!(t.s().path("../auth").is_err());
    }
    #[test]
    fn vault_is_ciphertext_and_tampering_fails() {
        let mut t = Sandbox::new();
        let id = t
            .s()
            .save("Private email", &fixture("a", "u", false), None)
            .unwrap();
        let p = t.s().path(&id).unwrap();
        let mut encrypted = fs::read(&p).unwrap();
        assert!(!String::from_utf8_lossy(&encrypted).contains("test@example.test"));
        let last = encrypted.len() - 1;
        encrypted[last] ^= 1;
        fs::write(p, encrypted).unwrap();
        assert!(t.s().load(&id).is_err());
    }
    #[test]
    fn unknown_live_account_is_saved_once_and_marked_current() {
        let mut t = Sandbox::new();
        platform::atomic(
            &t.s().home.join("auth.json"),
            &fixture("new", "user", false),
        )
        .unwrap();
        let first = t.s().snapshot().unwrap();
        assert_eq!(first.profiles.len(), 1);
        assert!(first.profiles[0].active);
        assert_eq!(
            first.profiles[0].identity.as_ref().unwrap().account_id,
            "new"
        );
        assert_eq!(first.notice.as_deref(), Some("auto_added"));
        let id = first.profiles[0].id.clone();
        assert_eq!(t.s().snapshot().unwrap().profiles.len(), 1);
        assert!(!t.s().path(&id).unwrap().with_extension("previous").exists());
    }
    #[test]
    fn malformed_or_api_key_live_file_is_not_auto_added() {
        let mut t = Sandbox::new();
        for raw in [b"{partial".as_slice(), br#"{"OPENAI_API_KEY":"test"}"#] {
            platform::atomic(&t.s().home.join("auth.json"), raw).unwrap();
            let snapshot = t.s().snapshot().unwrap();
            assert!(snapshot.profiles.is_empty());
            assert!(snapshot.current.is_none());
        }
    }
    #[test]
    fn removed_live_account_stays_removed_across_reloads() {
        let mut t = Sandbox::new();
        let raw = fixture("a", "u", false);
        platform::atomic(&t.s().home.join("auth.json"), &raw).unwrap();
        let id = t.s().snapshot().unwrap().profiles[0].id.clone();
        t.s().save("A", &raw, None).unwrap();
        let path = t.s().path(&id).unwrap();
        t.s().remove(&id).unwrap();
        assert!(!path.exists());
        assert!(!path.with_extension("previous").exists());
        assert_eq!(fs::read(t.s().home.join("auth.json")).unwrap(), raw);
        t.s().excluded.clear();
        t.s().excluded = Store::read_excluded(&t.s().root).unwrap();
        let snapshot = t.s().snapshot().unwrap();
        assert!(snapshot.profiles.is_empty());
        assert!(snapshot.current.is_some());
        // A new explicit sign-in restores the user's intent to keep this account.
        t.s().save("A", &raw, None).unwrap();
        assert!(!Store::read_excluded(&t.s().root).unwrap().contains("a:u"));
        assert_eq!(t.s().snapshot().unwrap().profiles.len(), 1);
    }
    #[test]
    fn removing_one_user_does_not_exclude_another_in_same_workspace() {
        let mut t = Sandbox::new();
        let id = t
            .s()
            .save("A", &fixture("shared", "one", false), None)
            .unwrap();
        t.s().remove(&id).unwrap();
        platform::atomic(
            &t.s().home.join("auth.json"),
            &fixture("shared", "two", false),
        )
        .unwrap();
        let snapshot = t.s().snapshot().unwrap();
        assert_eq!(snapshot.profiles.len(), 1);
        assert_eq!(
            snapshot.profiles[0].identity.as_ref().unwrap().user_id,
            "two"
        );
    }
    #[test]
    fn stale_usage_response_cannot_restore_removed_account() {
        let mut t = Sandbox::new();
        let id = t.s().save("A", &fixture("a", "u", false), None).unwrap();
        let job = t.s().prepare_check(&id).unwrap();
        t.s().remove(&id).unwrap();
        t.s()
            .finish_check(
                &job,
                Health {
                    status: "valid".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(!t.s().health.contains_key(&id));
        assert!(t.s().all().is_empty());
    }
    #[test]
    fn stale_usage_response_is_ignored_after_token_rotation() {
        let mut t = Sandbox::new();
        let id = t.s().save("A", &fixture("a", "u", false), None).unwrap();
        let job = t.s().prepare_check(&id).unwrap();
        let mut raw: Value = serde_json::from_slice(&fixture("a", "u", false)).unwrap();
        raw["last_refresh"] = json!("rotated");
        t.s()
            .save("A", &serde_json::to_vec(&raw).unwrap(), None)
            .unwrap();
        t.s()
            .finish_check(
                &job,
                Health {
                    status: "valid".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(!t.s().health.contains_key(&id));
    }
    #[test]
    fn removal_rejects_paths_outside_the_vault() {
        let mut t = Sandbox::new();
        assert!(t.s().remove("../auth").is_err());
        assert!(!t.s().root.join("excluded.dpapi").exists());
    }
}
