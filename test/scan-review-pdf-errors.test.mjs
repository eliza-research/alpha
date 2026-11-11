import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from './support/strip-types.mjs';
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const index=url(stripTypeScriptTypes(readFileSync('apps/app/src/prototype/files-index.ts','utf8')));
const source=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/scan-pdf.ts','utf8'))
 .replace("'../../../../.eliza/client-features/plugins/plugin-files/src/documents/scan-pdf.ts'",JSON.stringify(url('export const createScanPdf=(...args)=>globalThis.scanPdfTest.create(...args);')))
 .replace("'../platform-plugins'",JSON.stringify(url('export const registerPlugin=()=>({exportPdf:input=>globalThis.scanPdfTest.exportPdf(input)});')))
 .replace("'./files-index'",JSON.stringify(index));
const {exportScanPdf,scanPdfFailure,scanPdfRetryable,ScanPdfExportError,systemPickerActive}=await import(url(source));
const bytes=new TextEncoder().encode('%PDF-1.7 test');

test('conversion failures show the real reason and keep retry available',async()=>{
 let exported=0;globalThis.scanPdfTest={create:async()=>{throw Error('Page 2 is larger than 32 million pixels');},exportPdf:async()=>{exported++;return {status:'exported',message:'saved'};}};
 const error=await exportScanPdf(new Blob(['x']),new AbortController().signal,'Alpha scan').then(()=>null,value=>value);
 assert.ok(error instanceof Error);assert.ok(!(error instanceof ScanPdfExportError),'conversion is not export uncertainty');assert.equal(exported,0,'nothing reached the provider');
 const failure=scanPdfFailure(error);assert.equal(failure.retry,true);assert.match(failure.message,/^Page 2 is larger than 32 million pixels$/);
 assert.equal(scanPdfFailure('opaque').retry,true);assert.equal(scanPdfFailure('opaque').message,'PDF failed');
 assert.equal(scanPdfFailure(new DOMException('stop','AbortError')).retry,true);
});
test('only a failed or unknown export call is unconfirmed and locks retry',async()=>{
 let picker=false;globalThis.scanPdfTest={create:async()=>bytes,exportPdf:async input=>{picker=systemPickerActive();assert.equal(atob(input.dataBase64),'%PDF-1.7 test');throw Error('bridge lost');}};
 const error=await exportScanPdf(new Blob(['x']),new AbortController().signal,'Alpha scan').then(()=>null,value=>value);
 assert.ok(error instanceof ScanPdfExportError);assert.equal(picker,true,'review dialogs stay open while the system picker covers the page');assert.equal(systemPickerActive(),false);
 const failure=scanPdfFailure(error);assert.equal(failure.retry,false);assert.match(failure.message,/[Uu]nconfirmed/);
});
test('resolved provider outcomes decide retry by what they confirm',()=>{
 for(const status of ['cancelled','failed','unavailable','too-large'])assert.equal(scanPdfRetryable(status),true,status);
 for(const status of ['exported','requested','unverified','unknown'])assert.equal(scanPdfRetryable(status),false,status);
});

// The real searchable review dialog with the real scan-pdf exporter; conversion and the provider are stand-ins.
const reviewStubs={
 '@capacitor/core':'export const Capacitor={isNativePlatform:()=>globalThis.reviewTest.native};',
 '../browser/scan-draft':'export const copyScanTextLayers=value=>value&&value.map(page=>page&&page.map(line=>({...line})));',
 './local-ocr':'export const recognizeLocalText=async()=>{throw Error("saved lines are reviewed without recognition");};',
 '../../../../.eliza/client-features/plugins/plugin-files/src/documents/scan-pdf.ts':'export const createScanPdf=(...args)=>globalThis.reviewTest.create(...args);',
 '../platform-plugins':'export const registerPlugin=()=>({exportPdf:input=>globalThis.reviewTest.exportPdf(input)});',
 '../runtime/browser-note-documents':'export class BrowserNoteDocuments{}','./files-index':'export const filesIndex={record(){}};',
};
const {build}=await import('esbuild');const {JSDOM}=await import('jsdom');
const reviewBundle=(await build({entryPoints:['apps/app/src/prototype/scan-searchable-review.ts'],bundle:true,platform:'neutral',format:'esm',write:false,plugins:[{name:'stubs',setup(b){
 b.onResolve({filter:/.*/},args=>args.path in reviewStubs||args.path.endsWith('.css')?{path:args.path,namespace:'stub'}:undefined);
 b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:reviewStubs[args.path]??'',loader:'js'}));
}}]})).outputFiles[0].text;
const {reviewSearchableScan}=await import(url(reviewBundle));
const settle=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
async function review({native=false,create=async()=>bytes,exportPdf}){
 const {window}=new JSDOM('<div class="os"></div>');window.HTMLDialogElement.prototype.showModal??=function(){this.open=true;};
 Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement});
 const calls=[];globalThis.reviewTest={native,create,exportPdf:input=>{calls.push(input.title);return exportPdf(input);}};
 let outcome='pending';const result=reviewSearchableScan([new Blob(['page'],{type:'image/png'})],new AbortController().signal,[[{text:'Reviewed line',x:0,y:0,width:1,height:.1}]]).then(value=>outcome=value);
 await settle();const dialog=window.document.querySelector('dialog[aria-label="Review searchable PDF"]');
 const download=dialog.querySelector('.scan-dialog-actions button');
 return {window,dialog,download,calls,result,outcome:()=>outcome,field:()=>dialog.querySelector('textarea'),status:()=>dialog.querySelector('[role=status]').textContent,back:()=>window.dispatchEvent(new window.Event('alpha-back',{cancelable:true}))};
}
test('a searchable export that wrote nothing keeps the review open with the reviewed text',async()=>{
 for(const status of ['failed','unavailable','too-large']){
  const r=await review({exportPdf:async()=>({status,message:`Nothing written (${status}).`})});
  r.field().value='Edited line';r.field().dispatchEvent(new r.window.Event('input'));r.download.click();await settle();
  assert.equal(r.outcome(),'pending',status);assert.ok(r.dialog.isConnected,status);assert.equal(r.status(),`Nothing written (${status}).`);
  assert.equal(r.download.disabled,false,'retry stays available');assert.equal(r.field().disabled,false);assert.equal(r.field().value,'Edited line');
  r.back();assert.equal(await r.result,undefined,'closing after it reports a cancel, not an unconfirmed export');
 }
});
test('Back while the PDF is still being prepared is a cancel; after the request it is unconfirmed',async()=>{
 let release;const early=await review({create:()=>new Promise(resolve=>release=resolve),exportPdf:async()=>({status:'exported',message:'saved'})});
 early.download.click();await settle();early.back();release(bytes);await settle();
 assert.equal(await early.result,undefined);assert.deepEqual(early.calls,[],'no export request was made');
 for(const [native,where] of [[false,/^Export unconfirmed$/],[true,/^Export unconfirmed$/]]){
  const late=await review({native,exportPdf:()=>new Promise(()=>{})});
  late.download.click();await settle();assert.equal(late.calls.length,1);late.back();
  const value=await late.result;assert.equal(value.status,'unconfirmed');assert.match(value.message,where);
 }
});
