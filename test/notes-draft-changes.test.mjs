import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync('apps/app/src/runtime/notes-secure-store.ts','utf8');
const region=source.slice(source.indexOf('// notes-draft-changes:begin'),source.indexOf('// notes-draft-changes:end'));
assert.ok(region.length>100);
const {notesDraftChanges,applyNotesDraft,notesDraftConflicts,mergeNotesDrafts}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(region,{mode:'strip'})).toString('base64'));
const note=(id,body)=>({id,kind:'text',title:id,body,pinned:false});
const saved=[note('a','A'),note('b','B'),note('c','C')];
test('a draft records only edits, creations and removals',()=>{
 const attempted=[note('new','N'),note('a','A edited'),note('b','B')];
 const draft=notesDraftChanges(attempted,saved);
 assert.deepEqual(draft,{records:[note('new','N'),note('a','A edited')],added:['new'],removed:['c'],before:{a:JSON.stringify(note('a','A')),c:JSON.stringify(note('c','C'))}});
});
test('applying a draft over the unchanged collection reproduces the attempted list',()=>{
 const attempted=[note('new','N'),note('a','A edited'),note('b','B')];
 assert.deepEqual(applyNotesDraft(saved,notesDraftChanges(attempted,saved)),attempted);
});
test('a completed uncertain commit leaves nothing to apply',()=>{
 const attempted=[note('new','N'),note('a','A edited')];
 assert.deepEqual(applyNotesDraft(attempted,notesDraftChanges(attempted,saved)),attempted);
});
test('newer saved edits survive and a note deleted since is not revived',()=>{
 const draft=notesDraftChanges([note('a','A draft'),note('b','B'),note('c','C'),note('n','New')],saved);
 const later=[note('b','B newer'),note('c','C')];// a was deleted elsewhere; b edited elsewhere
 assert.deepEqual(applyNotesDraft(later,draft),[note('n','New'),note('b','B newer'),note('c','C')]);
});
test('a newer saved edit of the same note is kept, never overwritten by the older draft',()=>{
 const draft=notesDraftChanges([note('a','A draft'),note('b','B'),note('c','C draft')],saved);
 const later=[note('a','A newer'),note('b','B'),note('c','C')];// a edited again since; c unchanged
 assert.deepEqual(applyNotesDraft(later,draft),[note('a','A newer'),note('b','B'),note('c','C draft')]);
 assert.deepEqual(notesDraftConflicts(later,draft),['a'],'the conflicting draft is reported so it is kept for export');
 assert.deepEqual(notesDraftConflicts(applyNotesDraft(saved,draft),draft),[],'an applied draft has no conflicts');
});
test('a drafted removal does not delete a note edited since',()=>{
 const draft=notesDraftChanges([note('a','A'),note('b','B')],saved);// c removed
 const later=[note('a','A'),note('b','B'),note('c','C newer')];
 assert.deepEqual(applyNotesDraft(later,draft),later);
 assert.deepEqual(notesDraftConflicts(later,draft),['c']);
});
test('a later failure merges an earlier kept draft instead of replacing it',()=>{
 const kept=notesDraftChanges([note('k','Kept new'),note('a','A kept'),note('b','B'),note('c','C')],saved);
 const next=notesDraftChanges([note('a','A'),note('b','B newer'),note('c','C')],saved);// the editor never showed kept
 const merged=mergeNotesDrafts(kept,next);
 assert.deepEqual(applyNotesDraft(saved,merged),[note('k','Kept new'),note('a','A kept'),note('b','B newer'),note('c','C')]);
 const touched=notesDraftChanges([note('a','A newest'),note('b','B'),note('c','C')],saved);
 assert.deepEqual(applyNotesDraft(saved,mergeNotesDrafts(kept,touched)),[note('k','Kept new'),note('a','A newest'),note('b','B'),note('c','C')],'the newer change set wins for a note it touches');
});
