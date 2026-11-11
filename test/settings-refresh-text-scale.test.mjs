import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

const source=readFileSync('apps/app/src/prototype/settings-adapter.ts','utf8');
const start=source.indexOf('  async function refresh() {');
const end=source.indexOf('  p.componentDidMount =',start);
assert.ok(start>=0&&end>start);
const actual=stripTypeScriptTypes(source.slice(start,end),{mode:'strip'});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){
  const reads=[],writes=[],notices=[],publications=[];
  const owner={vset:(view,value)=>publications.push({view,value})};
  const context=vm.createContext({
    owner,facts:{},controls:{},delivery:{},cross:{},roles:null,launcher:null,crashLog:null,photoAccess:null,
    history:null,generation:0,scaleGeneration:0,scaleVersion:0,scalePending:false,
    Capacitor:{isNativePlatform:()=>true},developerTools:false,
    device:{snapshot:()=>{const read=deferred();reads.push(read);return read.promise;},setTextScale:({percent})=>{const write=deferred();writes.push({...write,percent});return write.promise;}},
    system:{getDeviceSettings:async()=>({volumes:[{stream:'music',value:6}]}),getStatus:async()=>({home:{held:true}}),getBuildInfo:async()=>({launcher:true})},
    notifications:{status:async()=>({appEnabled:true}),crossAppStatus:async()=>({access:'granted'})},
    readCrashLog:async()=>({entries:[]}),photoLibrary:{libraryAccess:async()=>({scope:'full'})},
    connectionController:{refreshProviderStatus:async()=>({configured:true})},
    readRoles:value=>value,refreshPasswordManager(){},Date,
  });
  vm.runInContext(actual+';globalThis.current={refresh,changeTextScale};',context);
  const api={toast:message=>notices.push(message)};
  return {context,reads,writes,notices,publications,refresh:()=>context.current.refresh(),scale:percent=>context.current.changeTextScale(percent,api)};
}

test('a text-size write preserves all unrelated facts from a held initial refresh',async()=>{
  const f=fixture(),initial=f.refresh();
  const writing=f.scale(115);f.writes[0].resolve({textScalePercent:115,effectiveTextZoom:138});await writing;
  f.reads[0].resolve({batteryPercent:64,model:'Phone',textScalePercent:100,effectiveTextZoom:120});await initial;
  assert.deepEqual(plain(f.context.facts),{batteryPercent:64,model:'Phone',textScalePercent:115,effectiveTextZoom:138});
  assert.deepEqual(plain(f.context.roles),{home:{held:true}});
  assert.deepEqual(plain(f.context.controls),{volumes:[{stream:'music',value:6}]});
  assert.deepEqual(plain(f.context.delivery),{appEnabled:true});
  assert.deepEqual(plain(f.context.cross),{access:'granted'});
  assert.equal(f.context.launcher,true);
  assert.equal(f.reads.length,1,'successful text changes do not need to repeat unrelated native reads');
});

test('a snapshot started during a pending text write cannot replace its later result',async()=>{
  const f=fixture(),writing=f.scale(130),refresh=f.refresh();
  f.writes[0].resolve({textScalePercent:130,effectiveTextZoom:130});await writing;
  f.reads[0].resolve({textScalePercent:100,effectiveTextZoom:100,batteryPercent:40});await refresh;
  assert.equal(f.context.facts.textScalePercent,130);
  assert.equal(f.context.facts.effectiveTextZoom,130);
  assert.equal(f.context.facts.batteryPercent,40);
});

test('only the latest text write may publish after overlapping requests',async()=>{
  const f=fixture(),first=f.scale(75),second=f.scale(150);
  f.writes[1].resolve({textScalePercent:150,effectiveTextZoom:150});await second;
  f.writes[0].resolve({textScalePercent:75,effectiveTextZoom:75});await first;
  assert.equal(f.context.facts.textScalePercent,150);
  assert.equal(f.context.scalePending,false);
  assert.equal(f.publications.length,1);
});

test('a failed write rereads native facts instead of leaving initial facts retired',async()=>{
  const f=fixture(),initial=f.refresh(),writing=f.scale(115);
  f.writes[0].reject(Error('Storage unavailable'));await writing;
  assert.deepEqual(f.notices,['Text size could not be saved.']);
  assert.equal(f.reads.length,2);
  f.reads[0].resolve({textScalePercent:100,model:'Old read'});await initial;
  f.reads[1].resolve({textScalePercent:100,effectiveTextZoom:100,model:'Current read'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.context.facts.model,'Current read');
  assert.equal(f.context.facts.textScalePercent,100);
  assert.deepEqual(plain(f.context.roles),{home:{held:true}});
});
