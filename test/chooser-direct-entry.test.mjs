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
// `signInPage` (the full-page entry) follows the required-entry policy here; `sending` is a reply
// in flight (none on the signed-out welcome page). `ownKeyEntry` selects the own-key form.
const renderBranch=new Function('React','CloudSignInPanel','snapshot','productionSignInRequired','signInEntryRequired','residentEnvironment','inAppGoogle','panel','RESIDENT_UNPACKAGED','connectionController','browserCloudResidentEnabled','testMocksEnabled','ResidentRecoveryPanel','loadSignInService','cloudSignInPhone','inAppPhone','inAppEmail','ownKeyEntry','OwnKeyForm',transformSync('function render(){const providerChoice=null;const setOwnKeyEntry=()=>{},ownKeyAttempted=false,setOwnKeyAttempted=()=>{},signInPage=productionSignInRequired,sending=null,signInPageShown=!!snapshot.signIn||signInEntryRequired,ownKeySaving=false,LOCAL_PROVIDER_MODEL=\'qwen\',automaticSignInProbe={current:false},signInProbeMessage=()=>\'Checking Eliza Cloud sign-in…\',ownProviderSelected=()=>false;'+branch+'return null;}',{loader:'tsx',jsxFactory:'React.createElement'}).code+';return render();');
const controller={beginSignIn(){},signInGoogle(){},signInEmail(){},verifySignInCode(){},resendSignInCode(){},cancelSignIn(){}};
const render=(snapshot,ownKeyEntry=false)=>renderToStaticMarkup(renderBranch(React,CloudSignInPanel,snapshot,true,true,()=> 'production',false,null,'unpackaged',controller,false,false,()=>null,undefined,null,false,true,ownKeyEntry,()=>React.createElement('form',{'aria-label':'Own API keys'},'Cerebras API key')));
test('production signed-out entry stays quiet until readiness and then shows the sign-in methods',()=>{
 const loading=render({signIn:null,busy:false,message:'',error:''});
 assert.match(loading,/role="status" aria-label="Loading Alpha"/);
 assert.doesNotMatch(loading,/Welcome to Alpha|Continue with Google|Email me a code|Use my own API keys|unavailable|Try again/);
 const ready=render({signIn:{step:'choose',environment:'production'},busy:false,message:'',error:''});
 assert.match(ready,/Welcome to Alpha/);
 assert.match(ready,/Email me a code/);
 assert.doesNotMatch(ready,/Sign in with Eliza Cloud|unavailable|Try again/);
 assert.ok(ready.indexOf('cloud-sign-in-title')<ready.indexOf('Use my own API keys'));
 assert.match(ready,/<button type="button" class="alpha-btn alpha-btn--text">Use my own API keys<\/button>/);
});
test('a failed readiness check shows its reason and one retry instead of disabled forms',()=>{
 const html=render({signIn:null,busy:false,message:'',error:'Alpha could not reach Eliza Cloud. Check your connection and try again.'});
 assert.match(html,/could not reach Eliza Cloud/);assert.match(html,/>Try again<\/button>/);
 assert.doesNotMatch(html,/type="email"|Continue with Google/);assert.match(html,/Use my own API keys/);
});
test('Restore saved sign-in is a Cloud control: offered with Cloud sign-in, absent from the own-key form',()=>{
 const legacy={signIn:{step:'choose',environment:'production'},busy:false,message:'',error:'',cloudAccount:null,legacySignInRecovery:true};
 assert.match(render(legacy),/Restore saved sign-in/);
 const html=render(legacy,true);
 assert.match(html,/Cerebras API key/);
 assert.doesNotMatch(html,/Restore saved sign-in|Continue with Google|Email me a code|Use my own API keys/);
});
test('a Cloud sign-in in flight keeps its panel: the switch to own keys waits and Back stays usable',()=>{
 const html=render({signIn:{step:'choose',environment:'production'},cloudAccount:null,busy:true,message:'Sending your code…',error:''});
 assert.match(html,/<button type="button" class="alpha-btn alpha-btn--text" disabled="">Use my own API keys<\/button>/);
 assert.match(html,/>Back<\/button>/);assert.doesNotMatch(html,/Cerebras API key/);
});
test('ready choice hides an unavailable Google entry and keeps a quiet retry',()=>{
 const html=render({signIn:{step:'choose',environment:'production'},busy:false,message:'',error:''});
 assert.doesNotMatch(html,/Continue with Google|Google sign-in is unavailable/);assert.match(html,/>Retry Google sign-in<\/button>/);assert.match(html,/<input[^>]+type="email"(?![^>]*disabled)/);
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
 // The cancelled operation unwinds when cancel() aborts it, as work() releases it in the app.
 const make=new Function('active','readiness','connectionController','state','productionCloudSignInRequired','update',transformSync('let operation=active;const signInReadinessOwner=readiness;const ownProviderSelected=()=>false,isAndroid=false,browserCloudResidentEnabled=false;'+entry+'const target={'+code.replace('connectionController.cancel();','connectionController.cancel();operation=null;')+'};',{loader:'ts'}).code+';return target;');
 const run=(active,signIn=null,required=false,rest={},readiness=null)=>make(active,readiness,{cancel(){aborted++;},close(){closed++;}},{signIn,...rest},()=>required,v=>changes.push(v)).cancelSignIn();
 await run({});assert.equal(aborted,1);assert.deepEqual(changes,[{signIn:null,message:'',error:''}]);
 changes=[];await run({}, {step:'code',environment:'production'});assert.equal(aborted,2);assert.deepEqual(changes,[{signIn:{step:'choose',environment:'production'},message:'',error:''}]);
 changes=[];await run(null,{step:'choose',environment:'production'},true);assert.equal(aborted,2);assert.deepEqual(changes,[],'required idle chooser remains usable');
 await run(null);assert.equal(aborted,3);assert.deepEqual(changes,[{signIn:null,message:'',error:''}]);
 await run(null,null,false,{open:true,purpose:'cloud-account',cloudAccount:null});assert.equal(closed,1,'idle explicit signed-out account entry returns to the app');
 await run({},null,false,{open:true,purpose:'cloud-account',cloudAccount:null});assert.equal(closed,1,'in-flight work is cancelled without dismissing its entry');
 // Back during the readiness probe (not an attempt the owner started) still closes an entry the owner opened.
 const probe={signal:{}};await run(probe,null,false,{open:true,purpose:'cloud-account',cloudAccount:null},probe.signal);assert.equal(closed,2,'Back during readiness closes the explicit entry');
});

// A provider switch restarts the agent, which ends a chat reply in flight ("The connection changed.").
// While a reply streams, the two switch commits wait, as they wait for a key check; the choices,
// key fields, Cancel and Back stay usable. Idle, and once the reply settles, nothing changes.
const ownSource=transformSync(source.slice(source.indexOf('function OwnKeyForm(')),{loader:'tsx',jsxFactory:'React.createElement'}).code;
async function inDom(run){
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),previous={};
 for(const key of ['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT']){previous[key]=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key],configurable:true,writable:true});}
 const {createRoot}=await import('react-dom/client');const root=createRoot(dom.window.document.getElementById('root'));
 const document=dom.window.document,button=name=>[...document.querySelectorAll('button')].find(item=>item.textContent===name);
 const cancelled=[];
 const [OwnKeyForm,OwnProviderChoice]=new Function('React','useRef','useState','useEffect','Capacitor','browserCloudResidentEnabled','connectionController','OWN_KEY_CHECKING',ownSource+';return [OwnKeyForm,OwnProviderChoice];')(React,React.useRef,React.useState,React.useEffect,{isNativePlatform:()=>true},false,{cancel(){cancelled.push('cancel check');}},'Checking key…');
 try{await run({document,window:dom.window,root,button,OwnKeyForm,OwnProviderChoice,cancelled});}
 finally{await act(()=>root.unmount());dom.window.close();for(const [key,value] of Object.entries(previous)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}}
}
test('Settings provider switch waits for a streaming reply, keeps Cancel, and switches once the reply settles',async()=>inDom(async({document,root,button,OwnProviderChoice,cancelled})=>{
 const calls=[],own={provider:'cerebras',selected:true,configured:true,voiceConfigured:false};
 const show=props=>act(async()=>{root.render(React.createElement(OwnProviderChoice,{heading:false,busy:false,saving:false,status:own,statusUnavailable:false,signedIn:true,error:'',onSave:async(key,voice)=>{calls.push(['save',key,voice]);},onCloud:async()=>{calls.push(['cloud']);},onDismissError(){},onRetryStatus(){},...props}));});
 const field=()=>document.querySelector('input[type="password"]');
 await show({replying:true});
 assert.equal(button('Cloud').disabled,false);assert.equal(button('Own API keys').disabled,false);
 await act(async()=>button('Cloud').click());
 assert.equal(button('Switch to Cloud').disabled,true,'Switch to Cloud waits for the reply');assert.equal(button('Cancel').disabled,false);
 await act(async()=>button('Switch to Cloud').click());
 await act(async()=>button('Cancel').click());assert.equal(button('Switch to Cloud'),undefined);
 await act(async()=>button('Change keys').click());
 assert.equal(button('Save and use own keys').disabled,true,'Save waits for the reply');assert.equal(field().disabled,false);
 field().value='synthetic-cerebras-key';await act(async()=>button('Save and use own keys').click());
 assert.equal(field().value,'synthetic-cerebras-key','a waiting save neither runs nor clears the key');
 assert.equal(button('Cancel').disabled,false);await act(async()=>button('Cancel').click());
 assert.equal(field(),null,'Cancel closes the key form during a reply');
 assert.deepEqual(calls,[],'nothing switched while the reply streamed');
 // The reply settles: the same view switches as it does idle.
 await show({replying:false});
 await act(async()=>button('Change keys').click());
 field().value='synthetic-cerebras-key';assert.equal(button('Save and use own keys').disabled,false);
 await act(async()=>button('Save and use own keys').click());
 await act(async()=>button('Cancel').click());
 await act(async()=>button('Cloud').click());assert.equal(button('Switch to Cloud').disabled,false);
 await act(async()=>button('Switch to Cloud').click());
 assert.deepEqual(calls,[['save','synthetic-cerebras-key',undefined],['cloud']]);
 // A key check still offers its Cancel, which stops the check.
 await act(async()=>button('Change keys').click());await show({busy:true,saving:true});
 assert.equal(button('Checking key…').disabled,true);assert.equal(button('Cancel').disabled,false);
 await act(async()=>button('Cancel').click());
 assert.deepEqual(cancelled,['cancel check']);
}));
test('the welcome own-key save waits for a reply in flight; Back to Cloud stays usable',async()=>inDom(async({root,button,OwnKeyForm})=>{
 const calls=[];
 const show=replying=>act(async()=>{root.render(React.createElement(OwnKeyForm,{busy:false,replying,saving:false,error:'',idleCancelLabel:'Back',onSave:async()=>{calls.push('save');},onCancel(){calls.push('back');}}));});
 await show(true);
 assert.equal(button('Save and use own keys').disabled,true);assert.equal(button('Back').disabled,false);
 await show(false);
 assert.equal(button('Save and use own keys').disabled,false);
 await act(async()=>button('Back').click());
 assert.deepEqual(calls,['back']);
}));
