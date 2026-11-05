import './style.css';
import './guided-tour.css';
import './updates.css';
import {createUpdater} from './updates';
import {updateCopy} from './updates-copy';
import {languages,resolveLanguage,direction,translate,readPreference,savePreference} from './i18n';
import {attachGuidedTour} from './guided-tour';
const invoke=window.__TAURI__?.core?.invoke,app=document.querySelector('#app');
let languagePreference=readPreference('switcher.language','system');
if(!languages.some(({code})=>code===languagePreference))languagePreference='system';
let systemLanguages=navigator.languages?.length?[...navigator.languages]:[navigator.language];
let language=resolveLanguage(languagePreference,systemLanguages);
const t=(key,values={})=>translate(language,key,values);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={clock:'M12 8v5l3 2 M21 12a9 9 0 11-18 0 9 9 0 0118 0',calendar:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16',switch:'M4 7h16 M16 3l4 4-4 4 M20 17H4 M8 13l-4 4 4 4',plus:'M12 5v14 M5 12h14',check:'M5 12l4 4L19 6',arrow:'M5 12h14 M14 7l5 5-5 5',close:'M6 6l12 12 M18 6L6 18',external:'M14 3h7v7 M21 3l-11 11 M10 3H4v17h17v-6',trash:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',settings:'M4 7h16 M4 17h16 M8 4v6 M16 14v6',help:'M9.1 9a3 3 0 015.8 1c0 2-3 2-3 4 M12 17h.01 M21 12a9 9 0 11-18 0 9 9 0 0118 0',info:'M12 11v6 M12 7h.01 M21 12a9 9 0 11-18 0 9 9 0 0118 0',key:'M14 7a4 4 0 110 8 4 4 0 010-8z M10 13l-7 7 M4 19l2 2 M7 16l2 2'};
const icon=(n,s=22)=>'<svg width="'+s+'" height="'+s+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[n]||paths.info)+'"/></svg>';
let data={profiles:[],current:null,login:null},loading=true,busy=false,pending='',toast=null,settings=false,modal=null,tour=null,returnFocus=null,fingerprint='',toastTimer,tourCleanup=()=>{};
const updater=createUpdater({language:()=>language,blocked:()=>busy||!!modal||tour!==null||data.login!==null,onChange:()=>{if(!modal&&tour===null)draw();}});
const ut=key=>updateCopy[language]?.[key]??updateCopy.en[key];
const btn=(action,key,style='primary',id='',ic='')=>'<button class="btn '+style+'" data-action="'+action+'" data-id="'+esc(id)+'" '+((busy||updater.state.installing||(data.login!==null&&!['cancel_login','open'].includes(action)))?'disabled':'')+'>'+(ic?icon(ic,20):'')+esc(t(key))+'</button>';
const name=p=>p.label.includes('@')?p.label.split('@')[0]:p.label;
const date=n=>n?new Intl.DateTimeFormat(language,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(n*1000)):'—';
function usage(w,key){
 const used=Number(w?.used_percent),valid=w&&w.used_percent!=null&&Number.isFinite(used);
 const left=valid?Math.round(Math.max(0,Math.min(100,100-used))):null;
 const reset=w?.reset_at?t('reset')+' '+date(w.reset_at):'—';
 return '<div class="limit '+(valid&&left<=10?'low':'')+'" title="'+esc(reset)+'"><span class="limit-icon">'+icon(key==='five'?'clock':'calendar',17)+'</span><div class="limit-label"><span>'+t(key)+'</span><small>'+esc(reset)+'</small></div>'+(valid?'<div class="meter" role="meter" aria-label="'+esc(t(key)+' '+t('left'))+'" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+left+'" aria-valuetext="'+esc(left+'% '+t('left')+'. '+reset)+'"><i style="width:'+left+'%"></i></div><strong>'+left+'<small>%</small></strong>':'<span class="missing-bar"></span><strong>—</strong>')+'</div>';
}
function card(p,index){
 const h=p.health||{},needsLogin=['reauth','corrupt'].includes(h.status);
 const status=needsLogin?'signin':h.status==='expired'?'renewing':h.status==='valid'?'ready':['network','service','denied'].includes(h.status)?'unavailable':'checking';
 return '<article class="account color-'+(index%4)+(p.active?' active':'')+'" aria-label="'+esc(name(p))+'"><div class="card-top"><div class="avatar">'+esc(name(p).slice(0,2).toUpperCase())+'</div><div class="card-identity"><h2 title="'+esc(name(p))+'">'+esc(name(p))+'</h2><p class="email" title="'+esc(p.identity?.email||'')+'">'+esc(p.identity?.email||'—')+'</p></div>'+(p.active?'<span class="current-badge">'+icon('check',14)+t('current')+'</span>':'')+'</div><div class="usage-area">'+(h.usage?'<div class="usage">'+usage(h.usage.five,'five')+usage(h.usage.week,'week')+'</div>':'<div class="connection-state '+(needsLogin?'needs-login':'')+'">'+icon(needsLogin?'key':'info',18)+'<span>'+t(status)+'</span></div>')+'</div><div class="card-actions">'+(needsLogin?btn('reconnect','signin','primary',p.id,'arrow'):p.active?'<div class="using-now">'+icon('check',17)+t('current')+'</div>':btn('switch','switch','primary',p.id,'switch'))+'<button class="remove-button" data-action="remove" data-id="'+esc(p.id)+'" '+((busy||updater.state.installing||data.login!==null)?'disabled':'')+' aria-label="'+esc(t('removeAccount')+': '+name(p))+'">'+icon('trash',17)+t('remove')+'</button></div></article>';
}
function settingsPanel(){
 const pcLanguage=resolveLanguage('system',systemLanguages);
 const option=(code,label,dir)=>'<button data-language="'+code+'" lang="'+(code==='system'?language:code)+'" dir="'+dir+'" aria-pressed="'+(languagePreference===code)+'"><span>'+esc(label)+'</span>'+(languagePreference===code?icon('check',17):'')+'</button>';
 return '<section class="settings-popover" aria-label="'+t('settings')+'"><h2>'+t('language')+'</h2>'+option('system',t('systemLanguage')+' ('+languages.find(({code})=>code===pcLanguage).name+')',direction(language))+'<div class="language-options" role="group" aria-label="'+t('language')+'">'+languages.map(({code,name,dir='ltr'})=>option(code,name,dir)).join('')+'</div><button class="tour-link" data-action="tour">'+icon('help',18)+t('tour')+'</button><div class="settings-update-section"><p class="settings-version">'+ut('version')+' '+esc(updater.state.version||'…')+'</p><button class="tour-link" data-action="updates">'+icon('arrow',18)+ut('checkUpdates')+'</button><label class="update-preference"><input type="checkbox" data-auto-updates '+(updater.state.automatic?'checked':'')+'>'+ut('automatic')+'</label></div></section>';
}
function draw(){
 tourCleanup();tourCleanup=()=>{};
 const languageScroll=document.querySelector('.language-options')?.scrollTop||0;
 const settingsScroll=document.querySelector('.settings-popover')?.scrollTop||0;
 const f=document.activeElement,focusKey=f?.dataset.action?[f.dataset.action,f.dataset.id]:null;
 document.documentElement.lang=language;
 document.documentElement.dir=direction(language);
 const accounts=[...data.profiles].sort((a,b)=>Number(b.active)-Number(a.active)||a.label.localeCompare(b.label));
 app.innerHTML='<a class="skip-link" href="#main">'+t('skipAccounts')+'</a><header><div class="header-inner"><div class="brand"><span class="brand-symbol">'+icon('switch',27)+'</span><span>ChatGPT <strong>Account Switcher</strong></span></div><div class="header-tools"><button class="tool-button" data-action="tour" title="'+t('tour')+'" aria-label="'+t('tour')+'">'+icon('help')+'</button><button class="tool-button '+(settings?'selected':'')+'" data-action="settings" title="'+t('settings')+'" aria-label="'+t('settings')+'" aria-expanded="'+settings+'">'+icon('settings')+'</button>'+(settings?settingsPanel():'')+'</div></div></header><main id="main"><div class="page-heading"><div><h1>'+t('accounts')+'</h1><p>'+t('subtitle')+'</p></div>'+btn('add','add','primary','','plus')+'</div>'+(toast?'<div class="notice '+toast.tone+'" role="'+(toast.tone==='error'?'alert':'status')+'">'+icon(toast.tone==='error'?'info':'check',21)+'<span>'+t(toast.key)+'</span><button class="tool-button" data-action="dismiss" aria-label="'+t('close')+'">'+icon('close',18)+'</button></div>':'')+(data.login!==null?'<div class="login-banner" role="status"><span class="spinner"></span><div><strong>'+t('browserTitle')+'</strong><p>'+t('browserBody')+'</p></div>'+btn('cancel_login','cancel','secondary')+'</div>':'')+(data.recovery?'<div class="notice error" role="alert">'+icon('info')+'<span>'+t('recoveryBody')+'</span>'+btn('recover','recover')+'</div>':'')+'<section class="current-session" aria-label="'+t('now')+'"><span class="session-icon">'+icon('check',23)+'</span><div><span>'+t('now')+'</span><strong>'+esc(data.current?.email||t(loading?'loading':'noConnection'))+'</strong></div>'+btn('open','open','secondary','','external')+'</section><div class="accounts-grid" aria-busy="'+(busy||loading)+'">'+(loading?'<div class="empty"><span class="spinner"></span><p>'+t('loading')+'</p></div>':accounts.length?accounts.map(card).join(''):'<div class="empty"><span class="empty-icon">'+icon('plus',36)+'</span><h2>'+t('emptyTitle')+'</h2><p>'+t('emptyBody')+'</p>'+btn('add','add','primary','','plus')+'</div>')+'</div><footer>'+(updater.state.available?'<button class="update-badge" data-action="updates">'+icon('arrow',14)+ut('available')+'</button>':'')+'<span class="auto-note"><i></i>'+t('auto')+'</span><span role="status" class="busy-note">'+(busy?'<span class="spinner small"></span>'+t(pending):'')+'</span></footer></main>'+(modal?renderModal():'')+(tour!==null?renderTour():'');
 const options=document.querySelector('.language-options'),popover=document.querySelector('.settings-popover');
 if(options)options.scrollTop=languageScroll;
 if(popover)popover.scrollTop=settingsScroll;
 const dialog=app.querySelector('dialog');
 if(tour!==null)tourCleanup=attachGuidedTour(tourSteps()[tour].selector);
 else if(dialog){dialog.showModal();document.querySelector('[data-action="close-modal"]')?.focus();}
 else {const key=returnFocus||focusKey;returnFocus=null;if(key)[...document.querySelectorAll('button[data-action]')].find(b=>b.dataset.action===key[0]&&b.dataset.id===key[1])?.focus({preventScroll:true});}

}
function renderModal(){const remove=modal.kind==='remove';return '<dialog class="confirm-dialog" aria-labelledby="dialog-title" aria-describedby="dialog-body"><form id="confirm-form"><div class="dialog-icon '+(remove?'coral':'')+'">'+icon(remove?'trash':'switch',27)+'</div><h2 id="dialog-title">'+esc(t(remove?'removeTitle':'switchTitle',{name:modal.name}))+'</h2><p id="dialog-body">'+t(remove?'removeBody':'switchBody')+'</p><div class="dialog-actions"><button type="submit" class="btn '+(remove?'danger':'primary')+'">'+t(remove?'removeConfirm':'switchConfirm')+'</button><button type="button" class="btn secondary" data-action="close-modal">'+t('cancel')+'</button></div></form></dialog>';}
function tourSteps(){
 const steps=[{key:'current',selector:'.current-session',title:'tourCurrentTitle',body:'tourCurrentBody'},{key:'add',selector:'.page-heading [data-action="add"]',title:'tourAddTitle',body:'tourAddBody'}];
 if(data.profiles.some(p=>!p.active&&!['reauth','corrupt'].includes(p.health?.status)))steps.push({key:'switch',selector:'.account [data-action="switch"]',title:'tourSwitchTitle',body:'tourSwitchBody'});
 if(data.profiles.length)steps.push({key:'remove',selector:data.profiles.some(p=>!p.active)?'.account:not(.active) [data-action="remove"]':'.account [data-action="remove"]',title:'tourRemoveTitle',body:'tourRemoveBody'});
 return steps;
}
function renderTour(){
 const steps=tourSteps();tour=Math.min(tour,steps.length-1);const step=steps[tour];
 return '<div class="guided-tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" data-step="'+step.key+'"><svg class="spotlight-svg" aria-hidden="true"><defs><mask id="tour-mask"><rect width="100%" height="100%" fill="white"/><rect class="spotlight-cutout" rx="13" fill="black"/></mask></defs><rect width="100%" height="100%" fill="#222831" fill-opacity=".48" mask="url(#tour-mask)"/><rect class="spotlight-outline" rx="13" fill="none" stroke="#f2c762" stroke-width="3"/></svg><svg class="spotlight-arrow" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><g class="spotlight-arrow-motion"><path d="M12 20V4 M7 9l5-5 5 5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g></svg><section class="tour-coach"><div class="guide-bubble"><div class="guide-heading"><span class="step-label">'+t('step',{n:tour+1,total:steps.length})+'</span><button class="guide-skip" data-action="tour-skip" aria-label="'+t('skip')+'" title="'+t('skip')+'">'+icon('close',17)+'</button></div><h2 id="tour-title">'+t(step.title)+'</h2><p id="tour-body">'+t(step.body)+'</p><div class="guide-actions">'+(tour>0?'<button class="btn secondary" data-action="tour-back">'+t('back')+'</button>':'<button class="guide-skip-text" data-action="tour-skip">'+t('skip')+'</button>')+'<button class="btn primary" data-action="tour-next">'+t(tour===steps.length-1?'finish':'next')+icon('arrow',17)+'</button></div></div></section></div>';
}
function tell(key,tone='success'){clearTimeout(toastTimer);toast={key,tone};toastTimer=setTimeout(()=>{toast=null;if(!modal&&tour===null)draw();},8000);}
function friendlyError(e){const s=String(e?.message||e);if(/διαφορετικ|ασυμφων/i.test(s))return 'wrongAccount';if(/CLI|εγκατεστημένο Codex|Δεν βρέθηκε το επίσημο/i.test(s))return 'cliError';if(/νέο login|απορρίπτει τη σύνδεση|διαπιστευτήρια δεν ανανεώθηκαν/i.test(s))return 'loginError';if(/δικτύ|διακομιστ|HTTP|network|fetch/i.test(s))return 'networkError';return 'error';}
function consume(next){
 if(next.notice){const key={login_saved:'loginSaved',login_failed:'loginFailed',login_timeout:'loginTimeout',auto_added:'autoAdded'}[next.notice]||friendlyError(next.notice);tell(key,['loginSaved','autoAdded'].includes(key)?'success':'error');}
 data=next;loading=false;const key=JSON.stringify(next);if(key!==fingerprint){fingerprint=key;if(!modal&&tour===null)draw();}
}
async function rpc(command,extra={}){if(!invoke)throw Error(t('appOnly'));return invoke('action',{command,label:null,id:null,...extra});}
async function refresh(){if(busy)return;try{consume(await rpc('snapshot'));}catch(e){loading=false;tell(friendlyError(e),'error');if(!modal&&tour===null)draw();}}
async function run(command,extra={}){
 if(busy)return;busy=true;pending={switch:'switching',remove:'removing',login:'adding',recover:'restoring'}[command]||'working';modal=null;settings=false;draw();
 try{await rpc(command,extra);const key={switch:'doneSwitch',remove:'doneRemove',recover:'doneRecover',cancel_login:'doneCancel'}[command];if(key)tell(key);}
 catch(e){tell(friendlyError(e),'error');}
 finally{busy=false;try{consume(await rpc('snapshot'));}catch{}draw();}
}
function endTour(){tour=null;savePreference('switcher.tourSeen','1');returnFocus=['tour',undefined];draw();}
app.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(updater.state.installing)return;
 if(b.dataset.language){languagePreference=b.dataset.language;language=resolveLanguage(languagePreference,systemLanguages);savePreference('switcher.language',languagePreference);draw();updater.refreshLanguage();document.querySelector('[data-language="'+languagePreference+'"]')?.focus({preventScroll:true});return;}
 const a=b.dataset.action,id=b.dataset.id;
 if(a==='updates'){if(busy||data.login!==null)return;settings=false;draw();updater.check();return;}
 if(a==='settings'){settings=!settings;draw();return;}
 if(a==='tour'){if(busy)return;settings=false;modal=null;tour=0;draw();return;}
 if(a==='tour-next'){if(tour===tourSteps().length-1)endTour();else{tour++;draw();}return;}
 if(a==='tour-back'){tour=Math.max(0,tour-1);draw();return;}
 if(a==='tour-skip'){endTour();return;}
 if(a==='dismiss'){toast=null;draw();return;}
 if(a==='close-modal'){modal=null;draw();return;}
 if(busy)return;
 if(a==='add'||a==='reconnect'){run('login',{id:a==='reconnect'?id:null});return;}
 if(a==='switch'||a==='remove'){const p=data.profiles.find(x=>x.id===id);if(!p)return;returnFocus=[a,id];modal={kind:a,id,name:name(p)};settings=false;draw();return;}
 if(a)run(a);
});
app.addEventListener('change',e=>{if(e.target.matches('[data-auto-updates]'))updater.setAutomatic(e.target.checked);});
app.addEventListener('submit',e=>{if(e.target.id!=='confirm-form')return;e.preventDefault();run(modal.kind,{id:modal.id});});
app.addEventListener('cancel',e=>{e.preventDefault();if(tour!==null)endTour();else{modal=null;draw();}},true);
document.addEventListener('click',e=>{if(settings&&!e.target.closest('.header-tools')){settings=false;draw();}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&settings){settings=false;draw();}});
async function start(){
 await updateSystemLanguages();
 draw();
 if(window.__TAURI__?.event?.listen){try{await window.__TAURI__.event.listen('accounts-changed',event=>{if(!busy)consume(event.payload);});await window.__TAURI__.event.listen('sync-error',()=>{tell('syncError','error');if(!modal&&tour===null)draw();});}catch{}}
 await refresh();
 if(readPreference('switcher.tourSeen','0')!=='1'){tour=0;draw();}
}
async function updateSystemLanguages(){
 const browserLanguages=navigator.languages?.length?[...navigator.languages]:[navigator.language];
 let nativeLanguages=[];
 if(invoke){try{const result=await invoke('system_languages');if(Array.isArray(result))nativeLanguages=result.filter(tag=>typeof tag==='string');}catch{}}
 systemLanguages=nativeLanguages.length?nativeLanguages:browserLanguages;
 const next=resolveLanguage(languagePreference,systemLanguages),changed=next!==language;
 language=next;
 if(changed){draw();updater.refreshLanguage();}
}
start();updater.start();setInterval(refresh,15000);
window.addEventListener('focus',()=>{refresh();updateSystemLanguages();});
window.addEventListener('languagechange',updateSystemLanguages);
