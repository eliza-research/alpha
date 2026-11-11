import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {JSDOM} from 'jsdom';import {build} from 'esbuild';
// The real scan document dialog and shared document state; the draft store, picker and PDF provider are in-memory stand-ins.
const root=path.resolve(import.meta.dirname,'..');
const stubs={
 '@capacitor/core':'export const Capacitor={isNativePlatform:()=>globalThis.scanTest.native,convertFileSrc:value=>value};',
 '../browser/scan-draft':'export const readScanDraft=(...a)=>globalThis.scanTest.drafts.read(...a),saveScanDraft=(...a)=>globalThis.scanTest.drafts.save(...a),deleteScanDraft=(...a)=>globalThis.scanTest.drafts.remove(...a),copyScanTextLayers=value=>value;',
 '../../../../.eliza/client-features/plugins/plugin-files/src/documents/scan-pdf.ts':'export const createScanPdf=async(...a)=>globalThis.scanTest.create?await globalThis.scanTest.create(...a):new Uint8Array();',
 '../runtime/browser-note-documents':'export class BrowserNoteDocuments{}',
 '../platform-plugins':'export const registerPlugin=()=>({exportPdf:async()=>{throw Error("not used");}});',
 '../daily':'export const DailyApps={};','./local-ocr':'export const recognizeLocalText=async()=>({lines:[]});','./scan-page-camera':'export const captureScanPage=async()=>undefined;',
 './scan-correction-review':'export const reviewScanCorrection=async()=>undefined;','../browser/file-picker':'export const inputFiles=async()=>[],runFilePicker=async()=>[];','./files-index':'export const filesIndex={record(){return [];},open(){return null;}};',
};
const bundle=(await build({entryPoints:[path.join(root,'apps/app/src/prototype/scan-document.ts')],bundle:true,platform:'neutral',format:'esm',write:false,plugins:[{name:'stubs',setup(b){
 b.onResolve({filter:/.*/},args=>args.path in stubs||args.path.endsWith('.css')?{path:args.path,namespace:'stub'}:undefined);
 b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path]??'',loader:'js'}));
}}]})).outputFiles[0].text;
const settle=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
function drafts(){let draft,n=0;return {
 get:()=>draft,read:async()=>draft&&{...draft},
 save:async(pages,expected)=>{if(draft?.revision!==expected)throw Error('A saved draft already exists or changed. Load the saved draft before replacing it.');draft={revision:'r'+ ++n,pages:[...pages]};return {revision:draft.revision};},
 remove:async revision=>{if(draft?.revision!==revision)throw Error('The saved draft changed.');draft=undefined;},
};}
let opened=0;
async function open({native,stored,create}){
 const dom=new JSDOM('<div class="os"></div>');const {window}=dom;
 window.HTMLDialogElement.prototype.showModal??=function(){this.open=true;};window.confirm=()=>true;
 Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement});
 const store=drafts();if(stored)await store.save([new Blob(['old'],{type:'image/png'})],undefined);
 globalThis.scanTest={native,drafts:store,create};
 const {openScanDocument}=await import('data:text/javascript;base64,'+Buffer.from(bundle+'//'+ ++opened).toString('base64'));
 openScanDocument(new Blob(['page'],{type:'image/jpeg'}));await settle();
 const dialog=()=>window.document.querySelector('dialog[aria-label="Review scan document"]');
 const button=name=>[...window.document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')??b.textContent)===name);
 return {window,store,dialog,button,group:name=>window.document.querySelector(`[role=group][aria-label="${name}"]`),status:()=>window.document.querySelector('[role=status]').textContent};
}

test('a draft stored before the scan opened offers Resume and Delete, and Delete unblocks autosave',async()=>{
 const s=await open({native:true,stored:true});
 assert.equal(s.group('Saved draft').hidden,false);assert.match(s.group('Saved draft').textContent,/A saved draft exists\./);
 assert.match(s.status(),/already exists/,'the first page could not replace the stored draft');assert.equal(s.store.get().revision,'r1');
 s.button('Delete the saved draft').click();await settle();
 assert.equal(s.store.get(),undefined);assert.equal(s.group('Saved draft').hidden,true);assert.equal(s.status(),'Saved draft deleted.');
 s.button('Save document draft').click();await settle();assert.equal(s.store.get().revision,'r2','Save draft is no longer blocked');assert.match(s.status(),/Resume it from Draft options\./);
});
test('Resume loads the stored draft and the notice goes away',async()=>{
 const s=await open({native:true,stored:true});
 s.button('Resume the saved draft').click();await settle();
 assert.equal(s.status(),'Saved document draft loaded.');assert.equal(s.group('Saved draft').hidden,true);
});
test('Close on native with autosaved pages asks before the draft is discarded',async()=>{
 const s=await open({native:true});
 assert.equal(s.store.get().revision,'r1','the first page was autosaved');assert.equal(s.group('Saved draft').hidden,true,'its own draft is not offered as a stored one');
 s.button('Close document').click();await settle();
 assert.ok(s.dialog(),'the document stays open while asking');assert.equal(s.group('Close document').hidden,false);assert.match(s.group('Close document').textContent,/Keep these pages as a draft\?/);
 s.window.dispatchEvent(new s.window.Event('alpha-back',{cancelable:true}));await settle();
 assert.equal(s.group('Close document').hidden,true,'Back dismisses the question');assert.ok(s.dialog());
 s.window.dispatchEvent(new s.window.Event('alpha-back',{cancelable:true}));await settle();assert.equal(s.group('Close document').hidden,false,'Back asks too');
 s.button('Discard draft').click();await settle();
 assert.equal(s.dialog(),null);assert.equal(s.store.get(),undefined);
});
test('Keep closes and leaves the draft; pagehide closes without asking and keeps it',async()=>{
 const kept=await open({native:true});kept.button('Close document').click();await settle();kept.button('Keep draft').click();await settle();
 assert.equal(kept.dialog(),null);assert.equal(kept.store.get().revision,'r1');
 const hidden=await open({native:true});hidden.window.dispatchEvent(new hidden.window.Event('pagehide'));await settle();
 assert.equal(hidden.dialog(),null);assert.equal(hidden.store.get().revision,'r1');
});
test('on the web Close does not ask (no automatic draft)',async()=>{
 const s=await open({native:false});assert.equal(s.store.get(),undefined);
 s.button('Close document').click();await settle();assert.equal(s.dialog(),null);
});
test('Discard works while a PDF is still being prepared',async()=>{
 const s=await open({native:true,create:()=>new Promise(()=>{})});
 s.button('Save document PDF').click();await settle();assert.equal(s.button('Save document PDF').disabled,true,'the export holds the document');
 s.button('Close document').click();await settle();s.button('Discard draft').click();await settle();
 assert.equal(s.dialog(),null);assert.equal(s.store.get(),undefined);
});
