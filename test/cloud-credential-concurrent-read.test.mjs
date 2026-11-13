import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';

function fixture(browserCloudHost=true) {
 const source=readFileSync(new URL('../apps/app/src/runtime/native-connection.ts',import.meta.url),'utf8');
 const start=source.indexOf('// Serialize credential operations');
 const end=source.indexOf('/**',start);
 assert.ok(start>=0&&end>start);
 let held,failure,reads=0,value={credentialId:'old',userId:'owner'};
 const box={browserCloudHost,crypto:{randomUUID:()=> 'new-id'},
  secureConnectionStore:{async read(){reads++;if(held)await held;if(failure){const error=failure;failure=null;throw error;}return value?{...value}:null;},async write(_slot,next){value={...next};},async remove(){value=null;}},
  async clearBrowserCloudCredentialIfCurrent(){value=null;return true;}};
 vm.runInNewContext(stripTypeScriptTypes(source.slice(start,end).replace('export const cloudCredentialStore','const cloudCredentialStore'),{mode:'strip'})+';this.store=cloudCredentialStore;',box);
 return {store:box.store,get reads(){return reads;},failNext(){failure=Error("read failed");},hold(){let release;held=new Promise(resolve=>release=resolve);return ()=>{held=null;release();};}};
}

test('concurrent browser reads use one bridge call, return separate values, and leave no settled cache',async()=>{
 const f=fixture(),release=f.hold();
 const a=f.store.read('production'),b=f.store.read('production');
 await Promise.resolve();assert.equal(f.reads,1);release();
 const [first,second]=await Promise.all([a,b]);assert.equal(first.credentialId,'old');assert.notEqual(first,second);
 first.credentialId='changed by caller';assert.equal(second.credentialId,'old');
 await f.store.read('production');assert.equal(f.reads,2);
});

test('reads started after a queued write or clear cannot reuse the earlier read',async()=>{
 const f=fixture(),release=f.hold();const before=f.store.read('production');
 await Promise.resolve();
 const write=f.store.write('production',{userId:'next'},new AbortController().signal);
 const after=f.store.read('production');release();
 assert.equal((await before).credentialId,'old');await write;assert.equal((await after).credentialId,'new-id');
 assert.equal(f.reads,2);
 const clear=f.store.clear('production');const empty=f.store.read('production');await clear;assert.equal(await empty,null);
});

test('native calls retain their independent serialized reads',async()=>{
 const f=fixture(false);await Promise.all([f.store.read('production'),f.store.read('production')]);assert.equal(f.reads,2);
});

test('different Cloud environments never share a read',async()=>{
 const f=fixture();await Promise.all([f.store.read('production'),f.store.read('staging')]);assert.equal(f.reads,2);
});


test('a failed read is not cached and conditional clear starts a new read generation',async()=>{
 const f=fixture();f.failNext();await assert.rejects(f.store.read('production'),/read failed/);
 const current=await f.store.read('production');assert.equal(current.credentialId,'old');
 const clear=f.store.clearIfCurrent('production',current);const next=f.store.read('production');await clear;assert.equal(await next,null);assert.equal(f.reads,3);
});
