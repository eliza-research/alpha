import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transform} from 'esbuild';

// Execute the production review/delete methods with a synthetic transactional media store.
// No personal media, DOM, provider or Android device is touched by this host test.
const source=readFileSync('apps/app/src/prototype/browser-camera.ts','utf8');
const selection=source.slice(source.indexOf('function selectedMedia('),source.indexOf('async function selectedMediaRows('));
const methods=source.slice(source.indexOf(' async prepareDeleteTrash('),source.indexOf('\n};',source.indexOf(' async prepareDeleteTrash(')));
async function fixture(){
 const records=new Map(['a','b','c'].map(id=>[id,{id,kind:'image',trashed:id!=='c',mutationRevision:'r-'+id}]));
 const transaction=async(mode,action)=>{let result;const pending=[];action({get(id){const request={result:records.get(id)};pending.push(()=>request.onsuccess());return request;},delete(id){records.delete(id);}},value=>result=value);for(const finish of pending)finish();return result;};
 const code=await transform('const prepared=new Map();'+selection+'globalThis.library={'+methods+'};',{loader:'ts'});
 const context=vm.createContext({rows:async()=>[...records.values()],revision:()=>crypto.randomUUID(),transaction});vm.runInContext(code.code,context);
 return {records,library:context.library};
}
test('selected permanent deletion affects only the exact reviewed revisions',async()=>{
 const {records,library}=await fixture();const review=await library.prepareDeleteTrash({items:[{id:'a',revision:'r-a'}]});assert.equal(review.count,1);assert.equal(records.size,3,'review does not delete');
 const result=await library.deletePreparedTrash(review);assert.deepEqual([...result.deletedIds],['a']);assert.ok(records.has('b'));assert.ok(records.has('c'));await assert.rejects(library.deletePreparedTrash(review),/Review/);
});
test('restore or revision changes after review are skipped; new trash is excluded',async()=>{
 const {records,library}=await fixture();const review=await library.prepareDeleteTrash({all:true});records.get('a').trashed=false;records.get('b').mutationRevision='changed';records.get('c').trashed=true;
 const result=await library.deletePreparedTrash(review);assert.deepEqual([...result.deletedIds],[]);assert.deepEqual([...result.skippedIds].sort(),['a','b']);assert.equal(records.size,3);
});
test('invalid, duplicate and stale selection refuses preparation; cancel consumes review',async()=>{
 const {records,library}=await fixture();for(const items of [[],[{id:'a',revision:'old'}],[{id:'c',revision:'r-c'}],[{id:'a',revision:'r-a'},{id:'a',revision:'r-a'}]])await assert.rejects(library.prepareDeleteTrash({items}));
 const review=await library.prepareDeleteTrash({items:[{id:'b',revision:'r-b'}]});await library.cancelDeleteTrash(review);await assert.rejects(library.deletePreparedTrash(review));assert.equal(records.size,3);
});
test('emptying the trash needs the explicit all intent; a missing or unusable selection is refused',async()=>{
 const {records,library}=await fixture();
 for(const input of [undefined,null,{},{items:null},{items:'x'},{all:false},{all:'true'},{all:true,items:[{id:'a',revision:'r-a'}]}])await assert.rejects(library.prepareDeleteTrash(input),/Select/);
 const review=await library.prepareDeleteTrash({all:true});assert.equal(review.count,2);assert.equal(records.size,3);
});
test('native prepareDeleteTrash reads the selection through the shared TrashDeleteRequest before asking the library',()=>{
 // The shared request parser refuses no intent, items:null and a non-list items value; only {all:true} empties the trash.
 // AlphaPhotos is a registration of the shared PhotosPlugin, which owns this method.
 const java=readFileSync(new URL('../vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/PhotosPlugin.java',import.meta.url),'utf8');
 const method=java.slice(java.indexOf('public void prepareDeleteTrash('),java.indexOf('public void cancelDeleteTrash('));
 assert.doesNotMatch(method,/getArray\("items"\)/,'the plugin never hands a raw or null items array to the library');
 assert.match(method,/request = TrashDeleteRequest\.fromPayload\(call\.getData\(\)\);\s*\} catch \(IllegalArgumentException unusable\) \{\s*call\.reject\("Select deleted items again\.[^"]*"\);\s*return;\s*\}/);
 assert.ok(method.indexOf('TrashDeleteRequest.fromPayload(')<method.indexOf('owned.prepareDeleteTrash(request)'),'refusal happens before the shared library is asked');
 const adapter=readFileSync('apps/app/src/prototype/camera-adapter.ts','utf8');
 assert.match(adapter,/library\.prepareDeleteTrash\(selected\?\{items:selected\}:\{all:true\}\)/,'Empty trash sends the explicit all intent');
});
