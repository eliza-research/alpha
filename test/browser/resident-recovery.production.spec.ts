import {seedCompletedAccessSetup} from './flag-off-android';
import {test,expect,type Page} from '@playwright/test';
import {flagOffAndroid,fenceNetwork,harness,button,completeAccessSetup} from './flag-off-android';
import {residentStub} from './resident-stub';
// Actual flag-off UI/CSS with closed native boundary fixtures. These tests do not archive real files.
const token='d32f7f34-962b-47b7-8f0d-f2fe7f12610a';
type Mode='success'|'held-review'|'review-unavailable'|'changed'|'partial'|'transient';
async function boot(page:Page,mode:Mode='success',signedOut=false){
 await fenceNetwork(page);await flagOffAndroid(page);await residentStub(page,{nativeSignIn:true,emptyKeystore:signedOut,accounts:[{token:'synthetic-cloud-key',userId:'9f1dc45a-4011-4e44-947a-30d999d24fa5',email:'owner@example.invalid',balance:5}]});
 await page.addInitScript(({mode,token})=>{
  const w=window as any,c=w.Capacitor,previous=c.nativePromise;let archived=false;
  const calls=w.recoveryCalls={starts:0,reviews:0,archives:[] as unknown[]};
  const control=w.recoveryControl={pending:false,hidden:false,release:null as null|(()=>void)};
  Object.defineProperty(document,'hidden',{get:()=>control.hidden});
  c.PluginHeaders.find((p:any)=>p.name==='Agent').methods.push(...['reviewRecovery','archiveRecovery'].map(name=>({name,rtype:'promise'})));
  c.nativePromise=async(p:string,m:string,input:any)=>{
   if(p==='Agent'&&m==='start'){
    calls.starts++;
    if(!archived&&(mode!=='transient'||calls.starts===1))throw Object.assign(Error('Native startup refused'),{code:mode==='transient'?'temporary-start-failure':'ipc-recovery-retention-limit'});
   }
   if(p==='Agent'&&m==='reviewRecovery'){calls.reviews++;if(mode==='held-review'){control.pending=true;await new Promise<void>(resolve=>control.release=resolve);control.pending=false;}return mode==='review-unavailable'?{status:'unavailable',retainedCount:8,reason:'inventory-unavailable'}:{status:'reviewable',retainedCount:8,reviewToken:calls.reviews===1?token:token.replace(/.{12}$/,String(calls.reviews).padStart(12,'0'))};}
   if(p==='Agent'&&m==='archiveRecovery'){
    calls.archives.push(structuredClone(input));
    if(mode==='changed')return {status:'unavailable',archivedCount:0,retainedCount:8,reason:'records-changed'};
    if(mode==='partial')return {status:'partial',archivedCount:3,retainedCount:5,reason:'interrupted-archive'};
    archived=true;return {status:'archived',archivedCount:8,retainedCount:0};
   }
   return previous(p,m,input);
  };
 },{mode,token});
 await page.goto('/');await expect.poll(()=>page.evaluate(()=>(window as any).recoveryCalls.starts)).toBe(1);
 if(signedOut){const gate=page.locator('[role="main"].alpha-cloud-sign-in');await expect(gate).toBeVisible();return gate;}
 await expect(button(page,'Settings')).toBeVisible();await completeAccessSetup(page);await button(page,'Settings').click();await page.getByRole('button',{name:'Agent',exact:true}).click();
 const panel=page.getByRole('region',{name:'Settings',exact:true});await expect(panel.getByRole('heading',{name:'Agent',exact:true})).toBeVisible();return panel;
}
const calls=(page:Page)=>page.evaluate(()=>(window as any).recoveryCalls as {starts:number;reviews:number;archives:unknown[]});
test('recovery waits for explicit restart and a backgrounded review cannot archive or start',async({page},testInfo)=>{
 const panel=await boot(page,'held-review');await expect(panel.getByRole('button',{name:'Review recovery',exact:true})).toBeEnabled();
 await expect(panel.getByRole('button',{name:'Start agent',exact:true})).toHaveCount(0);
 expect(await calls(page)).toEqual({starts:1,reviews:0,archives:[]});
 await panel.getByRole('button',{name:'Review recovery',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).recoveryControl.pending)).toBe(true);
 await page.evaluate(()=>{const c=(window as any).recoveryControl;c.hidden=true;document.dispatchEvent(new Event('visibilitychange'));c.release();});
 await expect.poll(()=>page.evaluate(()=>(window as any).recoveryControl.pending)).toBe(false);
 expect(await calls(page)).toEqual({starts:1,reviews:1,archives:[]});
 // A completed read may remain available, but its confirmation has no authority in the background.
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Keep records and restart'));
 await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Keep records and restart')!.click());
 expect(await calls(page)).toEqual({starts:1,reviews:1,archives:[]});
 await page.evaluate(()=>{(window as any).recoveryControl.hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
 await expect(panel.getByRole('button',{name:'Keep records and restart',exact:true})).toBeEnabled();
 await page.screenshot({path:testInfo.outputPath('recovery-restart.png'),fullPage:true});
 expect(await calls(page)).toEqual({starts:1,reviews:1,archives:[]});
});
test('explicit restart requires complete archival before one ordinary start and retains the Cloud credential',async({page})=>{
 const panel=await boot(page);const key=await harness(page,f=>f.slots['cloud:production']);
 await panel.getByRole('button',{name:'Review recovery',exact:true}).click();
 await expect.poll(()=>calls(page)).toEqual({starts:1,reviews:1,archives:[]});
 await panel.getByRole('button',{name:'Keep records and restart',exact:true}).click();
 await expect.poll(()=>calls(page)).toEqual({starts:2,reviews:1,archives:[{reviewToken:token}]});await expect(panel.getByRole('button',{name:'Restart agent',exact:true})).toBeVisible();
 expect(await harness(page,f=>f.slots['cloud:production'])).toBe(key);expect(await harness(page,f=>f.streams)).toBe(0);await expect(page.getByRole('region',{name:'Settings',exact:true})).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));await expect(button(page,'Notes')).toBeVisible();
});
test('unavailable native inventory keeps restart blocked without archival',async({page})=>{
 const panel=await boot(page,'review-unavailable');await panel.getByRole('button',{name:'Review recovery',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Review recovery',exact:true})).toBeEnabled();
 expect(await calls(page)).toEqual({starts:1,reviews:1,archives:[]});
 await expect(panel.getByRole('button',{name:'Restart agent',exact:true})).toHaveCount(0);
});
for(const mode of ['changed','partial'] as const)test(`${mode} archival cannot start the agent and retry gets a fresh native review`,async({page})=>{
 const panel=await boot(page,mode);await panel.getByRole('button',{name:'Review recovery',exact:true}).click();
 await panel.getByRole('button',{name:'Keep records and restart',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Review recovery',exact:true})).toBeEnabled();
 expect(await calls(page)).toEqual({starts:1,reviews:1,archives:[{reviewToken:token}]});
 await panel.getByRole('button',{name:'Review recovery',exact:true}).click();
 await panel.getByRole('button',{name:'Keep records and restart',exact:true}).click();
 await expect.poll(()=>calls(page)).toEqual({starts:1,reviews:2,archives:[{reviewToken:token},{reviewToken:token.replace(/.{12}$/,String(2).padStart(12,'0'))}]});
 await expect(panel.getByRole('button',{name:'Restart agent',exact:true})).toHaveCount(0);
});
test('ordinary transient startup failure retains normal Retry without recovery operations',async({page})=>{
 const dialog=await boot(page,'transient');
 await expect(dialog.getByRole('button',{name:'Review recovery',exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Start agent',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Restart agent',exact:true})).toBeVisible();
 // An already scheduled automatic recovery can overlap this tap, but neither path archives.
 const result=await calls(page);expect(result.reviews).toBe(0);expect(result.archives).toEqual([]);
 expect(result.starts).toBeGreaterThanOrEqual(2);expect(result.starts).toBeLessThanOrEqual(3);
});

test('a signed-out startup refusal keeps guarded restart reachable on the sign-in page',async({page})=>{
 const gate=await boot(page,'success',true);
 expect(await calls(page)).toEqual({starts:1,reviews:0,archives:[]});
 await gate.getByRole('button',{name:'Restart Alpha',exact:true}).click();
 await expect.poll(()=>calls(page)).toEqual({starts:2,reviews:1,archives:[{reviewToken:token}]});
 await expect(gate.getByRole('button',{name:'Email me a code',exact:true})).toBeEnabled();
 expect(await harness(page,f=>f.slots['cloud:production']??null)).toBeNull();
});

// UI progress only: this feature fixture does not manufacture OS/provider grants.
test.beforeEach(async({page})=>seedCompletedAccessSetup(page));
