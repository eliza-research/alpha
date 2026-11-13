import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {build} from 'esbuild';
import {createFilesIndex} from '../apps/app/src/prototype/files-index.ts';

const imports=new Map([
 ['./file-email-review','export const reviewFileEmail=()=>{throw Error("Email outside fixture")};'],
 ['../platform-plugins','export const registerPlugin=__ports.plugin;'],
 ['../runtime/inbox-attachment','export const reviewMailAttachment=__ports.reviewAttachment;'],
 ['../browser/content-question','export const reviewContentQuestion=__ports.review; export class SourceUnavailableError extends Error {}'],
 ['../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts','export const sensitiveReadingText=()=>false;'],
 ['../../../../.eliza/client-features/plugins/plugin-files/src/browser/files-browser-adapter.ts','export const installFilesBrowserAdapter=()=>({});'],
 ['@capacitor/core','export const Capacitor=__ports.capacitor;'],
 ['../daily','export const DailyApps=__ports.daily;'],
 ['./files-index','export const filesIndex=__ports.index;'],
 ['../runtime/inline-modal','export const createInlineModal=()=>{throw Error("Modal outside fixture")};'],
]);
const compiled=await build({
 entryPoints:['apps/app/src/prototype/selection-adapter.ts'],bundle:true,platform:'node',format:'cjs',write:false,
 plugins:[{name:'selected-document-ports',setup(builder){
  builder.onResolve({filter:/.*/},args=>imports.has(args.path)?{path:args.path,namespace:'ports'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'ports'},args=>({contents:imports.get(args.path),loader:'js'}));
 }}],
});
function fixture({read=async()=>({status:'read',text:'Readable excerpt'}),pdf=async()=>({status:'rendered',page:0,pageCount:1,imageUri:'blob:pdf-page'}),native=false,
  sourceRead=async()=>{throw Error('Source read outside fixture');},sourceRetain=async()=>({reference:'fixture-source'}),
  index={record:()=>[],setOpen(){},list:()=>[],open:()=>null,has:()=>true},
  describe=async()=>({status:'unavailable'}),rename=async()=>({status:'unavailable'})}={}){
 const state={open:null},document={hidden:false,querySelector:()=>null},reviews=[],forgotten=[],retained=[];
 let active=true;
 const api={active:true,isActive:()=>active,get:()=>state,set:patch=>Object.assign(state,patch),setView(){},
  open:(_module,patch)=>Object.assign(state,patch),ic:{},toast(){}};
 const ports={
  review(input){const reviewed={input,closed:false};reviews.push(reviewed);return ()=>{reviewed.closed=true;};},
  capacitor:{isNativePlatform:()=>native,convertFileSrc:value=>value},
  daily:{readSelected:read,pdfSelected:pdf,describeSelected:describe,renameSelected:rename,forgetSelected:async input=>forgotten.push(input.selectionId)},
  index,
  plugin:name=>name==='AlphaMailAttachments'?{readSelected:sourceRead,retainSourceReference:input=>{retained.push(input);return sourceRetain(input);}}:{},
  reviewAttachment:async file=>file,
 };
 const module={exports:{}};
 new Function('require','module','exports','__ports','window','document','navigator',compiled.outputFiles[0].text)(
  createRequire(import.meta.url),module,module.exports,ports,new EventTarget(),document,{});
 const views={files:{render:()=>({})},inbox:{}},Component=class {};
 const accept=module.exports.installSelectedDocumentAdapter(Component,views);
 return {accept:(result,recent)=>accept('files',result,api,recent),render:()=>views.files.render(state,api),api,state,document,reviews,forgotten,retained,
  active(value){active=value;},leave:()=>views.files.onLeave?.(api),close:()=>views.files.back(state,api)};
}
const selected=(id='one',mimeType='text/plain')=>({status:'selected',selectionId:id,name:id+'.file',mimeType,uri:'blob:'+id});

test('Ask waits for nonblank selected text and stale loading callbacks cannot open review',async()=>{
 const pending=Promise.withResolvers(),f=fixture({read:()=>pending.promise});
 const accepting=f.accept(selected()),loading=f.render().pv;
 assert.equal(loading.canAsk,false);
 loading.ask();assert.equal(f.reviews.length,0);
 pending.resolve({status:'read',text:'Current excerpt'});await accepting;
 const ready=f.render().pv;
 assert.equal(ready.canAsk,true);
 loading.ask();assert.equal(f.reviews.length,0);
 ready.ask();assert.equal(f.reviews.length,1);assert.equal(f.reviews[0].input.text,'Current excerpt');
 for(const response of [{status:'read',text:' \n '},{status:'binary'},{status:'failed'}]){
  const empty=fixture({read:async()=>response});await empty.accept(selected());
  assert.equal(empty.render().pv.canAsk,false);empty.render().pv.ask();assert.equal(empty.reviews.length,0);
 }
});

test('real selected image and rendered PDF paths keep image review while a PDF is pending',async()=>{
 for(const native of [false,true]){
  const image=fixture({native,read:async()=>({status:'binary'})}),input=selected('image','image/png');
  input.uri=native?'content://fixture/image':'blob:image';
  await image.accept(input);const preview=image.render().pv;
  assert.equal(preview.canAsk,true);preview.ask();
  assert.equal(image.reviews.length,1);assert.equal(typeof image.reviews[0].input.image,'function');
  const pending=Promise.withResolvers(),pdf=fixture({native,pdf:()=>pending.promise}),accepting=pdf.accept(selected('pdf','application/pdf'));
  assert.equal(pdf.render().pv.canAsk,false);pdf.render().pv.ask();assert.equal(pdf.reviews.length,0);
  pending.resolve({status:'rendered',page:0,pageCount:1,imageUri:native?'file://fixture/page.jpg':'blob:pdf-page'});
  await accepting;assert.equal(pdf.render().pv.canAsk,true);pdf.render().pv.ask();
  assert.equal(typeof pdf.reviews[0].input.image,'function');
 }
});

test('Ask and its admitted review retire with the selected identity, view or page visibility',async()=>{
 for(const change of ['selection','view','hidden','closed']){
  const f=fixture();await f.accept(selected());const preview=f.render().pv;
  preview.ask();assert.equal(f.reviews.length,1);const review=f.reviews[0];
  assert.equal(review.input.current(),true);
  if(change==='selection')await f.accept(selected('two'));
  if(change==='view')f.active(false);
  if(change==='hidden')f.document.hidden=true;
  if(change==='closed')f.close();
  assert.equal(review.input.current(),false,change);
  preview.ask();assert.equal(f.reviews.length,1,change);
 }
});

test('leaving a pending selected read preserves the retired selection fence',async()=>{
 const pending=Promise.withResolvers(),f=fixture({read:()=>pending.promise});
 const accepting=f.accept(selected());f.close();
 pending.resolve({status:'read',text:'Late excerpt'});await accepting;
 assert.equal(f.render().pv,undefined);assert.equal(f.reviews.length,0);
});

test('source verification rechecks the current view after file read and source retention',async()=>{
 const file={name:'one.file',mimeType:'text/plain',sha256:'a'.repeat(64),size:16,text:'Readable excerpt',sourceReferenceVersion:1};
 for(const boundary of ['read','retain']){
  const pending=Promise.withResolvers();
  const f=fixture({sourceRead:async()=>boundary==='read'?pending.promise:file,
   sourceRetain:()=>pending.promise});
  await f.accept(selected());f.render().pv.ask();
  const result=f.reviews[0].input.source();
  if(boundary==='retain'){
   for(let turn=0;turn<4;turn++)await Promise.resolve();
   assert.equal(f.retained.length,1);
  }
  f.active(false);pending.resolve(boundary==='read'?file:{reference:'late-source'});
  await assert.rejects(result,/Source changed|Selection changed/);
  assert.equal(f.retained.length,boundary==='read'?0:1);
 }
});

function rendererStorage(){
 const rows=new Map();
 const store={getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)};
 return ()=>createFilesIndex(store);
}
const nativeFile=id=>({...selected(id),uri:'content://fixture/'+id,action:'files'});
const settleRenderer=()=>new Promise(resolve=>setImmediate(resolve));

test('Files browsing previews do not become picker previews after the renderer is recreated',async()=>{
 const index=rendererStorage(),value=nativeFile('storage-preview'),first=fixture({native:true,index:index()});
 await first.accept(value,false);
 assert.equal(first.render().pv.nativeSelectionId,value.selectionId);
 const describeCalls=[];
 const describe=async input=>{describeCalls.push(input.selectionId);return value;};
 const recreated=fixture({native:true,index:index(),describe});
 recreated.render();
 await settleRenderer();
 assert.equal(recreated.render().pv,undefined);
 assert.equal(index().open(),null);
 assert.deepEqual(describeCalls,[]);
 // Earlier versions stored a raw open ID even when no picker row existed.
 index().setOpen(value.selectionId);
 const legacy=fixture({native:true,index:index(),describe});
 legacy.render();
 await settleRenderer();
 assert.equal(legacy.render().pv,undefined);
 assert.equal(index().open(),null);
 assert.deepEqual(describeCalls,[]);
 assert.deepEqual(legacy.forgotten,[]);
});

test('an exact remembered picker grant survives rename and restores only while Files owns the request',async()=>{
 const index=rendererStorage(),first=fixture({native:true,index:index(),rename:async()=>nativeFile('picker-renamed')});
 await first.accept(nativeFile('picker-original'));
 first.api.set({rn:'picker-renamed.file'});
 await first.render().pv.saveRn();
 assert.equal(index().open(),'picker-renamed');
 assert.deepEqual(index().list().map(row=>row.selectionId),['picker-renamed']);
 const wrong=fixture({native:true,index:index(),describe:async()=>nativeFile('different-picker')});
 wrong.render();await settleRenderer();
 assert.equal(wrong.render().pv,undefined);
 const held=Promise.withResolvers(),left=fixture({native:true,index:index(),describe:()=>held.promise});
 left.render();left.active(false);left.leave();left.active(true);held.resolve(nativeFile('picker-renamed'));await settleRenderer();
 assert.equal(left.render().pv,undefined);
 const moving=Promise.withResolvers(),folder=fixture({native:true,index:index(),describe:()=>moving.promise});
 folder.render();folder.api.set({folder:'folder'});folder.render();folder.api.set({folder:null});
 moving.resolve(nativeFile('picker-renamed'));await settleRenderer();
 assert.equal(folder.render().pv,undefined);
 for(let recreation=0;recreation<2;recreation++){
  const restored=fixture({native:true,index:index(),describe:async({selectionId})=>nativeFile(selectionId)});
  restored.render();await settleRenderer();
  assert.equal(restored.render().pv.nativeSelectionId,'picker-renamed');
  assert.equal(restored.render().pv.canForget,true);
  assert.equal(index().open(),'picker-renamed');
 }
});
