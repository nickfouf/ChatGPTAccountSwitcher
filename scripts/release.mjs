import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
// Existing process variables (including CI secrets) take precedence over local configuration.
if (fs.existsSync('.env')) process.loadEnvFile('.env');
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const pkg = readJSON('package.json');
const config = readJSON('src-tauri/tauri.conf.json');
const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const semver = /^\d+\.\d+\.\d+$/;
const fail = message => { throw Error(message); };
const repository = process.env.GITHUB_REPOSITORY || 'nickfouf/ChatGPTAccountSwitcher';
if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) fail('Invalid GitHub repository.');
const sections = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];

export function validate(tag) {
  const version = pkg.version;
  if (!semver.test(version)) fail('Releases require a stable x.y.z version.');
  if (config.version !== version || cargo.match(/^version = "([^"]+)"/m)?.[1] !== version || readJSON('package-lock.json').version !== version || readJSON('package-lock.json').packages[''].version !== version) fail('Package, Tauri, Cargo, and npm lockfile versions must match.');
  const cargoLock = fs.readFileSync('src-tauri/Cargo.lock', 'utf8');
  if (!cargoLock.includes(`name = "${pkg.name}"\nversion = "${version}"`)) fail('Cargo.lock package version must match. Run cargo check to refresh it.');
  if (tag && tag !== `v${version}`) fail(`Tag ${tag} does not match v${version}.`);
  if (sections[0]?.[1] !== version || !sections[0][3].trim()) fail('Add a nonempty, dated changelog section for the current version at the top.');
  if (sections[0][3].includes('Describe user-visible changes before releasing.')) fail('Replace the generated changelog placeholder before releasing.');
  if (!config.plugins.updater.pubkey || config.plugins.updater.pubkey.includes('PLACEHOLDER')) fail('Configure an updater public key.');
  const endpoint = `https://github.com/${repository}/releases/latest/download/latest.json`;
  if (config.plugins.updater.endpoints[0] !== endpoint) fail(`Updater endpoint must point to ${repository}. Update tauri.conf.json before releasing a fork.`);
  console.log(`Validated v${version} for ${repository}.`);
  return version;
}

function bump(version) {
  if (!semver.test(version || '')) fail('Usage: npm run version:prepare -- x.y.z');
  const before = pkg.version.split('.').map(Number), after = version.split('.').map(Number);
  if (after[0] < before[0] || (after[0] === before[0] && after[1] < before[1]) || (after[0] === before[0] && after[1] === before[1] && after[2] <= before[2])) fail('The new version must be greater than the current version.');
  const originalVersion = pkg.version;
  pkg.version = version; config.version = version;
  writeJSON('package.json', pkg); writeJSON('src-tauri/tauri.conf.json', config);
  const lock = readJSON('package-lock.json'); lock.version = version; lock.packages[''].version = version; writeJSON('package-lock.json', lock);
  fs.writeFileSync('src-tauri/Cargo.toml', cargo.replace(/^version = "[^"]+"/m, `version = "${version}"`));
  const cargoLock = fs.readFileSync('src-tauri/Cargo.lock', 'utf8');
  fs.writeFileSync('src-tauri/Cargo.lock', cargoLock.replace(`name = "${pkg.name}"\nversion = "${originalVersion}"`, `name = "${pkg.name}"\nversion = "${version}"`));
  const date = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Athens',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const first = changelog.indexOf('## [');
  fs.writeFileSync('CHANGELOG.md', changelog.slice(0, first) + `## [${version}] - ${date}\n\n### Changed\n- Describe user-visible changes before releasing.\n\n` + changelog.slice(first));
  console.log(`Prepared v${version}. Edit CHANGELOG.md before committing and tagging.`);
}

function manifest() {
  const version = validate(process.env.RELEASE_TAG);
  const bundle = process.env.BUNDLE_DIR || 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis';
  const files = fs.readdirSync(bundle).filter(file => file.endsWith(`_${version}_x64-setup.exe`));
  if (files.length !== 1) fail(`Expected exactly one Windows x64 NSIS installer for ${version}.`);
  const installer = files[0];
  const signature = fs.readFileSync(path.join(bundle, `${installer}.sig`), 'utf8').trim();
  if (!signature) fail('Installer signature is empty.');
  const out = 'release'; fs.mkdirSync(out, {recursive:true});
  for (const file of [installer, `${installer}.sig`]) fs.copyFileSync(path.join(bundle, file), path.join(out, file));
  const notes = sections.map(section => section[0].trim()).join('\n\n');
  writeJSON(`${out}/latest.json`, {version, notes, pub_date:new Date().toISOString(), platforms:{'windows-x86_64':{signature, url:`https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(installer)}`}}});
  fs.writeFileSync(`${out}/release-notes.md`, `${sections[0][0].trim()}\n\n### Installation\nDownload **${installer}** for Windows 10/11 (x64). Updates preserve your locally encrypted accounts.\n\nUpdates are cryptographically verified. This community project currently has no Windows Authenticode certificate, so Windows may show an unknown-publisher warning.\n`);
  fs.copyFileSync('LICENSE', `${out}/LICENSE.txt`);
  fs.copyFileSync('ui/public/FONT-LICENSES.txt', `${out}/FONT-LICENSES.txt`);
  fs.copyFileSync('ui/public/THIRD-PARTY-LICENSES.txt', `${out}/THIRD-PARTY-LICENSES.txt`);
  const assets = [installer, `${installer}.sig`, 'latest.json', 'LICENSE.txt', 'FONT-LICENSES.txt', 'THIRD-PARTY-LICENSES.txt'];
  fs.writeFileSync(`${out}/SHA256SUMS.txt`, assets.map(file => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(out, file))).digest('hex')}  ${file}`).join('\n')+'\n');
  console.log(`Prepared installer, signature, manifest, notes, licenses, and checksums in ${out}/.`);
}

const command = process.argv[2];
if (command === 'validate') validate(process.env.RELEASE_TAG || process.argv[3]);
else if (command === 'bump') bump(process.argv[3]);
else if (command === 'manifest') manifest();
else if (command === 'build') {
  validate();
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
    const key = path.join(process.env.USERPROFILE || process.env.HOME || '', '.chatgpt-account-switcher/keys/updater.key');
    if (!fs.existsSync(key)) fail('Set TAURI_SIGNING_PRIVATE_KEY or run npm run signing:setup first.');
    process.env.TAURI_SIGNING_PRIVATE_KEY = key;
  }
  const cli = path.resolve('node_modules/@tauri-apps/cli/tauri.js');
  execFileSync(process.execPath, [cli, 'build', '--target', 'x86_64-pc-windows-msvc', '--bundles', 'nsis', '--', '--locked'], {stdio:'inherit'});
  manifest();
  execFileSync('cargo', ['run', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--example', 'verify_release', '--release', '--target', 'x86_64-pc-windows-msvc', '--', 'src-tauri/tauri.conf.json', 'release/latest.json'], {stdio:'inherit'});
} else fail('Unknown release command.');
