import test from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
const {createDeletionNoticePolicy}=await tsImport(new URL('../apps/app/src/runtime/deletions.ts',import.meta.url).href,{parentURL:import.meta.url});

const row=(id='event',phase='queued')=>({kind:'calendar',id,phase,window:'open',target:{row:{title:id}}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(){
 let owner='A';const listeners=new Set(),failure=Error('bridge unavailable');
 const native={async pending(){throw failure;},async undo(){throw failure;},async dismiss(){throw failure;}};
 const policy=createDeletionNoticePolicy(native,{read:()=>owner,subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);}});
 // The shared notice supplies the subscription; the policy does not add one.
 const unsubscribe=policy.identity.subscribe(()=>{});
 return {...policy,native,failure,unsubscribe,listeners,change(next){owner=next;for(const listener of listeners)listener();}};
}

test('passive status failures stay quiet without a known pending deletion, but known failures remain visible',async()=>{
 const f=fixture();
 assert.deepEqual(await f.bridge.pending(),{deletions:[]});
 f.native.pending=async()=>({deletions:[row('settled','deleted')]});await f.bridge.pending();
 f.native.pending=async()=>{throw f.failure;};assert.deepEqual(await f.bridge.pending(),{deletions:[]});
 f.native.pending=async()=>({deletions:[row()]});await f.bridge.pending();
 f.native.pending=async()=>{throw f.failure;};await assert.rejects(f.bridge.pending(),error=>error===f.failure);
 assert.equal(f.listeners.size,1);f.unsubscribe();assert.equal(f.listeners.size,0);
});

test('explicit Undo and dismiss failures remain observable even without a successful status poll',async()=>{
 const f=fixture();
 await assert.rejects(f.bridge.undo({kind:'calendar',id:'event'}),error=>error===f.failure);
 await assert.rejects(f.bridge.dismiss({kind:'calendar',id:'event'}),error=>error===f.failure);
 f.unsubscribe();
});

test('only a confirmed Undo or a resolved dismissal retires its known row',async()=>{
 const f=fixture(),entry=row();
 f.native.pending=async()=>({deletions:[entry]});await f.bridge.pending();
 f.native.undo=async()=>({phase:'deleted'});await f.bridge.undo(entry);
 f.native.pending=async()=>{throw f.failure;};await assert.rejects(f.bridge.pending(),error=>error===f.failure);
 f.native.undo=async()=>({phase:'undone'});await f.bridge.undo(entry);
 assert.deepEqual(await f.bridge.pending(),{deletions:[]});
 f.native.pending=async()=>({deletions:[entry]});await f.bridge.pending();
 f.native.dismiss=async()=>({});await f.bridge.dismiss(entry);
 f.native.pending=async()=>{throw f.failure;};assert.deepEqual(await f.bridge.pending(),{deletions:[]});
 f.unsubscribe();
});

test('a successful old A poll cannot revive passive warnings after A -> B -> A',async()=>{
 const f=fixture(),pending=deferred();
 f.native.pending=()=>pending.promise;const oldRead=f.bridge.pending();
 f.change('B');f.change('A');
 pending.resolve({deletions:[row()]});await oldRead;
 f.native.pending=async()=>{throw f.failure;};assert.deepEqual(await f.bridge.pending(),{deletions:[]});
 f.unsubscribe();
});

test('a late Undo from old A cannot clear the new A session\'s known deletion',async()=>{
 const f=fixture(),entry=row(),pending=deferred();
 f.native.pending=async()=>({deletions:[entry]});await f.bridge.pending();
 f.native.undo=()=>pending.promise;const oldUndo=f.bridge.undo(entry);
 f.change('B');f.change('A');await f.bridge.pending();
 pending.resolve({phase:'undone'});await oldUndo;
 f.native.pending=async()=>{throw f.failure;};await assert.rejects(f.bridge.pending(),error=>error===f.failure);
 f.unsubscribe();
});

test('a stale failed poll cannot surface an error for a different owner with a known deletion',async()=>{
 const f=fixture(),pending=deferred();
 f.native.pending=()=>pending.promise;const oldRead=f.bridge.pending();
 f.change('B');f.native.pending=async()=>({deletions:[row('new-owner')]});await f.bridge.pending();
 pending.reject(f.failure);assert.deepEqual(await oldRead,{deletions:[]});
 f.native.pending=async()=>{throw f.failure;};await assert.rejects(f.bridge.pending(),error=>error===f.failure);
 f.unsubscribe();
});
