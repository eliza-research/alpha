import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

const source=readFileSync('apps/app/src/prototype/settings-adapter.ts','utf8');
const facts=source.slice(source.indexOf('// settings-facts:begin'),source.indexOf('// settings-facts:end'));
const start=source.indexOf('  async function pollAutomaticUpdate(');
const poll=source.slice(start,source.indexOf('\n  let gmail =',start));
assert.ok(poll.includes('automatic:true'),'execute the product automatic install orchestration');
const root='5c'.repeat(32), sha256='0a'.repeat(32);
const manifest={schema:'alpha-update/v1',variant:'launcher',signerSha256:root,versionCode:8,
  apkUrl:'https://example.test/launcher-8.apk',sha256,sizeBytes:500};
function fixture(){
  const installs=[];
  let current=true, editor=false, answer=true, pending=false, capability='supported', read=()=>Promise.resolve({appVersionCode:7,appSigner:root,appAutomaticUpdates:capability});
  const shell={screen:'home',view:null,voice:'off',typing:false,chat:'input'};
  const context=vm.createContext({URL,Number,document:{querySelector:()=>editor?{}:null},
    owner:{S:()=>shell},connectionController:{getSnapshot:()=>({busy:false,open:false})},
    updateBusy:'',changed(){},checkForUpdate:async()=>answer,savedUpdate:()=>({manifest}),
    device:{snapshot:()=>read(),updateState:async()=>({pending}),installUpdate:async input=>{installs.push(JSON.parse(JSON.stringify(input)));return {}; }},
    system:{getBuildInfo:async()=>({launcher:true})}});
  vm.runInContext(stripTypeScriptTypes(facts.replace(/^export /gm,'')+'\n'+poll+'\nglobalThis.poll=pollAutomaticUpdate;',{mode:'strip'}),context);
  return {installs,shell,run:()=>context.poll(()=>current),retire(){current=false;},editor(){editor=true;},offline(){answer=false;},pending(){pending=true;},unsupported(){capability='permission-required';},read(value){read=value;}};
}
test('automatic discovery selects exact installed flavor/signer and sends only admitted update bytes',async()=>{
  const f=fixture();await f.run();
  assert.deepEqual(f.installs,[{apkUrl:manifest.apkUrl,sha256,sizeBytes:500,versionCode:8,automatic:true}]);
});
test('missing install permission and an existing pending Android session never start another automatic install',async()=>{
  for(const state of ['unsupported','pending']){const f=fixture();f[state]();await f.run();assert.deepEqual(f.installs,[]);}
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
    const context=vm.createContext({window,document,setTimeout(callback){waits.push(callback);}});
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
  const context=vm.createContext({fixtureShell:{live:true},document:{querySelector:()=>null},connectionController:{getSnapshot:()=>({busy:false})}});
  vm.runInContext(stripTypeScriptTypes('let shell=fixtureShell;\n'+preparer+'\nglobalThis.prepare=prepareMountedUpdate;',{mode:'strip'}),context);
  await assert.rejects(context.prepare(()=>true,true,true),/still opening/);
});
