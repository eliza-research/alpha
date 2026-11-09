import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
test('source renewal Ask requires matching current owner, revision and token; lifecycle and cancel preserve routes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hosted-ask-')),previous=globalThis.window;globalThis.window=new EventTarget();
 const port={sensitive:false,review:null};globalThis.__hostedQuestionFixture=port;
 try{
  const bundle=await build({entryPoints:[resolve('apps/app/src/runtime/source-renewal-question.ts')],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'ports',setup(b){b.onResolve({filter:/browser\/content-question$|alpha-client$|hosted-digests$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('content-question')?'export const reviewContentQuestion=input=>{globalThis.__hostedQuestionFixture.review=input;return ()=>input.closed(false)};':a.path.endsWith('alpha-client')?'export const alphaClient={getState:()=>({context:{sensitive:globalThis.__hostedQuestionFixture.sensitive}})};':'export const digestSummaryText=result=>result.output;'}));}}]});
  const file=join(dir,'question.mjs');writeFileSync(file,bundle.outputFiles[0].text);const {reviewSourceRenewalQuestion,renewalMatches}=await import(pathToFileURL(file));
  const selection={provider:'native',ownerId:'owner',agentId:'agent',installationId:'install',enrollmentId:'enroll',sourceId:'source',revision:'r1'};
  const tap={token:'token',question:true,selection,expiresAt:Date.parse('2026-10-15T00:00:00Z')};
  let current=true,settled=0,discarded=0,composed=0,reported=0;
  const tick=()=>new Promise(r=>setImmediate(r));
  const options={tap,signal:new AbortController().signal,current:()=>current,recheck:async()=>tap,settle:async discard=>{discard?discarded++:settled++},canCompose:()=>true,compose:()=>{composed++;return true},report:()=>{reported++},closed:()=>{}};
  assert.equal(renewalMatches(tap,selection,'2026-10-15T00:00:00Z'),true);
  for(const field of ['ownerId','agentId','installationId','enrollmentId','sourceId','revision'])assert.equal(renewalMatches(tap,{...selection,[field]:'changed'},'2026-10-15T00:00:00Z'),false);
  reviewSourceRenewalQuestion(options);port.review.closed(true);await tick();assert.equal(discarded,1);assert.equal(settled,0);
  reviewSourceRenewalQuestion(options);port.review.compose('reviewed draft');await tick();assert.equal(settled,1);assert.equal(composed,1);
  reviewSourceRenewalQuestion({...options,recheck:async()=>({...tap,token:'new'})});port.review.compose('stale');await tick();assert.equal(settled,1);assert.equal(composed,1);
  reviewSourceRenewalQuestion({...options,recheck:async()=>{current=false;return tap}});port.review.compose('wrong owner');await tick();assert.equal(settled,1);assert.equal(composed,1);
  current=true;reviewSourceRenewalQuestion({...options,settle:async()=>{current=false}});port.review.compose('changed after settle');await tick();assert.equal(composed,1);
  current=true;reviewSourceRenewalQuestion(options);window.dispatchEvent(new Event('blur'));await tick();assert.equal(discarded,1,'lifecycle close preserves pending');
  port.sensitive=true;assert.equal(reviewSourceRenewalQuestion(options),undefined);assert.ok(reported>=3);
 }finally{globalThis.window=previous;delete globalThis.__hostedQuestionFixture;rmSync(dir,{recursive:true,force:true});}
});
