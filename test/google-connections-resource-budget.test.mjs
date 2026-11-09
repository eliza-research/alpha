import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import {JSDOM} from 'jsdom';
import {tsImport} from 'tsx/esm/api';
const {cloudServiceName}=await tsImport(new URL('../apps/app/src/runtime/cloud-protocol.ts',import.meta.url).href,{parentURL:import.meta.url});

// Mount the actual panel. Only external account/Calendar I/O is replaced.
test('Google settings list accounts only, revalidate grants and own Android Back',async()=>{
 const dom=new JSDOM('<div class="os" style="--bg:#121212;--fg:#fff;--acct:#95a0ff;--acc:#0000ff"></div><div id="root"></div>',{url:'https://alpha.invalid'});
 const saved={window:globalThis.window,document:globalThis.document,HTMLElement:globalThis.HTMLElement,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const require=createRequire(import.meta.url),React=require('react'),{createRoot}=require('react-dom/client');
 const counts={accounts:0,calendars:0};
 const account={connectionId:'11111111-1111-4111-8111-111111111111',connected:true,label:'owner@example.invalid',grantedCapabilities:['google.calendar.read','google.calendar.write','google.gmail.read','google.gmail.send']};
 const binding={client:{},sessionId:'fixture-session',credentialId:'fixture-credential'};
 const snapshot={cloudAccount:{environment:'production',userId:'22222222-2222-4222-8222-222222222222',organizationId:'33333333-3333-4333-8333-333333333333'}};
 const ACCOUNTS='alpha:test-google-accounts';
 const modules={
  './cloud-protocol':{cloudServiceName},
  './gmail-background':{gmailBackgroundStatus:async()=>({status:'watching'}),gmailNotificationSettings:async()=>{},GMAIL_BACKGROUND_CHANGED:'alpha:test-gmail-background'},
  '../native':{isAndroid:true},
  './gmail-grants':{googleAccountAccessLabel:()=> 'Limited access'},
  './modal-inert':{holdPhoneInert:()=>()=>{}},
  './connection-ui':{connectionController:{subscribe:()=>()=>{},getSnapshot:()=>snapshot,getCloudClient:()=>binding,rejectCloudSession:()=>{throw Error('Unexpected rejection');}}},
  './google-accounts':{GOOGLE_ACCOUNTS_CHANGED:ACCOUNTS,createGoogleAccounts:()=>({list:async()=>{counts.accounts++;return [account];}})},
  './google-calendar':{GoogleCalendarReader:class {async listSources(){counts.calendars++;return {status:'ready',calendars:[]};}invalidate(){}}},
  './google-calendar-selection':{clearGoogleCalendarPrefsForConnection:()=>true},
  './google-connect-flow':{googleConnect:{start(){throw Error('Unexpected OAuth request');},getSnapshot:()=>'idle',subscribe:()=>()=>{}},googleConnectNote:()=>''},
 };
 const compiled=transformSync(readFileSync('apps/app/src/runtime/google-connection-ui.tsx','utf8'),{loader:'tsx',jsx:'automatic',format:'cjs',target:'es2022'}).code;
 const module={exports:{}};
 const context=vm.createContext({module,exports:module.exports,require:name=>name==='react'||name==='react/jsx-runtime'?require(name):modules[name]??(()=>{throw Error('Unexpected import '+name);})(),window:dom.window,document:dom.window.document,getComputedStyle:dom.window.getComputedStyle,HTMLElement:dom.window.HTMLElement,AbortController,Event:dom.window.Event});
 vm.runInContext(compiled,context);
 const {GoogleConnectionsPanel,googleConnectionController,gmailAlertLine}=module.exports;
 assert.equal(gmailAlertLine({status:'watching',lastSyncAt:1}),'');
 assert.equal(gmailAlertLine({status:'watching',notificationsAllowed:false}),'Gmail notifications are off.');
 assert.equal(gmailAlertLine({status:'disabled'}),'Open Inbox to finish setting up Gmail alerts.');
 assert.equal(gmailAlertLine({status:'retrying'}),'');
 const root=createRoot(dom.window.document.getElementById('root'));
 const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
 try{
  googleConnectionController.open();
  await React.act(async()=>{root.render(React.createElement(GoogleConnectionsPanel));await flush();});
  const panel=dom.window.document.querySelector('[role="dialog"]');
  assert.equal(panel.style.getPropertyValue('--connection-bg'),'#121212');
  assert.equal(panel.style.getPropertyValue('--connection-acc'),'#95a0ff','Use the theme text accent, not its lower-contrast fill accent');
  assert.deepEqual(counts,{accounts:1,calendars:0},'Settings lists accounts only; Calendar chooses which calendars show');
  assert.equal(dom.window.document.querySelectorAll('input[type="radio"],[role="radiogroup"]').length,0,'There is no "Calendar to display" picker');
  assert.equal(dom.window.document.querySelector('[role="dialog"]').textContent.includes('Watching for new unread'),false,'Normal Gmail watching shows no diagnostics');
  assert.equal([...dom.window.document.querySelectorAll('button')].some(button=>button.textContent==='Check Google connections'),false,'Coming back from Google refreshes; there is no Check button');
  await React.act(async()=>{dom.window.dispatchEvent(new dom.window.Event(ACCOUNTS));await flush();});
  assert.deepEqual(counts,{accounts:2,calendars:0});
  account.grantedCapabilities=['google.calendar.read','google.gmail.read'];
  await React.act(async()=>{dom.window.dispatchEvent(new dom.window.Event(ACCOUNTS));await flush();});
  assert.deepEqual(counts,{accounts:3,calendars:0});
  const buttons=[...dom.window.document.querySelectorAll('button')];
  assert.ok(buttons.some(button=>button.textContent==='Update Google access'),'Reduced grants offer one upgrade');
  assert.equal(buttons.find(button=>button.textContent==='Add Google account')?.className,'alpha-connection-cancel','Only the upgrade stays the primary pill');
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
