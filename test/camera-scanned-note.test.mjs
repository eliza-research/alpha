import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';
const source=readFileSync(new URL('../apps/app/src/prototype/camera-adapter.ts',import.meta.url),'utf8'),start=source.indexOf("    if(key==='camera')value.saveScannedNote="),end=source.indexOf('\n    return value;',start);assert.ok(start>=0&&end>start);
const canonicalSource=readFileSync(new URL('../apps/app/src/prototype/canonical-notes-ui.ts',import.meta.url),'utf8'),saveStart=canonicalSource.indexOf(' async saveCard('),saveEnd=canonicalSource.indexOf(' async discardDraftAndReload(',saveStart);assert.ok(saveStart>=0&&saveEnd>saveStart);
function fixture({mode='canonical',current=true,target=true,fail=false,hold=false,storageFailed=false,pending=false}={}){
 const f={canonical:[],legacy:[],committed:[],toasts:[],reviews:0};
 const controller={current,async interact(action,payload){f.canonical.push({action,payload});if(hold)await new Promise(resolve=>f.release=resolve);if(fail)throw Error('Unconfirmed');return target?{target:{id:'canonical-note'}}:{};}};
 const box={controller,f};vm.createContext(box);vm.runInContext(stripTypeScriptTypes('globalThis.canonical={'+canonicalSource.slice(saveStart,saveEnd)+'};',{mode:'transform'}),box);
 const canonical=box.canonical;canonical.controller=controller;canonical.hooks={committed:id=>f.committed.push(id)};canonical.needsReview=()=>f.reviews++;Object.defineProperty(canonical,'current',{get:()=>controller.current});
 const legacy=[{id:'existing',title:'Keep me',body:'Original'}],api={toast:text=>f.toasts.push(text)};
 const shell={notesSourceMode:mode,canonicalNotesUi:canonical,notesStore:{},notesStorageFailed:storageFailed,notesPending:pending,api:key=>{assert.equal(key,'notes');return api;},vget:key=>{assert.equal(key,'notes');return {list:legacy};},vset:async(key,patch)=>{assert.equal(key,'notes');f.legacy.push(patch.list);return true;}};
 vm.runInContext(stripTypeScriptTypes('globalThis.make=function(){const key="camera",value={toast:text=>f.toasts.push(text)};'+source.slice(start,end)+';return value;};',{mode:'transform'}),box);
 return {f,shell,controller,save:box.make.call(shell).saveScannedNote};
}
test('Camera sends the exact scanned text to current canonical Notes and its receipt',async()=>{
 const {f,save}=fixture();assert.equal(await save('Receipt\nPaid 12','scan-one'),true);assert.deepEqual(JSON.parse(JSON.stringify(f.canonical)),[{action:'create-note',payload:{content:'Receipt\nPaid 12'}}]);assert.deepEqual(f.committed,['canonical-note']);assert.equal(f.legacy.length,0);
});
for(const reason of ['unavailable','missing-receipt','failed','retired'])test(`canonical ${reason} never falls through to a hidden legacy write`,async()=>{
 const {f,save,controller}=fixture({current:reason!=='unavailable',target:reason!=='missing-receipt',fail:reason==='failed',hold:reason==='retired'});
 const pending=save('Scanned text','scan-one');if(reason==='retired'){controller.current=false;f.release?.();}assert.equal(await pending,false);assert.equal(f.legacy.length,0);assert.equal(f.committed.length,0);
});
test('explicit legacy Notes retains prior notes and stable scan identity',async()=>{
 const {f,save}=fixture({mode:'legacy'});assert.equal(await save('Receipt\nPaid 12','scan-one'),true);assert.equal(f.canonical.length,0);assert.equal(f.legacy[0][0].id,'scan-one');assert.equal(f.legacy[0][0].body,'Receipt\nPaid 12');assert.equal(f.legacy[0][1].id,'existing');assert.equal(await save('Duplicate','existing'),false);assert.equal(f.legacy.length,1);
});
for(const options of [{mode:'legacy',storageFailed:true},{mode:'legacy',pending:true},{mode:'uninitialized',current:false}])test(`unavailable Notes does not write ${JSON.stringify(options)}`,async()=>{
 const {f,save}=fixture(options);assert.equal(await save('Scan','scan-one'),false);assert.equal(f.canonical.length,0);assert.equal(f.legacy.length,0);
});
