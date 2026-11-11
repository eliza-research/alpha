import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {build} from 'esbuild';

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
  sourceRead=async()=>{throw Error('Source read outside fixture');},sourceRetain=async()=>({reference:'fixture-source'})}={}){
 const state={open:null},document={hidden:false,querySelector:()=>null},reviews=[],forgotten=[],retained=[];
 let active=true;
 const api={active:true,isActive:()=>active,get:()=>state,set:patch=>Object.assign(state,patch),setView(){},
  open:(_module,patch)=>Object.assign(state,patch),ic:{},toast(){}};
 const ports={
  review(input){const reviewed={input,closed:false};reviews.push(reviewed);return ()=>{reviewed.closed=true;};},
  capacitor:{isNativePlatform:()=>native,convertFileSrc:value=>value},
  daily:{readSelected:read,pdfSelected:pdf,forgetSelected:async input=>forgotten.push(input.selectionId)},
  index:{record:()=>[],setOpen(){},list:()=>[],open:()=>null,has:()=>true},
  plugin:name=>name==='AlphaMailAttachments'?{readSelected:sourceRead,retainSourceReference:input=>{retained.push(input);return sourceRetain(input);}}:{},
  reviewAttachment:async file=>file,
 };
 const module={exports:{}};
 new Function('require','module','exports','__ports','window','document','navigator',compiled.outputFiles[0].text)(
  createRequire(import.meta.url),module,module.exports,ports,new EventTarget(),document,{});
 const views={files:{render:()=>({})},inbox:{}},Component=class {};
 const accept=module.exports.installSelectedDocumentAdapter(Component,views);
 return {accept:result=>accept('files',result,api),render:()=>views.files.render(state,api),api,state,document,reviews,forgotten,retained,
  active(value){active=value;},close:()=>views.files.back(state,api)};
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
