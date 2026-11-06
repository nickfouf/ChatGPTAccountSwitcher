import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { languages } from '../ui/languages.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const mapping = JSON.parse(read('src-tauri/installer/languages.json'));
const config = JSON.parse(read('src-tauri/tauri.conf.json')).bundle.windows.nsis;
const parse = text => [...text.matchAll(/^LangString\s+(\w+)\s+(\S+)\s+"((?:[^"\r\n]|\$\\")*)"\s*$/gm)];
const variables = text => [...new Set([...text.matchAll(/\$\{\w+\}|\$(?:R\d|\d)/g)].map(match => match[0]))].sort();

test('installer and uninstaller support exactly the app languages with Windows selection and English fallback', () => {
  assert.equal(languages.length, 32);
  assert.deepEqual(Object.keys(mapping), languages.map(language => language.code));
  assert.equal(new Set(Object.values(mapping)).size, languages.length);
  assert.deepEqual(config.languages, Object.values(mapping));
  assert.equal(config.languages[0], 'English');
  assert.equal(config.displayLanguageSelector, true);
  assert.deepEqual(Object.keys(config.customLanguageFiles).sort(), [...config.languages].sort());
  assert.deepEqual(fs.readdirSync(path.join(root, 'src-tauri/installer/languages')).sort(), config.languages.map(name => `${name}.nsh`).sort());
});

test('every installer locale covers all native messages and preserves product, version, and error variables', () => {
  const english = new Map(parse(read('src-tauri/installer/languages/English.nsh')).map(match => [match[1], match[3]]));
  assert.equal(english.size, 27);
  for (const [locale, name] of Object.entries(mapping)) {
    const file = config.customLanguageFiles[name];
    assert.equal(file, `installer/languages/${name}.nsh`);
    const source = read(`src-tauri/${file}`);
    const rows = parse(source);
    assert.equal(rows.length, english.size, `${name}: missing, duplicated, or malformed message`);
    assert.deepEqual(rows.map(match => match[1]).sort(), [...english.keys()].sort(), name);
    for (const [, key, languageId, message] of rows) {
      assert.equal(languageId, '${LANG_' + name.toUpperCase() + '}', `${name}:${key}`);
      assert.ok(message.trim(), `${name}:${key} is empty`);
      assert.deepEqual(variables(message), variables(english.get(key)), `${name}:${key} variables`);
      if (locale !== 'en') assert.notEqual(message, english.get(key), `${name}:${key} is untranslated`);
    }
    assert.ok(!source.includes('{{'), `${name}: unexpanded template placeholder`);
    assert.ok(!source.includes('choowHowToInstall'), `${name}: obsolete message key`);
  }
});

test('installer upstream translations have a bundled attribution and MIT license', () => {
  assert.match(read('src-tauri/installer/UPSTREAM.md'), /tauri-cli-v2\.12\.4/);
  assert.match(read('src-tauri/installer/UPSTREAM-LICENSE-MIT.txt'), /Permission is hereby granted/);
  assert.match(read('scripts/licenses.mjs'), /UPSTREAM-LICENSE-MIT\.txt/);
});
