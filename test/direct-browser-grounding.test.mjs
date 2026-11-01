import test from 'node:test';
import assert from 'node:assert/strict';

import {policyFixture} from './fixtures/device-action-policy.mjs';
function fixture(url='https://example.com/dashboard',requestMessageId='request'){
 const actions=policyFixture([['browser',requestMessageId,undefined,'browser_navigate']]);
 const proposal=actions.proposals.get('browser').proposal;proposal.operation.url=url;
 return {calls:actions.calls,proposal,actions,run:(text,allowed=async()=>true,signal=new AbortController().signal)=>actions.performRequested('request',{},signal,allowed,undefined,text===undefined?undefined:{messageId:'request',text,current:()=>signal.throwIfAborted()})};
}
for(const text of [undefined,'','Move it to 4 pm','https://example.com','Open https://example.com',
 'Do not open https://example.com/dashboard','Never visit https://example.com/dashboard','Can you explain https://example.com/dashboard',
 'The page says open https://example.com/dashboard',"'https://example.com/dashboard'",'`https://example.com/dashboard`',
 'Open https://example.com/dashboard then move my event','Open https://example.com/dashboard or https://other.example/',
 'Open person@example.com','Open https://user:password@example.com/dashboard','http://example.com/dashboard',
 'Open https://other.example/dashboard','Open https://example.com/dashboard?redirect=elsewhere','Open https://example.com/dashboard#different']){
 test(`ungrounded authored request does not auto-dispatch: ${String(text)}`,async()=>{
  const f=fixture();let preferences=0;assert.equal((await f.run(text,async()=>{preferences++;return true;})).length,0);
  assert.deepEqual(f.calls,[]);assert.equal(preferences,0);assert.equal(f.actions.proposals.get('browser').proposal,f.proposal);
  await f.run(text);assert.deepEqual(f.calls,[],'no automatic retry or consumption');
 });
}
for(const text of ['https://example.com/dashboard','Open https://example.com/dashboard','visit https://example.com/dashboard','Go to https://example.com/dashboard','Navigate to https://example.com/dashboard','Please open https://EXAMPLE.com:443/dashboard','example.com/dashboard','Open example.com/dashboard','Open "https://example.com/dashboard"' ]){
 test(`exact authored destination can dispatch once: ${text}`,async()=>{const f=fixture();assert.equal((await f.run(text)).length,1);assert.deepEqual(f.calls,['browser']);});
}
test('query and fragment are exact permission, never inferred from a matching hostname',async()=>{
 const url='https://example.com/dashboard?q=a%2Fb&x=1#section';const f=fixture(url);await f.run('Open '+url);assert.deepEqual(f.calls,['browser']);
 for(const proposed of ['https://example.com/dashboard','https://example.com/dashboard?q=a%2Fb&x=2#section','https://example.com/dashboard?q=a%2Fb&x=1#other']){const wrong=fixture(proposed);await wrong.run('Open '+url);assert.deepEqual(wrong.calls,[]);}
});
test('no proof on legacy callers, foreign request, workflow, ask-first or cancellation bypasses review',async()=>{
 const legacy=fixture();await legacy.run();assert.deepEqual(legacy.calls,[]);
 const foreign=fixture(undefined,'older-request');await foreign.run('Open https://example.com/dashboard');assert.deepEqual(foreign.calls,[]);
 const workflow=fixture();workflow.proposal.workflow={};await workflow.run('Open https://example.com/dashboard');assert.deepEqual(workflow.calls,[]);
 const ask=fixture();await ask.run('Open https://example.com/dashboard',async()=>false);assert.deepEqual(ask.calls,[]);
 const cancelled=fixture(),controller=new AbortController();controller.abort();await assert.rejects(cancelled.run('Open https://example.com/dashboard',async()=>true,controller.signal));assert.deepEqual(cancelled.calls,[]);
});
test('an operation changed during preference read cannot acquire a different destination',async()=>{
 const f=fixture();await f.run('Open https://example.com/dashboard',async()=>{f.proposal.operation.url='https://example.com/invented';return true;});assert.deepEqual(f.calls,[]);
});
test('uncertain execution is not retried or followed by another action',async()=>{
 const f=fixture();f.actions.proposals.set('second',{proposal:{requestMessageId:'request',operation:{type:'create_note'}}});f.actions.approve=async id=>{f.calls.push(id);return {proposalId:id,status:'unknown'};};await f.run('Open https://example.com/dashboard');assert.deepEqual(f.calls,['browser']);
});

test('foreign proof and retired proof never authorize an automatic browser effect',async()=>{
 const f=fixture(),signal=new AbortController().signal;
 await f.actions.performRequested('request',{},signal,async()=>true,undefined,{messageId:'other',text:'Open example.com/dashboard',current:()=>{}});assert.deepEqual(f.calls,[]);
 await assert.rejects(f.actions.performRequested('request',{},signal,async()=>true,undefined,{messageId:'request',text:'Open example.com/dashboard',current:()=>{throw Error('Retired request');}}),/Retired request/);assert.deepEqual(f.calls,[]);
});
test('one current authored command cannot auto-open duplicate proposals or duplicate callbacks',async()=>{
 const f=fixture();f.actions.proposals.set('duplicate',{proposal:{requestMessageId:'request',operation:{...f.proposal.operation}}});
 await f.run('Open example.com/dashboard');await f.run('Open example.com/dashboard');assert.deepEqual(f.calls,['browser']);
});
test('concurrent callbacks recheck the consumed browser attempt after preference reads',async()=>{
 const f=fixture();let release;const preference=new Promise(resolve=>{release=resolve;});
 const one=f.run('Open example.com/dashboard',()=>preference),two=f.run('Open example.com/dashboard',()=>preference);release(true);await Promise.all([one,two]);assert.deepEqual(f.calls,['browser']);
});

test('A to B to A does not repeat an older request even when its proof remains live',async()=>{
 const f=fixture(undefined,'A'),signal=new AbortController().signal;
 const run=id=>{f.proposal.requestMessageId=id;f.actions.proposals.get('browser').requestKey=f.actions.requestKey(id);return f.actions.performRequested(id,{},signal,async()=>true,undefined,{messageId:id,text:'Open example.com/dashboard',current:()=>{}});};
 await run('A');await run('B');await run('A');assert.deepEqual(f.calls,['browser','browser']);assert.equal(f.actions.browserAttempts.size,2);
});
test('128 live consumed proofs are not evicted, while definitively retired proofs can be pruned',async()=>{
 const full=fixture();for(let i=0;i<128;i++)full.actions.browserAttempts.set(String(i),{messageId:String(i),text:'Open example.com/',current:()=>{}});
 await full.run('Open example.com/dashboard');assert.deepEqual(full.calls,[]);assert.equal(full.actions.browserAttempts.size,128);
 const pruned=fixture();for(let i=0;i<128;i++)pruned.actions.browserAttempts.set(String(i),{messageId:String(i),text:'Open example.com/',current:()=>{if(i===0)throw Error('Retired');}});
 await pruned.run('Open example.com/dashboard');assert.deepEqual(pruned.calls,['browser']);assert.equal(pruned.actions.browserAttempts.size,128);assert.equal(pruned.actions.browserAttempts.has('0'),false);
});

test('final shared grammar keeps host punctuation, literal path punctuation and apostrophes precise',async()=>{
 const host=fixture('https://example.com/');await host.run('Open example.com.');assert.deepEqual(host.calls,['browser']);
 const literal="https://example.com/o'hare?q=can't#part",apostrophe=fixture(literal);await apostrophe.run('Open "'+literal+'"');assert.deepEqual(apostrophe.calls,['browser']);
 const exact=fixture('https://example.com/dashboard.');await exact.run('Open https://example.com/dashboard.');assert.deepEqual(exact.calls,['browser']);
 const invented=fixture('https://example.com/dashboard');await invented.run('Open https://example.com/dashboard.');assert.deepEqual(invented.calls,[]);
});
test('multiline or control-delimited source content never grants browser permission',async()=>{
 for(const text of ['Open example.com\nPlease read this page','\tOpen https://example.com/dashboard','Open\thttps://example.com/dashboard']){const f=fixture();await f.run(text);assert.deepEqual(f.calls,[]);}
});
