import test from 'node:test';
import {signInReadiness} from '../apps/app/src/runtime/cloud-sign-in.ts';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
const require=createRequire(import.meta.url);

test('phone sign-in and code entry stay in the app and are absent without native support',()=>{
 const code=buildSync({entryPoints:['apps/app/src/runtime/cloud-sign-in-ui.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime']}).outputFiles[0].text;
 const module={exports:{}};new Function('require','module','exports',code)(require,module,module.exports);
 const panel=module.exports.CloudSignInPanel;
 const props={view:{step:'choose',environment:'production'},busy:false,google:false,message:'',error:'',actions:{}};
 const render=extra=>renderToStaticMarkup(React.createElement(panel,{...props,...extra}));
 assert.doesNotMatch(render({phone:false}),/phone number/i);
 assert.match(render({phone:false}),/>Sign in<\/h1>/);
 assert.doesNotMatch(render({phone:false}),/review access|Sign in to verify|Your agent|Terms of Service|Privacy Policy|<details/);
 assert.doesNotMatch(render({phone:false}),/By continuing, you allow/);
 assert.match(render({phone:true}),/Email or phone number/,'one field takes an email or a phone number');
 assert.match(render({phone:true,emailEnabled:false}),/inputMode="tel"/);
 assert.doesNotMatch(render({phone:true,emailEnabled:false}),/Email/);
 assert.doesNotMatch(render({phone:true}),/>Retry</,'no Retry button');
 const entered=render({phone:true,view:{step:'code',environment:'production',phone:'+14155550100',email:'',attemptId:'synthetic',expiresAt:Date.now()+60000,resendAt:Date.now()+60000}});
 assert.match(entered,/Enter your phone code/);assert.match(entered,/\+14155550100/);assert.match(entered,/Resend code in/);
 assert.doesNotMatch(entered,/href=|iframe|type="email"/);
 // The code step is titled for where the code went, submits on the sixth digit and backs out quietly.
 assert.match(entered,/>Check your messages<\/h1>/);
 assert.doesNotMatch(entered,/>Verify</,'no Verify button: the sixth digit submits');
 assert.match(entered,/class="alpha-connection-cancel"[^>]*>Back</);
 const emailCode=render({view:{step:'code',environment:'production',email:'owner@example.invalid',attemptId:'synthetic',expiresAt:Date.now()+60000,resendAt:0}});
 assert.match(emailCode,/>Check your email<\/h1>/);assert.match(emailCode,/>Resend code</);
 assert.match(render({busy:true,view:{step:'code',environment:'production',email:'owner@example.invalid',attemptId:'synthetic',expiresAt:Date.now()+60000,resendAt:0}}),/>Cancel sign-in</,'a request in flight is cancelled, not backed out of');
 // Google is an outlined secondary pill above an "or" rule and the single field.
 const both=render({google:true,phone:true});
 assert.match(both,/class="alpha-cloud-sign-in-google"[^>]*>Continue with Google</);
 assert.match(both,/class="alpha-cloud-sign-in-or" aria-hidden="true">or</);
 assert.ok(both.indexOf('Continue with Google')<both.indexOf('alpha-cloud-sign-in-or')&&both.indexOf('alpha-cloud-sign-in-or')<both.indexOf('Email or phone number'));
 assert.doesNotMatch(render({google:true,phone:false,emailEnabled:false}),/alpha-cloud-sign-in-or/,'no rule without a field below it');
 // An unreachable Cloud on the method choice is a wait, not an alert.
 const waiting=render({phone:true,error:'Waiting for connection'});
 assert.match(waiting,/role="status">Waiting for connection</);assert.doesNotMatch(waiting,/role="alert"/);
 assert.match(render({phone:true,error:'Too many attempts.'}),/role="alert"[^>]*>Too many attempts\.</);
 // A step started offline is held: field and button locked, the button itself says it is waiting.
 const held=render({phone:true,google:true,error:'Waiting for connection',pending:'email'});
 assert.match(held,/<button disabled="">Waiting for connection<\/button>/);
 assert.match(held,/<input[^>]*disabled=""/);
 assert.match(held,/class="alpha-cloud-sign-in-google" disabled="">Continue with Google</);
 assert.doesNotMatch(held,/role="status">Waiting for connection</,'said once, on the locked control');
 assert.doesNotMatch(held,/>Continue</);
 const heldGoogle=render({phone:true,google:true,error:'Waiting for connection',pending:'google'});
 assert.match(heldGoogle,/class="alpha-cloud-sign-in-google" disabled="">Waiting for connection</);
 assert.match(heldGoogle,/<button disabled="">Continue<\/button>/);
 // Without a held step the field is not marked invalid or tied to an error.
 assert.doesNotMatch(render({phone:true}),/aria-invalid|aria-describedby/);
});

test('Back on the code and verification steps returns to the method choice; the choice backs out of sign-in',async()=>{
 const code=buildSync({entryPoints:['apps/app/src/runtime/cloud-sign-in-ui.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime']}).outputFiles[0].text;
 const module={exports:{}};new Function('require','module','exports',code)(require,module,module.exports);
 const {JSDOM}=require('jsdom');const dom=new JSDOM('<!doctype html><div id="root"></div>');
 const globals={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
 const saved=Object.fromEntries(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 const {createRoot}=require('react-dom/client');const root=createRoot(dom.window.document.getElementById('root'));
 try {
  const calls=[];const actions={back:()=>calls.push('back'),cancel:()=>calls.push('cancel'),retry(){},email(){},google(){},verify(){},resend(){}};
  const show=async(view,busy=false)=>{await React.act(async()=>root.render(React.createElement(module.exports.CloudSignInPanel,{view,busy,google:false,message:'',error:'',actions})));};
  const back=()=>[...dom.window.document.querySelectorAll('button')].find(button=>/^(Back|Cancel sign-in)$/.test(button.textContent));
  await show({step:'code',environment:'production',email:'owner@example.invalid',attemptId:'synthetic',expiresAt:Date.now()+60000,resendAt:0});back().click();
  await show({step:'mfa',environment:'production',attemptId:'synthetic',method:'totp',expiresAt:Date.now()+60000});back().click();
  await show({step:'code',environment:'production',email:'owner@example.invalid',attemptId:'synthetic',expiresAt:Date.now()+60000,resendAt:0},true);back().click();
  await show({step:'choose',environment:'production'});back().click();
  assert.deepEqual(calls,['back','back','cancel','cancel'],'a request in flight is cancelled; the choice leaves sign-in');
  // An address error is announced with the field it belongs to.
  const input=dom.window.document.querySelector('input[name="username"]');input.value='4155550100';
  await show({step:'choose',environment:'production'});
  await React.act(async()=>{dom.window.document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
  const error=dom.window.document.getElementById('alpha-sign-in-address-error');
  assert.ok(error);assert.equal(error.getAttribute('role'),'alert');
  assert.equal(input.getAttribute('aria-invalid'),'true');assert.equal(input.getAttribute('aria-describedby'),'alpha-sign-in-address-error');
 } finally {
  await React.act(async()=>root.unmount());
  for(const [key,descriptor] of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
});

test('phone codes use the native host, retain MFA, and never reach renderer HTTP',async()=>{
 const server=await createServer({configFile:false,logLevel:'silent',server:{middlewareMode:true,hmr:false,ws:false,watch:null}});
 try {
  const {CloudProtocol}=await server.ssrLoadModule('/apps/app/src/runtime/cloud-protocol.ts');
  const calls=[];const attemptId='00000000-0000-4000-8000-000000000001';
  const signIn={startPhone:async input=>{calls.push(input);return {attemptId,expiresAt:Date.now()+60000,resendAt:Date.now()+30000};},verifyPhone:async input=>{calls.push(input);return {status:'mfa',method:'totp',expiresAt:Date.now()+60000};},cancel:async()=>{}};
  const client=new CloudProtocol('production',async()=>{throw Error('renderer network must not run');},{read:async()=>null,write:async()=>{},clear:async()=>{}},async()=>{},{signIn});
  const signal=new AbortController().signal;
  assert.equal((await client.startPhoneSignIn('+14155550100',signal)).attemptId,attemptId);
  assert.equal((await client.verifyPhoneSignIn(attemptId,'123456',signal)).status,'mfa');
  assert.deepEqual(calls,[{environment:'production',phone:'+14155550100'},{attemptId,code:'123456'}]);
  delete signIn.startPhone;
  await assert.rejects(client.startPhoneSignIn('+14155550100',signal),error=>error.code==='unavailable');
 }finally{await server.close();}
});

test('method discovery accepts independent methods and never guesses SMS from old or malformed answers',()=>{
 assert.deepEqual(signInReadiness({inApp:true,email:false,phone:true,google:false}),{email:false,phone:true,google:false});
 assert.deepEqual(signInReadiness({inApp:true,email:false,google:true}),{email:false,phone:false,google:true});
 assert.equal(signInReadiness({inApp:false,phone:true}),null);
 assert.equal(signInReadiness({inApp:true,email:true,phone:'true'}).phone,false);
 assert.equal(signInReadiness(null),null);
 assert.deepEqual(signInReadiness({inApp:false,methodsKnown:true,email:false,phone:false,google:false}),{email:false,phone:false,google:false});
});
