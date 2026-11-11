// Browser photo storage rules run against an in-memory stand-in for IndexedDB (stores, one
// compound index, cursors, atomic transactions). It checks which stores each operation reads
// and writes; it is not a browser engine, a camera or an encoder.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {build} from 'esbuild';

const order=value=>Array.isArray(value)?3:typeof value==='string'?2:1;
function compare(a,b){
 if(order(a)!==order(b))return order(a)-order(b);
 if(Array.isArray(a)){for(let i=0;i<Math.min(a.length,b.length);i++){const c=compare(a[i],b[i]);if(c)return c;}return a.length-b.length;}
 return a<b?-1:a>b?1:0;
}
const inRange=(range,key)=>!range||(range.lower===undefined||compare(key,range.lower)>(range.lowerOpen?0:-1))&&(range.upper===undefined||compare(key,range.upper)<(range.upperOpen?0:1));
const IDBKeyRange={upperBound:(upper,upperOpen=false)=>({upper,upperOpen}),bound:(lower,upper)=>({lower,upper})};
/** `reads` counts every stored value handed to the page, per store. */
function fakeIndexedDB(){
 const databases=new Map(),reads={};
 const names=db=>({contains:name=>db.stores.has(name)});
 function transaction(db,mode,upgrade){
  const snapshot=new Map([...db.stores].map(([name,store])=>[name,new Map(store.rows)]));
  const tx={mode,error:null,finished:false,pending:0,oncomplete:null,onerror:null,onabort:null};
  const settle=()=>queueMicrotask(()=>{if(tx.finished||tx.pending)return;tx.finished=true;tx.oncomplete?.();tx.done?.();});
  tx.abort=()=>{if(tx.finished)return;tx.finished=true;if(!upgrade)for(const [name,rows] of snapshot)db.stores.get(name).rows=rows;tx.onabort?.();tx.done?.(tx.error??Error('aborted'));};
  const request=run=>{const req={result:undefined,onsuccess:null};tx.pending++;queueMicrotask(()=>{tx.pending--;if(tx.finished)return;try{req.result=run();req.onsuccess?.();}catch(error){tx.error=error;tx.abort();return;}settle();});return req;};
  const cursorOver=(storeName,keys,primary)=>{
   const req={result:null,onsuccess:null};let position=-1;tx.pending++;
   const step=()=>queueMicrotask(()=>{tx.pending--;if(tx.finished)return;position++;const store=db.stores.get(storeName);
    while(position<keys.length&&!store.rows.has(primary(keys[position])))position++;
    if(position>=keys.length)req.result=null;
    else{const key=primary(keys[position]);req.result={get value(){reads[storeName]=(reads[storeName]||0)+1;return structuredClone(store.rows.get(key));},continue(){tx.pending++;step();},update(value){store.rows.set(key,structuredClone(value));},delete(){store.rows.delete(key);}};}
    try{req.onsuccess?.();}catch(error){tx.error=error;tx.abort();return;}settle();});
   step();return req;
  };
  tx.objectStore=name=>{
   const store=db.stores.get(name);if(!store)throw Error('No object store '+name);
   const handle={name,transaction:tx,indexNames:{contains:index=>store.indexes.has(index)},createIndex:(index,keyPath)=>{store.indexes.set(index,keyPath);},
    get:key=>request(()=>{const value=store.rows.get(key);if(value!==undefined)reads[name]=(reads[name]||0)+1;return structuredClone(value);}),
    put:value=>request(()=>{store.rows.set(value[store.keyPath],structuredClone(value));}),
    add:value=>request(()=>{if(store.rows.has(value[store.keyPath]))throw Error('ConstraintError');store.rows.set(value[store.keyPath],structuredClone(value));}),
    delete:key=>request(()=>{store.rows.delete(key);}),
    openCursor:range=>cursorOver(name,[...store.rows.keys()].filter(key=>inRange(range,key)).sort(compare),key=>key),
    index:index=>({openCursor:(range,direction)=>{const keyPath=store.indexes.get(index);const entries=[...store.rows.values()].filter(row=>keyPath.every(field=>row[field]!==undefined)).map(row=>({key:keyPath.map(field=>row[field]),primary:row[store.keyPath]})).filter(entry=>inRange(range,entry.key)).sort((a,b)=>compare(a.key,b.key));if(direction==='prev')entries.reverse();return cursorOver(name,entries,entry=>entry.primary);}}),
   };
   return handle;
  };
  settle();return tx;
 }
 const open=(name,version)=>{
  const req={result:undefined,transaction:null,onupgradeneeded:null,onsuccess:null,onerror:null,onblocked:null};
  queueMicrotask(()=>{
   let db=databases.get(name);if(!db){db={version:0,stores:new Map()};databases.set(name,db);}
   const connection={objectStoreNames:names(db),createObjectStore:(store,options)=>{db.stores.set(store,{keyPath:options.keyPath,rows:new Map(),indexes:new Map()});return req.transaction.objectStore(store);},transaction:(_stores,mode)=>transaction(db,mode,false),close(){},onversionchange:null};
   req.result=connection;
   if((version??db.version)>db.version||!db.version){db.version=version??1;const tx=transaction(db,'versionchange',true);req.transaction=tx;tx.done=()=>{req.transaction=null;req.onsuccess?.();};req.onupgradeneeded?.();}
   else req.onsuccess?.();
  });
  return req;
 };
 return {indexedDB:{open},IDBKeyRange,reads,databases,rows:(store)=>databases.get('alpha.browser.photos.v1').stores.get(store).rows};
}

// '../browser/edit-receipt' is not stubbed: the receipt removal rules under test are bundled from source.
const stubs={
 './scan-dialog.css':'',
 '../browser/file-archive':'export const fileArchive = () => new Blob([]);',
 '../browser/photo-filter':'export const applyPhotoFilter = () => {};',
 '../browser/video-edit':'export const renderVideoEdit = (...args) => globalThis.ports.render(...args); export const validateVideoEdit = () => {};',
 '../browser/camera-focus':'export class BrowserCameraFocus { clear() {} async select() {} }',
 '../browser/dev-profile':'export const browserDevProfile = false;',
 '../browser/camera-frame':'export const drawCameraFrame = () => ({toDataURL: () => "data:image/jpeg;base64,QUJD"});',
 '../browser/video-capture':'export class BrowserVideoCapture { cancel() {} async start() {} stop() { return globalThis.ports.stop(); } state() { return {isRecording: false, duration: 0, fileSize: 0}; } }',
 '../browser/preference-documents':'export const albumDocument = { read: async initial => initial(), edit: async (initial, change) => change(initial()) };',
};
const bundled=(await build({entryPoints:[resolve('apps/app/src/prototype/browser-camera.ts')],bundle:true,write:false,format:'iife',globalName:'Photos',platform:'browser',plugins:[{name:'ports',setup(builder){
 builder.onResolve({filter:/.*/},args=>{if(args.kind==='entry-point'||args.path==='../browser/edit-receipt')return;if(!(args.path in stubs))throw new Error(`Unreviewed dependency ${args.path}`);return {path:args.path,namespace:'port'};});
 builder.onLoad({filter:/.*/,namespace:'port'},args=>({contents:stubs[args.path],loader:'ts'}));
}}]})).outputFiles[0].text;
const VIDEO='data:video/webm;base64,'+'QUJD'.repeat(64);
function environment(seed){
 const idb=fakeIndexedDB();seed?.(idb);
 const ended=[],track={readyState:'live',stop(){},addEventListener:(name,listener)=>{if(name==='ended')ended.push(listener);},getSettings:()=>({deviceId:'cam'}),getCapabilities:()=>({})};
 const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
 const frame={prepend(){},append(){}};
 const element=tag=>tag==='canvas'?{width:0,height:0,getContext:()=>({filter:'none',translate(){},rotate(){},drawImage(){}}),toDataURL:()=>'data:image/jpeg;base64,RURJVA=='}:{style:{},dataset:{},setAttribute(){},play:async()=>{},pause(){},remove(){},readyState:4,videoWidth:640,videoHeight:480};
 const ports={stop:async()=>({blob:new Blob(['clip'],{type:'video/webm'}),duration:1.5,width:640,height:480,image:'data:image/jpeg;base64,VEhVTUI='}),render:async()=>({path:VIDEO.replace('QUJD','Q09Q'),image:'data:image/jpeg;base64,Q09QWQ==',width:320,height:240,duration:.5})};
 class FileReader{readAsDataURL(){queueMicrotask(()=>{this.result=VIDEO;this.onload();});}}
 class Image{set src(value){this.source=value;}async decode(){}get naturalWidth(){return 640;}get naturalHeight(){return 480;}}
 const context=vm.createContext({indexedDB:idb.indexedDB,IDBKeyRange:idb.IDBKeyRange,ports,FileReader,Image,Blob,File,crypto,Date,DOMException,Error,console,setTimeout,clearTimeout,structuredClone,AbortController,
  window:{addEventListener(){}},document:{hidden:false,addEventListener(){},querySelector:()=>frame,createElement:element,body:{append(){}}},navigator:{mediaDevices:{getUserMedia:async()=>stream}},URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}}});
 vm.runInContext(bundled,context);
 return {...idb,api:context.Photos,library:context.Photos.browserPhotoLibrary,camera:context.Photos.browserCamera,track,ended,ports};
}
const settle=()=>new Promise(done=>setTimeout(done,0));
async function recorded(env){const receipt=await env.camera.stopRecording();return 'v:'+receipt.path.split('/').pop();}

test('pure rules: video rows split from their bytes; only unclaimed receipts expire by age',()=>{
 const {api}=environment();
 const split=api.splitVideoRow({id:'v:1',kind:'video',path:VIDEO,duration:2});
 assert.deepEqual({...split.row},{id:'v:1',kind:'video',duration:2,mimeType:'video/webm',size:192},'the row keeps the recording\'s type and size');assert.equal('path' in split.row,false);assert.deepEqual({...split.data},{id:'v:1',path:VIDEO});
 assert.equal(api.splitVideoRow({id:'1',kind:'image'}).data,undefined);
 const day=24*60*60*1000,now=10*day;
 assert.equal(api.editReceiptAbandoned({status:'prepared',at:now-day-1},now),true);
 assert.equal(api.editReceiptAbandoned({status:'prepared',at:now-day+1},now),false,'an editor that may still be open keeps its receipt');
 assert.equal(api.editReceiptAbandoned({status:'prepared'},now),true,'a receipt from before timestamps has no live editor');
 for(const status of ['saving','saved','failed','cancelled','unchanged'])assert.equal(api.editReceiptAbandoned({status,at:0},now),false,status+' is the only record of an outcome');
 for(const status of ['saved','failed','cancelled','unchanged'])assert.equal(api.editReceiptSettled({status}),true,status);
 for(const status of ['prepared','saving'])assert.equal(api.editReceiptSettled({status}),false,status);
});

test('a recording\'s bytes are stored apart from its row and joined only by read',async()=>{
 const env=environment(),id=await recorded(env);
 assert.equal('path' in env.rows('photos').get(id),false,'the media row holds no recording');
 assert.equal(env.rows('video-data').get(id).path,VIDEO);
 env.reads['video-data']=0;
 const listed=(await env.library.list()).items;
 assert.equal(listed.length,1);assert.equal(listed[0].path,undefined,'list rows carry no video bytes');assert.equal(listed[0].duration,1.5);
 assert.deepEqual({...await env.library.summary()},{favorites:0,videos:1,camera:1,screenshots:0,trash:0,canFavorite:true});
 await env.library.albums();await env.library.list({album:'videos'});
 await env.library.setFavorite({id,revision:listed[0].mutationRevision,favorite:true});
 const files=await env.api.browserPhotoFileEntries();
 assert.equal(files.length,1);assert.equal(files[0].mimeType,'video/webm');assert.equal(files[0].size,192);assert.match(files[0].path,/^Photos\/Videos\//);assert.match(files[0].name,/\.webm$/);
 assert.equal(env.reads['video-data'],0,'listing, counting, albums, favourites and file entries never read a recording');
 const row=await env.library.read({id});
 assert.equal(row.path,VIDEO);assert.equal(row.favorite,true);assert.equal(env.reads['video-data'],1);
 assert.equal(env.rows('video-data').get(id).path,VIDEO,'changing the row leaves its bytes in place');
});

test('recordings stored inside their rows by an earlier version are moved on upgrade',async()=>{
 const legacy={id:'v:0000000000001000000000001',kind:'video',path:VIDEO,duration:3,image:'data:image/jpeg;base64,QQ==',width:4,height:3,date:5,revision:'a',mutationRevision:'b',favorite:false,trashed:false};
 const photo={id:'0000000000002000000000002',kind:'image',image:'data:image/jpeg;base64,QQ==',width:4,height:3,date:6,revision:'a',mutationRevision:'c',favorite:true,trashed:false};
 const receipt={id:'edit:11111111-1111-4111-8111-111111111111',kind:'edit-receipt',operationId:'11111111-1111-4111-8111-111111111111',sourceId:photo.id,sourceRevision:'c',copyId:'9',status:'saved'};
 const env=environment(idb=>{idb.databases.set('alpha.browser.photos.v1',{version:2,stores:new Map([['photos',{keyPath:'id',indexes:new Map([['chronological',['date','id']]]),rows:new Map([legacy,photo,receipt].map(row=>[row.id,row]))}]])});});
 const listed=(await env.library.list()).items;
 assert.deepEqual(Array.from(listed,row=>row.id),[photo.id,legacy.id]);
 assert.equal('path' in env.rows('photos').get(legacy.id),false);assert.equal(env.rows('video-data').get(legacy.id).path,VIDEO);assert.equal(env.rows('video-data').size,1);
 assert.equal(env.rows('photos').get(legacy.id).mimeType,'video/webm');assert.equal(env.rows('photos').get(legacy.id).size,192);
 assert.equal((await env.api.browserPhotoFileEntries()).find(file=>file.path.startsWith('Photos/Videos/')).size,192,'a moved recording is still listed as a video file');
 assert.deepEqual({...env.rows('photos').get(photo.id)},photo,'photos are untouched');assert.deepEqual({...env.rows('photos').get(receipt.id)},receipt,'receipts are untouched');
 assert.equal((await env.library.read({id:legacy.id})).path,VIDEO,'the moved recording still plays');
 assert.equal(env.databases.get('alpha.browser.photos.v1').version,3);
});

test('a saved video copy and permanent deletion keep rows and bytes together',async()=>{
 const env=environment(),id=await recorded(env),source=await env.library.read({id});
 const operationId=crypto.randomUUID(),input={id,revision:source.mutationRevision,operationId,edit:{start:0,end:.5,rotation:0,crop:false}};
 const saved=await env.library.saveVideoCopy(input,new AbortController().signal);
 assert.equal(saved.status,'saved');
 assert.equal('path' in env.rows('photos').get(saved.id),false);assert.match(env.rows('video-data').get(saved.id).path,/^data:video\/webm;base64,Q09Q/);
 assert.deepEqual({...await env.library.saveVideoCopy(input,new AbortController().signal)},{...saved},'the same operation never makes a second copy');
 assert.equal(env.rows('video-data').size,2);
 const copy=await env.library.read({id:saved.id});assert.equal(copy.duration,.5);
 await env.library.setTrashed({id:saved.id,revision:copy.mutationRevision,trashed:true});
 const review=await env.library.prepareDeleteTrash({all:true});assert.equal(review.count,1);
 const result=await env.library.deletePreparedTrash(review);
 assert.deepEqual([...result.deletedIds],[saved.id]);
 assert.equal(env.rows('photos').has(saved.id),false);assert.equal(env.rows('video-data').has(saved.id),false,'the deleted copy\'s bytes are deleted with it');
 assert.equal(env.rows('video-data').get(id).path,VIDEO,'the original is unchanged');
});

test('edit receipts leave when nothing can ask for their outcome again',async()=>{
 const env=environment(),photo=await env.api.importBrowserPhoto({image:'data:image/jpeg;base64,QQ==',width:640,height:480},new AbortController().signal);
 const receipts=()=>[...env.rows('photos').values()].filter(row=>row.kind==='edit-receipt');
 const input={id:photo.id,revision:photo.mutationRevision};
 const closed=await env.library.beginEdit(input);
 assert.equal(receipts().length,1);assert.equal(receipts()[0].status,'prepared');assert.equal(typeof receipts()[0].at,'number');
 await env.library.cancelEdit({sessionId:closed.sessionId});
 assert.equal(receipts().length,0,'closing an editor that never saved leaves no receipt');
 assert.equal((await env.library.editResult({operationId:closed.operationId})).status,'not-started');

 const editor=await env.library.beginEdit(input);
 const saved=await env.library.saveEdit({sessionId:editor.sessionId,rotation:90,crop:false,filter:'none'});
 assert.equal(saved.status,'saved');
 await env.library.cancelEdit({sessionId:editor.sessionId});
 assert.equal((await env.library.editResult({operationId:editor.operationId})).id,saved.id,'an unacknowledged outcome survives closing the editor');
 await env.library.forgetEdit({operationId:editor.operationId});
 assert.equal(receipts().length,0,'an acknowledged outcome is dropped');assert.ok(env.rows('photos').has(saved.id),'the copy itself stays');
 await assert.rejects(env.library.saveEdit({sessionId:editor.sessionId,rotation:90,crop:false,filter:'none'}),/Reopen the photo editor/,'a forgotten operation cannot produce a second copy');

 const open=await env.library.beginEdit(input);
 await env.library.forgetEdit({operationId:open.operationId});
 assert.equal(receipts().length,1,'a receipt that may still commit is kept');

 const now=Date.now(),old=(id,status,at)=>({id:'edit:'+id,kind:'edit-receipt',operationId:id,sourceId:photo.id,sourceRevision:photo.mutationRevision,copyId:'1',status,...(at===undefined?{}:{at})});
 for(const row of [old('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','prepared',now-3*24*60*60*1000),old('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','prepared'),old('cccccccc-cccc-4ccc-8ccc-cccccccccccc','saved',0),old('dddddddd-dddd-4ddd-8ddd-dddddddddddd','saving',0)])env.rows('photos').set(row.id,row);
 await env.library.beginEdit(input);
 assert.deepEqual(receipts().map(row=>row.status).sort(),['prepared','prepared','saved','saving'],'abandoned unclaimed receipts are swept; outcomes and live editors are kept');
 assert.equal(env.rows('photos').has('edit:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),false);assert.equal(env.rows('photos').has('edit:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),false);
});

test('only a live camera is photographed, and the view is told when the track ends',async()=>{
 const env=environment();let lost=0;env.api.onBrowserPreviewEnded(()=>lost++);
 await env.camera.startPreview({direction:'back',resolution:{width:1280,height:720},mirror:false});
 const photo=await env.camera.capturePhoto({saveToGallery:false});assert.equal(photo.format,'jpeg');
 env.track.readyState='ended';for(const listener of env.ended)listener();
 assert.equal(lost,1);
 await assert.rejects(env.camera.capturePhoto({saveToGallery:false}),/Camera is not ready/);
 await assert.rejects(env.camera.capturePhoto(),/Camera is not ready/);await settle();assert.equal((await env.library.list()).items.length,0,'no frozen frame is saved');
 await env.camera.stopPreview();for(const listener of env.ended)listener();assert.equal(lost,1,'a preview that was stopped on purpose reports nothing');
});
