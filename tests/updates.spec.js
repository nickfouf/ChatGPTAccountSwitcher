import { test, expect } from '@playwright/test';

const notes = `## [0.3.0] - 2026-11-05
### Added
- A clearer update experience.
<img src=x onerror="window.injection=true"><script>window.injection=true</script>
[Unsafe link](javascript:alert(1))

## [0.2.0] - 2026-11-04
### Fixed
- Improved switching reliability.

## [0.1.0] - 2026-11-03
- Old changes that should be hidden.
`;

async function open(page, { available=true, error=false, installError=false, tour=false, previous=null, automatic=false, inAppUpdates=true }={}) {
  await page.addInitScript(options => {
    localStorage.setItem('switcher.autoUpdates', options.automatic?'1':'0');
    if (!options.tour) localStorage.setItem('switcher.tourSeen','1');
    if (options.previous && !localStorage.getItem('switcher.installedVersion')) localStorage.setItem('switcher.installedVersion', options.previous);
    window.updateCalls=[]; window.nativeListeners={}; window.checkError=options.error; window.installError=options.installError;
    window.snapshot={profiles:[],current:null,login:null,recovery:false};
    window.__TAURI__={core:{invoke:async(command,args)=>{
      if(command==='system_languages')return ['en-US'];
      window.updateCalls.push({command,args});
      if(command==='app_info')return {version:'0.1.0',inAppUpdates:options.inAppUpdates};
      if(command==='check_for_updates'){
        if(window.checkError)throw Error('offline');
        return {update:options.available?{version:'0.3.0',currentVersion:'0.1.0',notes:options.notes,date:1793880000}:null};
      }
      if(command==='install_update'){
        if(window.installError)throw Error('signature rejected');
        window.nativeListeners['update-progress']({payload:{phase:'downloading',downloaded:50,total:100}});
        await new Promise(()=>{});
      }
      if(command==='action'&&args.command==='snapshot')return structuredClone(window.snapshot);
      if(command==='action'&&args.command==='login')window.snapshot.login='pending';
      if(command==='action'&&args.command==='cancel_login')window.snapshot.login=null;
      return {};
    }},event:{listen:async(name,callback)=>{window.nativeListeners[name]=callback;return ()=>{};}}};
  }, {available,error,installError,tour,previous,automatic,inAppUpdates,notes});
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
}
async function check(page) {
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Check for updates',exact:true}).click();
}

test('manual updates show changes for every skipped version and sanitize remote notes',async({page},testInfo)=>{
  await open(page); await check(page);
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('A new version is ready');
  await expect(dialog).toContainText('0.3.0'); await expect(dialog).toContainText('0.2.0');
  await expect(dialog).not.toContainText('Old changes that should be hidden');
  await expect(dialog.locator('img,script,a')).toHaveCount(0);
  expect(await page.evaluate(()=>window.injection)).toBeUndefined();
  for(const [width,height] of [[1160,790],[640,600],[390,790]]){
    await page.setViewportSize({width,height});
    expect(await dialog.evaluate(e=>{const r=e.getBoundingClientRect();return e.scrollWidth<=e.clientWidth&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})).toBe(true);
    if(width===1160)await page.screenshot({path:testInfo.outputPath('update-available.png')});
  }
  await page.getByRole('button',{name:'Later',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.evaluate(()=>window.updateCalls.some(c=>c.command==='install_update'))).toBe(false);
  await page.getByRole('button',{name:'Update available',exact:true}).click();
  await expect(dialog).toContainText('A new version is ready');
});

test('manual check reports current version and retains keyboard focus',async({page})=>{
  await open(page,{available:false});await check(page);
  await expect(page.getByRole('dialog')).toContainText('You’re up to date');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeFocused();
});

test('network errors are recoverable and do not claim the app is current',async({page})=>{
  await open(page,{error:true});await check(page);
  await expect(page.getByRole('alert')).toContainText('Couldn’t reach the release service');
  await expect(page.getByRole('dialog')).not.toContainText('You’re up to date');
  await page.evaluate(()=>window.checkError=false);
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('A new version is ready');
});

test('installation requires a click, reports progress, and protects the window',async({page})=>{
  await open(page);await check(page);
  await page.getByRole('button',{name:'Update and restart'}).click();
  await expect(page.getByRole('dialog')).toContainText('Downloading your update');
  await expect(page.getByRole('progressbar')).toHaveAttribute('value','50');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button',{name:'Add account',exact:true}).first()).toBeDisabled();
  await page.evaluate(()=>window.nativeListeners['update-progress']({payload:{phase:'installing'}}));
  await expect(page.getByRole('dialog')).toContainText('Installing your update');
  expect(await page.evaluate(()=>window.updateCalls.filter(c=>c.command==='install_update').length)).toBe(1);
});

test('verification or installation failure unlocks the app and offers retry',async({page})=>{
  await open(page,{installError:true});await check(page);
  await page.getByRole('button',{name:'Update and restart'}).click();
  await expect(page.getByRole('alert')).toContainText('verification');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.getByRole('button',{name:'Add account',exact:true}).first()).toBeEnabled();
  await page.getByRole('button',{name:'Update available',exact:true}).click();
  await page.evaluate(()=>window.installError=false);
  await page.getByRole('button',{name:'Update and restart'}).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('value','50');
});

test('automatic checks defer to the guide and do not install automatically',async({page})=>{
  await open(page,{automatic:true,tour:true});
  await page.waitForTimeout(2300);
  expect(await page.evaluate(()=>window.updateCalls.some(c=>c.command==='check_for_updates'))).toBe(false);
  await page.getByRole('button',{name:'Skip tour',exact:true}).first().click();
  await expect(page.locator('.update-dialog')).toContainText('A new version is ready',{timeout:8000});
  expect(await page.evaluate(()=>window.updateCalls.some(c=>c.command==='install_update'))).toBe(false);
});

test('automatic check preference persists and manual checks remain available',async({page})=>{
  await open(page);await page.getByRole('button',{name:'Settings',exact:true}).click();
  const preference=page.getByRole('checkbox',{name:'Check for app updates automatically'});
  await expect(preference).not.toBeChecked();await preference.check();
  expect(await page.evaluate(()=>localStorage.getItem('switcher.autoUpdates'))).toBe('1');
  await preference.uncheck();await page.waitForTimeout(2200);
  expect(await page.evaluate(()=>window.updateCalls.some(c=>c.command==='check_for_updates'))).toBe(false);
  await page.getByRole('button',{name:'Check for updates',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('A new version is ready');
});

test('automatic checks wait for browser sign-in to end',async({page})=>{
  await open(page,{automatic:true});
  await page.getByRole('button',{name:'Add account',exact:true}).first().click();
  await expect(page.getByText('Finish signing in',{exact:true})).toBeVisible();
  await page.waitForTimeout(2300);
  expect(await page.evaluate(()=>window.updateCalls.some(c=>c.command==='check_for_updates'))).toBe(false);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.locator('.update-dialog')).toContainText('A new version is ready',{timeout:8000});
});

test('update dialog is localized in Greek',async({page})=>{
  await open(page);await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Ελληνικά',exact:true}).click();
  await page.getByRole('button',{name:'Έλεγχος ενημερώσεων',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Μια νέα έκδοση είναι έτοιμη');
  await expect(page.getByRole('button',{name:'Ενημέρωση και επανεκκίνηση'})).toBeVisible();
});

test('successful version change shows the bundled release history once',async({page})=>{
  await open(page,{previous:'0.0.9'});
  await expect(page.getByRole('dialog')).toContainText('Welcome to your new version',{timeout:5000});
  await expect(page.getByRole('dialog')).toContainText('Windows installer');
  await expect(page.getByRole('button',{name:'Update and restart'})).toHaveCount(0);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.reload();await page.waitForTimeout(2200);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});


test('Linux package installations explain package updates and never offer the AppImage installer',async({page})=>{
  await open(page,{inAppUpdates:false,automatic:true});await check(page);
  await expect(page.getByRole('dialog')).toContainText('Update your Linux package');
  await expect(page.getByRole('dialog')).toContainText('DEB or RPM');
  await expect(page.getByRole('button',{name:'Update and restart',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>window.updateCalls.some(call=>call.command==='check_for_updates'||call.command==='install_update'))).toBe(false);
  await page.getByRole('button',{name:'Open downloads',exact:true}).click();
  expect(await page.evaluate(()=>window.updateCalls.some(call=>call.command==='open_release_downloads'))).toBe(true);
});
