//! Validate release assets without launching the application or touching account storage.
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde_json::Value;
use std::{error::Error, fs, path::Path};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    let config: Value = serde_json::from_slice(&fs::read(
        args.get(1)
            .ok_or("Expected Tauri config and release manifest paths")?,
    )?)?;
    let manifest_path = Path::new(args.get(2).ok_or("Expected release manifest path")?);
    let manifest: Value = serde_json::from_slice(&fs::read(manifest_path)?)?;
    let encoded_key = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .ok_or("Missing public key")?;
    let key_text = String::from_utf8(STANDARD.decode(encoded_key)?)?;
    let key = PublicKey::decode(&key_text)?;
    let platform = &manifest["platforms"]["windows-x86_64"];
    let signature_text = String::from_utf8(
        STANDARD.decode(platform["signature"].as_str().ok_or("Missing signature")?)?,
    )?;
    let signature = Signature::decode(&signature_text)?;
    let version = manifest["version"].as_str().ok_or("Missing version")?;
    if !signature
        .trusted_comment()
        .split('\t')
        .any(|field| field == format!("version:{version}"))
    {
        return Err("Signature does not bind the announced release version".into());
    }
    // Derive the standard local asset name from signed build metadata, never from a remote URL.
    let product = config["productName"]
        .as_str()
        .ok_or("Missing product name")?;
    let installer = manifest_path
        .parent()
        .ok_or("Missing manifest directory")?
        .join(format!("{product}_{version}_x64-setup.exe"));
    let mut bytes = fs::read(installer)?;
    key.verify(&bytes, &signature, true)?;
    if bytes.is_empty() {
        return Err("Empty installer".into());
    }
    bytes[0] ^= 1;
    if key.verify(&bytes, &signature, true).is_ok() {
        return Err("Tampered installer unexpectedly passed verification".into());
    }
    println!("Verified installer signature and version {version}; modified installer correctly rejected.");
    Ok(())
}
