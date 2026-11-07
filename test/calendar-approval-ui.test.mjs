import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {projectActionMessages} from '../apps/app/src/runtime/action-message-presentation.ts';
import {calendarReviewText,calendarApprovalFromList,calendarApprovalPending,calendarApprovalStatus,calendarApprovalCommand} from '../apps/app/src/runtime/calendar-approval.ts';
const id='11111111-2222-4333-8444-555555555555';
const block=`[CHOICE:approval-${id} id=${id}]\napprove ${id}=Approve\nreject ${id}=Deny\n[/CHOICE]`;
const dto=(extra={})=>({id,subjectUserId:'owner',state:'pending',action:'cancel_event',payload:{action:'cancel_event',side:'owner',calendarId:'owner@example.invalid',eventId:'exact-event'},reason:'Remove the disposable event.',expiresAt:'2099-01-01T00:00:00Z',updatedAt:'2026-10-15T00:00:00Z',...extra});
const row=(extra={})=>calendarApprovalFromList({approvals:[dto(extra)]},id,'owner');
test('only complete, exact Calendar approval markup gets presentation metadata',()=>{
 assert.deepEqual(calendarReviewText('Please review.\n'+block),{displayText:'Please review.',ids:[id]});
 const ordinary='  An indented reply.\n\n\tSecond paragraph.  \n';
 assert.deepEqual(calendarReviewText(ordinary),{displayText:ordinary,ids:[]});
 for(const text of [block.replace('id='+id,'id=other'),block.replace('reject '+id+'=Deny','other=Other'),block.replace('approve '+id+'=Approve','approve '+id+'X'),block.replace('approval-','example-')])assert.deepEqual(calendarReviewText(text),{displayText:text,ids:[]});
});
test('foreign, duplicate, malformed and non-Calendar approvals do not authorize a review',()=>{
 const foreign=calendarApprovalFromList({approvals:[dto({subjectUserId:'another-owner'})]},id,'owner');assert.equal(foreign.ownerVerified,false);assert.equal(calendarApprovalPending(foreign),false);assert.throws(()=>calendarApprovalCommand(foreign,'approve'));
 const canonical=calendarApprovalFromList({ownerEntityId:id,approvals:[dto({subjectUserId:id})]},id,'paired-session-principal');assert.equal(calendarApprovalPending(canonical),true,'a server-projected canonical entity can differ from the paired session principal');
 assert.equal(calendarApprovalFromList({approvals:[dto(),dto()]},id,'owner'),null);
 for(const extra of [{expiresAt:'invalid'},{action:'device_action'},{state:'unknown'},{payload:{action:'cancel_event',side:'agent',calendarId:'calendar'}}])assert.equal(row(extra),null);
 for(const state of ['approved','executing','retryable','reconciliation_required','done','rejected','expired']){const value=row({state});assert.equal(calendarApprovalPending(value),false);assert.throws(()=>calendarApprovalCommand(value,'approve'));}
 assert.equal(calendarApprovalStatus(row({state:'executing'})),'Change not confirmed');assert.equal(calendarApprovalStatus(row({state:'done'})),'Review closed');
 assert.equal(calendarApprovalPending(row({expiresAt:'2020-01-01T00:00:00Z'})),false);
});
const bundle=await build({entryPoints:['apps/app/src/prototype/calendar-approval-review.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {reviewCalendarApproval}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function dom(){const env=new JSDOM('<div class="os"></div>',{pretendToBeVisual:true});globalThis.window=env.window;globalThis.document=env.window.document;globalThis.getComputedStyle=env.window.getComputedStyle.bind(env.window);env.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};return ()=>{env.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.getComputedStyle;};}
const button=name=>[...document.querySelectorAll('button')].find(b=>b.textContent===name);
test('a changed request needs a fresh human choice; only the exact pending row is returned',async()=>{
 const cleanup=dom();try{let reads=0,result='waiting';const original=row(),changed=row({reason:'Changed request',updatedAt:'2026-10-15T00:01:00Z'});const promise=reviewCalendarApproval(async()=>++reads===1?original:changed,new AbortController().signal,()=>{},()=>{}).then(v=>result=v);await tick();button('Approve').click();await tick();assert.equal(result,'waiting');assert.match(document.querySelector('[role=status]').textContent,/changed/);button('Approve').click();await promise;assert.equal(result.decision,'approve');assert.equal(result.request.revision,changed.revision);assert.equal(reads,3);}finally{cleanup();}
});
test('an executing request offers no approval or decline, and Close returns no decision',async()=>{
 const cleanup=dom();try{const promise=reviewCalendarApproval(async()=>row({state:'executing',reason:'Cancel "Exact title" on 2026-10-14T18:00:00.000Z without sending attendee notifications.'}),new AbortController().signal,()=>{},()=>{});await tick();assert.equal(button('Approve').hidden,true);assert.equal(button('Decline').hidden,true);assert.equal(document.querySelector('[role=status]').textContent,'Change not confirmed');assert.equal(document.body.textContent.includes('2026-10-14T18:00:00'),false);assert.match(document.body.textContent,/UTC/);assert.match(document.body.textContent,/Exact title/);button('Close').click();assert.equal(await promise,null);}finally{cleanup();}
});
test('closing during a delayed status read cannot revive a request',async()=>{
 const cleanup=dom();try{let release,updates=0;const pending=new Promise(resolve=>release=resolve);const promise=reviewCalendarApproval(()=>pending,new AbortController().signal,()=>{},()=>updates++);button('Close').click();assert.equal(await promise,null);release(row());await tick();assert.equal(document.querySelector('dialog'),null);assert.equal(updates,0);}finally{cleanup();}
});
test('a context change at the confirmation tap returns no approval',async()=>{
 const cleanup=dom();try{let changed=false;const promise=reviewCalendarApproval(async()=>row(),new AbortController().signal,()=>{if(changed)throw Error('Owner changed');},()=>{});await tick();changed=true;button('Approve').click();await tick();assert.equal(button('Approve').hidden,true);assert.match(document.querySelector('[role=status]').textContent,/Owner changed/);button('Close').click();assert.equal(await promise,null);}finally{cleanup();}
});
const adapterBundle=await build({entryPoints:['apps/app/src/prototype/calendar-approval-adapter.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'review-controller-port',setup(b){b.onResolve({filter:/\/(connection-ui|alpha-client)$/},args=>({path:args.path.split('/').at(-1),namespace:'review-port'}));b.onLoad({filter:/.*/,namespace:'review-port'},args=>({loader:'js',contents:args.path==='connection-ui'?'export const connectionController={getSnapshot:()=>globalThis.calendarReviewAdapterFixture.snapshot,readCalendarApproval:async(id,signal)=>{signal.throwIfAborted();const f=globalThis.calendarReviewAdapterFixture;f.reads++;return f.row;}};':'export const alphaClient={getState:()=>({context:globalThis.calendarReviewAdapterFixture.context})};'}));}}]});
const {installCalendarApprovalAdapter}=await import('data:text/javascript;base64,'+Buffer.from(adapterBundle.outputFiles[0].text).toString('base64'));
function adapterFixture(project=rows=>rows){const fixture={snapshot:{session:{sessionId:'session',ownerId:'owner',agentId:'agent'},history:{conversationId:'conversation'},open:false,busy:false},context:{view:'home',revision:1,sensitive:false},row:row(),reads:0,sent:[],toasts:[]};globalThis.calendarReviewAdapterFixture=fixture;
 class Shell{live=true;st={msgs:[{id:'message',from:'agent',text:'Review the event.\n'+block},{id:'literal-user',from:'user',text:block}],draft:'',typing:false};S(){return this.st;}renderVals(){return {msgs:project(this.st.msgs.map(m=>({...m,c:m.card,cGeneric:!!m.card,isAgent:m.from==='agent',isUser:m.from==='user',displayText:m.text,calendarReviews:[],messageActionsLabel:'Message actions: '+m.text})),this.st.msgs)};}setState(p){Object.assign(this.st,p);}toast(text){fixture.toasts.push(text);}async send(text){fixture.sent.push(text);}componentWillUnmount(){}}
 installCalendarApprovalAdapter(Shell);return {fixture,shell:new Shell()};}
test('rendering restored markup does no requests or sends; explicit verified choice sends only its exact command',async()=>{
 const cleanup=dom();let shell;try{const setup=adapterFixture();shell=setup.shell;const f=setup.fixture;for(let n=0;n<30;n++)shell.renderVals();assert.equal(f.reads,0);assert.equal(f.sent.length,0);let view=shell.renderVals();assert.equal(view.msgs[0].displayText,'Review the event.');assert.equal(shell.st.msgs[0].text,'Review the event.\n'+block,'stored source is unchanged');assert.equal(view.msgs[1].displayText,block,'literal user text stays literal');assert.equal(view.msgs[1].calendarReviews.length,0);
 view.msgs[0].calendarReviews[0].open();await tick();assert.equal(f.reads,1);assert.equal(f.sent.length,0);button('Approve').click();await tick();assert.equal(f.reads,2);assert.equal(f.sent.length,1);assert.equal(f.sent[0],calendarApprovalCommand(f.row,'approve'));assert.equal(f.sent[0].includes('do not create another request'),true);
 }finally{shell?.componentWillUnmount();delete globalThis.calendarReviewAdapterFixture;cleanup();}
});
test('an existing chat draft is never replaced by a Calendar review',async()=>{
 const cleanup=dom();let shell;try{const setup=adapterFixture();shell=setup.shell;shell.st.draft='Keep my current words';shell.renderVals().msgs[0].calendarReviews[0].open();await tick();assert.equal(setup.fixture.reads,0);assert.equal(setup.fixture.sent.length,0);assert.equal(shell.st.draft,'Keep my current words');assert.equal(document.querySelector('dialog'),null);}finally{shell?.componentWillUnmount();delete globalThis.calendarReviewAdapterFixture;cleanup();}
});

test('private content prevents status reads and decision messages',async()=>{
 const cleanup=dom();let shell;try{const setup=adapterFixture();shell=setup.shell;setup.fixture.context.sensitive=true;shell.renderVals().msgs[0].calendarReviews[0].open();await tick();assert.equal(setup.fixture.reads,0);assert.equal(setup.fixture.sent.length,0);assert.equal(document.querySelector('dialog'),null);}finally{shell?.componentWillUnmount();delete globalThis.calendarReviewAdapterFixture;cleanup();}
});

test('Calendar markup projection preserves completed device receipts and their accessible text',()=>{
 const {shell}=adapterFixture(projectActionMessages);
 try {
  const summary='This action already has a device journal entry. Review action history; it was not repeated.';
  shell.st.msgs=[{id:'request',from:'user',text:'Repeat this same request'}, {id:'review',from:'agent',text:'Ask Clock to set an alarm.',card:{proposalId:'clock-proposal',done:true,title:'Not completed',sub:summary}}, {id:'device-receipt:clock-proposal',from:'agent',text:summary,deviceReceipt:true}];
  const stored=structuredClone(shell.st.msgs),shown=shell.renderVals().msgs;
  assert.deepEqual(shown.map(message=>message.id),['request','review']);
  assert.equal(shown[1].displayText,summary);
  assert.equal(shown[1].messageActionsLabel,'Message actions: '+summary);
  assert.deepEqual(shown[1].calendarReviews,[]);
  assert.deepEqual(shell.st.msgs,stored);
 }finally{shell.componentWillUnmount();delete globalThis.calendarReviewAdapterFixture;}
});
