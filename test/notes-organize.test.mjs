import test from 'node:test';
import assert from 'node:assert/strict';
// Agent tools for Notes organisation (PLAN.md section 3; specs/notes-view AgentMoveOnlyReviewed,
// FolderRefsValid, RestoreReturnsToFolder). The contract and executor are pure, so a fake host
// stands in for the shell.
const contract=await import('../apps/app/src/runtime/notes-organize-contract.ts');
const {executeNotesOrganize}=await import('../apps/app/src/prototype/notes-organize-executor.ts');
const view=await import('../apps/app/src/runtime/notes-view.ts');

const target=(noteId,revision='a'.repeat(64))=>({sourceId:'device-notes',sourceRevision:'b'.repeat(64),noteId,revision});

test('organize operations validate strictly; only the filter is read-only and needs no review',()=>{
 assert.deepEqual(contract.validateNotesOrganizeOperation({type:'notes_filter',text:' term sheet ',kind:'voice'}),{type:'notes_filter',text:'term sheet',kind:'voice'});
 assert.deepEqual(contract.validateNotesOrganizeOperation({type:'notes_folder_create',name:'  Big  Sur '}),{type:'notes_folder_create',name:'Big Sur'});
 assert.deepEqual(contract.validateNotesOrganizeOperation({type:'notes_restore',noteId:'n-1'}),{type:'notes_restore',noteId:'n-1'});
 for(const bad of [{type:'notes_filter'},{type:'notes_filter',kind:'photo'},{type:'notes_filter',text:'x',extra:1},{type:'notes_move',target:target('n')},
  {type:'notes_folder_create',name:''},{type:'notes_record'},{type:'notes_record',action:'pause'},{type:'notes_record',action:'start',noteId:'n'},{type:'notes_folder_create',name:'x'.repeat(41)},{type:'notes_restore',noteId:'../x'},{type:'notes_rename'}])
  assert.throws(()=>contract.validateNotesOrganizeOperation(bad),undefined,JSON.stringify(bad));
 assert.equal(contract.isNotesOrganizeOperation({type:'notes_update'}),false);
 assert.deepEqual(contract.validateNotesOrganizeOperation({type:'notes_record',action:'start'}),{type:'notes_record',action:'start'});
 assert.deepEqual(contract.validateNotesOrganizeOperation({type:'notes_record',action:'stop'}),{type:'notes_record',action:'stop'});
 assert.deepEqual(contract.describeNotesOrganizeOperation({type:'notes_record',action:'start'}),{title:'Record voice note',description:'In Notes'});
 // Recording runs only with Notes open; the other tools are reviewable from Home too.
 assert.equal(contract.notesOrganizeContextAllowed({view:'home'},'notes_record'),false);
 assert.equal(contract.notesOrganizeContextAllowed({view:'notes'},'notes_record'),true);
 assert.equal(contract.notesOrganizeContextAllowed({view:'notes',sensitive:true},'notes_record'),false);
 assert.equal(contract.notesOrganizeContextAllowed({view:'home'},'notes_move'),true);
 assert.deepEqual(contract.describeNotesOrganizeOperation({type:'notes_move',target:target('n'),folder:'Work'}),{title:'Move note',description:'To Work'});
 assert.equal(contract.notesOrganizeContextAllowed({view:'notes'}),true);
 assert.equal(contract.notesOrganizeContextAllowed({view:'photos'}),false);
 assert.equal(contract.notesOrganizeContextAllowed({view:'notes',sensitive:true}),false);
});

function host({notes=[],folders=[],revision='a'.repeat(64),restore='restored',start='started',stop='saved'}={}){
 const state={notes:structuredClone(notes),folders:{version:1,folders:structuredClone(folders)},filter:null,commits:0,shown:null,recorder:[]};
 return {state,host:{
  ready:()=>true,list:()=>state.notes,
  target:async id=>{if(!state.notes.some(n=>n.id===id))throw Error('missing');return target(id,revision);},
  commitList:async list=>{state.notes=list;state.commits++;return true;},
  readFolders:async()=>structuredClone(state.folders),
  editFolders:async update=>{state.folders=update(structuredClone(state.folders));return structuredClone(state.folders);},
  showFolders:doc=>{state.shown=doc;},
  showFilter:filter=>{state.filter=filter;},
  restore:async()=>restore,
  recordStart:async()=>{state.recorder.push('start');return start;},
  recordStop:async()=>{state.recorder.push('stop');return stop;},
 }};
}

test('notes_filter shows a chip only: no note changes, folders resolved by name',async()=>{
 const {state,host:h}=host({notes:[{id:'a',kind:'text',title:'A'}],folders:[{id:'f-1',name:'Work',createdAt:0}]});
 const before=JSON.stringify(state.notes);
 let r=await executeNotesOrganize(h,{type:'notes_filter',text:'term',folder:'work',kind:'voice'},()=>{});
 assert.equal(r.status,'succeeded');
 assert.deepEqual(state.filter,{text:'term',kind:'voice',folder:'f-1'});
 assert.equal(JSON.stringify(state.notes),before);assert.equal(state.commits,0);
 r=await executeNotesOrganize(h,{type:'notes_filter',folder:'Travel'},()=>{});
 assert.equal(r.status,'failed');
});

test('notes_move applies only to the reviewed revision and only into an existing folder (AgentMoveOnlyReviewed)',async()=>{
 const notes=[{id:'a',kind:'text',title:'A'},{id:'b',kind:'text',title:'B',folderId:'f-1'}],folders=[{id:'f-1',name:'Work',createdAt:0}];
 let {state,host:h}=host({notes,folders});
 assert.equal((await executeNotesOrganize(h,{type:'notes_move',target:target('a'),folder:'Work'},()=>{})).status,'succeeded');
 assert.equal(state.notes[0].folderId,'f-1');assert.equal(state.commits,1);
 assert.equal((await executeNotesOrganize(h,{type:'notes_move',target:target('b'),folder:null},()=>{})).status,'succeeded');
 assert.equal(Object.hasOwn(state.notes[1],'folderId'),false);
 // The note changed since review: refused, nothing written.
 ({state,host:h}=host({notes,folders,revision:'c'.repeat(64)}));
 assert.equal((await executeNotesOrganize(h,{type:'notes_move',target:target('a'),folder:'Work'},()=>{})).status,'failed');
 assert.equal(state.commits,0);
 // A folder that does not exist is refused, never created implicitly.
 ({state,host:h}=host({notes,folders}));
 assert.equal((await executeNotesOrganize(h,{type:'notes_move',target:target('a'),folder:'Travel'},()=>{})).status,'failed');
 assert.equal(state.commits,0);assert.equal(state.folders.folders.length,1);
 // A context change before the write aborts it.
 await assert.rejects(executeNotesOrganize(h,{type:'notes_move',target:target('a'),folder:'Work'},()=>{throw Error('context changed');}));
 assert.equal(state.commits,0);
});

test('notes_folder_create adds one folder by name and reuses an existing one',async()=>{
 const {state,host:h}=host({folders:[{id:'f-1',name:'Work',createdAt:0}]});
 assert.equal((await executeNotesOrganize(h,{type:'notes_folder_create',name:'Travel'},()=>{})).status,'succeeded');
 assert.deepEqual(state.folders.folders.map(f=>f.name),['Work','Travel']);
 assert.equal(state.shown.folders.length,2);
 assert.equal((await executeNotesOrganize(h,{type:'notes_folder_create',name:'travel'},()=>{})).status,'succeeded');
 assert.equal(state.folders.folders.length,2);
});

test('notes_restore reports the Trash restore outcome',async()=>{
 for(const [outcome,status] of [['restored','succeeded'],['live','succeeded'],['missing','failed'],['expired','failed'],['failed','unknown']]){
  const {host:h}=host({restore:outcome});
  assert.equal((await executeNotesOrganize(h,{type:'notes_restore',noteId:'n'},()=>{})).status,status,outcome);
 }
});

test('notes_record starts and saves through the Notes recorder and never touches the notes list itself',async()=>{
 let {state,host:h}=host({notes:[{id:'a',kind:'text',title:'A'}]});
 assert.deepEqual(await executeNotesOrganize(h,{type:'notes_record',action:'start'},()=>{}),{status:'succeeded',summary:'Recording a voice note in Notes.'});
 assert.deepEqual(await executeNotesOrganize(h,{type:'notes_record',action:'stop'},()=>{}),{status:'succeeded',summary:'Saved the voice note.'});
 assert.deepEqual(state.recorder,['start','stop']);assert.equal(state.commits,0);
 for(const [start,status] of [['already','succeeded'],['failed','failed']]){({host:h}=host({start}));assert.equal((await executeNotesOrganize(h,{type:'notes_record',action:'start'},()=>{})).status,status,start);}
 for(const [stop,status] of [['none','failed'],['failed','unknown']]){({host:h}=host({stop}));assert.equal((await executeNotesOrganize(h,{type:'notes_record',action:'stop'},()=>{})).status,status,stop);}
 // A context change before it runs: nothing starts.
 ({state,host:h}=host());
 await assert.rejects(executeNotesOrganize(h,{type:'notes_record',action:'start'},()=>{throw Error('context changed');}));
 assert.deepEqual(state.recorder,[]);
});

test('content search also matches a saved recording transcript',()=>{
 const note={id:'v',kind:'voice',title:'Voice note',body:'',audio:{audioId:'x',transcript:'thermal numbers from the lab'}};
 assert.equal(view.noteMatchesText(note,'THERMAL numbers'),true);
 assert.equal(view.notePreview(note),'thermal numbers from the lab');
});
