import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {createAppUpdateScheduler} from '../../../../.eliza/client-features/packages/ui/src/state/app-update-gate.ts';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.ts';
import {checkTraces} from '../check-traces.mjs';
import {boundInputs,captureSources,checkpoint,deferred,read,tick,trace,call} from './support.mjs';

export async function checkAutomaticAppUpdateSchedule() {
  const model='AutomaticAppUpdateSchedule', modelPath='specs/quint/application/'+model+'.qnt';
  const shared='packages/ui/src/state/app-update-gate.ts';
  const sources=[fileURLToPath(import.meta.url),'apps/app/src/prototype/settings-adapter.ts',
    'apps/app/src/main.tsx','vendor/eliza/'+shared,'.eliza/client-features/'+shared,
    '.eliza/client-features/.source.json','scripts/prepare-client-features.ts',
    'scripts/pinned-upstream-source.ts','test/support/strip-types.mjs','upstream.lock.json'];
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
  const product=read('apps/app/src/prototype/settings-adapter.ts');
  const facts=product.slice(product.indexOf('// settings-facts:begin'),product.indexOf('// settings-facts:end'));
  const cacheSource=product.slice(product.indexOf('const UPDATE_KEY = '),product.indexOf('// settings-reads:begin'));
  const pollStart=product.indexOf('  async function pollAutomaticUpdate(');
  const pollSource=product.slice(pollStart,product.indexOf('\n  let gmail =',pollStart));
  assert.ok(pollStart>0&&facts&&cacheSource&&pollSource,'actual renderer update cache and poll exist');
  const signer='5c'.repeat(32),hash='0a'.repeat(32),manifestSha256='2b'.repeat(32);
  const offer={schema:'alpha-update/v1',variant:'launcher',signerSha256:signer,versionCode:8,
    apkUrl:'https://example.test/launcher-8.apk',sha256:hash,sizeBytes:500};

  async function runPoll(name,sequence){
    let now=0,next=0,wallClock=0,current,api,phase='idle',checkWait,factsWait,installWait;
    let failed=false,inFlight=0,maxInFlight=0,pendingRead=false,manualReply,nextIdentity=0;
    let modalOpen=false;
    const jobs=new Map(),storage=new Map(),identities=new WeakMap();
    const shell={screen:'home',view:null,voice:'off',typing:false,chat:'input'};
    const document={querySelector:()=>null,querySelectorAll:()=>modalOpen?[{closest:()=>null}]:[]};
    const input={pending:false,offer,manifestSha256};
    const reply=()=>({manifest:JSON.stringify(input.offer),manifestSha256:input.manifestSha256});
    const cachedOffer=()=>{
      const saved=api.savedUpdate();
      if(!saved.manifestSha256)return 0;
      if(!identities.has(saved))identities.set(saved,++nextIdentity);
      return identities.get(saved);
    };
    const cachedManual=()=>!!api.parseUpdateManifest(api.savedUpdate().manifest,{versionCode:7,launcher:true,signerSha256:signer});
    const observed={capability:'unread',pending:false,candidate:false,requests:0,cachedOffer:0,attemptedOffer:0,cachedManual:false,
      lastCapability:'unread',lastPending:false,lastCandidate:false,lastCurrent:false,lastIdle:false};
    const idle=()=>api.automaticUpdateIdle(shell,{busy:false,open:false},false,false,document);
    const context=vm.createContext({URL,Number,Date:{now:()=>wallClock},Capacitor:{isNativePlatform:()=>true},
      localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
      document,
      owner:{S:()=>shell,voiceConversationActive:()=>false},connectionController:{getSnapshot:()=>({busy:false,open:false})},
      updateBusy:'',changed(){},
      device:{
        checkForUpdate:()=>{
          if(manualReply)return Promise.resolve(manualReply);
          phase='check';checkWait=deferred();return checkWait.promise;
        },
        snapshot:()=>{phase='facts';factsWait=deferred();return factsWait.promise;},
        updateState:async()=>{pendingRead=input.pending;return {pending:pendingRead};},
        installUpdate:async request=>{
          const selected=input.offer;
          assert.deepEqual(JSON.parse(JSON.stringify(request)),{apkUrl:selected.apkUrl,sha256:selected.sha256,
            sizeBytes:selected.sizeBytes,versionCode:selected.versionCode,automatic:true,manifestSha256:input.manifestSha256});
          phase='install';observed.requests++;observed.attemptedOffer=cachedOffer();
          observed.lastCapability=observed.capability;
          observed.lastPending=observed.pending;observed.lastCandidate=observed.candidate;
          observed.lastCurrent=current();observed.lastIdle=idle();
          maxInFlight=Math.max(maxInFlight,++inFlight);installWait=deferred();
          try{return await installWait.promise;}finally{inFlight--;}
        }},system:{getBuildInfo:async()=>({launcher:true})}});
    vm.runInContext(stripTypeScriptTypes(facts.replace(/^export /gm,'')+'\n'+cacheSource+'\n'+pollSource+
      '\nglobalThis.api={pollAutomaticUpdate,automaticUpdateIdle,parseUpdateManifest,savedUpdate,checkForUpdate,UPDATE_CHECK_INTERVAL_MS};',{mode:'strip'}),context);
    api=context.api;
    const scheduler=createAppUpdateScheduler({intervalMs:4,retryMs:1,now:()=>now,
      schedule(callback,delay){const id=++next;jobs.set(id,{callback,due:now+delay});return id;},cancel(id){jobs.delete(id);},
      async run(owned){current=owned;failed=false;try{await api.pollAutomaticUpdate(owned);}catch(error){failed=true;throw error;}}});
    const observe=()=>{
      const state=scheduler.snapshot();return Object.fromEntries([
        ...Object.entries(state).map(([key,value])=>['state.'+key,value]),['state.valid',!state.busy||current()],['now',now],
        ...Object.entries({...observed,phase:state.busy?phase:'idle'}).map(([key,value])=>['poll.'+key,value])]);
    };
    const result=trace(name,observe());
    const save=(label,actions)=>checkpoint(result,label,actions,observe());
    const f={
      active(value){scheduler.setActive(value);save('real scheduler changes renderer ownership',call('active',value));},
      advance(value){now=value;save('only scheduler clock advances',call('advance',value));},
      pending(value){input.pending=value;},invalidOffer(){input.offer={...offer,signerSha256:'6d'.repeat(32)};},
      bind(value){input.manifestSha256=value?manifestSha256:undefined;},
      idle(value){shell.view=value?null:'notes';},
      modal(open){modalOpen=open;},
      async begin(elapseCacheInterval=true){
        const due=[...jobs].find(([,job])=>job.due<=now);assert.ok(due);jobs.delete(due[0]);
        if(elapseCacheInterval)wallClock+=api.UPDATE_CHECK_INTERVAL_MS;
        observed.capability='unread';observed.pending=false;observed.candidate=false;
        due[1].callback();await tick();assert.equal(phase,'check');assert.equal(scheduler.snapshot().busy,true);
        save('actual renderer awaits manifest check',call('beginPoll'));
      },
      async check(available=true){
        if(available)checkWait.resolve(reply());else checkWait.reject(Error('controlled offline response'));
        await tick();
        if(!available)observed.cachedOffer=cachedOffer();
        const actions=[call('readCheck',available,idle())];
        if(!scheduler.snapshot().busy)actions.push(call('finishPoll',failed));
        save('actual post-manifest owner and idle guards',actions);
      },
      async facts(capability){
        const answer={appVersionCode:7,appSigner:signer,appAutomaticUpdates:capability};
        const before=observed.requests;
        observed.capability=capability;observed.pending=pendingRead;
        observed.candidate=cachedManual();observed.cachedManual=observed.candidate;
        observed.cachedOffer=cachedOffer();
        factsWait.resolve(answer);await tick();
        const actions=[call('readFacts',capability,pendingRead,observed.candidate,idle(),observed.cachedOffer)];
        if(observed.requests!==before)actions.push(call('dispatch'));
        else{assert.equal(scheduler.snapshot().busy,false);actions.push(call('finishPoll',failed));}
        save('actual native facts either defer, refuse, retire or dispatch',actions);
      },
      async replaceOffer(){
        // A concurrent successful manual check may return identical bytes. It still
        // creates a new authoritative cache object that the old attempt cannot retire.
        manualReply=reply();
        try{assert.equal(await api.checkForUpdate(true),true);}finally{manualReply=undefined;}
        observed.cachedOffer=cachedOffer();observed.cachedManual=cachedManual();
        save('the manual check replaces the exact cached object',call('replaceOffer',observed.cachedOffer));
      },
      async reply(status='answered',nativeReply=status==='answered'?{}:{status}){
        installWait.resolve(nativeReply);await tick();assert.equal(scheduler.snapshot().busy,false);
        observed.cachedOffer=cachedOffer();observed.cachedManual=cachedManual();
        save('actual native result reconciles only the attempted offer and feeds bounded backoff',
          [call('installReply',status),call('finishPoll',failed)]);
      },
      dispose(){scheduler.dispose();save('dispose invalidates actual renderer callback',call('dispose'));},
      snapshot:()=>scheduler.snapshot(),jobs,requests:()=>observed.requests,
      cachedOffer,cachedManual,persisted:()=>storage.get('alpha.app-update.v1'),
    };
    try{await sequence(f);assert.ok(maxInFlight<=1,'actual native calls never overlap');traces.push(result);}
    finally{scheduler.dispose();assert.equal(jobs.size,0);}
  }
  await runPoll('renderer_snapshot_starting_then_supported',async f=>{
    f.active(true);await f.begin();await f.check();await f.facts('starting');
    assert.equal(f.requests(),0);assert.equal(f.snapshot().wakeAt,1);
    f.advance(1);await f.begin();await f.check();await f.facts('supported');await f.reply();assert.equal(f.requests(),1);
  });
  await runPoll('renderer_modal_after_manifest_defers_install_until_closed',async f=>{
    f.active(true);await f.begin();await f.check();f.modal(true);await f.facts('supported');
    assert.equal(f.requests(),0);assert.equal(f.snapshot().wakeAt,1);
    f.modal(false);f.advance(1);await f.begin();await f.check();await f.facts('supported');await f.reply();
    assert.equal(f.requests(),1);
  });
  await runPoll('renderer_install_starting_then_supported',async f=>{
    f.active(true);await f.begin();await f.check();await f.facts('supported');await f.reply('starting');
    assert.equal(f.requests(),1);assert.equal(f.snapshot().wakeAt,1);
    f.advance(1);await f.begin();await f.check();await f.facts('supported');await f.reply();assert.equal(f.requests(),2);
  });
  for(const capability of ['permission-required','unsupported','starting'])await runPoll('renderer_fact_refusal_'+capability.replaceAll('-','_'),async f=>{
    if(capability==='starting')f.pending(true);
    f.active(true);await f.begin();await f.check();await f.facts(capability);
    assert.equal(f.requests(),0);assert.equal(f.snapshot().failures,0);assert.equal(f.snapshot().wakeAt,4);
  });
  await runPoll('renderer_candidate_still_requires_exact_signer',async f=>{
    f.invalidOffer();f.active(true);await f.begin();await f.check();await f.facts('supported');assert.equal(f.requests(),0);
  });
  for(const cut of ['facts','install'])for(const disposition of ['resume','dispose'])await runPoll('renderer_'+cut+'_starting_after_'+disposition,async f=>{
    f.active(true);await f.begin();await f.check();if(cut==='install')await f.facts('supported');
    if(disposition==='dispose')f.dispose();else{f.active(false);f.active(true);}
    assert.equal(f.jobs.size,0,'in-flight work cannot overlap after ownership changes');
    if(cut==='facts')await f.facts('starting');else await f.reply('starting');
    assert.equal(f.requests(),cut==='facts'?0:1);
    if(disposition==='dispose'){f.active(true);assert.equal(f.jobs.size,0);}
    else{await f.begin();await f.check();await f.facts('supported');await f.reply();assert.equal(f.requests(),cut==='facts'?1:2);}
  });
  for(const status of ['permission-required','unsupported'])await runPoll('renderer_install_refusal_'+status.replaceAll('-','_'),async f=>{
    f.active(true);await f.begin();await f.check();await f.facts('supported');await f.reply(status);
    assert.equal(f.snapshot().failures,0);assert.equal(f.snapshot().wakeAt,4);
  });
  await runPoll('renderer_unbound_offer_rechecks_before_dispatch',async f=>{
    f.bind(false);f.active(true);await f.begin();await f.check();await f.facts('supported');
    assert.equal(f.requests(),0);assert.equal(f.snapshot().wakeAt,1);
    f.bind(true);f.advance(1);await f.begin(false);await f.check();await f.facts('supported');await f.reply();
    assert.equal(f.requests(),1);
  });
  const withdrawn={status:'offer-withdrawn'};
  const replacement={status:'offer-response-changed',manifest:JSON.stringify({...offer,versionCode:9})};
  const malformed={status:'offer-response-changed',manifest:replacement.manifest+'// trailing'};
  const unavailable={status:'offer-unavailable'};
  for(const answer of [withdrawn,replacement])await runPoll('renderer_'+answer.status.replaceAll('-','_')+'_clears_exact_cache_then_rechecks',async f=>{
    f.active(true);await f.begin();await f.check();await f.facts('supported');await f.reply('offer-retired',answer);
    assert.equal(f.cachedOffer(),0);assert.equal(f.persisted(),undefined);assert.equal(f.snapshot().wakeAt,1);
    assert.equal(f.cachedManual(),false);
    f.advance(1);await f.begin(false);await f.check();await f.facts('supported');await f.reply();
    assert.equal(f.requests(),2);
  });
  for(const answer of [unavailable,malformed])await runPoll('renderer_'+answer.status.replaceAll('-','_')+'_retains_manual_then_rechecks',async f=>{
    f.active(true);await f.begin();await f.check();await f.facts('supported');await f.reply('offer-unavailable',answer);
    assert.equal(f.cachedOffer(),0);assert.equal(f.cachedManual(),true);assert.equal(f.snapshot().wakeAt,1);
    assert.equal(JSON.parse(f.persisted()).manifestSha256,undefined);
    f.advance(1);await f.begin(false);await f.check();await f.facts('supported');await f.reply();
    assert.equal(f.requests(),2);
  });
  for(const answer of [withdrawn,unavailable])await runPoll('renderer_'+answer.status.replaceAll('-','_')+'_preserves_concurrent_refresh',async f=>{
    f.active(true);await f.begin();await f.check();await f.facts('supported');
    const original=f.cachedOffer();
    await f.replaceOffer();const refreshed=f.cachedOffer();
    assert.notEqual(refreshed,original);
    const stored=f.persisted();
    await f.reply(answer===withdrawn?'offer-retired':'offer-unavailable',answer);
    assert.equal(f.cachedOffer(),refreshed);assert.equal(f.persisted(),stored);assert.equal(f.snapshot().wakeAt,1);
  });
  return checkTraces(boundInputs({model,modelPath,sources,traces,scope:'bounded-component',
    assumptions:['Actual authenticated shared timer scheduler and actual Alpha cache and poll execute with controlled promise cutpoints. Generic scheduler scenarios remain distinct from product-poll scenarios.',
      'Positive offer identities follow observed cache object identity and a native digest; zero is absent or unbound. The manual row is observed independently. The native staging model owns actual feed byte and selected APK tuple validation.',
      'Cache wall time is controlled separately from the scheduler model clock. Ordinary scenarios advance the cache interval to reach a native check; stale and unbound recovery runs before that interval to prove forced refresh.',
      'Native capability classes are starting, supported, permission-required and unsupported. SDK/consent/uptime ownership belongs to the native admission model; no native boot clock is duplicated here.',
      'One scheduler instance, interval4/retry1 clock units, at most two native requests in source traces. A native request is a bridge call, not proof of a created PackageInstaller session or installation.',
      'Progress requires foreground timer delivery and settling native calls. Android background scheduling, network availability and physical silent installation require separate evidence.']}));
}
