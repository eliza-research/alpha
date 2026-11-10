import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {transformSync} from 'esbuild';

/** The actual Google accounts panel. Only the Cloud account list, consent URL and browser open are synthetic. */
export async function mountGoogleAccountPanel(rows,{calendarEdits=true,gmailChanges=true,unreadable=false,saveFails=false,browser=false,host='current',observeAdmission=false}={}, dependencies){
 const {cloudServiceName,connectionReturn,workspaceReturn,gmailGrants,calendarLink}=dependencies;
 const dom=new JSDOM('<div class="os" style="--bg:#121212;--fg:#fff;--acct:#95a0ff;--acc:#0000ff"></div><div id="root"></div>',{url:'https://alpha.invalid'});
 let hidden=false;Object.defineProperty(dom.window.document,'hidden',{configurable:true,get:()=>hidden});
 const saved={window:globalThis.window,document:globalThis.document,HTMLElement:globalThis.HTMLElement,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const require=createRequire(import.meta.url),React=require('react'),{createRoot}=require('react-dom/client');
 const access={gmailChanges,calendarEdits},p={rows,access,unreadable,revision:0,consents:[],opens:0,lists:0,accessChanges:[],policy:[],onPolicy:null,disconnects:[],onDisconnect:null};
 let cloud={client:{},sessionId:'cloud-session',credentialId:'cloud-credential'};
 let snapshot={cloudAccount:{environment:'production',userId:'22222222-2222-4222-8222-222222222222',organizationId:'33333333-3333-4333-8333-333333333333'}};
 const connectionListeners=new Set();
 const live=binding=>{if(binding.credentialId!==cloud.credentialId)throw new DOMException('The Cloud account changed.','AbortError');};
 const modules={
  './cloud-protocol':{cloudServiceName},'./google-connection-return':connectionReturn,'./google-workspace-return':workspaceReturn,'./gmail-grants':gmailGrants,
  '../daily':{DailyApps:{addListener:async()=>({remove(){}})}},'../native':{isAndroid:false},
  // The browser Cloud stage's same-origin bridge: 'current' answers like Codex's proposed host, 'missing' like today's host.
  './browser-cloud-resident':{browserCloudResidentEnabled:browser,browserResidentCall:async(...call)=>{p.policy.push(call);p.onPolicy?.();if(host==='missing')throw Error('Cloud resident binding unavailable');return host==='wrong'?{}:{calendarEdits:call[2]};}},
  './gmail-background':{gmailBackgroundStatus:async()=>({}),gmailBackgroundMessage:()=>'',GMAIL_BACKGROUND_CHANGED:'alpha:test-gmail-background'},
  './modal-inert':{holdPhoneInert:()=>()=>{}},
  './connection-ui':{connectionController:{subscribe:listener=>{connectionListeners.add(listener);return()=>connectionListeners.delete(listener);},getSnapshot:()=>snapshot,getCloudClient:()=>cloud,rejectCloudSession:()=>{},openCloudAccount:()=>{throw Error('Unexpected sign-in');}}},
  // The actual Calendar link and disconnect lifecycle; only the Cloud account calls are synthetic.
  './google-accounts':{GOOGLE_ACCOUNTS_CHANGED:'alpha:test-google-accounts',googleDisconnectConfirmation:()=>'',googleDisconnectMessage:outcome=>`Disconnect ${outcome}.`,linkGoogleCalendar:calendarLink.linkGoogleCalendar,googleCalendarDisconnectLifecycle:calendarLink.googleCalendarDisconnectLifecycle,createGoogleAccounts:(binding,current,changed,calendar)=>({
   list:async signal=>{live(binding);p.lists++;if(p.listFails)throw Error('Cloud is unavailable');return p.onList?await p.onList(binding,signal):structuredClone(p.rows);},
   connect:async(signal,calendarPermission,gmailPermission)=>{live(binding);p.consents.push([calendarPermission,gmailPermission]);p.onConsent?.(binding,calendarPermission,gmailPermission);return 'https://accounts.google.com/o/oauth2/v2/auth';},
   // No Cloud disconnect runs: only what the panel hands the callsite is recorded.
   disconnect:async connectionId=>{live(binding);p.disconnects.push({connectionId,calendar});return {...(p.onRevoke?await p.onRevoke(binding):p.disconnectResult??{outcome:'disconnected',accounts:[]}),calendarLifecycle:p.onDisconnect?.(calendar,connectionId)??{calendarPause:'unavailable',callbackRetirement:'confirmed',providerDrain:'unavailable',pauseRequest:null}};},
  })},
  './google-calendar-selection':{clearGoogleCalendarSelectionForConnection:()=>{}},
  './native-connection':{openConnectionBrowser:async()=>{p.opens++;},googleWorkspaceReturnPort:undefined},
  // Like 3800a178e's google-agent-access: a fresh capture with a revision receipt, and a guarded save that rechecks it.
  './google-agent-access':{googleAgentAccess:()=>({...access}),publishGoogleAgentAccess:async()=>{},captureGoogleCalendarAccess:async()=>{await p.onCapture?.();return p.unreadable?undefined:{calendarEdits:access.calendarEdits,receipt:{revision:p.revision}};},setGoogleAgentAccess:async(change,guard)=>{if(saveFails)throw Error('Settings could not be saved');if(guard&&(!guard.current()||access.calendarEdits!==guard.expectedCalendarEdits||guard.receipt.revision!==p.revision))throw Error('Calendar choice changed. Review it again.');p.accessChanges.push({...change});Object.assign(access,change);p.revision++;p.unreadable=false;dom.window.dispatchEvent(new dom.window.Event('alpha:device-settings'));}},
 };
 // Use the current publication implementation: the old no-op stub hid host failures.
 let publicationQueue=Promise.resolve();
 const preferences=()=>({agentGmailChanges:access.gmailChanges,agentCalendarEdits:access.calendarEdits});
 const publicationModules={...modules,
  '@capacitor/core':{Capacitor:{isNativePlatform:()=>false}},
  './local-agent':{browserLocalAgentEnabled:browser},
  '../browser/device-preferences':{
   cachedDevicePreferences:()=>p.unreadable?undefined:preferences(),initializeDevicePreferences:()=>{},readDevicePreferences:async()=>preferences(),
   captureDevicePreferences:async()=>{await p.onCapture?.();if(p.unreadable)throw Error('Settings unavailable');return{state:preferences(),receipt:{revision:p.revision}};},
   editDevicePreferences:async(edit,_unused,receipt)=>{if(saveFails)throw Error('Settings could not be saved');if(receipt&&receipt.revision!==p.revision)throw Error('Calendar choice changed. Review it again.');const next=preferences();edit(next);const change={};if(next.agentGmailChanges!==access.gmailChanges)change.gmailChanges=next.agentGmailChanges;if(next.agentCalendarEdits!==access.calendarEdits)change.calendarEdits=next.agentCalendarEdits;if(Object.keys(change).length)p.accessChanges.push(change);Object.assign(access,{gmailChanges:next.agentGmailChanges,calendarEdits:next.agentCalendarEdits});p.revision++;p.unreadable=false;dom.window.dispatchEvent(new dom.window.Event('alpha:device-settings'));},
  },
 };
 const publication={exports:{}};
 vm.runInContext(transformSync(readFileSync(new URL('../../apps/app/src/runtime/google-agent-access.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code,vm.createContext({module:publication,exports:publication.exports,require:name=>publicationModules[name]??(()=>{throw Error('Unexpected publication import '+name);})(),navigator:{locks:{request:(_name,_options,operation)=>{const result=publicationQueue.then(operation);publicationQueue=result.catch(()=>{});return result;}}},fetch:async()=>({ok:true})}));
 modules['./google-agent-access']=publication.exports;
 let input=readFileSync(new URL('../../apps/app/src/runtime/google-connection-ui.tsx',import.meta.url),'utf8');
 if(observeAdmission){
  const marker=' async function load(){';
  assert.equal(input.split(marker).length,2,'One Google account readback observation seam');
  input=input.replace(marker,` window.quintGoogleConsent=()=>({read:accountRead(),busy,notice,choice,calendar:googleConnectionController.calendar()});
${marker}`);
 }
 const compiled=transformSync(input,{loader:'tsx',jsx:'automatic',format:'cjs',target:'es2022'}).code;
 const module={exports:{}};
 vm.runInContext(compiled,vm.createContext({module,exports:module.exports,require:name=>name==='react'||name==='react/jsx-runtime'?require(name):modules[name]??(()=>{throw Error('Unexpected import '+name);})(),window:dom.window,document:dom.window.document,getComputedStyle:dom.window.getComputedStyle,HTMLElement:dom.window.HTMLElement,AbortController,DOMException,Event:dom.window.Event}));
 const {GoogleConnectionsPanel,googleConnectionController}=module.exports;
 const root=createRoot(dom.window.document.getElementById('root'));
 const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
 const act=async(action)=>React.act(async()=>{await action?.();for(let i=0;i<4;i++)await tick();});
 Object.assign(p,{controller:googleConnectionController,act,
  button:name=>[...dom.window.document.querySelectorAll('button')].find(button=>button.textContent===name||button.getAttribute('aria-label')===name),
  toggle:name=>dom.window.document.querySelector(`input[role="switch"][aria-label="${name}"]`),
  status:()=>dom.window.document.querySelector('[role="status"]')?.textContent??'',
  text:()=>dom.window.document.querySelector('[role="dialog"]')?.textContent??'',
  until:async(check,label)=>{for(let i=0;i<100&&!check();i++)await act();assert.ok(check(),label);},
  changeCloud:()=>{cloud={...cloud,credentialId:'other-credential'};},
  replaceCloud:()=>{cloud={...cloud,client:{},sessionId:'other-session',credentialId:'other-credential'};snapshot={...snapshot};for(const listener of connectionListeners)listener();},
  inspectAdmission:()=>dom.window.quintGoogleConsent(),
  currentBinding:()=>cloud,
  dispatch:name=>act(()=>dom.window.dispatchEvent(new dom.window.Event(name))),
  /** Google's consent screen took the app to the background; coming back is the only return signal. */
  returnFromGoogle:()=>act(()=>{for(const state of [true,false]){hidden=state;dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));}}),
  close:async()=>{await act(()=>googleConnectionController.close());await act(()=>root.unmount());dom.window.close();for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}},
 });
 await act(()=>root.render(React.createElement(GoogleConnectionsPanel)));
 return p;
}
