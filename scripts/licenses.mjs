// Bundle license notices from the exact locked production dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const metadata = JSON.parse(execFileSync('cargo', ['metadata','--locked','--format-version','1','--manifest-path','src-tauri/Cargo.toml','--filter-platform','x86_64-pc-windows-msvc'], {encoding:'utf8',maxBuffer:20*1024*1024}));
const nodes = new Map(metadata.resolve.nodes.map(node => [node.id,node]));
const runtime = new Set();
function visit(id) {
  if (runtime.has(id)) return;
  runtime.add(id);
  for (const dependency of nodes.get(id)?.deps || []) {
    if (dependency.dep_kinds.some(kind => kind.kind === null)) visit(dependency.pkg);
  }
}
visit(metadata.resolve.root);
const sections = ['THIRD-PARTY SOFTWARE NOTICES\n\nThese notices cover locked npm production dependencies and Rust runtime dependencies for the Windows x64 build. Libraries retain their respective licenses. Font licenses are also provided in FONT-LICENSES.txt.'];
function collect(name, directory, license, url, declaredFile) {
  const files = new Set(fs.readdirSync(directory).filter(file => /^(licen[sc]e|copying|copyright|notice)([._-]|$)/i.test(file)).map(file => path.join(directory,file)));
  if (declaredFile) files.add(path.resolve(directory,declaredFile));
  const texts = [...files].filter(file => fs.statSync(file).isFile()).map(file => `--- ${path.basename(file)} ---\n${fs.readFileSync(file,'utf8').trim()}`);
  sections.push(`\n${'='.repeat(72)}\n${name}\nLicense: ${license || 'See included license text'}\nSource: ${url}\n\n${texts.join('\n\n') || 'The package declares the SPDX license above; see its source distribution for the full license.'}`);
}
const npmLock = JSON.parse(fs.readFileSync('package-lock.json','utf8'));
for (const [directory, entry] of Object.entries(npmLock.packages).sort()) {
  if (!directory || entry.dev || !fs.existsSync(path.join(directory,'package.json'))) continue;
  const pkg = JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
  collect(`${pkg.name} ${pkg.version}`,directory,pkg.license,typeof pkg.repository==='string'?pkg.repository:pkg.repository?.url || `https://www.npmjs.com/package/${pkg.name}`);
}
for (const pkg of metadata.packages.filter(pkg => runtime.has(pkg.id) && pkg.id !== metadata.resolve.root).sort((a,b) => a.name.localeCompare(b.name))) {
  collect(`${pkg.name} ${pkg.version}`,path.dirname(pkg.manifest_path),pkg.license,pkg.repository || `https://crates.io/crates/${pkg.name}/${pkg.version}`,pkg.license_file);
}
fs.writeFileSync('ui/public/THIRD-PARTY-LICENSES.txt',sections.join('\n\n')+'\n');
console.log(`Generated third-party notices for ${sections.length-1} packages.`);
