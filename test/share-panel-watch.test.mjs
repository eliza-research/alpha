// The share panel's "is this still the selection" check. Pure renderer logic; no panel is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
const {unchangedSince}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(readFileSync('apps/app/src/runtime/share-panel.ts','utf8'))).toString('base64'));

test('an unchanged store object is compared by identity, with no serialisation per check',()=>{
 let state={open:'a',rows:[1,2,3]},reads=0;
 const check=unchangedSince(()=>state,()=>{reads++;return {...state};});
 assert.equal(reads,1,'the content is captured once when the panel opens');
 for(let i=0;i<50;i++)assert.equal(check(),true);
 assert.equal(reads,1,'repeated checks of the same object read no content');
});
test('a replaced object is compared by content; an equal one becomes the new identity',()=>{
 let state={open:'a'},reads=0;
 const check=unchangedSince(()=>state,()=>{reads++;return state;});
 state={open:'a'};assert.equal(check(),true,'an equal replacement is still the same selection');assert.equal(reads,2);
 assert.equal(check(),true);assert.equal(reads,2,'and is not serialised again');
 state={open:'b'};assert.equal(check(),false,'a changed selection is detected');
 state={open:'a'};assert.equal(check(),true,'the check reports the current state, not a latch');
});
test('absent values and a single getter work',()=>{
 let rows;const check=unchangedSince(()=>rows);
 assert.equal(check(),true);rows=[];assert.equal(check(),false);rows=undefined;assert.equal(check(),true);
});
test('the share adapter watches identities instead of serialising view state on every check',()=>{
 const adapter=readFileSync('apps/app/src/prototype/share-panel-adapter.ts','utf8');
 assert.doesNotMatch(adapter,/JSON\.stringify/);
 assert.match(adapter,/unchangedSince\(\(\)=>shell\.S\(\)\.vs\?\.\[module\],\(\)=>shareContent\(shell\.vget\(module\)\)\)/);
});
