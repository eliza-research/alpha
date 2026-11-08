// Actual typed client over loopback HTTP plus a durable-journal contract fixture.
// Android journal persistence is verified separately by native instrumentation.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
if (!process.execArgv.includes('--experimental-transform-types')) process.exit(spawnSync(process.execPath, ['--experimental-transform-types', process.argv[1]], { stdio: 'inherit' }).status ?? 1);
const { DeviceActions, FOREGROUND_OPERATION_TYPES } = await import('../apps/app/src/runtime/device-actions.ts');
const { DEVICE_REVIEW_TYPES: FOREGROUND_REVIEW_TYPES } = await import('../.eliza/client-features/packages/contracts/src/device-reviews.ts');
const { calendarAvailability } = await import('../.eliza/client-features/packages/contracts/src/device-reviews.ts');
const session = { ownerId: 'owner', agentId: 'agent', origin: 'https://agent.example', sessionId: 'session' };
const credential = { installationId: 'device', enrollmentId: 'enrollment', key: 'a'.repeat(64) };
let state = 'pending', attemptId, effects = 0, mode = 'ok', claims = 0;
const digest = 'b'.repeat(64), records = new Map();
const proposal = () => ({ id: 'proposal', digest, state, subjectUserId: 'owner', requestedBy: 'agent', action: 'device_action', expiresAt: new Date(Date.now()+600000).toISOString(), payload: { action: 'device_action', version: 1, installationId: 'device', enrollmentId: 'enrollment', operation: { type: 'create_note', title: 'Fixture note', body: 'Explicit reviewed body' } }, execution: attemptId ? { attemptId } : null });
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const data = body ? JSON.parse(body) : null;
  let status = 200;
  if (req.url.endsWith('/decision')) { assert.equal(data.digest, digest); state = data.decision === 'approve' ? 'approved' : 'rejected'; }
  if (req.url.endsWith('/claim')) { claims++; assert.equal(state, 'approved'); state = 'executing'; attemptId = 'attempt'; if (mode === 'lost-claim') status = 503; }
  if (req.url.endsWith('/receipt')) { assert.equal(data.attemptId, 'attempt'); if (mode === 'receipt-outage') status=503; else state=data.receipt.outcome === 'applied' ? 'done' : 'reconciliation_required'; }
  if (req.url.endsWith('/reconciliation')) { assert.equal(data.resolution.confirmed,true); state = data.resolution.outcome === 'applied' ? 'done' : 'retryable'; }
  res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(req.method === 'GET' ? { proposals: [proposal()] } : { proposal: proposal(), digest }));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const request = async (path, body, signal) => { const res=await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method:body===undefined?'GET':'POST', body:body===undefined?undefined:JSON.stringify(body), signal }); if(!res.ok) throw new Error('Synthetic outage'); return res.json(); };
const journal = {
 reserve: async input => { const existing=records.get(input.proposalId); if(existing) return {created:false,entry:existing}; const entry={...input,phase:'reserved'};records.set(input.proposalId,entry);return {created:true,entry}; },
 markApplying: async input => { const e=records.get(input.proposalId);assert.equal(e.phase,'reserved');Object.assign(e,{phase:'applying',attemptId:input.attemptId}); },
 finish: async input => { const e=records.get(input.proposalId);assert.equal(e.phase,'applying');Object.assign(e,input,{phase:'terminal'}); },
 list: async () => ({entries:[...records.values()]}), get:async input=>({entry:records.get(input.proposalId)||null}),
};
const make=()=>new DeviceActions(session,credential,'c'.repeat(64),request,journal,async()=>{assert.equal(records.get('proposal').phase,'applying');effects++;return {status:'succeeded',summary:'Saved fixture note'};});
const context={view:'notes',revision:2,sensitive:false}, reordered={view:'notes',sensitive:false,revision:2};
const signal=()=>new AbortController().signal;
// Pending review: every proposal is parsed and screen-checked on its own.
async function reviewNoticesAndForeground(){
 assert.deepEqual([...FOREGROUND_OPERATION_TYPES].sort(),[...FOREGROUND_REVIEW_TYPES].sort());
 const target={sourceId:'notes',sourceRevision:'d'.repeat(64),noteId:'note-1',revision:'e'.repeat(64)};
 const tuesday={type:'calendar_availability',start:'2026-10-13T19:00:00.000Z',end:'2026-10-13T20:00:00.000Z',timeZone:'America/New_York'};
 const make=(id,operation,extra={})=>({id,digest,state:'pending',subjectUserId:'owner',requestedBy:'agent',action:'device_action',expiresAt:new Date(Date.now()+600000).toISOString(),payload:{action:'device_action',version:1,installationId:'device',enrollmentId:'enrollment',operation},execution:null,...extra});
 let listed=[],posted=[],state={};
 const request=async(path,body)=>{
  if(body===undefined)return {proposals:listed};
  posted.push({path,body});const id=path.split('/')[4],p=listed.find(item=>item.id===id);
  if(path.endsWith('/claim'))state[id]='executing';else if(path.endsWith('/decision'))state[id]='approved';else if(path.endsWith('/receipt'))state[id]='done';
  return {proposal:{...p,state:state[id],execution:{attemptId:'attempt'}},digest};
 };
 const entries=new Map();
 const memory={reserve:async input=>{if(entries.has(input.proposalId))return {created:false,entry:entries.get(input.proposalId)};const entry={...input,phase:'reserved'};entries.set(input.proposalId,entry);return {created:true,entry};},markApplying:async input=>Object.assign(entries.get(input.proposalId),{phase:'applying',attemptId:input.attemptId}),finish:async input=>Object.assign(entries.get(input.proposalId),input,{phase:'terminal'}),list:async()=>({entries:[...entries.values()]}),get:async input=>({entry:entries.get(input.proposalId)||null})};
 const capabilities=['notes.local-record.v1','calendar.local-event.v1','calendar.availability-read.v1','notes.search.v1','device.named-target.v1'];
 let foregroundCalls=[];
 const foreground=async(operation,operationId,context,signal,bindingHash,journal)=>{foregroundCalls.push({operation,journal,bindingHash});assert.equal(entries.get(journal.proposalId).phase,'applying');
  if(operation.type==='calendar_availability')return {status:'succeeded',summary:'Free',foregroundResult:calendarAvailability(operation,2,[{start:'2026-10-13T18:30:00.000Z',end:'2026-10-13T19:30:00.000Z',allDay:false,availability:'free'}])};
  return {status:'failed',summary:'Cancelled. Nothing was shared.'};};
 const client=(caps=capabilities,executor=foreground)=>new DeviceActions(session,{...credential,capabilities:caps},'f'.repeat(64),request,memory,async()=>{throw Error('Device executor must not run foreground reviews');},undefined,false,false,executor);
 const home={view:'home',revision:4,sensitive:false,timeZone:'America/New_York'};
 // A selected-note action requested from Home is not silently dropped.
 listed=[make('note-delete',{type:'notes_delete',target}),make('open',{type:'open_view',view:'notes'}),
  {...make('foreign',{type:'open_view',view:'home'}),subjectUserId:'someone-else'},make('broken',{type:'not_a_device_operation'}),
  make('finished-broken',{type:'not_a_device_operation'},{state:'done'}),make('expired-broken',{type:'not_a_device_operation'},{expiresAt:new Date(Date.now()-1000).toISOString()})];
 const reviewClient=client();const review=await reviewClient.pendingReview(home,signal());
 assert.deepEqual(review.filter(item=>item.proposal).map(item=>item.proposal.id),['note-delete','open'],'navigation-only review does not hide valid siblings');
 const notices=review.filter(item=>!item.proposal).map(item=>item.notice);
 assert.equal(notices.length,2,'two invalid pending proposals; completed or expired invalid history stays quiet');
 assert.equal(review[0].proposal.reviewDestination,'notes');
 const staleReview=await reviewClient.approve('note-delete',home,signal());assert.equal(staleReview.status,'unknown');assert.equal(posted.length,0,'navigation-only card cannot dispatch approval');
 assert.ok(notices.every(notice=>/could not be shown on this phone/.test(notice)));
 assert.ok(!notices.join('\n').includes(target.noteId),'notices never expose record identities');
 assert.deepEqual((await client().pending(home,signal())).map(card=>card.id),['note-delete','open']);
 // pending() still fails when nothing is reviewable and a proposal was invalid.
 listed=[{...make('foreign',{type:'open_view',view:'home'}),subjectUserId:'someone-else'}];
 await assert.rejects(client().pending(home,signal()),/another identity/);
 listed=[make('note-delete',{type:'notes_delete',target})];
 assert.equal((await client().pending(home,signal()))[0].reviewDestination,'notes');
 assert.equal((await client().pendingReview({...home,sensitive:true},signal()))[0].notice,'Delete selected note: Unlock the phone to review this action.');
 // Foreground availability: Home or Calendar, after approval, outside workflow bindings.
 listed=[make('free-busy',tuesday),make('named',{type:'notes_named',action:'delete',name:'Groceries'}),make('search',{type:'notes_search',query:{kind:'content',text:'passport'}})];
 const settings={view:'settings',revision:5,sensitive:false,timeZone:'America/New_York'};
 const away=await client().pendingReview(settings,signal());
 assert.deepEqual(away.map(item=>item.notice),['Check availability: Open Home or Calendar to review this availability check.','Delete note by name: Return to Home to choose the record for this action.','Search notes: Open Home or Notes to review this Notes search.']);
 const calendarView=await client().pendingReview({...home,view:'calendar'},signal());
 assert.deepEqual(calendarView.map(item=>item.proposal?.id??item.notice),['free-busy','Delete note by name: Return to Home to choose the record for this action.','Search notes: Open Home or Notes to review this Notes search.']);
 // All-day days are the phone's local days: another zone is a notice, never an approvable card.
 const elsewhere=await client().pendingReview({...home,timeZone:'Europe/London'},signal());
 assert.equal(elsewhere[0].proposal,null);assert.equal(elsewhere[0].notice,'Check availability: This availability check used a different time zone. Ask again from this phone.');
 const actions=client(),cards=await actions.pending(home,signal());
 await assert.rejects(actions.approve('free-busy',{...home,timeZone:'Europe/London'},signal()));
 assert.deepEqual(cards.map(card=>card.title),['Check availability','Delete note by name','Search notes']);
 assert.match(cards[0].description,/You choose which calendars this phone reads\. Only busy times are shared/);
 assert.match(cards[1].description,/Find “Groceries” in Notes on this phone\. You choose the exact note/);
 await assert.rejects(actions.approve('free-busy',settings,signal()),/current screen/);
 const approved=await actions.approve('free-busy',home,signal());
 assert.equal(approved.status,'succeeded');assert.equal(foregroundCalls.length,1);
 const receipt=posted.find(item=>item.path.endsWith('free-busy/receipt')).body.receipt;
 assert.equal(receipt.outcome,'applied');assert.equal(receipt.result.status,'free');assert.equal(receipt.result.transparentIgnored,1);
 assert.deepEqual(entries.get('free-busy').result.foregroundResult,receipt.result);
 assert.ok(!JSON.stringify(receipt).includes('title'),'availability receipts carry no event content');
 // A failed local review returns no content and is journaled as failed.
 assert.equal((await actions.approve('named',home,signal())).status,'failed');
 assert.equal(posted.find(item=>item.path.endsWith('named/receipt')).body.receipt.outcome,'failed');
 // A forged result that widens the window never reaches the agent.
 const widened=async operation=>({status:'succeeded',summary:'x',foregroundResult:{...calendarAvailability(operation,1,[]),window:{start:operation.start,end:'2026-10-14T20:00:00.000Z',timeZone:operation.timeZone}}});
 entries.clear();state={};posted=[];listed=[make('free-busy',tuesday)];
 const forged=client(capabilities,widened);await forged.pending(home,signal());
 assert.equal((await forged.approve('free-busy',home,signal())).status,'unknown');
 assert.equal(posted.some(item=>item.path.endsWith('/receipt')),false);
 // Not negotiated, or no foreground executor: shown as a notice, never as an approvable card.
 for(const actionsWithout of [client(['notes.local-record.v1']),client(capabilities,null)]){
  const items=await actionsWithout.pendingReview(home,signal());
  assert.equal(items[0].proposal,null);assert.match(items[0].notice,/not negotiated/);
 }
}
async function executionIdentityAndRetirement(){
 const localProposal={...proposal(),state:'pending',execution:null};
 for(const field of ['scope','proposalId','operationId']){
  let requests=0,ran=0;
  const foreign={...journal,reserve:async input=>({created:true,entry:{...input,phase:'reserved',[field]:field==='scope'?'d'.repeat(64):'different'}})};
  const actions=new DeviceActions(session,credential,'c'.repeat(64),async()=>{requests++;return {proposals:[localProposal]};},foreign,async()=>{ran++;return {status:'succeeded',summary:'Must not run'};});
  await actions.pending(context,signal());const result=await actions.approve('proposal',context,signal());
  assert.equal(result.status,'unknown');assert.equal(requests,1,'foreign reservation is rejected before decision');assert.equal(ran,0);
 }
 const stopped=new AbortController();let ran=0,posts=0;
 const retiring={...journal,reserve:async input=>{stopped.abort();return {created:true,entry:{...input,phase:'reserved'}};}};
 const stoppedActions=new DeviceActions(session,credential,'c'.repeat(64),async(_path,body)=>{if(body)posts++;return {proposals:[localProposal]};},retiring,async()=>{ran++;return {status:'succeeded',summary:'Must not run'};});
 await stoppedActions.pending(context,signal());assert.equal((await stoppedActions.approve('proposal',context,stopped.signal)).status,'unknown');assert.equal(posts,0);assert.equal(ran,0);
 records.clear();state='pending';attemptId=undefined;mode='ok';const afterDispatch=new AbortController(),before=effects;
 const actions=new DeviceActions(session,credential,'c'.repeat(64),request,journal,async()=>{effects++;afterDispatch.abort();return {status:'succeeded',summary:'Known saved result'};});
 await actions.pending(context,signal());const known=await actions.approve('proposal',context,afterDispatch.signal);
 assert.equal(known.status,'succeeded');assert.match(known.summary,/Known saved result/);assert.equal(effects,before+1);assert.equal(records.get('proposal').phase,'terminal');assert.equal(records.get('proposal').status,'succeeded');
}
try {
 const client=make();const cards=await client.pending(context,signal());assert.equal(cards[0].title,'Create note');assert.equal(cards[0].description,'Create note\n“Fixture note”\nExplicit reviewed body');mode='receipt-outage';
 assert.equal((await client.approve('proposal',reordered,signal())).status,'succeeded');assert.equal(effects,1);assert.equal(state,'executing');
 mode='ok';await make().syncReceipts(signal());assert.equal(state,'done');assert.equal(effects,1);
 // Even a stale server pending response after restart cannot repeat a journaled effect.
 state='pending';const restarted=make();await restarted.pending(context,signal());assert.equal((await restarted.approve('proposal',context,signal())).status,'unknown');assert.equal(effects,1);
 records.clear();state='pending';attemptId=undefined;mode='lost-claim';const lost=make();await lost.pending(context,signal());await lost.approve('proposal',context,signal());assert.equal(effects,1);assert.equal(records.get('proposal').phase,'reserved');assert.equal(state,'executing');
 mode='ok';await make().reconcile('proposal','not_applied',signal());assert.equal(state,'retryable');assert.equal(effects,1);
 records.clear();state='pending';const stale=make();await stale.pending(context,signal());await assert.rejects(stale.approve('proposal',{...context,revision:3},signal()));assert.equal(records.size,0);
 await stale.reject('proposal',signal());assert.equal(state,'rejected');assert.equal(claims,2);
 await reviewNoticesAndForeground();
 await executionIdentityAndRetirement();
 console.log('PASS: device HTTP decision/claim/receipt, journal-before-effect, receipt recovery across client restart, no duplicate effect, lost-claim reconciliation, context property-order equality/stale rejection, explicit rejection; visible notices for context-mismatched proposals, per-proposal parse isolation, foreground availability/notes-search/named-target admission. Exact shared reservation identity rejects foreign scope/proposal/operation before decision; retirement prevents dispatch and preserves known durable results. Synthetic only.');
} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
