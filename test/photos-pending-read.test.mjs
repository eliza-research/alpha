import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {resolve} from 'node:path';
const source=readFileSync(resolve(import.meta.dirname,'../apps/app/src/prototype/camera-adapter.ts'),'utf8');
function declaration(signature){const start=source.indexOf(signature);assert.ok(start>=0);let end=source.indexOf('{',start),depth=1;for(end++;depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}return source.slice(start,end);}
function fixture(){
 const state={open:null,album:null,nativePhotoSelection:null},requests=[],toasts=[];
 const api={get:()=>state,isActive:()=>true,set:patch=>Object.assign(state,patch),toast:message=>toasts.push(message)};
 const sandbox={disposed:false,document:{hidden:false},photoReadEpoch:0,reading:'',preview:undefined,photosApi:api,Date,
  library:{read:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))},nativeId:id=>id,normalize:row=>row,captureSelection:row=>({id:row.id}),closeVideo(){},cancelEdit(){},refresh(){},loadTrash(){},loadCounts(){},loadCustomAlbums(){},loadAlbum(){},
  libraryEpoch:0,captures:[],albumRows:[],trash:[],albumNext:'',trashNext:'',albumKey:'',counts:undefined,countsEpoch:0,countsBusy:false,albumsEpoch:0,albumsBusy:false,albumsLoaded:false,customAlbums:[],albumEpoch:0,trashEpoch:0,selection:undefined,next:'',loaded:false};
 vm.createContext(sandbox);
 const code=[declaration('const retirePhotoRead='),declaration('async function openSaved('),declaration('function invalidateLibrary(')].join('\n')+'\nglobalThis.openSaved=openSaved;globalThis.invalidateLibrary=invalidateLibrary;';
 vm.runInContext(stripTypeScriptTypes(code,{mode:'transform'}),sandbox);
 return {sandbox,state,requests,toasts,api};
}
for(const late of ['resolve','reject'])test(`catalog invalidation permits reopening; late ${late} cannot affect newer same-photo read`,async()=>{
 const f=fixture();const first=f.sandbox.openSaved('qa-photo',f.api);assert.equal(f.requests.length,1);assert.equal(f.state.open,'qa-photo');
 f.sandbox.invalidateLibrary(true);assert.equal(f.state.open,null);
 const second=f.sandbox.openSaved('qa-photo',f.api);assert.equal(f.requests.length,2,'a normal retry dispatches a fresh read');
 if(late==='resolve')f.requests[0].resolve({id:'qa-photo',image:'old pixels'});else f.requests[0].reject(Error('old read failed'));
 await first;assert.equal(f.sandbox.preview,undefined,'retired pixels never republish');assert.equal(f.state.open,'qa-photo');assert.equal(f.toasts.length,0);
 await f.sandbox.openSaved('qa-photo',f.api);assert.equal(f.requests.length,2,'old finally cannot release newer in-flight guard');
 f.requests[1].resolve({id:'qa-photo',image:'current pixels'});await second;assert.equal(f.sandbox.preview.image,'current pixels');assert.equal(f.state.nativePhotoSelection.id,'qa-photo');
});
test('a store change patches the catalog without closing the viewer',()=>{
 const f=fixture();f.state.open='qa-photo';f.sandbox.invalidateLibrary();assert.equal(f.state.open,'qa-photo');
});
test('hidden or departed Photos cannot publish a pending read',async()=>{
 for(const hidden of [true,false]){const f=fixture();const pending=f.sandbox.openSaved('qa-photo',f.api);if(hidden)f.sandbox.document.hidden=true;else f.api.isActive=()=>false;f.requests[0].resolve({id:'qa-photo',image:'withheld'});await pending;assert.equal(f.sandbox.preview,undefined);assert.equal(f.state.nativePhotoSelection,null);}
});

test('a queued open after departure, hiding or disposal starts no native read',async()=>{
 for(const reason of ['hidden','inactive','disposed']){const f=fixture();if(reason==='hidden')f.sandbox.document.hidden=true;else if(reason==='inactive')f.api.isActive=()=>false;else f.sandbox.disposed=true;await f.sandbox.openSaved('qa-photo',f.api);assert.equal(f.requests.length,0);assert.equal(f.state.open,null);}
});
