import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {loadTaskService} from '../specs/quint/refinement/services/task-service/module.mjs';

const action = (name, ...args) => ({name, args});
const attempt = promise => promise.then(value => ({value}), error => ({error}));
function gate() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
async function until(test) {
  for (let n=0; n<2000 && !test(); n++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(test(), 'source operation reached its controlled boundary');
}

async function createFixture(loaded) {
  const database = await loaded.createIsolatedTestDatabase('quint-task-lifecycle', [], {postgresUrl: null});
  const originalRead = database.runtime.getTask.bind(database.runtime);
  const originalQuery = database.runtime.getTasks.bind(database.runtime);
  const f = {...database, originalRead, originalQuery, id: null, now: 100000, generation: 0,
    calls: [], timers: new Set(), operations: [], stopReturned: false, holdRead: null, readGates: []};
  f.newService = () => {
    f.generation++; f.stopReturned = false; f.stopPromise = null;
    f.service = new loaded.TaskService(database.runtime, {now: () => f.now,
      setTimeout(callback) { const fire = () => {f.timers.delete(fire); return callback();}; f.timers.add(fire); return fire; },
      clearTimeout(callback) { f.timers.delete(callback); }});
  };
  f.newService();
  f.installWorker = enabled => {
    if (!enabled) { database.runtime.unregisterTaskWorker('LIFECYCLE'); return; }
    database.runtime.registerTaskWorker({name: 'LIFECYCLE', async execute() {
      const pending = gate(); f.calls.push(pending); return pending.promise;
    }});
  };
  f.installWorker(true);
  database.runtime.getTask = async id => {
    const row = await originalRead(id);
    if (f.holdRead) { const pending = f.holdRead; f.holdRead = null; f.readGates.push(pending); pending.entered.resolve(); await pending.release.promise; }
    return row;
  };
  f.manual = () => { const pending=attempt(f.service.executeTaskById(f.id)); f.operations.push(pending); return pending; };
  f.runDue = () => { const pending=attempt(f.service.runDueTasks()); f.operations.push(pending); return pending; };
  f.stop = () => {
    f.stopPromise=f.service.stop().then(() => { f.stopReturned=true; }); return f.stopPromise;
  };
  f.create = async (repeating=true, paused=false, blocking=true) => {
    f.id=await database.runtime.createTask({name:'LIFECYCLE',tags:repeating?['queue','repeat']:['queue'],
      metadata:{updatedAt:0,updateInterval:1,maxFailures:2,paused,blocking}});
  };
  f.finish = async (slot, outcome='preserve') => {
    if(outcome==='failure')f.calls[slot-1].reject(Error('controlled worker failure'));
    else f.calls[slot-1].resolve(outcome==='preserve'?{preserveTask:true}:undefined);
  };
  f.state = async () => {
    const row=f.id?await originalRead(f.id):null;
    const state={'s.stopped':f.service.stopped,'s.timer':f.service.hasTimer,'s.localTimer':f.service.localTimer,
      's.stopReturned':f.stopReturned,'s.generation':f.generation,'s.tracked':f.id?(f.service.executingTasks.get(f.id)??0):0,
      's.calls':f.calls.length,'s.quarantined':f.id?f.service.quarantinedOrphans.has(f.id):false,
      's.row.exists':!!row,ActiveTick:!!f.service.activeTick,Executing:f.id?(await f.service.getTaskStatus(f.id)).executing:false};
    if(row)Object.assign(state,{'s.row.repeating':row.tags.includes('repeat'),'s.row.paused':row.metadata?.paused===true,
      's.row.orphan':row.metadata?.orphanedNoWorker===true,'s.row.failures':row.metadata?.failureCount??0,
      's.row.backoff':row.metadata?.baseInterval!==undefined,'s.row.blocking':row.metadata?.blocking!==false});
    return state;
  };
  f.close=async()=>{
    for(const pending of f.readGates)pending.release.resolve();
    for(const pending of f.calls)pending.resolve({preserveTask:true});
    await Promise.all(f.operations);await f.service.stop();await database.cleanup();
  };
  return f;
}

async function runTaskServiceRefinement(extraSources = []) {
  const loaded = await loadTaskService([fileURLToPath(import.meta.url), ...extraSources]);
  const traces=[];
  async function scenario(name, body) {
    const f=await createFixture(loaded), trace={name,expect:await f.state(),steps:[]};
    const record=async(label,actions)=>trace.steps.push({label,action:actions,expect:await f.state()});
    const create=async(repeating=true,paused=false,blocking=true)=>{await f.create(repeating,paused,blocking);await record('persist task',action('create',repeating,paused,blocking));};
    const manual=async slot=>{
      const pending=f.manual();await until(()=>f.calls.length===slot);
      await record('manual worker entered',[action('requestManual',slot),action('captureManualRead',slot),action('manualRead',slot)]);return {pending};
    };
    try { await body(f,record,create,manual); traces.push(trace); }
    finally { await f.close(); }
  }
  await scenario('stop rejects new manual execution and timer restart',async(f,record,create)=>{
    await create();await f.stop();await record('stop completes',[action('stop'),action('awaitStop')]);
    const result=await attempt(f.service.executeTaskById(f.id));assert.equal(result.error?.code,'TASK_SERVICE_STOPPED');
    f.service.startTimer();await record('rejected manual admission and stopped timer',[{...action('requestManual',1),reject:true},action('startTimer')]);
  });
  await scenario('stop drains an undelivered read before restart',async(f,record,create)=>{
    await create();const read={entered:gate(),release:gate()};f.holdRead=read;const old=f.manual();await read.entered.promise;
    await record('read captured',[action('requestManual',1),action('captureManualRead',1)]);
    const stopping=f.stop();assert.equal(f.stopReturned,false,'Stop must not settle while an admitted read is held');
    await record('stop waits for the undelivered read',action('stop'));
    read.release.resolve();const result=await old;assert.equal(result.error?.code,'TASK_SERVICE_STOPPED');
    assert.equal(f.calls.length,0,'The retired read cannot enter a worker');await stopping;
    await record('retired read rejected and drained',[action('manualRead',1),action('awaitStop')]);
    f.newService();await record('new service retains persisted task',action('restart'));
  });
  for(const first of [1,2])for(const outcome of ['preserve','failure']){
    await scenario(`two owners retain tracking, ${first} finishes ${outcome}`,async(f,record,create,manual)=>{
      await create(true,false,false);const jobs=[await manual(1),await manual(2)];
      await f.finish(first,outcome);const result=await jobs[first-1].pending;assert.equal(!!result.error,outcome==='failure');
      await record('first owner settles',action('finish',first,outcome));
      if(outcome==='failure'){f.now+=1000;await record('retry becomes due',action('due',true));}
      await f.runtime.patchTaskMetadata(f.id, {set:{blocking:true}, unset:[]});
      await record('metadata switches to exclusive dispatch',action('setBlocking',true));
      const tick=await f.runDue();assert.equal(tick.error,undefined);assert.equal(f.calls.length,2);
      await record('blocking timer suppressed',[action('runDue'),action('queryResult',true),action('preflight',true),action('skipDispatch')]);
      const stop=f.stop();await record('stop waits for remaining owner',action('stop'));
      await f.finish(3-first);await jobs[2-first].pending;await stop;
      await record('remaining owner drains',[action('finish',3-first,'preserve'),action('awaitStop')]);
    });
  }
  await scenario('blocking repeat excludes a second manual owner',async(f,record,create,manual)=>{
    await create();const first=await manual(1);
    const second=await f.manual();assert.equal(second.error,undefined);assert.equal(f.calls.length,1);
    await record('second manual call does not enter worker',[action('requestManual',2),action('captureManualRead',2),action('manualRead',2)]);
    await f.finish(1);await first.pending;await record('exclusive owner completes',action('finish',1,'preserve'));
  });
  await scenario('nonblocking scheduler overlaps manual owner',async(f,record,create,manual)=>{
    await create(true,false,false);const manualJob=await manual(1);const tick=f.runDue();await until(()=>f.calls.length===2);
    await record('nonblocking tick admitted',[action('runDue'),action('queryResult',true),action('preflight',true),action('dispatch',2)]);
    await f.finish(1);await manualJob.pending;await record('manual owner settles',action('finish',1,'preserve'));
    await f.finish(2);await tick;await record('tick settles',action('finish',2,'preserve'));
  });
  await scenario('deleting a running task keeps drain ownership',async(f,record,create,manual)=>{
    await create();const job=await manual(1);await f.runtime.deleteTask(f.id);
    await record('task row deleted',action('deleteTask'));
    const stop=f.stop();await record('stop still waits for worker',action('stop'));
    await f.finish(1);await job.pending;await stop;
    await record('deleted task worker drains',[action('finish',1,'preserve'),action('awaitStop')]);
  });
  await scenario('empty timer disarms until dirty notification',async(f,record)=>{
    f.service.startTimer();await record('local timer starts',action('startTimer'));
    await [...f.timers][0]();await record('empty query disarms',[action('timerTick'),action('queryResult',true)]);
    assert.equal(f.timers.size,0); await record('empty queue has no scheduled callback',null);
    f.service.markDirty();await record('explicit mutation notification',action('markDirty'));
  });
  await scenario('query failure rearms timer',async(f,record)=>{
    f.service.startTimer();await record('timer starts',action('startTimer'));
    f.runtime.getTasks=async()=>{throw Error('controlled task query failure');};
    await [...f.timers][0]();f.runtime.getTasks=f.originalQuery;
    await record('failed query rearms',[action('timerTick'),action('queryResult',false),action('rearm')]);
  });
  await scenario('orphan grace, quarantine and later worker healing',async(f,record,create)=>{
    await create();f.installWorker(false);await record('worker withdrawn',action('worker',false));
    await f.runDue();await record('boot grace skips orphan',[action('runDue'),action('queryResult',true),action('preflight',true)]);
    f.now+=60001;await record('grace expires',action('ageGrace'));
    const orphan=await f.runDue();assert.equal(orphan.error,undefined);
    await record('quarantine persisted',[action('runDue'),action('queryResult',true),action('preflight',true),action('quarantineResult',true)]);
    f.installWorker(true);await record('worker restored',action('worker',true));
    await f.runDue();await record('healing skips current tick',[action('runDue'),action('queryResult',true),action('preflight',true),action('healResult',true)]);
  });
  await scenario('failed quarantine retains truthful durable state',async(f,record,create)=>{
    await create();f.installWorker(false);f.now+=60001;await record('missing worker after grace',[action('worker',false),action('ageGrace')]);
    const update=f.runtime.updateTask;f.runtime.updateTask=async()=>{throw Error('controlled quarantine write failure');};
    const result=await f.runDue();f.runtime.updateTask=update;assert.equal(result.error?.code,'TASK_TICK_FAILED');
    await record('failed quarantine records only memory marker',[action('runDue'),action('queryResult',true),action('preflight',true),action('quarantineResult',false)]);
  });
  const receipt=await checkTraces({model:'TaskServiceLifecycle',modelPath:'specs/quint/services/TaskServiceLifecycle.qnt',
    sources:loaded.sources,driverHashes:loaded.driverHashes,traces,scope:'bounded-component',
    assumptions:['One persisted task, three invocation identities, two service generations and two failure-count classes.',
      'Real AgentRuntime, SQL adapter and migrations. External worker completions, query/write refusal and injected clock are controlled.',
      'The task due predicate, individual persisted wake fields, multi-task queue ordering and host daemon ownership remain separate obligations.']});
  return {receipts:[receipt],obligations:[{model:'TaskServiceLifecycle',obligation:'Expand timing, wake revisions, multi-task ordering and daemon registration beyond the current finite lifecycle schedules.',reason:'Current campaign observes concrete one-task lifecycle fields and ownership boundaries.'}]};
}

test('TaskService source traces refine counted execution, stop and persistent orphan state', {timeout: 300000}, async () => {
  const result=await runTaskServiceRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(result.receipts.length,1);
  const receipt=result.receipts[0];
  assert.equal(receipt.model,'TaskServiceLifecycle');
  assert.equal(receipt.invariant,'safety');
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,13);
  assert.equal(receipt.checkpoints,85);
  assert.equal(receipt.sourceCapture,'before driver execution');
  assert.equal(receipt.driverInputsBound,true);
  assert.ok(receipt.observedFields.includes('s.tracked'));
  assert.ok(receipt.observedFields.includes('s.quarantined'));
  assert.ok(result.obligations.length>0);
});
