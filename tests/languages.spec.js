import {test,expect} from '@playwright/test';
import {readFileSync,readdirSync} from 'node:fs';
import {languages,resolveLanguage,matchLanguage} from '../ui/languages.js';
import {updateCopy} from '../ui/updates-copy.js';

const catalogue=Object.fromEntries(languages.map(({code})=>[code,JSON.parse(readFileSync(new URL('../ui/locales/'+code+'.json',import.meta.url),'utf8'))]));
const placeholders=text=>[...text.matchAll(/\{\w+\}/g)].map(([token])=>token).sort();

test('all 32 language options have complete messages and intact placeholders',()=>{
  expect(languages).toHaveLength(32);
  expect(new Set(languages.map(({code})=>code)).size).toBe(32);
  expect(readdirSync(new URL('../ui/locales/',import.meta.url)).sort()).toEqual(languages.map(({code})=>code+'.json').sort());
  for(const {code} of languages){
    expect(Object.keys(updateCopy[code]).sort(),code+' updates').toEqual(Object.keys(updateCopy.en).sort());
    for(const [key,text] of Object.entries(updateCopy[code])){
      expect(typeof text,code+':update:'+key).toBe('string');
      expect(text.trim().length,code+':update:'+key).toBeGreaterThan(0);
    }
    expect(Object.keys(catalogue[code]).sort(),code).toEqual(Object.keys(catalogue.en).sort());
    for(const [key,text] of Object.entries(catalogue[code])){
      expect(typeof text,code+':'+key).toBe('string');
      expect(text.trim().length,code+':'+key).toBeGreaterThan(0);
      expect(placeholders(text),code+':'+key).toEqual(placeholders(catalogue.en[key]));
    }
  }
});

test('regional languages, Chinese scripts, aliases and unsupported preferences resolve predictably',()=>{
  for(const [input,expected] of Object.entries({
    'de-CH':'de','el-GR':'el','es-MX':'es','fr-CA':'fr','pt-BR':'pt-BR','pt-AO':'pt-PT',
    'pt':'pt-PT','zh-SG':'zh-CN','zh-HK':'zh-TW','zh-Hant-CN':'zh-TW','zh-Hans-TW':'zh-CN',
    'no-NO':'nb','nb-NO':'nb','iw-IL':'he','en_US':'en',
  }))expect(matchLanguage(input),input).toBe(expected);
  expect(resolveLanguage('system',['xx-XX','fr-CA','de-DE'])).toBe('fr');
  expect(resolveLanguage('system',['xx-XX'])).toBe('en');
  expect(resolveLanguage('invalid',['el-GR'])).toBe('el');
  expect(resolveLanguage('ja',['el-GR'])).toBe('ja');
  for(const input of ['',null,{},'not a locale'])expect(matchLanguage(input)).toBeNull();
});

async function open(page,{pc=['en-US'],browser=['en-US'],preference}={}){
  await page.addInitScript(({pc,browser,preference})=>{
    if(!sessionStorage.getItem('languageFixture')){
      localStorage.clear();
      if(preference)localStorage.setItem('switcher.language',preference);
      sessionStorage.setItem('languageFixture','1');
    }
    localStorage.setItem('switcher.tourSeen','1');
    localStorage.setItem('switcher.autoUpdates','0');
    Object.defineProperty(navigator,'languages',{configurable:true,get:()=>browser});
    Object.defineProperty(navigator,'language',{configurable:true,get:()=>browser[0]});
    window.pcLanguages=pc;
    const profile=(id,active)=>({id,label:id,identity:{email:id+'@example.test'},active,health:{status:'valid',usage:{five:{used_percent:25,reset_at:1793890000},week:{used_percent:60,reset_at:1793990000}}}});
    window.testSnapshot={profiles:[profile('Personal',true),profile('Work',false)],current:{email:'Personal@example.test'},login:null,recovery:false};
    window.calls=[];
    window.__TAURI__={core:{invoke:async(command,args)=>{
      if(command==='system_languages'){
        if(window.pcLanguages===null)throw Error('Unavailable');
        return window.pcLanguages;
      }
      if(command==='app_info')return {version:'0.1.0'};
      if(command==='check_for_updates')return {update:null};
      if(command==='action'){
        window.calls.push(args);
        if(args.command==='snapshot')return structuredClone(window.testSnapshot);
      }
      return {};
    }},event:{listen:async()=>()=>{}}};
  },{pc,browser,preference});
  await page.goto('/');
  await expect(page.locator('.account')).toHaveCount(2);
}

test('new users follow the PC language, ahead of the browser, without saving an override',async({page})=>{
  await open(page,{pc:['de-DE'],browser:['el-GR']});
  await expect(page.locator('html')).toHaveAttribute('lang','de');
  await expect(page.locator('h1')).toHaveText(catalogue.de.accounts);
  await page.locator('[data-action=settings]').click();
  await expect(page.locator('[data-language=system]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-language=system]')).toContainText('Deutsch');
  expect(await page.evaluate(()=>localStorage.getItem('switcher.language'))).toBeNull();
  const expected=await page.evaluate(()=>new Intl.DateTimeFormat('de',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(1793890000*1000)));
  await expect(page.locator('.limit-label small').first()).toHaveText(catalogue.de.reset+' '+expected);
});

test('manual choice persists and switching back to PC follows changes on focus',async({page})=>{
  await open(page,{pc:['es-MX']});
  await page.locator('[data-action=settings]').click();
  await page.locator('[data-language=ja]').click();
  await expect(page.locator('html')).toHaveAttribute('lang','ja');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','ja');
  await page.locator('[data-action=settings]').click();
  await expect(page.locator('[data-language=system]')).toContainText('Español');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{window.pcLanguages=['fr-CA'];window.dispatchEvent(new Event('focus'));});
  await expect(page.locator('html')).toHaveAttribute('lang','ja');
  await page.locator('[data-action=settings]').click();
  await page.locator('[data-language=system]').click();
  await expect(page.locator('html')).toHaveAttribute('lang','fr');
  expect(await page.evaluate(()=>localStorage.getItem('switcher.language'))).toBe('system');
  await page.evaluate(()=>{window.pcLanguages=['ar-SA'];window.dispatchEvent(new Event('focus'));});
  await expect(page.locator('html')).toHaveAttribute('lang','ar');
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
});

test('browser fallback and unsupported PC language are safe',async({page})=>{
  await open(page,{pc:null,browser:['vi-VN']});
  await expect(page.locator('html')).toHaveAttribute('lang','vi');
  await page.evaluate(()=>{window.pcLanguages=['xx-XX'];window.dispatchEvent(new Event('focus'));});
  await expect(page.locator('html')).toHaveAttribute('lang','en');
});

test('old explicit choices persist and invalid choices return to PC language',async({page})=>{
  await open(page,{pc:['de-DE'],preference:'el'});
  await expect(page.locator('html')).toHaveAttribute('lang','el');
  await page.evaluate(()=>localStorage.setItem('switcher.language','not-supported'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','de');
});

test('every language renders settings, dialogs and all tour steps at small sizes',async({page},testInfo)=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await open(page);
  for(const {code,dir='ltr'} of languages){
    const messages=catalogue[code];
    await page.setViewportSize({width:390,height:790});
    await page.locator('[data-action=settings]').click();
    await page.locator('[data-language="'+code+'"]').click();
    await expect(page.locator('h1')).toHaveText(messages.accounts);
    await expect(page.locator('html')).toHaveAttribute('dir',dir);
    await expect(page.locator('.skip-link')).toHaveText(messages.skipAccounts);
    await expect(page.locator('.language-options [data-language]')).toHaveCount(32);
    expect(await page.locator('.settings-popover').evaluate(el=>{
      const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth;
    }),code+' settings').toBe(true);
    await page.keyboard.press('Escape');
    for(const width of [390,640]){
      await page.setViewportSize({width,height:600});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),code+' page').toBe(true);
      expect(await page.locator('.account').evaluateAll(cards=>cards.every(el=>el.scrollWidth<=el.clientWidth)),code+' cards').toBe(true);
    }
    await page.locator('[data-action=switch]').click();
    await expect(page.locator('#dialog-title')).toHaveText(messages.switchTitle.replace('{name}','Work'));
    await expect(page.locator('#dialog-body')).toHaveText(messages.switchBody);
    await page.locator('[data-action=close-modal]').click();
    await page.locator('[data-action=remove][data-id=Work]').click();
    await expect(page.locator('#dialog-body')).toHaveText(messages.removeBody);
    await page.locator('[data-action=close-modal]').click();
    await page.locator('.header-tools [data-action=tour]').click();
    for(const title of ['tourCurrentTitle','tourAddTitle','tourSwitchTitle','tourRemoveTitle']){
      await expect(page.locator('#tour-title')).toHaveText(messages[title]);
      expect(await page.locator('.tour-coach').evaluate(el=>{
        const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;
      }),code+' '+title).toBe(true);
      await page.locator('[data-action=tour-next]').click();
    }
    await page.locator('[data-action=settings]').click();
    await expect(page.locator('[data-action=updates]')).toHaveText(updateCopy[code].checkUpdates);
    await page.locator('[data-action=updates]').click();
    await expect(page.locator('#update-title')).toHaveText(updateCopy[code].currentTitle);
    await expect(page.locator('.update-dialog')).toHaveAttribute('dir',dir);
    expect(await page.locator('.update-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),code+' updates').toBe(true);
    await page.keyboard.press('Escape');
    if(['ar','ja','uk'].includes(code))await page.screenshot({path:testInfo.outputPath(code+'.png')});
  }
  expect(errors).toEqual([]);
  expect(await page.evaluate(()=>window.calls.some(call=>call.command!=='snapshot'))).toBe(false);
});
