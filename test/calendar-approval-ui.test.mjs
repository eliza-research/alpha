import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {projectActionMessages} from '../apps/app/src/runtime/action-message-presentation.ts';
import {calendarReviewText,inboxChoiceText,calendarApprovalFromList,calendarApprovalPending,calendarApprovalStatus} from '../apps/app/src/runtime/calendar-approval.ts';
import {calendarApprovalFields} from '../apps/app/src/prototype/calendar-approval-fields.ts';
import {setLocalePreferences} from '../apps/app/src/prototype/locale-time.ts';
const id='11111111-2222-4333-8444-555555555555';
const block=`[CHOICE:approval-${id} id=${id}]\napprove ${id}=Approve\nreject ${id}=Deny\n[/CHOICE]`;
const dto=(extra={})=>({id,subjectUserId:'owner',state:'pending',action:'cancel_event',payload:{action:'cancel_event',side:'owner',calendarId:'owner@example.invalid',eventId:'exact-event',notifyAttendees:false},reason:'Remove the disposable event.',expiresAt:'2099-01-01T00:00:00Z',updatedAt:'2026-10-15T00:00:00Z',...extra});
const row=(extra={})=>calendarApprovalFromList({approvals:[dto(extra)]},id,'owner');
test('only complete, exact Calendar approval markup gets presentation metadata',()=>{
 assert.deepEqual(calendarReviewText('Please review.\n'+block),{displayText:'Please review.',ids:[id]});
 const ordinary='  An indented reply.\n\n\tSecond paragraph.  \n';
 assert.deepEqual(calendarReviewText(ordinary),{displayText:ordinary,ids:[]});
 for(const text of [block.replace('id='+id,'id=other'),block.replace('reject '+id+'=Deny','other=Other'),block.replace('approve '+id+'=Approve','approve '+id+'X'),block.replace('approval-','example-')])assert.deepEqual(calendarReviewText(text),{displayText:text,ids:[]});
});
test('inbox queue choices show as prose only; malformed blocks stay literal',async()=>{
 const {appendInboxTriageChoiceMarkers,appendInboxDraftChoiceMarker}=await import('data:text/javascript;base64,'+Buffer.from((await build({entryPoints:['vendor/eliza/plugins/plugin-inbox/src/actions/choice-markers.ts'],bundle:true,platform:'node',format:'esm',write:false})).outputFiles[0].text).toString('base64'));
 const triage=appendInboxTriageChoiceMarkers('Two threads need you.',[{id:'t1',senderName:'Ada'},{id:'t2',channelName:'#ops'}]);
 assert.match(triage,/\[CHOICE:inbox-thread-t1 id=t1\]/);
 assert.equal(inboxChoiceText(triage),'Two threads need you.');
 assert.equal(inboxChoiceText(appendInboxDraftChoiceMarker('Draft ready.','d1')),'Draft ready.');
 const ordinary='  An indented reply.\n\n\tSecond paragraph.  \n';assert.equal(inboxChoiceText(ordinary),ordinary);
 for(const text of ['[CHOICE:inbox-thread-t1 id=t2]\ninbox reply t1=Reply\n[/CHOICE]','[CHOICE:inbox-thread-t1 id=t1]\ninbox reply t2=Reply\n[/CHOICE]','[CHOICE:inbox-thread-t1 id=t1]\nno separator\n[/CHOICE]','[CHOICE:inbox-thread-t1 id=t1]\ninbox reply t1=Reply'])assert.equal(inboxChoiceText(text),text,text);
 // An approval block alongside inbox choices still yields its review.
 const both=calendarReviewText('Review the event.\n'+block+'\n[CHOICE:inbox-thread-t1 id=t1]\ninbox archive t1=Archive\n[/CHOICE]');
 assert.deepEqual(both.ids,[id]);assert.equal(inboxChoiceText(both.displayText),'Review the event.');
});
test('foreign, duplicate, malformed and non-Calendar approvals do not authorize a review',()=>{
 const foreign=calendarApprovalFromList({approvals:[dto({subjectUserId:'another-owner'})]},id,'owner');assert.equal(foreign.ownerVerified,false);assert.equal(calendarApprovalPending(foreign),false);
 const canonical=calendarApprovalFromList({ownerEntityId:id,approvals:[dto({subjectUserId:id})]},id,'paired-session-principal');assert.equal(calendarApprovalPending(canonical),true,'a server-projected canonical entity can differ from the paired session principal');
 assert.equal(calendarApprovalFromList({approvals:[dto(),dto()]},id,'owner'),null);
 for(const extra of [{expiresAt:'invalid'},{action:'device_action'},{state:'unknown'},{payload:{action:'cancel_event',side:'agent',calendarId:'calendar'}}])assert.equal(row(extra),null);
 for(const state of ['approved','executing','retryable','reconciliation_required','done','rejected','expired'])assert.equal(calendarApprovalPending(row({state})),false);
 assert.equal(calendarApprovalStatus(row({state:'executing'})),'Change not confirmed');assert.equal(calendarApprovalStatus(row({state:'done'})),'Review closed');
 assert.equal(calendarApprovalPending(row({expiresAt:'2020-01-01T00:00:00Z'})),false);
});
test('approval fields show local time, exact effect fields and readable source labels without JSON',()=>{
 const prior=process.env.TZ;process.env.TZ='America/New_York';setLocalePreferences({locale:'en-GB',hourCycle:'h23'});
 try{
  const request=row({action:'schedule_event',reason:'Add lunch on 2026-11-10T18:00:00.000Z.',payload:{action:'schedule_event',side:'owner',calendarId:'opaque',title:'Lunch',startsAtMs:Date.parse('2026-11-10T18:00:00Z'),endsAtMs:Date.parse('2026-11-10T19:00:00Z'),timeZone:'Europe/London',attendees:[{email:'ada@example.invalid',displayName:'Ada',optional:true}],location:'Cafe',description:'Bring notes',notifyAttendees:true}});
  const shown=calendarApprovalFields(request,{calendar:'Personal',account:'owner@example.invalid'}),fields=Object.fromEntries(shown.fields.map(f=>[f.label,f.value]));
  assert.equal(shown.complete,true);assert.equal(shown.heading,'Add event');assert.equal(fields.Calendar,'Personal');assert.equal(fields.Account,'owner@example.invalid');assert.match(fields.Starts,/13:00/);assert.doesNotMatch(shown.reason,/18:00:00.*Z/);assert.equal(fields['Event time zone'],'Europe/London');assert.equal(fields['Notify guests'],'Yes');assert.match(fields.Guests,/Ada.*ada@example.invalid.*optional/);
  const allDay=calendarApprovalFields(row({action:'schedule_event',payload:{...request.payload,allDay:{startDate:'2026-11-10',endDateExclusive:'2026-11-12'}}}));assert.match(allDay.fields.find(f=>f.label==='Date').value,/10 November 2026.*11 November 2026/);assert.equal(allDay.fields.find(f=>f.label==='Time').value,'All day');
 }finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;setLocalePreferences();}
});
test('unknown effect fields and malformed event times cannot be approved as a readable review',()=>{
 for(const payload of [{...dto().payload,unrecognizedEffect:true},{action:'schedule_event',side:'owner',calendarId:'primary',title:'Event',startsAtMs:1,endsAtMs:0}])assert.equal(calendarApprovalFields(row({payload,action:payload.action})).complete,false);
});
test('an opaque cancel or modify target without a verified current event cannot be approved',()=>{
 assert.equal(calendarApprovalFields(row()).complete,false);
 const current={event:'Meeting',eventStartsAt:Date.parse('2026-11-11T18:00:00Z'),eventEndsAt:Date.parse('2026-11-11T19:00:00Z'),targetVerified:true};
 assert.equal(calendarApprovalFields(row(),current).complete,true);
 assert.equal(calendarApprovalFields(row(),{...current,targetVerified:false}).complete,false);
 assert.equal(calendarApprovalFields(row({payload:{...dto().payload,expectedEventStartAtMs:current.eventStartsAt+86400000}}),current).complete,false,'a different recurrence date is not the reviewed target');
 const change=row({action:'modify_event',payload:{...dto().payload,action:'modify_event',patch:{title:'Changed',startsAtMs:null,endsAtMs:null,location:null,description:null,attendees:null}}});
 assert.equal(calendarApprovalFields(change).complete,false);assert.equal(calendarApprovalFields(change,current).complete,true);
 const dates=calendarApprovalFields(row(),{...current,eventStartsAt:Date.parse('2026-11-10T00:00:00Z'),eventEndsAt:Date.parse('2026-11-12T00:00:00Z'),eventAllDay:true});assert.equal(dates.fields.find(field=>field.label==='Current time').value,'All day');assert.match(dates.fields.find(field=>field.label==='Current dates').value,/10.*11/);
});
const bundle=await build({entryPoints:['apps/app/src/prototype/calendar-approval-review.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {reviewCalendarApproval:mountedReview}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const targetFacts={calendar:'Personal',event:'Disposable event',eventStartsAt:Date.parse('2026-10-14T18:00:00Z'),eventEndsAt:Date.parse('2026-10-14T19:00:00Z'),targetVerified:true};
const reviewCalendarApproval=(...args)=>mountedReview(...args,()=>targetFacts);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function dom(){const env=new JSDOM('<div class="os"></div>',{pretendToBeVisual:true});globalThis.window=env.window;globalThis.document=env.window.document;globalThis.getComputedStyle=env.window.getComputedStyle.bind(env.window);env.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};return ()=>{env.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.getComputedStyle;};}
const button=name=>[...document.querySelectorAll('button')].find(b=>b.textContent===name);
test('a changed request needs a fresh human choice; only the exact pending row is returned',async()=>{
 const cleanup=dom();try{let reads=0,result='waiting';const original=row(),changed=row({reason:'Changed request',updatedAt:'2026-10-15T00:01:00Z'});const promise=reviewCalendarApproval(async()=>++reads===1?original:changed,new AbortController().signal,()=>{},()=>{}).then(v=>result=v);await tick();button('Approve').click();await tick();assert.equal(result,'waiting');assert.match(document.querySelector('[role=status]').textContent,/Updated/);button('Approve').click();await promise;assert.equal(result.decision,'approve');assert.equal(result.request.revision,changed.revision);assert.equal(reads,3);}finally{cleanup();}
});
test('a missing current target disables destructive approval while keeping Decline available',async()=>{
 const cleanup=dom();try{const promise=mountedReview(async()=>row(),new AbortController().signal,()=>{},()=>{});await tick();assert.equal(button('Approve').disabled,true);assert.equal(button('Decline').disabled,false);assert.match(document.body.textContent,/could not be verified/);button('Decline').click();assert.equal((await promise).decision,'reject');}finally{cleanup();}
});
test('a foreign queue row exposes no request details or decision controls',async()=>{
 const cleanup=dom();try{const promise=reviewCalendarApproval(async()=>row({subjectUserId:'another-owner',reason:'Foreign private event'}),new AbortController().signal,()=>{},()=>{});await tick();assert.equal(button('Approve').hidden,true);assert.equal(button('Decline').hidden,true);assert.equal(document.querySelector('dl').hidden,true);assert.equal(document.body.textContent.includes('Foreign private event'),false);button('Close').click();assert.equal(await promise,null);}finally{cleanup();}
});
test('an executing request offers no approval or decline, and Close returns no decision',async()=>{
 const cleanup=dom();try{const promise=reviewCalendarApproval(async()=>row({state:'executing',reason:'Cancel "Exact title" on 2026-10-14T18:00:00.000Z without sending attendee notifications.'}),new AbortController().signal,()=>{},()=>{});await tick();assert.equal(button('Approve').hidden,true);assert.equal(button('Decline').hidden,true);assert.equal(document.querySelector('[role=status]').textContent,'Change not confirmed');assert.equal(document.body.textContent.includes('2026-10-14T18:00:00'),false);assert.doesNotMatch(document.body.textContent,/Decline this request/);assert.match(document.body.textContent,/Exact title/);button('Close').click();assert.equal(await promise,null);}finally{cleanup();}
});
test('closing during a delayed status read cannot revive a request',async()=>{
 const cleanup=dom();try{let release,updates=0;const pending=new Promise(resolve=>release=resolve);const promise=reviewCalendarApproval(()=>pending,new AbortController().signal,()=>{},()=>updates++);button('Close').click();assert.equal(await promise,null);release(row());await tick();assert.equal(document.querySelector('dialog'),null);assert.equal(updates,0);}finally{cleanup();}
});
test('a context change at the confirmation tap returns no approval',async()=>{
 const cleanup=dom();try{let changed=false;const promise=reviewCalendarApproval(async()=>row(),new AbortController().signal,()=>{if(changed)throw Error('Owner changed');},()=>{});await tick();changed=true;button('Approve').click();await tick();assert.equal(button('Approve').hidden,true);assert.match(document.querySelector('[role=status]').textContent,/Owner changed/);button('Close').click();assert.equal(await promise,null);}finally{cleanup();}
});
const adapterBundle=await build({entryPoints:['apps/app/src/prototype/calendar-approval-adapter.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'review-controller-port',setup(b){b.onResolve({filter:/\/(connection-ui|alpha-client)$/},args=>({path:args.path.split('/').at(-1),namespace:'review-port'}));b.onLoad({filter:/.*/,namespace:'review-port'},args=>({loader:'js',contents:args.path==='connection-ui'?'export const connectionController={getSnapshot:()=>globalThis.calendarReviewAdapterFixture.snapshot,getAppRecordClient:()=>globalThis.calendarReviewAdapterFixture.port,readCalendarApproval:async(id,signal)=>{signal.throwIfAborted();const f=globalThis.calendarReviewAdapterFixture;f.reads++;return f.row;},resolveCalendarApproval:async(row,decision,signal)=>{signal.throwIfAborted();const f=globalThis.calendarReviewAdapterFixture;f.resolutions.push({row,decision});return f.resolve?f.resolve(row,decision,signal):{requestId:row.id,decision,kind:decision==="reject"?"rejected":"succeeded",text:decision==="reject"?"Calendar change declined. Nothing was changed.":"Completed Calendar cancel event."};}};':'export const alphaClient={getState:()=>({context:globalThis.calendarReviewAdapterFixture.context})};'}));}}]});
const {installCalendarApprovalAdapter}=await import('data:text/javascript;base64,'+Buffer.from(adapterBundle.outputFiles[0].text).toString('base64'));
function adapterFixture(project=rows=>rows){const fixture={snapshot:{session:{sessionId:'session',ownerId:'owner',agentId:'agent'},history:{conversationId:'conversation'},open:false,busy:false},context:{view:'home',revision:1,sensitive:false},row:row(),port:{current:()=>true,identity:{origin:'http://resident.invalid',ownerId:'owner',agentId:'agent'}},reads:0,resolutions:[],sent:[],toasts:[]};globalThis.calendarReviewAdapterFixture=fixture;
 class Shell{live=true;agentCalendar={state:{ownerKey:JSON.stringify(['http://resident.invalid','owner','agent']),status:'ready',savedAt:null,calendars:[{provider:'eliza',side:'owner',grantId:'',calendarId:'owner@example.invalid',summary:'Personal'}],feed:{events:[{provider:'eliza',side:'owner',grantId:'',calendarId:'owner@example.invalid',externalId:'exact-event',title:'Disposable event',startAt:'2026-10-14T18:00:00Z',endAt:'2026-10-14T19:00:00Z'}]}}};st={msgs:[{id:'message',from:'agent',text:'Review the event.\n'+block},{id:'literal-user',from:'user',text:block}],draft:'',typing:false};S(){return this.st;}renderVals(){return {msgs:project(this.st.msgs.map(m=>({...m,c:m.card,cGeneric:!!m.card,isAgent:m.from==='agent',isUser:m.from==='user',displayText:m.text,calendarReviews:[],messageActionsLabel:'Message actions: '+m.text})),this.st.msgs)};}setState(p){Object.assign(this.st,p);}toast(text){fixture.toasts.push(text);}async send(text){fixture.sent.push(text);}componentWillUnmount(){}}
 installCalendarApprovalAdapter(Shell);return {fixture,shell:new Shell()};}
test('restored markup is inert; the explicit verified choice sends one typed decision and no chat message',async()=>{
 const cleanup=dom();let shell;try{const setup=adapterFixture();shell=setup.shell;const f=setup.fixture;for(let n=0;n<30;n++)shell.renderVals();assert.equal(f.reads,0);assert.equal(f.sent.length,0);let view=shell.renderVals();assert.equal(view.msgs[0].displayText,'Review the event.');assert.equal(shell.st.msgs[0].text,'Review the event.\n'+block,'stored source is unchanged');assert.equal(view.msgs[1].displayText,block,'literal user text stays literal');assert.equal(view.msgs[1].calendarReviews.length,0);
 view.msgs[0].calendarReviews[0].open();await tick();assert.equal(f.reads,1);assert.equal(f.sent.length,0);button('Approve').click();await tick();assert.equal(f.reads,2);assert.equal(f.sent.length,0);assert.deepEqual(f.resolutions,[{row:f.row,decision:'approve'}]);assert.equal(shell.renderVals().msgs[0].calendarReviews[0].status,'Completed Calendar cancel event.');assert.equal(shell.renderVals().msgs[0].calendarReviews[0].canOpen,true);
 }finally{shell?.componentWillUnmount();delete globalThis.calendarReviewAdapterFixture;cleanup();}
});
test('an inbox triage reply renders prose only and offers no inbox commands',()=>{
 const {shell}=adapterFixture();
 try{const text='Two threads need you.\n[CHOICE:inbox-thread-t1 id=t1]\ninbox reply t1=Reply to Ada\ninbox snooze t1=Snooze\ninbox archive t1=Archive\n[/CHOICE]';shell.st.msgs=[{id:'triage',from:'agent',text}];const shown=shell.renderVals().msgs[0];assert.equal(shown.displayText,'Two threads need you.');assert.equal(shown.messageActionsLabel,'Message actions: Two threads need you.');assert.deepEqual(shown.calendarReviews,[]);assert.equal(shell.st.msgs[0].text,text,'stored source is unchanged');}
 finally{shell.componentWillUnmount();delete globalThis.calendarReviewAdapterFixture;}
});
test('an existing chat draft is never replaced by a Calendar review',async()=>{
 const cleanup=dom();let shell;try{const setup=adapterFixture();shell=setup.shell;shell.st.draft='Keep my current words';shell.renderVals().msgs[0].calendarReviews[0].open();await tick();assert.equal(setup.fixture.reads,0);assert.equal(setup.fixture.sent.length,0);assert.equal(shell.st.draft,'Keep my current words');assert.equal(document.querySelector('dialog'),null);}finally{shell?.componentWillUnmount();delete globalThis.calendarReviewAdapterFixture;cleanup();}
});

test('an open message edit keeps its draft and no Calendar decision is sent or marked',async()=>{
 const cleanup=dom();let shell;try{const setup=adapterFixture();shell=setup.shell;shell.messageEditTarget={messageId:'m'};shell.renderVals().msgs[0].calendarReviews[0].open();await tick();assert.equal(setup.fixture.reads,0);assert.equal(setup.fixture.sent.length,0);assert.deepEqual(setup.fixture.toasts,['Finish editing first']);assert.equal(shell.renderVals().msgs[0].calendarReviews[0].status,'');}finally{shell?.componentWillUnmount();delete globalThis.calendarReviewAdapterFixture;cleanup();}
});

test('private content prevents status reads and decision messages',async()=>{
 const cleanup=dom();let shell;try{const setup=adapterFixture();shell=setup.shell;setup.fixture.context.sensitive=true;shell.renderVals().msgs[0].calendarReviews[0].open();await tick();assert.equal(setup.fixture.reads,0);assert.equal(setup.fixture.sent.length,0);assert.equal(document.querySelector('dialog'),null);}finally{shell?.componentWillUnmount();delete globalThis.calendarReviewAdapterFixture;cleanup();}
});
test('lost typed decision reply stays unconfirmed and never creates a prompt or automatically retries',async()=>{
 const cleanup=dom();let shell;try{const setup=adapterFixture();shell=setup.shell;const f=setup.fixture;f.resolve=async()=>{throw Error('Network lost');};shell.renderVals().msgs[0].calendarReviews[0].open();await tick();button('Approve').click();await tick();assert.equal(f.resolutions.length,1);assert.equal(f.sent.length,0);assert.match(shell.renderVals().msgs[0].calendarReviews[0].status,/not confirmed/);await tick();assert.equal(f.resolutions.length,1);}finally{shell?.componentWillUnmount();delete globalThis.calendarReviewAdapterFixture;cleanup();}
});
test('a late typed decision result cannot update another conversation',async()=>{
 const cleanup=dom();let shell;try{const setup=adapterFixture();shell=setup.shell;const f=setup.fixture;let resolve;f.resolve=()=>new Promise(done=>resolve=done);shell.renderVals().msgs[0].calendarReviews[0].open();await tick();button('Approve').click();await tick();f.snapshot.history={conversationId:'another'};resolve({requestId:id,decision:'approve',kind:'succeeded',text:'Completed'});await tick();assert.equal(f.sent.length,0);assert.equal(f.resolutions.length,1);assert.equal(shell.renderVals().msgs[0].calendarReviews[0].status,'');assert.equal(shell.renderVals().msgs[0].calendarReviews[0].canOpen,false);}finally{shell?.componentWillUnmount();delete globalThis.calendarReviewAdapterFixture;cleanup();}
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
