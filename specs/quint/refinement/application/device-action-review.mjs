import assert from 'node:assert/strict';
import {checkTraces as check} from '../check-traces.mjs';
import {bundledSource, captureSources, boundInputs, trace, checkpoint, call, deferred} from './support.mjs';

const driver = 'specs/quint/refinement/application/device-action-review.mjs';
captureSources([driver]);
const contextKey = value => JSON.stringify([value.view, value.sensitive === true, value.revision, value.timeZone ?? null, value.selectedObject ?? null]);
const benign = {authority:'none', expired:false, current:true, sensitive:false, asks:false, bound:true};
const message = 'message-one';
/** Declared proposal classes; the real coordinator decides what parses, lists and runs. */
const kinds = {
  open_view:{operation:{type:'open_view', view:'notes'}},
  open_settings:{operation:{type:'open_view', view:'settings'}},
  create_note:{operation:{type:'create_note', title:'Synthetic note', body:'Synthetic body'}},
  browser_navigate:{operation:{type:'browser_navigate', url:'https://example.com/'}},
  create_reminder:{operation:{type:'create_reminder', title:'Synthetic reminder', dueAt:'2030-01-01T00:00:00.000Z'}},
  settings_write:{operation:{type:'settings_update', key:'askBeforeAgentActions', value:false}},
};
const workflowBinding = {workflowId:'workflow-one', versionId:'version-one', runId:'run-one', stepId:'step-one', specDigest:'e'.repeat(64)};
const typedAddress = 'open https://example.com/', otherText = 'what is on my calendar';

/** All effects are recording ports. The real coordinator parses, reviews, hashes, journals and claims.
 * `plan` lists the proposals of one listing in order; `expect` is the driver's declared direct-pass outcome. */
function fixture(DeviceActions, options = {}) {
  const f = {now: 1900000000000, context: {view:'home', revision:1, sensitive:false},
    reviewFirst:'off', pass:0, passOpen:true, passEffects:0, browserUsed:false, browserAuto:0,
    controller:new AbortController(), execution:deferred()};
  const session = {ownerId:'owner', agentId:'agent', sessionId:'session', origin:'https://agent.invalid'};
  const credential = {installationId:'device', enrollmentId:'enrollment', key:'a'.repeat(64), capabilities:[]};
  const scope = 'c'.repeat(64), expires = f.now + 60000;
  const plan = (options.plan ?? [{op:'open_view'}]).map((entry, index) => ({
    id:index ? `proposal-${index + 1}` : 'proposal-one', digest:String.fromCharCode(98 + index).repeat(64),
    op:entry.op, operation:structuredClone(entry.operation ?? kinds[entry.op].operation),
    bound:entry.bound ?? true, workflow:entry.workflow ?? false, grounded:entry.grounded ?? false,
    expect:entry.expect ?? 'run', outcome:entry.outcome ?? options.outcome ?? 'succeeded',
    state:'pending', attempt:undefined, entry:undefined, reservedId:undefined, begun:false, settled:false,
    authority:'none', decisions:0, claims:0, dispatches:0, receipts:0, returned:'none', synced:false, admitted:false, at:benign}));
  f.plan = plan;f.focus = plan[0];f.focused = !options.plan;f.reviewContext = structuredClone(f.context);
  const wire = slot => ({id:slot.id, digest:slot.digest, state:slot.state, subjectUserId:options.foreign ? 'foreign' : session.ownerId,
    requestedBy:session.agentId, action:'device_action', expiresAt:new Date(expires).toISOString(),
    payload:{version:1, action:'device_action', installationId:credential.installationId, enrollmentId:credential.enrollmentId,
      requestMessageId:slot.bound ? message : 'old-message', operation:slot.operation,
      ...(slot.workflow ? {workflow:workflowBinding} : {})},
    ...(slot.attempt ? {execution:{attemptId:slot.attempt}} : {})});
  const observe = () => {const slot = f.focus;return {'s.card':f.client.proposals.has(slot.id), 's.busy':f.client.busy,
    's.journal':slot.entry?.phase ?? 'empty', 's.identity':!slot.entry || slot.entry.operationId === slot.reservedId,
    's.current':contextKey(f.context) === contextKey(f.reviewContext), 's.sensitive':f.context.sensitive === true,
    's.expired':f.now >= expires, 's.aborted':f.controller.signal.aborted,
    's.reviewFirst':f.reviewFirst, 's.bound':f.focused ? slot.bound : true, 's.op':f.focused ? slot.op : 'open_view',
    's.workflow':f.focused && slot.workflow, 's.grounded':f.focused && slot.grounded,
    's.browserUsed':f.browserUsed, 's.pass':f.pass, 's.passOpen':f.passOpen, 's.passEffects':f.passEffects, 's.browserAuto':f.browserAuto,
    's.authority':slot.authority, 's.decisions':slot.decisions, 's.claims':slot.claims, 's.dispatches':slot.dispatches,
    's.receipts':slot.receipts, 's.status':slot.entry?.status ?? 'none', 's.returned':slot.returned, 's.synced':slot.synced,
    's.admitted':slot.admitted, 's.at':slot.at};};
  const record = (label, action) => checkpoint(f.trace, label, action, observe());
  const request = async (path, body, signal) => {
    if (body === undefined) return {proposals:plan.map(wire)};
    const slot = f.focus;assert.ok(path.includes(slot.id), 'server mutation names the focused proposal');
    if (path.endsWith('/decision')) {
      slot.decisions++;record('actual approval decision request',call('decide'));
      if (options.failure === 'decision') throw Error('Controlled decision outage');
      slot.state='approved';
    } else if (path.endsWith('/claim')) {
      slot.claims++;record('actual execution claim request',call('claim'));
      if (options.failure === 'claim') return {proposal:wire(slot),digest:slot.digest};
      slot.state='executing';slot.attempt='attempt-'+slot.id;
    } else if (path.endsWith('/receipt')) {
      slot.receipts++;record('receipt upload follows durable terminal result',call('upload'));
      if (options.failure === 'receipt' || signal.aborted) throw Error('Controlled receipt outage');
      slot.state='done';slot.synced=true;
    } else throw Error('Unexpected path '+path);
    return {proposal:wire(slot),digest:options.failure === 'digest' ? 'd'.repeat(64) : slot.digest};
  };
  const journal = {
    async get(identity) {
      if (f.client.busy) {
        const slot = f.focus;
        assert.equal(identity.proposalId, slot.id, 'the coordinator approved a proposal the driver did not focus');
        slot.begun=true;slot.settled=false;slot.authority=f.direct ? 'request' : 'review';
        if (f.direct && slot.op === 'browser_navigate') f.browserUsed=true;
        record('card consumed and busy taken before asynchronous journal lookup',call('begin',!!f.direct));
        if (f.holdLookup) await f.holdLookup.promise;
      }
      return {entry:plan.find(slot => slot.id === identity.proposalId)?.entry};
    },
    async reserve(input) {
      const slot = f.focus;assert.equal(input.proposalId, slot.id);
      if (options.failure === 'reserve') throw Error('Controlled reservation failure');
      if (slot.entry) {record('existing durable effect is never admitted twice',call('existing'));return {created:false,entry:slot.entry};}
      slot.reservedId=input.operationId;slot.entry={...input,phase:'reserved'};
      if (options.failure === 'identity') slot.entry.operationId='foreign-operation';
      record('actual durable reservation',call('reserve',options.failure !== 'identity'));
      return {created:true,entry:slot.entry};
    },
    async markApplying(input) {
      Object.assign(f.focus.entry,{phase:'applying',attemptId:input.attemptId});
      record('durable applying marker precedes the executor',call('applying'));
      if (options.abort === 'before') {f.controller.abort();record('owner cancellation before executor entry',call('abort'));}
      if (options.expire === 'applying') {f.now+=60001;record('the proposal expires after its claim',call('expire'));}
    },
    async finish(input) {
      Object.assign(f.focus.entry,input,{phase:'terminal'});
      record('executor outcome stored before receipt upload',call('settle',input.status));
    },
    async list() {return {entries:plan.flatMap(slot => slot.entry ? [slot.entry] : [])};},
  };
  const execute = async (op, operationId, actualContext, signal) => {
    const slot = f.focus;
    assert.deepEqual(op,slot.operation);assert.equal(operationId,slot.entry.operationId);
    assert.deepEqual(actualContext,f.reviewContext);assert.equal(signal.aborted,false);
    slot.dispatches++;
    slot.at={authority:slot.authority, expired:f.now >= expires, current:contextKey(f.context) === contextKey(f.reviewContext),
      sensitive:f.context.sensitive === true, asks:f.reviewFirst !== 'off', bound:slot.bound};
    if (f.direct) {f.passEffects++;if (slot.op === 'browser_navigate') f.browserAuto++;}
    slot.admitted=!signal.aborted && f.now < expires && contextKey(f.context) === contextKey(f.reviewContext);
    record('real coordinator calls its executor exactly once',call('dispatch'));
    if (options.abort === 'after') {f.controller.abort();record('post-dispatch cancellation preserves the effect outcome',call('abort'));}
    if (options.failure === 'executor') throw Error('Controlled executor uncertainty');
    return {status:slot.outcome,summary:'Controlled executor outcome'};
  };
  f.recreate=()=>{f.client=new DeviceActions(session,credential,scope,request,journal,execute);};f.recreate();
  f.observe=observe;f.record=record;f.id=plan[0].id;
  f.trace=trace(options.name ?? 'reviewed',observe());
  const proposeArgs = slot => call('propose',slot.op,slot.workflow,slot.bound,slot.grounded,f.client.proposals.has(slot.id));
  f.proof=options.proof === undefined ? undefined : {messageId:message, text:options.proof, current() {}};
  f.prefer=value=>{f.reviewFirst=value;record('owner preference for reviewing phone actions first',call('prefer',value));};
  f.propose=slot=>{f.focus=slot;f.focused=true;record('focus another proposal of this message; the listing already decided its card',proposeArgs(slot));};
  f.review=async()=>{await f.client.pendingReview(f.context,f.controller.signal,f.proof);record('actual parsed current-screen review',call('review',f.client.proposals.has(f.focus.id)));};
  /** The public call returned (or the pass moved on): busy is released and the result is known. */
  const leave = (slot, status) => {
    slot.returned=status;slot.settled=true;
    const durable=slot.entry?.phase === 'terminal' && status === slot.entry.status;
    if (slot.authority === 'request') {f.pass++;f.passOpen=f.passOpen && status === 'succeeded' && !f.controller.signal.aborted;}
    record('public call settles after releasing its busy guard',durable ? call('finish',slot.synced) : call('abandon'));
  };
  f.approve=async()=>{
    f.direct=false;const slot=f.focus;slot.returned='none';slot.synced=false;
    const result=await f.client.approve(slot.id,f.context,f.controller.signal);
    leave(slot,result.status);return result;
  };
  /** One real `performRequested` pass. `allowed` is the coordinator's own pre-approval boundary. */
  f.pass1=async()=>{
    f.direct=true;const inferred=[];
    const allowed=async()=>{
      const outstanding=plan.find(slot=>slot.begun&&!slot.settled);
      if (outstanding) {inferred.push(outstanding.entry?.status);leave(outstanding,outstanding.entry?.status ?? 'unknown');}
      const next=plan.find(slot=>slot.expect==='run'&&!slot.begun);
      if (next && next !== f.focus) f.propose(next);
      if (f.reviewFirst === 'unreadable') throw Error('Controlled preference read failure');
      return f.reviewFirst === 'off';
    };
    let results=[];
    try {results=await f.client.performRequested(message,f.context,f.controller.signal,allowed,undefined,f.proof);}
    catch (error) {if (f.reviewFirst !== 'unreadable') throw error;}
    const outstanding=plan.find(slot=>slot.begun&&!slot.settled);
    if (outstanding) leave(outstanding,results.at(-1).status);
    assert.deepEqual(inferred,results.slice(0,inferred.length).map(result=>result.status),'a continued pass follows only durable successes');
    assert.equal(results.length,f.pass,'one result for each direct approval the driver observed');
    for (const slot of plan) {
      if (slot.begun) continue;
      if (slot !== f.focus) f.propose(slot);
      record('request policy refuses without journal or effect work',call('directRefused'));
      assert.equal(slot.entry,undefined);assert.equal(slot.dispatches,0);
    }
    return results;
  };
  f.run=direct=>direct ? f.pass1() : f.approve();
  return f;
}

export async function checkDeviceActionReview(extraSources = []) {
  captureSources(extraSources);
  const source='apps/app/src/runtime/device-actions.ts', loaded=await bundledSource(source,{'import.meta.env':'{}'}), traces=[];
  const now=Date.now;
  const note={op:'create_note'};
  try {
    for (const options of [
      {name:'reviewed-success'}, {name:'executor-failure',outcome:'failed'}, {name:'executor-throw',failure:'executor'},
      {name:'receipt-outage',failure:'receipt'}, {name:'reserve-failure',failure:'reserve'},
      {name:'changed-journal-identity',failure:'identity'}, {name:'decision-outage',failure:'decision'},
      {name:'changed-decision-digest',failure:'digest'}, {name:'missing-execution-claim',failure:'claim'},
      {name:'abort-before-effect',abort:'before'}, {name:'abort-after-effect',abort:'after'},
      {name:'expired-after-claim',expire:'applying'},
      {name:'direct-current-request',direct:true},
      {name:'ask-first',direct:true,reviewFirst:'on',plan:[{op:'open_view',expect:'skip'}]},
      {name:'unreadable-preference',direct:true,reviewFirst:'unreadable',plan:[{op:'open_view',expect:'skip'}]},
      {name:'old-request',direct:true,plan:[{op:'open_view',bound:false,expect:'skip'}]},
      {name:'protected-write',direct:true,plan:[{op:'create_reminder',expect:'skip'}]},
      {name:'workflow-step-never-listed',direct:true,plan:[{op:'create_note',workflow:true,expect:'skip'}],cards:[false]},
      {name:'settings-is-navigation-only',direct:true,plan:[{op:'open_settings'},{op:'settings_write',expect:'skip'}],cards:[true,false],effects:1},
      {name:'four-direct-per-pass',direct:true,plan:[note,note,note,note,{...note,expect:'skip'}],effects:4},
      {name:'failure-ends-pass',direct:true,plan:[{...note,outcome:'failed'},{...note,expect:'skip'}],effects:1},
      {name:'mixed-pass',direct:true,proof:typedAddress,plan:[note,{op:'create_reminder',expect:'skip'},{op:'browser_navigate',grounded:true},
        {op:'browser_navigate',grounded:true,expect:'skip'},{...note,bound:false,expect:'skip'}],effects:2},
      {name:'browser-without-typed-address',direct:true,proof:otherText,plan:[{op:'browser_navigate',expect:'skip'}],cards:[false]},
      {name:'browser-without-request-proof',direct:true,plan:[{op:'browser_navigate',expect:'skip'}],cards:[true]},
      {name:'direct-pre-dispatch-failure-answers-unknown',direct:true,failure:'decision',plan:[note,{...note,expect:'skip'}],effects:0},
      {name:'foreign-owner',foreign:true},
    ]) {
      const f=fixture(loaded.exports.DeviceActions,options);Date.now=()=>f.now;
      if(options.reviewFirst)f.prefer(options.reviewFirst);
      if(options.plan)f.propose(f.focus);
      await f.review();
      if(options.foreign){assert.equal(f.client.proposals.size,0);traces.push(f.trace);continue;}
      if(options.cards)assert.deepEqual(f.plan.map(slot=>f.client.proposals.has(slot.id)),options.cards);
      const results=await f.run(options.direct);
      const effects=f.plan.reduce((sum,slot)=>sum+slot.dispatches,0);
      for(const slot of f.plan)assert.ok(slot.dispatches <= 1);
      if(options.direct){
        assert.equal(effects,options.effects ?? f.plan.filter(slot=>slot.expect==='run').length,options.name);
        assert.ok(effects <= 4 && results.length <= 4);
        assert.deepEqual(f.plan.filter(slot=>slot.expect==='run').map(slot=>slot.begun),f.plan.filter(slot=>slot.expect==='run').map(()=>true));
      }
      traces.push(f.trace);
    }
    {
      // A second pass for the same message cannot open the Browser again.
      const f=fixture(loaded.exports.DeviceActions,{name:'second-pass-keeps-browser-attempt',proof:typedAddress,
        plan:[{op:'browser_navigate',grounded:true},{op:'browser_navigate',grounded:true,expect:'skip'}]});Date.now=()=>f.now;
      f.propose(f.focus);await f.review();await f.pass1();
      f.pass=0;f.passOpen=true;f.passEffects=0;f.record('another direct pass for the same message',call('startPass',true));
      f.plan[0].state='done';await f.client.pendingReview(f.context,f.controller.signal,f.proof);
      assert.equal(f.client.proposals.has(f.plan[1].id),true);
      assert.deepEqual(await f.client.performRequested(message,f.context,f.controller.signal,async()=>true,undefined,f.proof),[]);
      f.record('the consumed Browser attempt refuses the second card again',call('directRefused'));
      assert.equal(f.browserAuto,1);assert.equal(f.plan[1].entry,undefined);traces.push(f.trace);
    }
    for (const kind of ['revision','view','selected','timeZone','sensitive','expired']) {
      const f=fixture(loaded.exports.DeviceActions,{name:'stale-'+kind});Date.now=()=>f.now;await f.review();
      if(kind==='expired'){f.now+=60001;f.record('the reviewed proposal expires',call('expire'));}
      else if(kind==='sensitive'){f.context={...f.context,sensitive:true};f.record('sensitive context retires approval admission',call('sensitive'));}
      else {f.context={...f.context,...(kind==='revision'?{revision:2}:kind==='view'?{view:'notes'}:kind==='selected'?{selectedObject:{kind:'note',id:'other'}}:{timeZone:'UTC'})};f.record('the exact reviewed screen changes',call('changeContext'));}
      await assert.rejects(f.client.approve(f.id,f.context,f.controller.signal),/Review this action again/);
      f.record('stale approval performs no journal or effect work',call('refused'));assert.equal(f.focus.dispatches,0);
      // The direct pass meets the same retirement: it rejects before any journal work.
      await assert.rejects(f.client.performRequested(message,f.context,f.controller.signal,async()=>true),/Review this action again/);
      f.record('stale direct pass performs no journal or effect work',call('refused'));
      assert.equal(f.focus.dispatches,0);assert.equal(f.focus.entry,undefined);traces.push(f.trace);
    }
    {
      const f=fixture(loaded.exports.DeviceActions,{name:'double-tap'});Date.now=()=>f.now;await f.review();
      f.holdLookup=deferred();const pending=f.run();
      for(let i=0;i<100&&f.focus.authority==='none';i++)await new Promise(resolve=>setImmediate(resolve));
      assert.equal(f.client.busy,true);
      await assert.rejects(f.client.approve(f.id,f.context,f.controller.signal),/Another device action/);
      f.record('overlapping explicit approval cannot enter twice',call('refused'));f.holdLookup.resolve();await pending;traces.push(f.trace);
    }
    {
      const f=fixture(loaded.exports.DeviceActions,{name:'terminal-journal-never-replayed'});Date.now=()=>f.now;
      await f.review();await f.run();f.focus.state='pending';await f.review();await f.run();
      assert.equal(f.focus.dispatches,1);assert.equal(f.focus.returned,'unknown');traces.push(f.trace);
    }
    {
      const f=fixture(loaded.exports.DeviceActions,{name:'recreated-coordinator-never-replays-journal'});Date.now=()=>f.now;
      await f.review();await f.run();f.recreate();f.record('new coordinator reads the same durable journal',call('restart'));
      f.focus.state='pending';await f.review();await f.run();
      assert.equal(f.focus.dispatches,1);assert.equal(f.focus.returned,'unknown');traces.push(f.trace);
    }
  } finally {Date.now=now;}
  return check(boundInputs({model:'DeviceActionReview',sources:[source,...loaded.sources,driver,...extraSources],traces,
    scope:'bounded-orchestration',assumptions:[
      'Actual Alpha DeviceActions and shared coordinator, parsing, listing, context checks, direct-pass admission, execution fence and hashing execute; transport, journal persistence, the Review-first preference read and device effects are controlled recording ports.',
      'Up to five proposals of one listing. Operation classes are driver declarations (open_view, open_view to Settings, create_note, browser_navigate, reminder write, workflow-bound note, an operation outside the contract); the coordinator alone decides which parse, list and run. Each port call and each `allowed` call is an observation boundary. No provider, Android or real user effect runs.',
      'pass, passOpen and browserUsed are inferred from the results and port calls of the real pass and asserted against its returned receipts. Host owner retirement supplies AbortSignal; current-context equality is checked on approve entry.',
      'KNOWN DIVERGENCE (AGENT-06): reserve-failure, decision-outage, changed-decision-digest, missing-execution-claim, changed-journal-identity and direct-pre-dispatch-failure-answers-unknown end with returned `unknown` and no dispatch. The model reproduces this; UnknownOnlyAfterDispatch is registered as an expected violation, not as safety.',
      'Camera, Files, Photos, Notes-organise and SMS-reply direct types, workflow-run review, navigation-only review destinations, domain-specific result validation, Files identities, native journal durability and recovery are separate contracts.']}));
}
