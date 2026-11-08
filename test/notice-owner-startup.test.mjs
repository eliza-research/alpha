import * as residentRecovery from '../apps/app/src/runtime/resident-recovery.ts';
import {resolveCloudEnvironment} from '../apps/app/src/runtime/cloud-environment-selection.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {EntitlementError} from '../apps/app/src/runtime/subscription-entitlement.ts';
import * as cloudSignInModule from '../apps/app/src/runtime/cloud-sign-in.ts';
// The shared upstream coordinator (@elizaos/contracts/notice-routes), as the renderer imports it.
import {NoticeOwnerCoordinator} from '../.eliza/client-features/packages/contracts/src/notice-routes.ts';
const controllerSource=stripTypeScriptTypes(readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8').split('export function ConnectionChooser()')[0].replace(/\nfunction ResidentRecoveryPanel\([\s\S]*?\n}\n(?=export function productionCloudSignInRequired)/, '\n').replace(/^import .*;\n/gm,'').replace(/export /g,'').replaceAll('import.meta.env','fixtureViteEnv'),{mode:'transform'});
function fixture({offline=false,credential=null,fail=false}={}){
 let release;const read=new Promise(resolve=>release=resolve),transitions=[];
 const memory=new Map(offline?[['alpha.connection.selection.v1',JSON.stringify({kind:'offline',localApps:true})]]:[]);
 const box={NoticeOwnerCoordinator,privateLocalPreviewEnabled:false,browserCloudResidentEnabled:false,browserCloudResidentEnvironment:'production',...residentRecovery,resolveCloudEnvironment,fixtureViteEnv:{DEV:false},EntitlementError,...cloudSignInModule,cloudSignIn:undefined,cloudSignInGoogle:false,devSurfacesEnabled:false,devProfileQuery:false,testMocksEnabled:false,cloudSelfRevocationSupported:true,isAndroid:true,browserLocalAgentEnabled:false,registerPlugin:()=>({}),pauseHostedBackground:async()=>{},retireClockReviews:async()=>{},CloudProtocol:class{},nativeCloudRequest:()=>{throw Error('No provider request');},openConnectionBrowser:()=>{throw Error('No browser');},cloudCredentialStore:{read:async()=>{await read;return credential;}},localStorage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},URL,URLSearchParams,AbortController,DOMException,console,transitions,fail};
 // Only resident transport admission is synthetic. Real initialize/work/update/subscribe and the
 // real coordinator run together; no live credential or provider is involved.
 vm.runInNewContext(controllerSource+`\nconnectResident=async()=>{await cloudCredentialStore.read();if(fail)throw Error('revoked');update({session:{sessionId:'A',origin:'https://a.invalid',ownerId:'A',agentId:'agent'}});};
 let queue=Promise.resolve();const notices=new NoticeOwnerCoordinator({transition:async s=>{transitions.push(s.owner?.ownerId??null);return{};},enqueue:work=>queue=queue.then(work),available:()=>true,restore:async()=>{}});
 const changed=()=>{const s=connectionController.getSnapshot(),a=s.session;notices.update({identity:a?.sessionId??'',owner:a?{origin:a.origin,ownerId:a.ownerId,agentId:a.agentId}:null,hasSession:!!a,startupResolved:s.startupResolved,busy:s.busy});};connectionController.subscribe(changed);changed();globalThis.controller=connectionController;globalThis.drain=()=>queue;`,box);
 return{...box,release,transitions,memory};
}
test('cold restoration keeps the old fence until the real controller resolves its identity',async()=>{
 const f=fixture({credential:{credentialId:'synthetic'}}),pending=f.controller.initialize();await Promise.resolve();assert.deepEqual(f.transitions,[]);assert.equal(f.controller.getSnapshot().startupResolved,false);
 f.release();await pending;await f.drain();assert.deepEqual(f.transitions,['A']);assert.equal(f.controller.getSnapshot().startupResolved,true);
 await f.controller.initialize();await f.drain();assert.deepEqual(f.transitions,['A'],'settled initialize does not repeat the fence');
});
// The on-device agent always runs (P-43): a phone with no sign-in still starts it, so its owner is
// fenced in exactly like a signed-in restoration.
test('cold start without a sign-in still starts the agent and fences in its owner',async()=>{
 const f=fixture({}),pending=f.controller.initialize();await Promise.resolve();assert.deepEqual(f.transitions,[]);f.release();await pending;await f.drain();assert.deepEqual(f.transitions,['A']);assert.equal(f.controller.getSnapshot().startupResolved,true);
});
test('cold retired local-only choice migrates to the resident and starts it with the kept sign-in',async()=>{
 const f=fixture({offline:true,credential:{credentialId:'kept'}}),pending=f.controller.initialize();await Promise.resolve();assert.deepEqual(f.transitions,[]);f.release();await pending;await f.drain();
 assert.deepEqual(f.transitions,['A']);
 assert.deepEqual(JSON.parse(f.memory.get('alpha.connection.selection.v1')),{kind:'resident'},'only the retired preference is replaced');
});
for(const [name,options] of [['failed start',{credential:{credentialId:'revoked'},fail:true}]])test('cold '+name+' retires the persisted owner after initialization settles',async()=>{
 const f=fixture(options),pending=f.controller.initialize();await Promise.resolve();assert.deepEqual(f.transitions,[]);f.release();await pending;await f.drain();assert.deepEqual(f.transitions,[null]);assert.equal(f.controller.getSnapshot().session,null);assert.equal(f.controller.getSnapshot().startupResolved,true);
});

test('reconnects retire the session while busy, and the notice owner update carries that state',async()=>{
 // The real controller marks the connection busy before Continue / Check plan again / pairing
 // retires the session; the coordinator (tested directly) defers a null owner until it settles.
 const controller=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8'),adapter=readFileSync('apps/app/src/prototype/workflow-adapter.ts','utf8');
 assert.match(controller,/update\(\{ busy: true, \.\.\.\(background \? \{\} : \{ open: true \}\), message, error: preserveError \? state\.error : '' \}\);\s*try \{ await action\(controller\.signal\); \}/);
 assert.match(controller,/async startLocal\(\) \{ if\(state\.residentRecoveryReason\)\{update\(\{open:true,purpose:'agent',error:residentRecoveryMessage\(state\.residentRecoveryReason\)\}\);return;\} if \(residentAlwaysPresent\) \{ if \(!operation\) \{ retire\(\); await startResident\('Starting the local agent…', false\); \} return; \} await work\('Starting the local agent…', signal => \{ retire\(\);/);
 assert.match(adapter,/startupResolved:connectionController\.getSnapshot\(\)\.startupResolved,busy:connectionController\.getSnapshot\(\)\.busy\}\)/);
});
