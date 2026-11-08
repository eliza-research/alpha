import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
// #406: a saved hosted or paired agent selection from an earlier build becomes the resident agent.
// Runs the real selection and migration functions of connection-ui.tsx against an in-memory
// localStorage. The sandbox has no credential store, network or agent: any attempt to read a
// credential, send a request or connect would throw here.
const source=await readFile(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const slice=(from,to)=>{const begin=source.indexOf(from),end=source.indexOf(to,begin);assert.ok(begin>=0&&end>begin,from);return source.slice(begin,end);};
const code=stripTypeScriptTypes([
 slice('function save(selection: Selection)','\nfunction retire('),
 slice('function selection(): Selection | null {','\nfunction errorMessage('),
 slice('/** Saved selection kinds of the retired hosted and paired agents','/**\n * Every Alpha Phone signs in to Eliza Cloud'),
].join('\n').replace(/export /g,''),{mode:'transform'});
const SELECTION='alpha.connection.selection.v1',LEGACY='alpha.connection.legacy-hosted-selection.v1';
const CONVERSATIONS='alpha.connection.conversations.v1',CLOUD_SERVICE='alpha.connection.cloud-service.v1';
function fixture(testMocksEnabled,seed){
 const memory=new Map(Object.entries(seed)),writes=[];
 const localStorage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>{writes.push(key);memory.set(key,String(value));},removeItem:key=>{writes.push(key);memory.delete(key);}};
 const context=vm.createContext({localStorage,testMocksEnabled,residentAlwaysPresent:!testMocksEnabled,SELECTION,browserDevProfile:false,developmentProfiles:[],cloudEnvironmentAllowed:value=>value==='production'||(testMocksEnabled&&value==='staging'),JSON});
 vm.runInContext(code+'\nglobalThis.api={selection,migrate:migrateLegacyHostedSelection,LEGACY_HOSTED_SELECTION};',context);
 return {api:context.api,memory,writes};
}
const legacy=[
 {kind:'remote',origin:'https://agent.example.test'},
 {kind:'local',origin:'http://10.0.2.2:2138'},
 {kind:'cloud',environment:'production',agentId:'33333333-3333-4333-8333-333333333333',ownerId:'11111111-1111-4111-8111-111111111111'},
];
const history=JSON.stringify({'legacy-owner-a':'conversation-a'});

test('a product build reads every saved hosted or paired agent as the resident agent',()=>{
 for(const saved of legacy){
  const {api}=fixture(false,{[SELECTION]:JSON.stringify(saved)});
  assert.deepEqual({...api.selection()},{kind:'resident'},saved.kind);
 }
});

test('a product build moves the saved hosted selection aside, keeps history and connects nothing',()=>{
 for(const saved of legacy){
  const f=fixture(false,{[SELECTION]:JSON.stringify(saved),[CONVERSATIONS]:history,[CLOUD_SERVICE]:'production'});
  assert.equal(f.api.LEGACY_HOSTED_SELECTION,LEGACY);
  assert.equal(f.api.migrate(),true,saved.kind);
  assert.deepEqual(JSON.parse(f.memory.get(SELECTION)),{kind:'resident'});
  // Moved, not deleted: the exact earlier choice is kept for recovery.
  assert.deepEqual(JSON.parse(f.memory.get(LEGACY)),[saved]);
  // Conversation selections and the Cloud service marker are untouched; nothing else was written.
  assert.equal(f.memory.get(CONVERSATIONS),history);
  assert.equal(f.memory.get(CLOUD_SERVICE),'production');
  assert.deepEqual(f.writes.sort(),[LEGACY,SELECTION].sort());
  // Idempotent: the next start has nothing to migrate.
  assert.equal(f.api.migrate(),false);
 }
});

test('an earlier migrated record is never overwritten and a later hosted choice is kept too',()=>{
 const first={kind:'remote',origin:'https://first.example.test'};
 const f=fixture(false,{[SELECTION]:JSON.stringify(legacy[2]),[LEGACY]:JSON.stringify([first])});
 assert.equal(f.api.migrate(),true);
 assert.deepEqual(JSON.parse(f.memory.get(LEGACY)),[first,legacy[2]]);
 assert.deepEqual(JSON.parse(f.memory.get(SELECTION)),{kind:'resident'});
 // A second hosted choice saved later (for example by an older build restored from backup) is appended.
 f.memory.set(SELECTION,JSON.stringify(legacy[0]));
 assert.equal(f.api.migrate(),true);
 assert.deepEqual(JSON.parse(f.memory.get(LEGACY)),[first,legacy[2],legacy[0]]);
});

test('a non-array or unreadable earlier record is kept ahead of the new one',()=>{
 const single={kind:'local',origin:'http://10.0.2.2:2138'};
 let f=fixture(false,{[SELECTION]:JSON.stringify(legacy[0]),[LEGACY]:JSON.stringify(single)});
 assert.equal(f.api.migrate(),true);
 assert.deepEqual(JSON.parse(f.memory.get(LEGACY)),[single,legacy[0]]);
 f=fixture(false,{[SELECTION]:JSON.stringify(legacy[0]),[LEGACY]:'{not json'});
 assert.equal(f.api.migrate(),true);
 assert.deepEqual(JSON.parse(f.memory.get(LEGACY)),['{not json',legacy[0]]);
});

test('product labels never describe an unexpected non-resident connection as on this device',()=>{
 const settings=readFileSync(new URL('../apps/app/src/prototype/settings-adapter.ts',import.meta.url),'utf8');
 assert.match(settings,/testMocksEnabled\?'Remote agent':'Unsupported connection'/);
 assert.match(source,/testMocksEnabled \? \(snapshot\.kind === 'cloud' \? serviceName : snapshot\.kind === 'local' \? 'Local development' : 'Remote agent'\) : 'Unsupported connection'\}/);
 assert.doesNotMatch(settings,/testMocksEnabled\?'Remote agent':'On this device'/);
});

test('other saved choices are not migrated',()=>{
 for(const saved of [null,{kind:'resident'},{kind:'offline'},{kind:'none'},{kind:'mock'},'not json']){
  const seed=saved===null?{}:{[SELECTION]:typeof saved==='string'?saved:JSON.stringify(saved)};
  const f=fixture(false,seed);
  assert.equal(f.api.migrate(),false,JSON.stringify(saved));
  assert.deepEqual(f.writes,[]);
 }
});

test('a test-mocks build keeps its development hosted selections',()=>{
 for(const saved of legacy){
  const f=fixture(true,{[SELECTION]:JSON.stringify(saved)});
  assert.equal(f.api.migrate(),false);
  assert.deepEqual({...f.api.selection()},saved);
  assert.deepEqual(f.writes,[]);
 }
});

test('product startup migrates before any restore and never restores a hosted agent',()=>{
 const initialize=slice('  async initialize() {','\n  async offline() {');
 const migrate=initialize.indexOf('if (!testMocksEnabled) migrateLegacyHostedSelection();');
 assert.ok(migrate>0,'startup migrates a saved hosted selection');
 for(const later of ['if (residentCloudFlow()) { await startResidentGate(); return; }','await work(\'Restoring your connection…\''])assert.ok(initialize.indexOf(later)>migrate,`${later} follows the migration`);
 // The only hosted restore goes through the development-only `hosted` object.
 assert.match(initialize,/if \(hosted && \(saved\.kind === 'cloud' \|\| saved\.kind === 'remote' \|\| saved\.kind === 'local'\)\) await hosted\.restore\(saved, signal\);/);
 assert.doesNotMatch(initialize,/connectCloud\(|connectRemote\(|inspectPersonal\(/);
 assert.match(source,/const hosted = testMocksEnabled \? \{/);
});
