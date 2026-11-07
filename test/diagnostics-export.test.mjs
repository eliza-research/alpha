// Settings > About "Export diagnostics": the report copies allowlisted shapes only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDiagnostics,diagnosticsText,DIAGNOSTICS_FORMAT,sanitizeNativeInferenceTiming} from '../apps/app/src/runtime/diagnostics-export.ts';
import {sanitizeCrashEntries,errorClassOf,describeCrashEntry} from '../apps/app/src/runtime/crash-log.ts';

const now=Date.UTC(2026,9,8,12);
const pin='45242af234e7f3d55c433f327798e7cb2130e06e';
const hash='a'.repeat(64);
// Synthetic sensitive values: note text, a provider key, a bearer token, account and session ids, mail and a URL.
const secrets=['Buy milk and call Dana at 555-0100','csk-synthetic-provider-key-7f3a9c0e5b','Bearer synthetic-session-token','acct_7f3a9c0e5b11','6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11','dana@example.com','https://agent.example.test/api','com.example.otherlauncher','/data/user/0/ai.elizaresearch.alphaphone'];

const nativeInference={version:1,traceId:'ab'.repeat(16),totalMs:8000,timeToFirstVisibleMs:7700,timeToReplyMs:7750,timeToResponseFinalizedMs:7900,stages:[{stage:'llm-inference',totalMs:6700,toFirstVisibleMs:6600},{stage:'actions',totalMs:900,toFirstVisibleMs:900}]};
test('native inference export keeps fixed durations and a valid trace, never arbitrary span or identity data',()=>{
 const row={...nativeInference,roomId:secrets[4],messageId:secrets[3],label:secrets[0],meta:{token:secrets[2]},spans:[{name:secrets[0]}],stages:nativeInference.stages.map(stage=>({...stage,model:secrets[1]}))};
 const report=buildDiagnostics({platform:'android',nativeInferenceTiming:row},now);
 assert.deepEqual(report.nativeInferenceTiming,nativeInference);
 for(const secret of secrets)assert.equal(diagnosticsText(report).includes(secret),false);
 assert.equal(buildDiagnostics({platform:'web',nativeInferenceTiming:row},now).nativeInferenceTiming,undefined);
 for(const bad of [null,{}, {...row,version:2},{...row,totalMs:Infinity},{...row,timeToReplyMs:-1},{...row,stages:[{stage:secrets[0],totalMs:1,toFirstVisibleMs:null}]},{...row,stages:[...row.stages,row.stages[0]]}])assert.equal(sanitizeNativeInferenceTiming(bad),undefined);
 for(const traceId of [secrets[4],'0'.repeat(32),'AB'.repeat(16),'ab'.repeat(17)])assert.equal(sanitizeNativeInferenceTiming({...row,traceId}).traceId,undefined);
 assert.equal(sanitizeNativeInferenceTiming({get version(){throw Error('diagnostics must not throw');}}),undefined);
});

test('diagnostics keep versions, pin, runtime hashes, permission and role state and crash classes',()=>{
 const report=buildDiagnostics({generatedAt:now,platform:'android',
  app:{version:'0.1.0',versionCode:7,variant:'launcher',buildType:'release',testMocks:false},
  os:{androidRelease:'16',securityPatch:'2026-09-05',sdkInt:36},upstreamPin:pin,
  runtimeHashes:{'agent/alpha-source.json':hash,'agent/agent-bundle.js':'b'.repeat(64)},
  permissions:{Microphone:true,Location:false,Camera:true,Calendar:false},
  roles:[{role:'home',held:true,available:true,holders:['ai.elizaresearch.alphaphone']},{role:'assistant',held:false,available:true,holders:['com.example.otherlauncher']}],
  connection:{kind:'resident',connected:true},
  crashes:[{at:now-1000,source:'uncaught',errorClass:'java.lang.IllegalStateException',rootClass:'java.io.IOException',thread:'main',process:'main'},{at:now-500,source:'exit',reason:'anr',process:':isolated_pdf'},{at:now-100,source:'renderer',kind:'render',errorClass:'TypeError'}],
 },now);
 assert.equal(report.format,DIAGNOSTICS_FORMAT);
 assert.deepEqual(report.app,{version:'0.1.0',versionCode:7,variant:'launcher',buildType:'release',testMocks:false});
 assert.deepEqual(report.os,{androidRelease:'16',securityPatch:'2026-09-05',sdkInt:36});
 assert.equal(report.upstreamPin,pin);
 assert.deepEqual(report.runtimeHashes,{'agent/alpha-source.json':hash,'agent/agent-bundle.js':'b'.repeat(64)});
 assert.deepEqual(report.permissions,{Microphone:true,Location:false,Camera:true,Calendar:false});
 assert.deepEqual(report.roles,[{role:'home',held:true,available:true},{role:'assistant',held:false,available:true}]);
 assert.deepEqual(report.connection,{kind:'resident',connected:true});
 assert.equal(report.crashes.count,3);
 assert.deepEqual(report.crashes.recent.map(e=>e.errorClass??e.reason),['java.lang.IllegalStateException','anr','TypeError']);
 assert.doesNotMatch(diagnosticsText(report),/otherlauncher|holders/);
});

test('redaction: content, keys, tokens, account and session ids, mail, URLs and paths never reach the export',()=>{
 const [note,key,token,account,session,mail,url,otherApp,path]=secrets;
 const report=buildDiagnostics({generatedAt:now,platform:'android',
  app:{version:`0.1.0 ${mail}`,versionCode:'7',variant:url,buildType:token,testMocks:'yes'},
  os:{androidRelease:note,securityPatch:path,sdkInt:1e9},upstreamPin:key,
  runtimeHashes:{'agent/alpha-source.json':key,[note]:hash,'agent/agent-bundle.js':hash.toUpperCase()},
  permissions:{Microphone:'granted',Contacts:true,[mail]:true,Calendar:true},
  roles:[{role:otherApp,held:true,available:true},{role:'home',held:'yes',available:true,holders:[otherApp]},{role:'home',held:true}],
  connection:{kind:session,connected:'true',sessionId:session,accountId:account,origin:url},
  crashes:[
   {at:now-1,source:'uncaught',errorClass:`Error: ${note}`,rootClass:path,message:note,stack:`at ${url}`,thread:note,process:path},
   {at:now-2,source:'exit',reason:note,process:'main'},
   {at:now-3,source:'renderer',kind:'render',errorClass:'TypeError',text:key},
   {at:now-4,source:'note',errorClass:'Error'},
   {at:now-40*24*60*60*1000,source:'renderer',kind:'render',errorClass:'OldError'},
  ],
  notes:[note],apiKey:key,authorization:token,accountId:account,email:mail,
 },now);
 const json=diagnosticsText(report);
 for(const secret of secrets)assert.equal(json.includes(secret),false,`leaked ${secret}`);
 for(const fragment of ['Dana','555-0100','synthetic','example','acct_','6f1d3c3e','/data/','Bearer','OldError','message','stack','notes','apiKey'])assert.equal(json.includes(fragment),false,`leaked ${fragment}`);
 assert.equal(report.app.version,null);assert.equal(report.upstreamPin,null);
 assert.deepEqual(report.app,{version:null});assert.deepEqual(report.os,{});assert.deepEqual(report.runtimeHashes,{});
 assert.deepEqual(report.permissions,{Calendar:true});
 assert.deepEqual(report.roles,[{role:'home',held:false,available:true}]);
 // An unparseable kind defaults to the resident starting state (P-43), never "offline".
 assert.deepEqual(report.connection,{kind:'starting',connected:false});
 // The uncaught entry survives as a class-free record; the bad exit reason and unknown source are dropped.
 assert.deepEqual(report.crashes.recent,[{at:now-3,source:'renderer',kind:'render',errorClass:'TypeError'},{at:now-1,source:'uncaught'}]);
 assert.deepEqual(Object.keys(report).sort(),['app','connection','crashes','format','generatedAt','nativeVoiceTiming','os','permissions','platform','roles','runtimeHashes','upstreamPin','voiceTiming']);
});

test('crash entries keep classes only, are bounded and expire after 30 days',()=>{
 const many=Array.from({length:80},(_,i)=>({at:now-80+i,source:'renderer',kind:'uncaught',errorClass:'RangeError'}));
 const kept=sanitizeCrashEntries(many,now);
 assert.equal(kept.length,50);assert.equal(kept[0].at,now-50);
 assert.deepEqual(sanitizeCrashEntries('not a list',now),[]);
 assert.equal(errorClassOf(new TypeError('secret note text')),'TypeError');
 const custom=new Error('x');custom.name='Account 12345 failed';
 assert.equal(errorClassOf(custom),'Error');
 assert.equal(errorClassOf('a string with content'),'string');
 assert.deepEqual(describeCrashEntry({at:now,source:'exit',reason:'anr',process:':isolated_pdf'}),{title:'App process stopped: anr',detail:'Reported by Android · :isolated_pdf process'});
 assert.deepEqual(describeCrashEntry({at:now,source:'uncaught',errorClass:'java.lang.IllegalStateException',rootClass:'java.io.IOException',thread:'main'}),{title:'App crashed',detail:'java.lang.IllegalStateException · caused by java.io.IOException · main thread'});
});

test('renderer voice startup exports only the bounded phase, outcome and elapsed time',()=>{
 const diagnostic={stage:'draft-binding',outcome:'timeout',elapsedMs:12000};
 const report=buildDiagnostics({voiceStartup:{...diagnostic,account:secrets[3],message:secrets[0]}},now);
 assert.deepEqual(report.voiceStartup,diagnostic);
 assert.doesNotMatch(diagnosticsText(report),/acct_|Buy milk/);
 assert.equal(buildDiagnostics({voiceStartup:{...diagnostic,stage:secrets[0]}},now).voiceStartup,undefined);
 assert.equal(buildDiagnostics({voiceStartup:{...diagnostic,elapsedMs:Infinity}},now).voiceStartup,undefined);
});
test('renderer startup phase times retain only known stages and sum to the measured attempt',()=>{
 const attempt={stage:'draft-binding',outcome:'timeout',elapsedMs:12000};
 const phaseMs={'conversation-selection':120,'draft-binding':11880};
 const report=buildDiagnostics({voiceStartup:{...attempt,phaseMs:{...phaseMs,[secrets[3]]:1}}},now);
 assert.deepEqual(report.voiceStartup,{...attempt,phaseMs});
 assert.ok(!diagnosticsText(report).includes(secrets[3]));
 for(const invalid of [{...phaseMs,'draft-binding':11900},{...phaseMs,'draft-binding':-1},{'conversation-selection':12000}])
  assert.deepEqual(buildDiagnostics({voiceStartup:{...attempt,phaseMs:invalid}},now).voiceStartup,attempt);
});
test('Cloud startup diagnostics keep bounded stages and status without carrying content or raw ids',()=>{
 const secret=secrets[2],rawSession=7194538;
 const row={session:rawSession,stage:'consent-headers',elapsedMs:45,httpStatus:503,clock:'monotonic-observed',sentFrames:0,sentBytes:0,receivedFrames:0,receivedBytes:0,token:secret,transcript:secrets[0]};
 const records=[...Array.from({length:99},()=>row),{...row,stage:'relay-start',elapsedMs:9474},{...row,stage:'error',httpStatus:999,receivedBytes:-1},
  {...row,session:secrets[4]},{...row,stage:secret},{...row,elapsedMs:Infinity}];
 const report=buildDiagnostics({platform:'android',nativeCloudStreamTiming:{format:'alpha-cloud-stream-timing-v1',records,accountId:secrets[3]}},now);
 const timing=report.nativeCloudStreamTiming;
 assert.equal(timing.records.length,97,'only the last 100 input rows are scanned and invalid rows are discarded');
 assert.deepEqual(timing.records[0],{session:1,stage:'consent-headers',elapsedMs:45,clock:'monotonic-observed',httpStatus:503,sentFrames:0,sentBytes:0,receivedFrames:0,receivedBytes:0});
 assert.equal(timing.records.at(-2).stage,'relay-start');
 assert.equal(timing.records.at(-1).stage,'error');
 assert.equal(Object.hasOwn(timing.records.at(-1),'httpStatus'),false);
 assert.equal(Object.hasOwn(timing.records.at(-1),'receivedBytes'),false);
 const json=diagnosticsText(report);
 for(const value of [...secrets,String(rawSession)])assert.equal(json.includes(value),false);
 assert.equal(buildDiagnostics({platform:'android',nativeCloudStreamTiming:null},now).nativeCloudStreamTiming,undefined);
 assert.equal(buildDiagnostics({platform:'web',nativeCloudStreamTiming:{format:'alpha-cloud-stream-timing-v1',records:[row]}},now).nativeCloudStreamTiming,undefined);
});

test('Cloud startup diagnostics tolerate absent, outdated, and stalled native bridges',async()=>{
 const {readFileSync}=await import('node:fs');
 const {stripTypeScriptTypes}=await import('node:module');
 const vm=await import('node:vm');
 const source=readFileSync(new URL('../apps/app/src/runtime/cloud-voice.ts',import.meta.url),'utf8');
 const start=source.indexOf('export async function readNativeCloudStreamTiming');
 const end=source.indexOf('export function createCloudStreamingSpeech',start);
 assert.ok(start>=0&&end>start);
 const fn=source.slice(start,end).trim().replace(/^export /,'');
 const read=(present,stream)=>vm.runInNewContext(`(${stripTypeScriptTypes(fn)})`,{
  nativeCloudStreamingAvailable:()=>present,
  streamingNative:stream,
  setTimeout,clearTimeout,
 });
 const payload={format:'alpha-cloud-stream-timing-v1',records:[]};
 assert.equal(await read(true,{cloudStreamTiming:async()=>payload})(),payload);
 assert.equal(await read(false,{cloudStreamTiming:()=>assert.fail('unavailable bridge called')})(),null);
 assert.equal(await read(true,{})(),null);
 assert.equal(await read(true,{cloudStreamTiming:()=>new Promise(()=>{})})(1),null);
});

test('plan diagnostics distinguish signed inactive plans from organization-credit presentation without exporting authority',()=>{
 const inactive=buildDiagnostics({cloudPlan:{view:'inactive',source:'entitlement',status:'none',admission:'needs-plan',entitlement:secrets[2],planName:secrets[0],userId:secrets[3],organizationId:secrets[4],balance:42}},now);
 assert.deepEqual(inactive.cloudPlan,{view:'inactive',source:'entitlement',status:'none',admission:'needs-plan'});
 const credits=buildDiagnostics({cloudPlan:{view:'credits',source:'billing-limits',admission:'admit',billingMode:'organization-credits',balance:42}},now);
 assert.deepEqual(credits.cloudPlan,{view:'credits',source:'billing-limits',admission:'admit'});
 const unavailable=buildDiagnostics({cloudPlan:{view:'unavailable',reason:'invalid',admission:'unknown'}},now);
 assert.deepEqual(unavailable.cloudPlan,{view:'unavailable',reason:'invalid',admission:'unknown'});
 for(const report of [inactive,credits,unavailable]){
  const json=diagnosticsText(report);
  for(const secret of secrets)assert.equal(json.includes(secret),false,`leaked ${secret}`);
  for(const field of ['entitlement','planName','userId','organizationId','balance','billingMode'])assert.equal(Object.hasOwn(report.cloudPlan,field),false,`unexpected ${field}`);
 }
 assert.equal(Object.hasOwn(buildDiagnostics({},now),'cloudPlan'),false,'older callers do not invent plan state');
});

test('plan diagnostics reject arbitrary upstream values and unknown fields',()=>{
 for(const secret of secrets){
  assert.equal(buildDiagnostics({cloudPlan:{view:secret,admission:'unknown'}},now).cloudPlan,undefined);
  assert.equal(buildDiagnostics({cloudPlan:{view:'inactive',admission:secret}},now).cloudPlan,undefined);
  const report=buildDiagnostics({cloudPlan:{view:'inactive',admission:'needs-plan',source:secret,status:secret,reason:secret,[secret]:secret,apiKey:secret,jwt:secret}},now);
  assert.deepEqual(report.cloudPlan,{view:'inactive',admission:'needs-plan'});
  assert.equal(diagnosticsText(report).includes(secret),false);
 }
});

test('voice timing: the export carries the timing records, aggregator-ready, and never transcript text',async()=>{
 const store=new Map();
 globalThis.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
 const timing=await import('../apps/app/src/runtime/voice-timing.ts');
 const {collectRecords}=await import('../scripts/aggregate-voice-latency.mjs');
 const {readFileSync}=await import('node:fs');
 let clock=0;timing.setVoiceTimingClock(()=>clock);timing.clearVoiceTiming();
 // A reviewed conversation turn: the transcript passes through the send boundary, never into the record.
 const id=timing.beginVoiceTurn({route:'eliza-cloud',cold:true,entry:'conversation',policy:'review'});
 clock=700;timing.markVoiceTiming('transcript-ready');
 clock=2500;const sent=await timing.sendVoiceEntry({policy:'review',transcript:'Remind me to call the dentist',review:async text=>text,send:async text=>text});
 assert.equal(sent.text,'Remind me to call the dentist');
 clock=3100;timing.markVoiceTiming('first-token');clock=4000;timing.markVoiceTiming('final-reply');timing.finishVoiceTurn();
 // A stored record carrying extra fields (as a tampered or future store might) keeps only timing.
 const rows=JSON.parse(store.get('alphaphone:voice-timing:v1'));
 rows.push({version:1,id:'0b0c7a52-6d5e-4e0f-9a43-5c1d2e3f4a5b',recordedAt:now,route:'on-device',cold:false,entry:'notes',marks:{'recording-end':0,'transcript-ready':300},transcript:secrets[0],reply:secrets[0],accountId:secrets[3],outcome:'abandoned'});
 rows.push({version:1,id:secrets[4]+'x',recordedAt:now,route:'eliza-cloud',cold:false,marks:{}},{version:1,id:'1b0c7a52-6d5e-4e0f-9a43-5c1d2e3f4a5b',recordedAt:now,route:secrets[6],cold:false,marks:{}});
 store.set('alphaphone:voice-timing:v1',JSON.stringify(rows));
 const report=buildDiagnostics({generatedAt:now,platform:'android',voiceTiming:JSON.parse(timing.exportVoiceTiming())},now);
 assert.equal(report.voiceTiming.format,'alpha-voice-timing-v1');
 assert.deepEqual(report.voiceTiming.records.map(r=>r.id),[id,'0b0c7a52-6d5e-4e0f-9a43-5c1d2e3f4a5b']);
 assert.deepEqual(report.voiceTiming.records[0].marks,{'recording-end':0,'transcript-ready':700,send:2500,'first-token':3100,'final-reply':4000});
 assert.equal(report.voiceTiming.records[0].policy,'review');
 assert.deepEqual(report.voiceTiming.records[1],{version:1,id:'0b0c7a52-6d5e-4e0f-9a43-5c1d2e3f4a5b',recordedAt:now,route:'on-device',cold:false,entry:'notes',marks:{'recording-end':0,'transcript-ready':300},outcome:'abandoned'});
 const json=diagnosticsText(report);
 for(const fragment of ['dentist','Dana','acct_','"transcript"','"reply"','accountId','agent.example'])assert.equal(json.includes(fragment),false,`leaked ${fragment}`);
 // The section is a complete export the latency aggregator reads as is.
 assert.equal(collectRecords([JSON.parse(json).voiceTiming]).records.length,2);
 // Same mark order and routes as voice-timing.ts (marks from the shared recorder).
 const source=readFileSync(new URL('../apps/app/src/runtime/voice-timing.ts',import.meta.url),'utf8');
 const list=name=>JSON.parse(new RegExp(`const ${name}[^=]*= (\\[[^\\]]*\\])`).exec(source)[1].replaceAll("'",'"'));
 assert.deepEqual(report.voiceTiming.marks,timing.voiceTimingMarks());
 for(const route of list('voiceTimingRoutes'))assert.equal(buildDiagnostics({voiceTiming:{format:'alpha-voice-timing-v1',records:[{version:1,id,recordedAt:now,route,cold:false,marks:{}}]}},now).voiceTiming.records.length,1,route);
 // Nothing exported, or not an export: an empty section.
 assert.deepEqual(buildDiagnostics({},now).voiceTiming,{format:'alpha-voice-timing-v1',marks:timing.voiceTimingMarks(),records:[]});
 assert.deepEqual(buildDiagnostics({voiceTiming:{format:'other',records:rows}},now).voiceTiming.records,[]);
 timing.clearVoiceTiming();delete globalThis.localStorage;
});

test('native voice timing (#395): linked monotonic trials, hashes and labels only, aggregator-ready',async()=>{
 const {aggregateNativeVoice,marks}=await import('../scripts/native-voice-latency.mjs');
 const identity={sourceCommit:pin,sourceDirty:false,engineSha256:hash,modelSha256:'b'.repeat(64),models:{asr:'c'.repeat(64),tts:'d'.repeat(64),extra:secrets[0]},device:'Google Pixel 10a',environment:'device',abi:'arm64-v8a',sdk:36,build:'standalone-release',path:secrets[8]};
 const row={id:pin.slice(0,12)+'-1a2b3c-1',turnId:'7d3c1a52-6d5e-4e0f-9a43-5c1d2e3f4a5b',pipeline:'live-voice',clock:'native-monotonic-ms',captureClock:'audiorecord-timestamp',cold:true,coldReason:'process-first-turn+tts-load',outcome:'passed',audibleClock:'audiotrack-timestamp',network:'offline',thermal:'none',thermalHeadroom:0.4,identity,
  marks:{'last-user-audio':1000,endpoint:1550,'asr-final':1700,request:1720,'first-token':2900,'tts-start':3000,'tts-ready':3300,'first-pcm':3350,'audible-playback':3420,transcript:5},
  transcript:secrets[0],reply:secrets[0],audio:'UklGRg==',accountId:secrets[3]};
 const report=buildDiagnostics({generatedAt:now,platform:'android',nativeVoiceTiming:{format:'alpha-native-voice-timing-v3',dropped:2,records:[row,{...row,id:secrets[6]},{...row,turnId:secrets[4]+'x'},{...row,identity:{...identity,device:secrets[5]}},{...row,pipeline:'dictation'}]}},now);
 const native=report.nativeVoiceTiming;
 assert.equal(native.format,'alpha-native-voice-timing-v3');assert.equal(native.dropped,2);assert.deepEqual(native.marks,[...marks]);
 assert.equal(native.records.length,1,'rows with free text, emails or unknown pipelines are dropped');
 const kept=native.records[0];
 assert.equal(kept.turnId,row.turnId);
 assert.deepEqual(Object.keys(kept.marks),['last-user-audio','endpoint','asr-final','request','first-token','tts-start','tts-ready','first-pcm','audible-playback']);
 assert.deepEqual(kept.identity.models,{asr:'c'.repeat(64),tts:'d'.repeat(64)});
 assert.equal('path' in kept.identity,false);
 const json=diagnosticsText(report);
 for(const fragment of ['Dana','UklGRg','acct_','"transcript"','"reply"','"audio"','accountId','/data/'])assert.equal(json.includes(fragment),false,`leaked ${fragment}`);
 // The section is itself a native export the aggregator reads.
 const summary=aggregateNativeVoice([JSON.parse(json).nativeVoiceTiming]);
 assert.equal(summary.invalid,0);assert.equal(summary.cohorts[0].linked,1);
 // Web, missing or foreign input: an empty section.
 assert.deepEqual(buildDiagnostics({},now).nativeVoiceTiming.records,[]);
 assert.deepEqual(buildDiagnostics({nativeVoiceTiming:{format:'alpha-native-voice-timing-v2',records:[row]}},now).nativeVoiceTiming.records,[]);
 // The renderer calls the native export on Settings > Export diagnostics.
 const {readFileSync}=await import('node:fs');
 const settings=readFileSync(new URL('../apps/app/src/prototype/settings-adapter.ts',import.meta.url),'utf8');
 assert.match(settings,/readNativeVoiceTiming\(\), readNativeCloudStreamTiming\(\)\]\);/);
 assert.match(settings,/nativeVoiceTiming: nativeTiming\.status === 'fulfilled' \? nativeTiming\.value : null/);
 assert.match(settings,/nativeCloudStreamTiming: nativeCloudTiming\.status === 'fulfilled' \? nativeCloudTiming\.value : null/);
 assert.match(readFileSync(new URL('../apps/app/src/runtime/native-voice-turn.ts',import.meta.url),'utf8'),/return readBridgeTiming\(plugin\(\), timeoutMs\)/);assert.match(readFileSync(new URL('../vendor/eliza/packages/voice/src/native-live-voice.ts',import.meta.url),'utf8'),/port\.nativeVoiceTiming\(\)/);
});

test('Cloud inference failures share one finite problem-log and Android export projection',async()=>{
 const {sanitizeCloudInferenceFailure,recordCloudInferenceFailure,readCrashLog,clearCrashLog,browserCrashLogKey}=await import('../apps/app/src/runtime/crash-log.ts');
 const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 const at=Date.now(),failure={version:1,at,stage:'response-handler',status:400,reason:'unsupported-schema-keyword',parameter:'tools',keyword:'pattern',strictTools:['HANDLE_RESPONSE',secrets[0]],schemaKeywords:['pattern',secrets[1]],schemaScanTruncated:false,prompt:secrets[0],body:secrets[1],headers:{Authorization:secrets[2]},accountId:secrets[3]};
 try{
  const safe=sanitizeCloudInferenceFailure(failure);
  assert.deepEqual(safe,{version:1,at,stage:'response-handler',status:400,reason:'unsupported-schema-keyword',parameter:'tools',keyword:'pattern',strictTools:['HANDLE_RESPONSE'],schemaKeywords:['pattern'],schemaScanTruncated:false});
  assert.equal(recordCloudInferenceFailure(failure),true);assert.equal(recordCloudInferenceFailure(failure),false);
  const log=await readCrashLog();assert.deepEqual(log.entries,[{at,source:'inference',inference:safe}]);
  const report=buildDiagnostics({platform:'android',crashes:[...log.entries,{at,source:'inference',inference:{...failure,reason:secrets[0]}}]});
  assert.equal(report.crashes.count,1);assert.deepEqual(report.crashes.recent,log.entries);assert.equal(describeCrashEntry(log.entries[0]).title,'Cloud AI request failed');
  for(const secret of secrets){assert.equal(diagnosticsText(report).includes(secret),false);assert.equal(store.get(browserCrashLogKey).includes(secret),false);}
  await clearCrashLog();assert.deepEqual((await readCrashLog()).entries,[]);assert.equal(recordCloudInferenceFailure(failure),false,'Clearing must not repopulate unchanged failure');
  assert.equal(recordCloudInferenceFailure({...failure,at:at+1}),true);
  const write=globalThis.localStorage.setItem;globalThis.localStorage.setItem=()=>{throw Error('Synthetic storage refusal');};await assert.rejects(clearCrashLog(),/clear not confirmed/);assert.equal((await readCrashLog()).entries.length,1,'Failed clear must remain visible');globalThis.localStorage.setItem=write;
  for(const bad of [{stage:secrets[0]},{version:2},{strictTools:Array(10000).fill('HANDLE_RESPONSE')},{schemaScanTruncated:secrets[0]},{at:at+86400000}])assert.equal(sanitizeCloudInferenceFailure({...failure,...bad}),null);
  assert.equal(sanitizeCloudInferenceFailure(undefined),null);
  const counts=sanitizeCloudInferenceFailure({...failure,reason:'schema-limit',schemaDepth:4,schemaProperties:20,schemaEnumValues:30,schemaTextChars:120});assert.equal(counts.reason,'schema-limit');assert.equal(counts.schemaDepth,4);assert.equal(counts.schemaProperties,20);assert.equal(counts.schemaEnumValues,30);assert.equal(counts.schemaTextChars,120);assert.equal(buildDiagnostics({crashes:[{at,source:'inference',inference:counts}]}).crashes.recent[0].inference.schemaTextChars,120);
  assert.equal(sanitizeCloudInferenceFailure({...failure,schemaDepth:25}).schemaDepth,undefined);
  for(const key of ['schemaDepth','schemaProperties','schemaEnumValues','schemaTextChars'])assert.equal(sanitizeCloudInferenceFailure({...failure,[key]:100001})[key],undefined);
  const unknown=sanitizeCloudInferenceFailure({...failure,status:200,parameter:secrets[0],keyword:secrets[0],strictTools:[],schemaKeywords:[]});assert.equal(unknown.status,undefined);assert.equal(unknown.parameter,undefined);assert.equal(unknown.keyword,undefined);
 }finally{delete globalThis.localStorage;}
});

test('status inference read rejects retired resident sessions before recording',async()=>{
 const {readFileSync}=await import('node:fs');const {stripTypeScriptTypes}=await import('node:module');const vm=await import('node:vm');const {sanitizeCloudInferenceFailure}=await import('../apps/app/src/runtime/crash-log.ts');
 const source=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');const method=source.slice(source.indexOf('  async readResidentDiagnostics('),source.indexOf('  voiceTurnFailureMessage(')).trim().replace(/,$/,'');const code=stripTypeScriptTypes('async function '+method.slice('async '.length),{mode:'strip'});
 let release,calls=0;const pending=new Promise(resolve=>{release=resolve;});const context={active:{kind:'resident',remote:{request:async(path,body,signal)=>{calls++;assert.equal(path,'/api/status');assert.equal(body,undefined);assert.ok(signal instanceof AbortSignal);return pending;}}},state:{session:{}},epoch:1,sanitizeCloudInferenceFailure,sanitizeNativeInferenceTiming,DOMException};
 const read=vm.runInNewContext('('+code+')',context),signal=new AbortController().signal;const result=read(signal);context.epoch=2;release({cloudInferenceFailure:{version:1,at:Date.now(),stage:'text',reason:'unknown',strictTools:[],schemaKeywords:[],schemaScanTruncated:false,prompt:secrets[0]}});await assert.rejects(result,{name:'AbortError'});assert.equal(calls,1);
 const failure={version:1,at:Date.now(),stage:'text',reason:'unknown',strictTools:[],schemaKeywords:[],schemaScanTruncated:false,prompt:secrets[0]};context.active={kind:'resident',remote:{request:async()=>({cloudInferenceFailure:failure,nativeInferenceTiming:nativeInference})}};assert.deepEqual(JSON.parse(JSON.stringify(await read(signal))),{cloudInferenceFailure:sanitizeCloudInferenceFailure(failure),nativeInferenceTiming:nativeInference});
 context.active=null;assert.equal(await read(signal),null);const abort=new AbortController();abort.abort();await assert.rejects(read(abort.signal),{name:'AbortError'});assert.equal(calls,1);
});

test('explicit inference refresh is isolated and abortable without unrelated capability reads',async()=>{
 const {readFileSync}=await import('node:fs');const {stripTypeScriptTypes}=await import('node:module');const vm=await import('node:vm');
 const source=readFileSync(new URL('../apps/app/src/prototype/settings-adapter.ts',import.meta.url),'utf8');const body=source.slice(source.indexOf('  async function refreshResidentDiagnostics(){'),source.indexOf('  async function refreshCapabilities(')).trim();const code=stripTypeScriptTypes(body,{mode:'strip'});
 let reads=0,records=0;const context={inferenceAbort:null,owner:{},AbortController,setTimeout:callback=>{queueMicrotask(callback);return 1;},clearTimeout:()=>{},connectionController:{readResidentDiagnostics:signal=>{reads++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}},recordCloudInferenceFailure:()=>{records++;return true;},readCrashLog:()=>{throw Error('Unexpected log read after cancellation');},changed:()=>{throw Error('Unexpected update after cancellation');}};
 await vm.runInNewContext('('+code+')',context)();assert.equal(reads,1);assert.equal(records,0);assert.equal(context.inferenceAbort,null);
 assert.doesNotMatch(body,/refreshCapabilities|gmailAccounts|listenerStatus|workflow/);
});

test('diagnostics export uses one status observation and drops timing after a resident session changes',async()=>{
 const {readFileSync}=await import('node:fs');const {stripTypeScriptTypes}=await import('node:module');const vm=await import('node:vm');
 const source=readFileSync(new URL('../apps/app/src/prototype/settings-adapter.ts',import.meta.url),'utf8');const body=source.slice(source.indexOf('  async function exportDiagnostics(api: Bag) {'),source.indexOf('  async function clearProblems(')).trim();
 for(const retire of [false,true]){
  let session={},reads=0,shared;
  const context={diagnosticsBusy:false,owner:{},Capacitor:{isNativePlatform:()=>true},changed:()=>{},connectionController:{getSnapshot:()=>({kind:'resident',session})},refreshResidentDiagnostics:async()=>{reads++;return {nativeInferenceTiming:nativeInference};},device:{diagnosticsFacts:async()=>{if(retire)session={};return {};},shareDiagnostics:async({text})=>{shared=JSON.parse(text);return {status:'opened'};}},readCrashLog:async()=>({entries:[]}),system:{getStatus:async()=>({})},readRoles:()=>({}),readNativeVoiceTiming:async()=>null,readNativeCloudStreamTiming:async()=>null,buildDiagnostics,diagnosticsText,facts:{},delivery:{},exportRealtimeVoiceTiming:()=>undefined,voiceStartupTiming:()=>undefined,exportVoiceTiming:()=>'{"records":[]}'};
  await vm.runInNewContext('('+stripTypeScriptTypes(body,{mode:'strip'})+')',context)({toast:()=>{}});
  assert.equal(reads,1);assert.ok(shared);assert.deepEqual(shared.nativeInferenceTiming,retire?undefined:nativeInference);assert.equal(context.diagnosticsBusy,false);
 }
});

test('confirmed clear cancels an outstanding inference refresh before it can append',async()=>{
 const {readFileSync}=await import('node:fs');const {stripTypeScriptTypes}=await import('node:module');const vm=await import('node:vm');
 const source=readFileSync(new URL('../apps/app/src/prototype/settings-adapter.ts',import.meta.url),'utf8');
 const refresh=source.slice(source.indexOf('  async function refreshResidentDiagnostics(){'),source.indexOf('  async function refreshCapabilities(')).trim();
 const clear=source.slice(source.indexOf('  async function clearProblems(api: Bag) {'),source.indexOf('  async function refresh()')).trim();
 let records=0,clears=0;const context={inferenceAbort:null,owner:{toast:()=>{}},crashBusy:false,crashLog:null,AbortController,window:{confirm:()=>true},setTimeout:()=>1,clearTimeout:()=>{},connectionController:{readResidentDiagnostics:signal=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))},recordCloudInferenceFailure:()=>{records++;return true;},readCrashLog:async()=>({entries:[],exitHistory:false}),clearCrashLog:async()=>{clears++;},changed:()=>{}};
 vm.runInNewContext(stripTypeScriptTypes(refresh+'\n'+clear,{mode:'strip'})+'\nglobalThis.refresh=refreshResidentDiagnostics;globalThis.clear=clearProblems;',context);
 const pending=context.refresh();await context.clear({toast:()=>{}});await pending;assert.equal(clears,1);assert.equal(records,0);assert.equal(context.inferenceAbort,null);
});

test('voice conversation rows name their path: live assistant or recorded-clip batch',()=>{
 const row=(id,extra)=>({version:1,id,recordedAt:now,route:'local-agent',cold:false,entry:'conversation',marks:{'recording-end':0},...extra});
 const ids=['1b0c7a52-6d5e-4e0f-9a43-5c1d2e3f4a51','2b0c7a52-6d5e-4e0f-9a43-5c1d2e3f4a52','3b0c7a52-6d5e-4e0f-9a43-5c1d2e3f4a53','4b0c7a52-6d5e-4e0f-9a43-5c1d2e3f4a54','5b0c7a52-6d5e-4e0f-9a43-5c1d2e3f4a55'];
 const records=buildDiagnostics({voiceTiming:{format:'alpha-voice-timing-v1',records:[
  row(ids[0],{endpoint:{by:'gap',semantic:'not-asked'}}),
  row(ids[1],{live:{mode:'stream',partials:3}}),
  row(ids[2],{live:{mode:'batch',partials:0}}),
  row(ids[3],{}),
  {...row(ids[4],{live:{mode:'batch',partials:0}}),entry:'notes',path:'live'},
 ]}},now).voiceTiming.records;
 assert.deepEqual(records.map(r=>r.path),['live','live','batch',undefined,undefined]);
});
