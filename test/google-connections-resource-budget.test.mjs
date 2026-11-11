import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import {JSDOM} from 'jsdom';
import {tsImport} from 'tsx/esm/api';
const {cloudServiceName}=await tsImport(new URL('../apps/app/src/runtime/cloud-protocol.ts',import.meta.url).href,{parentURL:import.meta.url});
const connectionReturn=await tsImport(new URL('../apps/app/src/runtime/google-connection-return.ts',import.meta.url).href,{parentURL:import.meta.url});
const workspaceReturn=await tsImport(new URL('../apps/app/src/runtime/google-workspace-return.ts',import.meta.url).href,{parentURL:import.meta.url});

// Mount the actual panel. Only external account/Calendar I/O is replaced.
test('Google settings offer no calendar choice, revalidate grants and own Android Back',async()=>{
 const dom=new JSDOM('<div class="os" style="--bg:#121212;--fg:#fff;--acct:#95a0ff;--acc:#0000ff"></div><div id="root"></div>',{url:'https://alpha.invalid'});
 const saved={window:globalThis.window,document:globalThis.document,HTMLElement:globalThis.HTMLElement,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const require=createRequire(import.meta.url),React=require('react'),{createRoot}=require('react-dom/client');
 const counts={accounts:0,calendars:0};const access={gmailChanges:true,calendarEdits:true},published=[],hostCalls=[];
 const account={connectionId:'11111111-1111-4111-8111-111111111111',connected:true,label:'owner@example.invalid',grantedCapabilities:['google.calendar.read','google.calendar.write','google.gmail.read','google.gmail.send']};
 // Calendar is one merged view of the agent's feed: the panel never lists or reads Google calendars.
 const binding={client:{googleCalendars:async()=>{counts.calendars++;return [];}},sessionId:'fixture-session',credentialId:'fixture-credential'};
 const snapshot={cloudAccount:{environment:'production',userId:'22222222-2222-4222-8222-222222222222',organizationId:'33333333-3333-4333-8333-333333333333'}};
 const ACCOUNTS='alpha:test-google-accounts';
 const modules={
  './cloud-protocol':{cloudServiceName},
  './google-connection-return':connectionReturn,
  './google-workspace-return':workspaceReturn,
  '../daily':{DailyApps:{addListener:async()=>({remove(){}})}},
  './gmail-background':{gmailBackgroundStatus:async()=>({}),gmailBackgroundMessage:()=>'',GMAIL_BACKGROUND_CHANGED:'alpha:test-gmail-background'},
  '../native':{isAndroid:true},
  './browser-cloud-resident':{browserCloudResidentEnabled:true,browserResidentCall:async(...call)=>{hostCalls.push(call);}},
  './gmail-grants':{gmailGrantTier:()=> 'send',googleAccountAccessLabel:()=> 'Read and send access'},
  './modal-inert':{holdPhoneInert:()=>()=>{}},
  './connection-ui':{connectionController:{subscribe:()=>()=>{},getSnapshot:()=>snapshot,getCloudClient:()=>binding,rejectCloudSession:()=>{throw Error('Unexpected rejection');}}},
  './google-accounts':{GOOGLE_ACCOUNTS_CHANGED:ACCOUNTS,createGoogleAccounts:()=>({list:async()=>{counts.accounts++;return [account];}}),linkGoogleCalendar:()=>{throw Error('Unexpected Calendar link without the Calendar intent');}},
  './google-calendar-selection':{clearGoogleCalendarSelectionForConnection:()=>{throw Error('Unexpected disconnect');}},
  './native-connection':{openConnectionBrowser:()=>{throw Error('Unexpected OAuth request');},googleWorkspaceReturnPort:undefined},
  './google-agent-access':{googleAgentAccess:()=>({...access}),publishGoogleAgentAccess:async()=>{published.push({...access});},setGoogleAgentAccess:async change=>{Object.assign(access,change);dom.window.dispatchEvent(new dom.window.Event('alpha:device-settings'));}},
 };
 const compiled=transformSync(readFileSync('apps/app/src/runtime/google-connection-ui.tsx','utf8'),{loader:'tsx',jsx:'automatic',format:'cjs',target:'es2022'}).code;
 const module={exports:{}};
 const context=vm.createContext({module,exports:module.exports,require:name=>name==='react'||name==='react/jsx-runtime'?require(name):modules[name]??(()=>{throw Error('Unexpected import '+name);})(),window:dom.window,document:dom.window.document,getComputedStyle:dom.window.getComputedStyle,HTMLElement:dom.window.HTMLElement,AbortController,Event:dom.window.Event});
 vm.runInContext(compiled,context);
 const {GoogleConnectionsPanel,googleConnectionController}=module.exports;
 const root=createRoot(dom.window.document.getElementById('root'));
 const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
 try{
  googleConnectionController.open();
  await React.act(async()=>{root.render(React.createElement(GoogleConnectionsPanel));await flush();});
  const panel=dom.window.document.querySelector('[role="dialog"]');
  assert.equal(panel.style.getPropertyValue('--connection-bg'),'#121212');
  assert.equal(panel.style.getPropertyValue('--connection-acc'),'#95a0ff','Use the theme text accent, not its lower-contrast fill accent');
  assert.deepEqual(counts,{accounts:1,calendars:0});
  assert.equal(dom.window.document.querySelectorAll('input[type="radio"]').length,0,'No calendar picker: every calendar shown in Google is part of Calendar');
  assert.doesNotMatch(panel.textContent,/Calendar to display|Local calendars only/);
  assert.equal(panel.querySelector('[role="status"]').textContent,'Calendar includes the calendars you show in Google.');
  assert.ok([...dom.window.document.querySelectorAll('button')].some(button=>button.textContent==='Add account'));
  assert.equal([...dom.window.document.querySelectorAll('button')].some(button=>button.textContent==='Check Google connections'),false);
  await React.act(async()=>{dom.window.dispatchEvent(new dom.window.Event(ACCOUNTS));await flush();});
  assert.deepEqual(counts,{accounts:2,calendars:0});
  assert.deepEqual(published.at(-1),{gmailChanges:true,calendarEdits:true},'The agent host receives the default-on switches');
  assert.deepEqual(hostCalls,[],'Loading the default-on switches never enables browser host Calendar writes');
  {const gmail=dom.window.document.querySelector('[aria-label="Agent access to Google"] input[aria-label="Send email"]'),calendar=dom.window.document.querySelector('[aria-label="Agent access to Google"] input[aria-label="Edit events"]');
   assert.equal(gmail.checked,true,'Gmail changes default on when granted');assert.equal(calendar.checked,true,'Calendar edits default on when granted');
   await React.act(async()=>{gmail.click();await flush();});
   assert.equal(access.gmailChanges,false);assert.deepEqual(published.at(-1),{gmailChanges:false,calendarEdits:true});
   assert.equal(dom.window.document.querySelector('[aria-label="Agent access to Google"] input[aria-label="Send email"]').checked,false);
   assert.ok(dom.window.document.querySelector('[aria-label="Disconnect Google account owner@example.invalid"]'),'Turning a switch off never disconnects Google');
   assert.deepEqual(counts,{accounts:2,calendars:0},'Turning a switch off makes no provider request');
   await React.act(async()=>{dom.window.document.querySelector('[aria-label="Agent access to Google"] input[aria-label="Send email"]').click();await flush();});
   assert.equal(access.gmailChanges,true,'An existing grant turns back on with no new consent');}
  account.grantedCapabilities=['google.calendar.read','google.gmail.read'];
  await React.act(async()=>{dom.window.dispatchEvent(new dom.window.Event(ACCOUNTS));await flush();});
  assert.deepEqual(counts,{accounts:3,calendars:0});
  const switches=()=>Object.fromEntries([...dom.window.document.querySelectorAll('[aria-label="Agent access to Google"] input[role="switch"]')].map(input=>[input.getAttribute('aria-label'),input]));
  const agentAccess=dom.window.document.querySelector('[aria-label="Agent access to Google"]');
  assert.ok(agentAccess,'Connected Google exposes the agent access switches');
  assert.match(agentAccess.textContent,/Sends and edits always ask first/,'Provider consent must not imply the optional local-action setting bypasses send or Calendar review');
  assert.equal(switches()['Send email'].checked,false,'A switch whose grant is missing shows off');
  assert.match(agentAccess.textContent,/Needs Google approval/);
  let underlyingBack=0;dom.window.addEventListener('alpha-back',()=>underlyingBack++);
  const back=new dom.window.Event('alpha-back',{cancelable:true});
  await React.act(async()=>{dom.window.dispatchEvent(back);await flush();});
  assert.equal(back.defaultPrevented,true);assert.equal(underlyingBack,0);
  assert.equal(googleConnectionController.getSnapshot(),false);assert.equal(dom.window.document.querySelector('[role="dialog"]'),null);
 }finally{
  await React.act(async()=>root.unmount());dom.window.close();
  for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
 }
});
