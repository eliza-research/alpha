import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from './support/strip-types.mjs';import vm from 'node:vm';
const source=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
const start=source.indexOf("        if(operation.type==='read_selected_notes'&&this.notesSourceMode==='canonical')"),end=source.indexOf("        if(operation.type==='read_selected_notes'){",start);
function fixture(){let rows=[{id:'note',title:'Reviewed',body:'Exact text'}],afterHash=()=>{},checks=0;const notes={current:true,notes:()=>rows};const host={notesSourceMode:'canonical',canonicalNotesUi:notes};
 const box={operation:{type:'read_selected_notes',notes:[{id:'note',revision:JSON.stringify(['Reviewed','Exact text'])}]},projectNoteForModel:n=>({title:n.title,body:n.body}),workflowSha:async parts=>{afterHash();return JSON.stringify(parts);},validateWorkflowResult:async(_operation,value)=>value,current:()=>{checks++;}};
 const body=start>=0?source.slice(start,end):'';const execute=vm.runInNewContext(stripTypeScriptTypes('(async function(){'+body+'return {status:"failed",summary:"canonical read unavailable"};})',{mode:'strip'}),box).bind(host);
 return {host,box,execute,set rows(value){rows=value;},get checks(){return checks;},afterHash(fn){afterHash=fn;}};
}
test('approved canonical Notes workflow read carries exact selected text',async()=>{const f=fixture(),value=await f.execute();assert.equal(value.status,'succeeded');assert.equal(value.readResult.notes[0].text,'Exact text');assert.equal(f.checks,1);});
test('a canonical note whose reviewed text changed is refused',async()=>{const f=fixture();f.rows=[{id:'note',title:'Changed',body:'Exact text'}];assert.equal((await f.execute()).status,'failed');});
test('a canonical source changed while hashing cannot return stale content',async()=>{const f=fixture();f.afterHash(()=>f.rows=[{id:'note',title:'Reviewed',body:'New text'}]);await assert.rejects(f.execute(),/Notes changed/);});
test('a replaced canonical Notes owner cannot return its earlier content',async()=>{const f=fixture();f.afterHash(()=>f.host.canonicalNotesUi={current:true,notes:()=>[]});await assert.rejects(f.execute(),/Notes changed/);});
test('duplicate canonical note identities are refused',async()=>{const f=fixture();f.rows=[{id:'note',title:'Reviewed',body:'Exact text'},{id:'note',title:'Reviewed',body:'Exact text'}];await assert.rejects(f.execute(),/missing/);});
