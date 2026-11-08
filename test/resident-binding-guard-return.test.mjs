import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../apps/app/src/runtime/local-agent.ts',import.meta.url),'utf8');
const start=source.indexOf('export async function bindResidentCloudProvider('),end=source.indexOf('/** Automatic failed-bind cleanup',start);
assert.ok(start>=0&&end>start);
const fn=stripTypeScriptTypes(source.slice(start,end).replace('export ',''),{mode:'transform'});
const bind=new Function('residentAttachmentStatus','configureLocalCloudProvider',fn+';return bindResidentCloudProvider;')(async()=>({attachable:true,bindingGuard:'a'.repeat(64)}),async()=>{throw Error('unexpected native configure');});
test('binding returns an existing native guard without configuring again',async()=>{assert.equal(await bind('credential'),'a'.repeat(64));});
test('legacy void configure stays undefined and a new guard is retained',async()=>{
 let calls=0;
 assert.equal(await bind('credential',{attachable:async()=>false,configure:async()=>{calls++;}}),undefined);
 assert.equal(calls,1);
 assert.equal(await bind('credential',{attachable:async()=>false,configure:async()=> 'b'.repeat(64)}),'b'.repeat(64));
});
test('attachment skips configure and configure errors still reject',async()=>{
 assert.equal(await bind('credential',{attachable:async()=>true,configure:async()=>{throw Error('must not run');}}),undefined);
 await assert.rejects(bind('credential',{attachable:async()=>false,configure:async()=>{throw Error('refused');}}),/refused/);
});
