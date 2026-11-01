import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformSync} from 'esbuild';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const panelSource=readFileSync(new URL('../apps/app/src/runtime/cloud-sign-in-ui.tsx',import.meta.url),'utf8');
const between=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a);return text.slice(a,b);};
const compiled=transformSync(panelSource.replace(/^import .*;\n/gm,'').replaceAll('export ',''),{loader:'tsx',jsxFactory:'React.createElement'}).code;
const CloudSignInPanel=new Function('React','useRef','useState','useEffect','cloudServiceName',compiled+';return CloudSignInPanel;')(React,React.useRef,React.useState,React.useEffect,()=> 'Eliza Cloud');
const branch=between(source,'  const requiredSignInView:', '  const accountCreatedNotice=');
const renderBranch=new Function('React','CloudSignInPanel','snapshot','productionSignInRequired','signInEntryRequired','residentEnvironment','inAppGoogle','panel','RESIDENT_UNPACKAGED','connectionController','browserCloudResidentEnabled','testMocksEnabled','ResidentRecoveryPanel','loadSignInService','cloudSignInPhone','inAppPhone','inAppEmail',transformSync('function render(){const providerChoice=null;'+branch+'return null;}',{loader:'tsx',jsxFactory:'React.createElement'}).code+';return render();');
const controller={beginSignIn(){},signInGoogle(){},signInEmail(){},verifySignInCode(){},resendSignInCode(){},cancelSignIn(){}};
const render=snapshot=>renderToStaticMarkup(renderBranch(React,CloudSignInPanel,snapshot,true,true,()=> 'production',false,null,'unpackaged',controller,false,false,()=>null,undefined,null,false,true));
test('production signed-out entry server-renders direct options before readiness without false Google failure',()=>{
 const html=render({signIn:null,busy:false,message:'',error:''});
 assert.match(html,/Welcome to Alpha/);assert.match(html,/Continue with Google/);assert.match(html,/Email me a code/);assert.match(html,/Retry sign-in/);
 assert.doesNotMatch(html,/Sign in with Eliza Cloud|Google sign-in is unavailable/);assert.match(html,/disabled/);
});
test('ready choice renders usable email path and explicit unavailable Google notice',()=>{
 const html=render({signIn:{step:'choose',environment:'production'},busy:false,message:'',error:''});
 assert.match(html,/Google sign-in is unavailable/);assert.match(html,/<button type="button">Retry sign-in options<\/button>/);assert.match(html,/<input[^>]+type="email"(?![^>]*disabled)/);
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
test('Cancel delegates in-flight readiness to the existing abort operation, without clearing saved credentials',()=>{
 const code=between(source,'  cancelSignIn() {','  async signInGoogle()');let aborted=0,closed=0,changes=[];
 const entry=between(source,'export function explicitSignedOutCloudEntry(', 'export function connectionChooserVisible(').replace('export ','');
 const make=new Function('operation','connectionController','state','productionCloudSignInRequired','update',transformSync('const ownProviderSelected=()=>false,isAndroid=false,browserCloudResidentEnabled=false;'+entry+'const target={'+code+'};',{loader:'ts'}).code+';return target;');
 const run=(active,signIn=null,required=false,rest={})=>make(active,{cancel(){aborted++;},close(){closed++;}},{signIn,...rest},()=>required,v=>changes.push(v)).cancelSignIn();
 run({});assert.equal(aborted,1);assert.deepEqual(changes,[{signIn:null,message:'',error:''}]);
 changes=[];run({}, {step:'code',environment:'production'});assert.equal(aborted,2);assert.deepEqual(changes,[{signIn:{step:'choose',environment:'production'},message:'',error:''}]);
 changes=[];run(null,{step:'choose',environment:'production'},true);assert.equal(aborted,2);assert.deepEqual(changes,[],'required idle chooser remains usable');
 run(null);assert.equal(aborted,3);assert.deepEqual(changes,[{signIn:null,message:'',error:''}]);
 run(null,null,false,{open:true,purpose:'cloud-account',cloudAccount:null});assert.equal(closed,1,'idle explicit signed-out account entry returns to the app');
 run({},null,false,{open:true,purpose:'cloud-account',cloudAccount:null});assert.equal(closed,1,'in-flight work is cancelled without dismissing its entry');
});
