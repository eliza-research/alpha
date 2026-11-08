import {Capacitor} from '@capacitor/core';
import {registerPlugin} from '../platform-plugins.ts';
import {
 CRASH_LOG_MAX_ENTRIES,
 CRASH_LOG_RETENTION_MS,
 describeNativeCrashEntry,
 errorClassOf,
 sanitizeCrashEntry,
 type CrashLogPort,
 type NativeCrashEntry,
 type RendererFailureKind,
} from '../../../../.eliza/client-features/plugins/plugin-native-system/src/crash-log.ts';

/**
 * Alpha's binding of the shared privacy-bounded problem log (@elizaos/capacitor-system/crash-log;
 * native crash.CrashLog in no-backup storage, reached through AlphaDevice). Entries hold failure
 * classes only; the shared module owns the native allowlist, renderer error naming and entry text.
 * Alpha adds only its renderer-owned finite Cloud inference records and the browser-profile copy
 * used by web builds.
 */
export {CRASH_LOG_MAX_ENTRIES,CRASH_LOG_RETENTION_MS,errorClassOf};
export type {RendererFailureKind};
export type CrashSource=NativeCrashEntry['source']|'inference';
export type CrashEntry=Omit<NativeCrashEntry,'source'>&{source:CrashSource;inference?:CloudInferenceFailure};
export type CrashLog={entries:CrashEntry[];exitHistory:boolean};

export const browserCrashLogKey='alpha.crash-log.v1';


/** Exact v1 public status projection. Unknown strings are never retained. */
export const INFERENCE_SCHEMA_KEYWORDS=['pattern','minLength','maxLength','format','minItems','maxItems','oneOf','allOf','not','if','then','else','dependentRequired','dependentSchemas','patternProperties','unevaluatedProperties','$anchor'] as const;
export const INFERENCE_PARAMETERS=['tools','response_format','tool_choice','messages','model','max_tokens','temperature','reasoning_effort'] as const;
export const INFERENCE_TOOL_NAMES=['HANDLE_RESPONSE','READ_CONTEXT','RESTORE_CONTEXT','PROPOSE_DEVICE_ACTION','DISCOVER_ACTIONS','FINISH','REPLY','IGNORE','STOP','FACTS_AND_RELATIONSHIPS_VALIDATE','other'] as const;
const inferenceStages=['response-handler','action-planner','text','other'] as const;
const inferenceReasons=['unsupported-schema-keyword','invalid-parameter','context-window','unavailable-model','rate-limit','credits','transport','unknown','schema-limit'] as const;
export type CloudInferenceFailure={version:1;at:number;stage:typeof inferenceStages[number];status?:number;reason:typeof inferenceReasons[number];parameter?:typeof INFERENCE_PARAMETERS[number];keyword?:typeof INFERENCE_SCHEMA_KEYWORDS[number];strictTools:Array<typeof INFERENCE_TOOL_NAMES[number]>;schemaKeywords:Array<typeof INFERENCE_SCHEMA_KEYWORDS[number]>;schemaScanTruncated:boolean;schemaDepth?:number;schemaProperties?:number;schemaEnumValues?:number;schemaTextChars?:number};
const member=<T extends string>(value:unknown,values:readonly T[]):value is T=>typeof value==='string'&&values.includes(value as T);
export function sanitizeCloudInferenceFailure(value:unknown,now=Date.now()):CloudInferenceFailure|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 if(v.version!==1||!Number.isSafeInteger(v.at)||typeof v.at!=='number'||v.at<=now-CRASH_LOG_RETENTION_MS||v.at>now+60_000||!member(v.stage,inferenceStages)||!member(v.reason,inferenceReasons)||!Array.isArray(v.strictTools)||!Array.isArray(v.schemaKeywords)||typeof v.schemaScanTruncated!=='boolean')return null;
 if(v.strictTools.length>INFERENCE_TOOL_NAMES.length||v.schemaKeywords.length>INFERENCE_SCHEMA_KEYWORDS.length)return null;
 const strictTools=v.strictTools,schemaKeywords=v.schemaKeywords;
 const out:CloudInferenceFailure={version:1,at:v.at,stage:v.stage,reason:v.reason,strictTools:INFERENCE_TOOL_NAMES.filter(x=>strictTools.includes(x)),schemaKeywords:INFERENCE_SCHEMA_KEYWORDS.filter(x=>schemaKeywords.includes(x)),schemaScanTruncated:v.schemaScanTruncated};
 for(const key of ['schemaDepth','schemaProperties','schemaEnumValues','schemaTextChars'] as const){const value=v[key];if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=(key==='schemaDepth'?24:100000))out[key]=value;}
 if(typeof v.status==='number'&&Number.isInteger(v.status)&&v.status>=400&&v.status<=599)out.status=v.status;
 if(member(v.parameter,INFERENCE_PARAMETERS))out.parameter=v.parameter;
 if(member(v.keyword,INFERENCE_SCHEMA_KEYWORDS))out.keyword=v.keyword;
 return out;
}

const native=registerPlugin<CrashLogPort>('AlphaDevice');

/** Keeps only allowlisted fields with allowlisted shapes (shared rules, plus Alpha's inference records). */
export function sanitizeCrashEntries(value:unknown,now=Date.now()):CrashEntry[]{
 if(!Array.isArray(value))return [];
 const out:CrashEntry[]=[];
 for(const raw of value){
  if(raw&&typeof raw==='object'&&(raw as Record<string,unknown>).source==='inference'){
   const item=raw as Record<string,unknown>,at=item.at;
   if(typeof at!=='number'||!Number.isSafeInteger(at)||at<=now-CRASH_LOG_RETENTION_MS||at>now+CRASH_LOG_RETENTION_MS)continue;
   const inference=sanitizeCloudInferenceFailure(item.inference,now);if(inference&&inference.at===at)out.push({at,source:'inference',inference});continue;
  }
  const entry=sanitizeCrashEntry(raw,now);if(entry)out.push(entry);
 }
 return out.sort((a,b)=>a.at-b.at).slice(-CRASH_LOG_MAX_ENTRIES);
}

function readBrowser():CrashEntry[]{
 try{const raw=localStorage.getItem(browserCrashLogKey);return raw?sanitizeCrashEntries(JSON.parse(raw)?.entries):[];}catch{return [];}
}
function inferenceSeenAt(now=Date.now()):number{
 try{const value=JSON.parse(localStorage.getItem(browserCrashLogKey)||'{}').inferenceSeenAt;return typeof value==='number'&&Number.isSafeInteger(value)&&value>now-CRASH_LOG_RETENTION_MS&&value<=now+60_000?value:0;}catch{return 0;}
}
function writeBrowser(entries:CrashEntry[],seenAt=inferenceSeenAt()){
 try{localStorage.setItem(browserCrashLogKey,JSON.stringify({version:1,entries:sanitizeCrashEntries(entries),inferenceSeenAt:seenAt}));return true;}catch{return false;/* Storage blocked: the log is best effort. */}
}

/** Recorded locally by the renderer on every platform, separate from Android crash storage. */
export function recordCloudInferenceFailure(value:unknown,now=Date.now()):boolean{
 try{const inference=sanitizeCloudInferenceFailure(value,now);if(!inference||inference.at<=inferenceSeenAt(now))return false;return writeBrowser([...readBrowser(),{at:inference.at,source:'inference',inference}],inference.at);}catch{return false;}
}

const recent=new Map<string,number>();
/** Best effort and never throws: a failing log must not hide the failure it describes. */
export async function recordRendererFailure(kind:RendererFailureKind,error:unknown,now=Date.now()):Promise<void>{
 const errorClass=errorClassOf(error),key=kind+':'+errorClass;
 // A repeating failure is recorded once a minute so it cannot flush older problems out.
 if((recent.get(key)??-Infinity)>now-60_000)return;
 recent.set(key,now);
 try{
  if(Capacitor.isNativePlatform())await native.recordRendererFailure({kind,errorClass});
  else writeBrowser([...readBrowser(),{at:now,source:'renderer',kind,errorClass}]);
 }catch{/* Unrecorded. */}
}

export async function readCrashLog():Promise<CrashLog>{
 if(!Capacitor.isNativePlatform())return {entries:readBrowser(),exitHistory:false};
 const result=await native.crashLog();
 return {entries:sanitizeCrashEntries([...sanitizeCrashEntries(result?.entries),...readBrowser()]),exitHistory:result?.exitHistory===true};
}

export async function clearCrashLog():Promise<void>{
 recent.clear();
 if(Capacitor.isNativePlatform())await native.clearCrashLog();
 if(!writeBrowser([],inferenceSeenAt()))throw Error('Problem log clear not confirmed');
}

/** One line per entry for Settings: time, where, and class or reason. */
export function describeCrashEntry(entry:CrashEntry):{title:string;detail:string}{
 if(entry.source==='inference'){const v=entry.inference;return {title:'Cloud AI request failed',detail:v?[v.stage,v.reason,v.status?`HTTP ${v.status}`:'',v.parameter,v.keyword,...(['schemaDepth','schemaProperties','schemaEnumValues','schemaTextChars'] as const).flatMap(key=>v[key]===undefined?[]:[`${({schemaDepth:'Depth',schemaProperties:'Properties',schemaEnumValues:'Enum values',schemaTextChars:'Schema text chars'})[key]} ${v[key]}`]),v.schemaScanTruncated?'Schema scan incomplete':''].filter(Boolean).join(' · '):'Details unavailable'};}
 return describeNativeCrashEntry({...entry,source:entry.source});
}
