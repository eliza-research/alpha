import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import {action} from './support.mjs';

const sourcePath='apps/app/src/prototype/workflow-adapter.ts';
const ledgerKey='alpha.workflow.run-accounts.v1';
const owner='agent',account='account-a',other='account-b',workflowId='flow',requestId='submission';
const accepted={id:'run',workflowId,finished:false};

/** Execute the unchanged ownership helper, with only localStorage held as a controlled port. */
export function workflowOwnershipSubject({rewrite=source=>source,shared,locksAvailable=true}={}) {
  const source=rewrite(fs.readFileSync(sourcePath,'utf8'));
  const start=source.indexOf("const RUN_ACCOUNTS='"),end=source.indexOf('/** Existing remote workflows only;',start);
  assert.ok(start>=0&&end>start,'Workflow ownership helper boundaries changed');
  const code=transformSync(source.slice(start,end),{loader:'ts',target:'esnext'}).code+'\nglobalThis.create=workflowRunAccounts;';
  const state=shared??{bytes:new Map(),ports:{readable:true,writable:true},queues:new Map(),afterRead:null,afterWrite:null};
  const {bytes,ports}=state;
  const localStorage={
    getItem(key){if(!ports.readable)throw Error('read refused');const raw=bytes.get(key)??null;const hook=state.afterRead;state.afterRead=null;hook?.();return raw;},
    setItem(key,value){if(!ports.writable)throw Error('write refused');bytes.set(key,String(value));const hook=state.afterWrite;state.afterWrite=null;hook?.();},
    removeItem(key){if(!ports.writable)throw Error('write refused');bytes.delete(key);},
  };
  const locks={request(name,...args){
    const task=args.at(-1);let queue=state.queues.get(name);
    if(!queue){queue={busy:false,waiting:[]};state.queues.set(name,queue);}
    return new Promise((resolve,reject)=>{
      const run=()=>{queue.busy=true;let result;try{result=task({name,mode:'exclusive'});}catch(error){result=Promise.reject(error);}Promise.resolve(result).then(resolve,reject).finally(()=>{const next=queue.waiting.shift();if(next)next();else queue.busy=false;});};
      if(queue.busy)queue.waiting.push(run);else run();
    });
  }};
  const mount=()=>{const context={localStorage,navigator:{locks:locksAvailable?locks:undefined}};vm.runInNewContext(code,context);return context.create();};
  let ledger=mount();
  const rows=()=>JSON.parse(bytes.get(ledgerKey)||'[]');
  const observation=()=>({
    's.ownershipPending':rows().some(row=>row.owner===owner&&row.requestId===requestId&&!row.runId),
    's.recorded':rows().some(row=>row.owner===owner&&row.runId===accepted.id),
  });
  return {ports,rows,observation,shared:state,get ledger(){return ledger;},restart(){ledger=mount();}};
}

/** Bounded component traces: durable ownership only. Agent admission, UI publication and physical storage are held. */
export async function workflowOwnershipTraces(options) {
  const traces=[];
  {
    const code=workflowOwnershipSubject(options),steps=[];
    const trace={name:'refused ownership reservation cannot authorize dispatch',init:action('initFor',false),expect:code.observation(),steps};
    code.ports.writable=false;
    steps.push({action:[action('validate'),action('save'),action('ownershipStorage',true,false)],expect:code.observation()});
    await assert.rejects(async()=>code.ledger.reserve(owner,account,workflowId,requestId),/Run history unavailable/);
    steps.push({action:action('reservationRefused'),expect:{...code.observation(),'s.executions':0}});
    steps.push({action:{...action('retainSubmission',true),reject:true},expect:code.observation()});
    traces.push(trace);
  }
  {
    const code=workflowOwnershipSubject(options),steps=[];
    const trace={name:'accepted ownership survives failed promotion and restart before acknowledgment',init:action('initFor',false),expect:code.observation(),steps};
    await code.ledger.reserve(owner,account,workflowId,requestId);
    steps.push({action:[action('validate'),action('save'),action('retainSubmission',true)],expect:code.observation()});
    code.ports.writable=false;
    steps.push({action:action('ownershipStorage',true,false),expect:code.observation()});
    await assert.rejects(async()=>code.ledger.record(owner,account,accepted,requestId),/Run history unavailable/);
    assert.equal(code.ledger.hidden(owner,other,accepted.id,workflowId),true);
    steps.push({action:action('acceptedWithoutPromotion'),expect:{...code.observation(),'s.sourceAcknowledged':false,'s.receiptVisible':false}});
    code.restart();
    assert.equal(code.ledger.hidden(owner,other,accepted.id,workflowId),true);
    steps.push({action:action('restart'),expect:code.observation()});
    code.ports.writable=true;
    steps.push({action:action('ownershipStorage',true,true),expect:code.observation()});
    await code.ledger.record(owner,account,accepted,requestId);
    steps.push({action:action('promoteOwnership'),expect:code.observation()});
    assert.equal(code.ledger.hidden(owner,other,accepted.id,workflowId),true);
    steps.push({action:action('switchOwner'),expect:{...code.observation(),'s.receiptVisible':false}});
    code.ports.writable=false;
    steps.push({action:action('ownershipStorage',true,false),expect:code.observation()});
    assert.equal((await code.ledger.claim(owner,other)).length,0);
    steps.push({action:{...action('cancelOtherAccountRun',false),reject:true},expect:{...code.observation(),'s.switchCancels':0}});
    code.ports.writable=true;
    steps.push({action:action('ownershipStorage',true,true),expect:code.observation()});
    const claimed=await code.ledger.claim(owner,other);
    assert.equal(claimed.length,1);assert.equal(claimed[0].runId,accepted.id);
    steps.push({action:action('cancelOtherAccountRun',false),expect:{...code.observation(),'s.cancelClaimed':code.rows().find(row=>row.runId===accepted.id).cancel===true,'s.switchCancels':claimed.length}});
    code.restart();assert.equal((await code.ledger.claim(owner,other)).length,0);
    steps.push({action:action('restart'),expect:code.observation()});
    traces.push(trace);
  }
  {
    const code=workflowOwnershipSubject(options),steps=[];
    const trace={name:'unrelated unfinished ownership records cannot evict an earlier run',init:action('initFor',false),expect:code.observation(),steps};
    await code.ledger.reserve(owner,account,workflowId,requestId);
    steps.push({action:[action('validate'),action('save'),action('retainSubmission',true)],expect:code.observation()});
    await code.ledger.record(owner,account,accepted,requestId);
    steps.push({action:action('admit'),expect:code.observation()});
    for(let index=0;index<201;index++){
      const flow='other-flow-'+index,request='other-request-'+index;
      await code.ledger.reserve(owner,account,flow,request);
      await code.ledger.record(owner,account,{id:'other-run-'+index,workflowId:flow,finished:false},request);
    }
    assert.equal(code.rows().length,202);assert.equal(code.ledger.hidden(owner,other,accepted.id,workflowId),true);
    steps.push({action:action('otherOwnershipRecorded'),expect:code.observation()});
    code.restart();assert.equal(code.ledger.hidden(owner,other,accepted.id,workflowId),true);
    steps.push({action:[action('switchOwner'),action('restart')],expect:code.observation()});
    traces.push(trace);
  }
  {
    const code=workflowOwnershipSubject(options),steps=[];
    const trace={name:'ownership read refusal suspends access instead of producing an empty ledger',init:action('initFor',false),expect:code.observation(),steps};
    await code.ledger.reserve(owner,account,workflowId,requestId);
    steps.push({action:[action('validate'),action('save'),action('retainSubmission',true)],expect:code.observation()});
    await code.ledger.record(owner,account,accepted,requestId);
    steps.push({action:action('admit'),expect:code.observation()});
    code.ports.readable=false;
    assert.throws(()=>code.ledger.hidden(owner,other,accepted.id,workflowId),/Run history unavailable/);
    await assert.rejects(async()=>code.ledger.claim(owner,other),/Run history unavailable/);
    steps.push({action:action('ownershipStorage',false,true),expect:code.observation()});
    code.restart();
    assert.throws(()=>code.ledger.hidden(owner,other,accepted.id,workflowId),/Run history unavailable/);
    steps.push({action:action('restart'),expect:code.observation()});
    code.ports.readable=true;
    assert.equal(code.ledger.hidden(owner,other,accepted.id,workflowId),true);
    steps.push({action:action('ownershipStorage',true,true),expect:code.observation()});
    traces.push(trace);
  }
  {
    const code=workflowOwnershipSubject(options),peer=workflowOwnershipSubject({...options,shared:code.shared}),steps=[];
    const trace={name:'two document contexts retain both reservations and claim a run once',init:action('initFor',false),expect:code.observation(),steps};
    // The other document starts after this document read its old bytes, before its write. The
    // shared named lock must hold that writer until this operation completes.
    let otherReservation;
    code.shared.afterRead=()=>{otherReservation=peer.ledger.reserve(owner,account,'other-flow','other-request');};
    await code.ledger.reserve(owner,account,workflowId,requestId);
    assert.ok(otherReservation,'The competing document must enter the reserved schedule');
    await otherReservation;
    assert.deepEqual(code.rows().map(row=>row.requestId).sort(),['other-request',requestId].sort());
    steps.push({action:[action('validate'),action('save'),action('retainSubmission',true),action('otherOwnershipRecorded')],expect:code.observation()});
    await code.ledger.record(owner,account,accepted,requestId);
    steps.push({action:action('admit'),expect:code.observation()});
    steps.push({action:action('switchOwner'),expect:code.observation()});
    let otherClaim;
    code.shared.afterRead=()=>{otherClaim=peer.ledger.claim(owner,other);};
    const first=await code.ledger.claim(owner,other);
    assert.ok(otherClaim,'The competing claimant must enter the reserved schedule');
    const second=await otherClaim,claims=[...first,...second];
    assert.equal(claims.length,1);assert.equal(claims[0].runId,accepted.id);
    steps.push({action:action('cancelOtherAccountRun',false),expect:{...code.observation(),'s.cancelClaimed':code.rows().find(row=>row.runId===accepted.id).cancel===true,'s.switchCancels':claims.length}});
    code.restart();peer.restart();assert.equal((await peer.ledger.claim(owner,other)).length,0);
    steps.push({action:action('restart'),expect:code.observation()});
    traces.push(trace);
  }
  {
    const code=workflowOwnershipSubject(options),steps=[];
    const trace={name:'applied ownership and claim writes remain safe when readback is refused',init:action('initFor',false),expect:code.observation(),steps};
    await code.ledger.reserve(owner,account,workflowId,requestId);
    steps.push({action:[action('validate'),action('save'),action('retainSubmission',true)],expect:code.observation()});
    code.shared.afterWrite=()=>{code.ports.readable=false;};
    await assert.rejects(async()=>code.ledger.record(owner,account,accepted,requestId),/Run history unavailable/);
    assert.equal(code.observation()['s.recorded'],true);assert.equal(code.observation()['s.ownershipPending'],false);
    steps.push({action:action('acceptedPromotionUnconfirmed'),expect:{...code.observation(),'s.sourceAcknowledged':false,'s.receiptVisible':false}});
    code.restart();
    steps.push({action:action('restart'),expect:code.observation()});
    code.ports.readable=true;
    steps.push({action:action('ownershipStorage',true,true),expect:code.observation()});
    await code.ledger.record(owner,account,accepted,requestId);
    steps.push({action:action('reconcile',true),expect:code.observation()});
    steps.push({action:action('switchOwner'),expect:code.observation()});
    code.shared.afterWrite=()=>{code.ports.readable=false;};
    let claims=[];
    try{claims=await code.ledger.claim(owner,other);}catch(error){assert.match(error.message,/Run history unavailable/);}
    assert.equal(claims.length,0);assert.equal(code.rows().find(row=>row.runId===accepted.id).cancel,true);
    steps.push({action:action('unconfirmedCancelClaim'),expect:{...code.observation(),'s.cancelClaimed':true,'s.switchCancels':claims.length}});
    code.restart();
    steps.push({action:action('restart'),expect:code.observation()});
    code.ports.readable=true;
    steps.push({action:action('ownershipStorage',true,true),expect:code.observation()});
    assert.equal((await code.ledger.claim(owner,other)).length,0);
    steps.push({action:{...action('cancelOtherAccountRun',false),reject:true},expect:{...code.observation(),'s.switchCancels':0}});
    traces.push(trace);
  }
  {
    const code=workflowOwnershipSubject({...options,locksAvailable:false}),steps=[];
    const trace={name:'missing cross-document lock admission refuses a new reservation',init:action('initFor',false),expect:code.observation(),steps};
    await assert.rejects(async()=>code.ledger.reserve(owner,account,workflowId,requestId),/Run history unavailable/);
    steps.push({action:[action('validate'),action('save'),action('ownershipStorage',true,false),action('reservationRefused')],expect:{...code.observation(),'s.executions':0}});
    steps.push({action:{...action('retainSubmission',true),reject:true},expect:code.observation()});
    traces.push(trace);
  }
  return traces;
}
