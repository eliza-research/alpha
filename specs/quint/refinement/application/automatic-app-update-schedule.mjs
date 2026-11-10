import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createAppUpdateScheduler} from '../../../../.eliza/client-features/packages/ui/src/state/app-update-gate.ts';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.mjs';
import {checkTraces} from '../check-traces.mjs';
import {boundInputs,captureSources,checkpoint,deferred,read,tick,trace,call} from './support.mjs';

export async function checkAutomaticAppUpdateSchedule() {
  const model='AutomaticAppUpdateSchedule', modelPath='specs/quint/application/'+model+'.qnt';
  const shared='packages/ui/src/state/app-update-gate.ts';
  const sources=[fileURLToPath(import.meta.url),'apps/app/src/prototype/settings-adapter.ts',
    'apps/app/src/main.tsx','vendor/eliza/'+shared,'.eliza/client-features/'+shared,
    '.eliza/client-features/.source.json','scripts/prepare-client-features.mjs',
    'scripts/pinned-upstream-source.mjs','upstream.lock.json'];
  captureSources([...sources,modelPath]);
  checkClientFeatures();
  const stamp=JSON.parse(read('.eliza/client-features/.source.json'));
  const digest=createHash('sha256').update(read('.eliza/client-features/'+shared)).digest('hex');
  const pinned=createHash('sha256').update(read('vendor/eliza/'+shared)).digest('hex');
  assert.equal(stamp.files[shared],digest);
  assert.equal(stamp.sourceFiles[shared],pinned);
  assert.equal(digest,pinned,'the prepared updater is the exact reviewed upstream source');
  assert.equal(Object.hasOwn(stamp,'appUpdateResumePatch'),false,'the retired updater patch has no receipt');
  const traces=[];
  async function run(name,sequence){
    let now=0, next=0, current, pending;
    const jobs=new Map();
    const scheduler=createAppUpdateScheduler({intervalMs:4,retryMs:1,now:()=>now,
      schedule(callback,delay){const id=++next;jobs.set(id,{callback,due:now+delay});return id;},
      cancel(id){jobs.delete(id);},
      run(owned){assert.equal(pending,undefined,'only one bridge operation may run');current=owned;pending=deferred();return pending.promise;}});
    const observe=()=>{const state=scheduler.snapshot();return Object.fromEntries([
      ...Object.entries(state).map(([key,value])=>['state.'+key,value]),['state.valid',!state.busy||current()],['now',now]]);};
    const result=trace(name,observe());
    const save=(label,...action)=>checkpoint(result,label,call(...action),observe());
    const f={
      active(value){scheduler.setActive(value);save('foreground ownership changes','active',value);},
      advance(value){now=value;save('controlled clock advances','advance',value);},
      async begin(){const due=[...jobs].find(([,job])=>job.due<=now);assert.ok(due,'a due timer must exist');jobs.delete(due[0]);due[1].callback();await tick();save('one due timer starts one bridge operation','begin');},
      async finish(failed){assert.ok(pending);const wait=pending;pending=undefined;if(failed)wait.reject(Error('controlled offline response'));else wait.resolve();await tick();save('bridge completion schedules bounded next attempt','finish',failed);},
      dispose(){scheduler.dispose();save('unmounted host retires timer and authority','dispose');},
      snapshot:()=>scheduler.snapshot(), current:()=>current?.(), jobs,
    };
    try{await sequence(f);traces.push(result);}finally{scheduler.dispose();assert.equal(jobs.size,0);}
  }
  await run('remains_foreground_without_resume',async f=>{f.active(true);await f.begin();await f.finish(false);f.advance(3);assert.equal([...f.jobs.values()].some(job=>job.due<=3),false);f.advance(4);await f.begin();await f.finish(false);});
  await run('offline_backoff_then_recovery',async f=>{f.active(true);await f.begin();await f.finish(true);f.advance(1);await f.begin();await f.finish(true);f.advance(3);await f.begin();await f.finish(true);f.advance(7);await f.begin();await f.finish(false);});
  await run('resume_does_not_overlap_late_operation',async f=>{f.active(true);await f.begin();f.active(false);assert.equal(f.current(),false);f.active(true);assert.equal(f.current(),false);assert.equal(f.jobs.size,0);await f.finish(false);await f.begin();await f.finish(false);});
  await run('unmount_retires_late_operation',async f=>{f.active(true);await f.begin();f.dispose();assert.equal(f.current(),false);await f.finish(true);f.active(true);assert.equal(f.jobs.size,0);});
  return checkTraces(boundInputs({model,modelPath,sources,traces,scope:'bounded-component',
    assumptions:['Actual authenticated shared timer scheduler executes with a controlled monotonic clock and bridge completions.',
      'Progress requires foreground timer delivery and settling native calls. Android background scheduling, network availability and physical silent installation require separate evidence.']}));
}
