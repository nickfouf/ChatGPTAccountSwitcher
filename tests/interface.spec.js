import { test, expect } from '@playwright/test';

async function open(page, {tour=false,empty=false}={}) {
  await page.addInitScript(({tour,empty}) => {
    if (!tour) localStorage.setItem('switcher.tourSeen','1');
    const profile=(id,label,email,active)=>({id,label,identity:{email,expires:1900000000},active,health:{status:'valid',checked:1793880000,usage:{five:{used_percent:25,reset_at:1793890000},week:{used_percent:60,reset_at:1793990000}}}});
    window.testSnapshot={profiles:empty?[]:[profile('personal','Personal','personal@example.test',true),profile('work','Work','work@example.test',false)],current:empty?null:{email:'personal@example.test'},login:null,notice:null,recovery:false};
    window.calls=[];window.listeners={};
    window.__TAURI__={core:{invoke:async(command,args)=>{
      if(command==='system_languages')return ['en-US'];
      if(command==='app_info')return {version:'0.1.0'};
      if(command==='check_for_updates')return {update:null};
      window.calls.push(args);
      if(args.command==='snapshot')return structuredClone(window.testSnapshot);
      if(args.command==='login')window.testSnapshot.login='';
      if(args.command==='cancel_login')window.testSnapshot.login=null;
      if(args.command==='remove')window.testSnapshot.profiles=window.testSnapshot.profiles.filter(p=>p.id!==args.id);
      if(args.command==='switch'){window.testSnapshot.profiles.forEach(p=>p.active=p.id===args.id);window.testSnapshot.current={email:'work@example.test'};}
      return {};
    }},event:{listen:async(name,cb)=>{window.listeners[name]=cb;return ()=>{};}}};
    window.pushSnapshot=()=>window.listeners['accounts-changed']({payload:structuredClone(window.testSnapshot)});
  },{tour,empty});
  await page.goto('/');
  if(tour)await expect(page.locator('.guided-tour')).toBeVisible();else await expect(page.getByRole('heading',{name:'Your accounts',exact:true})).toBeVisible();
}

test('English PC language, current account and only the direct account actions',async({page})=>{
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.getByRole('article',{name:'Personal'}).getByText('Current',{exact:true})).toHaveCount(2);
  await expect(page.getByRole('article',{name:'Work'}).getByRole('button',{name:'Switch account'})).toBeVisible();
  await expect(page.getByRole('meter')).toHaveCount(4);
  await expect(page.locator('details')).toHaveCount(0);
  await expect(page.getByText(/import|token|DPAPI/i)).toHaveCount(0);
});
test('Add goes straight to browser sign-in without a name form',async({page})=>{
  await open(page);await page.getByRole('button',{name:'Add account',exact:true}).click();
  await expect(page.getByText('Finish signing in',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.calls.filter(c=>c.command==='login'))).toEqual([{command:'login',id:null,label:null}]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByText('Finish signing in',{exact:true})).toHaveCount(0);
});
test('Remove requires confirmation and does not switch or sign out',async({page})=>{
  await open(page);await page.getByRole('button',{name:'Remove account: Work'}).click();
  await expect(page.getByRole('dialog')).toContainText('Your chats and current Codex sign-in stay as they are.');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await page.evaluate(()=>window.calls.some(c=>c.command==='remove'))).toBe(false);
  await page.getByRole('button',{name:'Remove account: Work'}).click();
  await page.getByRole('button',{name:'Remove account',exact:true}).click();
  await expect(page.getByRole('article',{name:'Work',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>window.calls.filter(c=>c.command!=='snapshot').map(c=>c.command))).toEqual(['remove']);
});
test('Switch confirms restart and updates current account',async({page})=>{
  await open(page);await page.getByRole('button',{name:'Switch account',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Codex will close and reopen.');
  await page.getByRole('button',{name:'Save done. Switch.'}).click();
  await expect(page.getByRole('article',{name:'Work'}).getByText('Current',{exact:true})).toHaveCount(2);
  expect(await page.evaluate(()=>window.calls.filter(c=>c.command==='switch').map(c=>c.id))).toEqual(['work']);
});
test('native push updates the account list without user refresh',async({page})=>{
  await open(page);
  await page.evaluate(()=>{window.testSnapshot.profiles.push({...window.testSnapshot.profiles[1],id:'new',label:'New',identity:{email:'new@example.test'}});window.pushSnapshot();});
  await expect(page.getByRole('article',{name:'New',exact:true})).toBeVisible();
});
test('English and Greek setting persists, including dialogs',async({page})=>{
  await open(page);await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Ελληνικά'}).click();
  await expect(page.getByRole('heading',{name:'Οι λογαριασμοί σου'})).toBeVisible();
  await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','el');
  await page.getByRole('button',{name:'Αφαίρεση λογαριασμού: Work'}).click();
  await expect(page.getByRole('dialog')).toContainText('Οι συνομιλίες και η τρέχουσα σύνδεση Codex διατηρούνται.');
});
test('Spotlight guide has no character references and supports Skip and Replay',async({page})=>{
  await open(page,{tour:true});
  await expect(page.getByRole('dialog')).toContainText('Here’s your current account');
  await expect(page.locator('.guided-tour img')).toHaveCount(0);
  await expect(page.locator('.guided-tour')).not.toContainText(/Simon|Σάιμον/i);
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Add another account here');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Switch with this button');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.locator('.guided-tour')).toContainText('Remove a saved account here');
  await page.getByRole('button',{name:'Let’s go!'}).click();
  await page.reload();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Quick tour',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button',{name:'Skip tour',exact:true}).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('empty state is usable and does not invent usage',async({page})=>{
  await open(page,{empty:true});await expect(page.getByText('No account connected',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Your accounts belong here'})).toBeVisible();
  await expect(page.getByRole('meter')).toHaveCount(0);
});
test('reauthentication replaces switch, network errors preserve switch',async({page})=>{
  await open(page);await page.evaluate(()=>{window.testSnapshot.profiles[1].health={status:'reauth'};window.pushSnapshot();});
  await expect(page.getByRole('article',{name:'Work'}).getByRole('button',{name:'Sign in again'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Switch account',exact:true})).toHaveCount(0);
  await page.evaluate(()=>{window.testSnapshot.profiles[1].health={status:'network'};window.pushSnapshot();});
  await expect(page.getByRole('button',{name:'Switch account',exact:true})).toBeVisible();
});
test('minimum desktop, mobile and Greek guide fit without horizontal overflow',async({page})=>{
  await open(page);
  for(const width of [1160,900,640,390]){
    await page.setViewportSize({width,height:790});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Ελληνικά'}).click();
  await page.getByRole('button',{name:'Σύντομος οδηγός',exact:true}).first().click();
  await expect(page.getByRole('dialog')).toContainText('Εδώ είναι ο τρέχων λογαριασμός');
  expect(await page.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
});

async function assertSpotlight(page) {
  await expect(page.locator('.guided-tour.positioned')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>{
    const overlay=document.querySelector('.guided-tour');
    const target=document.querySelector(overlay.dataset.target).getBoundingClientRect();
    const coach=overlay.querySelector('.tour-coach').getBoundingClientRect();
    const cutout=overlay.querySelector('.spotlight-cutout');
    const arrow=overlay.querySelector('.spotlight-arrow');
    const arrowStyle=getComputedStyle(arrow);
    const x=Number(cutout.getAttribute('x')),y=Number(cutout.getAttribute('y'));
    const width=Number(cutout.getAttribute('width')),height=Number(cutout.getAttribute('height'));
    return {
      follows:Math.abs(x-Math.max(4,target.left-8))<2&&Math.abs(y-Math.max(4,target.top-8))<2&&Math.abs(width-Math.min(innerWidth-8,target.width+16))<2,
      fits:coach.left>=0&&coach.right<=innerWidth+1&&coach.top>=0&&coach.bottom<=innerHeight+1,
      separate:coach.right<=x||coach.left>=x+width||coach.bottom<=y||coach.top>=y+height,
      fixedArrow:arrowStyle.width==='24px'&&arrowStyle.height==='24px'&&arrow.getAttribute('viewBox')==='0 0 24 24',
    };
  })).toEqual({follows:true,fits:true,separate:true,fixedArrow:true});
}

test('spotlight follows actual controls at fullscreen, small and mobile sizes',async({page},testInfo)=>{
  await open(page);
  for(const [width,height] of [[1160,790],[1920,1080],[2560,1440],[900,650],[640,600],[390,790]]){
    await page.setViewportSize({width,height});
    await page.getByRole('button',{name:'Quick tour',exact:true}).click();
    for(const key of ['current','add','switch','remove']){
      await expect(page.locator('.guided-tour')).toHaveAttribute('data-step',key);
      await assertSpotlight(page);
      await expect(page.locator('dialog')).toHaveCount(0);
      if(width===1160&&key==='add')await page.screenshot({path:testInfo.outputPath('spotlight-desktop.png')});
      if(key==='remove')await page.getByRole('button',{name:'Let’s go!'}).click();
      else await page.getByRole('button',{name:'Next',exact:true}).click();
    }
  }
  expect(await page.evaluate(()=>window.calls.some(c=>['switch','remove','login'].includes(c.command)))).toBe(false);
});

test('compact cards keep stacked bars and buttons inside each card at every size',async({page},testInfo)=>{
  await open(page);
  await page.evaluate(()=>{
    const example=window.testSnapshot.profiles[1];
    for(let i=0;i<5;i++)window.testSnapshot.profiles.push({...example,id:'extra-'+i,label:'Account '+i});
    window.pushSnapshot();
  });
  for(const [width,height] of [[1160,790],[1920,1080],[2560,1440],[900,650],[640,600],[390,790]]){
    await page.setViewportSize({width,height});
    const measurements=await page.locator('.account').evaluateAll(cards=>cards.map(card=>{
      const rect=card.getBoundingClientRect(),rows=[...card.querySelectorAll('.limit')].map(e=>e.getBoundingClientRect());
      return {height:rect.height,inside:card.scrollWidth<=card.clientWidth,stacked:rows[1].top>=rows[0].bottom};
    }));
    expect(measurements.every(m=>m.height<290&&m.inside&&m.stacked)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(width===1160||width===1920)await page.screenshot({path:testInfo.outputPath('cards-'+width+'.png')});
  }
});

test('tour is keyboard accessible and highlights stay aligned after scrolling/resizing',async({page})=>{
  await open(page);await page.getByRole('button',{name:'Quick tour',exact:true}).click();
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await page.setViewportSize({width:640,height:600});
  await assertSpotlight(page);
  await page.evaluate(()=>window.scrollBy(0,15));
  await assertSpotlight(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.guided-tour')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Quick tour',exact:true})).toBeFocused();
});

test('empty-account guide only explains controls that exist',async({page})=>{
  await open(page,{empty:true});await page.getByRole('button',{name:'Quick tour',exact:true}).click();
  await expect(page.locator('.guided-tour')).toContainText('1 of 2');
  await assertSpotlight(page);
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.locator('.guided-tour')).toHaveAttribute('data-step','add');
  await assertSpotlight(page);
  await page.getByRole('button',{name:'Let’s go!'}).click();
  await expect(page.locator('.guided-tour')).toHaveCount(0);
});

test('Greek spotlight steps fit the minimum window and fullscreen',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Ελληνικά'}).click();
  await page.keyboard.press('Escape');
  for(const [width,height] of [[640,600],[1920,1080]]){
    await page.setViewportSize({width,height});
    await page.getByRole('button',{name:'Σύντομος οδηγός',exact:true}).click();
    for(let step=0;step<4;step++){
      await assertSpotlight(page);
      if(step===3)await page.getByRole('button',{name:'Πάμε!',exact:true}).click();
      else await page.getByRole('button',{name:'Επόμενο',exact:true}).click();
    }
  }
});

test('one account remains a compact card in fullscreen',async({page})=>{
  await open(page);
  await page.evaluate(()=>{window.testSnapshot.profiles.splice(1);window.pushSnapshot();});
  await page.setViewportSize({width:1920,height:1080});
  expect((await page.locator('.account').boundingBox()).width).toBeLessThan(420);
  await page.getByRole('button',{name:'Quick tour',exact:true}).click();
  await expect(page.locator('.guided-tour')).toContainText('1 of 3');
  await assertSpotlight(page);
});

test('a short account list does not create an unnecessary desktop scrollbar',async({page})=>{
  await open(page);
  for(const [width,height] of [[1160,790],[1920,1080],[2560,1440]]){
    await page.setViewportSize({width,height});
    expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  }
});
