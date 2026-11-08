import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';
import {prepareGoogleWorkspaceReturn,watchGoogleWorkspaceReturn,sameGoogleWorkspaceBinding} from '../apps/app/src/runtime/google-workspace-return.ts';
import {watchGoogleConnectionReturn,sameGoogleConnectionReturnBinding} from '../apps/app/src/runtime/google-connection-return.ts';

const ui=readFileSync(process.env.ALPHA_GOOGLE_RETURN_UI_SOURCE||'apps/app/src/runtime/google-connection-ui.tsx','utf8');
const accountsSource=stripTypeScriptTypes(readFileSync('apps/app/src/runtime/google-accounts.ts','utf8'),{mode:'strip'}).replace(/^import[^;]+;\n/gm,'').replace(/^export /gm,'');
const createGoogleAccounts=vm.runInNewContext(accountsSource+';createGoogleAccounts',{DOMException,Event});
const loadCode=stripTypeScriptTypes(ui.slice(ui.indexOf(' async function load()'),ui.indexOf('\n useEffect(()=>{if(!open)return;void load();')),{mode:'strip'});
const connectCode=stripTypeScriptTypes(ui.slice(ui.indexOf(' async function connect('),ui.indexOf(' async function disconnect(')),{mode:'strip'});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function fixture({heldStatus=false,heldOpen=false,heldRetry=false,panelClosed=false,accountRows}={}){
 let foreground=true,panelOpen=!panelClosed,revision=0,nativeListener,removed=0,visibility,focus;
 const registration=deferred(),status=deferred(),opening=deferred(),retry=deferred(),published=[],notices=[],scopeCalls=[];
 let reads=0,initiations=0,opens=0,waits=0,statusSignal,loadPromise;
 const client={environment:'production',async gmailAccounts(signal){reads++;statusSignal=signal;return heldStatus?status.promise:typeof accountRows==='function'?accountRows(reads):accountRows??[{connected:true,label:'Synthetic account',grantedCapabilities:['google.gmail.triage']}];},async initiateGoogle(signal,calendar,gmail){signal.throwIfAborted();initiations++;scopeCalls.push([calendar,gmail]);return 'https://accounts.google.com/o/oauth2/v2/auth';}};
 const binding={client,environment:'production',userId:'owner',organizationId:'tenant',sessionId:'session',credentialId:'credential'};
 let current={...binding};const active={current:null};
 const liveCloud=()=>current?{client:current.client,sessionId:current.sessionId,credentialId:current.credentialId}:null;
 const globals={identity:"synthetic",AbortController,DOMException,returnedWorkspace:{current:null},returnedWorkspaceOwner:{current:null},disconnectNotice:{current:null},sameGoogleWorkspaceBinding,prepareGoogleWorkspaceReturn,watchGoogleWorkspaceReturn,googleWorkspaceReturnPort:undefined,currentWorkspaceBinding:()=>current,createGoogleAccounts,sameGoogleConnectionReturnBinding,active,binding,cloud:liveCloud(),key:{environment:'production',userId:'owner',organizationId:'tenant'},serviceName:'Cloud',googleConnectionController:{getSnapshot:()=>panelOpen,close:()=>{panelOpen=false;},open:()=>{panelOpen=true;},calendar:()=>null},connectionController:{getCloudClient:liveCloud,rejectCloudSession(){throw Error('Unexpected sign-in mutation');},openCloudAccount(){throw Error('Unexpected sign-in');}},currentGoogleConnectionReturnBinding:()=>current,
  setRevision:update=>{revision=update(revision);loadPromise=globals.load();},setAccounts:rows=>published.push(rows),setConfirm(){},setBusy(){},setNotice:text=>notices.push(text),
  openConnectionBrowser:async()=>{opens++;return heldOpen?opening.promise:undefined;},returnWatch:{current:null},
  setTimeout(callback,delay){assert.equal(delay,350);waits++;if(heldRetry)void retry.promise.then(callback);else queueMicrotask(callback);},
  clearTimeout(){},
 };
 vm.createContext(globals);vm.runInContext(loadCode+'\n'+connectCode+';globalThis.load=load;globalThis.connect=connect;',globals);
 const watcher=watchGoogleConnectionReturn({binding,current:()=>current,foreground:()=>foreground,refresh:()=>{revision++;active.current?.abort();loadPromise=globals.load();},
  onVisibilityChange:listener=>{visibility=listener;return()=>{visibility=undefined;};},onFocus:listener=>{focus=listener;return()=>{focus=undefined;};},
  onNativeResume:listener=>{nativeListener=listener;return registration.promise;},
 });globals.returnWatch.current=watcher;
 return {binding,client,watcher,globals,published,notices,scopeCalls,
  get panelOpen(){return panelOpen;},get reads(){return reads;},get initiations(){return initiations;},get opens(){return opens;},get waits(){return waits;},get revision(){return revision;},get removed(){return removed;},get signal(){return statusSignal;},get loadPromise(){return loadPromise;},
  registered(){registration.resolve({remove(){removed++;}});return watcher.ready;},
  background(){foreground=false;visibility?.();},foreground(){foreground=true;visibility?.();},nativeResume(){nativeListener?.();},focus(){focus?.();},
  change(patch){current={...current,...patch};},close(){panelOpen=false;watcher.close();active.current?.abort();},
  releaseStatus(){status.resolve([{connected:true,label:'Synthetic account',grantedCapabilities:['google.gmail.triage']}]);},releaseOpen(){opening.resolve();},releaseRetry(){retry.resolve();},
 };
}

test('retained native resume after registration and arming cannot consume a return before background or open completion',async()=>{
 const f=fixture({heldOpen:true});await f.registered();const connecting=f.globals.connect();for(let i=0;i<8&&f.opens===0;i++)await Promise.resolve();assert.equal(f.opens,1);
 f.nativeResume();f.focus();assert.equal(f.reads,0);assert.equal(f.revision,0);
 f.background();f.nativeResume();assert.equal(f.reads,0,'still background');f.releaseOpen();await connecting;assert.equal(f.reads,0,'external promise completion is not foreground');
 f.foreground();f.nativeResume();f.focus();await f.loadPromise;assert.equal(f.reads,1);assert.equal(f.revision,1);assert.equal(f.initiations,1);f.close();
});
test('immediate browser-open completion leaves a pending genuine return and duplicate events load once',async()=>{
 const f=fixture();await f.registered();await f.globals.connect();assert.equal(f.opens,1);assert.equal(f.reads,0);f.nativeResume();f.focus();assert.equal(f.reads,0);
 f.background();f.foreground();f.nativeResume();f.focus();await f.loadPromise;assert.equal(f.reads,1);assert.equal(f.published.at(-1)[0].connected,true);assert.equal(f.initiations,1);f.close();
});
test('foreground events without an authorization attempt never load connections',async()=>{
 const f=fixture();await f.registered();f.background();f.foreground();f.nativeResume();f.focus();assert.equal(f.reads,0);f.close();
});
for(const [field,value] of [['environment','staging'],['userId','other-owner'],['organizationId','other-tenant'],['sessionId','other-session'],['credentialId','other-credential'],['client',{}]]){
 test(`${field} change before foreground retires the original pending return`,async()=>{
  const f=fixture();await f.globals.connect();f.background();f.change({[field]:value});f.foreground();f.nativeResume();assert.equal(f.reads,0);assert.equal(f.revision,0);f.close();
 });
 test(`${field} change during canonical status cannot publish a connected account`,async()=>{
  const f=fixture({heldStatus:true});await f.globals.connect();f.background();f.foreground();assert.equal(f.reads,1);f.change({[field]:value});f.releaseStatus();await f.loadPromise;assert.ok(f.published.every(rows=>rows.length===0));f.close();
 });
}
test('panel close aborts canonical read and ignores all late lifecycle/status callbacks',async()=>{
 const f=fixture({heldStatus:true});await f.globals.connect();f.background();f.foreground();assert.equal(f.reads,1);f.close();assert.equal(f.signal.aborted,true);f.releaseStatus();await f.loadPromise;f.nativeResume();f.focus();assert.equal(f.reads,1);assert.ok(f.published.every(rows=>rows.length===0));
});
test('cleanup removes a native listener whose registration resolves after the panel closed',async()=>{
 const f=fixture();f.close();await f.registered();assert.equal(f.removed,1);f.nativeResume();assert.equal(f.reads,0);f.close();assert.equal(f.removed,1);
});
test('ordinary cleanup removes a resolved native listener exactly once',async()=>{
 const f=fixture();await f.registered();f.close();f.close();assert.equal(f.removed,1);
});
test('permission requests are forwarded unchanged and no return starts another OAuth request',async()=>{
 const f=fixture();await f.globals.connect('modify','write');assert.equal(JSON.stringify(f.scopeCalls),JSON.stringify([['write','modify']]));f.background();f.foreground();await f.loadPromise;assert.equal(f.initiations,1);f.close();
});
test('a failed external open cancels only its own pending return',async()=>{
 const f=fixture();f.globals.openConnectionBrowser=async()=>{throw new DOMException('Cancelled','AbortError');};f.globals.connectionController.rejectCloudSession=()=>{};await f.globals.connect();f.background();f.foreground();assert.equal(f.reads,0);f.close();
});
test('the actual panel lifecycle wiring uses the existing native port and removes document/window listeners',()=>{
 assert.match(ui,/DailyApps\.addListener\('appResumed',listener\)/);assert.match(ui,/document\.addEventListener\('visibilitychange',listener\)/);assert.match(ui,/window\.addEventListener\('focus',listener\)/);assert.match(ui,/watcher\.close\(\).*active\.current\?\.abort\(\)/s);
 assert.ok(!ui.includes('appUrlOpen'));assert.ok(!ui.includes('google_connected'));assert.ok(!ui.includes('completeOAuth'));
});

test('a stale panel binding cannot initiate a new Google authorization',async()=>{
 const f=fixture();f.change({organizationId:'new-tenant'});await f.globals.connect();assert.equal(f.initiations,0);assert.equal(f.opens,0);f.close();
});
test('a binding change while an authorization URL is pending cannot arm or open the browser',async()=>{
 const f=fixture(),authorization=deferred();f.client.initiateGoogle=()=>authorization.promise;const connecting=f.globals.connect();await Promise.resolve();f.change({organizationId:'new-tenant'});authorization.resolve('https://accounts.google.com/o/oauth2/v2/auth');await connecting;assert.equal(f.opens,0);f.background();f.foreground();assert.equal(f.reads,0);f.close();
});

test('a still-referenced watcher from the prior panel generation cannot initiate under a freshly rendered binding',async()=>{
 const f=fixture();f.change({organizationId:'new-tenant'});f.globals.binding={...f.binding,organizationId:'new-tenant'};await f.globals.connect();assert.equal(f.initiations,0);assert.equal(f.opens,0);f.close();
});

function mountActualLifecycle(){
 const start=ui.indexOf(' useEffect(()=>{\n  if(!open||!binding)return;');
 if(start<0)return null;
 const prefix=' useEffect(()=>{',end=ui.indexOf('\n },[open,identity,cloud?.client]);',start);
 const body=stripTypeScriptTypes('(function(){'+ui.slice(start+prefix.length,end)+'\n})',{mode:'strip'});
 const document=Object.assign(new EventTarget(),{hidden:false}),window=new EventTarget(),registration=deferred();let nativeCallback,removed=0,revision=0;
 const binding={client:{},environment:'production',userId:'owner',organizationId:'tenant',sessionId:'session',credentialId:'credential'},active={current:new AbortController()},returnWatch={current:null};
 const mount=vm.runInNewContext(body,{open:true,binding,watchGoogleConnectionReturn,currentGoogleConnectionReturnBinding:()=>binding,document,window,isAndroid:true,DailyApps:{addListener(name,callback){assert.equal(name,'appResumed');nativeCallback=callback;return registration.promise;}},returnWatch,active,setRevision:update=>{revision=update(revision);}});
 const cleanup=mount();return {document,window,returnWatch,active,cleanup,native:()=>nativeCallback?.(),resolveRegistration(){registration.resolve({remove(){removed++;}});return returnWatch.current?.ready??Promise.resolve();},get removed(){return removed;},get revision(){return revision;}};
}
test('actual panel lifecycle effect retains late cached events, refreshes once after background and aborts on cleanup',async()=>{
 const h=mountActualLifecycle();assert.ok(h,'panel must mount the owned lifecycle helper');await h.resolveRegistration();h.returnWatch.current.arm();h.native();assert.equal(h.revision,0);
 h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));h.native();assert.equal(h.revision,0);
 h.document.hidden=false;h.window.dispatchEvent(new Event('focus'));h.native();h.document.dispatchEvent(new Event('visibilitychange'));assert.equal(h.revision,1);
 h.cleanup();assert.equal(h.active.current.signal.aborted,true);assert.equal(h.returnWatch.current,null);assert.equal(h.removed,1);h.native();h.window.dispatchEvent(new Event('focus'));assert.equal(h.revision,1);
});
test('actual panel cleanup also retires a native registration that resolves later',async()=>{
 const h=mountActualLifecycle();assert.ok(h);const ready=h.returnWatch.current.ready;h.cleanup();h.resolveRegistration();await ready;assert.equal(h.removed,1);h.native();assert.equal(h.revision,0);
});

const workspaceEffect=ui.slice(ui.indexOf(' useEffect(()=>{\n  const port=googleWorkspaceReturnPort'),ui.indexOf(' useEffect(()=>{if(!open)return;const accountsChanged'));
const grant=connectionId=>({connected:true,connectionId,label:'Synthetic',grantedCapabilities:['google.gmail.triage']});
function mountConnectedWorkspace(f){
 let cleanup,consumed=false;
 f.globals.googleWorkspaceReturnPort={async subscribe(){return{remove(){}}},async consume(){if(consumed)return{result:'none'};consumed=true;return{result:'connected',connectionId:'owned'};}};
 f.globals.useEffect=effect=>{cleanup=effect();};vm.runInNewContext(workspaceEffect,f.globals);
 return ()=>{cleanup?.();f.close();};
}
for(const hasGrant of [true,false])test('actual closed panel callback opens only after native admission and verifies grant '+hasGrant,async()=>{
 const rows=hasGrant?[grant('owned')]:[grant('different')];
 const f=fixture({panelClosed:true,accountRows:rows}),close=mountConnectedWorkspace(f);
 for(let i=0;i<10;i++)await Promise.resolve();await f.loadPromise;
 assert.equal(f.panelOpen,true);assert.equal(f.reads,hasGrant?1:2);assert.deepEqual(f.published.at(-1),rows);
 assert.equal(f.notices.some(text=>text.includes('could not be verified')),!hasGrant);close();
});
test('a delayed workspace grant is verified on the second read without reopening authorization',async()=>{
 const other=grant('different'),owned=grant('owned');
 const f=fixture({panelClosed:true,accountRows:read=>read===1?[other]:[other,owned]}),close=mountConnectedWorkspace(f);
 const linked=[];f.globals.googleConnectionController.calendar=()=>({authorizing:true});
 f.globals.linkCalendar=async(_intent,rows)=>linked.push(...rows);
 for(let i=0;i<10;i++)await Promise.resolve();await f.loadPromise;
 assert.equal(f.reads,2);assert.equal(f.waits,1);assert.equal(f.initiations,0);assert.deepEqual(f.published.at(-1),[other,owned]);
 assert.deepEqual(linked,[owned]);assert.ok(!f.notices.some(text=>text.includes('could not be verified')));close();
});
for(const retire of ['panel close','owner change','new return'])test(`workspace readback does not retry after ${retire}`,async()=>{
 const f=fixture({panelClosed:true,heldRetry:true,accountRows:[]}),close=mountConnectedWorkspace(f);
 for(let i=0;i<20&&!f.waits;i++)await Promise.resolve();assert.equal(f.waits,1);
 if(retire==='panel close')f.close();
 else if(retire==='owner change')f.change({userId:'other-owner'});
 else f.globals.returnedWorkspace.current={result:'connected',connectionId:'different'};
 f.releaseRetry();await f.loadPromise;
 assert.equal(f.reads,1);assert.equal(f.initiations,0);assert.ok(!f.notices.some(text=>text.includes('could not be verified')));close();
});
test('actual closed panel ignores unaccepted native callback without opening or reading',async()=>{
 const f=fixture({panelClosed:true});let cleanup;f.globals.googleWorkspaceReturnPort={async subscribe(){return{remove(){}}},async consume(){return{result:'none'}}};f.globals.useEffect=effect=>{cleanup=effect();};vm.runInNewContext(workspaceEffect,f.globals);
 for(let i=0;i<8;i++)await Promise.resolve();assert.equal(f.panelOpen,false);assert.equal(f.reads,0);cleanup?.();f.close();
});


const disconnectCode=stripTypeScriptTypes(ui.slice(ui.indexOf(' async function disconnect('),ui.indexOf(' /** Explicit Connect persists')),{mode:'strip'});
function disconnectFixture(){
 const f=fixture(),operation=deferred(),cleared=[];
 f.globals.createGoogleAccounts=()=>({disconnect:()=>operation.promise,list:async()=>[]});
 f.globals.clearGoogleCalendarSelectionForConnection=(...args)=>cleared.push(args);
 f.globals.googleDisconnectMessage=(_outcome,label)=>'Disconnected '+label;
 vm.runInNewContext(disconnectCode,f.globals);
 return {...f,cleared,complete:()=>operation.resolve({outcome:'disconnected',accounts:[],calendarLifecycle:{calendarPause:'not-requested'}})};
}
test('a completed disconnect notice survives one same-owner account refresh',async()=>{
 const f=disconnectFixture(),pending=f.globals.disconnect({connectionId:'grant-a',label:'Synthetic account'});
 f.complete();await pending;
 assert.equal(f.notices.at(-1),'Disconnected Synthetic account');assert.equal(f.cleared.length,1);
 await f.globals.load();assert.equal(f.notices.at(-1),'Disconnected Synthetic account');
 await f.globals.load();assert.equal(f.notices.at(-1),'No Google account connected.');f.close();
});
for(const change of ['owner','close','new-operation'])test(`a disconnect completion after ${change} retirement publishes nothing`,async()=>{
 const f=disconnectFixture(),pending=f.globals.disconnect({connectionId:'grant-a',label:'Private account label'});
 if(change==='owner')f.change({userId:'replacement-owner'});
 else if(change==='close')f.close();
 else f.globals.active.current=new AbortController();
 f.complete();await pending;
 assert.equal(f.cleared.length,0);assert.equal(f.globals.disconnectNotice.current,null);
 assert.ok(!f.notices.some(text=>text.includes('Private account label')));assert.equal(f.published.length,0);f.close();
});
test('a retained disconnect notice cannot cross to a replacement owner',async()=>{
 const f=disconnectFixture();f.globals.disconnectNotice.current={binding:f.binding,message:'Private prior account label'};
 f.change({userId:'replacement-owner'});f.globals.binding={...f.binding,userId:'replacement-owner'};
 await f.globals.load();assert.ok(!f.notices.some(text=>text.includes('Private prior account label')));
 assert.equal(f.globals.disconnectNotice.current,null);f.close();
});
