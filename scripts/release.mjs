import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {targets, releaseTarget, assetName} from './release-targets.mjs';

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

const notices = ['LICENSE.txt', 'FONT-LICENSES.txt', 'THIRD-PARTY-LICENSES.txt'];
const urlFor = (version, file) => `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(file)}`;
function checksum(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function writeChecksums(out, assets) {
  fs.writeFileSync(`${out}/SHA256SUMS.txt`, [...new Set(assets)].sort().map(file => `${checksum(path.join(out,file))}  ${file}`).join('\n')+'\n');
}
function releaseNotes() {
  return `Switch saved Codex accounts and see usage in one place.\n\n![UI walkthrough](https://raw.githubusercontent.com/${repository}/v${pkg.version}/docs/assets/walkthrough.gif)\n\n*UI walkthrough with sample accounts; native sign-in and restarts are simulated. macOS/Linux support is experimental. macOS builds are not notarized unless Apple signing is configured.*\n\n${sections[0][0].trim()}\n\n### Installation\n- Windows x64: download the **-setup.exe** installer.\n- macOS Apple Silicon: download the **.dmg**.\n- Linux x64 or ARM64: download the matching **.AppImage**, **.deb**, or **.rpm**. AppImage supports in-app updates; update DEB/RPM installations by installing a new package.\n\nUpdates preserve locally encrypted accounts and are cryptographically verified. Windows builds currently have no Authenticode certificate. macOS distribution signing and notarization require the maintainer's Apple signing configuration.\n`;
}
function manifest() {
  const version = validate(process.env.RELEASE_TAG);
  const target = releaseTarget();
  const bundleRoot = `src-tauri/target/${target.triple}/release/bundle`;
  const bundle = process.env.BUNDLE_DIR || `${bundleRoot}/${target.directory}`;
  const files = fs.readdirSync(bundle).filter(file => file.endsWith(target.extension)
    && (target.platform.startsWith('darwin-') || file.includes(`_${version}_`)));
  if (files.length !== 1) fail(`Expected exactly one ${target.label} updater package for ${version}.`);
  const source = files[0];
  const installer = assetName(pkg.name, version, target);
  const signature = fs.readFileSync(path.join(bundle, `${source}.sig`), 'utf8').trim();
  if (!signature) fail('Installer signature is empty.');
  const out = 'release'; fs.mkdirSync(out, {recursive:true});
  fs.copyFileSync(path.join(bundle, source), path.join(out, installer));
  fs.copyFileSync(path.join(bundle, `${source}.sig`), path.join(out, `${installer}.sig`));
  const assets = [installer, `${installer}.sig`, 'latest.json', ...notices];
  // DMG/DEB/RPM downloads accompany the signed updater package.
  if (!process.env.BUNDLE_DIR) {
    for (const [directory,extension] of target.platform.startsWith('darwin-') ? [['dmg','.dmg']] : target.platform.startsWith('linux-') ? [['deb','.deb'],['rpm','.rpm']] : []) {
      const folder = path.join(bundleRoot,directory);
      const downloads = fs.readdirSync(folder).filter(file => file.endsWith(extension) && (file.includes(`_${version}_`) || file.includes(`-${version}-`)));
      if (downloads.length !== 1) fail(`Expected one ${extension} download for ${target.label}.`);
      const name = `${pkg.name}_${version}_${target.platform}${extension}`;
      fs.copyFileSync(path.join(folder,downloads[0]),path.join(out,name)); assets.push(name);
    }
  }
  const notes = sections.map(section => section[0].trim()).join('\n\n');
  writeJSON(`${out}/latest.json`, {version, notes, pub_date:new Date().toISOString(), platforms:{[target.platform]:{signature, url:urlFor(version,installer)}}});
  fs.writeFileSync(`${out}/release-notes.md`, releaseNotes());
  fs.copyFileSync('LICENSE', `${out}/LICENSE.txt`);
  fs.copyFileSync('ui/public/FONT-LICENSES.txt', `${out}/FONT-LICENSES.txt`);
  fs.copyFileSync('ui/public/THIRD-PARTY-LICENSES.txt', `${out}/THIRD-PARTY-LICENSES.txt`);
  writeChecksums(out, assets);
  console.log(`Prepared ${target.label} assets in ${out}/.`);
}

function checkedAssets(directory) {
  const seen = new Set();
  for (const line of fs.readFileSync(path.join(directory,'SHA256SUMS.txt'),'utf8').trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    if (!match || seen.has(match[2])) fail('Invalid or repeated checksum filename.');
    const [,hash,file] = match;
    if (checksum(path.join(directory,file)) !== hash) fail(`Downloaded checksum does not match ${file}.`);
    seen.add(file);
  }
  return seen;
}

function verifyRelease(directory = 'release', requireAll = false) {
  const version = validate();
  const manifest = readJSON(path.join(directory,'latest.json'));
  if (manifest.version !== version) fail('Release manifest version does not match.');
  if (requireAll && JSON.stringify(Object.keys(manifest.platforms || {}).sort()) !== JSON.stringify(Object.values(targets).map(target=>target.platform).sort())) fail('Release manifest must include every desktop platform.');
  const assets = checkedAssets(directory);
  const required = new Set(['latest.json',...notices]);
  const allowed = new Set(required);
  if (!Object.keys(manifest.platforms || {}).length) fail('Release manifest has no platforms.');
  for (const [platform,entry] of Object.entries(manifest.platforms)) {
    const target = Object.values(targets).find(target => target.platform === platform);
    if (!target) fail(`Unsupported updater platform: ${platform}`);
    const installer = assetName(pkg.name,version,target);
    if (entry.url !== urlFor(version,installer)) fail('Downloaded update manifest does not point to the expected release asset.');
    if (!entry.signature || entry.signature !== fs.readFileSync(path.join(directory,`${installer}.sig`),'utf8').trim()) fail('Downloaded manifest signature does not match the signature asset.');
    for (const name of [installer,`${installer}.sig`]) { required.add(name); allowed.add(name); }
    for (const extension of platform.startsWith('darwin-') ? ['.dmg'] : platform.startsWith('linux-') ? ['.deb','.rpm'] : []) allowed.add(`${pkg.name}_${version}_${platform}${extension}`);
  }
  if ([...required].some(file => !assets.has(file))) fail('Downloaded checksums omit required assets.');
  if ([...assets].some(file => !allowed.has(file))) fail('Unexpected checksum filename.');
  console.log('Verified manifest URLs, signature references, filenames, and all release checksums.');
  return {manifest,assets};
}

function merge() {
  validate(process.env.RELEASE_TAG);
  const input = process.env.RELEASE_PARTS_DIR || 'release-parts';
  const out = 'release'; fs.mkdirSync(out,{recursive:true});
  const platforms = {}, assets = new Set(['latest.json',...notices]), licenses = [];
  let merged;
  for (const target of Object.values(targets)) {
    const directory = path.join(input,target.platform);
    const part = verifyRelease(directory);
    if (Object.keys(part.manifest.platforms).length !== 1 || !part.manifest.platforms[target.platform]) fail(`Expected only ${target.platform} in release part.`);
    if (merged && part.manifest.notes !== merged.notes) fail('Release parts have different release notes.');
    merged = part.manifest;
    platforms[target.platform] = part.manifest.platforms[target.platform];
    for (const file of part.assets) {
      if (file === 'latest.json' || notices.includes(file)) continue;
      if (assets.has(file)) fail(`Repeated release asset: ${file}`);
      fs.copyFileSync(path.join(directory,file),path.join(out,file)); assets.add(file);
    }
    licenses.push(`Platform: ${target.platform}\n\n${fs.readFileSync(path.join(directory,'THIRD-PARTY-LICENSES.txt'),'utf8')}`);
  }
  writeJSON(`${out}/latest.json`,{...merged,pub_date:new Date().toISOString(),platforms});
  fs.writeFileSync(`${out}/release-notes.md`,releaseNotes());
  fs.copyFileSync('LICENSE',`${out}/LICENSE.txt`);
  fs.copyFileSync('ui/public/FONT-LICENSES.txt',`${out}/FONT-LICENSES.txt`);
  fs.writeFileSync(`${out}/THIRD-PARTY-LICENSES.txt`,licenses.join('\n\n'));
  writeChecksums(out,[...assets]);
  verifyRelease(out, true);
}

const command = process.argv[2];
if (command === 'validate') validate(process.env.RELEASE_TAG || process.argv[3]);
else if (command === 'bump') bump(process.argv[3]);
else if (command === 'manifest') manifest();
else if (command === 'verify') verifyRelease('release', process.argv.includes('--all'));
else if (command === 'merge') merge();
else if (command === 'build') {
  execFileSync(process.execPath, ['--test', 'scripts/installer.test.mjs'], {stdio:'inherit'});
  validate();
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
    const key = path.join(process.env.USERPROFILE || process.env.HOME || '', '.chatgpt-account-switcher/keys/updater.key');
    if (!fs.existsSync(key)) fail('Set TAURI_SIGNING_PRIVATE_KEY or run npm run signing:setup first.');
    process.env.TAURI_SIGNING_PRIVATE_KEY = key;
  }
  const target = releaseTarget();
  // Empty optional GitHub secrets must not activate an incomplete Apple signing flow.
  for (const name of ['APPLE_CERTIFICATE','APPLE_CERTIFICATE_PASSWORD','APPLE_SIGNING_IDENTITY','APPLE_ID','APPLE_PASSWORD','APPLE_TEAM_ID']) {
    if (!process.env[name]) delete process.env[name];
  }
  const cli = path.resolve('node_modules/@tauri-apps/cli/tauri.js');
  execFileSync(process.execPath, [cli, 'build', '--target', target.triple, '--bundles', target.bundles, ...(target.config ? ['--config',target.config] : []), '--', '--locked'], {stdio:'inherit'});
  manifest();
  execFileSync('cargo', ['run', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--example', 'verify_release', '--release', '--target', target.triple, '--', 'src-tauri/tauri.conf.json', 'release/latest.json'], {stdio:'inherit'});
} else fail('Unknown release command.');
