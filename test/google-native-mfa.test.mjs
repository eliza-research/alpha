import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {googleOutcome} from '../apps/app/src/runtime/cloud-sign-in.ts';

const attemptId='12345678-1234-1234-1234-123456789abc';
const required=()=>({status:'mfa',method:'totp',expiresAt:Date.now()+60000,attemptId,environment:'production'});
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function method(source,start,end){const from=source.indexOf(start),to=source.indexOf(end,from);assert.ok(from>=0&&to>from);return source.slice(from,to);}

test('Google MFA outcome is bound to the native attempt and environment, with no credential or challenge disclosure',()=>{
 const outcome=required();assert.deepEqual(googleOutcome(outcome,'production'),outcome);
 for(const patch of [{attemptId:undefined},{attemptId:'---'},{environment:'staging'},{method:'unknown'},{challengeId:'server-secret'},{token:'secret'},{expiresAt:0}]) {
  assert.throws(()=>googleOutcome({...required(),...patch},'production'));
 }
 assert.throws(()=>googleOutcome({...required(),expiresAt:Date.now()-1},'production'),error=>error.code==='expired');
});

test('Google protocol requests a native second factor without requiring or accepting a stored Cloud credential',async()=>{
 const source=read('apps/app/src/runtime/cloud-protocol.ts');
 const code=method(source,'  async signInWithGoogle(','  /** Sends a six-digit code');
 const compiled=transformSync('const client={'+code+'};',{loader:'ts'}).code;
 const client=new Function('googleOutcome',compiled+'return client;')(googleOutcome);
 client.environment='production';
 let credentialChecks=0;
 client.storedSignIn=async result=>{credentialChecks++;return result;};
 client.signInStep=async(signal,run,parse)=>parse(await run({startGoogle:async input=>{assert.equal(input.environment,'production');return required();}}));
 assert.equal((await client.signInWithGoogle(new AbortController().signal)).status,'mfa');
 assert.equal(credentialChecks,0,'no sign-in or credential admission before MFA');
 const completed={status:'authenticated',environment:'production',expiresAt:Date.now()+60000,accountCreated:false};
 client.signInStep=async()=>completed;
 assert.deepEqual(await client.signInWithGoogle(new AbortController().signal),completed);
 assert.equal(credentialChecks,1,'a completed sign-in still requires the saved credential');
});

test('Google controller shows the native MFA panel and does not bind an account before verification',async()=>{
 const source=read('apps/app/src/runtime/connection-ui.tsx');
 const code=method(source,'  async signInGoogle() {','  /** Sends a six-digit code');
 const compiled=transformSync('const controller={'+code+'};',{loader:'ts'}).code;
 for(const outcome of [required(),{status:'authenticated',environment:'production',expiresAt:Date.now()+60000,accountCreated:false}]){
  let shown=0,signed=0,ensured=0;
  const run=new Function('state','work','update','signInClient','signInFailed','showGoogleMfa','signedIn','ensureResident',compiled+'return controller.signInGoogle();');
  await run({signIn:{step:'choose',environment:'production'}},async(_,fn)=>fn(new AbortController().signal),()=>{},()=>({signInWithGoogle:async()=>outcome}),()=>{},value=>{assert.equal(value.attemptId,attemptId);shown++;},async()=>{signed++;},async()=>{ensured++;});
  assert.equal(shown,outcome.status==='mfa'?1:0);assert.equal(signed,outcome.status==='mfa'?0:1);assert.equal(ensured,1);
 }
});

test('native Google and email share MFA admission; callback state custody remains native',()=>{
 const source=read('vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud/CloudSignInPlugin.java');
 const complete=method(source,' private void complete(Attempt current, JSONObject session)',' /** The saved key');
 assert.ok(complete.indexOf('session.opt("mfaRequired")')<complete.indexOf('session.optString("token"'),'MFA is handled before a token is required');
 assert.match(complete,/Math\.min\(current\.expiresAt, expiresAt\)/);
 assert.match(complete,/deadline <= System\.currentTimeMillis\(\)/);
 assert.match(complete,/if \(destroyed \|\| attempt != current \|\| current\.cancelled\)/,'destroyed, replaced and cancelled attempts cannot publish MFA');
 assert.match(complete,/if \(current\.mfaType != null\)/,'a second challenge cannot replace an active challenge');
 assert.match(complete,/notifyListeners\("signInMfaRequired", required, true\)/,'cold Google return retains only its nonsecret outcome');
 const verify=method(source,' private void verify(PluginCall call, boolean mfa)',' private void release(');
 assert.match(verify,/\(current\.google && !mfa\)/,'Google may verify MFA, never an email code');
 assert.match(verify,/!current\.id\.equals\(call\.getString\("attemptId"\)\)/);
 assert.match(verify,/current\.failedVerifies >= CloudSignInFlow\.MAX_VERIFY_ATTEMPTS/);
 assert.match(source,/owner\.expiresAt = pending\.expiresAt/,'Google MFA remains bounded by the original attempt');
});

test('Google MFA return revalidates retained events against the current native attempt before displaying them',async()=>{
 const source=read('apps/app/src/runtime/connection-ui.tsx');
 const code=method(source,'  async signInReturned(value: unknown) {','  /**\n   * A return reached Alpha');
 const compiled=transformSync('const controller={'+code+'};',{loader:'ts'}).code;
 for(const [busy,active] of [[false,true],[false,false],[true,true]]){
  let shown=0,ensured=0,checks=0;
  const run=new Function('operation','residentCloudFlow','residentEnvironment','cloud','signInOutcome','showGoogleMfa','ensureResident','work','signedIn','signInClient','cloudSignIn',
   'let queuedSignInReturn=null;'+compiled+';return async value=>{await controller.signInReturned(value);return queuedSignInReturn;};');
  const fn=run(busy,()=>true,()=> 'production',{},googleOutcome,()=>{shown++;},async()=>{ensured++;},async(_,fn)=>fn(new AbortController().signal),()=>{throw Error('MFA must not bind account');},()=>{},
   {resumeMfa:async input=>{assert.deepEqual(input,{attemptId,environment:'production'});checks++;return {active};}});
  const outcome=required();const queued=await fn(outcome);
  assert.equal(shown,!busy&&active?1:0);assert.equal(ensured,busy?0:1);assert.equal(checks,busy?0:1);assert.equal(queued,busy?outcome:null);
 }
 const native=read('vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud/CloudSignInPlugin.java');
 const resume=method(native,' @PluginMethod public void resumeMfa(',' @PluginMethod public void cancel(');
 for(const guard of ['!attempt.cancelled','attempt.mfaType != null','attempt.id.equals(call.getString("attemptId"))','attempt.environment.name.equals(call.getString("environment"))','attempt.expiresAt > System.currentTimeMillis()'])assert.ok(resume.includes(guard),guard);
});
