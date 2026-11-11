import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import {stripTypeScriptTypes} from './support/strip-types.mjs';import vm from'node:vm';
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
 const code=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/canonical-notes-ui.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'strip'});
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
test('an explicitly selected retained source keeps Previous notes naming and its return action',()=>{
 const f=fixture();installCanonicalProjection(f);const out=f.view.render(f.state,{...f.api,notesSourceOptions:[{id:'canonical',choose:f.choose},{id:'legacy',selected:true,choose(){}}]});assert.equal(out.notesTitle,'Previous notes');assert.equal(out.primaryNotes,false);assert.equal(out.returnToNotesAction,f.choose);assert.equal(out.olderNotesAction,undefined);assert.equal(out.canCreate,true);assert.deepEqual(f.state,f.before);
});

test('retained-data availability hides the previous-notes entry without removing its internal route',()=>{
 const f=fixture();installCanonicalProjection(f);
 const sources=[{id:'canonical',choose:f.choose},{id:'legacy',available:false,choose:f.choose}];
 const out=f.view.render(f.state,{...f.api,notesSourceMode:'canonical',notesSourceOptions:sources});
 assert.equal(out.olderNotesAction,null);assert.equal(out.listActions,false);
 assert.equal(sources.find(source=>source.id==='legacy').choose,f.choose);
});

test('bulk Notes moves survive collection revision changes and finish with selection closed',async()=>{
 const f=fixture([{id:'a',kind:'text',title:'A',body:'a',canonicalRevision:1},{id:'b',kind:'text',title:'B',body:'b',canonicalRevision:1}]);
 Object.assign(f.state,{selectingNotes:true,selectedNotes:['a','b'],folderSheet:{kind:'move-selection'}});
 const moved=[];
 f.api.set=patch=>{Object.assign(f.state,patch);};
 f.api.canonicalNotes={current:true,update:async(id,patch)=>{moved.push(id);f.state.list=f.state.list.map(note=>({...note,...(note.id===id?patch:{}),canonicalRevision:note.canonicalRevision+1}));return true;},leave:async()=>true};
 const out=f.view.render(f.state,f.api);
 await out.removeSelectedFromFolder();
 assert.deepEqual(moved,['a','b']);assert.equal(f.state.selectionBusy,false);assert.equal(f.state.selectingNotes,false);assert.equal(f.state.selectedNotes.length,0);
});

test('bulk Notes deletion stops when another selected note changes',async()=>{
 const f=fixture([{id:'a',kind:'text',title:'A',body:'a',canonicalRevision:1},{id:'b',kind:'text',title:'B',body:'b',canonicalRevision:1}]);
 Object.assign(f.state,{selectingNotes:true,selectedNotes:['a','b']});
 const removed=[];f.api.set=patch=>{Object.assign(f.state,patch);};
 f.api.canonicalNotes={current:true,remove:async id=>{removed.push(id);f.state.list=[{id:'b',kind:'text',title:'Changed elsewhere',body:'b',canonicalRevision:2}];return true;}};
 await f.view.render(f.state,f.api).deleteSelected();
 assert.deepEqual(removed,['a']);assert.deepEqual(Array.from(f.state.selectedNotes),['b']);assert.equal(f.state.selectionBusy,false);
});


test('Notes exposes existing folders inline and removes membership through the selection action',async()=>{
 const f=fixture([{id:'a',kind:'text',title:'A',body:'a',folderId:'f-1',canonicalRevision:1}]);
 Object.assign(f.state,{folders:[{id:'f-1',name:'Work',createdAt:1}],selectingNotes:true,selectedNotes:['a']});
 f.api.set=patch=>{Object.assign(f.state,patch);};
 const updates=[];
 f.api.canonicalNotes={current:true,update:async(id,patch)=>{updates.push({id,patch});return true;},leave:async()=>true};
 const out=f.view.render(f.state,f.api);
 assert.equal(out.hasFolders,false);assert.equal(out.folderRows[0].name,'Work');
 assert.equal(out.showFolders,undefined);assert.equal(out.canRemoveFromFolder,true);
 await out.removeSelectedFromFolder();
 assert.deepEqual(structuredClone(updates),[{id:'a',patch:{folderId:null}}]);
 assert.equal(f.state.selectingNotes,false);
 const empty=fixture(),emptyView=empty.view.render(empty.state,empty.api);
 assert.equal(emptyView.hasFolders,false);assert.equal(emptyView.selectionFolderDisabled,true);
});


test('opening a Notes folder shows its notes with a return to the main list',()=>{
 const f=fixture([{id:'a',kind:'text',title:'A',folderId:'f-1'},{id:'b',kind:'text',title:'B'}]);
 f.state.folders=[{id:'f-1',name:'Work',createdAt:1}];f.api.set=patch=>Object.assign(f.state,patch);
 const root=f.view.render(f.state,f.api);root.folderRows[0].select();
 const inside=f.view.render(f.state,f.api);
 assert.equal(inside.notesTitle,'Work');assert.equal(inside.primaryNotes,false);assert.equal(inside.hasFolders,false);
 assert.deepEqual(Array.from(inside.otherRows,n=>n.id),['a']);
 inside.returnToNotesAction();assert.equal(f.view.render(f.state,f.api).hasFolders,true);
});
