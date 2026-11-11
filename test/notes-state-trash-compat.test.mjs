import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from './support/module-hooks.mjs';
import {tsImport} from './support/ts-import.mjs';
// The resident's Notes service reads files/.eliza/notes/agents/<agent>/state.json at every start.
// Pixel builds from an older upstream (ff9c826455, schema 2) rejected state a newer build had
// written (schema 3, with "trash") as NOTES_VALIDATION_FAILED on every boot, which escalated into
// repeated chat notices. The admitted pin must read every stored schema, trash included, so this
// runs the pinned validator itself (only its @elizaos/core import is stubbed).
const core=`export class ElizaError extends Error{constructor(message,options={}){super(message);Object.assign(this,options);}}
export const toWellFormedUnicode=value=>String(value).toWellFormed();
export const truncateWellFormed=(value,length)=>String(value).slice(0,length).toWellFormed();`;
registerHooks({resolve(specifier,context,next){if(specifier==='@elizaos/core')return {url:'data:text/javascript,'+encodeURIComponent(core),shortCircuit:true};return next(specifier,context);}});
const {parseNotesDocument}=await tsImport('../vendor/eliza/plugins/plugin-notes/src/validation.ts',import.meta.url);
const {NOTES_SCHEMA_VERSION}=await tsImport('../vendor/eliza/plugins/plugin-notes/src/types.ts',import.meta.url);
const ids={n1:'0e4c5c8e-6a0f-4f7e-9a51-3c1d2b4a5e61',n2:'7b2d9f14-1c3e-4a8b-b6d5-9e0f1a2b3c4d'};
const note=(id,title)=>({id:ids[id],title,body:'Body',color:'yellow',createdAt:'2026-10-25T07:00:00.000Z',updatedAt:'2026-10-25T07:00:00.000Z'});
const base={revision:1,persistedAt:'2026-10-25T07:00:00.000Z'};

test('the pinned Notes reader admits stored schema 3 state with trash, empty or not',()=>{
 assert.equal(NOTES_SCHEMA_VERSION,3);
 const empty=parseNotesDocument({...base,schemaVersion:3,notes:[note('n1','Kept')],trash:[]});
 assert.deepEqual(empty.trash,[]);assert.equal(empty.notes.length,1);
 const kept=parseNotesDocument({...base,schemaVersion:3,notes:[note('n1','Kept')],trash:[{note:note('n2','Deleted'),deletedAt:'2026-10-25T07:05:00.000Z'}]});
 assert.equal(kept.trash.length,1,'restorable deleted notes are carried, never dropped');assert.equal(kept.trash[0].note.id,ids.n2);
});

test('the pinned Notes reader upgrades schema 2 state written without trash (including a hand-downgraded file)',()=>{
 const upgraded=parseNotesDocument({...base,schemaVersion:2,notes:[note('n1','Kept')]});
 assert.equal(upgraded.schemaVersion,3);assert.deepEqual(upgraded.trash,[]);assert.equal(upgraded.notes[0].title,'Kept');
});

test('state the reader cannot carry still fails closed instead of becoming an empty store',()=>{
 assert.throws(()=>parseNotesDocument({...base,schemaVersion:3,notes:[note('n1','A')],trash:[{note:note('n1','A'),deletedAt:'2026-10-25T07:05:00.000Z'}]}),/Duplicate/);
 assert.throws(()=>parseNotesDocument({...base,schemaVersion:3,notes:[],future:true}),/unsupported field/);
});
