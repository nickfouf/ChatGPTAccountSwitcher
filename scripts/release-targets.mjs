// Updater IDs and asset names are a release contract: keep Windows names stable.
export const targets = {
  'x86_64-pc-windows-msvc': {platform:'windows-x86_64', bundles:'nsis', directory:'nsis', extension:'.exe', suffix:'x64-setup.exe', label:'Windows x64'},
  'aarch64-apple-darwin': {platform:'darwin-aarch64', bundles:'app,dmg', directory:'macos', extension:'.app.tar.gz', suffix:'macos-arm64.app.tar.gz', config:'src-tauri/tauri.macos.conf.json', label:'macOS Apple Silicon'},
  'x86_64-unknown-linux-gnu': {platform:'linux-x86_64', bundles:'deb,rpm,appimage', directory:'appimage', extension:'.AppImage', suffix:'linux-x64.AppImage', config:'src-tauri/tauri.linux.conf.json', label:'Linux x64'},
  'aarch64-unknown-linux-gnu': {platform:'linux-aarch64', bundles:'deb,rpm,appimage', directory:'appimage', extension:'.AppImage', suffix:'linux-arm64.AppImage', config:'src-tauri/tauri.linux.conf.json', label:'Linux ARM64'},
};

export function releaseTarget() {
  const host = {win32:'x86_64-pc-windows-msvc',darwin:'aarch64-apple-darwin',linux:process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu'}[process.platform];
  const triple = process.env.RELEASE_TARGET || host;
  if (!targets[triple]) throw Error(`Unsupported release target: ${triple}`);
  if (!process.env.RELEASE_TARGET && process.platform === 'darwin' && process.arch !== 'arm64') throw Error('macOS release builds currently target Apple Silicon. Set RELEASE_TARGET explicitly when cross-compiling.');
  return {triple, ...targets[triple]};
}

export function assetName(packageName, version, target) {
  return `${packageName}_${version}_${target.suffix}`;
}
