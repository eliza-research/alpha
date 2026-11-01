import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformSync} from 'esbuild';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const panelSource=readFileSync(new URL('../apps/app/src/runtime/cloud-sign-in-ui.tsx',import.meta.url),'utf8');
const between=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a);return text.slice(a,b);};
const compiled=transformSync(panelSource.replace(/^import .*;\n/gm,'').replaceAll('export ',''),{loader:'tsx',jsxFactory:'React.createElement'}).code;
const CloudSignInPanel=new Function('React','useRef','useState','useEffect','cloudServiceName',compiled+';return CloudSignInPanel;')(React,React.useRef,React.useState,React.useEffect,()=> 'Eliza Cloud');
const branch=between(source,'  const requiredSignInView:', '  const accountCreatedNotice=');
// The welcome page shows one sign-in method at a time; the own-key view is one tap away.
const ownSource=transformSync(source.slice(source.indexOf('function OwnProviderChoice(')),{loader:'tsx',jsxFactory:'React.createElement'}).code;
const OwnProviderChoice=new Function('React','useRef','useState','Capacitor','browserCloudResidentEnabled',ownSource+';return OwnProviderChoice;')(React,React.useRef,React.useState,{isNativePlatform:()=>false},true);
const ownKeys=transformSync(between(source,'/** First run shows one sign-in method','/** One explicit choice;'),{loader:'tsx',jsxFactory:'React.createElement'}).code;
const SignInOrOwnKeys=new Function('React','useState','AlphaAuthBrand',ownKeys+';return SignInOrOwnKeys;')(React,React.useState,()=>null);

const renderBranch=new Function('React','CloudSignInPanel','snapshot','productionSignInRequired','signInEntryRequired','signInPage','residentEnvironment','inAppGoogle','panel','RESIDENT_UNPACKAGED','connectionController','browserCloudResidentEnabled','testMocksEnabled','ResidentRecoveryPanel','loadSignInService','cloudSignInPhone','inAppPhone','inAppEmail','SignInOrOwnKeys','OwnProviderChoice','LOCAL_PROVIDER_MODEL','dismiss','sending',transformSync('function render(){'+branch+'return null;}',{loader:'tsx',jsxFactory:'React.createElement'}).code+';return render();');
const controller={beginSignIn(){},signInGoogle(){},signInEmail(){},verifySignInCode(){},resendSignInCode(){},cancelSignIn(){}};
const render=snapshot=>renderToStaticMarkup(renderBranch(React,CloudSignInPanel,snapshot,true,true,true,()=> 'production',false,null,'unpackaged',controller,false,false,()=>null,undefined,null,false,true,SignInOrOwnKeys,OwnProviderChoice,'model'));
test('production signed-out entry server-renders direct options before readiness without false Google failure',()=>{
 const html=render({signIn:null,busy:false,message:'',error:''});
 assert.match(html,/Welcome to Alpha/);assert.match(html,/Continue with Google/);assert.match(html,/Email me a code/);assert.match(html,/Retry sign-in/);
 assert.match(html,/Use your own API keys/);assert.doesNotMatch(html,/AI provider|>Own API keys<|Cerebras API key/,'the welcome page never shows the Settings provider switch or the key form under Cloud');
 assert.doesNotMatch(html,/Sign in with Eliza Cloud|Google sign-in is unavailable/);assert.match(html,/disabled/);
});
test('Restore saved sign-in is a Cloud control: offered with Cloud sign-in, absent from the own-key view',()=>{
 const legacy={signIn:{step:'choose',environment:'production'},busy:false,message:'',error:'',cloudAccount:null,legacySignInRecovery:true};
 assert.match(render(legacy),/Restore saved sign-in/);
 // The welcome page after "Use your own API keys": the same branch with the own-key view selected.
 const OwnKeysSelected=new Function('React','useState','AlphaAuthBrand',ownKeys+';return SignInOrOwnKeys;')(React,()=>[true,()=>{}],()=>null);
 const html=renderToStaticMarkup(renderBranch(React,CloudSignInPanel,legacy,true,true,true,()=> 'production',false,null,'unpackaged',controller,false,false,()=>null,undefined,null,false,true,OwnKeysSelected,OwnProviderChoice,'model',()=>{}));
 assert.match(html,/Cerebras API key/);assert.match(html,/Sign in with Cloud instead/);
 assert.doesNotMatch(html,/Restore saved sign-in|Continue with Google|Email me a code|Retry sign-in/);
});
// The same welcome branch in a DOM, so the method switch and a Cloud outcome are used as the owner uses them.
async function inDom(run){
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),previous={};
 for(const key of ['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT']){previous[key]=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key],configurable:true,writable:true});}
 const {createRoot}=await import('react-dom/client');const root=createRoot(dom.window.document.getElementById('root'));
 const document=dom.window.document,button=name=>[...document.querySelectorAll('button')].find(item=>item.textContent===name);
 try{await run({document,window:dom.window,root,button});}
 finally{await act(()=>root.unmount());dom.window.close();for(const [key,value] of Object.entries(previous)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}}
}
const welcome=run=>inDom(async({document,window,root,button})=>{
 const calls=[],cloud={...controller,signInEmail(address){calls.push('email:'+address);},cancelSignIn(){calls.push('cancel');},clearOutcome(){calls.push('clear');}};
 const Welcome=({snapshot,sending})=>renderBranch(React,CloudSignInPanel,snapshot,true,true,true,()=> 'production',false,null,'unpackaged',cloud,false,false,()=>null,undefined,null,false,true,SignInOrOwnKeys,OwnProviderChoice,'model',()=>calls.push('dismiss'),sending);
 const show=(snapshot,sending=null)=>act(async()=>{root.render(React.createElement(Welcome,{snapshot,sending}));});
 const ownView=()=>document.querySelector('section[aria-label="Own API keys"]');
 await run({document,window,show,button,ownView,calls});
});
const idle={signIn:{step:'choose',environment:'production'},cloudAccount:null,busy:false,message:'',error:''};
test('with no Cloud sign-in running, the welcome page switches to own keys and back',async()=>welcome(async({show,button,ownView,calls})=>{
 await show(idle);
 assert.equal(button('Use your own API keys').disabled,false);
 await act(async()=>button('Use your own API keys').click());
 assert.ok(ownView());assert.equal(button('Continue with Google'),undefined);assert.equal(button('Email me a code'),undefined);
 await act(async()=>button('Sign in with Cloud instead').click());
 assert.equal(ownView(),null);assert.ok(button('Email me a code'));assert.equal(button('Use your own API keys').disabled,false);
 assert.deepEqual(calls,[],'switching methods starts, cancels and clears nothing');
}));
test('a Cloud sign-in in flight keeps its panel: the switch waits, Cancel stays, and a late result lands in view',async()=>{
 const code={step:'code',environment:'production',email:'owner@example.invalid',attemptId:'attempt-1',resendAt:0,expiresAt:Date.now()+600000};
 const outcomes={code:{...idle,signIn:code},refused:{...idle,error:'Email sign-in is unavailable. Try again.'},cancelled:idle};
 for(const [outcome,result] of Object.entries(outcomes))await welcome(async({document,window,show,button,ownView,calls})=>{
  await show(idle);
  const form=document.querySelector('form[aria-label="Sign in with email"]');form.querySelector('input').value='owner@example.invalid';
  await act(async()=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  // The email start is in flight and its result has not arrived. The owner tries to switch.
  await show({...idle,busy:true,message:'Sending your code…'});
  const toOwn=button('Use your own API keys'),switchDisabled=toOwn.disabled;
  await act(async()=>toOwn.click());
  const whileBusy={switchDisabled,ownView:!!ownView(),cancelUsable:button('Cancel sign-in')?.disabled===false};
  if(outcome==='cancelled')await act(async()=>button('Cancel sign-in')?.click());
  // The deferred Cloud result arrives.
  await show(result);
  const alert=document.querySelector('[role="alert"]');
  assert.deepEqual({whileBusy,ownView:!!ownView(),codeInView:!!document.querySelector('form[aria-label="Enter your email code"]'),emailInView:!!button('Email me a code'),
   cloudError:alert&&!alert.closest('section[aria-label="Own API keys"]')?alert.textContent:null,calls},{
   whileBusy:{switchDisabled:true,ownView:false,cancelUsable:true},ownView:false,codeInView:outcome==='code',emailInView:outcome!=='code',
   cloudError:outcome==='refused'?result.error:null,calls:outcome==='cancelled'?['email:owner@example.invalid','cancel']:['email:owner@example.invalid']},outcome);
  // Once Cloud has answered, the switch is available again.
  assert.equal(button('Use your own API keys').disabled,false,outcome);
 });
});
test('ready choice renders usable email path and explicit unavailable Google notice',()=>{
 const html=render({signIn:{step:'choose',environment:'production'},busy:false,message:'',error:''});
 assert.match(html,/Google sign-in is unavailable/);assert.match(html,/<button type="button">Retry<\/button>/);assert.match(html,/<input[^>]+type="email"(?![^>]*disabled)/);
});
test('automatic readiness probes once per unresolved entry, rearms after a form closes and never initiates sign-in',()=>{
 const code=between(source,'  const automaticSignInProbe =','  const visible=');
 let ref,effects=[],count=0;
 const apply=new Function('useRef','useEffect','signInEntryRequired','snapshot','connectionController','residentEnvironment','isAndroid','cloudSignIn','update',transformSync(code,{loader:'tsx'}).code);
 const draw=(required,busy=false,signIn=null,rest={})=>{effects=[];apply(()=>ref??=( {current:false}),fn=>{effects.push(fn);},required,{busy,signIn,...rest},{beginSignIn(...args){assert.deepEqual(args,['production',false,true]);count++;},signInGoogle(){throw Error('Unexpected Google');},signInEmail(){throw Error('Unexpected email');}},()=> 'production',false,undefined,()=>{throw Error('Unexpected native recovery update in browser');});assert.equal(effects.length,2,'execute both real startup effects in React order');for(const effect of effects)effect();};
 draw(true,false,null,{startupResolved:false});assert.equal(count,0);
 draw(true,false,null,{automaticRestore:true});assert.equal(count,0);
 draw(true,true);assert.equal(count,0);draw(true);draw(true);assert.equal(count,1);
 draw(true,false,{step:'choose'});assert.equal(count,1);
 // Cloud can refuse a newly issued key after the form closes. Probe its fresh entry once.
 draw(true,true);assert.equal(count,1);draw(true);draw(true);assert.equal(count,2);
 draw(false);draw(true);assert.equal(count,3);
});
test('Cancel delegates in-flight readiness to the existing abort operation, without clearing saved credentials',async()=>{
 const code=between(source,'  async cancelSignIn() {','  async signInGoogle()');let aborted=0,closed=0,changes=[];
 const entry=between(source,'export function explicitSignedOutCloudEntry(', 'export function connectionChooserVisible(').replace('export ','');
 const make=new Function('operation','connectionController','state','productionCloudSignInRequired','update',transformSync('const ownProviderSelected=()=>false,isAndroid=false,browserCloudResidentEnabled=false;'+entry+'const target={'+code+'};',{loader:'ts'}).code+';return target;');
 const run=(active,signIn=null,required=false,rest={})=>make(active,{cancel(){aborted++;},close(){closed++;}},{signIn,...rest},()=>required,v=>changes.push(v)).cancelSignIn();
 await run({});assert.equal(aborted,1);assert.deepEqual(changes,[{signIn:null,message:'',error:''}]);
 changes=[];await run({}, {step:'code',environment:'production'});assert.equal(aborted,2);assert.deepEqual(changes,[{signIn:{step:'choose',environment:'production'},message:'',error:''}]);
 changes=[];await run(null,{step:'choose',environment:'production'},true);assert.equal(aborted,2);assert.deepEqual(changes,[],'required idle chooser remains usable');
 await run(null);assert.equal(aborted,3);assert.deepEqual(changes,[{signIn:null,message:'',error:''}]);
 await run(null,null,false,{open:true,purpose:'cloud-account',cloudAccount:null});assert.equal(closed,1,'idle explicit signed-out account entry returns to the app');
 await run({},null,false,{open:true,purpose:'cloud-account',cloudAccount:null});assert.equal(closed,1,'in-flight work is cancelled without dismissing its entry');
});

// A provider switch restarts the agent, which ends a chat reply in flight ("The connection changed.").
// While a reply streams, the two switch commits wait, as they wait for a key check; the choices,
// key fields, Cancel and Back stay usable. Idle, and once the reply settles, nothing changes.
test('Settings provider switch waits for a streaming reply, keeps Cancel, and switches once the reply settles',async()=>inDom(async({document,root,button})=>{
 const calls=[],own={provider:'cerebras',selected:true,configured:true,voiceConfigured:false};
 const show=props=>act(async()=>{root.render(React.createElement(OwnProviderChoice,{busy:false,status:own,onSave:async(key,voice)=>{calls.push(['save',key,voice]);},onCancel(){calls.push(['cancel check']);},onCloud:async()=>{calls.push(['cloud']);},...props}));});
 const field=()=>document.querySelector('input[type="password"]');
 await show({replying:true});
 assert.equal(button('Cloud').disabled,false);assert.equal(button('Own API keys').disabled,false);
 await act(async()=>button('Cloud').click());
 assert.equal(button('Switch to Cloud').disabled,true,'Switch to Cloud waits for the reply');assert.equal(button('Keep own keys').disabled,false);
 await act(async()=>button('Switch to Cloud').click());
 await act(async()=>button('Keep own keys').click());assert.equal(button('Switch to Cloud'),undefined);
 await act(async()=>button('Own API keys').click());
 assert.equal(button('Save and use own keys').disabled,true,'Save waits for the reply');assert.equal(field().disabled,false);
 field().value='synthetic-cerebras-key';await act(async()=>button('Save and use own keys').click());
 assert.equal(field().value,'synthetic-cerebras-key','a waiting save neither runs nor clears the key');
 assert.equal(button('Cancel').disabled,false);await act(async()=>button('Cancel').click());
 assert.equal(field(),null,'Cancel closes the key form during a reply');
 assert.deepEqual(calls,[],'nothing switched while the reply streamed');
 // The reply settles: the same view switches as it does idle.
 await show({replying:false});
 await act(async()=>button('Own API keys').click());
 field().value='synthetic-cerebras-key';assert.equal(button('Save and use own keys').disabled,false);
 await act(async()=>button('Save and use own keys').click());
 await act(async()=>button('Cloud').click());assert.equal(button('Switch to Cloud').disabled,false);
 await act(async()=>button('Switch to Cloud').click());
 assert.deepEqual(calls,[['save','synthetic-cerebras-key',undefined],['cloud']]);
 // A key check still offers its Cancel, which stops the check.
 await act(async()=>button('Own API keys').click());await show({busy:true});
 assert.equal(button('Save and use own keys').disabled,true);assert.equal(button('Cancel').disabled,false);
 await act(async()=>button('Cancel').click());
 assert.deepEqual(calls.at(-1),['cancel check']);
}));
test('the welcome own-key save waits for a reply in flight; Back to Cloud stays usable',async()=>welcome(async({show,button,ownView,calls})=>{
 await show(idle,new AbortController());
 await act(async()=>button('Use your own API keys').click());
 assert.equal(button('Save and use own keys').disabled,true);assert.equal(button('Sign in with Cloud instead').disabled,false);
 await show(idle);
 assert.equal(button('Save and use own keys').disabled,false);
 await act(async()=>button('Sign in with Cloud instead').click());
 assert.equal(ownView(),null);assert.deepEqual(calls,[]);
}));
