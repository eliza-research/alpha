import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {dirname,resolve} from 'node:path';
import {sourceContext, memoryStore, deferred, tick} from './support.mjs';
import {captureInputs,checkTraces} from '../check-traces.mjs';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
const driver=fileURLToPath(import.meta.url);

async function fixture(extraSources) {
  const built=buildSync({absWorkingDir:root,stdin:{resolveDir:root,loader:'ts',contents:`
    export * from './apps/app/src/runtime/notes-secure-store.ts';
    export {NotesCommitUncertain,isStorageFull} from './apps/app/src/runtime/notes-store.ts';
    export {stampNoteChanges} from './apps/app/src/runtime/note-dates.ts';

  `},bundle:true,format:'cjs',platform:'node',write:false,metafile:true,
    define:{'import.meta.env':'{"VITE_ELIZA_DEV_ALLOW_TEST_MOCKS":""}'}});
  const sources=[...Object.keys(built.metafile.inputs).filter(path=>!path.startsWith('<')),
    'apps/app/src/prototype/agent-adapter.ts','specs/quint/refinement/application/support.mjs',
    'test/support/strip-types.mjs','upstream.lock.json','scripts/prepare-client-features.mjs',
    ...readdirSync(resolve(root,'patches/eliza')).filter(name=>/\.(patch|json)$/.test(name)).map(name=>'patches/eliza/'+name),driver,...extraSources];
  const driverHashes=captureInputs(sources);
  const module={exports:{}};
  new Function('require','module','exports',built.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const shared=module.exports;
  const slots=new Map(), legacy=memoryStore();
  let delayed=null, commitBeforeFailure=false;
  const vault={
    async read(key){return structuredClone(slots.get(key)??null);},
    async compareExchange(key,expected,value){
      if(JSON.stringify(slots.get(key)??null)!==JSON.stringify(expected))return {status:'conflict'};
      if(key===shared.SECURE_NOTES_SLOT&&delayed){
        const pending=delayed;delayed=null;
        if(commitBeforeFailure)slots.set(key,structuredClone(value));
        await pending.promise;
      }
      slots.set(key,structuredClone(value));return {status:'saved'};
    },
  };
  const original={id:'note',kind:'text',title:'Note',body:'original',createdAt:1,modifiedAt:1};
  const store=await shared.SecureNotesStore.open(vault,legacy,[original]);
  const originalBase=await shared.notesDraftBase(store.raw);
  const read=path=>readFileSync(resolve(root,path),'utf8');
  const adapterSource=read('apps/app/src/prototype/agent-adapter.ts');
  const start=adapterSource.indexOf('  const notesDataset='),end=adapterSource.indexOf('  /** Android: after a clean open',start);
  const setterStart=adapterSource.indexOf('  p.vset = function (key: string'),setterEnd=adapterSource.indexOf('  p.api = function',setterStart);
  assert.ok(start>=0&&end>start&&setterStart>=0&&setterEnd>setterStart,'actual Notes editor boundaries');
  const document={documentElement:{dataset:{}}};
  const code=stripTypeScriptTypes(adapterSource.slice(start,end)+'\n'+adapterSource.slice(setterStart,setterEnd),{mode:'transform'});
  const makeEditor=new Function('shared','secureConnectionStore','document',`
    const {SecureNotesStore,NotesCommitUncertain,NotesStorageFull,isStorageFull,stampNoteChanges}=shared;
    const p={},isAndroid=true,context=()=>{},releaseNoteAudio=()=>{};
    const originalSet=function(_key,patch){Object.assign(this.notes,patch);};
    ${code}
    return p.vset;
  `);
  const edit=makeEditor(shared,vault,document);
  const openShell=async()=>{
    const opened=await shared.SecureNotesStore.open(vault,legacy,[]);
    return {notesStore:opened,notesRaw:opened.raw,notesPending:0,notesStorageFailed:false,
      notesSourceMode:'legacy',live:true,notes:{list:opened.list},vget(){return this.notes;},
      vset:edit,toast(){}};
  };
  const shell=await openShell();
  const observe=(owner=shell)=>({pending:owner.notesPending,fault:owner.notesStorageFailed,
    uncertain:!!owner.notesCommitUncertain,editor:owner.notes.list[0]?.body,
    confirmed:JSON.parse(owner.notesStore.document.saved.raw).records[0]?.body,
    durable:JSON.parse(slots.get(shared.SECURE_NOTES_SLOT).currentRaw).records[0]?.body,
    draft:slots.get(shared.SECURE_NOTES_DRAFT_SLOT)?.records[0]?.body??null,
    retained:slots.get(shared.SECURE_NOTES_DRAFT_SLOT)!=null,
    draftReason:slots.get(shared.SECURE_NOTES_DRAFT_SLOT)?.reason??null,
    draftBase:slots.get(shared.SECURE_NOTES_DRAFT_SLOT)?.base===originalBase?'original':'',
    conflict:!!owner.notesDraftConflict});
  return {shell,observe,sources,driverHashes,async reopen(){
    shell.live=false;
    return openShell();
  },delay(afterCommit){
    delayed=deferred();commitBeforeFailure=afterCommit;return delayed;
  }};
}

export async function probeNotesCoordinator(afterCommit=true,extraSources=[]) {
  const f=await fixture(extraSources),observations=[{label:'opened',state:f.observe()}];
  const failure=f.delay(afterCommit);
  const first=f.shell.vset('notes',{list:[{...f.shell.notes.list[0],body:'first-edit'}]});
  const second=f.shell.vset('notes',{list:[{...f.shell.notes.list[0],body:'second-edit'}]});
  await tick();observations.push({label:'two optimistic edits',state:f.observe()});
  failure.reject(Error('Injected lost acknowledgement'));
  assert.equal(await first,false);await f.shell.notesDraftTask;
  observations.push({label:'first unknown outcome',state:f.observe()});
  assert.equal(await second,false);await f.shell.notesDraftTask;
  observations.push({label:'queued failure keeps uncertainty',state:f.observe()});
  assert.equal(f.observe().uncertain,true);
  assert.equal(f.observe().draftReason,'uncertain');
  const reopened=await f.reopen();
  observations.push({label:'restart inspects preserved draft',state:f.observe(reopened)});
  reopened.live=false;
  return {observations,sources:f.sources,driverHashes:f.driverHashes};
}

export async function checkNotesCoordinator(extraSources=[]) {
  const generated=[];
  for(const afterCommit of [true,false])generated.push({...await probeNotesCoordinator(afterCommit,extraSources),afterCommit});
  const output=resolve(root,'test-results/quint-refinement/notes-coordinator-source.json');
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(generated,null,2)+'\n');
  const identity=value=>value==='first-edit'?'first':value==='second-edit'?'second':value??'';
  const project=state=>({
    'PendingCount':state.pending,'s.fault':state.fault,'s.uncertain':state.uncertain,
    's.draft':identity(state.editor),'s.content':identity(state.confirmed),
    's.storedContent':identity(state.durable),'s.durableDraft':identity(state.draft),
    's.retainedDraft':state.retained,'s.durableBase':state.draftBase,'s.draftConflict':state.conflict,
  });
  const trace=scenario=>{
    const actions=[
    [{name:'enqueue',args:['first']},{name:'enqueue',args:['second']},...(scenario.afterCommit?[{name:'publishWrite'}]:[])],
    [{name:'failWrite',args:[true]},{name:'rejectQueued'},{name:'preserveDraft'}],
    null,
    [{name:'restart'}],
  ];
    return {name:scenario.afterCommit?'queued-unknown-write-retains-conflict':'queued-unknown-write-recovers-draft',init:{name:'initLegacy'},
      expect:project(scenario.observations[0].state),steps:scenario.observations.slice(1)
        .map((observation,index)=>({label:observation.label,action:actions[index],expect:project(observation.state)}))};
  };
  return checkTraces({model:'NotesLifecycle',id:'NotesLifecycle-coordinator',
    sources:[...new Set(generated.flatMap(scenario=>scenario.sources))],driverHashes:generated[0].driverHashes,
    scope:'bounded-orchestration',traces:generated.map(trace),
    assumptions:[
      'Actual legacy Notes vset and encrypted draft retention functions execute with SecureNotesStore and its shared document engine. Canonical Notes and the screen/router are separate contracts.',
      'The storage port fails either before or after atomically publishing the first edit. The second queued edit receives the retained fault. Reopening reads the actual stored version and retains the recovery draft without applying it. The current renderer requires an owner recovery action before merging.',
      'The model uses equality classes for original and two edited bodies. One checkpoint joins the two source rejection callbacks after their microtasks settle.',
      'Physical durability, Android Keystore, true React rendering, arbitrary note batches and other failure schedules remain separate obligations.',
    ]});
}

if(process.argv[1]===driver){const receipt=await checkNotesCoordinator();console.log(JSON.stringify({passed:receipt.passed,traces:receipt.traces,checkpoints:receipt.checkpoints}));}
