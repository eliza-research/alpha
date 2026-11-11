import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';

const source=readFileSync('apps/app/src/prototype/settings-adapter.ts','utf8');
const facts=source.slice(source.indexOf('// settings-facts:begin'),source.indexOf('// settings-facts:end'));
const cache=source.slice(source.indexOf('const UPDATE_KEY = '),source.indexOf('// settings-reads:begin'));
const start=source.indexOf('  async function pollAutomaticUpdate(');
const poll=source.slice(start,source.indexOf('\n  let gmail =',start));
assert.ok(poll.includes('automatic:true'),'execute the product automatic install orchestration');
const root='5c'.repeat(32), sha256='0a'.repeat(32), manifestSha256='2b'.repeat(32);
const updateKey='alpha.app-update.v1';
const manifest={schema:'alpha-update/v1',variant:'launcher',signerSha256:root,versionCode:8,
  apkUrl:'https://example.test/launcher-8.apk',sha256,sizeBytes:500};
const gate=readFileSync('.eliza/client-features/packages/ui/src/state/app-update-gate.ts','utf8');
const scheduler=gate.slice(gate.indexOf('export function createAppUpdateScheduler('));
function fixture(voiceShell, seed) {
  const installs=[],storage=new Map();
  let current=true, editor=false, pending=false, capability='supported', inFlight=0, maxInFlight=0, checks=0, clock=0;
  let read=()=>Promise.resolve({appVersionCode:7,appSigner:root,appAutomaticUpdates:capability}), install=async()=>({});
  let check=async()=>({manifest:JSON.stringify(manifest),manifestSha256});
  if(seed)storage.set(updateKey,JSON.stringify(seed));
  const shell={screen:'home',view:null,voice:'off',typing:false,chat:'input'};
  const context=vm.createContext({URL,Number,Date:{now:()=>clock},Capacitor:{isNativePlatform:()=>true},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    document:{querySelector:()=>editor?{}:null},
    owner:voiceShell??{S:()=>shell,voiceConversationActive:()=>false},connectionController:{getSnapshot:()=>({busy:false,open:false})},
    updateBusy:'',changed(){},
    device:{checkForUpdate:()=>{checks++;return check();},snapshot:()=>read(),updateState:async()=>({pending}),installUpdate:async input=>{
      installs.push(JSON.parse(JSON.stringify(input)));maxInFlight=Math.max(maxInFlight,++inFlight);
      try{return await install();}finally{inFlight--;}
    }},
    system:{getBuildInfo:async()=>({launcher:true})}});
  const program=facts.replace(/^export /gm,'')+'\n'+cache+'\n'+poll+'\n'+scheduler.replace(/^export /gm,'')
    +'\nglobalThis.api={pollAutomaticUpdate,createAppUpdateScheduler,checkForUpdate,savedUpdate,parseUpdateManifest};';
  vm.runInContext(stripTypeScriptTypes(program,{mode:'strip'}),context);
  const api=context.api;
  return {installs,shell,run:()=>api.pollAutomaticUpdate(()=>current),retire(){current=false;},editor(){editor=true;},
    offline(){check=async()=>{throw Error('offline');};},pending(){pending=true;},unsupported(){capability='permission-required';},
    capability(value){capability=value;},read(value){read=value;},install(value){install=value;},maxInFlight:()=>maxInFlight,
    offer(value){check=async()=>value;},checks:()=>checks,check:()=>api.checkForUpdate(true),
    saved:()=>JSON.parse(storage.get(updateKey)??'null'),storeExternal:value=>storage.set(updateKey,JSON.stringify(value)),
    manualOffer:()=>api.parseUpdateManifest(api.savedUpdate().manifest,{versionCode:7,launcher:true,signerSha256:root}),
    scheduled(){
      let now=0,serial=0;const jobs=new Map();
      const schedule=api.createAppUpdateScheduler({run:api.pollAutomaticUpdate,now:()=>now,
        schedule(callback,delay){const id=++serial;jobs.set(id,{callback,at:now+delay});return id;},cancel(id){jobs.delete(id);}});
      return {...schedule,times:()=>[...jobs.values()].map(job=>job.at),async tick(milliseconds=0){
        now+=milliseconds;clock=now;
        for(const [id,job] of [...jobs])if(job.at<=now){jobs.delete(id);job.callback();}
        await new Promise(setImmediate);
      }};
    }};
}
const request=(offer=manifest,digest=manifestSha256)=>({apkUrl:offer.apkUrl,sha256:offer.sha256,sizeBytes:offer.sizeBytes,
  versionCode:offer.versionCode,automatic:true,manifestSha256:digest});
const nextOffer={...manifest,versionCode:9,apkUrl:'https://example.test/launcher-9.apk'};
const changedResponse=manifest=>({status:'offer-response-changed',manifest});

test('automatic discovery sends the native digest bound to the exact admitted update',async()=>{
  const f=fixture();await f.run();
  assert.deepEqual(f.installs,[request()]);
  assert.deepEqual(f.saved(),{checkedAt:0,manifest,manifestSha256});
});

test('a legacy cached offer remains visible for manual install and forces an automatic refresh',async()=>{
  const f=fixture(undefined,{checkedAt:0,manifest});
  assert.equal(f.manualOffer()?.versionCode,8);
  f.offline();
  await assert.rejects(f.run(),/Update check unavailable/);
  assert.equal(f.manualOffer()?.versionCode,8);
  assert.deepEqual(f.installs,[]);
  assert.equal(f.checks(),1);
  f.offer({manifest:JSON.stringify(manifest)});
  await assert.rejects(f.run(),/requires a fresh check/);
  assert.deepEqual(f.installs,[]);
  f.offer({manifest:JSON.stringify(manifest),manifestSha256});
  await f.run();
  assert.deepEqual(f.installs,[request()]);
  assert.equal(f.checks(),3);
});

test('failed or malformed refresh cannot authorize an old cached offer automatically',async()=>{
  for(const reply of [null,{manifest:'{'},{manifest:'null'},{manifest:JSON.stringify(manifest),manifestSha256:'bad'}]){
    const f=fixture(undefined,{checkedAt:0,manifest,manifestSha256});
    if(reply===null)f.offline();else f.offer(reply);
    assert.equal(await f.check(),false);
    assert.deepEqual(f.saved(),{checkedAt:0,manifest});
    assert.equal(f.manualOffer()?.versionCode,8);
    await assert.rejects(f.run(),/Update check unavailable/);
    assert.deepEqual(f.installs,[]);
    assert.equal(f.checks(),2,'even a recent answer no longer authorizes an install');
  }
});

for(const [reason,reply] of [['withdrawal',{status:'offer-withdrawn'}],['valid replacement',changedResponse(JSON.stringify(nextOffer))],
  ['valid index without the installed pair',changedResponse(JSON.stringify({schema:'alpha-update/index-v1',releases:[{...manifest,variant:'standalone'}]}))]])
test(`${reason} retires the saved row and rechecks at backoff`,async()=>{
  const f=fixture(),s=f.scheduled();
  f.install(async()=>reply);
  try{
    s.setActive(true);await s.tick();
    assert.deepEqual(f.installs,[request()]);
    assert.equal(f.saved(),null);
    assert.equal(f.manualOffer(),null);
    assert.equal(s.snapshot().failures,1);
    assert.deepEqual(s.times(),[60_000]);
    const next={...manifest,versionCode:9,apkUrl:'https://example.test/launcher-9.apk',sha256:'1c'.repeat(32)};
    const digest='3d'.repeat(32);
    f.offer({manifest:JSON.stringify(next),manifestSha256:digest});
    f.install(async()=>({}));
    await s.tick(60_000);
    assert.equal(f.checks(),2);
    assert.deepEqual(f.installs,[request(),request(next,digest)]);
    assert.deepEqual(f.saved(),{checkedAt:60_000,manifest:next,manifestSha256:digest});
    assert.equal(s.snapshot().failures,0);
  }finally{s.dispose();}
});

test('uncertain final responses retain manual recovery and require a fresh automatic read',async()=>{
  const malformed=['{','{"schema":"alpha-update/v1"}',JSON.stringify(nextOffer)+'// trailing',
    JSON.stringify({...nextOffer,sizeBytes:0}),
    JSON.stringify({schema:'alpha-update/index-v1',releases:[nextOffer,nextOffer]})];
  for(const reply of [{status:'offer-unavailable'},...malformed.map(changedResponse)]){
    const f=fixture(),s=f.scheduled();
    f.install(async()=>reply);
    try{
      s.setActive(true);await s.tick();
      assert.deepEqual(f.saved(),{checkedAt:0,manifest});
      assert.equal(f.manualOffer()?.versionCode,8);
      assert.deepEqual(f.installs,[request()]);
      assert.deepEqual(s.times(),[60_000]);
      if (reply.manifest === undefined) f.offline();
      else f.offer({manifest:reply.manifest,manifestSha256:'4e'.repeat(32)});
      await s.tick(60_000);
      assert.equal(f.checks(),2);
      assert.equal(f.manualOffer()?.versionCode,8);
      assert.deepEqual(f.installs,[request()]);
      const digest='3d'.repeat(32);
      f.offer({manifest:JSON.stringify(nextOffer),manifestSha256:digest});
      f.install(async()=>({}));await s.tick(120_000);
      assert.deepEqual(f.installs,[request(),request(nextOffer,digest)]);
      assert.equal(s.snapshot().failures,0);
    }finally{s.dispose();}
  }
});

for(const reply of [{status:'offer-withdrawn'},changedResponse(JSON.stringify(nextOffer)),{status:'offer-unavailable'}])
test(`a late ${reply.status} preserves a fresher manual check result`,async()=>{
  const f=fixture(),s=f.scheduled();
  let finish;
  f.install(()=>new Promise(resolve=>{finish=resolve;}));
  try{
    s.setActive(true);await s.tick();
    assert.deepEqual(f.installs,[request()]);
    const next={...manifest,versionCode:9,apkUrl:'https://example.test/launcher-9.apk'};
    const digest='3d'.repeat(32);
    f.offer({manifest:JSON.stringify(next),manifestSha256:digest});
    assert.equal(await f.check(),true);
    finish(reply);await new Promise(setImmediate);
    assert.deepEqual(f.saved(),{checkedAt:0,manifest:next,manifestSha256:digest});
    assert.equal(s.snapshot().failures,1);
    f.install(async()=>({}));
    await s.tick(60_000);
    assert.deepEqual(f.installs,[request(),request(next,digest)]);
    assert.equal(f.checks(),2,'the newer result remains the current cached offer');
    assert.equal(f.maxInFlight(),1);
  }finally{s.dispose();}
});

test('a final refusal does not overwrite another bridge’s persisted offer',async()=>{
  for(const status of ['offer-withdrawn','offer-unavailable']){
    const f=fixture();let finish;
    f.install(()=>new Promise(resolve=>{finish=resolve;}));
    const run=f.run(),refused=assert.rejects(run,/Update offer unavailable/);
    await new Promise(setImmediate);
    const newer={checkedAt:1,manifest:nextOffer,manifestSha256:'3d'.repeat(32)};
    f.storeExternal(newer);
    finish({status});await refused;
    assert.deepEqual(f.saved(),newer);
  }
});

test('a fresh 404 withdraws a cached offer without bypassing the answered-check interval',async()=>{
  const f=fixture(undefined,{checkedAt:0,manifest,manifestSha256});
  f.offer({});
  assert.equal(await f.check(),true);
  assert.deepEqual(f.saved(),{checkedAt:0,manifest:null});
  await f.run();
  assert.deepEqual(f.installs,[]);
  assert.equal(f.checks(),1);
});

test('missing install permission and an existing pending Android session never start another automatic install',async()=>{
  for(const state of ['unsupported','pending']){const f=fixture();f[state]();await f.run();assert.deepEqual(f.installs,[]);}
});
for(const cut of ['snapshot','install'])test(`Android starting at ${cut} uses the existing retry and later supported work runs once`,async()=>{
  const f=fixture(),s=f.scheduled();
  if(cut==='snapshot')f.capability('starting');else f.install(async()=>({status:'starting'}));
  try{
    s.setActive(true);await s.tick();
    assert.equal(f.installs.length,cut==='snapshot'?0:1,'a deferred capability cannot call install');
    assert.equal(s.snapshot().busy,false);assert.equal(s.snapshot().failures,1);
    assert.deepEqual(s.times(),[60_000],'starting uses one-minute backoff, not the answered fifteen-minute interval');
    f.capability('supported');f.install(async()=>({}));
    await s.tick(59_999);assert.equal(f.installs.length,cut==='snapshot'?0:1);
    await s.tick(1);assert.equal(f.installs.length,cut==='snapshot'?1:2,'one supported retry follows the deferred attempt');
    assert.equal(f.maxInFlight(),1);assert.equal(s.snapshot().failures,0);
    assert.deepEqual(s.times(),[960_000]);
    await s.tick();assert.equal(f.installs.length,cut==='snapshot'?1:2);
  }finally{s.dispose();assert.deepEqual(s.times(),[]);}
});
test('permission refusals and a pending session keep their answered-check interval during startup',async()=>{
  for(const [cut,status] of [['snapshot','permission-required'],['snapshot','unsupported'],['snapshot','pending'],['install','permission-required'],['install','unsupported']]){
    const f=fixture(),s=f.scheduled();
    if(cut==='install')f.install(async()=>({status}));else f.capability(status==='pending'?'starting':status);
    if(status==='pending')f.pending();
    try{s.setActive(true);await s.tick();assert.equal(f.installs.length,cut==='install'?1:0);assert.equal(s.snapshot().failures,0);assert.deepEqual(s.times(),[900_000]);}
    finally{s.dispose();}
  }
});
test('backgrounding and disposal retire deferred readbacks without overlapping or restarting native work',async()=>{
  for(const cut of ['snapshot','install'])for(const disposition of ['background','dispose']){
    const f=fixture(),s=f.scheduled();let release;
    const held=new Promise(resolve=>{release=resolve;});
    if(cut==='snapshot')f.read(()=>held);else f.install(()=>held);
    s.setActive(true);await s.tick();assert.equal(s.snapshot().busy,true);
    const begun=cut==='snapshot'?0:1;assert.equal(f.installs.length,begun);
    if(disposition==='dispose')s.dispose();else{s.setActive(false);s.setActive(true);}
    assert.deepEqual(s.times(),[],'an in-flight owner cannot overlap after resume');
    f.read(async()=>({appVersionCode:7,appSigner:root,appAutomaticUpdates:'supported'}));f.install(async()=>({}));
    release(cut==='snapshot'?{appVersionCode:7,appSigner:root,appAutomaticUpdates:'starting'}:{status:'starting'});
    await new Promise(setImmediate);
    assert.equal(f.installs.length,begun,'late deferred readback has no later native effect');
    assert.equal(s.snapshot().busy,false);
    if(disposition==='dispose'){
      s.setActive(true);await s.tick(60_000);assert.deepEqual(s.times(),[]);assert.equal(f.installs.length,begun);
    }else{
      assert.deepEqual(s.times(),[0]);await s.tick();assert.equal(f.installs.length,begun+1);assert.equal(f.maxInFlight(),1);
    }
    s.dispose();assert.deepEqual(s.times(),[]);
  }
});
test('a backgrounded owner cannot install after a late native fact read',async()=>{
  const f=fixture();let release;f.read(()=>new Promise(resolve=>{release=resolve;}));
  const run=f.run();await new Promise(setImmediate);f.retire();release({appVersionCode:7,appSigner:root,appAutomaticUpdates:'supported'});
  await run;assert.deepEqual(f.installs,[]);
});
test('offline checks and active edits retry without requesting native installation',async()=>{
  for(const state of ['editor','offline']){const f=fixture();f[state]();await assert.rejects(f.run());assert.deepEqual(f.installs,[]);}
});

test('a focused editor is remembered before either native readiness path freezes the UI',async()=>{
  const gate=readFileSync('.eliza/client-features/packages/ui/src/state/app-update-gate.ts','utf8');
  const activationId='11111111-2222-4333-8444-555555555555',bridgeId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  for(const event of [false,true])for(const automatic of [false,true]){
    const dom=new JSDOM('<textarea></textarea>'),{window}=dom,{document}=window;
    const field=document.querySelector('textarea');field.focus();
    window.HTMLDialogElement.prototype.showModal=function(){field.blur();this.setAttribute('open','');};
    window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
    const waits=[],acknowledgments=[];let notify,prepared,notices=0;
    let state=event?{pending:false,bridgeId}:{pending:true,phase:'preparing',activationId,bridgeId,automatic};
    const context=vm.createContext({window,document,HTMLElement:window.HTMLElement,setTimeout(callback){waits.push(callback);}});
    vm.runInContext(stripTypeScriptTypes(gate.replace(/^export /gm,'')+'\nglobalThis.watch=watchMountedAppUpdates;',{mode:'strip'}),context);
    await context.watch({async updateState(){return state;},async addListener(_,callback){notify=callback;return {remove:async()=>{}};},
      async activateUpdate(input){acknowledgments.push(input);},continueUpdate:async()=>{}},
      {dialogClass:'test',dialogLabel:'Update',pendingLabel:'Updating',continueLabel:'Continue',navigationEvents:[]},
      async(_current,automatic,editing)=>{prepared={automatic,editing,blurred:document.activeElement!==field};throw Error('Editing at freeze');},()=>{notices++;});
    if(event){await new Promise(setImmediate);state={pending:true,phase:'preparing',activationId,bridgeId,automatic};notify(state);}
    await new Promise(setImmediate);assert.deepEqual(prepared,{automatic,editing:true,blurred:true},'event='+event);assert.equal(acknowledgments.length,1);assert.equal(acknowledgments[0].ready,false);
    state={pending:false,activationId,bridgeId,outcome:'failed'};assert.ok(waits.length);waits.shift()();await new Promise(setImmediate);
    assert.equal(notices,automatic?0:1,'only a refused owner-requested update explains the refusal');dom.window.close();
  }
});

test('the product preparer refuses an automatic update when modal freeze already blurred an editor',async()=>{
  const main=readFileSync('apps/app/src/main.tsx','utf8'),start=main.indexOf('async function prepareMountedUpdate(');
  const preparer=main.slice(start,main.indexOf('\nlet nativeAppUpdateGate',start));
  const context=vm.createContext({fixtureShell:{live:true,voiceConversationActive:()=>false},document:{querySelector:()=>null},connectionController:{getSnapshot:()=>({busy:false})}});
  vm.runInContext(stripTypeScriptTypes('let shell=fixtureShell;\n'+preparer+'\nglobalThis.prepare=prepareMountedUpdate;',{mode:'strip'}),context);
  await assert.rejects(context.prepare(()=>true,true,true),/still opening/);
});

function compactVoice(){
  const f=cloudVoiceViewFixture({cloudProfile:false,platform:'web',native:false});
  f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
  const snapshot=f.box.connectionController.getSnapshot;
  f.box.connectionController.getSnapshot=()=>({...snapshot(),residentInference:'direct',providerStatus:{voiceConfigured:true}});
  let release,stops=0;
  const stopped=new Promise(resolve=>{release=resolve;});
  f.box.developmentCartesiaConversation=async input=>({
    async start(){input.onState('listening');},async stop(){stops++;await stopped;},
    recheck(){},resume(){return false;},microphoneMuted:false,setMicrophoneMuted(){},needsPlaybackUnlock:false,
  });
  f.shell.setState({screen:'home',view:null,chat:'hidden',voice:'off',typing:false});
  return Object.assign(f,{release,stopCalls:()=>stops});
}

async function mountedVoiceGate(owner,automatic,{holdFlush=false}={}){
  const dom=new JSDOM('<main></main>'),{window}=dom,{document}=window;
  window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const waits=[],acknowledgments=[];let flushes=0,release;
  const barrier=holdFlush?new Promise(resolve=>{release=resolve;}):Promise.resolve();
  for(const domain of ['Composer','Calendar','Notes','Inbox','Workflows'])owner['flush'+domain+'ForAppUpdate']=current=>{assert.equal(current(),true);flushes++;return barrier;};
  const main=readFileSync('apps/app/src/main.tsx','utf8'),start=main.indexOf('async function prepareMountedUpdate(');
  const preparer=main.slice(start,main.indexOf('\nlet nativeAppUpdateGate',start));
  const gate=readFileSync('.eliza/client-features/packages/ui/src/state/app-update-gate.ts','utf8');
  const context=vm.createContext({window,document,HTMLElement:window.HTMLElement,fixtureShell:owner,
    connectionController:{getSnapshot:()=>({busy:false,open:false}),captureAppUpdateReconnect:()=>async()=>{}},
    setTimeout(callback){waits.push(callback);}});
  vm.runInContext(stripTypeScriptTypes('let shell=fixtureShell;\n'+facts.replace(/^export /gm,'')+'\n'+preparer+'\n'+gate.replace(/^export /gm,'')+'\nglobalThis.prepare=prepareMountedUpdate;globalThis.watch=watchMountedAppUpdates;',{mode:'strip'}),context);
  const activationId='11111111-2222-4333-8444-555555555555',bridgeId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  let state={pending:true,phase:'preparing',activationId,bridgeId,automatic};
  await context.watch({async updateState(){return state;},async addListener(){return {remove:async()=>{}};},
    async activateUpdate(input){acknowledgments.push(input);},continueUpdate:async()=>{}},
    {dialogClass:'alpha-update-startup',dialogLabel:'Update',pendingLabel:'Updating',continueLabel:'Continue',navigationEvents:[]},context.prepare,()=>{});
  await new Promise(setImmediate);
  return {acknowledgments,flushes:()=>flushes,release,
    async close(){state={pending:false,activationId,bridgeId,outcome:'failed'};assert.ok(waits.length);waits.shift()();await new Promise(setImmediate);window.close();}};
}

test('actual compact voice and pending retirement block automatic discovery without recorder DOM',async()=>{
  const voice=compactVoice();
  try{
    await voice.shell.startVoice();
    assert.equal(voice.shell.S().voice,'off');assert.equal(voice.shell.S().chat,'hidden');
    assert.ok(voice.shell.renderVals().pillVoice);assert.equal(voice.shell.voiceConversationActive(),true);
    const f=fixture(voice.shell);
    await assert.rejects(f.run(),/Current activity/);assert.deepEqual(f.installs,[]);
    const stopped=voice.shell.stopVoiceConversation();await voice.tick();
    assert.equal(voice.shell.voiceConversationActive(),true,'pending media retirement still owns voice');
    await assert.rejects(f.run(),/Current activity/);assert.deepEqual(f.installs,[]);
    voice.release();await stopped;await voice.tick();assert.equal(voice.shell.voiceConversationActive(),false);
    await f.run();assert.equal(f.installs.length,1,'only confirmed voice retirement admits the update');
  }finally{voice.release();voice.close();}
});

test('automatic discovery rechecks actual voice ownership after delayed native facts',async()=>{
  const voice=compactVoice();
  try{
    const f=fixture(voice.shell);let release;
    f.read(()=>new Promise(resolve=>{release=resolve;}));
    const run=f.run();await new Promise(setImmediate);
    await voice.shell.startVoice();assert.equal(voice.shell.S().voice,'off');assert.equal(voice.shell.S().chat,'hidden');
    release({appVersionCode:7,appSigner:root,appAutomaticUpdates:'supported'});
    await assert.rejects(run,/Current activity/);assert.deepEqual(f.installs,[]);assert.equal(voice.stopCalls(),0);
  }finally{voice.release();voice.close();}
});

for(const automatic of [false,true])test(`${automatic?'automatic':'manual'} readiness refuses actual compact voice and its pending retirement`,async()=>{
  const voice=compactVoice();
  try{
    await voice.shell.startVoice();
    for(const retiring of [false,true]){
      if(retiring){void voice.shell.stopVoiceConversation();await voice.tick();}
      assert.equal(voice.shell.S().voice,'off');assert.equal(voice.shell.S().chat,'hidden');
      const gate=await mountedVoiceGate(voice.shell,automatic);
      try{assert.equal(gate.flushes(),0);assert.equal(gate.acknowledgments.length,1);assert.equal(gate.acknowledgments[0].ready,false);assert.equal(voice.stopCalls(),retiring?1:0,'the update does not stop voice');}
      finally{await gate.close();}
    }
  }finally{voice.release();await voice.tick();voice.close();}
});

for(const automatic of [false,true])test(`${automatic?'automatic':'manual'} readiness loses admission if actual compact voice starts during draft flush`,async()=>{
  const voice=compactVoice();let gate;
  try{
    gate=await mountedVoiceGate(voice.shell,automatic,{holdFlush:true});assert.equal(gate.flushes(),5);assert.equal(gate.acknowledgments.length,0);
    await voice.shell.startVoice();assert.equal(voice.shell.S().voice,'off');assert.equal(voice.shell.S().chat,'hidden');assert.equal(voice.shell.voiceConversationActive(),true);
    gate.release();await new Promise(setImmediate);
    assert.equal(gate.acknowledgments.length,1);assert.equal(gate.acknowledgments[0].ready,false);assert.equal(voice.stopCalls(),0);
  }finally{gate?.release();if(gate)await gate.close();voice.release();voice.close();}
});
