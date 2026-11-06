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
    label.style.cssText='position:fixed;bottom:14px;right:18px;z-index:2147483647;background:#f6f7f8;color:#777e88;border:1px solid #e2e4e8;padding:7px 11px;border-radius:8px;font:600 12px Nunito,sans-serif;pointer-events:none';document.body.append(label);
  });
  const capture=async(name,delay=1000)=>{await page.waitForTimeout(delay);await page.screenshot({path:path.join(frames,`${name}.png`)});};
  await capture('01-accounts',1500);
  await page.screenshot({path:path.join(assets,'accounts.png')});
  await page.setViewportSize({width:1280,height:640});
  await page.screenshot({path:path.join(assets,'social-preview.png')});
  await page.setViewportSize({width:1100,height:760});
  await page.getByRole('button',{name:'Switch account',exact:true}).click();
  await capture('02-confirm',1500);
  await page.getByRole('button',{name:'Save done. Switch.',exact:true}).click();
  await page.getByRole('article',{name:'Work'}).getByText('Current',{exact:true}).first().waitFor();
  await capture('03-switched',1800);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await capture('04-settings',1400);
  await context.close();

  console.log('Saved real UI screenshots, GIF frames, and social preview in docs/assets/.');
} finally {
  await browser?.close();server.kill();
}
