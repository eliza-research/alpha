import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const driver=fileURLToPath(import.meta.url),call=(name,...args)=>({name,args});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const textPath='apps/app/src/prototype/scan-review.ts',searchPath='apps/app/src/prototype/scan-searchable-review.ts';
const sourcesBase=[driver,textPath,searchPath,'apps/app/src/prototype/scan-pdf.ts','upstream.lock.json','.eliza/client-features/.source.json','scripts/prepare-client-features.ts'];

async function compile(mutant){
 const stubs={
  '@capacitor/core':'export const Capacitor={isNativePlatform:()=>true};',
  './local-ocr':'export const recognizeLocalText=(...args)=>globalThis.scanReviewPorts.ocr.promise;',
  './scan-document':'export const openScanDocument=()=>{throw Error("Document subreview is outside the selected source projection");};',
  './scan-event-review':'export const createScanEventReview=()=>{throw Error("Calendar subreview is outside the selected source projection");};',
  './scan-link-review':'export const createScanLinkReview=()=>({element:document.createElement("div"),update(){}});',
  '../../../../.eliza/client-features/plugins/plugin-files/src/documents/scan-pdf.ts':'export const createScanPdf=()=>globalThis.scanReviewPorts.conversion();',
  '../platform-plugins':'export const registerPlugin=()=>({exportPdf:input=>globalThis.scanReviewPorts.exportPdf(input)});',
  '../runtime/browser-note-documents':'export class BrowserNoteDocuments{}',
  '../daily':'export const DailyApps={forgetSelected:async()=>{throw Error("No selected grant may be released in this bounded scan review");}};',
 };
 const result=await build({absWorkingDir:root,stdin:{contents:`export {openScanReview,ScanKeepError} from './${textPath}'; export {reviewSearchableScan} from './${searchPath}';`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',metafile:true,loader:{'.css':'empty'},plugins:[{name:'closed-review-ports',setup(b){
  b.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'review-port'}:undefined);
  b.onLoad({filter:/.*/,namespace:'review-port'},args=>({contents:stubs[args.path],loader:'js'}));
  b.onLoad({filter:/\/scan-(review|searchable-review)\.ts$/},args=>{
   let text=readFileSync(args.path,'utf8');
   if(args.path.endsWith('/scan-review.ts')){
    const needle='  return dispose;';assert.ok(text.includes(needle));text=text.replace(needle,'  globalThis.scanReviewInspect=()=>({closed,attempted,pdfAttempted});\n'+needle);
    if(mutant==='notes-unlatch'){const guard='if(attempted||!field.value.trim())return;';assert.ok(text.includes(guard));text=text.replace(guard,'if(!field.value.trim())return;');}
   }else{const needle='  void(async()=>{for';assert.ok(text.includes(needle));text=text.replace(needle,'  globalThis.scanSearchInspect=()=>({closed,ready,busy,requested});\n'+needle);}
   return {contents:text,loader:'ts'};
  });
 }}]});
 return {code:result.outputFiles[0].text,inputs:Object.keys(result.metafile.inputs).filter(path=>existsSync(join(root,path)))};
}

function environment(module){
 const {window}=new JSDOM('<main class="os"></main>');window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const names=['window','document','HTMLElement','scanReviewPorts','scanReviewInspect','scanSearchInspect'];
 const previous=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const ports={ocr:deferred(),conversions:[],exports:[],notes:[],keeps:[],
  conversion(){const row=deferred();ports.conversions.push(row);return row.promise;},
  exportPdf(input){const row={...deferred(),input};ports.exports.push(row);return row.promise;}};
 Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,scanReviewPorts:ports});
 const image=new Blob(['synthetic scan page'],{type:'image/png'}),bytes=new TextEncoder().encode('%PDF-1.7 bounded port');
 let closeText,result='pending';
 const button=label=>[...window.document.querySelectorAll('button')].find(button=>(button.getAttribute('aria-label')||button.textContent)===label);
 return {ports,bytes,window,button,
  startText(){closeText=module.openScanReview(image,(text,id)=>{const row={...deferred(),text,id};ports.notes.push(row);return row.promise;},undefined,'unsaved',()=>{const row=deferred();ports.keeps.push(row);return row.promise;});},
  async recognised(){ports.ocr.resolve({text:'Reviewed text',lines:[{text:'Reviewed text',x:0,y:0,width:1,height:.1}]});await tick();},
  async startSearch(){void module.reviewSearchableScan([image],new AbortController().signal,[[{text:'Reviewed line',x:0,y:0,width:1,height:.1}]]).then(value=>{result=value??null;});await tick();},
  text(){const v=globalThis.scanReviewInspect(),status=window.document.querySelector('[aria-label="Scan status"]')?.textContent??'';
   return {'s.text.closed':v.closed,'s.text.attempted':v.attempted,'s.text.saveCalls':ports.notes.length,'s.text.saved':!ports.notes.length?'none':status==='Saving to Notes…'?'pending':status==='Saved to Notes.'?'saved':'unconfirmed','s.text.pdfAttempted':v.pdfAttempted,'s.text.pdfCalls':ports.conversions.length,'s.text.keepCalls':ports.keeps.length};},
  search(){const v=globalThis.scanSearchInspect();return {'s.searchable.ready':v.ready,'s.searchable.busy':v.busy,'s.searchable.requested':v.requested,'s.searchable.closed':v.closed,'s.searchable.result':result==='pending'||result===null?'none':result.status};},
  back(){window.dispatchEvent(new window.Event('alpha-back',{cancelable:true}));},
  close(){closeText?.();window.close();for(const name of names){if(previous[name])Object.defineProperty(globalThis,name,previous[name]);else delete globalThis[name];}},
 };
}

async function checkScanReviewDialogs(extraSources=[],options={}){
 const sources=[...sourcesBase,...extraSources];let hashes=captureInputs(sources);const compiled=await compile(options.mutant);
 sources.push(...compiled.inputs);const next=captureInputs(sources);for(const [path,hash]of Object.entries(hashes))assert.equal(next[path],hash,'Scan review source changed while bundling');hashes=next;
 const bound=await compile(options.mutant);assert.deepEqual(bound.inputs.sort(),compiled.inputs.sort(),'Scan review dependency graph changed after capture');assert.equal(bound.code,compiled.code,'Scan review bytes changed after capture');
 const after=captureInputs(sources);for(const [path,hash]of Object.entries(hashes))assert.equal(after[path],hash,'Scan review dependency changed before execution: '+path);
 const directory=mkdtempSync(join(tmpdir(),'alpha-scan-review-source-')),input=join(directory,'scan-reviews.mjs');writeFileSync(input,compiled.code);sources.push(input);Object.assign(hashes,captureInputs([input]));
 const traces=[];
 try{const module=await import(input);
  for(const mode of ['notes-unconfirmed','keep-retry','photo-pdf-retry','search-close-prepare','search-close-request','search-retry']){
   const f=environment(module);const text=!mode.startsWith('search');
   try{
    if(text)f.startText();else await f.startSearch();
    const t={name:'actual scan review '+mode,expect:text?f.text():{'s.searchable.closed':false},steps:[]};
    const point=(label,action)=>t.steps.push({label,action,expect:text?f.text():f.search()});
    if(text){await f.recognised();point('actual OCR settlement unlocks reviewed text',call('ocrSettled',true));
     if(mode==='notes-unconfirmed'){
      const save=f.button('Save to Notes');save.click();point('actual one-shot Notes save',call('saveToNotes'));f.ports.notes[0].resolve(false);await tick();point('actual unconfirmed Notes save remains latched',call('notesSettled',false));
      // Direct event delivery also exercises the handler guard independently of disabled DOM controls.
      save.onclick();assert.equal(f.ports.notes.length,1,'An unconfirmed Notes save must remain one-shot');
     }else if(mode==='keep-retry'){
      f.button('Keep photo').click();point('actual Keep request',call('keepPhoto'));f.ports.keeps[0].reject(new module.ScanKeepError('Nothing kept',true));await tick();point('retryable host refusal unlocks Keep',call('keepSettled','retryable'));
      f.button('Try keeping again').click();point('explicit safe Keep retry',call('keepPhoto'));f.ports.keeps[1].reject(new module.ScanKeepError('Unconfirmed',false));await tick();point('unconfirmed host reply stays latched',call('keepSettled','unconfirmed'));assert.equal(f.button('Try keeping again').disabled,true);
     }else{
      f.button('Save photo PDF').click();point('actual PDF preparation',call('exportPhotoPdf'));f.ports.conversions[0].resolve(f.bytes);await tick();f.ports.exports[0].resolve({status:'cancelled',message:'Cancelled'});await tick();point('confirmed non-write permits retry',call('photoPdfSettled',true));
      f.button('Save photo PDF').click();point('explicit PDF retry',call('exportPhotoPdf'));f.ports.conversions[1].resolve(f.bytes);await tick();f.ports.exports[1].resolve({status:'unverified',message:'Unconfirmed'});await tick();point('unconfirmed export locks retry',call('photoPdfSettled',false));assert.equal(f.button('Save photo PDF').disabled,true);
     }
    }else{
     point('saved lines become editable in the real review',call('recognised'));f.button('Save reviewed searchable PDF').click();point('real export begins before provider request',call('download'));
     if(mode==='search-close-prepare'){f.back();await tick();point('close before conversion has no provider uncertainty',call('searchableClose'));f.ports.conversions[0].resolve(f.bytes);await tick();assert.equal(f.ports.exports.length,0);}
     else{
      f.ports.conversions[0].resolve(f.bytes);await tick();point('real exporter crosses the provider boundary',call('providerAsked'));assert.equal(f.ports.exports.length,1);
      if(mode==='search-close-request'){f.back();await tick();point('close after provider request is unconfirmed',call('searchableClose'));f.ports.exports[0].resolve({status:'exported',message:'Late'});await tick();assert.equal(f.search()['s.searchable.result'],'unconfirmed');}
      else{f.ports.exports[0].resolve({status:'cancelled',message:'Cancelled'});await tick();point('provider non-write retains editable review',call('providerSettled','cancelled'));
       f.button('Save reviewed searchable PDF').click();point('explicit searchable retry',call('download'));f.ports.conversions[1].resolve(f.bytes);await tick();point('second provider request',call('providerAsked'));f.ports.exports[1].resolve({status:'exported',message:'Exported'});await tick();point('confirmed searchable export ends review',call('providerSettled','exported'));}
     }
    }
    traces.push(t);
   }finally{f.close();}
  }
  return await checkTraces({model:'ScanReviewDialogs',sources,driverHashes:hashes,generatedSources:[input],traces,scope:'bounded-component',assumptions:[
   'Complete actual text/searchable review functions and the real exportScanPdf, retry policy, scan text copy and Recent index execute in JSDOM. Read-only source seams expose closure state; independent controlled-port arrays count Notes, Keep, conversion and provider calls.',
   'Six schedules cover unconfirmed one-shot Notes save, safe Keep retry, photo PDF retry classification, searchable close before/after provider dispatch and explicit searchable retry. Model fields for actual dialog/attempt/call counters and searchable ready/busy/request/result are observed; omitted model fields are not inferred from model state.',
   'OCR, PDF byte conversion, Notes commit, Keep photo and native export are synthetic asynchronous ports. JSDOM does not qualify native picker focus or image/PDF rendering. Link, Calendar and multi-page subreviews, correction/camera machines, full document navigation and arbitrary interleavings remain separate obligations.',
  ]});
 }finally{rmSync(directory,{recursive:true,force:true});}
}

test('actual scan reviews refine bounded save, retry and uncertain-close schedules',async()=>{const r=await checkScanReviewDialogs();assert.equal(r.passed,true);assert.equal(r.driverInputsBound,true);assert.ok(r.traces>=6&&r.checkpoints>=30);});
test('scan source canary cannot repeat an unconfirmed Notes save',async()=>{await assert.rejects(checkScanReviewDialogs([],{mutant:'notes-unlatch'}),/An unconfirmed Notes save must remain one-shot/);});
