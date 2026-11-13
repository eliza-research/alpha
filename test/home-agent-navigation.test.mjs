import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {tsImport} from './support/ts-import.mjs';
// Targets resolve through Alpha's product view registry (canonical ids, served ids, availability).
const {alphaCanonicalViewId,alphaViewKey,alphaViewPaths}=await tsImport('../apps/app/src/product/alpha-product.ts',import.meta.url);
const paths=['.eliza/client-features/packages/core/src/events.ts','.eliza/client-features/packages/core/src/views/view-interact-protocol.ts','.eliza/client-features/packages/core/src/views/view-action-handoff.ts','.eliza/client-features/packages/core/src/views/completed-action-navigation.ts','apps/app/src/runtime/view-navigation.ts'];
const source=paths.map(path=>stripTypeScriptTypes(readFileSync(path,'utf8'),{mode:'strip'}).replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,'')).join('\n');
function fixture(){const window=new EventTarget();const context=vm.createContext({alphaCanonicalViewId,alphaViewKey,alphaViewPaths,window,document:{hidden:false},crypto:webcrypto,structuredClone,AbortController,AbortSignal,DOMException,Event,CustomEvent,URL,console,localStorage:{getItem(){return null}},setTimeout,clearTimeout});vm.runInContext('class AlphaClientError extends Error{};const browserDevProfile=false;const Capacitor={getPlatform:()=>"web",PluginHeaders:[]};const TELEPHONY_PROFILE_METHOD="imageCapability";const detectTelephonyProfile=()=>false;'+source+';globalThis.Client=ViewNavigationClient;',context);return context;}


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


test('alpha view paths keep older aliases and give unknown ids none',()=>{
 assert.deepEqual(alphaViewPaths('automations'),['/automations','/apps/automations']);
 for(const path of ['/automations','/apps/automations','/workflows','/apps/workflows'])assert.ok(alphaViewPaths('workflows').includes(path),path);
 for(const path of ['/chat','/','/home','/apps/home'])assert.ok(alphaViewPaths('home').includes(path),path);
 assert.equal(alphaViewPaths('chat').includes('/home'),false);
 assert.deepEqual(alphaViewPaths('unknown-view'),[]);
});
