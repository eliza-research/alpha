import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{stripTypeScriptTypes}from'node:module';import vm from'node:vm';
const source=readFileSync('apps/app/src/prototype/model.js','utf8'),start=source.indexOf('/* ===== module: notes ===== */'),end=source.indexOf('/* ===== module:',start+20);assert.ok(start>=0&&end>start);
/** The list helpers model.js imports (runtime/notes-view.ts over notes-folders-model.ts), as plain script. */
const helpers=['apps/app/src/runtime/notes-folders-model.ts','apps/app/src/runtime/notes-view.ts'].map(file=>stripTypeScriptTypes(readFileSync(file,'utf8'),{mode:'transform'}).replace(/^import .*;\n/gm,'').replace(/^export \* .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
function fixture(list=[]){
 let view;const context=vm.createContext({IC:{},NOTES_SEED:list,NOTES_LIVE:[],NOTES_DICT:[],copy:()=>({}),cap:text=>text,pad2:value=>String(value).padStart(2,'0'),registerView:(id,value)=>{assert.equal(id,'notes');view=value;},setTimeout(){throw Error('No recorder starts during an empty render');},setInterval(){throw Error('No recorder starts during an empty render');},clearInterval(){},Date});
 vm.runInContext(helpers,context);vm.runInContext(source.slice(start,end),context);
 const state={list,open:null,q:null},before=structuredClone(state),choose=()=>{},api={name:'Alpha',now:new Date(),get:()=>state,set(){throw Error('Display must not change stored Notes');},person:()=>null,toast(){},notesSourceOptions:[{id:'canonical',choose},{id:'legacy',choose}]};
 return {view,state,before,api,choose};
}
test('the intrinsic Notes renderer supplies its labelled fixture surface without product adapters',()=>{
 const f=fixture(),out=f.view.render(f.state,f.api);assert.equal(out.notesTitle,'Notes');assert.equal(out.primaryNotes,true);assert.equal(out.canRecord,true);assert.equal(out.canCreate,true);assert.deepEqual(f.state,f.before);
});
test('a voice row without a duration shows no clock and never NaN',()=>{
 const f=fixture([{id:'v',kind:'voice',title:'Sync',lines:[],summary:[],actions:[{t:'One',done:false}],pinned:false}]),out=f.view.render(f.state,f.api);
 assert.equal(out.otherRows.length,1);assert.equal(out.otherRows[0].isVoice,true);assert.doesNotMatch(out.otherRows[0].preview,/NaN/);assert.equal(out.otherRows[0].preview,'');
});
/** The restored projection (canonical-notes-ui.ts) over the real model.js Notes view. */
function installCanonicalProjection(f){
 const code=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/canonical-notes-ui.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
 const install=new Function('parseNoteFormat','projectNoteForModel','noteScheduleDraft','agentPendingText','agentAvailabilityNotice','DailyApps','CanonicalNotesController','CanonicalNotesEditor',code+';return installCanonicalNotesView;')(x=>x,x=>x,async()=>({}),(_s,text)=>text,(_s,text)=>text,{},class{},class{});
 install(class{},{notes:f.view});
}
test('agent Notes waiting for a connection use Alpha\'s Notes view without retained notes or device controls',()=>{
 const f=fixture([{id:'retained',kind:'text',title:'Retained',body:'Exact',pinned:false}]);installCanonicalProjection(f);
 const out=f.view.render(f.state,{...f.api,notesSourceMode:'canonical'});
 assert.equal(out.pinnedRows.length+out.otherRows.length,0);assert.equal(out.none,false);assert.equal(out.canCreate,false);assert.equal(out.canRecord,false);assert.equal(out.trashAvailable,false);
 // No waveform or Trash without a binding; Previous notes keeps its row under the list.
 assert.equal(out.canDictateNew,undefined);assert.equal(out.trashInList,undefined);assert.equal(out.listActions,true);
 assert.equal(out.notesTitle,'Notes');assert.equal(out.olderNotesAction,f.choose);assert.match(out.storageStatus,/unavailable for this agent connection/);assert.deepEqual(f.state,f.before);
});
test('an explicitly selected retained source keeps Older notes naming and its return action',()=>{
 const f=fixture();installCanonicalProjection(f);const out=f.view.render(f.state,{...f.api,notesSourceOptions:[{id:'canonical',choose:f.choose},{id:'legacy',selected:true,choose(){}}]});assert.equal(out.notesTitle,'Older notes');assert.equal(out.primaryNotes,false);assert.equal(out.returnToNotesAction,f.choose);assert.equal(out.olderNotesAction,undefined);assert.equal(out.canCreate,true);assert.deepEqual(f.state,f.before);
});
