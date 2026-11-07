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
 const failure=scanPdfFailure(error);assert.equal(failure.retry,true);assert.match(failure.message,/^Page 2 is larger than 32 million pixels\. Nothing was saved\. Try again\.$/);
 assert.equal(scanPdfFailure('opaque').retry,true);assert.match(scanPdfFailure('opaque').message,/could not be prepared/);
 assert.equal(scanPdfFailure(new DOMException('stop','AbortError')).retry,true);
});
test('only a failed or unknown export call is unconfirmed and locks retry',async()=>{
 let picker=false;globalThis.scanPdfTest={create:async()=>bytes,exportPdf:async input=>{picker=systemPickerActive();assert.equal(atob(input.dataBase64),'%PDF-1.7 test');throw Error('bridge lost');}};
 const error=await exportScanPdf(new Blob(['x']),new AbortController().signal,'Alpha scan').then(()=>null,value=>value);
 assert.ok(error instanceof ScanPdfExportError);assert.equal(picker,true,'review dialogs stay open while the system picker covers the page');assert.equal(systemPickerActive(),false);
 const failure=scanPdfFailure(error);assert.equal(failure.retry,false);assert.match(failure.message,/unconfirmed/);
});
test('resolved provider outcomes decide retry by what they confirm',()=>{
 for(const status of ['cancelled','failed','unavailable','too-large'])assert.equal(scanPdfRetryable(status),true,status);
 for(const status of ['exported','requested','unverified','unknown'])assert.equal(scanPdfRetryable(status),false,status);
});
