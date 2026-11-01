import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';

const flagSource = stripTypeScriptTypes([
  'apps/app/src/build-flags.ts',
  'apps/app/src/runtime/development-cartesia-flag.ts',
].map(file=>readFileSync(file,'utf8')).join('\n').replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replaceAll('import.meta.env','env'),{mode:'transform'});
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
  'Cloud conversation keeps concise phases and accessible route details',
  'typed native 503 stays actionable and diagnosable across rendering',
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
    adapterSourceTransform:preference?source=>source.replace("enter(undefined,undefined,'default',chat)","enter(undefined,undefined,'"+preference+"',chat)"):undefined,
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
  assert.match(h.renderChat().cloudDisclosureText,/Cartesia.*direct Cerebras/);
  assert.doesNotMatch(h.renderChat().cloudDisclosureText,/Cloud account|plan allowance/);
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
  assert.equal(h.renderChat().cloudDisclosure,false);
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
adapterTest('Cloud conversation keeps concise phases and accessible route details',async t=>{
  const h=cloudFixture();t.after(()=>h.close());
  h.box.BatchVoiceConversation=class {
    constructor(options){h.batchOptions=options;}
    async start(){h.initialView=h.renderChat();h.batchOptions.onState({phase:'listening'});}
    async stop(){}
    recheck(){}
  };
  await h.shell.startVoice();
  assert.equal(h.initialView.state,'starting');assert.equal(h.initialView.voiceDetails,false);
  assert.match(h.initialView.cloudDisclosureText,/uploads recordings.*plan allowance/);
  for(const [phase,caption] of [['listening','Listening…'],['transcribing','Transcribing…'],['thinking','Thinking…'],['preparing-speech','Thinking…'],['speaking','Speaking…']]){
    h.batchOptions.onState({phase});const view=h.renderChat();
    assert.equal(view.lines[0].t,caption);
    assert.equal(view.voiceDetails,false);
    assert.match(view.cloudDisclosureText,/uploads recordings and reply text.*account.*plan allowance.*Cartesia/);
    assert.equal(typeof view.stop,'function');assert.equal(typeof view.keyboard,'function');
  }
  h.batchOptions.onState({phase:'idle'});
  assert.equal(h.renderChat().lines[0].t,'Voice conversation stopped.');
  assert.equal(h.renderChat().voiceDetails,false);
});
adapterTest('typed native 503 stays actionable and diagnosable across rendering',async t=>{
  const failure=Object.assign(new Error('PRIVATE_PROVIDER_BODY'),{code:'voice-http-503'});
  const h=cloudFixture({startError:failure});t.after(()=>h.close());
  const originalMessages=JSON.stringify(h.shell.state.msgs);
  await h.shell.startVoice();await h.tick();
  for(let render=0;render<3;render++){
    const view=h.renderChat();assert.equal(view.state,'error');
    assert.equal(view.lines[0].t,'Voice is unavailable right now. Try again later or use the keyboard.');
    assert.equal(view.errorDetail,'Voice service returned HTTP 503.');
    assert.equal(view.voiceDetails,true);assert.equal(view.recoveryLabel,'Try voice again');
    assert.doesNotMatch(JSON.stringify(view),/PRIVATE_PROVIDER_BODY/);
    assert.equal(typeof view.stop,'function');assert.equal(typeof view.keyboard,'function');
  }
  assert.equal(failure.code,'voice-http-503');assert.equal(failure.message,'PRIVATE_PROVIDER_BODY');
  assert.equal(JSON.stringify(h.shell.state.msgs),originalMessages);
  assert.equal(h.starts,1);assert.equal(h.uploads,0);
  h.renderChat().keyboard();await h.tick();assert.equal(h.renderChat(),null);
});
adapterTest('unknown native voice failures retain their existing recovery',async t=>{
  const h=cloudFixture({startError:Object.assign(new Error('Unknown voice failure remains'),{code:'voice-http-503-extra'})});t.after(()=>h.close());
  await h.shell.startVoice();await h.tick();const view=h.renderChat();
  assert.equal(view.state,'error');assert.equal(view.errorDetail,'');
  assert.doesNotMatch(view.lines[0].t,/Voice is unavailable right now/);
  assert.equal(view.recoveryLabel,'Try voice again');
});
