import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['apps/app/src/runtime/action-message-presentation.ts'],bundle:true,platform:'node',format:'esm',write:false});
const notices=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const {collapseSystemNotices,systemNoticeDisplayText,MODEL_UNAVAILABLE_NOTICE,RUNTIME_ERROR_NOTICE,RUNTIME_ERROR_BACKGROUND_NOTICE}=notices;
const notice=(id,kind='runtime-error')=>({id,from:'agent',text:systemNoticeDisplayText(kind),systemNotice:kind});
const user=(id,text='hi')=>({id,from:'user',text}),reply=(id,text='Hello')=>({id,from:'agent',text});

test('the runtime-error copy names an owner step, not the host operator diagnostics',()=>{
 for(const copy of [RUNTIME_ERROR_NOTICE,RUNTIME_ERROR_BACKGROUND_NOTICE])assert.doesNotMatch(copy,/host|diagnostics|—/);
 assert.match(RUNTIME_ERROR_NOTICE,/Send again/);
 assert.doesNotMatch(RUNTIME_ERROR_BACKGROUND_NOTICE,/may not arrive|resent/,'nothing was waiting, so nothing is said about a reply');
 assert.equal(systemNoticeDisplayText('runtime-error'),RUNTIME_ERROR_BACKGROUND_NOTICE);
 assert.equal(systemNoticeDisplayText('runtime-error',true),RUNTIME_ERROR_NOTICE);
 assert.equal(systemNoticeDisplayText('model-and-runtime-error'),`${MODEL_UNAVAILABLE_NOTICE}\n${RUNTIME_ERROR_BACKGROUND_NOTICE}`,'a combined notice keeps both halves');
 for(const waiting of [false,true])assert.equal(systemNoticeDisplayText('model-and-runtime-error',waiting).match(/Open Settings/g).length,1,'a combined notice gives one recovery step');
});

test('replayed history with four identical notices and a normal reply shows no notice',()=>{
 const history=[notice('n1'),notice('n2'),user('u1'),notice('n3'),notice('n4'),reply('a1')];
 assert.deepEqual(collapseSystemNotices(history).map(m=>m.id),['u1','a1']);
 const model=[notice('m1','model-unavailable'),user('u1'),reply('a1')];
 assert.deepEqual(collapseSystemNotices(model).map(m=>m.id),['u1','a1'],'a later reply proves the model answered');
});

test('notices with no later reply collapse to the latest one, worded for whether the owner was waiting',()=>{
 const text=(rows,id)=>collapseSystemNotices(rows).find(m=>m.id===id)?.text;
 const waiting=[reply('a0'),user('u1'),notice('n1'),notice('n2'),notice('n3'),notice('n4')];
 assert.deepEqual(collapseSystemNotices(waiting).map(m=>m.id),['a0','u1','n4']);
 assert.equal(text(waiting,'n4'),RUNTIME_ERROR_NOTICE,'it arrived while u1 was unanswered');
 const background=[user('u1'),reply('a1'),notice('n1'),notice('n2'),notice('n3'),notice('n4')];
 assert.deepEqual(collapseSystemNotices(background).map(m=>m.id),['u1','a1','n4'],'a background failure still shows once');
 assert.equal(text(background,'n4'),RUNTIME_ERROR_BACKGROUND_NOTICE);
 assert.deepEqual(collapseSystemNotices([notice('n1'),notice('n2')]).map(m=>m.id),['n2'],'a boot-time escalation shows once, calmly');
 const model=[user('u1'),reply('a1'),notice('m1','model-unavailable'),notice('m2','model-unavailable')];
 assert.deepEqual(collapseSystemNotices(model).map(m=>m.id),['u1','a1','m2'],'model-unavailable blocks the next turn, so it shows once');
});

test('a stale escalation before a new send is never worded as if that send failed',()=>{
 const rows=[reply('a0'),notice('n1'),user('u1')];
 const shown=collapseSystemNotices(rows);
 assert.deepEqual(shown.map(m=>m.id),['a0','n1','u1']);
 assert.equal(shown[1].text,RUNTIME_ERROR_BACKGROUND_NOTICE,'n1 came before u1, so it says nothing about u1');
 assert.deepEqual(collapseSystemNotices([...rows,reply('a1')]).map(m=>m.id),['a0','u1','a1'],'the reply retires it');
});

test('failed, unfinished, streaming, card and phone receipt rows do not prove chat works',()=>{
 const rows=[user('u1'),{id:'x',from:'agent',text:'This reply did not finish.',interrupted:true},notice('n1')];
 assert.deepEqual(collapseSystemNotices(rows).map(m=>m.id),['u1','x','n1'],'a live interrupted reply');
 for(const row of [{id:'x',from:'agent',text:'This reply did not finish.',unfinished:true},{id:'x',from:'agent',text:'Partial',streaming:true},{id:'x',from:'agent',text:'Open browser destination https://a.example',card:{proposalId:'p'}},{id:'x',from:'agent',text:'Reminder set for 9:00.',deviceReceipt:true}])
  assert.deepEqual(collapseSystemNotices([user('u1'),notice('n1'),row]).map(m=>m.id),['u1','n1','x'],JSON.stringify(row));
});
