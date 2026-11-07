import {test,expect} from '@playwright/test';
import {realpathSync} from 'node:fs';
// The shared page-reading module, served from the prepared client features (vite fs.allow).
const readingModule='/@fs'+realpathSync('.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts');
// Class S for the Android product: these run the renderer's capability module and the web build's
// menu in Chromium. They do not run the native browser, whose answer BrowserReadingNavigation
// asserts on an emulator.
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');});
const probe=(page:any,answers:unknown[])=>page.evaluate(async([answers,readingModule]:[unknown[],string])=>{
 const {createReadingSupport}=await import(readingModule);
 let asked=0,changed=0;const states:string[]=[];
 const support=createReadingSupport(async()=>{const answer=answers[Math.min(asked++,answers.length-1)];if(answer==='throw')throw new Error('bridge closed');return answer;},()=>{changed++;});
 states.push(support.state);
 const together=await Promise.all([support.check(),support.check()]);states.push(support.state);
 const again=await support.check();states.push(support.state);
 return {asked,changed,states,together,again};
},[answers,readingModule]);
test('an explicit native "no" is remembered as unavailable and asked for once',async({page})=>{
 expect(await probe(page,[{available:false}])).toEqual({asked:1,changed:1,states:['unknown','unavailable','unavailable'],together:['unavailable','unavailable'],again:'unavailable'});
});
test('an explicit native "yes" is remembered as available',async({page})=>{
 expect(await probe(page,[{available:true}])).toEqual({asked:1,changed:1,states:['unknown','available','available'],together:['available','available'],again:'available'});
});
test('a failed or malformed answer is never read as unavailable or available, and is asked again',async({page})=>{
 // Unknown lets the review start; the native side then refuses on its own if it must.
 expect(await probe(page,['throw',{available:false}])).toEqual({asked:2,changed:1,states:['unknown','unknown','unavailable'],together:['unknown','unknown'],again:'unavailable'});
 for(const malformed of [null,{},{available:'false'},{available:0},'no'])
  expect((await probe(page,[malformed,malformed])).states,JSON.stringify(malformed)).toEqual(['unknown','unknown','unknown']);
});
test('the message names both actions, the cause and the remedy, and promises nothing else',async({page})=>{
 const message=await page.evaluate(async readingModule=>(await import(readingModule)).READING_UNSUPPORTED_MESSAGE,readingModule);
 expect(message).toBe('Read aloud and Ask about page are unavailable on this device: its Android System WebView cannot read a page privately. Update Android System WebView.');
});
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
