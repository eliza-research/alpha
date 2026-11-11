import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {readNativeNetwork} from '../apps/app/src/runtime/native-network.ts';

const source=await readFile(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const start=source.indexOf('  useEffect(()=>{\n    if(!isAndroid)return;\n    const lifecycle=new AbortController();');
const end=source.indexOf('  // Plan state is checked again',start);
assert.ok(start>=0&&end>start);
const observer=source.slice(source.indexOf('let nativeNetworkGeneration ='),source.indexOf('let state:'));
const code=stripTypeScriptTypes(observer+'\n'+source.slice(start,end),{mode:'strip'});
const settled=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(read) {
  const window=new EventTarget(),document=Object.assign(new EventTarget(),{hidden:false});
  const observations=[],planChecks=[],membership=[];
  let cleanup;
  const box={isAndroid:true,AbortController,readNativeNetwork,System:{getNetworkStatus:read},window,document,
    service:{},residentCloudFlow:()=>true,refreshMembershipBalance:()=>{membership.push(true);},
    connectionController:{networkChanged:online=>{observations.push(online);},recheckPlanOnReturn:()=>{planChecks.push(observations.at(-1));}},
    useEffect:run=>{cleanup=run();}};
  vm.runInNewContext(code,box);
  return {window,document,observations,planChecks,membership,cleanup:()=>cleanup?.(),
    observeSend:()=>box.observeNativeNetwork(new AbortController().signal),
    fire(type){(type==='visibilitychange'?document:window).dispatchEvent(new Event(type));}};
}
test('Android samples its active network before foreground plan-return checks',async()=>{
  let connected=true;const f=fixture(async()=>({connected}));
  try {
    await settled();assert.deepEqual(f.observations,[true]);assert.deepEqual(f.planChecks,[true]);
    connected=false;f.fire('offline');await settled();assert.equal(f.observations.at(-1),false);assert.equal(f.planChecks.at(-1),false);
    connected=true;f.fire('pageshow');await settled();assert.equal(f.observations.at(-1),true);assert.equal(f.planChecks.at(-1),true);
    f.document.hidden=true;connected=false;f.fire('offline');await settled();const checks=f.planChecks.length;
    connected=true;f.fire('online');await settled();assert.equal(f.observations.at(-1),true);assert.equal(f.planChecks.length,checks);
    f.document.hidden=false;f.fire('visibilitychange');await settled();assert.equal(f.planChecks.length,checks+1);
  } finally {f.cleanup();}
});
test('newer native observations retire an older event and cleanup retires pending reads',async()=>{
  const reads=[];const f=fixture(()=>new Promise(resolve=>reads.push(resolve)));
  await settled();f.fire('online');await settled();
  reads[1]({connected:true});await settled();reads[0]({connected:false});await settled();
  assert.deepEqual(f.observations,[true]);
  f.fire('offline');await settled();f.cleanup();reads[2]({connected:false});await settled();
  assert.deepEqual(f.observations,[true]);
  f.fire('online');await settled();assert.equal(reads.length,3);
});
test('a newer send observation prevents an older lifecycle read from restoring a stale offline flag',async()=>{
  const reads=[];const f=fixture(()=>new Promise(resolve=>reads.push(resolve)));
  try {
    await settled();const send=f.observeSend();await settled();
    reads[1]({connected:true});assert.equal((await send).connected,true);
    reads[0]({connected:false});await settled();
    assert.deepEqual(f.observations,[true]);assert.deepEqual(f.planChecks,[],'the superseded lifecycle result cannot run a return check either');
  }finally{f.cleanup();}
});
test('unavailable native network facts clear a stale offline hint without claiming a disconnection',async()=>{
  const f=fixture(async()=>{throw Error('Bridge unavailable');});
  try {await settled();assert.deepEqual(f.observations,[true]);}finally{f.cleanup();}
});
