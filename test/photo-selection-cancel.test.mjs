import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';
import {changeBatches,runBatches} from '../.eliza/client-features/packages/ui/src/mobile-shell/photos-view.ts';
const source=readFileSync('apps/app/src/prototype/camera-adapter.ts','utf8');
const begin=source.indexOf('  async function changeSelection(');
const end=source.indexOf('  // Browser-owned album storage',begin);
assert(begin>=0&&end>begin);
const lastStart=source.indexOf('  function setLast('),lastEnd=source.indexOf('  let accessPanel:',lastStart);assert.ok(lastStart>=0&&lastEnd>lastStart);
const code=stripTypeScriptTypes(source.slice(lastStart,lastEnd)+source.slice(begin,end),{mode:'transform'});
async function run(cancelAt){
 const rows=Array.from({length:45},(_,index)=>({id:'photo-'+index,mutationRevision:'revision',trashed:false}));
 const calls=[],toasts=[];
 const context=vm.createContext({
  mutating:false,sharing:false,disposed:false,selection:rows,selectionTab:undefined,preview:null,
  BATCH:20,PERMITTED_BATCH:500,libraryAccess:undefined,changeBatches,runBatches,photoReadEpoch:0,libraryEpoch:0,trashEpoch:0,albumEpoch:0,albumKey:'',
  captures:rows,trash:[],albumRows:[],closeVideo(){},retirePhotoRead(){},
  lastEpoch:0,lastCapture:rows[0],session:{phase:'idle'},document:{hidden:false},loadLast(){throw Error('Inactive camera cannot reload');},
  favoriteTarget:()=>true,batches:(items,size)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size)),
  nativeId:id=>id,normalize:row=>row,
  insertRows:(rows,added)=>[...rows,...added],patchRows:(rows)=>rows,
  refresh:async()=>{},loadTrash:async()=>{},loadCounts:async()=>{},loadCustomAlbums:async()=>{},
  library:{async changeMany(input){calls.push(input);if(calls.length===cancelAt)throw Object.assign(Error('Owner canceled'),{code:'LIBRARY_DECLINED'});
   return {outcomes:input.items.map(item=>({id:item.id,status:'succeeded',item:{id:item.id,trashed:true,mutationRevision:'changed'}}))};}},
 });
 const change=vm.runInContext(code+';changeSelection',context);
 await change({set(){},isActive:()=>true,toast:text=>toasts.push(text)},'trash');
 return {calls,toasts,mutating:context.mutating,lastEpoch:context.lastEpoch,lastCapture:context.lastCapture};
}
test('declining the first Photos batch does not open another confirmation or claim a change',async()=>{
 const result=await run(1);
 assert.equal(result.calls.length,1);
 assert.deepEqual(result.toasts,[]);assert.equal(result.lastEpoch,0);
 assert.equal(result.mutating,false);
});
test('declining a later Photos batch retains the earlier confirmed result and ends the run',async()=>{
 const result=await run(2);
 assert.equal(result.calls.length,2);
 assert.deepEqual(result.toasts,['20 deleted · 25 not changed']);assert.equal(result.lastEpoch,1);assert.equal(result.lastCapture,undefined);
 assert.equal(result.mutating,false);
});
