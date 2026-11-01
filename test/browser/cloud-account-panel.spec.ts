// Hosted/CLI behavior is test-mocks-only diagnostic coverage. Enter that explicit controller
// route; the production sign-in button uses native email and never falls back to this route.
import {seedCompletedAccessSetup} from './flag-off-android';
import {test,expect,type Page} from '@playwright/test';
async function openInbox(page:Page){await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByRole('button',{name:'Connect Eliza Cloud',exact:true}).click();}
// Signed out, an explicit account entry (Inbox Connect Eliza Cloud, Settings Manage Cloud account) is Alpha's
// sign-in screen (explicitSignedOutCloudEntry); signed in, it is the approved Subscription sheet (H-37).
const signInDialog=(page:Page)=>page.getByRole('dialog',{name:'Welcome to Alpha.',exact:true});
const membershipSheet=(page:Page)=>page.getByRole('dialog',{name:'Subscription',exact:true});
async function fixture(page:Page){
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));const f=(window as any).accountPanelFixture={paths:[],external:[],secure:{},remotePaths:[],agentSends:0,room:'owned-thread',rows:[],user:'11111111-1111-4111-8111-111111111111',email:'verified-owner@example.invalid'};
  const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
  (window as any).Capacitor={PluginHeaders:[{name:'AlphaConnection',methods:methods(['request','cancel','secureRead','secureWrite','secureRemove','openExternal'])}],nativePromise:async(plugin:string,method:string,input:any)=>{
   if(plugin!=='AlphaConnection')throw Error('Unexpected fixture native plugin');
   if(method==='secureRead')return {value:f.secure[input.slot]??null};if(method==='secureWrite'){f.secure[input.slot]=input.value;return {};}if(method==='secureRemove'){delete f.secure[input.slot];return {};}if(method==='cancel')return {};if(method==='openExternal'){f.external.push(input);return {};}
   const url=new URL(input.url),path=url.pathname;
   if(url.hostname==='qa-agent.invalid'){
    f.remotePaths.push(path);const token='synthetic-remote-token',owner='remote-owner';const data=(body:any,status=200)=>({status,data:body});
    if(path==='/api/auth/status')return data({required:true,authenticated:false,pairingEnabled:true,bootstrapRequired:false,instanceId:'owned-instance',expiresAt:null});
    if(path==='/api/auth/pair')return data({token,identityId:owner,access:'owner',instanceId:'owned-instance'});
    if(input.headers.Authorization!=='Bearer '+token)throw Error('Unverified synthetic remote owner');
    if(path==='/api/auth/me')return data({identity:{id:owner,displayName:'Owned fixture',kind:'owner'},session:{id:token,kind:'machine',expiresAt:Date.now()+600000},access:{role:'OWNER',mode:'session'}});
    if(path==='/api/agents')return data({agents:[{id:'33333333-3333-4333-8333-333333333333',name:'Owned QA agent',status:'running'}]});
    if(path==='/api/conversations')return data(input.method==='POST'?{conversation:{id:f.room,title:'Owned history'}}:{conversations:[{id:f.room,title:'Owned history'}]});
    if(path==='/api/conversations/'+f.room+'/messages'){if(input.method==='POST'){const body=JSON.parse(input.body);f.agentSends++;f.rows=[{id:'66666666-6666-4666-8666-666666666666',role:'user',text:body.text},{id:'77777777-7777-4777-8777-777777777777',role:'assistant',text:'Retained answer'}];return data({text:'Retained answer',agentName:'Owned QA agent',userMessageId:f.rows[0].id,messageId:f.rows[1].id});}return data({messages:f.rows});}
    return data({},404);
   }
   f.paths.push(path);const login='55555555-5555-4555-8555-555555555555';
   if(path==='/api/auth/cli-session')return {status:200,data:{sessionId:login,expiresAt:new Date(Date.now()+60000).toISOString()}};
   if(path==='/api/auth/cli-session/'+login)return {status:200,data:{status:'authenticated',token:'synthetic-account-token',expiresAt:new Date(Date.now()+600000).toISOString()}};
   if(input.headers.Authorization!=='Bearer synthetic-account-token')throw Error('Unverified fixture account');
   if(path==='/api/v1/user')return {status:200,data:{success:true,data:{id:f.user,email:f.email}}};
   if(path.includes('/google/')&&path.endsWith('/accounts'))return {status:200,data:{success:true,data:[]}};
   throw Error('Unexpected Cloud fixture request: '+path);
  }};
 });await page.goto('/');
}
async function retainedAgent(page:Page){
 await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.pair('remote','https://qa-agent.invalid','synthetic-code'); });const composer=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await composer.fill('Keep this conversation');await composer.press('Enter');await expect(page.getByText('Retained answer',{exact:true})).toBeVisible();await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.restoreHistory((window as any).accountPanelFixture.room);(window as any).accountPanelBaseline={session:structuredClone(c.getSnapshot().session),history:structuredClone(c.getSnapshot().history),selection:localStorage.getItem('alpha.connection.selection.v1')};});await page.getByRole('button',{name:'Minimize chat',exact:true}).click();
}
test('Inbox opens focused account sign-in directly, without agent hosting or requests',async({page},info)=>{
 await fixture(page);await openInbox(page);const account=signInDialog(page);await expect(account.getByRole('form',{name:'Sign in with email'})).toBeVisible();await expect(account.getByRole('button',{name:'Back',exact:true})).toBeVisible();await expect(account.getByRole('combobox',{name:'Environment'})).toHaveCount(0);for(const text of ['Your agent.','Your phone.','Remote agent','Refresh agent status','Dedicated hosting review'])await expect(account.getByText(text,{exact:true})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).accountPanelFixture.paths)).toEqual([]);await page.screenshot({path:'test-results/cloud-account-panel/cloud-account-sign-in.png',animations:'disabled'});await account.getByRole('button',{name:'Back',exact:true}).click();await expect(account).toHaveCount(0);await expect(page.locator('html')).toHaveAttribute('data-active-view','inbox');expect(await page.evaluate(()=>(window as any).accountPanelFixture.paths)).toEqual([]);
});
test('opening and closing account settings preserves connected agent, exact history and saved selection',async({page})=>{
 await fixture(page);await retainedAgent(page);await openInbox(page);await signInDialog(page).getByRole('button',{name:'Back',exact:true}).click();await expect(signInDialog(page)).toHaveCount(0);const result=await page.evaluate(async()=>{const c=(await import('/src/runtime/connection-ui.tsx')).connectionController;return {before:(window as any).accountPanelBaseline,after:{session:c.getSnapshot().session,history:c.getSnapshot().history,selection:localStorage.getItem('alpha.connection.selection.v1')},account:c.getSnapshot().cloudAccount,sends:(window as any).accountPanelFixture.agentSends};});expect(result.after).toEqual(result.before);expect(result.account).toBeNull();expect(result.sends).toBe(1);
});
test('account-only sign-in verifies actual email and skips hosted agent discovery or provisioning',async({page},info)=>{
 await fixture(page);await retainedAgent(page);await openInbox(page);await expect(signInDialog(page)).toBeVisible();const account=membershipSheet(page);await page.evaluate(async()=>{const {connectionController}=await import('/src/runtime/connection-ui.tsx');void connectionController.signInBrowser();});
 // An existing account signing in on a completed install keeps that install: no Ready popup (only a newly
 // created account gets one, startup-permission-completion.test.mjs), and the sign-in screen closes.
 await expect.poll(()=>page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot().cloudAccount?.email)).toBe('verified-owner@example.invalid');
 const setup=page.locator('dialog.alpha-startup-permissions');await expect(signInDialog(page)).toHaveCount(0);await expect(setup).toHaveCount(0);
 await expect(page.locator('html')).toHaveAttribute('data-active-view','inbox');await page.getByRole('button',{name:'Back to apps',exact:true}).click();
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Accounts',exact:true}).click();await page.getByRole('button',{name:'Manage Cloud account',exact:true}).click();await expect(account.getByRole('region',{name:'Subscription',exact:true}).getByText('verified-owner@example.invalid',{exact:true})).toBeVisible();await expect(account.getByRole('button',{name:'Use another account',exact:true})).toBeVisible();await expect(account.getByRole('button',{name:'Sign in',exact:true})).toHaveCount(0);await expect(signInDialog(page)).toHaveCount(0);const result=await page.evaluate(async()=>{const c=(await import('/src/runtime/connection-ui.tsx')).connectionController;return {paths:(window as any).accountPanelFixture.paths,before:(window as any).accountPanelBaseline,after:{session:c.getSnapshot().session,history:c.getSnapshot().history,selection:localStorage.getItem('alpha.connection.selection.v1')},account:c.getSnapshot().cloudAccount};});expect(result.after).toEqual(result.before);expect(result.account?.email).toBe('verified-owner@example.invalid');expect(result.paths).not.toContain('/api/v1/eliza/personal');expect(result.paths.some((p:string)=>p.includes('upgrade-tier')||p.includes('/agents'))).toBe(false);await page.screenshot({path:'test-results/cloud-account-panel/cloud-account-connected.png',animations:'disabled'});
});
test('Settings Manage Cloud account opens the same focused panel and restores keyboard focus',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Accounts',exact:true}).click();const entry=page.getByRole('button',{name:'Manage Cloud account',exact:true});await entry.focus();await entry.press('Enter');const account=signInDialog(page);await expect(account).toBeVisible();await expect(account.getByRole('form',{name:'Sign in with email'})).toBeVisible();await page.keyboard.press('Escape');await expect(account).toHaveCount(0);await expect(entry).toBeFocused();expect(await page.evaluate(()=>(window as any).accountPanelFixture.paths)).toEqual([]);
});

test.beforeEach(async({page})=>seedCompletedAccessSetup(page));
