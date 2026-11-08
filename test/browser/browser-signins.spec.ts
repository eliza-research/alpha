import {test,expect,type Page} from '@playwright/test';
// Product decision: normal tabs keep sign-ins, tabs and history; private tabs are
// ephemeral and never saved. These native-renderer contract tests use the
// registered sandboxed BrowserSurface as a closed stand-in for native events.
// They explicitly select native presentation while the closed frame supplies navigation
// events. Android instrumentation covers actual persistent/private WebView profiles
// and cookies; the final case separately checks the web-only refusal.
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.route('https://signins.example/**',route=>route.fulfill({contentType:'text/html',body:`<title>${new URL(route.request().url()).pathname.slice(1)}</title><h1>${new URL(route.request().url()).pathname.slice(1)}</h1>`}));
 await page.goto('/');
});
const heading=(page:Page,name:string)=>page.frameLocator('[data-browser-surface]:visible iframe').getByRole('heading',{name,exact:true});
// Cases that check the web fallback load pages through the native contract, then select web presentation.
const webPresentation=(page:Page)=>page.evaluate(()=>{(window as any).Capacitor.isNativePlatform=()=>false;});
async function openBrowser(page:Page){await page.evaluate(()=>{(window as any).Capacitor.isNativePlatform=()=>true;});await page.getByRole('button',{name:'Browser',exact:true}).click();await expect(page.getByRole('button',{name:'Menu',exact:true})).toBeVisible();}
async function navigate(page:Page,path:string){
 if(!await page.getByRole('textbox',{name:'Address',exact:true}).isVisible())await page.getByRole('button',{name:'Edit address',exact:true}).click();
 await page.getByRole('textbox',{name:'Address',exact:true}).fill('https://signins.example/'+path);await page.getByRole('textbox',{name:'Address',exact:true}).press('Enter');
 await expect(heading(page,path)).toBeVisible();
}
async function menu(page:Page,name:string){await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('button',{name,exact:true}).click();}
async function history(page:Page){await menu(page,'Bookmarks and history');await page.getByRole('button',{name:'History',exact:true}).click();}
const saved=(page:Page)=>page.evaluate(async()=>{const {browsingSessionDocument}=await import('/src/browser/preference-documents.ts');return browsingSessionDocument.read<any>(()=>({history:[],tabs:[],cur:''}));});

test('normal tabs and history survive a cold start and the selected tab reloads its page',async({page})=>{
 // Each case cold-starts the app again; under a parallel run that can exceed the default budget.
 test.slow();
 await openBrowser(page);await navigate(page,'first');await navigate(page,'second');
 await page.getByRole('button',{name:'Tabs',exact:true}).click();await page.getByRole('button',{name:'New tab',exact:true}).click();await navigate(page,'third');
 await expect.poll(async()=>(await saved(page)).tabs.map((tab:any)=>tab.url)).toEqual(['https://signins.example/second','https://signins.example/third']);
 await expect.poll(async()=>(await saved(page)).history).toEqual(['https://signins.example/third','https://signins.example/second','https://signins.example/first']);
 await page.reload();await openBrowser(page);
 await expect(page.getByRole('button',{name:'Tabs',exact:true})).toHaveText('2');
 await expect(heading(page,'third')).toBeVisible();
 await page.getByRole('button',{name:'Tabs',exact:true}).click();await page.getByRole('button',{name:'Switch to https://signins.example/second',exact:true}).click();await expect(heading(page,'second')).toBeVisible();
 await history(page);for(const path of ['first','second','third'])await expect(page.getByRole('button',{name:'https://signins.example/'+path,exact:true})).toBeVisible();
});

test('a private tab is labelled, created ephemeral and never enters saved tabs or history',async({page})=>{
 // Each case cold-starts the app again; under a parallel run that can exceed the default budget.
 test.slow();
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');(window as any).privateEvents=[];await registerPlugin<any>('AlphaBrowser').addListener('stateChanged',(e:any)=>(window as any).privateEvents.push({id:e.id,private:e.private}));});
 await openBrowser(page);await navigate(page,'normal');
 await menu(page,'New private tab');
 // A new private tab opens on its address field, whose suggestions cover the page and its badge:
 // the disclosure must be on the covering surface itself (the covered page is inert).
 await expect(page.getByRole('textbox',{name:'Address',exact:true})).toBeFocused();
 await expect(page.getByRole('note',{name:'Private tab notice'})).toContainText('deleted when you close it, and it is not saved in history');
 await page.getByRole('button',{name:'Cancel editing',exact:true}).click();
 await expect(page.getByRole('img',{name:'Private tab',exact:true})).toBeVisible();
 await expect(page.getByRole('note',{name:'Private tab notice'})).toContainText('deleted when you close it, and it is not saved in history');
 await navigate(page,'secret');await expect(page.getByRole('img',{name:'Private tab',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).privateEvents.some((e:any)=>e.private===true))).toBe(true);
 await page.getByRole('button',{name:'Tabs',exact:true}).click();
 await expect(page.getByRole('button',{name:'Switch to private tab https://signins.example/secret',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Switch to https://signins.example/normal',exact:true}).click();
 await expect(page.getByRole('img',{name:'Private tab',exact:true})).toHaveCount(0);
 await expect.poll(async()=>(await saved(page)).tabs.length).toBe(1);
 const record=await saved(page);expect(JSON.stringify(record)).not.toContain('secret');
 await history(page);await expect(page.getByRole('button',{name:'https://signins.example/normal',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'https://signins.example/secret',exact:true})).toHaveCount(0);
 await page.reload();await openBrowser(page);
 await expect(page.getByRole('button',{name:'Tabs',exact:true})).toHaveText('1');await expect(heading(page,'normal')).toBeVisible();
 await expect(page.getByRole('img',{name:'Private tab',exact:true})).toHaveCount(0);
});

test('Clear browsing data asks first, then clears history and saved tabs but keeps bookmarks and private tabs',async({page})=>{
 // Each case cold-starts the app again; under a parallel run that can exceed the default budget.
 test.slow();
 await openBrowser(page);await navigate(page,'kept-mark');await menu(page,'Bookmark');await navigate(page,'visited');
 await menu(page,'New private tab');await navigate(page,'private-open');
 await menu(page,'Clear browsing data');
 const dialog=page.getByRole('dialog',{name:'Clear browsing data?'});await expect(dialog).toBeVisible();await expect(dialog).toContainText('Deletes cookies and site data, so you will be signed out of websites.');await expect(dialog).toContainText('Bookmarks and private tabs are kept.');
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect.poll(async()=>(await saved(page)).history.length).toBe(2);
 await menu(page,'Clear browsing data');await page.getByRole('dialog',{name:'Clear browsing data?'}).getByRole('button',{name:'Clear data',exact:true}).click();
 await expect(page.getByText('Browsing data cleared',{exact:true})).toBeVisible();
 // The private tab stays open; the normal tabs are closed.
 await expect(page.getByRole('button',{name:'Tabs',exact:true})).toHaveText('1');await expect(page.getByRole('img',{name:'Private tab',exact:true})).toBeVisible();
 await expect.poll(async()=>await saved(page)).toEqual({history:[],tabs:[],cur:''});
 await history(page);await expect(page.getByRole('button',{name:/^https:\/\/signins\.example\//})).toHaveCount(0);
 await page.getByRole('button',{name:'Bookmarks',exact:true}).click();await expect(page.getByRole('button',{name:'https://signins.example/kept-mark',exact:true})).toBeVisible();
 await page.reload();await openBrowser(page);await expect(page.getByRole('button',{name:'Tabs',exact:true})).toHaveText('1');
 await expect(page.locator('[data-browser-surface]')).toHaveCount(0);
});

test('web site-data deletion is unavailable and direct calls cannot claim success',async({page})=>{
 await openBrowser(page);await navigate(page,'account');await webPresentation(page);
 await page.getByRole('button',{name:'Menu',exact:true}).click();
 await expect(page.getByRole('button',{name:'Clear data for this site',exact:true})).toHaveCount(0);
 expect(await page.evaluate(async()=>{
  const {BrowserSurface}=await import('/src/browser/browser-surface.ts');
  try { await new BrowserSurface().clearSiteData({session:'test',id:'test',url:'https://signins.example/account'}); return 'success'; }
  catch(error){return (error as Error).message;}
 })).toBe('Clear website data in your browser settings.');
 await page.getByRole('button',{name:'Close menu',exact:true}).click({position:{x:8,y:8}});
 await expect(heading(page,'account')).toBeVisible();
});

test('native pop-up tabs, window closes and notices reach the rendered browser',async({page})=>{
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaBrowser').addListener('stateChanged',(e:any)=>{(window as any).browserSession=e.session;(window as any).openerId=e.id;});});
 await openBrowser(page);await navigate(page,'opener');
 // The sandboxed development frame cannot raise native WebView pop-ups, so the
 // native events are delivered through the registered plugin's listener API.
 const emit=(name:string,data:any)=>page.evaluate(async({name,data})=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await (registerPlugin<any>('AlphaBrowser') as any).notifyListeners(name,{session:(window as any).browserSession,...data});},{name,data});
 await emit('tabOpened',{id:'pPopup1',opener:await page.evaluate(()=>(window as any).openerId),private:false});
 await expect(page.getByRole('button',{name:'Tabs',exact:true})).toHaveText('2');
 await emit('notice',{id:'pPopup1',message:'Blocked a pop-up that opened without a tap.'});
 await expect(page.getByText('Blocked a pop-up that opened without a tap.',{exact:true})).toBeVisible();
 await emit('tabOpened',{id:'pPopup1',opener:'x',private:false});
 await expect(page.getByRole('button',{name:'Tabs',exact:true})).toHaveText('2');
 await emit('tabClosed',{id:'pPopup1'});
 await expect(page.getByRole('button',{name:'Tabs',exact:true})).toHaveText('1');
 await expect(heading(page,'opener')).toBeVisible();
 // Events from another browser session are ignored.
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await (registerPlugin<any>('AlphaBrowser') as any).notifyListeners('tabOpened',{session:'stale',id:'pStale',private:false});});
 await expect(page.getByRole('button',{name:'Tabs',exact:true})).toHaveText('1');
});


test('a restored tab keeps its committed address while a reload is interrupted',async({page})=>{
 // Each case cold-starts the app again; under a parallel run that can exceed the default budget.
 test.slow();
 await openBrowser(page);await navigate(page,'retained');
 await expect.poll(async()=>(await saved(page)).tabs.map((tab:any)=>tab.url)).toEqual(['https://signins.example/retained']);
 let requested=false;
 await page.route('https://signins.example/retained',async route=>{requested=true;await route.abort();});
 await page.reload();await openBrowser(page);
 await expect.poll(()=>requested).toBe(true);
 await expect(page.locator('[data-browser-surface]:visible')).toHaveCount(1);
 await expect.poll(async()=>(await saved(page)).tabs.map((tab:any)=>tab.url)).toEqual(['https://signins.example/retained']);
 await page.reload();await openBrowser(page);
 await expect(page.getByRole('button',{name:'Tabs',exact:true})).toHaveText('1');
 expect((await saved(page)).tabs[0].url).toBe('https://signins.example/retained');
});
