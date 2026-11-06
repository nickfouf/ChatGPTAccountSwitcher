// Capture the real frontend with synthetic accounts. Never read native account storage.
import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..',import.meta.url));
const assets = path.join(root,'docs/assets');
const frames = path.join(root,'test-results/demo-frames');
await fs.mkdir(assets,{recursive:true}); await fs.mkdir(frames,{recursive:true});
const server = spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','1421'],{cwd:root,stdio:'ignore'});
let browser;
try {
  for(let attempt=0;attempt<100;attempt++){
    if(await fetch('http://127.0.0.1:1421').then(response=>response.ok).catch(()=>false))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  browser = await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});
  const context = await browser.newContext({viewport:{width:1100,height:760},deviceScaleFactor:1});
  const page = await context.newPage();
  await page.addInitScript(()=>{
    localStorage.setItem('switcher.tourSeen','1');localStorage.setItem('switcher.autoUpdates','0');
    const profile=(id,label,email,active,five,week)=>({id,label,identity:{email,expires:1900000000},active,health:{status:'valid',checked:Math.floor(Date.now()/1000),usage:{five:{used_percent:five,reset_at:Math.floor(Date.now()/1000)+7200},week:{used_percent:week,reset_at:Math.floor(Date.now()/1000)+172800}}}});
    const snapshot={profiles:[profile('personal','Personal','alex.personal@example.test',true,82,63),profile('work','Work','alex.work@example.test',false,12,28)],current:{email:'alex.personal@example.test'},login:null,notice:null,recovery:false};
    window.__TAURI__={core:{invoke:async(command,args)=>{
      if(command==='system_languages')return ['en-US'];
      if(command==='app_info')return {version:'0.2.0',inAppUpdates:true};
      if(command==='check_for_updates')return {update:null};
      if(command==='action'){
        if(args.command==='snapshot')return structuredClone(snapshot);
        if(args.command==='switch'){
          await new Promise(resolve=>setTimeout(resolve,700));
          snapshot.profiles.forEach(profile=>profile.active=profile.id===args.id);
          snapshot.current={email:snapshot.profiles.find(profile=>profile.active).identity.email};
        }
      }
      return {};
    }},event:{listen:async()=>()=>{}}};
  });
  await page.goto('http://127.0.0.1:1421');
  await page.getByRole('heading',{name:'Your accounts',exact:true}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>{
    const label=document.createElement('div');label.id='demo-disclosure';label.textContent='UI walkthrough · sample accounts';
    label.style.cssText='position:fixed;bottom:14px;right:18px;z-index:2147483647;background:#173f35;color:white;padding:8px 14px;border-radius:30px;font:600 12px Nunito,sans-serif;pointer-events:none';document.body.append(label);
  });
  const capture=async(name,delay=1000)=>{await page.waitForTimeout(delay);await page.screenshot({path:path.join(frames,`${name}.png`)});};
  await capture('01-accounts',1500);
  await page.screenshot({path:path.join(assets,'accounts.png')});
  await page.getByRole('button',{name:'Switch account',exact:true}).click();
  await capture('02-confirm',1500);
  await page.getByRole('button',{name:'Save done. Switch.',exact:true}).click();
  await page.getByRole('article',{name:'Work'}).getByText('Current',{exact:true}).first().waitFor();
  await capture('03-switched',1800);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await capture('04-settings',1400);
  await context.close();

  const image=await fs.readFile(path.join(assets,'accounts.png'));
  const social=await browser.newPage({viewport:{width:1280,height:640},deviceScaleFactor:1});
  await social.setContent(`<!doctype html><style>*{box-sizing:border-box}body{margin:0;background:#f5f5ef;color:#193c33;font-family:Arial,sans-serif;overflow:hidden}.orb{position:absolute;width:600px;height:600px;background:#e0ece4;border-radius:50%;right:-180px;top:-260px}.copy{position:absolute;left:58px;top:65px;width:500px}.eyebrow{font-size:15px;letter-spacing:2px;font-weight:700;color:#527666}h1{font-size:57px;line-height:1.07;letter-spacing:-2px;margin:30px 0 20px}.sub{font-size:23px;line-height:1.4;color:#557168}.pills{display:flex;gap:9px;margin:27px 0}.pills span{border:1px solid #b6cec1;padding:8px 13px;border-radius:30px;font-size:14px}.url{margin-top:46px;font-size:17px;font-weight:700}.shot{position:absolute;left:587px;top:101px;width:660px;border-radius:18px;box-shadow:0 25px 75px #193c3325;border:1px solid #d7e1d8}.caption{position:absolute;bottom:32px;right:38px;font-size:12px;color:#658075}</style><div class="orb"></div><div class="copy"><div class="eyebrow">OPEN SOURCE · LOCAL STORAGE</div><h1>Switch Codex<br>accounts.<br>Keep your flow.</h1><div class="sub">Saved accounts. Usage at a glance.<br>A desktop companion in 32 languages.</div><div class="pills"><span>Windows</span><span>macOS*</span><span>Linux*</span></div><div class="url">github.com/nickfouf/ChatGPTAccountSwitcher</div></div><img class="shot" src="data:image/png;base64,${image.toString('base64')}"><div class="caption">*macOS/Linux experimental · UI screenshot uses sample accounts · Independent community project</div>`);
  await social.screenshot({path:path.join(assets,'social-preview.png')});
  console.log('Saved real UI screenshots, GIF frames, and social preview in docs/assets/.');
} finally {
  await browser?.close();server.kill();
}
