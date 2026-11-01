import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
// Upstream's escalation service posts "Eliza needs attention" into client chat for any repeated
// error (a Notes state the resident could not read at start produced one per boot), and history
// replays every stored copy. Alpha shows at most the latest notice, only while it can be true.
const ts=source=>stripTypeScriptTypes(source,{mode:'transform'});
const notices=await import('data:text/javascript;base64,'+Buffer.from(ts(fs.readFileSync('apps/app/src/runtime/system-notices.ts','utf8'))).toString('base64'));
const {systemNoticeText}=await import('data:text/javascript;base64,'+Buffer.from(ts(fs.readFileSync('vendor/eliza/packages/core/src/types/system-notice.ts','utf8'))).toString('base64'));
const {collapseSystemNotices,systemNoticeKind,systemNoticeDisplayText,RUNTIME_ERROR_NOTICE}=notices;
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
 assert.doesNotMatch(RUNTIME_ERROR_NOTICE,/host|diagnostics|—/);
 assert.match(RUNTIME_ERROR_NOTICE,/Nothing was resent/);
 assert.equal(systemNoticeDisplayText('model-and-runtime-error'),systemNoticeText('model-unavailable'),'a combined notice shows its chat-blocking half once');
});

test('replayed history with four identical notices and a normal reply shows no notice',()=>{
 const history=[notice('n1'),notice('n2'),user('u1'),notice('n3'),notice('n4'),reply('a1')];
 assert.deepEqual(collapseSystemNotices(history).map(m=>m.id),['u1','a1']);
 const model=[notice('m1','model-unavailable'),user('u1'),reply('a1')];
 assert.deepEqual(collapseSystemNotices(model).map(m=>m.id),['u1','a1'],'a later reply proves the model answered');
});

test('notices with no later reply collapse to the latest one, a runtime error only while the owner waits',()=>{
 const waiting=[reply('a0'),user('u1'),notice('n1'),notice('n2'),notice('n3'),notice('n4')];
 assert.deepEqual(collapseSystemNotices(waiting).map(m=>m.id),['a0','u1','n4']);
 const background=[user('u1'),reply('a1'),notice('n1'),notice('n2'),notice('n3'),notice('n4')];
 assert.deepEqual(collapseSystemNotices(background).map(m=>m.id),['u1','a1'],'a background failure after a working reply is not a chat bubble');
 assert.deepEqual(collapseSystemNotices([notice('n1'),notice('n2')]).map(m=>m.id),[],'a boot-time escalation with nothing asked stays out of chat');
 const model=[user('u1'),reply('a1'),notice('m1','model-unavailable'),notice('m2','model-unavailable')];
 assert.deepEqual(collapseSystemNotices(model).map(m=>m.id),['u1','a1','m2'],'model-unavailable blocks the next turn, so it shows once');
 const failed=[user('u1'),{id:'x',from:'agent',text:'This reply did not finish.',interrupted:true},notice('n1')];
 assert.deepEqual(collapseSystemNotices(failed).map(m=>m.id),['u1','x','n1'],'an interrupted reply does not prove chat works');
});

test('a live proactive copy after the collapse is not appended again, and unchanged input is returned as is',()=>{
 const merge=new Function(ts(ui.slice(ui.indexOf('export function mergeConversationDelivery'),ui.indexOf('\n}\n',ui.indexOf('export function mergeConversationDelivery'))).replace('export ','')+'\n}')+';return mergeConversationDelivery;')();
 const shown=collapseSystemNotices([user('u1'),notice('n1'),notice('n2')]);
 assert.deepEqual(shown.map(m=>m.id),['u1','n2']);
 const again=collapseSystemNotices(merge(shown,[notice('n3')]));
 assert.deepEqual(again.map(m=>m.id),['u1','n3'],'still one notice');
 const plain=[user('u1'),reply('a1')];assert.equal(collapseSystemNotices(plain),plain);
});

test('history and live delivery both mark notices and collapse them before rendering',()=>{
 const restored=ui.slice(ui.indexOf('function restoredMessages('),ui.indexOf('\n}\n',ui.indexOf('function restoredMessages(')));
 assert.match(restored,/const notice=item\.role==='assistant'\?systemNoticeKind\(item\.text\):undefined;/);
 assert.match(restored,/if\(notice\)return \{id:item\.id,from:'agent',text:systemNoticeDisplayText\(notice\),systemNotice:notice\};/);
 assert.match(adapter,/msgs:collapseSystemNotices\(mergeConversationDelivery\(messages,newer\)\)/);
 assert.match(adapter,/const msgs=collapseSystemNotices\(mergeConversationDelivery\(previous\.msgs,messages\)\);/);
 assert.match(adapter,/const shownNotices=collapseSystemNotices\(live\);/,'a reply sent after the notice hides it at render time');
});
