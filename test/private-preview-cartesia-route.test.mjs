import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';
import {voiceFakeClock} from './fixtures/shared-batch-voice.mjs';

const flagSource = stripTypeScriptTypes([
  'apps/app/src/build-flags.ts',
  'apps/app/src/runtime/development-cartesia-flag.ts',
].map(file=>readFileSync(file,'utf8')).join('\n').replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replaceAll('import.meta.env','env'),{mode:'strip'});
function enabled(overrides={},native=false){
  return vm.runInNewContext(flagSource+'\ndevelopmentCartesiaVoiceEnabled',{
    env:{DEV:true,VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:'0',VITE_ALPHA_PRIVATE_LOCAL_PREVIEW:'1',VITE_LOCAL_AGENT:'1',VITE_ALPHA_DEV_CARTESIA:'1',...overrides},
    Capacitor:{isNativePlatform:()=>native},
  });
}
test('actual flag admits explicit real private preview with mocks off',()=>{
  assert.equal(enabled(),true);
  assert.equal(enabled({VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:'1',VITE_ALPHA_PRIVATE_LOCAL_PREVIEW:'0'}),true,'existing developer fixture eligibility remains');
});
for(const [name,env,native] of [
  ['production',{DEV:false}],
  ['ordinary web',{VITE_ALPHA_PRIVATE_LOCAL_PREVIEW:'0'}],
  ['missing local agent',{VITE_LOCAL_AGENT:'0'}],
  ['flag off',{VITE_ALPHA_DEV_CARTESIA:'0'}],
  ['flag absent',{VITE_ALPHA_DEV_CARTESIA:undefined}],
  ['native',{},true],
])test(`actual flag rejects ${name}`,()=>assert.equal(enabled(env,native),false));

// One actual adapter/VM lifecycle per standard Node worker. Combined contexts have
// intermittently SIGSEGV'd on pinned Node 24.15; the precise engine cause is unproved.
const adapterCases = Object.freeze([
  'actual adapter starts existing Cartesia route without local preflight or Cloud sign-in',
  'navigation retires the current Cartesia conversation and fences its binding',
  'Stop while conversation preparation waits prevents a late Cartesia session',
  'chat dictation keeps the device route even when private Cartesia conversation is eligible',
  'actual adapter fences explicit device conversation from private Cartesia',
  'actual adapter fences explicit manual conversation from private Cartesia',
  'Cloud conversation keeps the composer focused on the current voice phase',
  'Cloud startup bounds a stalled draft and fences its late completion',
  'Cloud startup timeout keeps the media retirement fence',
  'Cloud preparation records success separately from bridge startup',
  'renderer preparation measures each phase once on the same clock',
  'browser startup measures Talk through microphone listening for both voice routes',
  'typed native 503 is waited out quietly, then voice ends with one calm line',
  'unknown native voice failures retain their existing recovery',
]);
const childCase = process.env.ALPHA_PRIVATE_CARTESIA_TEST_CASE;
if(childCase!==undefined)assert.ok(adapterCases.includes(childCase),'Unknown isolated adapter case');
function adapterTest(name,run){
  assert.ok(adapterCases.includes(name),'Only fixed adapter cases may spawn workers');
  if(childCase!==undefined){if(childCase===name)test(name,run);return;}
  test(name,t=>{
    const pattern='^'+[...name].map(char=>String.fromCharCode(92)+'u'+char.charCodeAt(0).toString(16).padStart(4,'0')).join('')+'$';
    const childEnv={...process.env,ALPHA_PRIVATE_CARTESIA_TEST_CASE:name};
    // Each child is a fresh test runner, not a recursive call in this worker.
    delete childEnv.NODE_TEST_CONTEXT;
    const result=spawnSync(process.execPath,[
      '--test','--test-reporter=tap','--test-name-pattern',pattern,fileURLToPath(import.meta.url),
    ],{
      env:childEnv,
      encoding:'utf8',timeout:10000,maxBuffer:64*1024,killSignal:'SIGKILL',
    });
    t.diagnostic('adapter-child '+JSON.stringify({name,status:result.status,signal:result.signal,error:result.error?.code||null}));
    const detail=[result.error?.message,result.stdout,result.stderr].filter(Boolean).join(String.fromCharCode(10));
    assert.equal(result.error,undefined,detail);
    assert.equal(result.signal,null,detail);
    assert.equal(result.status,0,detail);
    assert.match(result.stdout,/# pass 1$/m,'Selected child case must execute and pass once: '+detail);
  });
}

function fixture(preference){
  // Public startVoice is default-only. Substitute only its call argument to exercise
  // explicit internal choices through the unchanged actual enter/begin bodies.
  const h=cloudVoiceViewFixture({native:false,platform:'web',account:null,
    adapterSourceTransform:preference?source=>{
      const entry="enter(undefined,'default',chat)";
      assert.ok(source.includes(entry),'The explicit route fixture must reach the actual start entry');
      return source.replace(entry,"enter(undefined,'"+preference+"',chat)");
    }:undefined,
  });
  h.box.developmentCartesiaVoiceEnabled=enabled();
  h.box.HTMLElement=class {};
  h.box.React={createElement:()=>null};h.box.VoiceActivity=()=>null;
  h.box.connectionController.voiceRendererMetadata=()=>({viewDelivery:'completed-action'});
  h.box.developmentCartesiaConversation=async options=>{
    h.directOptions=options;
    h.directFactories=(h.directFactories||0)+1;
    return {
      async start(){h.directStarts=(h.directStarts||0)+1;options.assertCurrent();options.onState('listening');},
      async stop(){h.directStops=(h.directStops||0)+1;},
      recheck(){options.assertCurrent();},
    };
  };
  return h;
}
adapterTest('actual adapter starts existing Cartesia route without local preflight or Cloud sign-in',async t=>{
  const h=fixture();t.after(()=>h.close());h.shell.state.chat='hidden';h.box.React={createElement:(_type,props)=>({type:'synthetic-voice-activity',props})};
  await h.shell.startVoice();
  assert.equal(h.directFactories,1);assert.equal(h.directStarts,1);
  assert.equal(h.renderChat().activity.props.phase,'listening');
  assert.equal(h.shell.renderVals().pillVoice.activity.props.phase,'listening');
  assert.equal(h.localFactories,0);assert.equal(h.pairedFactories,0);assert.equal(h.starts,0);assert.equal(h.accountOpens,0);
  assert.equal(h.directOptions.binding.conversationId,h.conversation);
  assert.equal(h.directOptions.getUiContext().uiViewPath,'/chat');
  assert.equal(h.renderChat().lines[0].t,'Listening…');
  assert.equal(h.renderChat().voiceDetails,false);
  h.directOptions.onState('transcribing');
  assert.equal(h.renderChat().lines[0].t,'Transcribing…');
  h.directOptions.onError(Error('Synthetic owned transport failure'));
  await h.tick();
  assert.equal(h.localFactories,0,'no asynchronous device readiness can overwrite the error');
  assert.match(JSON.stringify(h.renderChat()),/Synthetic owned transport failure/);
  assert.equal(h.renderChat().activity,null);
  assert.equal(h.shell.renderVals().pillVoice.activity,null,'compact error clears input activity too');
  await h.shell.stopVoiceConversation();await h.shell.stopVoiceConversation();
  assert.equal(h.directStops,1);assert.throws(()=>h.directOptions.assertCurrent(),/aborted|changed/i);
});
adapterTest('navigation retires the current Cartesia conversation and fences its binding',async t=>{
  const h=fixture();t.after(()=>h.close());await h.shell.startVoice();
  h.shell.openView('notes');await h.tick();
  assert.equal(h.directStops,1);assert.throws(()=>h.directOptions.assertCurrent(),/aborted|changed/i);
});
adapterTest('Stop while conversation preparation waits prevents a late Cartesia session',async t=>{
  const h=fixture();t.after(()=>h.close());let release;
  const prepare=h.shell.prepareVoiceConversation.bind(h.shell);
  h.shell.prepareVoiceConversation=signal=>new Promise(resolve=>release=()=>resolve(prepare(signal)));
  const start=h.shell.startVoice();await h.tick();
  await h.shell.stopVoiceConversation();release();await start;
  assert.equal(h.directFactories,undefined);assert.equal(h.localFactories,0);
});
adapterTest('chat dictation keeps the device route even when private Cartesia conversation is eligible',async t=>{
  const h=fixture();t.after(()=>h.close());
  h.box.nativeLiveVoiceReady=async()=>false;
  h.shell.startTranscription();await h.tick();
  assert.equal(h.localFactories,1);assert.equal(h.directFactories,undefined);
});

for(const preference of ['device','manual'])adapterTest(`actual adapter fences explicit ${preference} conversation from private Cartesia`,async t=>{
  const h=fixture(preference);t.after(()=>h.close());
  h.box.nativeLiveVoiceReady=async()=>false;
  h.box.BatchVoiceConversation=class {
    constructor(options){this.options=options;h.localConversationOptions=options;}
    async start(){this.options.onState({phase:'listening'});}
    async stop(){}
    recheck(){}
  };
  await h.shell.startVoice();
  assert.equal(h.directFactories,undefined);assert.ok(h.localFactories>0);
  assert.doesNotMatch(JSON.stringify(h.renderChat().lines),/Cartesia/);
  assert.equal(h.renderChat().cloudDisclosureText,undefined);
  h.localConversationOptions.onState({phase:'transcribing'});
  const caption=JSON.stringify(h.renderChat().lines);
  assert.equal(h.renderChat().lines[0].t,'Transcribing…');
  assert.doesNotMatch(caption,/Cartesia/);
  await h.shell.stopVoiceConversation();
});

function cloudFixture(options={}){
  const h=cloudVoiceViewFixture({cloudProfile:true,...options});
  h.box.React={createElement:()=>null};h.box.VoiceActivity=()=>null;
  return h;
}
adapterTest('Cloud startup bounds a stalled draft and fences its late completion',async t=>{
  const clock=voiceFakeClock(),h=cloudFixture({clock});t.after(()=>h.close());
  let release,started=0;
  const prepare=h.shell.prepareVoiceConversation.bind(h.shell);
  h.shell.prepareVoiceConversation=(signal,stage)=>new Promise(resolve=>{
    stage?.('draft-binding');
    release=()=>resolve(prepare(signal));
  });
  h.box.nativeCloudStreamingAvailable=()=>true;
  h.box.createCloudStreamingSpeech=()=>{started++;throw Error('Unexpected native speech route');};
  let finished=false;const opening=h.shell.startVoice().then(()=>{finished=true;});
  try{
    await clock.flush();
    assert.equal(typeof release,'function');
    assert.equal(h.renderChat().lines[0].t,'Connecting to voice…');
    await clock.advance(12001);
    assert.match(h.renderChat().lines[0].t,/setup is taking too long/i);
    assert.deepEqual(JSON.parse(JSON.stringify(h.box.voiceStartupTiming())),{stage:'draft-binding',outcome:'timeout',elapsedMs:12000,phaseMs:{'conversation-selection':0,'draft-binding':12000}});
    assert.equal(finished,true);
    release();release=undefined;await clock.flush();
    assert.equal(started,0,'timeout itself fences the late preparation');
  }finally{
    await h.shell.stopVoiceConversation();release?.();await opening;
  }
  assert.equal(started,0,'a late preparation cannot open native speech');
});
adapterTest('Cloud startup timeout keeps the media retirement fence',async t=>{
  const clock=voiceFakeClock(),h=cloudFixture({clock});t.after(()=>h.close());
  let release,started=0,stopped=false;
  const retirement=new Promise(resolve=>{release=resolve;});
  h.box.stopLocalSpeechPlayback=()=>retirement;
  h.box.nativeCloudStreamingAvailable=()=>true;
  h.box.createCloudStreamingSpeech=()=>{started++;throw Error('Unexpected native speech route');};
  const opening=h.shell.startVoice();
  try{
    await clock.flush();assert.equal(typeof release,'function');
    await clock.advance(12001);await opening;
    assert.deepEqual(JSON.parse(JSON.stringify(h.box.voiceStartupTiming())),{stage:'media-retirement',outcome:'timeout',elapsedMs:12000,phaseMs:{'conversation-selection':0,'media-retirement':12000}});
    const stop=Promise.resolve(h.shell.stopVoiceConversation()).then(()=>{stopped=true;});
    await clock.flush();assert.equal(stopped,false,'Stop waits for the original media retirement');
    release();await stop;
    assert.equal(started,0);
  }finally{release?.();}
});
adapterTest('Cloud preparation records success separately from bridge startup',async t=>{
  const clock=voiceFakeClock(),h=cloudFixture({clock});t.after(()=>h.close());
  assert.equal(h.box.voiceStartupTiming(),undefined,'no preparation attempt has entered');
  h.box.nativeCloudStreamingAvailable=()=>true;
  h.box.createCloudStreamingSpeech=()=>{throw Error('Bridge unavailable before start');};
  await h.shell.startVoice();
  assert.deepEqual(JSON.parse(JSON.stringify(h.box.voiceStartupTiming())),{stage:'media-retirement',outcome:'prepared',elapsedMs:0,phaseMs:{'conversation-selection':0,'media-retirement':0}});
  assert.equal(h.starts,0,'preparation success does not claim microphone capture');
});
adapterTest('renderer preparation measures each phase once on the same clock',async t=>{
  const clock=voiceFakeClock(),h=cloudFixture({clock});t.after(()=>h.close());
  const prepared=await h.box.runVoiceStartupPreparation(new AbortController(),async mark=>{
    await clock.advance(100);mark('draft-binding');
    await clock.advance(40);mark('draft-binding');
    await clock.advance(60);mark('agent-attach');
    await clock.advance(30);mark('media-retirement');
    await clock.advance(20);
    return 'ready';
  });
  assert.equal(prepared,'ready');
  await clock.advance(1000);
  assert.deepEqual(JSON.parse(JSON.stringify(h.box.voiceStartupTiming())),{
    stage:'media-retirement',outcome:'prepared',elapsedMs:250,
    phaseMs:{'conversation-selection':100,'draft-binding':100,'agent-attach':30,'media-retirement':20},
  });
});
adapterTest('browser startup measures Talk through microphone listening for both voice routes',async t=>{
  const clock=voiceFakeClock(),h=cloudFixture({clock,native:false,platform:'web'});t.after(()=>h.close());
  h.box.HTMLElement=class {};
  h.box.React={createElement:()=>null};h.box.VoiceActivity=()=>null;
  h.box.connectionController.voiceRendererMetadata=()=>({viewDelivery:'completed-action'});
  const snapshot=h.box.connectionController.getSnapshot.bind(h.box.connectionController);
  let own=true;
  h.box.connectionController.getSnapshot=()=>({...snapshot(),...(own?{residentInference:'direct',providerStatus:{voiceConfigured:true}}:{})});
  const prepare=h.shell.prepareVoiceConversation.bind(h.shell);
  h.shell.prepareVoiceConversation=async(signal,mark)=>{
    await clock.advance(100);mark?.('draft-binding');
    await clock.advance(50);mark?.('agent-attach');
    await clock.advance(150);return prepare(signal);
  };
  let listening;
  h.box.developmentCartesiaConversation=async options=>{
    await clock.advance(200);
    listening=()=>options.onState('listening');
    return {async start(){options.onState('ready');},async stop(){},recheck(){}};
  };
  const startup=()=>JSON.parse(JSON.stringify(h.box.voiceStartupTiming()??null));
  await h.shell.startVoice();
  assert.equal(startup()?.outcome,'pending','server readiness is not microphone capture');
  await clock.advance(350);listening();
  assert.deepEqual(startup(),{route:'direct-cartesia',stage:'speech-session',outcome:'listening',elapsedMs:850,
    phaseMs:{'conversation-selection':100,'draft-binding':50,'agent-attach':150,'media-retirement':0,'renderer-channel':200,'speech-session':350}});
  await h.shell.stopVoiceConversation();
  own=false;h.box.developmentCloudRealtimeVoiceEnabled=true;
  await h.shell.startVoice();
  assert.equal(startup()?.route,'cloud-cartesia');
  await clock.advance(500);listening();
  assert.equal(startup()?.outcome,'listening');
  assert.equal(startup()?.phaseMs['speech-session'],500);
  await h.shell.stopVoiceConversation();
  await h.shell.startVoice();
  await h.shell.stopVoiceConversation();
  assert.equal(startup()?.outcome,'cancelled');
  listening();
  assert.equal(startup()?.outcome,'cancelled','late microphone status cannot revive a stopped attempt');
});
adapterTest('Cloud conversation keeps the composer focused on the current voice phase',async t=>{
  const h=cloudFixture();t.after(()=>h.close());
  h.box.BatchVoiceConversation=class {
    constructor(options){h.batchOptions=options;}
    async start(){h.initialView=h.renderChat();h.batchOptions.onState({phase:'listening'});}
    async stop(){}
    recheck(){}
  };
  await h.shell.startVoice();
  assert.equal(h.initialView.state,'starting');assert.ok(!h.initialView.voiceDetails);
  for(const [phase,caption] of [['listening','Listening…'],['transcribing','Transcribing…'],['thinking','Thinking…'],['preparing-speech','Thinking…'],['speaking','Speaking…']]){
    h.batchOptions.onState({phase});const view=h.renderChat();
    assert.equal(view.lines[0].t,caption);
    assert.equal(view.cloudDisclosureText,undefined);
    assert.ok(!view.voiceDetails);
    assert.equal(typeof view.stop,'function');assert.equal(typeof view.keyboard,'function');
  }
  // The loop's own idle is shown once its retire settles (a failure it is about to report replaces it).
  h.batchOptions.onState({phase:'idle'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.renderChat().lines[0].t,'Voice conversation stopped.');
  assert.equal(h.renderChat().voiceDetails,false);
});
adapterTest('typed native 503 is waited out quietly, then voice ends with one calm line',async t=>{
  // A Cloud 503 while voice warms is transient: no alarming copy, no support code, no Try voice again.
  const failure=Object.assign(new Error('PRIVATE_PROVIDER_BODY'),{code:'voice-http-503'}),clock=voiceFakeClock();
  const h=cloudFixture({startError:failure,clock});t.after(()=>h.close());
  // With on-device speech the conversation moves to this phone at once (voice-calm-cloud-errors.test.mjs);
  // the quiet waits are the network route's handling when on-device speech is unavailable.
  h.box.createOnDeviceVoice=()=>null;
  const originalMessages=JSON.stringify(h.shell.state.msgs);
  await h.shell.startVoice();await clock.flush();
  for(let attempt=1;attempt<=2;attempt++){
    const view=h.renderChat();assert.equal(view.state,'starting');
    assert.ok(!view.errorDetail);assert.ok(!view.voiceDetails);assert.ok(!view.recoveryLabel);
    assert.doesNotMatch(JSON.stringify(view),/PRIVATE_PROVIDER_BODY|Voice is unavailable|Try voice again|503/);
    assert.equal(typeof view.stop,'function');assert.equal(typeof view.keyboard,'function');
    assert.equal(h.starts,attempt);await clock.advance(2_000);
  }
  // Two quiet waits, then one calm line instead of an error screen.
  assert.equal(h.starts,3);assert.equal(h.renderChat(),null);
  assert.deepEqual(h.shell.messages,[],'exhausted retries end without a voice error toast');
  assert.equal(failure.code,'voice-http-503');assert.equal(failure.message,'PRIVATE_PROVIDER_BODY');
  assert.equal(JSON.stringify(h.shell.state.msgs),originalMessages);
  assert.equal(h.uploads,0);
  await clock.advance(60_000);assert.equal(h.starts,3);
});
adapterTest('unknown native voice failures retain their existing recovery',async t=>{
  const h=cloudFixture({startError:Object.assign(new Error('Unknown voice failure remains'),{code:'voice-http-503-extra'})});t.after(()=>h.close());
  await h.shell.startVoice();await h.tick();const view=h.renderChat();
  assert.equal(view.state,'error');assert.ok(!view.errorDetail);
  assert.doesNotMatch(view.lines[0].t,/Voice is unavailable right now/);
  assert.equal(view.recoveryLabel,'Try again');assert.equal(typeof view.recover,'function');
  assert.deepEqual(JSON.parse(JSON.stringify(view.statusLines)),[{t:'Voice stopped'}]);
  assert.equal(view.activity,null);assert.equal(typeof view.stop,'function');assert.equal(typeof view.keyboard,'function');
  assert.ok(!view.voiceDetails);assert.equal(h.starts,1,'unknown codes must not enter the quiet 503 retry path');assert.equal(h.startError?.code,'voice-http-503-extra','underlying failure is retained');assert.deepEqual(h.shell.messages,[]);
});
