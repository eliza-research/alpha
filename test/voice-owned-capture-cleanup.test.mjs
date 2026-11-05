import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';

const adapterSourceTransform=process.env.ALPHA_VOICE_ADAPTER_SOURCE
  ?()=>readFileSync(process.env.ALPHA_VOICE_ADAPTER_SOURCE,'utf8'):undefined;
async function direct({failure,hold=false}={}) {
  const f=cloudVoiceViewFixture({cloudProfile:true,platform:'web',native:false,adapterSourceTransform});
  f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
  const snapshot=f.box.connectionController.getSnapshot;
  f.box.connectionController.getSnapshot=()=>({...snapshot(),residentInference:'direct',providerStatus:{voiceConfigured:true}});
  // The generic DevelopmentAgent is absent in a flag-off dev:cloud preview.
  // The real adapter runs; only its realtime client boundary is substituted.
  let stopCalls=0,release;
  const waiting=hold?new Promise(resolve=>{release=resolve;}):Promise.resolve();
  f.box.developmentCartesiaConversation=async input=>({
    async start(){input.onState('listening');},
    async stop(){stopCalls++;await waiting;if(failure)throw failure;},
    recheck(){},resume(){return false;},microphoneMuted:false,
    setMicrophoneMuted(){},needsPlaybackUnlock:false,
  });
  f.driver.cancelRecording=async()=>{f.recordingCancels.push(null);throw Error('DevelopmentAgent is not implemented on web');};
  await f.shell.startVoice();
  assert.equal(f.renderChat()?.state,'listening');
  f.recordingCancels.length=0;
  return Object.assign(f,{getStopCalls:()=>stopCalls,release});
}
test('Direct realtime Stop uses its owned client, never the unregistered generic recorder',async()=>{
  const f=await direct();try{
    await f.shell.stopVoiceConversation();await f.tick();
    assert.equal(f.getStopCalls(),1);assert.deepEqual(f.recordingCancels,[]);
    assert.equal(f.renderChat(),null);assert.equal(f.shell.S().chat,'sheet');
  }finally{f.close();}
});
test('a pending realtime Stop blocks replacement until the owner releases it',async()=>{
  const f=await direct({hold:true});try{
    const stopped=f.shell.stopVoiceConversation();await f.tick();
    assert.equal(f.renderChat().state,'stopping');
    await f.shell.startVoice();assert.equal(f.getStopCalls(),1);
    f.release();await stopped;await f.tick();assert.equal(f.renderChat(),null);
    assert.deepEqual(f.recordingCancels,[]);
  }finally{f.release();f.close();}
});
for(const reason of ['SDK microphone stop rejected','Developer voice retirement was not confirmed'])
  test(`actual realtime cleanup failure remains latched: ${reason}`,async()=>{
    const f=await direct({failure:Error(reason)});try{
      await assert.rejects(f.shell.stopVoiceConversation(),new RegExp(reason));await f.tick();
      assert.equal(f.renderChat().state,'error');assert.equal(f.renderChat().muteLabel,'Microphone status unconfirmed');
      assert.deepEqual(f.recordingCancels,[]);await f.shell.startVoice();assert.equal(f.getStopCalls(),1);
    }finally{f.close();}
  });
for(const fails of [false,true])test(`ordinary dictation preserves owned recorder cleanup${fails?' failure':''}`,async()=>{
  const f=cloudVoiceViewFixture({cloudProfile:true,adapterSourceTransform});
  f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
  f.box.HTMLElement=class{};
  f.box.nativeLiveVoiceReady=async()=>false;
  try{
    f.shell.startTranscription();for(let i=0;i<8;i++)await f.tick();
    assert.equal(f.renderChat().state,'ready');
    // Cloud dictation's primary action starts its recorded clip explicitly.
    f.renderChat().stop();for(let i=0;i<8;i++)await f.tick();
    assert.equal(f.starts,1);assert.ok(f.activeRecording);
    const owned=f.activeRecording;f.recordingCancels.length=0;
    if(fails)f.captureCancelError=Error('Owned capture did not stop');
    const stopped=f.shell.stopVoiceConversation();
    if(fails){await assert.rejects(stopped,/Owned capture did not stop/);await f.tick();assert.equal(f.renderChat().state,'error');}
    else{await stopped;await f.tick();assert.equal(f.activeRecording,null);assert.equal(f.renderChat(),null);}
    assert.deepEqual(f.recordingCancels,[owned]);assert.equal(f.sends,0);
  }finally{f.close();}
});
