import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {buildSync} from 'esbuild';
import {sourceContext, tick, deferred} from './support.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const driver = fileURLToPath(import.meta.url);

function sharedModule(path) {
  const result = buildSync({absWorkingDir:root, entryPoints:[path], bundle:true,
    write:false, format:'cjs', platform:'node', metafile:true});
  return {sources:Object.keys(result.metafile.inputs), instantiate() {
    const module = {exports:{}};
    new Function('module','exports',result.outputFiles[0].text)(module,module.exports);
    return module.exports;
  }};
}

async function fixture(extraSources) {
  const shared = sharedModule('vendor/eliza/plugins/plugin-native-passwords/src/client.ts');
  const bindings = sharedModule('vendor/eliza/plugins/plugin-native-passwords/src/bindings.ts');
  const sources = [...shared.sources,...bindings.sources,'apps/app/src/passwords/password-manager.ts',
    'specs/quint/refinement/application/support.mjs','test/support/strip-types.mjs',driver,...extraSources];
  const driverHashes = captureInputs(sources);
  const sharedExports=shared.instantiate(), bindingExports=bindings.instantiate();
  const calls = [], timers = new Map(), records = [];
  const native = {locked:true,damaged:false,pending:null,cancelUnlock:false,resetCount:0};
  let timerId=0,page='password-provider';
  const port = {
    async status() {calls.push('status');if(native.damaged)throw {code:'key-invalidated'};return {
      available:true,locked:native.locked,unlockRemainingMs:native.locked?0:60000,
      unlockSeconds:60,biometric:false,autofill:{supported:true,selected:'none'},
    };},
    async list() {calls.push('list');if(native.locked)throw {code:'locked'};return {entries:[]};},
    async unlock() {
      calls.push('unlock');
      native.cancelUnlock=false;
      if(native.pending){await native.pending.promise;if(native.cancelUnlock)throw {code:'cancelled'};}
      native.locked=false;return {unlocked:true,unlockRemainingMs:60000};
    },
    async lock() {calls.push('lock');native.locked=true;native.cancelUnlock=true;return {locked:true};},
    async reset() {calls.push('reset');if(native.locked)throw {code:'locked'};native.resetCount++;native.damaged=false;return {reset:true};},
    async save(input) {calls.push('save');if(native.locked)throw {code:'locked'};return {saved:true,id:'entry',generated:false};},
  };
  const document = new EventTarget(); document.hidden=false;
  const window = new EventTarget();
  const api = sourceContext(['apps/app/src/passwords/password-manager.ts'], [
    'passwordManagerGroups','passwordEntryPage','leavePasswordManager','refreshPasswordManager','passwordManagerLifecycle',
    'observe: () => ({active,generation,locked:status?.locked ?? true,entries:entries!==null,damaged,resetReviewed:confirmReset!==null,secret:!!draft?.password,draft:!!draft,busy,noticePresent:!!notice})',
  ], {
    ...sharedExports,...bindingExports,document,window,queueMicrotask,
    Capacitor:{isNativePlatform:()=>true,isPluginAvailable:()=>false},
    testMocksEnabled:false,devSurfacesEnabled:false,browserDevProfile:false,
    createDevelopmentVault:()=>{throw Error('Unexpected development vault');},
    createTransferClient:()=>{throw Error('Unexpected transfer');},
    registerPlugin:name=>name==='ElizaPasswords'?port:{async loginFillStatus(){return {available:false};}},
    setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,delay});return id;},
    clearTimeout(id){timers.delete(id);},
  });
  const helpers = {ic:{},info:(label,val)=>({label,val}),group:rows=>({rows}),toast(){},set(patch){page=patch.page??page;}};
  const dispose = api.passwordManagerLifecycle(()=>{});
  const observe = label => {const state={...api.observe(),foreground:!document.hidden,
    resetCount:native.resetCount,nativeLocked:native.locked,page,calls:[...calls]};records.push({label,state});return state;};
  const rows = () => api.passwordManagerGroups(helpers).flatMap(group=>group.rows);
  const invoke = label => {const row=rows().find(row=>row.label===label||row.lbl===label);assert.ok(row,label);row.go();};
  const settle = async () => {for(let i=0;i<4;i++)await tick();};
  const hold=method=>{const original=port[method],pending=deferred(),entered=deferred();port[method]=async(...args)=>{port[method]=original;const result=await original(...args);entered.resolve();await pending.promise;return result;};return {entered:entered.promise,release:()=>pending.resolve()};};
  const expire=()=>{const [id,timer]=[...timers].find(([,timer])=>timer.delay===60000)||[];assert.ok(timer,'unlock expiry');timers.delete(id);timer.callback();};
  return {api,helpers,port,native,document,window,records,rows,invoke,observe,settle,dispose,sources,driverHashes,hold,expire};
}

export async function generateVaultCoordinatorTraces(extraSources=[]) {
  const scenarios=[];
  for(const name of ['typed-leave','typed-background','damaged-review-leave','pending-reset-leave']) {
    const f=await fixture(extraSources);
    try {
      f.observe('initial');f.rows();await f.settle();f.observe('open locked vault');
      if(name.startsWith('typed')) {
        f.invoke('Unlock passwords');await f.settle();f.observe('unlock metadata');
        f.invoke('Add password');
        const page=f.api.passwordEntryPage(f.helpers,()=>{});
        const password=page.groups.flatMap(group=>group.rows).find(row=>row.label==='Password');
        password.change({target:{value:'synthetic-vault-input'}});f.observe('type secret');
        if(name==='typed-background'){f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));}
        else f.api.leavePasswordManager();
        await f.settle();f.observe('leave clears draft');
        assert.equal(f.records.at(-1).state.secret,false);
        assert.equal(f.records.at(-1).state.active,false);
      } else {
        f.native.damaged=true;f.api.refreshPasswordManager();await f.settle();f.observe('native reports invalidated key');
        f.invoke('Reset vault');f.observe('review reset');
        if(name==='pending-reset-leave') {
          f.native.pending=deferred();f.invoke('Confirm reset vault');
          await f.settle();f.observe('native authentication pending');
        }
        f.api.leavePasswordManager();await f.settle();f.observe('leave retires review');
        assert.equal(f.records.at(-1).state.resetReviewed,false);
        if(f.native.pending) {
          f.native.pending.resolve();await f.settle();f.observe('retired native authentication completes');
          assert.equal(f.native.resetCount,0);
        }
        f.rows();await f.settle();f.observe('reopen needs current status');
      }
      scenarios.push({name,observations:f.records,sources:f.sources,driverHashes:f.driverHashes});
    } finally {f.dispose();await f.settle();}
  }
  for(const name of ['metadata-lock','metadata-expiry','metadata-leave','reset-review-refresh','reset-auth-refresh']) {
    const f=await fixture(extraSources);
    try {
      f.observe('initial');f.rows();await f.settle();f.observe('open locked vault');
      if(name.startsWith('metadata')) {
        f.invoke('Unlock passwords');await f.settle();f.observe('unlock metadata');
        const held=f.hold('list');f.api.refreshPasswordManager();await held.entered;f.observe('metadata read pending');
        if(name==='metadata-lock'){f.invoke('Lock passwords');await f.settle();f.observe('metadata lock');}
        else if(name==='metadata-expiry'){f.expire();await f.settle();f.observe('metadata expires');}
        else {f.api.leavePasswordManager();await f.settle();f.observe('leave retires review');}
        held.release();await f.settle();f.observe('retired metadata completes');
        assert.equal(f.records.at(-1).state.entries,false);
      } else {
        f.native.damaged=true;f.api.refreshPasswordManager();await f.settle();f.observe('native reports invalidated key');
        f.invoke('Reset vault');f.observe('review reset');
        if(name==='reset-auth-refresh'){f.native.pending=deferred();f.invoke('Confirm reset vault');await f.settle();f.observe('native authentication pending');}
        f.api.refreshPasswordManager();await f.settle();f.observe('refresh retires reset review');
        if(f.native.pending){f.native.pending.resolve();await f.settle();f.observe('retired reset authentication completes');}
        assert.equal(f.native.resetCount,0);assert.equal(f.records.at(-1).state.resetReviewed,false);
      }
      scenarios.push({name,observations:f.records,sources:f.sources,driverHashes:f.driverHashes});
    } finally {f.dispose();await f.settle();}
  }
  return scenarios;
}

export async function checkVaultCoordinator(extraSources=[]) {
  const scenarios=await generateVaultCoordinatorTraces(extraSources);
  const traces=scenarios.map(scenario=>{
    const project=state=>({
      's.active':state.active,'s.generation':state.generation,'s.locked':state.locked,
      's.entries':state.entries,'s.damaged':state.damaged,'s.resetReviewed':state.resetReviewed,
      's.secret':state.secret,'s.foreground':state.foreground,'s.resets':state.resetCount,
      's.operation':state.busy,'s.notice':state.noticePresent,
    });
    const action=label=>{
      const call=name=>({name});
      if(label==='open locked vault')return [call('open'),call('refresh'),call('refreshResult')];
      if(label==='unlock metadata')return [call('unlock'),call('refresh'),call('refreshResult')];
      if(label==='type secret')return call('typeSecret');
      if(label==='leave clears draft')return call(scenario.name==='typed-background'?'background':'leave');
      if(label==='native reports invalidated key')return [call('refresh'),call('keyInvalidated')];
      if(label==='review reset')return call('reviewReset');
      if(label==='native authentication pending')return call('beginResetAuthentication');
      if(label==='leave retires review')return call('leave');
      if(label==='retired native authentication completes')return call('authenticationRefused');
      if(label==='reopen needs current status')return [call('open'),call('refresh'),call('keyInvalidated')];
      if(label==='metadata read pending')return call('refresh');
      if(label==='metadata lock')return call('lock');
      if(label==='metadata expires')return call('expiry');
      if(label==='retired metadata completes')return call('refreshResult');
      if(label==='refresh retires reset review')return [call('refresh'),call('keyInvalidated')];
      if(label==='retired reset authentication completes')return call('resetAuthenticationRetired');
      throw Error(`Unknown source observation ${label}`);
    };
    return {name:scenario.name,init:{name:'init'},expect:project(scenario.observations[0].state),
      steps:scenario.observations.slice(1).map(observation=>({label:observation.label,
        action:action(observation.label),expect:project(observation.state)}))};
  });
  const path=resolve(root,'test-results/quint-refinement/vault-coordinator-source.json');
  const serialized=JSON.stringify(scenarios,null,2);
  assert.ok(!serialized.includes('synthetic-vault-input'), 'Typed bytes must never enter trace evidence');
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path,serialized+'\n');
  return checkTraces({model:'CredentialVault',id:'CredentialVault-coordinator',traces,
    sources:[...new Set(scenarios.flatMap(scenario=>scenario.sources))],
    driverHashes:scenarios[0].driverHashes,scope:'bounded-orchestration',assumptions:[
      'The actual password-manager coordinator and pinned shared PasswordsClient validation execute with controlled native ports.',
      'Only secret presence is observed. Typed bytes remain in the synthetic local input and are never serialized in receipts.',
      'The native port models lock cancelling a pending credential challenge, matching CredentialAccessSession ownership. No real authentication, Keystore mutation or reset executes.',
      'Nine schedules cover draft clearing, lock/expiry/leave during metadata reads, reset-review invalidation by refresh, background retirement and late native unlock. Save/remove/transfer, fill-origin behavior and all native platform schedules remain separate obligations.',
    ]});
}

if(process.argv[1]===driver) {
  const result=await checkVaultCoordinator();
  console.log(JSON.stringify({passed:result.passed,traces:result.traces,checkpoints:result.checkpoints}));
}
