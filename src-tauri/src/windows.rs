use std::{
    os::windows::process::CommandExt,
    path::Path,
    process::{Command, Output},
};
#[repr(C)]
struct Blob {
    len: u32,
    data: *mut u8,
}
#[link(name = "crypt32")]
unsafe extern "system" {
    fn CryptProtectData(
        input: *const Blob,
        desc: *const u16,
        entropy: *const Blob,
        reserved: *mut u8,
        prompt: *mut u8,
        flags: u32,
        out: *mut Blob,
    ) -> i32;
    fn CryptUnprotectData(
        input: *const Blob,
        desc: *mut *mut u16,
        entropy: *const Blob,
        reserved: *mut u8,
        prompt: *mut u8,
        flags: u32,
        out: *mut Blob,
    ) -> i32;
}
#[link(name = "kernel32")]
unsafe extern "system" {
    fn LocalFree(ptr: *mut u8) -> *mut u8;
    fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    fn GetUserPreferredUILanguages(
        flags: u32,
        count: *mut u32,
        buffer: *mut u16,
        size: *mut u32,
    ) -> i32;
}
pub fn preferred_languages() -> Vec<String> {
    // MUI_LANGUAGE_NAME returns Windows display languages as BCP 47 names.
    let (mut count, mut size) = (0, 0);
    if unsafe { GetUserPreferredUILanguages(8, &mut count, std::ptr::null_mut(), &mut size) } == 0
        || size == 0
    {
        return Vec::new();
    }
    let mut buffer = vec![0u16; size as usize];
    if unsafe { GetUserPreferredUILanguages(8, &mut count, buffer.as_mut_ptr(), &mut size) } == 0 {
        return Vec::new();
    }
    buffer
        .split(|&c| c == 0)
        .filter(|part| !part.is_empty())
        .map(String::from_utf16_lossy)
        .collect()
}

pub fn protect(bytes: &[u8], entropy: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    let a = Blob {
        len: bytes.len() as u32,
        data: bytes.as_ptr() as *mut u8,
    };
    let e = Blob {
        len: entropy.len() as u32,
        data: entropy.as_ptr() as *mut u8,
    };
    let mut out = Blob {
        len: 0,
        data: std::ptr::null_mut(),
    };
    let ok = unsafe {
        if decrypt {
            CryptUnprotectData(
                &a,
                std::ptr::null_mut(),
                &e,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                1,
                &mut out,
            )
        } else {
            CryptProtectData(
                &a,
                std::ptr::null(),
                &e,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                1,
                &mut out,
            )
        }
    };
    if ok == 0 {
        return Err("Αδυναμία αποκρυπτογράφησης. Χρειάζεται ο ίδιος χρήστης Windows.".into());
    }
    let result = unsafe { std::slice::from_raw_parts(out.data, out.len as usize).to_vec() };
    unsafe {
        std::ptr::write_bytes(out.data, 0, out.len as usize);
        LocalFree(out.data);
    }
    Ok(result)
}
pub fn atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut f = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&tmp)
        .map_err(|_| "Αδυναμία εγγραφής προσωρινού αρχείου")?;
    f.write_all(bytes)
        .and_then(|_| f.sync_all())
        .map_err(|_| "Αδυναμία αποθήκευσης")?;
    drop(f);
    let from: Vec<u16> = tmp
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let to: Vec<u16> = path
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect();
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 9) } == 0 {
        let _ = std::fs::remove_file(tmp);
        return Err("Αδυναμία ατομικής αντικατάστασης αρχείου".into());
    }
    Ok(())
}
pub fn ps(script: &str) -> Result<Output, String> {
    let exe = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let out = Command::new(format!(
        r"{}\System32\WindowsPowerShell\v1.0\powershell.exe",
        exe
    ))
    .args(["-NoProfile", "-NonInteractive", "-Command", script])
    .creation_flags(0x08000000)
    .output()
    .map_err(|_| "Αδυναμία εκκίνησης Windows PowerShell")?;
    if !out.status.success() {
        return Err("Η ενέργεια Windows απέτυχε. Δεν έγινε επιτυχής εναλλαγή.".into());
    }
    Ok(out)
}
pub fn secure_dir(path: &Path) -> Result<(), String> {
    // icacls updates the DACL without requesting SACL privileges, unlike
    // Set-Acl with a fresh DirectorySecurity on Windows PowerShell 5.1.
    let output = ps("[Security.Principal.WindowsIdentity]::GetCurrent().User.Value")?;
    let sid = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !sid.starts_with("S-1-")
        || !sid
            .chars()
            .all(|c| c.is_ascii_digit() || c == 'S' || c == '-')
    {
        return Err("Δεν αναγνωρίστηκε ο χρήστης Windows".into());
    }
    let system = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let status = Command::new(format!(r"{}\System32\icacls.exe", system))
        .arg(path)
        .args(["/inheritance:r", "/grant:r", &format!("*{}:(OI)(CI)F", sid)])
        .creation_flags(0x08000000)
        .output()
        .map_err(|_| "Δεν περιορίστηκε η πρόσβαση στο vault")?;
    if !status.status.success() {
        return Err(
            "Δεν περιορίστηκε η πρόσβαση στο vault. Δεν αποθηκεύτηκαν διαπιστευτήρια.".into(),
        );
    }
    Ok(())
}
pub fn stop() -> Result<(), String> {
    ps(r#"$ErrorActionPreference='Stop'
$ui=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'ChatGPT.exe' -and $_.ExecutablePath -match '\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\ChatGPT.exe$'})
foreach($p in $ui){$proc=Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue;if($proc){$null=$proc.CloseMainWindow()}}
Start-Sleep -Milliseconds 2000
$filter={($_.Name -eq 'ChatGPT.exe' -and $_.ExecutablePath -match '\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\ChatGPT.exe$') -or ($_.Name -eq 'codex.exe' -and $_.CommandLine -match '\sapp-server(\s|$)' -and $_.ExecutablePath -match '(\\OpenAI\\Codex\\|\\WindowsApps\\OpenAI\.Codex_)')}
$left=@(Get-CimInstance Win32_Process | Where-Object $filter)
foreach($p in $left){Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue}
Start-Sleep -Milliseconds 500
if(@(Get-CimInstance Win32_Process | Where-Object $filter).Count){throw 'Codex still running'}
"#)?;
    Ok(())
}
pub fn launch() -> Result<(), String> {
    ps(r#"$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")] class AppManager {}
[ComImport, Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IManager {
 [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id,[MarshalAs(UnmanagedType.LPWStr)] string args,uint flags,out uint pid);
}
public static class HarborLaunch {public static void Open(){uint pid;var m=(IManager)new AppManager();Marshal.ThrowExceptionForHR(m.ActivateApplication("OpenAI.Codex_2p2nqsd0c76g0!App",null,0,out pid));Marshal.ReleaseComObject(m);}}
'@
[HarborLaunch]::Open()
$found=$false
for($i=0;$i -lt 20;$i++){$p=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'ChatGPT.exe' -and $_.ExecutablePath -match '\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\ChatGPT.exe$'});if($p.Count){$found=$true;break};Start-Sleep -Milliseconds 500}
if(-not $found){throw 'Codex did not start'}
"#)?;
    Ok(())
}

pub fn vault_root() -> Result<std::path::PathBuf, String> {
    std::env::var_os("LOCALAPPDATA")
        .map(|root| std::path::PathBuf::from(root).join("CodexHarbor"))
        .ok_or_else(|| "LOCALAPPDATA is unavailable.".into())
}

pub fn find_cli() -> Result<std::path::PathBuf, String> {
    let root = std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default())
        .join("OpenAI/Codex/bin");
    let mut paths: Vec<_> = std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path().join("codex.exe"))
        .filter(|path| path.is_file())
        .collect();
    paths.sort_by_key(|path| {
        std::fs::metadata(path)
            .and_then(|meta| meta.modified())
            .ok()
    });
    paths.pop().ok_or_else(|| {
        "Could not find the official Codex CLI. Open the installed Codex app first.".into()
    })
}

pub fn show_error(error: &str) {
    let message = error.replace('\'', "''");
    let _ = ps(&format!("Add-Type -AssemblyName PresentationFramework;[System.Windows.MessageBox]::Show('{}','ChatGPT Account Switcher')", message));
}

#[cfg(test)]
mod language_tests {
    #[test]
    fn reads_windows_display_language_names() {
        let languages = super::preferred_languages();
        assert!(
            !languages.is_empty(),
            "Windows must supply a display language"
        );
        for language in languages {
            assert!(language.len() >= 2);
            assert!(language
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-'));
        }
    }
}
