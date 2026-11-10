import type {} from './browser-fixture-types.d.ts';
/** Rendered production bookmark adapter; synthetic native storage, not Android proof. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const url=process.env.ALPHA_CONTEXT_TEST_URL||'http://127.0.0.1:5194';
if(new URL(url).hostname!=='127.0.0.1')throw Error('Local Vite required');
const require=createRequire(path.join(process.env.ALPHA_BROWSER_MODULES||path.resolve('node_modules'),'fixture.cjs'));
const {chromium}=require('playwright');const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:412,height:915}});page.setDefaultTimeout(12000);
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const listeners=new Map(),prefs=new Map();window.androidBridge={};
  window.bookmarkFixture={reads:0,writes:0,failNext:true,rows:['https://example.com/?fixture=A','https://example.com/?fixture=B'],activeWrites:0,maxWrites:0,releases:[],hold:true,resume:()=>listeners.get('DailyApps:appResumed')?.forEach((cb: any)=>cb({}))};
  const promise=(name: any)=>({name,rtype:'promise'}),callback={name:'addListener',rtype:'callback'};
  window.Capacitor={PluginHeaders:[{name:'AlphaNotifications',methods:['status','removeListener'].map(promise).concat(callback)},{name:'AlphaVoiceCloud',methods:['checkPermissions'].map(promise)},{name:'AlphaBrowser',methods:['bookmarks','setBookmark','present','close','removeListener'].map(promise).concat(callback)},{name:'DailyApps',methods:['surfaceInfo','removeListener'].map(promise).concat(callback)},{name:'AlphaConnection',methods:['secureRead','secureWrite','secureRemove'].map(promise).concat(callback)}],
   nativeCallback:(plugin: any,method: any,args: any,cb: any)=>{const key=plugin+':'+args.eventName;listeners.set(key,[...(listeners.get(key)||[]),cb]);return 'fixture-listener';},
   nativePromise:async(plugin: any,method: any,args: any)=>{
    if(method==='removeListener')return {};
    if(plugin==='AlphaNotifications'&&method==='status')return {permissionGranted:true,appEnabled:true};
    if(plugin==='AlphaVoiceCloud'&&method==='checkPermissions')return {microphone:'granted'};
    if(plugin==='DailyApps'&&method==='surfaceInfo')return {assistant:false};
    if(plugin==='AlphaConnection'){if(method==='secureRead')return {value:prefs.get(args.slot)??null};if(method==='secureWrite')prefs.set(args.slot,args.value);if(method==='secureRemove')prefs.delete(args.slot);return {};}
    if(plugin==='AlphaBrowser'){
     const f=window.bookmarkFixture;
     if(method==='bookmarks'){f.reads++;if(f.failNext){f.failNext=false;throw Error('Synthetic transient bookmark read failure');}return {urls:[...f.rows]};}
     if(method==='setBookmark'){f.writes++;f.activeWrites++;f.maxWrites=Math.max(f.maxWrites,f.activeWrites);if(f.hold)await new Promise((resolve: any)=>f.releases.push(resolve));f.rows=f.rows.filter((u: any)=>u!==args.url);if(args.saved)f.rows.unshift(args.url);f.activeWrites--;return {urls:[...f.rows]};}
     return {};
    }
    throw Error('Unexpected native fixture call');
   }};
 });
 await page.goto(url,{waitUntil:'load'});await page.waitForFunction(()=>window.bookmarkFixture.reads===1);
 await page.getByRole('button',{name:'Browser',exact:true}).click();
 await page.waitForFunction(()=>window.bookmarkFixture.reads===2);
 await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('button',{name:'Bookmarks and history',exact:true}).click();
 const a='https://example.com/?fixture=A',b='https://example.com/?fixture=B',c='https://example.com/?fixture=C';
 await page.getByRole('button',{name:a,exact:true}).waitFor();
 await page.evaluate(()=>{window.bookmarkFixture.failNext=true;window.bookmarkFixture.rows.push('https://example.com/?fixture=C');window.bookmarkFixture.resume();});
 await page.waitForFunction(()=>window.bookmarkFixture.reads===3);
 await page.getByRole('button',{name:a,exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.bookmarkFixture.writes),0);
 const remove=(u: any)=>page.getByRole('button',{name:u,exact:true}).locator('..').getByRole('button',{name:'Remove bookmark',exact:true}).click();
 await remove(a);await page.waitForFunction(()=>window.bookmarkFixture.writes===1);await remove(b);
 assert.equal(await page.evaluate(()=>window.bookmarkFixture.writes),1,'Second mutation stays queued');
 await page.evaluate(()=>{window.bookmarkFixture.hold=false;window.bookmarkFixture.releases.splice(0).forEach((f: any)=>f());});
 await page.waitForFunction(()=>window.bookmarkFixture.writes===2&&window.bookmarkFixture.activeWrites===0);
 await page.getByRole('button',{name:a,exact:true}).waitFor({state:'detached'});await page.getByRole('button',{name:b,exact:true}).waitFor({state:'detached'});await page.getByRole('button',{name:c,exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:a,exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:b,exact:true}).count(),0);
 const facts=await page.evaluate(()=>({reads:window.bookmarkFixture.reads,writes:window.bookmarkFixture.writes,maxWrites:window.bookmarkFixture.maxWrites,rows:window.bookmarkFixture.rows}));
 assert.deepEqual(facts,{reads:4,writes:2,maxWrites:1,rows:[c]});
 console.log('PASS rendered bookmark recovery: initial failure retries on browser entry, resume failure preserves rows, next explicit mutation retries hydration, concurrent removals serialize and preserve newly stored unrelated bookmark. Synthetic native storage only.');
}finally{await browser.close();}
