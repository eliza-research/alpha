import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const source=readFileSync(new URL('../../apps/app/src/prototype/browser-adapter.ts',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('  async function openExternalBrowser()'),source.indexOf('  /** Remove renderer tabs'));
// Load the same prepared shared module as the product adapter, through Vite's existing allowed root.
const tabHostModule='/@fs'+fileURLToPath(new URL('../../.eliza/client-features/plugins/plugin-native-browser-surface/src/tab-host.ts',import.meta.url));
// Actual adapter handler and actual DOM review; only native dispatch/presentation are stand-ins.
async function fixture(page:any,priv=true){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');
 await page.addScriptTag({type:'module',content:`import {BrowserTabSession} from ${JSON.stringify(tabHostModule)};window.handoffTabHost=BrowserTabSession;`});
 await page.evaluate(async({handler,priv})=>{
  const {BrowserReviews}=await import('/src/browser/review.ts');
  const tabs=new (window as any).handoffTabHost({session:'session'});
  await tabs.ensure('owned',priv,async()=>({}));
  tabs.annotate('owned',{committed:true,loading:false,error:'',url:'https://accounts.example/signin',navigation:'7'});
  const screen=document.createElement('div');screen.id='handoff-native-standin';screen.textContent='Native page stand-in';screen.style.cssText='position:fixed;left:0;top:0;width:100px;height:24px';document.body.append(screen);
  const state={cur:'owned',menu:true};
  const env:any={sharing:false,confirming:false,disposed:false,lastGeometry:'',session:'session',calls:[],errors:[],updates:0,
   state:()=>state,isPrivate:(id:string)=>tabs.isPrivate(id),tabs,
   shell:{S:()=>({view:'browser'}),vset:(_view:string,patch:any)=>Object.assign(state,patch)},reviews:new BrowserReviews(),
   report:(error:any)=>env.errors.push(error.message),update:async()=>{env.updates++;screen.hidden=env.confirming;},
   Browser:{openExternalBrowser:async(input:any)=>{env.calls.push(input);if(env.unavailable)throw Error('No other installed browser can open this page.');}}};
  env.open=Function('env',`with(env){${handler};return openExternalBrowser;}`)(env);(window as any).handoff=env;
 },{handler,priv});
 expect(await page.evaluate(()=>(window as any).handoff.tabs.pageBinding('owned',{https:true}))).toEqual({id:'owned',url:'https://accounts.example/signin',navigation:'7',revision:0,private:priv});
}
test('private cancellation restores the native surface without handing off',async({page})=>{
 await fixture(page);await page.evaluate(()=>{void (window as any).handoff.open();});
 const dialog=page.getByRole('dialog',{name:'Leave private browsing?'});await expect(dialog).toBeVisible();
 await expect(dialog).toContainText('may save it in its history');await expect(page.locator('#handoff-native-standin')).toBeHidden();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator('#handoff-native-standin')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).handoff.calls)).toEqual([]);
});
test('private approval sends only exact page identity once despite a duplicate tap',async({page})=>{
 await fixture(page);await page.evaluate(()=>{void (window as any).handoff.open();void (window as any).handoff.open();});
 await page.getByRole('dialog',{name:'Leave private browsing?'}).getByRole('button',{name:'Choose browser',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).handoff.calls.length)).toBe(1);
 expect(await page.evaluate(()=>(window as any).handoff.calls[0])).toEqual({session:'session',id:'owned',navigation:'7',url:'https://accounts.example/signin',privateConfirmed:true});
});
test('a page changed during private confirmation never leaves Alpha',async({page})=>{
 await fixture(page);await page.evaluate(()=>{void (window as any).handoff.open();});
 await expect(page.getByRole('dialog',{name:'Leave private browsing?'})).toBeVisible();
 await page.evaluate(()=>{const tabs=(window as any).handoff.tabs;tabs.beginNavigation('owned','https://accounts.example/signin');tabs.annotate('owned',{committed:true,loading:false});});
 expect(await page.evaluate(()=>(window as any).handoff.tabs.pageBinding('owned',{https:true}))).toEqual({id:'owned',url:'https://accounts.example/signin',navigation:'7',revision:1,private:true});
 await page.getByRole('button',{name:'Choose browser',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).handoff.errors.length)).toBe(1);
 expect(await page.evaluate(()=>(window as any).handoff.calls)).toEqual([]);
});
test('an unavailable normal-browser handoff reports refusal and restores presentation',async({page})=>{
 await fixture(page,false);await page.evaluate(async()=>{const f=(window as any).handoff;f.unavailable=true;await f.open();});
 expect(await page.evaluate(()=>(window as any).handoff.errors)).toEqual(['No other installed browser can open this page.']);
 await expect(page.locator('#handoff-native-standin')).toBeVisible();await expect(page.getByRole('dialog',{name:'Leave private browsing?'})).toHaveCount(0);
});
