import {test,expect} from '@playwright/test';
// Class S for the Android product: these run the web build's menu in Chromium. They do not run
// the native browser, whose answer BrowserReadingNavigation asserts on an emulator. The shared
// capability probe and its message are node tests in test/reading-capability-probe.test.mjs.
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');});
test('the web build offers reading a committed page without an Android unavailable note',async({page})=>{
 await page.route('https://reading.example/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Public reading fixture</h1>'}));
 await page.getByRole('button',{name:'Browser',exact:true}).click();
 await page.getByRole('button',{name:'Search or type address',exact:true}).click();
 await page.getByRole('textbox',{name:'Address',exact:true}).fill('https://reading.example/article');
 await page.getByRole('textbox',{name:'Address',exact:true}).press('Enter');
 await expect(page.frameLocator('iframe[title="Website"]').getByRole('heading',{name:'Public reading fixture'})).toBeVisible();
 await page.getByRole('button',{name:'Menu',exact:true}).click();
 const menu=page.getByRole('dialog',{name:'Browser menu'});
 await expect(menu.getByRole('button',{name:'Read aloud',exact:true})).toBeVisible();
 await expect(menu.getByRole('button',{name:'Ask about page',exact:true})).toBeVisible();
 await expect(menu.locator('[data-alpha-reading-unavailable]')).toHaveCount(0);
});
test('web reading stays unavailable for blank, loading, stopped and external-only pages',async({page})=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let requests=0;
 await page.route('https://reading.example/**',async route=>{if(++requests===1)await held;await route.fulfill({contentType:'text/html',body:'<h1>Loaded reading fixture</h1>'}).catch(()=>{});});
 await page.evaluate(async()=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts');
  await registerPlugin<any>('AlphaBrowser').addListener('stateChanged',(event:any)=>{(window as any).readingPageEvent=event;});
 });
 const menu=page.getByRole('dialog',{name:'Browser menu'});
 const unavailable=async()=>{
  await expect(menu.getByRole('button',{name:'Read aloud',exact:true})).toHaveCount(0);
  await expect(menu.getByRole('button',{name:'Ask about page',exact:true})).toHaveCount(0);
 };
 await page.getByRole('button',{name:'Browser',exact:true}).click();
 await page.getByRole('button',{name:'Menu',exact:true}).click();await unavailable();
 // The backdrop fills the screen under the menu; tap it outside the menu, as browser-signins does.
 await page.getByRole('button',{name:'Close menu',exact:true}).click({position:{x:8,y:8}});
 await page.getByRole('button',{name:'Search or type address',exact:true}).click();
 await page.getByRole('textbox',{name:'Address',exact:true}).fill('https://reading.example/article');
 await page.getByRole('textbox',{name:'Address',exact:true}).press('Enter');await expect.poll(()=>requests).toBe(1);
 await page.getByRole('button',{name:'Menu',exact:true}).click();await unavailable();
 await menu.getByRole('button',{name:'Stop loading',exact:true}).click();
 await expect(page.getByText('Loading stopped. Reload to open this page.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Menu',exact:true}).click();await unavailable();
 release();await menu.getByRole('button',{name:'Reload page',exact:true}).click();
 await expect(page.frameLocator('iframe[title="Website"]').getByRole('heading',{name:'Loaded reading fixture'})).toBeVisible();
 await page.getByRole('button',{name:'Menu',exact:true}).click();
 await expect(menu.getByRole('button',{name:'Read aloud',exact:true})).toBeVisible();
 // A fallback provider may return an external destination instead of an embedded page.
 // Even a malformed positive commit must not give that destination reading authority.
 await page.evaluate(async()=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts'),event=(window as any).readingPageEvent;
  await registerPlugin<any>('AlphaBrowser').notifyListeners('stateChanged',{...event,sequence:event.sequence+1,externalOnly:true,committed:true});
 });
 await unavailable();
});
