import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkTraces as check} from '../specs/quint/refinement/check-traces.mjs';
import {bundledSource, captureSources, boundInputs, trace, checkpoint, call, deferred} from '../specs/quint/refinement/application/support.mjs';

const driver='test/quint-calendar-approval-review.test.mjs';
captureSources([driver]);
const id='11111111-2222-4333-8444-555555555555';
const dto=extra=>({id,subjectUserId:'owner',state:'pending',action:'cancel_event',
  payload:{action:'cancel_event',side:'owner',calendarId:'primary',eventId:'event',notifyAttendees:false},
  reason:'Synthetic Calendar review.',expiresAt:'2099-01-01T00:00:00.000Z',updatedAt:'2026-11-10T12:00:00.000Z',...extra});

async function checkCalendarApprovalReview(extraSources=[]) {
  captureSources(extraSources);
  const source='apps/app/src/runtime/calendar-approval-client.ts',loaded=await bundledSource(source),traces=[];
  for(const options of [
    {name:'approve',kind:'succeeded'},{name:'reject',decision:'reject',kind:'rejected'},
    ...['invalidated','retryable','blocked'].map(kind=>({name:kind,kind})),
    {name:'lost-decision',lost:true},{name:'bad-receipt-id',bad:'requestId'},
    {name:'bad-receipt-decision',bad:'decision'},{name:'bad-receipt-kind',bad:'kind'},
    {name:'copied-row',copy:true},{name:'concurrent-tap',double:true},
    {name:'retired-before-tap',retire:'before'},{name:'retired-decision-reply',retire:'decision'},
    {name:'retired-read-reply',retire:'read'}, {name:'read-owner-A-B-A',retire:'read-aba'},
    {name:'aborted-before-tap',abort:'before'},{name:'aborted-decision-reply',abort:'decision'},
    {name:'terminal-row',row:{state:'done'}},{name:'expired-row',row:{expiresAt:'2000-01-01T00:00:00.000Z'}},
    {name:'foreign-row',row:{subjectUserId:'other'}},{name:'missing-row',missing:true},
    ...['id','revision','payload','reason','owner','state','expiry'].map(mutate=>({name:'mutated-'+mutate,mutate,
      ...(mutate==='owner'?{row:{subjectUserId:'other'}}:mutate==='state'?{row:{state:'done'}}:mutate==='expiry'?{row:{expiresAt:'2000-01-01T00:00:00.000Z'}}:{})})),
    {name:'post-dispatch-row-mutation',mutate:'id',mutateAfter:true},
  ]) {
    let epoch=0,readEpoch=-1,reading=false,inFlight=false,row,readSnapshot,matched=false,posts=0,decision='none',returned='none';
    const controller=new AbortController(),readReply=deferred(),decisionReply=deferred(),raw=dto(options.row);
    const client=new loaded.exports.CalendarApprovalClient(signal=>{
      const captured=readEpoch=epoch;
      return {ownerId:'owner',current(){signal.throwIfAborted();if(epoch!==captured)throw Error('Retired connection');},
        async request(path,body,_signal,headers,method){
          if(body===undefined)return readReply.promise;
          assert.equal(path,`/api/approvals/${id}/resolve`);assert.equal(method,'POST');assert.deepEqual(headers,{});
          assert.deepEqual(body,{decision:options.decision??'approve',revision:row.revision});
          posts++;decision=body.decision;matched=JSON.stringify(row)===readSnapshot&&row.ownerVerified&&row.state==='pending'&&Date.parse(row.expiresAt)>Date.now();record('exact read admission is consumed before the typed POST',call('decide',decision));
          return decisionReply.promise;
        }};
    });
    const observe=()=>({'s.epoch':epoch,'s.readEpoch':readEpoch,'s.reading':reading,
      's.admitted':!!row&&client.reads.has(row),'s.pending':!!row&&row.ownerVerified&&row.state==='pending'&&Date.parse(row.expiresAt)>Date.now(),
      's.aborted':controller.signal.aborted,'s.unchanged':!row||JSON.stringify(row)===readSnapshot,'s.matched':matched,
      's.inFlight':inFlight,'s.dispatches':posts,'s.decision':decision,'s.returned':returned});
    const t=trace(options.name,observe()),record=(label,action)=>checkpoint(t,label,action,observe());
    const retire=()=>{epoch++;record('captured owner/conversation/context retires',call('retire'));};
    const abort=()=>{controller.abort();record('foreground or read signal aborts',call('abort'));};
    const mutate=()=>{
      if(options.mutate==='id')row.id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      else if(options.mutate==='revision')row.revision='changed revision';
      else if(options.mutate==='payload')row.payload.calendarId='other-calendar';
      else if(options.mutate==='reason')row.reason='Different visible action';
      else if(options.mutate==='owner')row.ownerVerified=true;
      else if(options.mutate==='state')row.state='pending';
      else row.expiresAt='2099-01-01T00:00:00.000Z';
      record('the same row object no longer matches its authenticated read bytes',call('mutate',!!row.ownerVerified&&row.state==='pending'&&Date.parse(row.expiresAt)>Date.now()));
    };
    reading=true;const readingTask=client.read(id,controller.signal);record('authenticated read captures its exact connection',call('read'));
    if(options.retire?.startsWith('read')){retire();if(options.retire==='read-aba')retire();}
    readReply.resolve({approvals:options.missing?[]:[raw]});
    try{row=await readingTask;readSnapshot=row?JSON.stringify(row):undefined;reading=false;returned=row?'read':'missing';record('only current authenticated read publishes its exact row',call('readReply',!!row,!!row&&row.ownerVerified&&row.state==='pending'&&Date.parse(row.expiresAt)>Date.now()));}
    catch{reading=false;returned='error';record('late read publishes no admitted row',call('readFailed'));traces.push(t);continue;}
    if(options.retire==='before')retire();if(options.abort==='before')abort();
    if(options.mutate&&!options.mutateAfter)mutate();
    const chosen=options.copy?{...row}:row;
    inFlight=true;const resolving=client.resolve(chosen,options.decision??'approve',controller.signal);
    if(posts===0){await assert.rejects(resolving);inFlight=false;record('copied, foreign, terminal, expired or retired row cannot dispatch',call('refused',!options.copy));traces.push(t);continue;}
    if(options.double){await assert.rejects(client.resolve(row,'approve',controller.signal));record('concurrent tap has no second read admission',call('refused',true));}
    if(options.mutateAfter)mutate();
    if(options.retire==='decision')retire();if(options.abort==='decision')abort();
    if(options.lost)decisionReply.reject(Error('Controlled transport loss'));
    else {
      const receipt={requestId:id,decision:options.decision??'approve',kind:options.kind??'succeeded',text:'Synthetic finite result'};
      if(options.bad)receipt[options.bad]=options.bad==='kind'?'invented':'wrong';
      decisionReply.resolve(receipt);
    }
    try{const result=await resolving;returned=result.kind;}catch{returned='error';}
    inFlight=false;record('only a current finite matching receipt publishes',call('result',returned));
    await assert.rejects(client.resolve(row,options.decision??'approve',controller.signal));
    record('settled or uncertain decisions cannot reuse the consumed row',call('refused',true));
    assert.equal(posts,1);traces.push(t);
  }
  return check(boundInputs({model:'CalendarApprovalReview',sources:[source,...loaded.sources,driver,...extraSources],traces,scope:'bounded-component',assumptions:[
    'The actual typed client, approval DTO parser, exact row WeakMap and finite receipt parser execute; connection and authenticated transport are controlled ports.',
    'One read admission and one proposal revision. Epoch retirement represents connection, owner, conversation or context retirement; AbortSignal represents hide/background.',
    'The DOM review reread/presentation comparison, server revision CAS, Calendar effect and provider outcome are separate contracts. A POST proves dispatch only, not a real Calendar change.']}));
}

test('typed Calendar decisions consume one exact current read and never replay uncertainty',{timeout:scaledTimeout(120000)},async()=>{
 const receipt=await checkCalendarApprovalReview(['test/quint-calendar-approval-review.test.mjs']);
 assert.ok(receipt.passed&&receipt.inputsUnchanged&&receipt.driverInputsBound);
 assert.equal(receipt.traces,29);
 const last=Object.fromEntries(receipt.traceInputs.map(t=>[t.name,t.steps.at(-1).expect]));
 assert.equal(last['lost-decision']['s.dispatches'],1);
 assert.equal(last['retired-read-reply']['s.admitted'],false);
 assert.equal(last['retired-decision-reply']['s.returned'],'error');
 assert.equal(last['copied-row']['s.dispatches'],0);
 assert.equal(last['mutated-revision']['s.dispatches'],0);
 assert.equal(last['mutated-owner']['s.dispatches'],0);
 assert.equal(last['post-dispatch-row-mutation']['s.returned'],'succeeded');
});
