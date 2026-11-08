import {parseNativeHistoryCommand} from '../.eliza/client-features/plugins/plugin-browser/src/native-client-command.ts';
import {parseBrowserAddressInput} from '../.eliza/client-features/plugins/plugin-native-browser-surface/src/address-input.ts';
// The adapter's native tabs are the shared session model; the harnesses run the real one.
import {BrowserTabSession} from '../.eliza/client-features/plugins/plugin-native-browser-surface/src/tab-host.ts';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';import vm from 'node:vm';
const source=readFileSync(process.env.ALPHA_BROWSER_ADAPTER_SOURCE||'apps/app/src/prototype/browser-adapter.ts','utf8');
const region=stripTypeScriptTypes(source.slice(source.indexOf('  async function navigate('),source.indexOf('  async function command(')),{mode:'transform'});
function harness(){let release;const pending=new Promise(resolve=>release=resolve),state={cur:'owned',tabs:[{id:'owned'},{id:'other'}],editing:true,tabsOpen:true,menu:true},navigations=[],patches=[],closed=[];const tabs=new BrowserTabSession({session:'owned-session'});void tabs.ensure('owned',false,()=>pending);
 const context={URL,Error,parseBrowserAddressInput,session:"owned-session",disposed:false,state:()=>state,isPrivate:()=>false,newTabId:()=> 'owned',restored:new Map(),tabs,restoreAttempts:new Map(),ensure:id=>tabs.creation(id)??tabs.ensure(id,false,()=>pending),shell:{vset(_key,patch){patches.push(patch);Object.assign(state,patch);}},Browser:{async navigate(input){navigations.push(input);},async close(input){closed.push(input);}},refresh(){},report(){}};
 const navigate=vm.runInNewContext(region+';navigate',context);return {state,tabs,navigations,patches,closed,release,navigate};}
test('closing a tab while native creation is pending cannot resurrect or navigate it',async()=>{const h=harness(),task=h.navigate('https://example.com');h.state.tabs=[{id:'other'}];h.state.cur='other';h.tabs.forget(['owned']);h.release();await task;assert.equal(h.navigations.length,0);assert.equal(h.patches.length,0);});
test('switching while creation is pending keeps the new tab’s editor and switcher state',async()=>{const h=harness(),task=h.navigate('https://example.com');h.state.cur='other';h.release();await task;assert.equal(h.navigations.length,0);assert.equal(h.state.editing,true);assert.equal(h.state.tabsOpen,true);});
test('unchanged tab still navigates once and exits its own address editor',async()=>{const h=harness(),task=h.navigate('https://example.com');h.release();await task;assert.equal(h.navigations.length,1);assert.equal(h.state.editing,false);});

test('address bar keeps the localhost alias and the shared classification',async()=>{for(const [typed,expected] of [['localhost','https://localhost/'],['localhost/notes?a=1','https://localhost/notes?a=1'],['localhost:3000','https://localhost:3000/'],['example.com','https://example.com/']]){const h=harness(),task=h.navigate(typed);h.release();await task;assert.equal(h.navigations.length,1,typed);assert.equal(h.navigations[0].url,expected,typed);}
 const search=harness(),task=search.navigate('localhost tips');search.release();await task;assert.equal(new URL(search.navigations[0].url).searchParams.get('q'),'localhost tips');});
test('time-like digit:digit input searches while real host:port, IPv4 and IPv6 stay addresses',async()=>{
 for(const typed of ['10:30','3:16','1:1',' 12:00 ']){const h=harness(),task=h.navigate(typed);h.release();await task;assert.equal(h.navigations.length,1,typed);const url=new URL(h.navigations[0].url);assert.equal(url.origin+url.pathname,'https://www.google.com/search',typed);assert.equal(url.searchParams.get('q'),typed.trim(),typed);}
 for(const [typed,expected] of [['nas:8080','https://nas:8080/'],['127.0.0.1:8080','https://127.0.0.1:8080/'],['192.168.1.1','https://192.168.1.1/'],['[::1]:8080','https://[::1]:8080/'],['[::1]','https://[::1]/'],['example.com:8443/x','https://example.com:8443/x']]){const h=harness(),task=h.navigate(typed);h.release();await task;assert.equal(h.navigations.length,1,typed);assert.equal(h.navigations[0].url,expected,typed);}});

test('cancelled approved new-tab creation closes its orphan and never navigates',async()=>{const h=harness(),abort=new AbortController();const task=h.navigate('https://example.com',true,abort.signal);abort.abort();h.release();await assert.rejects(task);assert.equal(h.navigations.length,0);assert.equal(h.closed.length,1);assert.equal(h.tabs.ids().length,0);});

const commandSource=stripTypeScriptTypes(source.slice(source.indexOf('    this.browserCommand = async'),source.indexOf('    this.browserNavigateApproved =')),{mode:'transform'});
function commandHarness(){let selected='owned',navigation='nav-1',activeView='browser',disposed=false;const calls=[];const info={navigation:'nav-1',committed:true,error:'',loading:false};const metadata=new Map([['owned',info]]);const state=()=>({cur:selected});
 const context={parseNativeHistoryCommand,Capacitor:{isNativePlatform:()=>true},document:{hidden:false},session:'native-session',get disposed(){return disposed;},shell:{S:()=>({view:activeView})},state,metadata,tabInfo:id=>metadata.get(id),tabs:{has:id=>id==='owned'},Browser:{async command(input){calls.push(input);return {session:'native-session',id:selected};}}};
 const execute=vm.runInNewContext('(function(){'+commandSource+';return this.browserCommand;}).call({})',context);return {execute,calls,metadata,tab:()=>selected='foreign',view:()=>activeView='notes',dispose:()=>disposed=true};}
for(const subaction of ['back','forward','reload'])test(`agent ${subaction} binds the current native tab and document, with dispatch-only receipt`,async()=>{const h=commandHarness();const r=await h.execute({subaction},new AbortController().signal,()=>{});assert.equal(h.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])),{session:'native-session',id:'owned',command:subaction,navigation:'nav-1'});assert.equal(r.ok,true);assert.equal(r.data.completed,false);assert.equal(r.data.requiresReadback,true);});
test('foreign selected tab, view, owner and unsupported command cannot reach native Browser',async()=>{for(const change of ['tab','view','dispose','owner','command']){const h=commandHarness();if(['tab','view','dispose'].includes(change))h[change]();await assert.rejects(h.execute(change==='command'?{subaction:'back',id:'server-tab'}:{subaction:'back'},new AbortController().signal,()=>{if(change==='owner')throw Error('Owner changed');}));assert.equal(h.calls.length,0);}});
test('cancellation never repeats a native browser command',async()=>{const h=commandHarness(),c=new AbortController();c.abort();await assert.rejects(h.execute({subaction:'reload'},c.signal,()=>{}));assert.equal(h.calls.length,0);});

const stateChangedStart="  void Browser.addListener('stateChanged',";
const stateChangedSource=stripTypeScriptTypes(source.slice(source.indexOf(stateChangedStart)+stateChangedStart.length,source.indexOf(').then((value:any)=>{listener=value;})',source.indexOf(stateChangedStart))),{mode:'transform'});
function committedPageHarness({native=false,privateTab=false}={}){
 const current={cur:'owned',visits:[]},tabs=new BrowserTabSession({session:'session'});void tabs.ensure('owned',privateTab,async()=>undefined);
 const context={session:'session',tabs,reading:false,stopReading(){},lastGeometry:'',MAX_HISTORY:100,Capacitor:{isNativePlatform:()=>native},state:()=>current,isPrivate:()=>privateTab,shell:{vset(_key,patch){Object.assign(current,patch);}},refresh(){}};
 const receive=vm.runInNewContext('const receive = '+stateChangedSource+';receive',context);
 const event={session:'session',id:'owned',sequence:1,navigation:1,url:'http://127.0.0.1/article',committed:true,loading:false,error:''};
 return {current,metadata:{get:id=>tabs.info(id)},receive,event};
}
test('confirmed embedded and native pages retain normal tabs and bounded history',()=>{
 for(const native of [false,true]){
  const h=committedPageHarness({native});h.receive(h.event);h.receive({...h.event,sequence:2});
  assert.equal(h.metadata.get('owned').savedUrl,h.event.url);
  assert.deepEqual(Array.from(h.current.visits),[h.event.url]);
 }
});
test('private and unconfirmed page events never add browsing history',()=>{
 const privatePage=committedPageHarness({privateTab:true});privatePage.receive(privatePage.event);assert.equal(privatePage.current.visits.length,0);
 for(const change of [{externalOnly:true},{committed:false},{loading:true},{error:'Navigation failed'}]){
  const h=committedPageHarness();h.receive({...h.event,...change});
  assert.equal(h.current.visits.length,0);assert.equal(h.metadata.get('owned').savedUrl,undefined);
 }
});

// Both the manual and approved paths execute the adapter's existing navigate().
// The bridge is deterministic here; no website, model or device is contacted.
const approvedSource=stripTypeScriptTypes(source.slice(source.indexOf('    this.browserNavigateApproved ='),source.indexOf('    // Identity only:')),{mode:'transform'});
function approvedHarness({native=false,deferred=false,failNavigate=false}={}){
 let release,disposed=false,creations=0;
 const pending=deferred?new Promise(resolve=>{release=resolve;}):Promise.resolve();
 const state={cur:'existing',tabs:[{id:'existing',hist:['newtab'],pos:0}],editing:true,tabsOpen:true,menu:true};
 const calls=[],closed=[],opened=[],tabs=new BrowserTabSession({session:'reviewed-session'});
 const context={URL,Error,parseBrowserAddressInput,document:{hidden:false},Capacitor:{isNativePlatform:()=>native},session:'reviewed-session',get disposed(){return disposed;},profileUnsupportedTab:undefined,state:()=>state,isPrivate:()=>false,newTabId:()=> 'approved-tab',restored:new Map(),tabs,restoreAttempts:new Map(),
  ensure(id){creations++;return tabs.creation(id)??tabs.ensure(id,false,()=>pending);},
  shell:{vset(_key,patch){Object.assign(state,patch);},openView(...args){opened.push({args,tab:state.cur,bridgeCalls:calls.length});}},
  Browser:{async navigate(input){calls.push(input);if(failNavigate)throw Error('Bridge navigation failed');},async close(input){closed.push(input);}},refresh(){},report(){}};
 const methods=vm.runInNewContext('(function(){'+region+'\n'+approvedSource+'\nreturn {manual:navigate,approved:this.browserNavigateApproved};}).call({})',context);
 return {...methods,state,calls,closed,opened,metadata:{get:id=>tabs.info(id)},created:{get size(){return tabs.ids().length;}},get creations(){return creations;},release:()=>release?.(),dispose:()=>{disposed=true;}};
}
for(const native of [false,true]){
 const platform=native?'native':'web preview';
 test(`${platform} approved HTTPS uses the manual bridge path and keeps its new tab across view opening`,async()=>{
  const h=approvedHarness({native});
  await h.manual('https://example.com');
  assert.equal(h.calls.length,1,'manual navigation is already supported');
  assert.equal(typeof h.approved,'function','approved navigation must use that registered platform implementation');
  await h.approved('https://example.com/path?q=1',new AbortController().signal);
  assert.equal(h.calls.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1])),{session:'reviewed-session',id:'approved-tab',url:'https://example.com/path?q=1'});
  assert.deepEqual(Array.from(h.state.tabs,tab=>tab.id),['existing','approved-tab']);
  assert.deepEqual(JSON.parse(JSON.stringify(h.opened)),[{args:['browser',null,null,{restore:true}],tab:'approved-tab',bridgeCalls:2}]);
  assert.equal(h.metadata.get('approved-tab').committed,false,'dispatch does not prove a loaded page');
 });
 test(`${platform} approved navigation retains its HTTPS and credential restrictions`,async()=>{
  for(const url of ['http://example.com','javascript:alert(1)','https://user:password@example.com','not a URL']){
   const h=approvedHarness({native});assert.equal(typeof h.approved,'function');
   await assert.rejects(h.approved(url,new AbortController().signal));
   assert.equal(h.creations,0);assert.equal(h.calls.length,0);assert.equal(h.opened.length,0);
  }
 });
 test(`${platform} approved navigation cancellation closes the new orphan without dispatch or replay`,async()=>{
  const h=approvedHarness({native,deferred:true}),controller=new AbortController();assert.equal(typeof h.approved,'function');
  const task=h.approved('https://example.com',controller.signal);controller.abort();h.release();
  await assert.rejects(task);assert.equal(h.calls.length,0);assert.equal(h.closed.length,1);assert.equal(h.created.size,0);assert.equal(h.opened.length,0);
 });
 test(`${platform} approved navigation propagates bridge failure without opening or retrying`,async()=>{
  const h=approvedHarness({native,failNavigate:true});assert.equal(typeof h.approved,'function');
  await assert.rejects(h.approved('https://example.com',new AbortController().signal),/Bridge navigation failed/);
  assert.equal(h.calls.length,1);assert.equal(h.opened.length,0);
 });
 test(`${platform} approved navigation refuses a changed tab while creation is pending`,async()=>{
  const h=approvedHarness({native,deferred:true});assert.equal(typeof h.approved,'function');
  const task=h.approved('https://example.com',new AbortController().signal);h.state.cur='foreign';h.release();
  await assert.rejects(task,/Browser tab changed/);assert.equal(h.calls.length,0);assert.equal(h.closed.length,1);assert.equal(h.opened.length,0);
 });
 test(`${platform} approved navigation refuses adapter disposal while creation is pending`,async()=>{
  const h=approvedHarness({native,deferred:true});assert.equal(typeof h.approved,'function');
  const task=h.approved('https://example.com',new AbortController().signal);h.dispose();h.release();
  await assert.rejects(task,/Browser closed/);assert.equal(h.calls.length,0);assert.equal(h.closed.length,1);assert.equal(h.opened.length,0);
 });
}

for(const native of [false,true]){
 const platform=native?'native':'web preview';
 test(`${platform} deferred approved dispatch preserves the original selected tab until presentation`,async()=>{
  const h=approvedHarness({native}),present=await h.approved('https://example.com',new AbortController().signal,true);
  assert.equal(h.calls.length,1);assert.equal(h.state.cur,'existing');assert.equal(h.opened.length,0);assert.equal(typeof present,'function');
  present();assert.equal(h.state.cur,'approved-tab');assert.equal(h.opened.length,1);assert.equal(h.calls.length,1);
 });
 test(`${platform} deferred approval still refuses a tab change before dispatch`,async()=>{
  const h=approvedHarness({native,deferred:true}),task=h.approved('https://example.com',new AbortController().signal,true);
  h.state.cur='foreign';h.release();await assert.rejects(task,/Browser tab changed/);assert.equal(h.calls.length,0);assert.equal(h.closed.length,1);assert.equal(h.opened.length,0);
 });
 test(`${platform} cancelling a dispatched deferred presentation never navigates again`,async()=>{
  const h=approvedHarness({native}),c=new AbortController(),present=await h.approved('https://example.com',c.signal,true);
  c.abort();assert.throws(present);assert.equal(h.calls.length,1);assert.equal(h.opened.length,0);assert.equal(h.state.cur,'existing');
 });
}
