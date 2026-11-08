import {test,expect} from '@playwright/test';
import {returnToApps} from './app-navigation';

// Actual shell, controller, navigation acknowledgement, action journal and camera adapter.
// HTTP provider and camera sensor are synthetic; this is not a device acceptance test.
for(const mode of ['capture','lost-ack','old-message','ask-first'] as const)test(`Home camera request: ${mode}`,async({page})=>{
 await page.addInitScript(mode=>{
  const w=window as any,store=new Map(),agentId='12345678-1234-4234-8234-123456789abc',userMessageId='87654321-4321-4321-8321-cba987654321';
  const f=w.cameraRequestFixture={posts:0,captures:0,claims:0,acks:0,decisions:0,receipts:[],proposal:null as any,entry:null as any};
  const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
  w.Capacitor={PluginHeaders:[{name:'AlphaConnection',methods:methods(['request','cancel','secureRead','secureWrite','secureCompareExchange','secureRemove'])},{name:'AlphaActionJournal',methods:methods(['reserve','markApplying','finish','get','list'])}],nativePromise:async(plugin:string,method:string,input:any)=>{
   if(plugin==='AlphaActionJournal'){
    if(method==='reserve'){f.entry={...input,phase:'reserved'};return{created:true,entry:f.entry};}
    if(method==='markApplying'){Object.assign(f.entry,{phase:'applying',attemptId:input.attemptId});return{};}
    if(method==='finish'){Object.assign(f.entry,input,{phase:'terminal'});return{};}
    if(method==='get')return{entry:f.entry};
    if(method==='list')return{entries:f.entry?[f.entry]:[]};
   }
   if(plugin!=='AlphaConnection')throw Error('Unexpected native effect');
   if(method==='secureRead')return{value:store.get(input.slot)??null};
   if(method==='secureWrite'){store.set(input.slot,input.value);return{};}
   if(method==='secureRemove'){store.delete(input.slot);return{};}
   if(method==='secureCompareExchange'){if((store.get(input.slot)??null)!==input.expectedValue)return{status:'conflict'};if(input.value===null)store.delete(input.slot);else store.set(input.slot,input.value);return{status:'saved'};}
   if(method==='cancel')return{};
   const path=new URL(input.url).pathname,body=input.body?JSON.parse(input.body):{},ok=(data:any)=>({status:200,data});
   if(path==='/api/auth/status')return ok({required:true,authenticated:false,pairingEnabled:true,bootstrapRequired:false,instanceId:'camera-fixture',expiresAt:Date.now()+60000});
   if(path==='/api/auth/pair')return ok({token:'synthetic-session',identityId:'fixture-owner',access:'owner',instanceId:'camera-fixture'});
   if(path==='/api/auth/me')return ok({identity:{id:'fixture-owner',displayName:'Fixture',kind:'owner'},session:{id:'synthetic-session',kind:'machine',expiresAt:Date.now()+600000},access:{role:'OWNER',mode:'session'}});
   if(path==='/api/agents')return ok({agents:[{id:agentId,name:'Camera fixture',status:'running'}]});
   if(path==='/api/client-devices/register'){w.cameraInstallation=input.headers['X-Eliza-Device-Id'];return ok({installationId:w.cameraInstallation,enrollmentId:'camera-enrollment',capabilities:['camera.capture-photo.v1']});}
   if(path==='/api/workflow/status')return ok({});
   if(path==='/api/conversations'&&input.method==='POST')return ok({conversation:{id:'camera-chat',title:'Fixture'}});
   if(path==='/api/conversations/camera-chat/messages'&&input.method==='POST'){
    f.posts++;
    f.proposal={id:'camera-proposal',digest:'a'.repeat(64),state:'pending',expiresAt:new Date(Date.now()+600000).toISOString(),subjectUserId:'fixture-owner',requestedBy:agentId,action:'device_action',payload:{action:'device_action',version:1,installationId:w.cameraInstallation,enrollmentId:'camera-enrollment',operation:{type:'camera_capture_photo'},requestMessageId:mode==='old-message'?'old-message':userMessageId}};
    return ok({text:'Opening Camera.',agentName:'Camera fixture',userMessageId,actionResults:[{actionName:'VIEWS_SHOW',success:true,values:{mode:'show',viewId:'camera',viewPath:'/camera',viewType:'gui',completedActionDelivered:false,completedActionHandoffId:'camera-handoff',navigationPrepared:true,navigationBinding:{requestId:'camera-handoff',clientId:body.metadata.viewClientId,viewId:'camera',viewType:'gui',installationId:w.cameraInstallation}}}]});
   }
   if(path==='/api/views/interact-claim'){f.claims++;return ok({claimId:'camera-owned-claim'});}
   if(path==='/api/views/interact-result'){f.acks++;return ok({accepted:mode!=='lost-ack'});}
   if(path==='/api/client-devices/proposals')return ok({proposals:f.proposal?[f.proposal]:[]});
   if(path.startsWith('/api/client-devices/proposals/camera-proposal/')){
    if(body.digest!==f.proposal.digest)throw Error('Digest changed');
    if(path.endsWith('/decision')){f.decisions++;f.proposal.state='approved';}
    if(path.endsWith('/claim')){f.proposal.state='executing';f.proposal.execution={attemptId:'camera-attempt'};}
    if(path.endsWith('/receipt')){f.receipts.push(body.receipt);f.proposal.state='succeeded';}
    return ok({proposal:f.proposal,digest:f.proposal.digest});
   }
   throw Error('Unexpected fixture route '+path);
  }};
 },mode);
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 await page.getByText('Local development agent',{exact:true}).click();
 const local=page.locator('.alpha-connection details').filter({has:page.getByText('Local development agent',{exact:true})});
 await local.getByLabel('Local agent address').fill('http://127.0.0.1:47842');
 await local.getByLabel('Pairing code',{exact:true}).fill('synthetic-code');
 await local.getByRole('button',{name:'Connect local agent',exact:true}).click();
 await page.locator('.alpha-connection-scrim').waitFor({state:'detached'});
 await page.evaluate(async mode=>{
  const {browserCamera}=await import('/src/prototype/browser-camera.ts');
  browserCamera.startPreview=async()=>({width:16,height:16,deviceId:'fixture'});
  browserCamera.stopPreview=async()=>{};
  browserCamera.capturePhoto=async()=>{const f=(window as any).cameraRequestFixture;f.captures++;const c=document.createElement('canvas');c.width=c.height=16;return{path:'browser-photo:///1792274767123123456789012',format:'jpeg',base64:c.toDataURL('image/jpeg').split(',')[1],width:16,height:16};};
  if(mode==='ask-first'){const {editDevicePreferences}=await import('/src/browser/device-preferences.ts');await editDevicePreferences(state=>{state.askBeforeAgentActions=true;});}
 },mode);
 await returnToApps(page);
 const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.fill('Take a photo');await input.press('Enter');
 await expect.poll(()=>page.evaluate(()=>(window as any).cameraRequestFixture.acks)).toBe(1);
 await expect(page.getByRole('button',{name:'Stop reply',exact:true})).toHaveCount(0);
 if(mode==='capture'){
  await expect.poll(()=>page.evaluate(()=>(window as any).cameraRequestFixture.receipts.length)).toBe(1);
  const f=await page.evaluate(()=>(window as any).cameraRequestFixture);expect(f.captures).toBe(1);expect(f.receipts[0].outcome).toBe('applied');expect(f.receipts[0].result.mediaId).toBe('1792274767123123456789012');expect(JSON.stringify(f.receipts)).not.toContain('base64');
  await expect(page.getByText('Photo saved in Photos.',{exact:true})).toHaveCount(1);
  await expect(page.getByText('Take photo: Open Camera to take the requested photo.',{exact:true})).toHaveCount(0);
 }else{
  await expect(page.getByText('Opening Camera.',{exact:true}).first()).toBeVisible();
  const f=await page.evaluate(()=>(window as any).cameraRequestFixture);expect(f.captures).toBe(0);expect(f.decisions).toBe(0);
 }
});
