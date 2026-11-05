import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
function fixture(t) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempRoot,'switcher-release-test-'));
  t.after(() => {
    const target = fs.realpathSync(root);
    if (path.dirname(target) !== tempRoot || !path.basename(target).startsWith('switcher-release-test-')) throw Error('Refusing to remove a path outside the test fixture directory.');
    fs.rmSync(target,{recursive:true,force:true});
  });
  for (const file of ['package.json','package-lock.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/tauri.conf.json','CHANGELOG.md','LICENSE','ui/public/FONT-LICENSES.txt','scripts/release.mjs']) {
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});
    fs.copyFileSync(path.join(project,file),path.join(root,file));
  }
  fs.writeFileSync(path.join(root,'ui/public/THIRD-PARTY-LICENSES.txt'),'Test license notices\n');
  const run = (command, args=[], env={}) => spawnSync(process.execPath,[path.join(root,'scripts/release.mjs'),command,...args],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_REPOSITORY:'nickfouf/ChatGPTAccountSwitcher',RELEASE_TAG:'',...env}});
  return {root,run};
}
test('version preparation updates every manifest and rejects unrevised release notes',t=>{
  const {root,run}=fixture(t);
  assert.equal(run('validate').status,0);
  assert.notEqual(run('validate',['v9.9.9']).status,0);
  assert.equal(run('bump',['9.0.0']).status,0);
  for(const file of ['package.json','src-tauri/tauri.conf.json','package-lock.json'])assert.equal(JSON.parse(fs.readFileSync(path.join(root,file),'utf8')).version,'9.0.0');
  assert.match(fs.readFileSync(path.join(root,'src-tauri/Cargo.lock'),'utf8'),/name = "chatgpt-account-switcher"\nversion = "9.0.0"/);
  assert.notEqual(run('validate').status,0);
  const changelog=path.join(root,'CHANGELOG.md');
  fs.writeFileSync(changelog,fs.readFileSync(changelog,'utf8').replace('Describe user-visible changes before releasing.','Improve the update experience.'));
  assert.equal(run('validate',['v9.0.0']).status,0);
  assert.notEqual(run('bump',['8.0.0']).status,0);
});
test('release manifest preserves signatures, cumulative notes, encoded URLs, and accurate checksums',t=>{
  const {root,run}=fixture(t);
  const bundle=path.join(root,'bundle');fs.mkdirSync(bundle);
  const installer='ChatGPT Account Switcher_0.1.0_x64-setup.exe';
  fs.writeFileSync(path.join(bundle,installer),'synthetic installer fixture');
  fs.writeFileSync(path.join(bundle,'ChatGPT Account Switcher_0.0.1_x64-setup.exe'),'stale previous release');
  fs.writeFileSync(path.join(bundle,`${installer}.sig`),'synthetic-signature\n');
  assert.equal(run('manifest',[],{BUNDLE_DIR:bundle}).status,0);
  const release=path.join(root,'release'),manifest=JSON.parse(fs.readFileSync(path.join(release,'latest.json'),'utf8'));
  assert.equal(manifest.platforms['windows-x86_64'].signature,'synthetic-signature');
  assert.equal(manifest.platforms['windows-x86_64'].url,`https://github.com/nickfouf/ChatGPTAccountSwitcher/releases/download/v0.1.0/${encodeURIComponent(installer)}`);
  assert.match(manifest.notes,/## \[0\.1\.0\]/);
  for(const line of fs.readFileSync(path.join(release,'SHA256SUMS.txt'),'utf8').trim().split('\n')){
    const [sum,file]=line.split('  ');assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(release,file))).digest('hex'),sum);
  }
  fs.writeFileSync(path.join(bundle,`${installer}.sig`),'');
  assert.notEqual(run('manifest',[],{BUNDLE_DIR:bundle}).status,0);
});
