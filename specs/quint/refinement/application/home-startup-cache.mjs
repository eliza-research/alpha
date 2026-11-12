import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces} from '../check-traces.mjs';
import {boundInputs,bundledSource,call,captureSources,checkpoint,trace} from './support.mjs';

export async function checkHomeStartupCache(extraSources=[]) {
  const compiled=await bundledSource('apps/app/src/runtime/home-startup-cache.ts');
  const sources=[fileURLToPath(import.meta.url),...compiled.sources,...extraSources];
  captureSources(sources);
  const traces=[];
  for(const actions of [[],['beforeConnection'],['otherOwner'],['otherScope'],['retire'],['nextDay'],['queueWrite','clearStored','finishWrite']]) {
    const data=new Map([['alpha.connection.cloud-service.v1','production']]);
    const store={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
    let owner=0,scope=0,active=true,today=true,epoch=0,queued=false,queuedEpoch=0;
    const context=()=>({owner:owner<0?null:{environment:'production',userId:'owner-'+owner,organizationId:'org',credentialId:'credential'},scope:scope<0?null:'scope-'+scope,allowed:active,restoring:owner<0});
    const cache=new compiled.exports.HomeStartupCache(store,context,()=>new Date(2026,10,today?12:13,12));
    cache.remember({homeCalendarTitle:'Saved meeting'});await Promise.resolve();
    assert.ok(cache.read());
    const observe=()=>({'s.owner':owner,'s.scope':scope,'s.active':active,'s.today':today,
      's.stored':data.has(compiled.exports.HOME_STARTUP_CACHE),'s.epoch':epoch,
      's.queued':queued,'s.queuedEpoch':queuedEpoch,visible:cache.read()!==null});
    const currentTrace=trace(actions.join('-')||'first-render',observe());
    for(const action of actions) {
      if(action==='beforeConnection'){owner=-1;scope=-1;}
      if(action==='otherOwner')owner=1;
      if(action==='otherScope')scope=1;
      if(action==='retire')active=false;
      if(action==='nextDay')today=false;
      if(action==='queueWrite'){queued=true;queuedEpoch=epoch;cache.remember({homeCalendarTitle:'Updated meeting'});}
      if(action==='clearStored'){
        const previous=globalThis.localStorage;
        globalThis.localStorage=store;
        try{compiled.exports.clearHomeStartupCache();}finally{globalThis.localStorage=previous;}
        epoch++;
      }
      if(action==='finishWrite'){await Promise.resolve();queued=false;}
      checkpoint(currentTrace,action,call(action),observe());
    }
    traces.push(currentTrace);
  }
  return checkTraces(boundInputs({model:'HomeStartupCache',sources,traces,scope:'bounded-component',
    assumptions:['The real browser cache executes with two account and agent identities, one day transition and a queued write interrupted by credential clearance.','The cache grants no mutation authority. Native secure storage and live provider reads remain outside this browser-only cache.']}));
}
