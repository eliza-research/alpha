import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import {transformSync,buildSync} from 'esbuild';

const read = file => readFileSync(new URL('../'+file, import.meta.url), 'utf8');
const ui = read('apps/app/src/runtime/connection-ui.tsx');
const part = (start,end) => {
  const a=ui.indexOf(start), b=ui.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,start); return ui.slice(a,b);
};
const compiled=transformSync(read('apps/app/src/runtime/cloud-sign-in-ui.tsx').replace(/^import .*;\n/gm,'').replaceAll('export ',''),{loader:'tsx',jsxFactory:'React.createElement'}).code;
const CloudSignInPanel=new Function('React','useRef','useState','useEffect','cloudServiceName',compiled+';return CloudSignInPanel;')(React,React.useRef,React.useState,React.useEffect,()=> 'Eliza Cloud');
const choose={step:'choose',environment:'production'};
const code={step:'code',environment:'production',email:'person@example.invalid',attemptId:'attempt-1',resendAt:0,expiresAt:Date.now()+600000};

async function panel(run){
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
  const previous={};
  for(const key of ['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT']){
    previous[key]=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key],configurable:true,writable:true});
  }
  const {createRoot}=await import('react-dom/client');
  const root=createRoot(document.getElementById('root'));
  const calls=[];
  let props={view:code,busy:false,google:true,message:'',error:'',actions:{verify:value=>calls.push(value),google(){},email(){},resend(){},cancel(){}}};
  const render=async next=>{props={...props,...next};await act(async()=>{root.render(React.createElement(CloudSignInPanel,props));await Promise.resolve();});};
  try{await render({});await run({document:dom.window.document,window:dom.window,render,calls});}
  finally{await act(()=>root.unmount());dom.window.close();for(const [key,value]of Object.entries(previous)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}}
}

test('actual OTP form retains input through submission, pending state and wrong-code retry',async()=>panel(async({document,window,render,calls})=>{
  const input=document.querySelector('input');input.value='123456';
  await act(()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  assert.deepEqual(calls,['123456']);assert.equal(input.value,'123456');
  await render({busy:true,message:'Checking your code…'});
  assert.equal(document.querySelector('input').value,'123456');
  assert.equal(document.querySelector('input').disabled,true);
  assert.equal(document.querySelector('form').getAttribute('aria-busy'),'true');
  assert.equal(document.querySelector('form button').textContent,'Checking code…');
  assert.equal(document.querySelector('[role="status"]:not(#alpha-google-unavailable)')===null,true,'busy feedback stays inside the button without adding a line');
  // Once the code is verified the account is admitted: the code check has ended (owner report 2026-10-30).
  await render({busy:true,message:'Signing in…'});
  assert.equal(document.querySelector('form button').textContent,'Signing in…');
  assert.equal(document.querySelector('[role="status"]:not(#alpha-google-unavailable)')===null,true);
  assert.ok(!document.body.textContent.includes('Checking'));
  await render({busy:true,message:'Checking your code…'});
  await act(()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(calls.length,1,'pending submit must not dispatch again');
  await render({busy:false,message:'',error:'That code didn’t work.'});
  assert.equal(document.querySelector('input').value,'123456');
  assert.equal(document.querySelector('input').disabled,false);
  assert.equal(document.querySelector('form button').textContent,'Verify');
  assert.equal(document.activeElement,document.querySelector('input'));
}));

test('actual OTP form clears only when the attempt or verification stage changes',async()=>panel(async({document,render})=>{
  document.querySelector('input').value='123456';
  await render({view:{...code,attemptId:'attempt-2'}});
  assert.equal(document.querySelector('input').value,'','resend starts a new challenge');
  document.querySelector('input').value='654321';
  await render({view:{...code,step:'mfa',attemptId:'attempt-2',method:'totp'}});
  assert.equal(document.querySelector('input').value,'','email code must not leak into MFA');
  document.querySelector('input').value='112233';
  await render({view:choose});
  assert.equal(document.querySelector('[name="one-time-code"]'),null,'cancel leaves no code input');
}));

test('own-key alternate stays mounted through pending checks and rejection when Cloud is not ready',async()=>panel(async({document,render})=>{
  const alternate=React.createElement('form',{'aria-label':'Own API keys'},React.createElement('input',{type:'password','aria-label':'Fixture key'}));
  await render({view:choose,ready:false,unavailable:true,alternate,busy:false});
  const input=document.querySelector('input');input.value='synthetic-form-value';
  for(const next of [{busy:true,unavailable:false,probing:false},{busy:true,probing:true},{busy:false,probing:false,unavailable:true,error:'Key rejected'}]){
    await render(next);
    assert.equal(document.querySelector('input')===input,true,'readiness must not remount the explicit own-key form');
    assert.equal(input.value==='synthetic-form-value',true,'entered values remain in their original fields');
    assert.equal(document.querySelector('.alpha-auth-loading'),null);
  }
  await render({alternate:undefined,busy:true,probing:true,unavailable:false});
  assert.equal(document.querySelector('input'),null,'leaving own keys removes its inputs');
  assert.ok(document.querySelector('.alpha-auth-loading'),'ordinary Cloud readiness still uses its blank loading state');
}));

test('mandatory chooser omits inert Back and distinguishes readiness from an email request',async()=>panel(async({document,window,render})=>{
  const buttons=()=>[...document.querySelectorAll('button')].map(button=>button.textContent);
  // The automatic readiness check is not an attempt the owner started: nothing to go Back from.
  await render({view:choose,dismissible:false,ready:false,busy:true,probing:true,message:'Checking Eliza Cloud sign-in…'});
  assert.equal(buttons().includes('Back'),false);
  assert.equal(document.querySelector('[name="email"]'),null);
  assert.deepEqual(buttons(),[]);
  assert.equal(document.querySelector('[role="status"]').getAttribute('aria-label'),'Loading Alpha');
  assert.equal(document.querySelector('.alpha-auth-mark'),null);
  assert.equal(document.body.textContent,'');
  // A failed or cancelled check shows its reason and one retry, never a column of dead controls.
  await render({busy:false,probing:false,message:'',unavailable:true,error:'Alpha could not reach Eliza Cloud.',actions:{verify(){},google(){},email(){},resend(){},cancel(){},retry(){}}});
  assert.equal(document.querySelector('[name="email"]'),null);assert.deepEqual(buttons(),['Try again']);
  assert.equal(document.querySelector('[role="alert"]').textContent,'Alpha could not reach Eliza Cloud.');
  await render({ready:true,unavailable:false,error:''});
  assert.equal(document.querySelector('[name="email"]').disabled,false);
  document.querySelector('[name="email"]').value='person@example.invalid';
  await act(async()=>{document.querySelector('form[aria-label="Sign in with email"]').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));});
  await render({busy:true,message:'Sending your code…'});
  const send=document.querySelector('form[aria-label="Sign in with email"] button');
  assert.equal(send.textContent,'Sending code…');assert.equal(send.getAttribute('aria-busy'),'true');
  assert.equal(document.querySelector('[role="status"]')===null,true,'sending does not add a line or shift the form');
  assert.equal(buttons().includes('Back'),true,'an owner-started send can still be abandoned');
  assert.equal(buttons().includes('Cancel sign-in'),false);
}));

test('resend starts at thirty seconds and cannot be clicked during the countdown',async context=>{
 context.mock.method(Date,'now',()=>1_800_000_000_000);
 await panel(async({document,render})=>{
  await render({view:{...code,resendAt:Date.now()+30000}});
  const resend=document.querySelector('button[type="button"]');
  assert.equal(resend.textContent,'Resend code in 30s');assert.equal(resend.disabled,true);
  await render({view:{...code,resendAt:Date.now()-1}});
  assert.equal(resend.textContent,'Resend code');assert.equal(resend.disabled,false);
  await render({view:{...code,resendAt:Date.now()+90000}});
  assert.equal(resend.textContent,'Resend code in 90s');assert.equal(resend.disabled,true,'longer server cooldown is not shortened');
 });
});

function controllerFixture({isAndroid=false,browserCloudResidentEnabled=false}={}){
  const source=`
    const ownProviderSelected=()=>false;let planRecheck=null;let operation=null,residentStartInBackground=false,active=null,signInReadinessOwner=null,googleSignInGeneration=0,googleSignInPrior=null,providerStatusGeneration=0;
    const state={signIn:{step:'code',environment:'production',attemptId:'old',email:'person@example.invalid'},open:true,busy:false,message:'',error:''};
    const events=[],update=values=>{Object.assign(state,values);events.push({...values});};
    const cloud={cancelLogin(){events.push({cancel:true});}};
    const client={};
    const signInClient=()=>client,ensureResident=async()=>{},residentRecoveryReason=()=>null,cloudCredentialStore={read:async()=>null};
    const errorKindOf=()=>null;const errorMessage=e=>e.message,runQueuedResidentRebind=()=>{},runQueuedSignInReturn=()=>{},scheduleResidentAutoRetry=()=>{};
    const testMocksEnabled=false,isAndroid=${isAndroid},browserCloudResidentEnabled=${browserCloudResidentEnabled},expired=()=>false,residentCloudFlow=()=>true;
    let required=false;const productionCloudSignInRequired=()=>required,residentSignInRequired=()=>required;let pendingBillingReview=null;const clearPersonalSetup=()=>{};
    ${ui.includes('export function explicitSignedOutCloudEntry(')?part('export function explicitSignedOutCloudEntry(', 'export function connectionChooserVisible(').replace('export ',''):'function explicitSignedOutCloudEntry(){return false;}'}
    const validSignInEmail=()=>true,normalizeSignInCode=value=>/^\\d{6}$/.test(value)?value:null;
    class CloudSignInError extends Error {constructor(code){super(code);this.code=code;}}
    class CodeExpiredError extends Error {constructor(){super('code-expired');}}
    const signInFailureMessage=code=>code,signInFailed=(environment,keep=false)=>{if(!keep)update({signIn:{step:'choose',environment}});};
    const signedIn=async()=>events.push({authenticated:true});
    ${part('async function work(', '\n/** ')}
    const connectionController={
    ${part('  close() {', '  cancel() {')}
    cancel(){operation?.abort(new DOMException('Cancelled','AbortError'));cloud.cancelLogin();},
    ${part('  async cancelSignIn() {','  async signInGoogle()')}
    ${part('  async signInGoogle()', '  /** Sends a six-digit code')}
    ${part('  async signInEmail(', '  /**\n   * A retained native Google outcome')}
    };
    return {state,events,client,connectionController,CloudSignInError,work,setRequired:value=>{required=value;}};
  `;
  return new Function(transformSync(source,{loader:'ts',format:'cjs'}).code)();
}

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

test('actual controller cancellation returns to chooser and ignores late verification success',async()=>{
  const f=controllerFixture(),pending=deferred();f.client.verifyEmailSignIn=()=>pending.promise;
  const request=f.connectionController.verifySignInCode('123456');
  assert.equal(f.state.busy,true);await f.connectionController.cancelSignIn();
  assert.deepEqual(f.state.signIn,{...choose,email:'person@example.invalid'},'Back keeps the address for a different code or a correction');pending.resolve({status:'authenticated'});await request;
  assert.equal(f.state.busy,false);assert.equal(f.state.error,'');
  assert.ok(!f.events.some(e=>e.authenticated));
});

test('actual controller rejects late email challenge and Google failure after cancellation',async()=>{
  for(const method of ['email','google']){
    const f=controllerFixture(),pending=deferred();f.state.signIn={...choose};
    if(method==='email')f.client.startEmailSignIn=()=>pending.promise;
    else f.client.signInWithGoogle=()=>pending.promise;
    const request=method==='email'?f.connectionController.signInEmail('person@example.invalid'):f.connectionController.signInGoogle();
    await f.connectionController.cancelSignIn();
    if(method==='email')pending.resolve({attemptId:'late',expiresAt:1,resendAt:1});else pending.reject(new Error('late provider error'));
    await request;assert.equal(f.state.error,'');assert.equal(f.state.busy,false);
    assert.deepEqual(f.state.signIn,choose,'cancelled send/picker returns to a usable chooser');
    assert.notEqual(f.state.signIn?.attemptId,'late');assert.ok(!f.events.some(e=>e.authenticated));
  }
});

test('actual controller keeps wrong-code challenge and prevents duplicate verification dispatch',async()=>{
  const f=controllerFixture(),pending=deferred();let calls=0;
  f.client.verifyEmailSignIn=()=>{calls++;return pending.promise;};
  const first=f.connectionController.verifySignInCode('123456');
  await f.connectionController.verifySignInCode('123456');assert.equal(calls,1);
  pending.reject(new f.CloudSignInError('invalid-code'));await first;
  assert.equal(f.state.signIn.attemptId,'old');assert.equal(f.state.error,'invalid-code');
});

test('a failed resend keeps the code step and the code already sent',async()=>{
  for(const failure of ['rate-limited','offline']){
    const f=controllerFixture();f.state.signIn={...f.state.signIn,resendAt:0,expiresAt:Date.now()+600000};
    f.client.startEmailSignIn=async()=>{throw new f.CloudSignInError(failure);};
    await f.connectionController.resendSignInCode();
    assert.equal(f.state.signIn.step,'code');assert.equal(f.state.signIn.attemptId,'old','the first code can still be verified');
    assert.equal(f.state.error,failure);assert.equal(f.state.busy,false);
    let verified;f.client.verifyEmailSignIn=async attemptId=>{verified=attemptId;return {status:'authenticated'};};
    await f.connectionController.verifySignInCode('123456');assert.equal(verified,'old');
  }
});

test('an expired or exhausted code keeps the address with a new code ready; other refusals return with it filled in',async()=>{
  for(const failure of ['expired','attempts-exhausted']){
    const f=controllerFixture();f.state.signIn={...f.state.signIn,resendAt:Date.now()+60000};
    f.client.verifyEmailSignIn=async()=>{throw new f.CloudSignInError(failure);};
    await f.connectionController.verifySignInCode('123456');
    assert.equal(f.state.signIn.step,'code');assert.equal(f.state.signIn.email,'person@example.invalid');
    assert.equal(f.state.signIn.resendAt,0,'Resend is available at once');assert.equal(f.state.signIn.stale,true,'the dead code cannot be verified again');
    // An expired code says to send a new one (the screen offers Resend), never "start again".
    assert.equal(f.state.error,failure==='expired'?'code-expired':failure);
  }
  const f=controllerFixture();f.client.verifyEmailSignIn=async()=>{throw new f.CloudSignInError('rejected');};
  await f.connectionController.verifySignInCode('123456');assert.equal(f.state.signIn.step,'choose');
});

test('wrong code is reported at the code field and selected for replacement; resend reports on its own control',async()=>panel(async({document,render})=>{
  document.querySelector('input').value='111111';
  await render({error:'That code did not work.'});
  const input=document.querySelector('[name="one-time-code"]'),alert=document.querySelector('#cloud-sign-in-code-error');
  assert.equal(alert.getAttribute('role'),'alert');assert.equal(input.getAttribute('aria-describedby'),'cloud-sign-in-code-error');
  assert.equal(input.getAttribute('aria-invalid'),'true');
  assert.equal(input.compareDocumentPosition(alert)&4,4,'the error follows the field, before Verify');
  assert.equal(alert.nextElementSibling.textContent,'Verify');
  assert.equal([input.selectionStart,input.selectionEnd].join(),'0,6','the rejected code is selected so typing replaces it');
  await render({error:''});
  [...document.querySelectorAll('button')].find(button=>button.textContent==='Resend code').click();
  await render({busy:true,message:'Sending your code…'});
  const labels=[...document.querySelectorAll('button')].map(button=>button.textContent);
  assert.ok(labels.includes('Verify'),'Verify does not claim to send');assert.ok(labels.includes('Sending code…'));
  assert.equal(document.querySelector('.alpha-auth-resend').getAttribute('aria-busy'),'true');
  assert.ok(labels.includes('Back'));assert.ok(!labels.includes('Cancel sign-in'));
}));

test('Google waits in the browser with one heading and Back; passkey MFA shows only its reason',async()=>panel(async({document,render})=>{
  await render({view:{step:'google',environment:'production'},busy:true,message:'Continue in your browser.'});
  assert.equal(document.querySelector('h1').textContent,'Finish in your browser.');
  assert.equal(document.querySelector('[role="status"]'),null);
  assert.deepEqual([...document.querySelectorAll('button')].map(button=>button.textContent),['Back'],'without a reopen action only Back is offered');
  let reopened=0;
  await render({actions:{verify(){},google(){},email(){},resend(){},cancel(){},reopenGoogle:()=>{reopened++;}}});
  const reopen=[...document.querySelectorAll('button')].find(button=>button.textContent==='Open Google again');
  assert.ok(reopen,'a closed Google page can be opened again');assert.equal(reopen.disabled,false);
  assert.ok(document.querySelector('.alpha-spinner'),'waiting shows progress');
  reopen.click();assert.equal(reopened,1);
  await render({view:{step:'mfa',environment:'production',attemptId:'a',method:'passkey',expiresAt:Date.now()+60000},busy:false,message:'',error:'mfa-unsupported'});
  assert.equal(document.querySelector('h1').textContent,'Can’t finish sign-in');
  assert.equal(document.querySelectorAll('[role="alert"]').length,1);assert.equal(document.querySelector('input'),null);
}));

test('own API keys sit below the Cloud methods and replace them when chosen',async()=>panel(async({document,render})=>{
  let opened=0;
  await render({view:choose,ready:true,dismissible:false,ownKeys:()=>{opened++;}});
  const buttons=[...document.querySelectorAll('button')];const own=buttons.find(button=>button.textContent==='Use my own API keys');
  assert.equal(buttons.at(-1),own,'the own-keys entry is last, after the Cloud methods');
  assert.ok(document.querySelector('h1').compareDocumentPosition(own)&4);own.click();assert.equal(opened,1);
  await render({busy:true,probing:true,ready:false,message:'Checking Eliza Cloud sign-in…'});
  assert.equal([...document.querySelectorAll('button')].some(button=>button.textContent==='Use my own API keys'),false,'Direct is hidden during readiness');
  await render({busy:false,probing:false,ready:true,message:'',alternate:React.createElement('form',{'aria-label':'Own API keys'})});
  assert.equal(document.querySelector('form[aria-label="Sign in with email"]'),null,'the Cloud methods give way to the key form');
  assert.ok(document.querySelector('form[aria-label="Own API keys"]'));assert.equal(document.querySelector('h1').textContent,'Welcome to Alpha.');
  assert.equal(document.querySelector('[role="status"]'),null);
}));

test('native Back and Escape share auth cancellation instead of leaving an expired code form',()=>{
  const source=part('  const dismiss = () => {','  useEffect(');
  const compile=transformSync(source,{loader:'ts',format:'cjs'}).code;
  let current={signIn:{...code}},calls=[];
  const controller={getSnapshot:()=>current,cancelSignIn:()=>calls.push('auth'),cancel:()=>calls.push('generic'),close:()=>calls.push('close')};
  const dismiss=new Function('connectionController','snapshot',compile+'return dismiss;')(controller,{busy:true});
  dismiss();assert.deepEqual(calls,['auth']);
  current={signIn:null};dismiss();assert.deepEqual(calls,['auth','generic'],'reads the current auth state, not stale effect state');
  const handlers=part('    const back = ','      if (event.key === \'Tab\'');
  assert.equal((handlers.match(/dismiss\(\)/g)||[]).length,2,'edge Back and Escape use the same dispatch');
  assert.match(ui,/onClick=\{\(\)=>\{if\(saving\)\{connectionController\.cancel\(\);return;\}/,'the own-key Cancel on the welcome page and in Settings stops a running check through the shared cancel');
});

test('cancelling another operation does not conceal its genuine late failure',async()=>{
  const f=controllerFixture(),pending=deferred();
  const request=f.work('Updating…',()=>pending.promise);
  f.connectionController.cancel();pending.reject(new Error('Saved effect could not be confirmed'));
  await request;assert.equal(f.state.error,'Saved effect could not be confirmed');
});

test('Back on the required chooser keeps sign-in enabled instead of creating a retry dead end',async()=>{
  const f=controllerFixture();f.state.signIn={...choose};f.setRequired(true);
  await f.connectionController.cancelSignIn();
  assert.deepEqual(f.state.signIn,choose);assert.equal(f.events.length,0);
  f.setRequired(false);await f.connectionController.cancelSignIn();
  assert.equal(f.state.signIn,null,'optional account dialog can still be dismissed');
});

const entryStart=ui.indexOf('  const requiredSignInView:'),entryEnd=ui.indexOf('  const accountCreatedNotice=',entryStart);assert.ok(entryStart>=0&&entryEnd>entryStart);
const selectorSource=ui.slice(entryStart,entryEnd);
const explicitEntrySource=ui.includes('export function explicitSignedOutCloudEntry(')?part('export function explicitSignedOutCloudEntry(', 'export function connectionChooserVisible(').replace('export ',''):'function explicitSignedOutCloudEntry(){return false;}';
const entryFunction=transformSync(`const isAndroid=false,browserCloudResidentEnabled=false,ownProviderSelected=()=>false,productionCloudSignInRequired=()=>false;${explicitEntrySource}function selectEntry(snapshot){const productionSignInRequired=false,explicitSignInEntry=explicitSignedOutCloudEntry(snapshot),signInEntryRequired=productionSignInRequired||explicitSignInEntry,signInPage=signInEntryPage(snapshot),sending=null;const providerChoice=null,panel=null,ownKeyEntry=false,setOwnKeyEntry=()=>{},ownKeyAttempted=false,setOwnKeyAttempted=()=>{},signInPageShown=!!snapshot.signIn||signInEntryRequired,OwnKeyForm=()=>null,ownKeySaving=false,LOCAL_PROVIDER_MODEL='qwen',automaticSignInProbe={current:false},signInProbeMessage=()=>'Checking Eliza Cloud sign-in…',residentEnvironment=()=> 'production',inAppGoogle=false,inAppPhone=false,inAppEmail=true,cloudSignInPhone=false,loadSignInService=()=>null,RESIDENT_UNPACKAGED='unpackaged',residentStartFailure='',browserCloudResidentEnabled=false,testMocksEnabled=false;${selectorSource}return null;}`,{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
const noAuthCalls=[];const entryController=new Proxy({},{get:(_,name)=>()=>noAuthCalls.push(name)});
const selectEntry=new Function('require','CloudSignInPanel','connectionController','ResidentRecoveryPanel','useState',entryFunction+';return selectEntry;')(createRequire(import.meta.url),CloudSignInPanel,entryController,()=>null,React.useState);
test('explicit signed-out account and plan entry stay blank before the chooser is ready',async()=>{const {renderToStaticMarkup}=await import('react-dom/server');for(const purpose of['cloud-account','plan']){const element=selectEntry({open:true,purpose,cloudAccount:null,busy:false,message:'',error:'',signIn:null});assert.ok(element,'the actual root-page branch must select the existing sign-in component');const html=renderToStaticMarkup(element);assert.match(html,/aria-label="Loading Alpha"/);assert.doesNotMatch(html,/alpha-auth-mark|Welcome to Alpha|Checking|Continue with Google|Sign in with email|>Back</);assert.match(html,/role="dialog"/,'an opened sign-in stays a dialog');assert.deepEqual(noAuthCalls,[]);}});
test('verified account is not redirected from membership into first-run sign-in',()=>{assert.equal(selectEntry({open:true,purpose:'cloud-account',cloudAccount:{userId:'synthetic-owner'},busy:false,signIn:null}),null);});

test('explicit account chooser preserves newer in-app email/phone readiness and never starts hosted auth',async()=>{
 const begin=part('  async beginSignIn(', '  /** Leaves the sign-in screen');
 const body=`${explicitEntrySource}function make(purpose,methods){let planRecheck=null;let operation=null,epoch=0,signInReadinessOwner=null,googleSignInGeneration=0,providerStatusGeneration=0,inAppGoogle=false,inAppPhone=false,inAppEmail=false;const cloudSignIn={},cloudServiceName=()=> 'Eliza Cloud',state={open:true,purpose,cloudAccount:null},updates=[],calls=[];const residentCloudFlow=()=>false,residentEnvironment=()=> 'production',cloudEnvironmentAllowed=()=>true,isAndroid=false;let cloud={environment:'production',cancelLogin(){calls.push('cancel');}};const inAppSignInMethods=async()=>{calls.push('status');return methods;},update=patch=>{updates.push(patch);Object.assign(state,patch);},work=async(_,fn)=>fn(new AbortController().signal),ensureResident=async()=>{},browserCloudLoginAction=async()=>calls.push('web-auth'),residentBrowserLoginAction=async()=>calls.push('resident-auth');const connectionController={${begin}};return {controller:connectionController,state,updates,calls,methods:()=>({google:inAppGoogle,phone:inAppPhone,email:inAppEmail})};}`;
 const compiled=transformSync(body,{loader:'ts',format:'cjs'}).code,make=new Function(compiled+';return make;')();
 for(const purpose of ['cloud-account','plan','agent'])for(const methods of [null,{google:false,phone:true,email:false}]){const f=make(purpose,methods);await f.controller.beginSignIn('production');assert.equal(f.state.signIn.step,'choose');assert.deepEqual(f.calls,['status','cancel']);assert.deepEqual(f.methods(),{google:false,phone:methods?.phone===true,email:methods===null||methods.email!==false});}
});

test('Back from optional explicit sign-in returns to Settings through the existing close fence',async()=>{const f=controllerFixture();Object.assign(f.state,{signIn:{...choose},purpose:'cloud-account',cloudAccount:null});await f.connectionController.cancelSignIn();assert.equal(f.state.signIn,null);assert.equal(f.state.open,false);assert.equal(f.state.purpose,'agent');assert.ok(!f.events.some(event=>event.authenticated));});

test('initial chooser visibly presents email alongside Google without another disclosure',async()=>panel(async({document,window,render})=>{
  const visible=element=>{
    if(!element)return false;
    for(let node=element;node;node=node.parentElement){
      const style=window.getComputedStyle(node);
      if(node.hidden||node.getAttribute('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden')return false;
    }
    return true;
  };
  for(const google of [true,false]){
    await render({view:choose,google,phone:true,emailEnabled:true,ready:true,busy:false});
    const email=document.querySelector('form[aria-label="Sign in with email"]');
    const googleButton=[...document.querySelectorAll('button')].find(button=>button.textContent==='Continue with Google');
    assert.equal(visible(email),true,`email is visible immediately when Google availability is ${google}`);
    // An unavailable Google entry is not drawn as a dead button.
    assert.equal(visible(googleButton),google,'Google entry is shown only when it can be used');
    if(google)assert.equal(googleButton.disabled,false);
    const usePhone=[...document.querySelectorAll('button')].find(button=>button.textContent==='Use phone number instead');
    assert.equal(visible(usePhone),true,'offered phone entry is retained one tap away');
    await act(async()=>{usePhone.click();});
    assert.equal(visible(document.querySelector('form[aria-label="Sign in with phone"]')),true,'the phone form replaces the email form');
    assert.equal(document.querySelector('form[aria-label="Sign in with email"]'),null);
    await act(async()=>{[...document.querySelectorAll('button')].find(button=>button.textContent==='Use email instead').click();});
    assert.equal([...document.querySelectorAll('button')].some(button=>/Other sign-in methods|Hide other sign-in methods/.test(button.textContent)),false);
  }
}));

test('sign-in shows no explainer, legal subview or service-documents text',async()=>panel(async({document,render})=>{
 await render({view:choose,ready:true});
 await act(async()=>{await Promise.resolve();});
 assert.doesNotMatch(document.body.textContent,/Terms of Service|Privacy Policy|Service documents|Your agent runs on this device|review access/);
 assert.equal(document.querySelector('details,.alpha-cloud-legal'),null);
}));

// Extracted controller functions retain their real module-level platform collaborators.
test('required chooser Back retains its guard on Android and browser-resident platforms',async()=>{
 for(const platform of [{isAndroid:true,browserCloudResidentEnabled:false},{isAndroid:false,browserCloudResidentEnabled:true}]){
  const f=controllerFixture(platform);f.state.signIn={...choose};f.setRequired(true);
  await f.connectionController.cancelSignIn();assert.deepEqual(f.state.signIn,choose);assert.equal(f.events.length,0);
 }
});

test('a prefilled phone chooser still switches to email and back',async()=>panel(async({document,render})=>{
  await render({view:{...choose,phone:'+14155550100'},google:false,phone:true,emailEnabled:true,ready:true,busy:false});
  assert.ok(document.querySelector('form[aria-label="Sign in with phone"]'),'Back from a text-message code shows the number it was sent to');
  assert.equal(document.querySelector('input[name="phone"]').value,'+14155550100');
  await act(async()=>{[...document.querySelectorAll('button')].find(button=>button.textContent==='Use email instead').click();});
  assert.ok(document.querySelector('form[aria-label="Sign in with email"]'),'the email form replaces the phone form');
  assert.equal(document.querySelector('form[aria-label="Sign in with phone"]'),null);
  await act(async()=>{[...document.querySelectorAll('button')].find(button=>button.textContent==='Use phone number instead').click();});
  assert.ok(document.querySelector('form[aria-label="Sign in with phone"]'));
}));

test('an expired code keeps Resend and disables Verify until a new code arrives',async()=>panel(async({document,window,render,calls})=>{
  await render({view:{...code,stale:true},error:'That code expired. Send a new code.'});
  const verify=[...document.querySelectorAll('button')].find(button=>button.textContent==='Verify');
  assert.equal(verify.disabled,true);
  document.querySelector('input').value='123456';
  await act(()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  assert.deepEqual(calls,[],'a dead code is never sent');
  const resend=[...document.querySelectorAll('button')].find(button=>button.textContent==='Resend code');
  assert.equal(resend.disabled,false);
  await render({view:{...code,attemptId:'attempt-2'},error:''});
  assert.equal([...document.querySelectorAll('button')].find(button=>button.textContent==='Verify').disabled,false);
}));
