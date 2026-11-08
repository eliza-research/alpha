import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=readFileSync('apps/app/src/prototype/camera-adapter.ts','utf8');
const begin=source.indexOf('  async function changeSelection(');
const end=source.indexOf('  // Browser-owned album storage',begin);
assert(begin>=0&&end>begin);
const code=stripTypeScriptTypes(source.slice(begin,end),{mode:'transform'});
async function run(cancelAt){
 const rows=Array.from({length:45},(_,index)=>({id:'photo-'+index,mutationRevision:'revision',trashed:false}));
 const calls=[],toasts=[];
 const context=vm.createContext({
  mutating:false,sharing:false,disposed:false,selection:rows,selectionTab:undefined,preview:null,
  BATCH:20,photoReadEpoch:0,libraryEpoch:0,trashEpoch:0,albumEpoch:0,albumKey:'',
  captures:rows,trash:[],albumRows:[],closeVideo(){},retirePhotoRead(){},
  favoriteTarget:()=>true,batches:(items,size)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size)),
  nativeId:id=>id,normalize:row=>row,
  insertRows:(rows,added)=>[...rows,...added],patchRows:(rows)=>rows,
  refresh:async()=>{},loadTrash:async()=>{},loadCounts:async()=>{},loadCustomAlbums:async()=>{},
  library:{async changeMany(input){calls.push(input);if(calls.length===cancelAt)throw Object.assign(Error('Owner canceled'),{code:'LIBRARY_DECLINED'});
   return {outcomes:input.items.map(item=>({id:item.id,status:'succeeded',item:{id:item.id,trashed:true,mutationRevision:'changed'}}))};}},
 });
 const change=vm.runInContext(code+';changeSelection',context);
 await change({set(){},isActive:()=>true,toast:text=>toasts.push(text)},'trash');
 return {calls,toasts,mutating:context.mutating};
}
test('declining the first Photos batch does not open another confirmation or claim a change',async()=>{
 const result=await run(1);
 assert.equal(result.calls.length,1);
 assert.deepEqual(result.toasts,[]);
 assert.equal(result.mutating,false);
});
test('declining a later Photos batch retains the earlier confirmed result and ends the run',async()=>{
 const result=await run(2);
 assert.equal(result.calls.length,2);
 assert.deepEqual(result.toasts,['20 moved to Recently deleted']);
 assert.equal(result.mutating,false);
});
