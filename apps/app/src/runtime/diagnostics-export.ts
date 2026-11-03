import {sanitizeRealtimeTiming} from '../../../../.eliza/client-features/packages/voice/src/realtime-voice-timing.ts';
import {sanitizeCrashEntries,type CrashEntry} from './crash-log.ts';
import type {PlanAdmission, PlanStatus, SubscriptionView} from './subscription-entitlement.ts';
import type {VoiceTimingLive,VoiceTimingEndpoint} from './voice-timing.ts';

/**
 * Redacted support diagnostics. The report is built by copying allowlisted fields whose
 * values match strict shapes (versions, a 40-hex pin, 64-hex hashes, booleans, enum
 * values, failure classes). Everything else is dropped rather than scrubbed, so note text,
 * mail, addresses, provider keys, tokens, session and account identifiers, URLs and other
 * apps' package names cannot reach the export even if a caller passes them in. Voice latency
 * records keep their timing fields only (marks, and for a live turn the ASR mode, partial count
 * and three spans); no transcript, partial or reply text is ever copied. Native voice timing
 * (issue #395, AlphaVoiceCloud.nativeVoiceTiming) keeps its monotonic marks, random turn ids, fixed
 * labels and build/model hashes only; it never carries audio, transcripts or replies.
 */
export const DIAGNOSTICS_FORMAT='alpha-diagnostics/v1';
export const RUNTIME_ASSETS=['agent/alpha-source.json','agent/agent-bundle.js','agent/workflow-worker/manifest.json','agent/workflow-worker/files.sha256'] as const;
const PERMISSIONS=['Microphone','Location','Camera','Calendar','Notifications'] as const;
const ROLES=['home','assistant','dialer','sms'] as const;
// 'starting'/'recovering' are the resident before it has a session (P-43); 'offline' only parses older exports.
const CONNECTIONS=['starting','recovering','offline','resident','remote','local','cloud'] as const;
// Voice latency records (voice-timing.ts): the same allowlists as its validator and the aggregator.
export const VOICE_TIMING_FORMAT='alpha-voice-timing-v1';
const VOICE_MARKS=['recording-end','transcript-ready','send','first-token','final-reply','first-audio'] as const;
const VOICE_ROUTES=['on-device','browser','local-agent','eliza-cloud','paired-agent','development-agent','manual'] as const;
const VOICE_LIMIT=200;
const version=/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const pin=/^[0-9a-f]{40}$/;
const sha256=/^[0-9a-f]{64}$/;
const turnId=/^[0-9a-f-]{36}$/;
// Native voice latency (alpha-native-voice-timing-v3, VoiceLatencyTrials): the aggregator's allowlists.
export const NATIVE_VOICE_TIMING_FORMAT='alpha-native-voice-timing-v3';
const NATIVE_MARKS=['last-user-audio','endpoint','asr-final','request','first-token','tts-start','tts-ready','first-pcm','audible-playback'] as const;
const NATIVE_LIMIT=512;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const nativeId=/^[0-9a-f]{0,40}-[0-9a-f]{1,16}-[0-9]{1,10}$/;
const fixedLabel=/^[A-Za-z0-9+-]{1,80}$/;
const deviceLabel=/^[A-Za-z0-9 ._()+-]{1,80}$/;

export type DiagnosticsInput={
 generatedAt?:unknown;platform?:unknown;
 app?:{version?:unknown;versionCode?:unknown;variant?:unknown;buildType?:unknown;testMocks?:unknown};
 os?:{androidRelease?:unknown;securityPatch?:unknown;sdkInt?:unknown};
 upstreamPin?:unknown;runtimeHashes?:unknown;permissions?:unknown;roles?:unknown;crashes?:unknown;
 connection?:{kind?:unknown;connected?:unknown};
 /** Existing presentation/admission state only; never raw entitlement or billing responses. */
 cloudPlan?:{view?:unknown;source?:unknown;status?:unknown;admission?:unknown;reason?:unknown};
 /** Parsed exportVoiceTiming() output. */
 voiceTiming?:unknown;
 /** Raw bounded realtime document; sanitizer parses it only after size checks. */
 realtimeVoiceTiming?:unknown;
 /** AlphaVoiceCloud.nativeVoiceTiming() output (alpha-native-voice-timing-v3). */
 nativeVoiceTiming?:unknown;
};
type NativeVoiceTimingIdentity={sourceCommit:string;sourceDirty:boolean;engineSha256:string;modelSha256:string;models?:Record<string,string>;device:string;environment:'device'|'emulator';abi:'arm64-v8a'|'x86_64';sdk?:number;build:string};
type NativeVoiceTimingRow={id:string;turnId:string;pipeline:string;clock:'native-monotonic-ms';captureClock:string;cold:boolean;coldReason?:string;outcome:string;reason?:string;audibleClock?:string;network?:string;thermal?:string;thermalHeadroom?:number;identity:NativeVoiceTimingIdentity;marks:Record<string,number>};
type VoiceTimingRow={version:1;id:string;recordedAt:number;route:string;cold:boolean;entry?:'conversation'|'notes';policy?:'auto-send'|'review';marks:Record<string,number>;live?:VoiceTimingLive;endpoint?:VoiceTimingEndpoint;heard?:string;nativeTurn?:string;outcome?:'abandoned';
 /** Conversation path, derived from the copied enums: 'live' (the echo-cancelled voice assistant: it
  * records endpointing, or streaming ASR) or 'batch' (the recorded-clip loop, live mode 'batch'). */
 path?:'live'|'batch'};
export type DiagnosticsReport={
 realtimeVoiceTiming?:ReturnType<typeof sanitizeRealtimeTiming>;
 format:typeof DIAGNOSTICS_FORMAT;generatedAt:string;platform:'android'|'web';
 app:{version:string|null;versionCode?:number;variant?:'launcher'|'standalone';buildType?:'debug'|'release';testMocks?:boolean};
 os:{androidRelease?:string;securityPatch?:string;sdkInt?:number};
 upstreamPin:string|null;
 runtimeHashes:Record<string,string>;
 permissions:Record<string,boolean>;
 roles:Array<{role:string;held:boolean;available:boolean}>;
 connection:{kind:string;connected:boolean};
 cloudPlan?:{view:SubscriptionView['kind'];source?:'entitlement'|'billing-limits';status?:PlanStatus;admission:PlanAdmission;reason?:'outage'|'not-published'|'invalid'};
 crashes:{count:number;recent:CrashEntry[]};
 /** A complete alpha-voice-timing-v1 document, readable by scripts/aggregate-voice-latency.mjs. */
 voiceTiming:{format:typeof VOICE_TIMING_FORMAT;marks:string[];records:VoiceTimingRow[]};
 /** A complete alpha-native-voice-timing-v3 document, readable by scripts/aggregate-voice-latency.mjs. */
 nativeVoiceTiming:{format:typeof NATIVE_VOICE_TIMING_FORMAT;clock:'CLOCK_MONOTONIC';units:'ms';marks:string[];dropped:number;records:NativeVoiceTimingRow[]};
};

const text=(value:unknown,pattern:RegExp)=>typeof value==='string'&&pattern.test(value)?value:undefined;
const one=<T extends string>(value:unknown,allowed:readonly T[]):T|undefined=>allowed.includes(value as T)?value as T:undefined;

/** Copies the timing fields of each record only: route, entry, policy, cold, a random turn id,
 * the record time and millisecond marks. Any other field (transcript or reply text, accounts)
 * is dropped, even if a stored record carries it. */
function voiceTimingRows(input:unknown):VoiceTimingRow[]{
 const document=input&&typeof input==='object'?input as Record<string,unknown>:{};
 if(document.format!==VOICE_TIMING_FORMAT||!Array.isArray(document.records))return [];
 const rows:VoiceTimingRow[]=[];
 for(const value of document.records.slice(-VOICE_LIMIT)){
  if(!value||typeof value!=='object'||Array.isArray(value))continue;
  const row=value as Record<string,unknown>,route=one(row.route,VOICE_ROUTES),id=text(row.id,turnId);
  if(row.version!==1||!id||!route||typeof row.cold!=='boolean'||!Number.isSafeInteger(row.recordedAt)||(row.recordedAt as number)<0)continue;
  const raw=row.marks&&typeof row.marks==='object'&&!Array.isArray(row.marks)?row.marks as Record<string,unknown>:null;
  if(!raw)continue;
  const marks:Record<string,number>={};
  for(const mark of VOICE_MARKS){const at=raw[mark];if(typeof at==='number'&&Number.isFinite(at)&&at>=0&&at<3_600_000)marks[mark]=at;}
  const out:VoiceTimingRow={version:1,id,recordedAt:row.recordedAt as number,route,cold:row.cold,marks};
  const entry=one(row.entry,['conversation','notes'] as const);if(entry)out.entry=entry;
  const policy=one(row.policy,['auto-send','review'] as const);if(policy)out.policy=policy;
  // Live ASR numbers only (voice-timing.ts recordLiveVoiceTiming): mode, a count and three spans.
  const live=row.live&&typeof row.live==='object'&&!Array.isArray(row.live)?row.live as Record<string,unknown>:null;
  const liveMode=live?one(live.mode,['stream','batch','unknown'] as const):undefined;
  if(live&&liveMode&&Number.isSafeInteger(live.partials)&&(live.partials as number)>=0&&(live.partials as number)<=100000){
   const numbers:VoiceTimingLive={mode:liveMode,partials:live.partials as number};
   for(const key of ['firstPartialMs','finalFromSpeechEndMs','asrFinalFromSpeechEndMs'] as const){const at=live[key];if(typeof at==='number'&&Number.isFinite(at)&&at>=0&&at<3_600_000)numbers[key]=Math.round(at);}
   out.live=numbers;
  }
  // Voice-assistant endpointing (#423; chain path local or clef) and heard-content outcomes: enums and numbers only.
  const endpoint=row.endpoint&&typeof row.endpoint==='object'&&!Array.isArray(row.endpoint)?row.endpoint as Record<string,unknown>:null;
  const by=endpoint?one(endpoint.by,['semantic','gap'] as const):undefined,semantic=endpoint?one(endpoint.semantic,['complete','incomplete','unavailable','timeout','error','not-asked'] as const):undefined;
  if(endpoint&&by&&semantic){
   const value:VoiceTimingEndpoint={by,semantic};
   const reason=one(endpoint.reason,['voice-not-started','ffi-context-unloaded','scorer-unsupported','ram-pressure','unscored','timeout','too-long','invalid-response','unknown','clef-disabled','clef-unavailable','clef-timeout','clef-error','clef-too-long'] as const);if(reason)value.reason=reason;
   // The end-of-turn chain stage that answered: the local fused scorer or Clef.
   const path=one(endpoint.path,['local','clef'] as const);if(path)value.path=path;
   if(typeof endpoint.latencyMs==='number'&&Number.isFinite(endpoint.latencyMs)&&endpoint.latencyMs>=0&&endpoint.latencyMs<3_600_000)value.latencyMs=Math.round(endpoint.latencyMs);
   out.endpoint=value;
  }
  const heard=one(row.heard,['recorded','unchanged','not-needed','nothing-heard','conflict','not-found','unavailable','rejected','stale','invalid'] as const);if(heard)out.heard=heard;
  const nativeTurn=text(row.nativeTurn,uuid);if(nativeTurn)out.nativeTurn=nativeTurn;
  if(row.outcome==='abandoned')out.outcome='abandoned';
  if(out.entry==='conversation'){const path=out.endpoint||out.live?.mode==='stream'?'live':out.live?.mode==='batch'?'batch':undefined;if(path)out.path=path;}
  rows.push(out);
 }
 return rows;
}

function nativeIdentity(value:unknown):NativeVoiceTimingIdentity|undefined{
 const id=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;if(!id)return undefined;
 const sourceCommit=text(id.sourceCommit,pin),engineSha256=id.engineSha256==='unavailable'?'unavailable':text(id.engineSha256,sha256),modelSha256=text(id.modelSha256,sha256),device=text(id.device,deviceLabel);
 const environment=one(id.environment,['device','emulator'] as const),abi=one(id.abi,['arm64-v8a','x86_64'] as const),build=text(id.build,/^(standalone|launcher)-(debug|release)$/);
 if(!sourceCommit||typeof id.sourceDirty!=='boolean'||!engineSha256||!modelSha256||!device||!environment||!abi||!build)return undefined;
 const out:NativeVoiceTimingIdentity={sourceCommit,sourceDirty:id.sourceDirty,engineSha256,modelSha256,device,environment,abi,build};
 const models=id.models&&typeof id.models==='object'&&!Array.isArray(id.models)?id.models as Record<string,unknown>:null;
 if(models){const kept:Record<string,string>={};for(const key of ['asr','vad','tts']){const hash=text(models[key],sha256);if(hash)kept[key]=hash;}out.models=kept;}
 if(Number.isSafeInteger(id.sdk)&&(id.sdk as number)>0&&(id.sdk as number)<1000)out.sdk=id.sdk as number;
 return out;
}
/** Copies the native trials' timing fields only: ids, fixed labels, hashes and monotonic marks. */
function nativeVoiceRows(input:unknown):{dropped:number;records:NativeVoiceTimingRow[]}{
 const document=input&&typeof input==='object'?input as Record<string,unknown>:{};
 if(document.format!==NATIVE_VOICE_TIMING_FORMAT||!Array.isArray(document.records))return {dropped:0,records:[]};
 const records:NativeVoiceTimingRow[]=[];
 for(const value of document.records.slice(-NATIVE_LIMIT)){
  if(!value||typeof value!=='object'||Array.isArray(value))continue;
  const row=value as Record<string,unknown>,identity=nativeIdentity(row.identity);
  const id=text(row.id,nativeId),turn=text(row.turnId,uuid),pipeline=one(row.pipeline,['live-voice','harness-no-inference'] as const);
  const captureClock=one(row.captureClock,['audiorecord-timestamp','read-return','synthetic-feed'] as const),outcome=one(row.outcome,['passed','failed','abandoned'] as const);
  if(!identity||!id||!turn||!pipeline||row.clock!=='native-monotonic-ms'||!captureClock||!outcome||typeof row.cold!=='boolean')continue;
  const raw=row.marks&&typeof row.marks==='object'&&!Array.isArray(row.marks)?row.marks as Record<string,unknown>:null;if(!raw)continue;
  const marks:Record<string,number>={};
  for(const mark of NATIVE_MARKS){const at=raw[mark];if(typeof at==='number'&&Number.isFinite(at)&&at>=0&&at<1e12)marks[mark]=at;}
  const out:NativeVoiceTimingRow={id,turnId:turn,pipeline,clock:'native-monotonic-ms',captureClock,cold:row.cold,outcome,identity,marks};
  const coldReason=text(row.coldReason,fixedLabel);if(coldReason)out.coldReason=coldReason;
  const reason=text(row.reason,fixedLabel);if(reason)out.reason=reason;
  const audibleClock=one(row.audibleClock,['audiotrack-timestamp','audiotrack-head-position','mediaplayer-timestamp'] as const);if(audibleClock)out.audibleClock=audibleClock;
  const network=one(row.network,['offline','wifi','cellular','ethernet','other','unknown'] as const);if(network)out.network=network;
  const thermal=one(row.thermal,['none','light','moderate','severe','critical','emergency','shutdown','unknown'] as const);if(thermal)out.thermal=thermal;
  if(typeof row.thermalHeadroom==='number'&&Number.isFinite(row.thermalHeadroom)&&row.thermalHeadroom>=0&&row.thermalHeadroom<100)out.thermalHeadroom=row.thermalHeadroom;
  records.push(out);
 }
 const dropped=Number.isSafeInteger(document.dropped)&&(document.dropped as number)>=0?document.dropped as number:0;
 return {dropped,records};
}

export function buildDiagnostics(input:DiagnosticsInput,now=Date.now()):DiagnosticsReport{
 const app=input.app&&typeof input.app==='object'?input.app:{},os=input.os&&typeof input.os==='object'?input.os:{};
 const generatedAt=typeof input.generatedAt==='number'&&Number.isSafeInteger(input.generatedAt)?input.generatedAt:now;
 const report:DiagnosticsReport={
  format:DIAGNOSTICS_FORMAT,generatedAt:new Date(generatedAt).toISOString(),platform:input.platform==='android'?'android':'web',
  app:{version:text(app.version,version)??null},os:{},
  upstreamPin:text(input.upstreamPin,pin)??null,runtimeHashes:{},permissions:{},roles:[],
  connection:{kind:one(input.connection?.kind,CONNECTIONS)??'starting',connected:input.connection?.connected===true},
  crashes:{count:0,recent:[]},
  voiceTiming:{format:VOICE_TIMING_FORMAT,marks:[...VOICE_MARKS],records:voiceTimingRows(input.voiceTiming)},
  nativeVoiceTiming:{format:NATIVE_VOICE_TIMING_FORMAT,clock:'CLOCK_MONOTONIC',units:'ms',marks:[...NATIVE_MARKS],...nativeVoiceRows(input.nativeVoiceTiming)},
 };
 if(input.realtimeVoiceTiming!==undefined)report.realtimeVoiceTiming=sanitizeRealtimeTiming(input.realtimeVoiceTiming);
 if(Number.isSafeInteger(app.versionCode)&&(app.versionCode as number)>=0)report.app.versionCode=app.versionCode as number;
 const variant=one(app.variant,['launcher','standalone'] as const);if(variant)report.app.variant=variant;
 const buildType=one(app.buildType,['debug','release'] as const);if(buildType)report.app.buildType=buildType;
 if(typeof app.testMocks==='boolean')report.app.testMocks=app.testMocks;
 const cloud=input.cloudPlan;
 const view=one(cloud?.view,['checking','active','credits','inactive','unavailable','expired'] as const);
 const admission=one(cloud?.admission,['admit','admit-with-warning','needs-plan','unknown'] as const);
 if(view&&admission){
  report.cloudPlan={view,admission};
  const source=one(cloud?.source,['entitlement','billing-limits'] as const);if(source)report.cloudPlan.source=source;
  const status=one(cloud?.status,['active','trialing','past_due','canceled','none'] as const);if(status)report.cloudPlan.status=status;
  const reason=one(cloud?.reason,['outage','not-published','invalid'] as const);if(reason)report.cloudPlan.reason=reason;
 }
 const release=text(os.androidRelease,version);if(release)report.os.androidRelease=release;
 const patch=text(os.securityPatch,/^\d{4}-\d{2}-\d{2}$/);if(patch)report.os.securityPatch=patch;
 if(Number.isSafeInteger(os.sdkInt)&&(os.sdkInt as number)>0&&(os.sdkInt as number)<1000)report.os.sdkInt=os.sdkInt as number;
 const hashes=input.runtimeHashes&&typeof input.runtimeHashes==='object'?input.runtimeHashes as Record<string,unknown>:{};
 for(const asset of RUNTIME_ASSETS){const value=text(hashes[asset],sha256);if(value)report.runtimeHashes[asset]=value;}
 const permissions=input.permissions&&typeof input.permissions==='object'?input.permissions as Record<string,unknown>:{};
 for(const name of PERMISSIONS)if(typeof permissions[name]==='boolean')report.permissions[name]=permissions[name] as boolean;
 if(Array.isArray(input.roles))for(const row of input.roles){
  const role=one(row?.role,ROLES);
  // Only Alpha's own state. Other role holders are other apps' package names and stay out.
  if(role&&!report.roles.some(r=>r.role===role))report.roles.push({role,held:row.held===true,available:row.available===true});
 }
 const crashes=sanitizeCrashEntries(input.crashes,now);
 report.crashes={count:crashes.length,recent:crashes.slice(-20)};
 return report;
}

export function diagnosticsText(report:DiagnosticsReport){return JSON.stringify(report,null,2)+'\n';}
export function diagnosticsFileName(report:DiagnosticsReport){return `alpha-diagnostics-${report.generatedAt.replace(/[:.]/g,'-')}.json`;}
