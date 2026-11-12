import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {stripTypeScriptTypes} from './support/strip-types.mjs';
const event={title:'Synthetic Calendar event',description:'',location:'',startAt:'2026-10-16',endAt:'2026-10-17',timeZone:null,isAllDay:true,attendees:[],recurrence:[]};

test('canonical timed digests preserve all-day dates and read legacy checkpoints before either side changes',async()=>{
 const load=async file=>import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(fs.readFileSync(file,'utf8'),{mode:'strip'})).toString('base64'));
 const current=await load('.eliza/client-features/packages/contracts/src/calendar-linked-sync.ts');
 const legacy=await load('vendor/eliza/packages/contracts/src/calendar-linked-sync.ts');
 const original={...event,startAt:'2026-10-15T15:00:00-04:00',endAt:'2026-10-15T16:00:00-04:00',timeZone:'America/New_York',isAllDay:false};
 const equivalent={...original,startAt:'2026-10-15T19:00:00.000Z',endAt:'2026-10-15T20:00:00Z'};
 assert.equal(await current.linkedCalendarSemanticDigest(original),await current.linkedCalendarSemanticDigest(equivalent));
 for(const changed of [{startAt:'2026-10-15T19:01:00Z'},{endAt:'2026-10-15T20:01:00Z'},{timeZone:'America/Chicago'},{title:'Changed title'},{description:'Changed details'},{attendees:[{email:'other@example.invalid'}]}])assert.notEqual(await current.linkedCalendarSemanticDigest(original),await current.linkedCalendarSemanticDigest({...original,...changed}));
 assert.notEqual(await current.linkedCalendarSemanticDigest(event),await current.linkedCalendarSemanticDigest({...event,startAt:'2026-10-17',endAt:'2026-10-18'}));
 for(const changed of ['neither','mixed-local','mixed-provider','local','interval','zone','provider']){
  const localEvent={...original,...(changed==='mixed-local'?equivalent:changed==='local'?{title:'Edited locally'}:changed==='interval'?{startAt:'2026-10-15T19:01:00Z'}:changed==='zone'?{timeZone:'America/Chicago'}:{})};
  const providerEvent={...original,...(changed==='mixed-provider'?equivalent:changed==='provider'?{title:'Edited in Cloud'}:{})};
  const effects=[];let row={id:'legacy-link',agentId:'agent',localEventId:'42',connectorAccountId:'connection',providerCalendarId:'primary',providerEventId:'remote',providerEtag:'old-etag',localRevision:'old-revision',lastCommonSemanticHash:await legacy.linkedCalendarSemanticDigest(original),state:'clean',pendingOperation:null,idempotencyKey:'legacy-link',lastErrorCode:null,lastErrorMessage:null,createdAt:'2026-10-15',updatedAt:'2026-10-15'};
  const local={get:async()=>({eventId:'42',revision:'new-revision',event:localEvent}),applyProviderEvent:async(id,value)=>{effects.push('pull');return {eventId:id,revision:'pulled',event:value};},delete:async()=>{throw Error('Unexpected deletion');}};
  const provider={get:async()=>({eventId:'remote',etag:'new-etag',event:providerEvent}),update:async(record,value)=>{effects.push('push');return {eventId:'remote',etag:'updated',event:value};},create:async()=>{throw Error('Unexpected create');},delete:async()=>{throw Error('Unexpected deletion');}};
  const reconciler=new current.LinkedCalendarReconciler({save:async(record,patch)=>(row={...record,...patch})},local,provider);
  assert.equal(await reconciler.reconcile(row),['neither','mixed-local','mixed-provider'].includes(changed)?'clean':changed==='provider'?'pulled':'pushed');
  assert.deepEqual(effects,['neither','mixed-local','mixed-provider'].includes(changed)?[]:[changed==='provider'?'pull':'push']);
 }
});
