import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync('apps/app/src/runtime/note-share-text.ts','utf8');
const compiled=stripTypeScriptTypes(source,{mode:'strip'});
const {noteShareText}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
test('selected text and checklist export preserves complete lines and completion state',()=>{
 assert.equal(noteShareText({kind:'text',title:'Draft',body:'one\n\ntwo'}).text,'Draft\n\none\n\ntwo');
 assert.equal(noteShareText({kind:'list',title:'List',items:[{t:'milk',done:true},{t:'bread'}]}).text,'List\n\n[x] milk\n[ ] bread');
});
test('link note shares its exact URL and saved clips',()=>{
 assert.equal(noteShareText({kind:'link',title:'Source',url:'https://example.org/path?a=1',clips:['saved excerpt']}).text,'Source\n\nhttps://example.org/path?a=1\n\nsaved excerpt');
});
test('voice note text includes actual transcript and clearly excludes audio',()=>{
 const result=noteShareText({kind:'voice',title:'Meeting',lines:[{s:'me',t:'Exact words'},{s:'p1',t:'Next words'}],summary:['Summary'],actions:[{t:'Call',done:false}]}).text;
 assert.match(result,/Transcript\nExact words\nNext words/);assert.match(result,/audio not included/);assert.match(result,/Summary\nSummary/);assert.match(result,/\[ \] Call/);
 assert.match(noteShareText({kind:'voice'}).text,/No transcript saved/);
 assert.throws(()=>noteShareText({kind:'unknown'}),/supported text/);
});

test('saved voice body and audio transcript survive sharing without invented absence',()=>{
 assert.match(noteShareText({kind:'voice',body:'Saved body transcript'}).text,/Transcript\nSaved body transcript/);
 assert.match(noteShareText({kind:'voice',audio:{transcript:'Saved audio transcript'}}).text,/Transcript\nSaved audio transcript/);
});
