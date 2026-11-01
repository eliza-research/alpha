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
  await render({busy:false,message:'',error:'That code did not work. Check it and try again, or send a new code.'});
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

test('mandatory chooser omits inert Back and distinguishes readiness from an email request',async()=>panel(async({document,render})=>{
  await render({view:choose,dismissible:false,ready:false,extra:React.createElement('button',null,'Retry sign-in')});
  assert.equal([...document.querySelectorAll('button')].some(button=>button.textContent==='Back'),false);
  assert.equal(document.querySelector('[name="email"]').disabled,true);
  assert.equal(document.querySelector('#alpha-google-unavailable'),null,'do not suggest unavailable email during readiness failure');
  await render({ready:true,extra:undefined});
  assert.equal(document.querySelector('[name="email"]').disabled,false);
  await render({busy:true,message:'Sending your code…'});
  assert.equal(document.querySelector('form button').textContent,'Sending code…');
  assert.equal(document.querySelector('[role="status"]:not(#alpha-google-unavailable)')===null,true,'sending does not add a line or shift the form');
  assert.equal([...document.querySelectorAll('.alpha-connection-cancel')].some(button=>button.textContent==='Cancel sign-in'),true);
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
    const ownProviderSelected=()=>false;let operation=null,residentStartInBackground=false,active=null,signInReadinessOwner=null;
    const state={signIn:{step:'code',environment:'production',attemptId:'old',email:'person@example.invalid'},open:true,busy:false,message:'',error:''};
    const events=[],update=values=>{Object.assign(state,values);events.push({...values});};
    const cloud={cancelLogin(){events.push({cancel:true});}};
    const client={};
    const signInClient=()=>client,ensureResident=async()=>{},residentRecoveryReason=()=>null;
    const errorMessage=e=>e.message,runQueuedResidentRebind=()=>{},runQueuedSignInReturn=()=>{};
    const testMocksEnabled=false,isAndroid=${isAndroid},browserCloudResidentEnabled=${browserCloudResidentEnabled},expired=()=>false,residentCloudFlow=()=>true;
    let required=false;const productionCloudSignInRequired=()=>required,residentSignInRequired=()=>required;let pendingBillingReview=null;const clearPersonalSetup=()=>{};
    ${ui.includes('export function explicitSignedOutCloudEntry(')?part('export function explicitSignedOutCloudEntry(', 'export function connectionChooserVisible(').replace('export ',''):'function explicitSignedOutCloudEntry(){return false;}'}
    const validSignInEmail=()=>true,normalizeSignInCode=value=>/^\\d{6}$/.test(value)?value:null;
    class CloudSignInError extends Error {constructor(code){super(code);this.code=code;}}
    const signInFailureMessage=code=>code,signInFailed=(environment,keep=false)=>{if(!keep)update({signIn:{step:'choose',environment}});};
    const signedIn=async()=>events.push({authenticated:true});
    ${part('async function work(', '/** Start (or restart) the resident.')}
    const connectionController={
    ${part('  close() {', '  cancel() {')}
    cancel(){operation?.abort(new DOMException('Cancelled','AbortError'));cloud.cancelLogin();},
    ${part('  cancelSignIn() {','  async signInGoogle()')}
    ${part('  async signInGoogle()', '  /** Sends a six-digit code')}
    ${part('  async signInEmail(', '  /**\n   * Native finished a Google return')}
    };
    return {state,events,client,connectionController,CloudSignInError,work,setRequired:value=>{required=value;}};
  `;
  return new Function(transformSync(source,{loader:'ts',format:'cjs'}).code)();
}

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

test('actual controller cancellation returns to chooser and ignores late verification success',async()=>{
  const f=controllerFixture(),pending=deferred();f.client.verifyEmailSignIn=()=>pending.promise;
  const request=f.connectionController.verifySignInCode('123456');
  assert.equal(f.state.busy,true);f.connectionController.cancelSignIn();
  assert.deepEqual(f.state.signIn,choose);pending.resolve({status:'authenticated'});await request;
  assert.equal(f.state.busy,false);assert.equal(f.state.error,'');
  assert.ok(!f.events.some(e=>e.authenticated));
});

test('actual controller rejects late email challenge and Google failure after cancellation',async()=>{
  for(const method of ['email','google']){
    const f=controllerFixture(),pending=deferred();f.state.signIn={...choose};
    if(method==='email')f.client.startEmailSignIn=()=>pending.promise;
    else f.client.signInWithGoogle=()=>pending.promise;
    const request=method==='email'?f.connectionController.signInEmail('person@example.invalid'):f.connectionController.signInGoogle();
    f.connectionController.cancelSignIn();
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

test('native Back and Escape share auth cancellation instead of leaving an expired code form',()=>{
  const source=part('    const dismiss = () => {','    const back = ');
  const compile=transformSync(source,{loader:'ts',format:'cjs'}).code;
  let current={signIn:{...code}},calls=[];
  const controller={getSnapshot:()=>current,cancelSignIn:()=>calls.push('auth'),cancel:()=>calls.push('generic'),close:()=>calls.push('close')};
  const dismiss=new Function('connectionController','snapshot',compile+'return dismiss;')(controller,{busy:true});
  dismiss();assert.deepEqual(calls,['auth']);
  current={signIn:null};dismiss();assert.deepEqual(calls,['auth','generic'],'reads the current auth state, not stale effect state');
  const handlers=part('    const back = ','      if (event.key === \'Tab\'');
  assert.equal((handlers.match(/dismiss\(\)/g)||[]).length,2,'edge Back and Escape use the same dispatch');
});

test('cancelling another operation does not conceal its genuine late failure',async()=>{
  const f=controllerFixture(),pending=deferred();
  const request=f.work('Updating…',()=>pending.promise);
  f.connectionController.cancel();pending.reject(new Error('Saved effect could not be confirmed'));
  await request;assert.equal(f.state.error,'Saved effect could not be confirmed');
});

test('Back on the required chooser keeps sign-in enabled instead of creating a retry dead end',()=>{
  const f=controllerFixture();f.state.signIn={...choose};f.setRequired(true);
  f.connectionController.cancelSignIn();
  assert.deepEqual(f.state.signIn,choose);assert.equal(f.events.length,0);
  f.setRequired(false);f.connectionController.cancelSignIn();
  assert.equal(f.state.signIn,null,'optional account dialog can still be dismissed');
});

const entryStart=ui.indexOf('  const requiredSignInView:'),entryEnd=ui.indexOf('  const accountCreatedNotice=',entryStart);assert.ok(entryStart>=0&&entryEnd>entryStart);
const selectorSource=ui.slice(entryStart,entryEnd);
const explicitEntrySource=ui.includes('export function explicitSignedOutCloudEntry(')?part('export function explicitSignedOutCloudEntry(', 'export function connectionChooserVisible(').replace('export ',''):'function explicitSignedOutCloudEntry(){return false;}';
const entryFunction=transformSync(`const isAndroid=false,browserCloudResidentEnabled=false,ownProviderSelected=()=>false;${explicitEntrySource}function selectEntry(snapshot){const productionSignInRequired=false,explicitSignInEntry=explicitSignedOutCloudEntry(snapshot),signInEntryRequired=productionSignInRequired||explicitSignInEntry;const providerChoice=null,panel=null,residentEnvironment=()=> 'production',inAppGoogle=false,inAppPhone=false,inAppEmail=true,cloudSignInPhone=false,loadSignInService=()=>null,RESIDENT_UNPACKAGED='unpackaged',browserCloudResidentEnabled=false,testMocksEnabled=false;${selectorSource}return null;}`,{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
const noAuthCalls=[];const entryController=new Proxy({},{get:(_,name)=>()=>noAuthCalls.push(name)});
const selectEntry=new Function('require','CloudSignInPanel','connectionController','ResidentRecoveryPanel',entryFunction+';return selectEntry;')(createRequire(import.meta.url),CloudSignInPanel,entryController,()=>null);
test('explicit signed-out account and plan entry render approved email/Google chooser directly, with no legacy CTA or auth action',async()=>{const {renderToStaticMarkup}=await import('react-dom/server');for(const purpose of['cloud-account','plan']){const element=selectEntry({open:true,purpose,cloudAccount:null,busy:false,message:'',error:'',signIn:null});assert.ok(element,'the actual root-page branch must select the existing sign-in component');const html=renderToStaticMarkup(element);assert.match(html,/Welcome to Alpha/);assert.match(html,/Continue with Google/);assert.match(html,/Sign in with email/);assert.doesNotMatch(html,/Sign in to use connected services such as Gmail/);assert.deepEqual(noAuthCalls,[]);}});
test('verified account is not redirected from membership into first-run sign-in',()=>{assert.equal(selectEntry({open:true,purpose:'cloud-account',cloudAccount:{userId:'synthetic-owner'},busy:false,signIn:null}),null);});

test('explicit account chooser preserves newer in-app email/phone readiness and never starts hosted auth',async()=>{
 const begin=part('  async beginSignIn(', '  /** Leaves the sign-in screen');
 const body=`${explicitEntrySource}function make(purpose,methods){let operation=null,epoch=0,signInReadinessOwner=null,inAppGoogle=false,inAppPhone=false,inAppEmail=false;const cloudSignIn={},cloudServiceName=()=> 'Eliza Cloud',state={open:true,purpose,cloudAccount:null},updates=[],calls=[];const residentCloudFlow=()=>false,residentEnvironment=()=> 'production',cloudEnvironmentAllowed=()=>true,isAndroid=false;let cloud={environment:'production',cancelLogin(){calls.push('cancel');}};const inAppSignInMethods=async()=>{calls.push('status');return methods;},update=patch=>{updates.push(patch);Object.assign(state,patch);},work=async(_,fn)=>fn(new AbortController().signal),ensureResident=async()=>{},browserCloudLoginAction=async()=>calls.push('web-auth'),residentBrowserLoginAction=async()=>calls.push('resident-auth');const connectionController={${begin}};return {controller:connectionController,state,updates,calls,methods:()=>({google:inAppGoogle,phone:inAppPhone,email:inAppEmail})};}`;
 const compiled=transformSync(body,{loader:'ts',format:'cjs'}).code,make=new Function(compiled+';return make;')();
 for(const purpose of ['cloud-account','plan','agent'])for(const methods of [null,{google:false,phone:true,email:false}]){const f=make(purpose,methods);await f.controller.beginSignIn('production');assert.equal(f.state.signIn.step,'choose');assert.deepEqual(f.calls,['status','cancel']);assert.deepEqual(f.methods(),{google:false,phone:methods?.phone===true,email:methods===null||methods.email!==false});}
});

test('Back from optional explicit sign-in returns to Settings through the existing close fence',()=>{const f=controllerFixture();Object.assign(f.state,{signIn:{...choose},purpose:'cloud-account',cloudAccount:null});f.connectionController.cancelSignIn();assert.equal(f.state.signIn,null);assert.equal(f.state.open,false);assert.equal(f.state.purpose,'agent');assert.ok(!f.events.some(event=>event.authenticated));});

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
    assert.equal(visible(googleButton),true,'Google entry remains visible');
    assert.equal(googleButton.disabled,!google,'provider readiness still controls Google');
    assert.equal(visible(document.querySelector('form[aria-label="Sign in with phone"]')),true,'offered phone entry is retained');
    assert.equal([...document.querySelectorAll('button')].some(button=>/Other sign-in methods|Hide other sign-in methods/.test(button.textContent)),false);
  }
}));

test('service terms and privacy still open without the technical service-documents label',async()=>panel(async({document,render})=>{
 const service={name:'Eliza Cloud',terms:{title:'Terms of Service',revision:'1',sections:[{title:'Terms',paragraphs:['Terms content.']}]},privacy:{title:'Privacy Policy',revision:'1',sections:[{title:'Privacy',paragraphs:['Privacy content.']}]}};
 await render({view:choose,ready:true,serviceLoader:async()=>service});
 await act(async()=>{await Promise.resolve();});
 assert.doesNotMatch(document.body.textContent,/Service documents:/);
 const button=label=>[...document.querySelectorAll('button')].find(item=>item.textContent===label);
 assert.ok(button('Terms of Service'));assert.ok(button('Privacy Policy'));
 await act(()=>button('Terms of Service').click());assert.match(document.querySelector('.alpha-cloud-legal').textContent,/Terms content/);
 await act(()=>button('Back to sign-in').click());
 await act(()=>button('Privacy Policy').click());assert.match(document.querySelector('.alpha-cloud-legal').textContent,/Privacy content/);
}));

// Extracted controller functions retain their real module-level platform collaborators.
test('required chooser Back retains its guard on Android and browser-resident platforms',()=>{
 for(const platform of [{isAndroid:true,browserCloudResidentEnabled:false},{isAndroid:false,browserCloudResidentEnabled:true}]){
  const f=controllerFixture(platform);f.state.signIn={...choose};f.setRequired(true);
  f.connectionController.cancelSignIn();assert.deepEqual(f.state.signIn,choose);assert.equal(f.events.length,0);
 }
});
