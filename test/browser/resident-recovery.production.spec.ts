import {seedCompletedAccessSetup} from './flag-off-android';
import {test,expect,type Page} from '@playwright/test';
import {flagOffAndroid,fenceNetwork,harness,button,completeAccessSetup} from './flag-off-android';
import {residentStub} from './resident-stub';
// Actual flag-off UI/CSS with closed native boundary fixtures. These tests do not archive real files.
const token='d32f7f34-962b-47b7-8f0d-f2fe7f12610a';
type Mode='success'|'review-unavailable'|'changed'|'partial'|'transient';
async function boot(page:Page,mode:Mode='success',signedOut=false){
 await fenceNetwork(page);await flagOffAndroid(page);await residentStub(page,{nativeSignIn:signedOut,emptyKeystore:signedOut,accounts:[{token:'synthetic-cloud-key',userId:'9f1dc45a-4011-4e44-947a-30d999d24fa5',email:'owner@example.invalid',balance:5}]});
 await page.addInitScript(({mode,token})=>{
  const w=window as any,c=w.Capacitor,previous=c.nativePromise;let archived=false;
  const calls=w.recoveryCalls={starts:0,reviews:0,archives:[] as unknown[]};
  c.PluginHeaders.find((p:any)=>p.name==='Agent').methods.push(...['reviewRecovery','archiveRecovery'].map(name=>({name,rtype:'promise'})));
  c.nativePromise=async(p:string,m:string,input:any)=>{
   if(p==='Agent'&&m==='start'){
    calls.starts++;
    if(!archived&&(mode!=='transient'||calls.starts===1))throw Object.assign(Error('Native startup refused'),{code:mode==='transient'?'temporary-start-failure':'ipc-recovery-retention-limit'});
   }
   if(p==='Agent'&&m==='reviewRecovery'){calls.reviews++;return mode==='review-unavailable'?{status:'unavailable',retainedCount:8,reason:'inventory-unavailable'}:{status:'reviewable',retainedCount:8,reviewToken:token};}
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
 if(signedOut){const gate=page.getByRole('main',{name:'Sign in',exact:true});await expect(gate).toBeVisible();return gate;}
 await expect(button(page,'Settings')).toBeVisible();await completeAccessSetup(page);await button(page,'Settings').click();await page.getByRole('button',{name:'Agent',exact:true}).click();
 const panel=page.getByRole('region',{name:'Settings',exact:true});await expect(panel.getByRole('heading',{name:'Agent',exact:true})).toBeVisible();return panel;
}
const calls=(page:Page)=>page.evaluate(()=>(window as any).recoveryCalls as {starts:number;reviews:number;archives:unknown[]});
test('recovery review is explicit and cancelling preserves the block without archival or another start',async({page},testInfo)=>{
 const dialog=await boot(page);await expect(dialog.getByText('Recovery review needed',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Retry',exact:true})).toHaveCount(0);
 expect(await calls(page)).toEqual({starts:1,reviews:0,archives:[]});await dialog.getByRole('button',{name:'Review recovery',exact:true}).click();
 await expect(dialog.getByText('Alpha will keep 8 old startup records, then restart your agent.',{exact:true})).toBeVisible();await page.screenshot({path:testInfo.outputPath('recovery-review.png'),fullPage:true});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Keep records and restart',exact:true})).toHaveCount(0);expect(await calls(page)).toEqual({starts:1,reviews:1,archives:[]});
});
test('only confirmed complete archival dispatches one ordinary start and retains the Cloud credential',async({page})=>{
 const dialog=await boot(page);const key=await harness(page,f=>f.slots['cloud:production']);await dialog.getByRole('button',{name:'Review recovery',exact:true}).click();await dialog.getByRole('button',{name:'Keep records and restart',exact:true}).click();
 await expect.poll(()=>calls(page)).toEqual({starts:2,reviews:1,archives:[{reviewToken:token}]});await expect(dialog.getByRole('button',{name:'Reconnect agent',exact:true})).toBeVisible();
 expect(await harness(page,f=>f.slots['cloud:production'])).toBe(key);expect(await harness(page,f=>f.streams)).toBe(0);await expect(page.getByRole('region',{name:'Settings',exact:true})).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));await expect(button(page,'Notes')).toBeVisible();
});
test('unavailable native inventory cannot expose confirmation or start the agent',async({page})=>{
 const dialog=await boot(page,'review-unavailable');await dialog.getByRole('button',{name:'Review recovery',exact:true}).click();await expect(dialog.getByText('Recovery could not be checked. Your records were kept. Review again later.',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Keep records and restart',exact:true})).toHaveCount(0);expect(await calls(page)).toEqual({starts:1,reviews:1,archives:[]});
});
for(const mode of ['changed','partial'] as const)test(`${mode} archival keeps recovery blocked and requires a fresh review`,async({page})=>{
 const dialog=await boot(page,mode);await dialog.getByRole('button',{name:'Review recovery',exact:true}).click();await dialog.getByRole('button',{name:'Keep records and restart',exact:true}).click();await expect(dialog.getByRole('button',{name:'Review recovery',exact:true})).toBeEnabled();await expect(dialog.getByText('Recovery review needed',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Keep records and restart',exact:true})).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Retry',exact:true})).toHaveCount(0);expect(await calls(page)).toEqual({starts:1,reviews:1,archives:[{reviewToken:token}]});
});
test('ordinary transient startup failure retains normal Retry without recovery operations',async({page})=>{
 const dialog=await boot(page,'transient');await expect(dialog.getByRole('button',{name:'Review recovery',exact:true})).toHaveCount(0);await dialog.getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>calls(page)).toEqual({starts:2,reviews:0,archives:[]});await expect(dialog.getByRole('button',{name:'Reconnect agent',exact:true})).toBeVisible();
});

test('a signed-out startup refusal keeps recovery review reachable on the mandatory sign-in page',async({page})=>{
 const gate=await boot(page,'success',true);
 await expect(gate.getByRole('form',{name:'Sign in with email or phone'})).toHaveCount(0);
 await gate.getByRole('button',{name:'Review recovery',exact:true}).click();
 await expect(gate.getByText('Alpha will keep 8 old startup records, then restart your agent.',{exact:true})).toBeVisible();
 await gate.getByRole('button',{name:'Cancel',exact:true}).click();
 expect(await calls(page)).toEqual({starts:1,reviews:1,archives:[]});
 await expect(gate.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();
 expect(await harness(page,f=>f.slots['cloud:production']??null)).toBeNull();
});

test('signed-out recovery stays reachable after backing out of sign-in or cancelling a code',async({page})=>{
 const gate=await boot(page,'success',true);
 await expect(gate.getByRole('button',{name:'Review recovery',exact:true})).toBeVisible();
 await gate.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(gate.getByRole('form',{name:'Sign in with email or phone'})).toBeVisible();
 await gate.getByRole('button',{name:'Back',exact:true}).click();
 await expect(gate.getByRole('button',{name:'Review recovery',exact:true})).toBeVisible();
 await expect(gate.getByRole('form',{name:'Sign in with email or phone'})).toHaveCount(0);

 await gate.getByRole('button',{name:'Sign in',exact:true}).click();
 await gate.getByRole('textbox',{name:/^Email( or phone number)?$/}).fill('recovery@example.invalid');
 await gate.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(gate.getByRole('form',{name:'Enter your email code'})).toBeVisible();
 // Back from the code step returns to the methods (to fix a mistyped address); Back again leaves.
 await gate.getByRole('button',{name:'Back',exact:true}).click();
 await expect(gate.getByRole('form',{name:'Sign in with email or phone'})).toBeVisible();
 await expect(gate.getByRole('textbox',{name:/^Email( or phone number)?$/})).toBeEnabled();
 await gate.getByRole('button',{name:'Back',exact:true}).click();
 await expect(gate.getByRole('button',{name:'Review recovery',exact:true})).toBeVisible();
 await expect(gate.getByRole('form',{name:'Enter your email code'})).toHaveCount(0);
 expect((await calls(page)).reviews).toBe(0);expect((await calls(page)).archives).toEqual([]);
 expect(await harness(page,f=>f.slots['cloud:production']??null)).toBeNull();
});

// UI progress only: this feature fixture does not manufacture OS/provider grants.
test.beforeEach(async({page})=>seedCompletedAccessSetup(page));
