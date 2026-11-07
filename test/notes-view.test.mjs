import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Notes folders, Recently deleted folder rules and the list/filter helpers (PLAN.md section 3,
// specs/notes-view Design.cfg). Pure modules only; the view wiring is covered by browser specs.
const folders=await import('../apps/app/src/runtime/notes-folders-model.ts');
const view=await import('../apps/app/src/runtime/notes-view.ts');

const doc=(...names)=>({version:1,folders:names.map((name,i)=>({id:`f-${i+1}`,name,createdAt:i}))});

test('folder documents validate strictly and names are unique case-insensitively',()=>{
 assert.deepEqual(folders.validateNotesFolders(null),{version:1,folders:[]});
 assert.deepEqual(folders.validateNotesFolders(doc('Work','Personal')),doc('Work','Personal'));
 for(const bad of [{version:2,folders:[]},{version:1,folders:{}},{version:1,folders:[],extra:1},doc('Work','work'),
  {version:1,folders:[{id:'bad id',name:'A',createdAt:0}]},{version:1,folders:[{id:'f-1',name:'A',createdAt:0},{id:'f-1',name:'B',createdAt:0}]},
  {version:1,folders:[{id:'f-1',name:' A',createdAt:0}]},{version:1,folders:[{id:'f-1',name:'A',createdAt:0,x:1}]}])
  assert.throws(()=>folders.validateNotesFolders(bad));
 assert.equal(folders.notesFolderName('  Big   Sur '),'Big Sur');
 assert.throws(()=>folders.notesFolderName('   '));
 assert.throws(()=>folders.notesFolderName('x'.repeat(41)));
 const added=folders.addNotesFolder(doc('Work'),{id:'f-9',name:'Travel',createdAt:5});
 assert.deepEqual(added.folders.map(f=>f.name),['Work','Travel']);
 assert.deepEqual(folders.addNotesFolder(added,{id:'f-10',name:'  travel ',createdAt:6}),added,'an existing name is reused, not duplicated');
 assert.equal(folders.findNotesFolderByName(added,'WORK').id,'f-1');
 assert.deepEqual(folders.removeNotesFolder(added,'f-1').folders.map(f=>f.id),['f-9']);
 assert.match(folders.newNotesFolderId(),/^f-[0-9a-f-]{36}$/);
});

test('deleting a folder moves its notes to no folder and never removes a note (FolderRefsValid)',()=>{
 const list=[{id:'a',kind:'text',title:'A',folderId:'f-1'},{id:'b',kind:'text',title:'B',folderId:'f-2'},{id:'c',kind:'text',title:'C'}];
 const released=folders.releaseNotesFolder(list,'f-1');
 assert.equal(released.length,3);
 assert.equal(Object.hasOwn(released[0],'folderId'),false);
 assert.equal(released[1],list[1],'other notes are untouched');
 assert.equal(released[2],list[2]);
 // A note whose folder no longer exists is shown under no folder.
 assert.equal(folders.noteFolderOf({id:'x',folderId:'f-gone'},[{id:'f-1'}]),null);
 assert.equal(folders.noteFolderOf({id:'x',folderId:'f-1'},[{id:'f-1'}]),'f-1');
 assert.deepEqual(folders.withNoteFolder({id:'x',kind:'text',title:'X'},'f-2'),{id:'x',kind:'text',title:'X',folderId:'f-2'});
 const same={id:'x',folderId:'f-2'};assert.equal(folders.withNoteFolder(same,'f-2'),same);
});

test('renaming a folder keeps its id, so its notes stay in it (RenameKeepsMembership, FolderNamesUnique)',()=>{
 const before=doc('Work','Personal'),list=[{id:'a',folderId:'f-1'},{id:'b',folderId:'f-2'},{id:'c'}];
 const renamed=folders.renameNotesFolder(before,'f-1','  Office  Stuff ');
 assert.deepEqual(renamed.folders.map(f=>[f.id,f.name,f.createdAt]),[['f-1','Office Stuff',0],['f-2','Personal',1]]);
 for(const note of list)assert.equal(folders.noteFolderOf(note,renamed.folders),folders.noteFolderOf(note,before.folders));
 assert.equal(folders.findNotesFolderByName(renamed,'office stuff').id,'f-1');
 assert.equal(folders.findNotesFolderByName(renamed,'Work'),undefined);
 assert.deepEqual(folders.renameNotesFolder(before,'f-1','WORK').folders[0].name,'WORK','a folder may change the case of its own name');
 assert.throws(()=>folders.renameNotesFolder(before,'f-1','personal'),/in use/);
 assert.throws(()=>folders.renameNotesFolder(before,'f-9','New'),/not found/);
 assert.throws(()=>folders.renameNotesFolder(before,'f-1','  '));
 assert.throws(()=>folders.renameNotesFolder(before,'f-1','x'.repeat(41)));
});

test('restore returns a note to its folder, or to no folder when the folder was deleted (RestoreReturnsToFolder)',()=>{
 const note={id:'n',kind:'text',title:'N',folderId:'f-1'};
 assert.equal(folders.restoredNoteFolder(note,[{id:'f-1'}]),note);
 assert.deepEqual(folders.restoredNoteFolder(note,[{id:'f-2'}]),{id:'n',kind:'text',title:'N'});
 const loose={id:'m',kind:'text',title:'M'};assert.equal(folders.restoredNoteFolder(loose,[]),loose);
});

test('agent content search matches titles, bodies, checklist items and voice transcripts',()=>{
 const notes=[
  {id:'t',kind:'text',title:'Term sheet questions',body:'Ask about the liquidation preference.'},
  {id:'l',kind:'list',title:'Groceries',items:[{t:'Oat milk',done:true},{t:'Lemons',done:false}]},
  {id:'v',kind:'voice',title:'Voice note',body:'',lines:[{s:'me',at:0,t:'Ask Priya for the battery curves'}]},
  {id:'k',kind:'link',title:'Article',domain:'example.com',clips:['On-device agents']},
 ];
 const ids=text=>notes.filter(n=>view.noteMatchesText(n,text)).map(n=>n.id);
 assert.deepEqual(ids('LIQUIDATION'),['t']);
 assert.deepEqual(ids('lemons'),['l']);
 assert.deepEqual(ids('battery curves'),['v']);
 assert.deepEqual(ids('on-device'),['k']);
 assert.deepEqual(ids('nothing like this'),[]);
});

test('the filter is read-only and combines text, kind and folder',()=>{
 const f=[{id:'f-1',name:'Work'},{id:'f-2',name:'Personal'}];
 const list=[{id:'a',kind:'text',title:'Plan',body:'term sheet',folderId:'f-1'},{id:'b',kind:'voice',title:'Sync',body:'term sheet',folderId:'f-2'},{id:'c',kind:'voice',title:'Old',folderId:'f-gone'}];
 const before=JSON.stringify(list);
 assert.deepEqual(view.filterNotes(list,{text:'term sheet'},f).map(n=>n.id),['a','b']);
 assert.deepEqual(view.filterNotes(list,{kind:'voice'},f).map(n=>n.id),['b','c']);
 assert.deepEqual(view.filterNotes(list,{kind:'voice',folder:'f-2'},f).map(n=>n.id),['b']);
 assert.deepEqual(view.filterNotes(list,null,f).map(n=>n.id),['a','b','c']);
 assert.equal(JSON.stringify(list),before,'filtering never changes a note');
 assert.equal(view.notesFilterLabel({text:'term sheet',kind:'voice',folder:'f-1'},f),'“term sheet” · Voice notes · Work');
 assert.equal(view.notesFilterLabel({},f),'All notes');
});

test('a device note with no time sorts by its stored place, never below an older timed note',()=>{
 const now=Date.UTC(2026,10,6,15);
 // Stored newest first: a voice note recorded today (no time, older build) above a weeks-old agent note.
 const list=[{id:'today',kind:'voice',title:'Voice note'},{id:'agent',kind:'text',createdAt:now-21*864e5},{id:'older',kind:'text'},{id:'oldest',kind:'text',modifiedAt:now-60*864e5}];
 assert.deepEqual(view.sortNotes(list).map(n=>n.id),['today','agent','older','oldest']);
 const model=readFileSync('apps/app/src/prototype/model.js','utf8');
 assert.match(model,/when: "Now", createdAt: now, modifiedAt: now \}/,'a new device note is stamped');
 assert.match(model,/if \(\["title", "body", "items", "lines"\]\.some\(function \(k\) \{ return next\[k\] !== n\[k\]; \}\)\) next\.modifiedAt = Date\.now\(\);/,'a content edit is stamped');
 assert.match(readFileSync('apps/app/src/prototype/voice-adapter.ts','utf8'),/when: 'Now', createdAt: Date\.now\(\), modifiedAt: Date\.now\(\)/,'a new voice note is stamped');
});
test('list rows: pinned first, newest first, two-line previews and short dates',()=>{
 const now=Date.UTC(2026,10,6,15);
 const list=[{id:'old',kind:'text',title:'Old',modifiedAt:now-40*864e5},{id:'new',kind:'text',title:'New',modifiedAt:now-1000},{id:'pin',kind:'text',title:'Pin',pinned:true,modifiedAt:now-90*864e5},{id:'x',kind:'text',title:'Unknown'}];
 assert.deepEqual(view.sortNotes(list).map(n=>n.id),['pin','new','old','x']);
 assert.equal(view.notePreview({kind:'list',items:[{t:'Milk',done:true},{t:'Eggs'}]}),'☑ Milk\n☐ Eggs');
 assert.equal(view.notePreview({kind:'voice',body:'',lines:[{t:'hello'},{t:'there'}]}),'hello there');
 assert.equal(view.notePreview({kind:'link',domain:'example.com'}),'example.com');
 assert.equal(view.noteDateLabel({modifiedAt:now-60_000},now,'en-US','UTC'),'2:59 PM');
 assert.equal(view.noteDateLabel({modifiedAt:now-2*864e5},now,'en-US','UTC'),'Wed');
 assert.equal(view.noteDateLabel({modifiedAt:Date.UTC(2026,0,5)},now,'en-US','UTC'),'Jan 5');
 assert.equal(view.noteDateLabel({modifiedAt:Date.UTC(2025,0,5)},now,'en-US','UTC'),'Jan 5, 2025');
 assert.equal(view.noteDateLabel({},now),'');
});
