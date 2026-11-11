/** Existing source/model forward replays. The observer records actual per-checkpoint
 * comparisons; a successful summary alone never establishes a receipt. */
import {fileURLToPath} from 'node:url';
import {register} from 'tsx/esm/api';
import {observedReplay} from '../observed-replay.mjs';
import {modelNames} from './maps-model-traces.mjs';

const load=(module,name,options)=>async()=>{
 const unregister=module.endsWith('-replay.mjs')&&!process.versions.bun?register():null;
 try{const loaded=await import(module);return await loaded[name](options);}finally{await unregister?.();}
};
const named=(model,module,name)=>load(module,name,modelNames(`specs/quint/services/${model}.qnt`));
const definitions=[
 ['ApprovalDecision',load('./approval-decision-replay.mjs','runApprovalDecisionReplay'),'approvalProjection','Actual workflow approval UI, journal and controlled agent decisions; the nested engine and pending-request projection is checked at every original scenario/random checkpoint.'],
 ['ContactsSession',load('./contacts-session-replay.mjs','runContactsSessionReplay'),'contactsProjection','The existing admitted read-only Contacts host/editor projection over actual adapter, feature admission and held native ports.'],
 ['InboxEditCoalescer',load('./inbox-edit-coalescer-replay.mjs','runInboxEditCoalescerReplay'),'coalescerProjection','Actual pending edit, controlled timer, storage writes and lifecycle state compared with the existing full coalescer projection.'],
 ['MapsConnection',named('MapsConnection','./maps-connection.mjs','replayMapsConnection'),'connectionProjection','The existing Cloud Maps connection ownership, generation, installed provider and transport projection. Existing counterfactual cutoffs remain explicit.'],
 ['MapsGuidanceVoice',named('MapsGuidanceVoice','./maps-guidance-voice.mjs','replayMapsGuidanceVoice'),'voiceProjection','The real guidance voice queue and controlled speaker, using the existing projection that excludes the input speechHidden flag and serializes actual start tuples.'],
 ['MmsCompose',load('./mms-compose-replay.mjs','runMmsComposeReplay'),'mmsProjection','Actual Messages MMS adapter state over controlled chooser and journaled telephony ports, retaining all original scenarios, witnesses and random bounds.'],
 ['PhoneSession',load('./phone-session-replay.mjs','runPhoneSessionReplay'),'phoneProjection','The actual Phone page busy/access/notice projection over held read and dial ports; busy is the disjunction of source read and dial latches.'],
 ['ResidentMapsRelayOffer',named('ResidentMapsRelayOffer','./resident-maps-relay-offer.mjs','replayResidentMapsRelayOffer'),'relayProjection','The actual resident navigation relay and controlled offer transport, preserving existing counterfactual cutoff and turn-registration projection.'],
 ['ServiceReadCache',load('./service-read-cache-replay.mjs','runServiceReadCacheReplay'),'cacheProjection','Actual per-owner/service stored documents, cache epochs, readable values and pending store exchanges under controlled clocks and storage gates.'],
 ['SmsSend',load('./sms-send-replay.mjs','runSmsSendReplay'),'smsProjection','Actual Messages SMS adapter state over held journaled telephony ports; operation identities are actual first-seen ID classes.'],
 ['SystemPickerVisibility',load('./system-picker-visibility.mjs','replaySystemPickerVisibility',{traces:300,maxSteps:20}),'pickerProjection','Actual system-picker ownership counter and file-picker ownership. Independent dialog machines are intentionally outside this projection and remain separate obligations.'],
 ['TriggerCursor',load('./trigger-cursor-replay.mjs','runTriggerCursorReplay'),'cursorProjection','Actual development trigger runtime queue, cursors and completed-check report under controlled foreground, location, workflow and storage inputs.'],
 ['WebReadingReview',load('./web-reading-review.mjs','checkWebReadingReview'),'readingProjection','The actual excerpt dialog and local speech projection, including permanent sensitive-text refusal, current speaker completion and retained typed text.'],
 ['WorkflowLifecycleChange',load('./workflow-lifecycle-change-replay.mjs','runWorkflowLifecycleChangeReplay'),'lifecycleProjection','Actual workflow lifecycle view, journal, request and controlled agent readbacks. A held pre-journal request observes its actual captured version/operation/identity rather than model values.'],
];

export function serviceForwardReplayCampaigns(extraSources=[]){
 return definitions.map(([model,run,prefix,projection])=>['forwardReplay'+model,async()=>{
  const receipt=await observedReplay({model,run,prefix,projection,extraSources:[fileURLToPath(import.meta.url),...extraSources],assumptions:[
   projection,
   'The original per-step equality, refusal, named-scenario, witness and action guards are retained. Expected-failure mutation guards remain in their owning host tests, outside this passing-replay receipt.',
   'The before/after binding over-approximates tracked product, fixture and generated client source. Controlled ports, finite random/scenario bounds and this explicit projection do not establish universal refinement or installed device acceptance.',
  ]});
  return{receipt,obligations:[{model,obligation:'Unmodeled component state, arbitrary schedules and installed acceptance',reason:projection}]};
 }]);
}
