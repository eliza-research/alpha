import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {build} from 'esbuild';
// Upstream's escalation service posts "Eliza needs attention" into client chat for any repeated
// error (a Notes state the resident could not read at start produced one per boot), and history
// replays every stored copy. Alpha shows at most the latest notice, only while it can be true.
const ts=source=>stripTypeScriptTypes(source,{mode:'transform'});
const bundle=await build({entryPoints:['apps/app/src/runtime/action-message-presentation.ts'],bundle:true,platform:'node',format:'esm',write:false});
const notices=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const {systemNoticeText}=await import('data:text/javascript;base64,'+Buffer.from(ts(fs.readFileSync('vendor/eliza/packages/core/src/types/system-notice.ts','utf8'))).toString('base64'));
const {collapseSystemNotices,systemNoticeKind,systemNoticeDisplayText,MODEL_UNAVAILABLE_NOTICE,RUNTIME_ERROR_NOTICE,RUNTIME_ERROR_BACKGROUND_NOTICE}=notices;
const ui=fs.readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8'),adapter=fs.readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
const notice=(id,kind='runtime-error')=>({id,from:'agent',text:systemNoticeDisplayText(kind),systemNotice:kind});
const user=(id,text='hi')=>({id,from:'user',text}),reply=(id,text='Hello')=>({id,from:'agent',text});

test('the recognized texts are byte-equal to the pinned upstream systemNoticeText()',()=>{
 assert.equal(notices.UPSTREAM_RUNTIME_ERROR_NOTICE,systemNoticeText('runtime-error'));
 assert.equal(notices.UPSTREAM_MODEL_UNAVAILABLE_NOTICE,systemNoticeText('model-unavailable'));
 for(const kind of ['runtime-error','model-unavailable','model-and-runtime-error'])assert.equal(systemNoticeKind(systemNoticeText(kind)),kind);
 assert.equal(systemNoticeKind('Eliza needs attention.'),undefined,'only the exact notice is recognized');
 assert.equal(systemNoticeKind(undefined),undefined);
});

test('the runtime-error copy names an owner step, not the host operator diagnostics',()=>{
 for(const copy of [RUNTIME_ERROR_NOTICE,RUNTIME_ERROR_BACKGROUND_NOTICE])assert.doesNotMatch(copy,/host|diagnostics|—/);
 assert.match(RUNTIME_ERROR_NOTICE,/Nothing was resent/);
 assert.doesNotMatch(RUNTIME_ERROR_BACKGROUND_NOTICE,/may not arrive|resent/,'nothing was waiting, so nothing is said about a reply');
 assert.equal(systemNoticeDisplayText('runtime-error'),RUNTIME_ERROR_BACKGROUND_NOTICE);
 assert.equal(systemNoticeDisplayText('runtime-error',true),RUNTIME_ERROR_NOTICE);
 assert.equal(systemNoticeDisplayText('model-and-runtime-error'),`${MODEL_UNAVAILABLE_NOTICE}\n${RUNTIME_ERROR_BACKGROUND_NOTICE}`,'a combined notice keeps both halves');
});

test('model-unavailable display is product-neutral while raw protocol recognition and stored bytes remain intact',()=>{
 assert.match(MODEL_UNAVAILABLE_NOTICE,/AI provider in Settings/);
 for(const kind of ['model-unavailable','runtime-error','model-and-runtime-error'])assert.doesNotMatch(systemNoticeDisplayText(kind),/Eliza|connected host|host's diagnostics/);
 const original=[user('u1'),{id:'m1',from:'agent',text:systemNoticeText('model-unavailable'),systemNotice:'model-unavailable'}],saved=structuredClone(original);
 const shown=collapseSystemNotices(original);
 assert.equal(shown.find(m=>m.id==='m1').text,MODEL_UNAVAILABLE_NOTICE);
 assert.deepEqual(original,saved,'presentation must never rewrite stored notice bytes');
 assert.equal(systemNoticeKind(systemNoticeText('model-unavailable')),'model-unavailable');
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

test('restored history marks saved interrupted replies as unfinished',()=>{
 const restored=ui.slice(ui.indexOf('function restoredMessages('),ui.indexOf('\n}\n',ui.indexOf('function restoredMessages(')));
 const run=new Function('systemNoticeKind','systemNoticeDisplayText','restoredText',ts(restored.replace(/:RestoredMessage\[\]/,'').replace(/items:Record<string,unknown>\[\]/,'items')+'\n}')+';return restoredMessages;')(systemNoticeKind,systemNoticeDisplayText,text=>text);
 const rows=run([{id:'u1',role:'user',text:'hi'},{id:'a1',role:'assistant',text:'',interrupted:true},{id:'a2',role:'assistant',text:'Half',interrupted:true},{id:'n1',role:'assistant',text:systemNoticeText('runtime-error')}]);
 assert.deepEqual(rows.map(m=>[m.id,m.unfinished===true,m.systemNotice]),[['u1',false,undefined],['a1',true,undefined],['a2',true,undefined],['n1',false,'runtime-error']]);
 assert.deepEqual(collapseSystemNotices(rows).map(m=>m.id),['u1','a1','a2','n1'],'after a reload, a failed turn keeps its notice');
});

test('a live proactive copy after the collapse is not appended again, and unchanged input is returned as is',()=>{
 const merge=new Function(ts(ui.slice(ui.indexOf('export function mergeConversationDelivery'),ui.indexOf('\n}\n',ui.indexOf('export function mergeConversationDelivery'))).replace('export ','')+'\n}')+';return mergeConversationDelivery;')();
 const shown=collapseSystemNotices([user('u1'),notice('n1'),notice('n2')]);
 assert.deepEqual(shown.map(m=>m.id),['u1','n2']);
 const again=collapseSystemNotices(merge(shown,[notice('n3')]));
 assert.deepEqual(again.map(m=>m.id),['u1','n3'],'still one notice');
 assert.equal(collapseSystemNotices(again),again,'an already collapsed list is returned as is');
 const plain=[user('u1'),reply('a1')];assert.equal(collapseSystemNotices(plain),plain);
});

test('history and live delivery both mark notices and collapse them before rendering',()=>{
 const restored=ui.slice(ui.indexOf('function restoredMessages('),ui.indexOf('\n}\n',ui.indexOf('function restoredMessages(')));
 assert.match(restored,/const notice=item\.role==='assistant'\?systemNoticeKind\(item\.text\):undefined;/);
  assert.match(adapter,/msgs:collapseSystemNotices\(mergeConversationDelivery\(messages,newer\)\)/);
 assert.match(adapter,/const msgs=collapseSystemNotices\(mergeConversationDelivery\(previous\.msgs,messages\)\);/);
 assert.match(adapter,/const shownNotices=collapseSystemNotices\(live\);/,'a reply sent after the notice hides it at render time');
});
