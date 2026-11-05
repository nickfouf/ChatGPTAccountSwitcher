import { marked } from 'marked';
import DOMPurify from 'dompurify';
import changelog from '../CHANGELOG.md?raw';
import { direction, readPreference, savePreference } from './i18n';
import { updateCopy } from './updates-copy';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const newer = (a, b) => {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (left[i] !== right[i]) return left[i] > right[i]; }
  return false;
};

// Release manifests include the whole changelog so skipped versions are covered.
export function relevantNotes(notes, current, latest) {
  const releases = [...String(notes || '').matchAll(/^## \[?(\d+\.\d+\.\d+)\]?[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
  if (!releases.length) return String(notes || '');
  return releases.filter(([, version]) => newer(version, current) && !newer(version, latest))
    .map(match => match[0].trim()).join('\n\n');
}

export function createUpdater({ language, blocked, onChange }) {
  const invoke = window.__TAURI__?.core?.invoke;
  const host = document.createElement('div');
  document.body.append(host);
  const state = { version: '', available: null, phase: 'checking', open: false, checking: false, installing: false, automatic: readPreference('switcher.autoUpdates', '1') !== '0' };
  let pending = false, trigger = null, retryInstall = false, lastCheck = 0;
  const t = key => updateCopy[language()]?.[key] ?? updateCopy.en[key];
  const notify = () => onChange();
  function close() {
    if (state.installing) return;
    state.open = false; host.replaceChildren();
    const target = trigger?.isConnected && trigger !== document.body ? trigger : document.querySelector('[data-action="updates"], [data-action="settings"]');
    target?.focus();
  }
  function render() {
    if (!state.open) return;
    const phase = state.phase, available = state.available;
    const title = {checking:'checking', current:'currentTitle', available:'availableTitle', error:'errorTitle', downloading:'downloadTitle', installing:'installTitle', whatsnew:'whatsNew'}[phase];
    const hasNotes = ['available','whatsnew'].includes(phase);
    const notes = phase === 'whatsnew' ? state.notes : relevantNotes(available?.notes, state.version, available?.version);
    const html = hasNotes ? DOMPurify.sanitize(marked.parse(notes || t('noNotes'), {async:false}), {
      ALLOWED_TAGS:['h2','h3','h4','p','ul','ol','li','strong','em','code','pre','br','blockquote','hr'], ALLOWED_ATTR:[]
    }) : '';
    host.innerHTML = `<dialog class="update-dialog" lang="${updateCopy[language()] ? language() : 'en'}" dir="${direction(language())}" aria-labelledby="update-title" aria-describedby="update-description">
      <div class="update-header"><span class="update-symbol" aria-hidden="true">${['current','whatsnew'].includes(phase)?'✓':'↓'}</span><span class="update-eyebrow">ChatGPT Account Switcher</span></div>
      <h2 id="update-title">${t(title)}</h2>
      <p id="update-description">${t({checking:'checkingBody',current:'currentBody',available:'availableBody',error:'errorBody',downloading:'downloadBody',installing:'installBody',whatsnew:'whatsNewBody'}[phase])}</p>
      <div class="update-versions"><span>${t('installed')} <strong>v${escape(state.version || '…')}</strong></span>${available && phase!=='whatsnew'?`<span aria-hidden="true">→</span><span class="update-new-version">v${escape(available.version)}</span>`:''}</div>
      ${hasNotes?`<section class="release-notes" dir="auto" tabindex="0" aria-label="${t('releaseNotes')}">${html}</section>`:''}
      ${['downloading','installing'].includes(phase)?`<div class="update-progress-area" role="status"><progress aria-label="${t('downloadProgress')}"></progress><span class="update-progress-text">${t(phase==='installing'?'installBody':'downloadBody')}</span></div>`:''}
      ${phase==='error'?`<p class="update-error" role="alert">${t(retryInstall?'installError':'checkError')}</p>`:''}
      <div class="update-actions">
        ${phase==='available'?`<button class="btn primary" data-update="install">${t('install')}</button>`:phase==='error'?`<button class="btn primary" data-update="retry">${t('retry')}</button>`:''}
        ${!state.installing?`<button class="btn secondary" data-update="close">${t(phase==='available'?'later':'close')}</button>`:''}
      </div><p class="update-footnote">${t('signed')}</p>
    </dialog>`;
    const dialog = host.querySelector('dialog');
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.showModal();
    host.querySelector('[data-update="close"]')?.focus();
  }
  function open() {
    const focused = document.activeElement;
    trigger = focused?.matches('button, input, select, textarea, a[href], [tabindex]') ? focused : null;
    state.open = true; render();
  }
  async function check(manual = false) {
    if (state.checking || state.installing) return;
    state.checking = true; retryInstall = false;
    if (manual) { pending = false; state.phase = 'checking'; open(); }
    lastCheck = Date.now();
    try {
      if (!invoke) throw Error('Desktop application required');
      if (!state.version) state.version = (await invoke('app_info')).version;
      const result = await invoke('check_for_updates');
      state.available = result.update;
      state.phase = state.available ? 'available' : 'current';
      if (manual) render();
      else if (state.available) pending = true;
    } catch {
      if (manual) { state.phase = 'error'; render(); }
    } finally { state.checking = false; notify(); }
  }
  async function install() {
    if (!state.available || state.installing) return;
    if (blocked()) { close(); pending = true; return; }
    state.installing = true; state.phase = 'downloading'; render(); notify();
    try {
      await invoke('install_update');
      // Successful Windows installation exits this process. Retain the protected UI.
      state.phase = 'installing'; render();
    } catch {
      state.installing = false; state.phase = 'error'; retryInstall = true; render(); notify();
    }
  }
  host.addEventListener('click', event => {
    const action = event.target.closest('[data-update]')?.dataset.update;
    if (action === 'close') close();
    if (action === 'install') install();
    if (action === 'retry') retryInstall ? install() : check(true);
  });
  async function start() {
    if (!invoke) return;
    try {
      state.version = (await invoke('app_info')).version;
      const previous = readPreference('switcher.installedVersion', state.version);
      savePreference('switcher.installedVersion', state.version);
      if (newer(state.version, previous)) {
        state.notes = relevantNotes(changelog, previous, state.version);
        state.phase = 'whatsnew'; pending = true;
      }
      notify();
      await window.__TAURI__?.event?.listen('update-progress', ({payload}) => {
        if (!state.installing) return;
        if (payload.phase === 'installing') { state.phase = 'installing'; render(); return; }
        const progress = host.querySelector('progress'), label = host.querySelector('.update-progress-text');
        if (progress && payload.total > 0) { progress.max = payload.total; progress.value = Math.min(payload.total, payload.downloaded); }
        if (label && payload.total > 0) label.textContent = `${Math.min(100, Math.round(payload.downloaded / payload.total * 100))}% · ${t('downloading')}`;
      });
    } catch { /* Manual checking remains available if initialization fails. */ }
  }
  setInterval(() => {
    if (pending && !blocked() && !state.open && !state.installing) { pending = false; if(state.phase !== 'whatsnew')state.phase = 'available'; open(); return; }
    if (state.automatic && !state.open && !pending && !blocked() && Date.now()-lastCheck > 6*60*60*1000) check();
  }, 2000);
  return {
    state, start, check: () => state.available ? (state.phase='available', open()) : check(true),
    setAutomatic(value) { state.automatic = value; savePreference('switcher.autoUpdates', value?'1':'0'); },
    refreshLanguage: render,
  };
}
