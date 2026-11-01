import {test,expect} from '@playwright/test';
import {createServer,type ViteDevServer} from 'vite';
import {resolve} from 'node:path';
import {setTextScale} from './accessibility-states';
// Actual checklist + bundled CSS and the production text-scale probe, synthetic native/account ports only. No device grants or Google consent.
let server:ViteDevServer,origin:string;
test.beforeAll(async()=>{
 server=await createServer({configFile:resolve('vite.config.ts'),configLoader:'native',cacheDir:resolve('test-results/startup-access/vite-cache'),server:{host:'127.0.0.1',port:0},plugins:[{name:'access-composition',enforce:'pre',resolveId(id,importer){if(id==='/access-entry.tsx')return '\0access-entry';if(importer?.endsWith('startup-permissions.tsx')&&id==='./runtime/connection-ui')return '\0access-connection';if(importer?.endsWith('startup-permissions.tsx')&&id==='./runtime/google-connection-ui')return '\0access-google';},load(id){
 if(id==='\0access-connection')return `const w=window;let state={open:false,cloudAccount:null};let listeners=new Set();const client={gmailAccounts:async()=>w.access.accounts};w.access.signin=()=>{state={open:false,cloudAccount:{id:'synthetic'}};listeners.forEach(fn=>fn())};export const connectionController={subscribe:fn=>(listeners.add(fn),()=>listeners.delete(fn)),getSnapshot:()=>state,getCloudClient:()=>state.cloudAccount?{client,sessionId:'synthetic-session',credentialId:'synthetic-credential'}:null};`;
 if(id==='\0access-google')return `export const googleConnectionController={subscribe:()=>()=>{},getSnapshot:()=>false,open:()=>window.access.googleOpens++};`;
 if(id==='\0access-entry')return `import React from 'react';import {createRoot} from 'react-dom/client';import '/src/prototype/prototype.css';import {Capacitor} from '@capacitor/core';Capacitor.getPlatform=()=> 'android';Capacitor.isNativePlatform=()=>true;const {StartupPermissions}=await import('/src/startup-permissions.tsx');const {reopenStartupPermissions}=await import('/src/startup-permission-flow.ts');const {installTextScale}=await import('/src/runtime/text-scale.ts');installTextScale();window.access.reopen=reopenStartupPermissions;document.body.insertAdjacentHTML('afterbegin','<div class="os" aria-hidden="true"></div>');createRoot(document.getElementById('root')).render(React.createElement(StartupPermissions));`;
 },configureServer(s){s.middlewares.use('/access-composition',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/access-composition','<div id="root"></div><script type="module" src="/access-entry.tsx"></script>'));});}}]});
 await server.listen();origin=`http://127.0.0.1:${(server.httpServer!.address()as {port:number}).port}`;
});
test.afterAll(async()=>{await server?.close();});

async function accessFixture(page:import('@playwright/test').Page){
 await page.addInitScript(()=>{
  const w=window as any;w.access={calls:[],accounts:[],googleOpens:0};
  const names={AlphaNotifications:['status'],AlphaVoiceCloud:['checkPermissions','requestPermissions'],ElizaLocation:['checkPermissions','requestPermissions'],AlphaCalendar:['checkPermissions','requestAccess'],AlphaPhotoLibrary:['scope','requestAccess'],DailyApps:['checkPermissions','requestPermissions','addListener','removeListener'],AlphaDevice:['openSettings']};
  w.Capacitor={PluginHeaders:Object.entries(names).map(([name,methods])=>({name,methods:methods.map(name=>({name,rtype:'promise'}))})),nativePromise:async(plugin:string,method:string,input:any)=>{
   w.access.calls.push({plugin,method,input});
   if(plugin==='AlphaNotifications')return {permissionGranted:true,appEnabled:true};
   if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
   if(plugin==='DailyApps'&&method==='checkPermissions')return {camera:'granted'};
   if(plugin==='ElizaLocation')return {location:'granted',accuracy:'approximate'};
   if(plugin==='AlphaCalendar')return {calendar:'granted'};
   if(plugin==='AlphaPhotoLibrary')return {scope:'selected',locked:false};
   return {};
  }};
 });
 await page.goto(origin+'/access-composition');await expect.poll(()=>page.evaluate(()=>typeof(window as any).access.reopen)).toBe('function');
 await page.evaluate(()=>(window as any).access.signin());
 return page.locator('dialog.alpha-startup-permissions');
}
test('required native access keeps focused, reachable controls at narrow widths and large text, with honest limited grants',async({page})=>{
 const panel=await accessFixture(page);const heading=panel.getByRole('heading',{name:'Stay in the loop.',exact:true}),action=panel.getByRole('button',{name:'Continue',exact:true});
 await expect(heading).toBeFocused();
 for(const viewport of [{width:274,height:538,scale:1},{width:280,height:538,scale:1},{width:360,height:740,scale:2},{width:360,height:800,scale:2}]){
  await page.setViewportSize({width:viewport.width,height:viewport.height});await setTextScale(page,viewport.scale);await action.scrollIntoViewIfNeeded();
  const box=await action.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height);
  await expect(panel.getByRole('button',{name:/Skip|Not now|Back/})).toHaveCount(0);
 }
 await page.setViewportSize({width:360,height:740});await setTextScale(page,1);
 await heading.focus();await page.keyboard.press('Tab');await expect(action).toBeFocused();
 for(const name of ['Stay in the loop.','Talk to Alpha.','Capture a moment.','Find your way.','Plan your day.','Your photos, here.']){
  await expect(panel.getByRole('heading',{name,exact:true})).toBeVisible();
  if(name==='Find your way.')await expect(panel.getByText('Approximate location allowed',{exact:true})).toBeVisible();
  if(name==='Your photos, here.')await expect(panel.getByText('Selected photos and videos only',{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Continue',exact:true}).click();
 }
 await expect(panel.getByRole('heading',{name:'You’re all set',exact:true})).toBeFocused();await panel.getByRole('button',{name:'Go to Alpha',exact:true}).click();await expect(panel).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).access.calls.filter((c:any)=>['requestPermissions','requestAccess','openSettings','list','sync'].includes(c.method)))).toEqual([]);
 await page.reload();await expect.poll(()=>page.evaluate(()=>typeof(window as any).access.reopen)).toBe('function');await page.evaluate(()=>(window as any).access.signin());await expect(panel).toHaveCount(0);
});
test('explicit Settings review starts at the original heading and targeted Done preserves completion',async({page})=>{
 const panel=await accessFixture(page);
 for(let i=0;i<6;i++)await panel.getByRole('button',{name:'Continue',exact:true}).click();await panel.getByRole('button',{name:'Go to Alpha',exact:true}).click();
 await page.evaluate(()=>(window as any).access.reopen());await expect(panel.getByRole('heading',{name:'Stay in the loop.',exact:true})).toBeFocused();expect(await panel.evaluate(el=>el.scrollTop)).toBe(0);
 for(let i=0;i<6;i++)await panel.getByRole('button',{name:'Continue',exact:true}).click();await panel.getByRole('button',{name:'Go to Alpha',exact:true}).click();
 const before=await page.evaluate(()=>localStorage.getItem('alpha:startup-permission-walkthrough:v1'));
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('alpha:startup-permissions-reopen',{detail:{permission:'camera'}})));
 await expect(panel.getByRole('heading',{name:'Capture a moment.',exact:true})).toBeVisible();await panel.getByRole('button',{name:'Done',exact:true}).click();await expect(panel).toHaveCount(0);
 expect(await page.evaluate(()=>localStorage.getItem('alpha:startup-permission-walkthrough:v1'))).toBe(before);
 expect(await page.evaluate(()=>(window as any).access.calls.filter((c:any)=>['requestPermissions','requestAccess','openSettings'].includes(c.method)))).toEqual([]);
});
