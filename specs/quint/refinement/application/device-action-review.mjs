import assert from 'node:assert/strict';
import {checkTraces as check} from '../check-traces.mjs';
import {bundledSource, captureSources, boundInputs, trace, checkpoint, call, deferred} from './support.mjs';

const driver = 'specs/quint/refinement/application/device-action-review.mjs';
captureSources([driver]);
const contextKey = value => JSON.stringify([value.view, value.sensitive === true, value.revision, value.timeZone ?? null, value.selectedObject ?? null]);

/** All effects are recording ports. The real coordinator parses, reviews, hashes, journals and claims. */
function fixture(DeviceActions, options = {}) {
  const f = {now: 1900000000000, context: {view:'home', revision:1, sensitive:false},
    decisions:0, claims:0, dispatches:0, receipts:0, returned:'none', synced:false, authority:'none',
    askBefore:false, bound:true, eligible:true,
    controller:new AbortController(), state:'pending', attempt:undefined, entry:undefined, inputs:[], execution:deferred()};
  const session = {ownerId:'owner', agentId:'agent', sessionId:'session', origin:'https://agent.invalid'};
  const credential = {installationId:'device', enrollmentId:'enrollment', key:'a'.repeat(64), capabilities:[]};
  const id = 'proposal-one', digest = 'b'.repeat(64), scope = 'c'.repeat(64), expires = f.now + 60000;
  const operation = options.operation ?? {type:'open_view', view:'notes'};
  f.reviewContext = structuredClone(f.context);
  const proposal = () => ({id, digest, state:f.state, subjectUserId:options.foreign ? 'foreign' : session.ownerId,
    requestedBy:session.agentId, action:'device_action', expiresAt:new Date(expires).toISOString(),
    payload:{version:1, action:'device_action', installationId:credential.installationId, enrollmentId:credential.enrollmentId,
      requestMessageId:f.bound ? 'message-one' : 'old-message', operation},
    ...(f.attempt ? {execution:{attemptId:f.attempt}} : {})});
  const observe = () => ({'s.card':f.client.proposals.has(id), 's.busy':f.client.busy,
    's.journal':f.entry?.phase ?? 'empty', 's.identity':!f.entry || f.entry.operationId === f.reservedId,
    's.current':contextKey(f.context) === contextKey(f.reviewContext), 's.sensitive':f.context.sensitive === true,
    's.expired':f.now >= expires, 's.aborted':f.controller.signal.aborted,
    's.askBefore':f.askBefore, 's.bound':f.bound, 's.eligible':f.eligible, 's.authority':f.authority,
    's.decisions':f.decisions, 's.claims':f.claims, 's.dispatches':f.dispatches, 's.receipts':f.receipts,
    's.status':f.entry?.status ?? 'none', 's.returned':f.returned, 's.synced':f.synced,
    's.admitted':f.admitted ?? false});
  const record = (label, action) => checkpoint(f.trace, label, action, observe());
  const request = async (path, body, signal) => {
    if (body === undefined) return {proposals:[proposal()]};
    if (path.endsWith('/decision')) {
      f.decisions++;record('actual approval decision request',call('decide'));
      if (options.failure === 'decision') throw Error('Controlled decision outage');
      f.state='approved';
    } else if (path.endsWith('/claim')) {
      f.claims++;record('actual execution claim request',call('claim'));
      if (options.failure === 'claim') return {proposal:proposal(),digest};
      f.state='executing';f.attempt='attempt-one';
    } else if (path.endsWith('/receipt')) {
      f.receipts++;record('receipt upload follows durable terminal result',call('upload'));
      if (options.failure === 'receipt' || signal.aborted) throw Error('Controlled receipt outage');
      f.state='done';f.synced=true;
    } else throw Error('Unexpected path '+path);
    return {proposal:proposal(),digest:options.failure === 'digest' ? 'd'.repeat(64) : digest};
  };
  const journal = {
    async get() {
      if (f.client.busy) {
        f.authority=f.direct ? 'request' : 'review';
        record('card consumed and busy taken before asynchronous journal lookup',call('begin',!!f.direct));
        if (f.holdLookup) await f.holdLookup.promise;
      }
      return {entry:f.entry};
    },
    async reserve(input) {
      f.inputs.push(input);
      if (options.failure === 'reserve') throw Error('Controlled reservation failure');
      if (f.entry) {record('existing durable effect is never admitted twice',call('existing'));return {created:false,entry:f.entry};}
      f.reservedId=input.operationId;f.entry={...input,phase:'reserved'};
      if (options.failure === 'identity') f.entry.operationId='foreign-operation';
      record('actual durable reservation',call('reserve',options.failure !== 'identity'));
      return {created:true,entry:f.entry};
    },
    async markApplying(input) {
      Object.assign(f.entry,{phase:'applying',attemptId:input.attemptId});
      record('durable applying marker precedes the executor',call('applying'));
      if (options.abort === 'before') {f.controller.abort();record('owner cancellation before executor entry',call('abort'));}
    },
    async finish(input) {
      Object.assign(f.entry,input,{phase:'terminal'});
      record('executor outcome stored before receipt upload',call('settle',input.status));
    },
    async list() {return {entries:f.entry ? [f.entry] : []};},
  };
  const execute = async (op, operationId, actualContext, signal) => {
    assert.deepEqual(op,operation);assert.equal(operationId,f.entry.operationId);
    assert.deepEqual(actualContext,f.reviewContext);assert.equal(signal.aborted,false);
    f.dispatches++;f.admitted=!signal.aborted && f.now < expires && contextKey(f.context) === contextKey(f.reviewContext);
    record('real coordinator calls its executor exactly once',call('dispatch'));
    if (options.abort === 'after') {f.controller.abort();record('post-dispatch cancellation preserves the effect outcome',call('abort'));}
    if (options.failure === 'executor') throw Error('Controlled executor uncertainty');
    return {status:options.outcome ?? 'succeeded',summary:'Controlled executor outcome'};
  };
  f.recreate=()=>{f.client=new DeviceActions(session,credential,scope,request,journal,execute);};f.recreate();
  f.observe=observe;f.record=record;f.id=id;
  f.trace=trace(options.name ?? 'reviewed',observe());
  f.configure=()=>{f.askBefore=options.askBefore ?? false;f.bound=options.bound ?? true;f.eligible=options.eligible ?? true;record('current preference and proposal request provenance',call('configure',f.askBefore,f.bound,f.eligible));};
  f.review=async()=>{await f.client.pendingReview(f.context,f.controller.signal);record('actual parsed current-screen review',call('review',f.client.proposals.has(id)));};
  f.run=async(direct=false)=>{
    f.direct=direct;f.returned='none';f.synced=false;
    const result=direct ? (await f.client.performRequested('message-one',f.context,f.controller.signal,async()=>!f.askBefore))[0]
      : await f.client.approve(id,f.context,f.controller.signal);
    if (!result) {record('request policy refuses without consuming the card',call('directRefused'));return;}
    f.returned=result.status;
    record('public call settles after releasing its busy guard',call(f.entry?.phase === 'terminal' && f.returned === f.entry.status ? 'finish' : 'abandon',...(f.entry?.phase === 'terminal' && f.returned === f.entry.status ? [f.synced] : [])));
    return result;
  };
  return f;
}

export async function checkDeviceActionReview(extraSources = []) {
  captureSources(extraSources);
  const source='apps/app/src/runtime/device-actions.ts', loaded=await bundledSource(source,{'import.meta.env':'{}'}), traces=[];
  const now=Date.now;
  try {
    for (const options of [
      {name:'reviewed-success'}, {name:'executor-failure',outcome:'failed'}, {name:'executor-throw',failure:'executor'},
      {name:'receipt-outage',failure:'receipt'}, {name:'reserve-failure',failure:'reserve'},
      {name:'changed-journal-identity',failure:'identity'}, {name:'decision-outage',failure:'decision'},
      {name:'changed-decision-digest',failure:'digest'}, {name:'missing-execution-claim',failure:'claim'},
      {name:'abort-before-effect',abort:'before'}, {name:'abort-after-effect',abort:'after'},
      {name:'direct-current-request',direct:true}, {name:'ask-first',direct:true,askBefore:true},
      {name:'old-request',direct:true,bound:false}, {name:'protected-write',direct:true,eligible:false,operation:{type:'create_reminder',title:'Synthetic reminder',dueAt:'2030-01-01T00:00:00.000Z'}},
      {name:'foreign-owner',foreign:true},
    ]) {
      const f=fixture(loaded.exports.DeviceActions,options);Date.now=()=>f.now;
      if(options.askBefore || options.bound === false || options.eligible === false)f.configure();
      await f.review();
      if(options.foreign){assert.equal(f.client.proposals.size,0);traces.push(f.trace);continue;}
      await f.run(options.direct);
      assert.ok(f.dispatches <= 1);traces.push(f.trace);
    }
    for (const kind of ['revision','view','selected','timeZone','sensitive','expired']) {
      const f=fixture(loaded.exports.DeviceActions,{name:'stale-'+kind});Date.now=()=>f.now;await f.review();
      if(kind==='expired'){f.now+=60001;f.record('the reviewed proposal expires',call('expire'));}
      else if(kind==='sensitive'){f.context={...f.context,sensitive:true};f.record('sensitive context retires approval admission',call('sensitive'));}
      else {f.context={...f.context,...(kind==='revision'?{revision:2}:kind==='view'?{view:'notes'}:kind==='selected'?{selectedObject:{kind:'note',id:'other'}}:{timeZone:'UTC'})};f.record('the exact reviewed screen changes',call('changeContext'));}
      await assert.rejects(f.client.approve(f.id,f.context,f.controller.signal),/Review this action again/);
      f.record('stale approval performs no journal or effect work',call('refused'));assert.equal(f.dispatches,0);traces.push(f.trace);
    }
    {
      const f=fixture(loaded.exports.DeviceActions,{name:'double-tap'});Date.now=()=>f.now;await f.review();
      f.holdLookup=deferred();const pending=f.run();
      for(let i=0;i<100&&f.authority==='none';i++)await new Promise(resolve=>setImmediate(resolve));
      assert.equal(f.client.busy,true);
      await assert.rejects(f.client.approve(f.id,f.context,f.controller.signal),/Another device action/);
      f.record('overlapping explicit approval cannot enter twice',call('refused'));f.holdLookup.resolve();await pending;traces.push(f.trace);
    }
    {
      const f=fixture(loaded.exports.DeviceActions,{name:'terminal-journal-never-replayed'});Date.now=()=>f.now;
      await f.review();await f.run();f.state='pending';await f.review();await f.run();
      assert.equal(f.dispatches,1);assert.equal(f.returned,'unknown');traces.push(f.trace);
    }
    {
      const f=fixture(loaded.exports.DeviceActions,{name:'recreated-coordinator-never-replays-journal'});Date.now=()=>f.now;
      await f.review();await f.run();f.recreate();f.record('new coordinator reads the same durable journal',call('restart'));
      f.state='pending';await f.review();await f.run();
      assert.equal(f.dispatches,1);assert.equal(f.returned,'unknown');traces.push(f.trace);
    }
  } finally {Date.now=now;}
  return check(boundInputs({model:'DeviceActionReview',sources:[source,...loaded.sources,driver,...extraSources],traces,
    scope:'bounded-orchestration',assumptions:[
      'Actual Alpha DeviceActions and shared coordinator, parsing, context checks, execution fence and hashing execute; transport, journal persistence and device effects are controlled recording ports.',
      'One opaque open-view proposal/effect; direct-request refusal also exercises a protected reminder write. Each port call is an observation boundary. No provider, Android or real user effect runs.',
      'Host owner retirement supplies AbortSignal; current-context equality is checked on approve entry. Domain-specific result validation, Files identities, native journal durability, browser direct-request proofs, multi-proposal batch limits and recovery are separate contracts.']}));
}
