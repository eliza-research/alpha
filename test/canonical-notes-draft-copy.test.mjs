import assert from 'node:assert/strict';
import test from 'node:test';
import {compileCanonicalNotesUi,createCanonicalNotesUiFixture} from '../specs/quint/refinement/application/canonical-notes-feedback.mjs';

const compiled=await compileCanonicalNotesUi();
const note={id:'note-one',title:'Owner note',body:'\nSaved words',color:'yellow',createdAt:'2026-11-10T12:00:00Z',updatedAt:'2026-11-10T12:00:00Z'};

async function failedDraft(copy,{record=note,patch={body:'Unsaved words'}}={}){
 const f=await createCanonicalNotesUiFixture(compiled,()=>{},copy);
 f.run('refresh');await f.resolveRequest({revision:1,notes:[record],trash:[]});
 f.run('update','note-one',patch);
 await new Promise(resolve=>setTimeout(resolve,0));
 await f.resolveRequest({revision:1,notes:[record],trash:[]},undefined,false);
 assert.equal(f.ui.phase,'review');
 return f;
}
const view=f=>f.ui.decorate({none:false},f.api,{folder:null});

test('Copy draft preserves the real editor and canonical state through success and refusal',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{hidden:false}});
 const copied=[];let refuse=true;
 const f=await failedDraft(async text=>{copied.push(text);if(refuse)throw Error('Clipboard refused.');});
 try{
  const before=structuredClone(f.ui.editor.draft),saved=structuredClone(f.ui.controller.snapshot),requests=f.requests.length;
  assert.equal(view(f).copyDraftAvailable,true);
  await view(f).copyDraft();
  assert.deepEqual(f.ui.editor.draft,before);
  assert.equal(f.observe().toasts,1);
  refuse=false;await view(f).copyDraft();
  assert.deepEqual(copied,['Owner note\n\nUnsaved words','Owner note\n\nUnsaved words']);
  assert.deepEqual(f.ui.editor.draft,before);
  assert.deepEqual(f.ui.controller.snapshot,saved);
  assert.equal(f.requests.length,requests);
  assert.equal(f.ui.phase,'review');
 }finally{await f.close();if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;}
});

test('Copy draft includes edited checklist state and authored text',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{hidden:false}});
 const copied=[];
 const f=await failedDraft(async text=>copied.push(text),{
  record:{...note,body:'',format:{kind:'list',data:{items:[{t:'Earlier',done:false}],sourceHandle:'private-fixture-handle'}}},
  patch:{items:[{t:'Edited item',done:true},{t:'New item',done:false}]},
 });
 try{
  const before=structuredClone(f.ui.editor.draft);
  await view(f).copyDraft();
  assert.deepEqual(copied,['Owner note\n\n[x] Edited item\n[ ] New item']);
  assert.deepEqual(f.ui.editor.draft,before);
 }finally{await f.close();if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;}
});

test('old Copy draft callbacks refuse a changed draft, hidden view or retired owner',async()=>{
 for(const cause of ['version','token','hidden','inactive','owner']){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document'),document={hidden:false};
  Object.defineProperty(globalThis,'document',{configurable:true,value:document});
  const copied=[],f=await failedDraft(async text=>copied.push(text));
  try{
   const stale=view(f).copyDraft;
   if(cause==='version')f.ui.editor.edit({body:'Newer owner words'});
   if(cause==='token'){f.ui.editor.close();f.ui.editor.open(note.id);f.ui.editor.edit({body:'Another draft'});}
   if(cause==='hidden')document.hidden=true;
   if(cause==='inactive')f.api.isActive=()=>false;
   if(cause==='owner')f.loseOwner();
   const retained=structuredClone(f.ui.editor.draft);
   await stale();
   assert.deepEqual(copied,[],cause);
   assert.deepEqual(f.ui.editor.draft,retained,cause);
   assert.equal(f.observe().toasts,0,cause);
  }finally{await f.close();if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;}
 }
});

test('a clipboard completion after owner retirement preserves the draft and gives no stale notice',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{hidden:false}});
 const pending=Promise.withResolvers(),copied=[];
 const f=await failedDraft(text=>{copied.push(text);return pending.promise;});
 try{
  const before=structuredClone(f.ui.editor.draft),copy=view(f).copyDraft();
  f.loseOwner();pending.resolve();await copy;
  assert.deepEqual(copied,['Owner note\n\nUnsaved words']);
  assert.deepEqual(f.ui.editor.draft,before);
  assert.equal(f.observe().toasts,0);
 }finally{await f.close();if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;}
});

// Try again (retryDraft). The refinement schedules cover a saved record; these cover a note with no record yet and a deleted one.
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
const posts=f=>f.requests.filter(request=>request.method==='POST');
async function failedNewNote(){
 const f=await createCanonicalNotesUiFixture(compiled);
 f.run('refresh');await f.resolveRequest({revision:1,notes:[note],trash:[]});
 assert.equal(await f.ui.create('text'),true);
 f.ui.editor.edit({title:'Fresh note',body:'First words'});
 const save=f.ui.editor.save();await settle();
 await f.resolveRequest({revision:1,notes:[note],trash:[]},undefined,false);
 assert.equal(await save,false);assert.equal(f.ui.phase,'review');
 assert.equal(view(f).retryDraftAvailable,true);
 return f;
}
test('Try again creates a new note once when the first attempt did not land',async()=>{
 const f=await failedNewNote();
 try{
  const retry=view(f).retryDraft();await settle();
  await f.resolveRequest({revision:2,notes:[note],trash:[]});
  assert.equal(posts(f).length,2);
  const created={...note,id:'note-two',title:'Fresh note',body:'\nFirst words'};
  await f.resolveRequest({revision:3,notes:[created,note],trash:[]},created);
  assert.equal(await retry,true);
  assert.deepEqual([f.ui.phase,f.ui.dirty,f.ui.editor.draft.id,view(f).retryDraftAvailable],['ready',false,'note-two',false]);
 }finally{await f.close();}
});
test('Try again does not create a second note when the first attempt is found saved',async()=>{
 const f=await failedNewNote();
 try{
  const retry=view(f).retryDraft();await settle();
  await f.resolveRequest({revision:2,notes:[{...note,id:'note-two',title:'Fresh note',body:'\nFirst words'},note],trash:[]});
  assert.equal(await retry,true);
  assert.equal(posts(f).length,1);
  assert.deepEqual([f.ui.phase,f.ui.dirty,f.ui.editor.draft.id],['ready',false,'note-two']);
 }finally{await f.close();}
});
test('Try again keeps the draft and writes nothing when its note was deleted elsewhere',async()=>{
 const f=await failedDraft(()=>{});
 try{
  const before=structuredClone(f.ui.editor.draft),retry=view(f).retryDraft();await settle();
  await f.resolveRequest({revision:2,notes:[],trash:[{note,deletedAt:'2026-11-10T13:00:00Z'}]});
  assert.equal(await retry,false);
  assert.equal(posts(f).length,1);
  assert.deepEqual(f.ui.editor.draft,before);
  assert.equal(f.ui.phase,'review');
  assert.equal(f.observe().toasts,1);
 }finally{await f.close();}
});
