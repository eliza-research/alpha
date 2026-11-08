import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {tsImport} from 'tsx/esm/api';
// Targets resolve through Alpha's product view registry (canonical ids, served ids, availability).
const {alphaCanonicalViewId,alphaViewKey,alphaViewPaths}=await tsImport('../apps/app/src/product/alpha-product.ts',import.meta.url);
const paths=['.eliza/client-features/packages/core/src/events.ts','.eliza/client-features/packages/core/src/views/view-interact-protocol.ts','.eliza/client-features/packages/core/src/views/view-action-handoff.ts','.eliza/client-features/packages/core/src/views/completed-action-navigation.ts','apps/app/src/runtime/view-navigation.ts'];
const source=paths.map(path=>stripTypeScriptTypes(readFileSync(path,'utf8'),{mode:'transform'}).replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,'')).join('\n');
function fixture(){const window=new EventTarget();const context=vm.createContext({alphaCanonicalViewId,alphaViewKey,alphaViewPaths,window,document:{hidden:false},crypto:webcrypto,structuredClone,AbortController,AbortSignal,DOMException,Event,CustomEvent,URL,console,localStorage:{getItem(){return null}},setTimeout,clearTimeout});vm.runInContext('class AlphaClientError extends Error{};const browserDevProfile=false;const Capacitor={getPlatform:()=>"web",PluginHeaders:[]};const TELEPHONY_PROFILE_METHOD="imageCapability";const detectTelephonyProfile=()=>false;'+source+';globalThis.Client=ViewNavigationClient;',context);return context;}
for(const [id,target] of [['chat','home'],['inbox','inbox'],['calendar','calendar'],['browser','browser'],['camera','camera'],['photos','photos'],['maps','maps'],['notes','notes'],['files','files'],['automations','workflows'],['settings','settings']])test('agent navigation reaches Home destination '+target,async()=>{const c=fixture();let state={view:'home',revision:1,sensitive:false};const calls=[];const client=new c.Client(async(path,body)=>{calls.push({path,body});return path.endsWith('claim')?{claimId:'owned'}:{ok:true,accepted:true};},()=>true,()=>state);const binding={requestId:'owned-handoff',clientId:client.clientId,viewId:id,viewType:'gui',installationId:'owned-installation'};const attempt=client.capture(state);let navigated;const result=await client.deliver([{actionName:'VIEWS',success:true,values:{mode:'show',viewId:id,viewPath:'/'+id,viewType:'gui',navigationPrepared:true,completedActionHandoffId:'owned-handoff',navigationBinding:binding}}],attempt,async(view,current)=>{current();navigated=view;state={view,revision:2,sensitive:false};return true;});assert.equal(navigated,target);assert.equal(result.status,'delivered');assert.equal(calls.length,2);client.dispose();});

test('completed-action navigation remains usable after optional renderer subscription fails',async()=>{
 const c=fixture();let state={view:'home',revision:1,sensitive:false};const requests=[];
 const client=new c.Client(async(path,body)=>{requests.push({path,body});return path.endsWith('claim')?{claimId:'owned'}:{accepted:true};},()=>true,()=>state,()=>({ready:Promise.reject(Error('Optional native subscription unavailable')),close(){}}));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(client.interactionAvailable(),false);
 const binding={requestId:'fallback-handoff',clientId:client.clientId,viewId:'notes',viewType:'gui',installationId:'owned-installation'};
 const result=await client.deliver([{actionName:'VIEWS',success:true,values:{mode:'show',viewId:'notes',viewPath:'/notes',viewType:'gui',navigationPrepared:true,completedActionHandoffId:binding.requestId,navigationBinding:binding}}],client.capture(state),async(view,current)=>{current();state={view,revision:2,sensitive:false};return true;});
 assert.equal(result.status,'delivered');assert.equal(state.view,'notes');assert.equal(requests.length,2);client.dispose();
});

// Older ids keep the paths they were accepted with before the shared registry; canonical paths
// stay the emitted form. A path naming another view, or an unknown id, is refused before any claim.
async function handoff(id,viewPath){const c=fixture();let state={view:'home',revision:1,sensitive:false};const calls=[];const client=new c.Client(async(path,body)=>{calls.push({path,body});return path.endsWith('claim')?{claimId:'owned'}:{ok:true,accepted:true};},()=>true,()=>state);const binding={requestId:'owned-handoff',clientId:client.clientId,viewId:id,viewType:'gui',installationId:'owned-installation'};let navigated;try{const result=await client.deliver([{actionName:'VIEWS',success:true,values:{mode:'show',viewId:id,viewPath,viewType:'gui',navigationPrepared:true,completedActionHandoffId:'owned-handoff',navigationBinding:binding}}],client.capture(state),async(view,current)=>{current();navigated=view;state={view,revision:2,sensitive:false};return true;});return{result,navigated,calls};}catch(error){return{error,navigated,calls};}finally{client.dispose();}}
for(const [id,viewPath,target] of [['workflows','/workflows','workflows'],['workflows','/apps/workflows','workflows'],['workflows','/automations','workflows'],['home','/home','home'],['home','/apps/home','home'],['home','/','home'],['chat','/chat','home'],['reminders','/reminders','calendar']])test(`agent navigation accepts older handoff ${id} at ${viewPath}`,async()=>{const r=await handoff(id,viewPath);assert.equal(r.error,undefined,String(r.error));assert.equal(r.result.status,'delivered');assert.equal(r.navigated,target);assert.equal(r.calls.length,2);});
for(const [id,viewPath] of [['workflows','/calendar'],['automations','/workflows'],['home','/notes'],['chat','/home'],['unknown-view','/unknown-view'],['unknown-view','/apps/unknown-view']])test(`agent navigation refuses mismatched or unknown handoff ${id} at ${viewPath}`,async()=>{const r=await handoff(id,viewPath);assert.ok(r.error||r.result?.status!=='delivered');assert.equal(r.navigated,undefined);assert.equal(r.calls.length,0);});
test('alpha view paths keep older aliases and give unknown ids none',()=>{
 assert.deepEqual(alphaViewPaths('automations'),['/automations','/apps/automations']);
 for(const path of ['/automations','/apps/automations','/workflows','/apps/workflows'])assert.ok(alphaViewPaths('workflows').includes(path),path);
 for(const path of ['/chat','/','/home','/apps/home'])assert.ok(alphaViewPaths('home').includes(path),path);
 assert.equal(alphaViewPaths('chat').includes('/home'),false);
 assert.deepEqual(alphaViewPaths('unknown-view'),[]);
});
