import test from 'node:test';
import assert from 'node:assert/strict';
import {nextDefaultNoteTitle} from '../apps/app/src/runtime/note-default-title.ts';

test('default title families are independent and recognize numbered legacy variants',()=>{
 assert.equal(nextDefaultNoteTitle([],'Voice note'),'Voice note');
 const rows=[{title:'Voice note'},{title:'voice note #3'},{title:'New note 9'},{title:'Voice notebook'},{title:'Voice note - draft'}];
 assert.equal(nextDefaultNoteTitle(rows,'Voice note'),'Voice note 4');
 assert.equal(nextDefaultNoteTitle(rows,'New note'),'New note 10');
});
