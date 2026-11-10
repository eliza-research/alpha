import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {nextDefaultNoteTitle} from '../apps/app/src/runtime/note-default-title.ts';
const source=readFileSync('apps/app/src/prototype/model.js','utf8');
const region=source.slice(source.indexOf('function notesFind('),source.indexOf('function notesLast('));
const notesView=source.slice(source.indexOf('registerView("notes",'),source.indexOf('registerView("notes",')+2600);
const leave=notesView.match(/onLeave: function\s*\(([^)]*)\)\s*\{([^}]*)\}/);
function harness(list=[]){
 const state={list:structuredClone(list),open:null,blankCreationId:null};
 const context=vm.createContext({NT:{},clearInterval(){},nextDefaultNoteTitle});
 vm.runInContext(region+`\nglobalThis.leave=function(${leave[1]}){${leave[2]}}`,context);
 const api={get(){return state;},set(patch){Object.assign(state,patch);return true;}};
 return {state,api,functions:context};
}
const saved={id:'saved-owned',kind:'text',title:'',body:'',pinned:false};
test('closing an existing empty saved note preserves its identity without implicit deletion',()=>{
 const h=harness([saved]);h.state.open=saved.id;h.functions.notesClose(h.api);
 assert.equal(h.state.list.length,1);assert.equal(h.state.list[0].id,saved.id);assert.equal(h.state.open,null);
});
for(const way of ['notesClose','leave'])test(`a newly created blank note is discarded on ${way}`,()=>{
 const h=harness();h.functions.notesNew(h.api,'text');assert.equal(h.state.list.length,1);
 h.functions[way](h.api);assert.equal(h.state.list.length,0);assert.equal(h.state.open,null);
});
for(const kind of ['text','list'])test(`a once meaningful new ${kind} note survives later clearing and Back`,()=>{
 const h=harness();h.functions.notesNew(h.api,kind);const id=h.state.open;
 h.functions.notesUpd(h.api,id,{title:'Owned note'});h.functions.notesUpd(h.api,id,{title:''});h.functions.notesClose(h.api);
 assert.equal(h.state.list.length,1);assert.equal(h.state.list[0].id,id);
});
test('Home keeps a meaningful new note and its editor state',()=>{
 const h=harness();h.functions.notesNew(h.api,'text');const id=h.state.open;
 h.functions.notesUpd(h.api,id,{body:'Exact owned body'});h.functions.leave(h.api);
 assert.equal(h.state.list.length,1);assert.equal(h.state.list[0].body,'Exact owned body');assert.equal(h.state.open,id);
});

test('new UI defaults number around retained and trashed titles without renaming them',()=>{
 const existing=[{id:'one',kind:'text',title:'New note',body:'Keep'},{id:'two',kind:'text',title:'New note #2',body:'Keep'}],h=harness(existing);
 h.state.trash=[{note:{id:'three',title:'New note 3'}}];
 h.functions.notesNew(h.api,'text');assert.equal(h.state.list[0].title,'New note 4');
 assert.deepEqual(JSON.parse(JSON.stringify(h.state.list.slice(1))),existing);
 h.functions.notesUpd(h.api,h.state.open,{title:'My chosen title'});h.functions.notesClose(h.api);
 assert.equal(h.state.list[0].title,'My chosen title');
});

test('default title families are independent and recognize numbered legacy variants',()=>{
 assert.equal(nextDefaultNoteTitle([],'Voice note'),'Voice note');
 const rows=[{title:'Voice note'},{title:'voice note #3'},{title:'New note 9'},{title:'Voice notebook'},{title:'Voice note - draft'}];
 assert.equal(nextDefaultNoteTitle(rows,'Voice note'),'Voice note 4');
 assert.equal(nextDefaultNoteTitle(rows,'New note'),'New note 10');
});
