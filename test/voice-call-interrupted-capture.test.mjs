import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';
import {voiceFakeClock} from './fixtures/shared-batch-voice.mjs';

// The actual voice adapter and shared clip loop with in-memory ports: a capture the phone ends
// because a call took the microphone is dropped, never transcribed or sent, and voice says why.
test('a conversation capture interrupted by a call is discarded and shows the call message',async t=>{
 const clock=voiceFakeClock(),f=cloudVoiceViewFixture({cloudProfile:true,clock});t.after(()=>f.close());
 f.box.React={createElement:()=>'activity'};f.box.VoiceActivity=()=>null;
 await f.shell.startVoice();await clock.flush();
 assert.equal(f.renderChat().state,'listening');
 const recording=f.activeRecording;assert.ok(recording);
 for(const callback of f.events.get('recordingStopped')||[])callback({recordingId:recording,durationMs:1800,interrupted:'call-active'});
 await clock.flush();await clock.advance(100);
 const shown=f.renderChat();
 assert.equal(shown.state,'error');assert.equal(shown.lines[0].t,'Voice paused for a call. Start again after the call.');
 assert.equal(f.uploads,0,'the clip is not transcribed');assert.equal(f.sends,0,'nothing is sent');
 assert.ok(f.recordingCancels.includes(recording),'the interrupted capture is cancelled');
});

// Upstream's speech filter drops a well-formed block's JSON but reads a malformed one aloud.
test('a workflow run reply is spoken without its [WORKFLOW] block, even a malformed one',async t=>{
 const clock=voiceFakeClock(),f=cloudVoiceViewFixture({cloudProfile:true,clock,peak:.5});t.after(async()=>{f.close();await clock.flush();});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
 f.badReply={text:'Submitted workflow run run-1.\n\n[WORKFLOW]\n{"runId":"run-1" cut off\n[/WORKFLOW]\n\nIt takes a minute.'};
 await f.shell.startVoice();await clock.flush();
 f.peak=.5;await clock.advance(700);f.peak=0;await clock.advance(1_200);await clock.flush();await clock.advance(10_000);
 assert.equal(f.sends,1);
 const spoken=(f.speechInputs||[]).map(input=>input.text).join('\n');
 assert.match(spoken,/Submitted workflow run run-1/);assert.match(spoken,/It takes a minute/);assert.doesNotMatch(spoken,/WORKFLOW|runId|steps/);
 // The voice panel shows the reply the same way.
 assert.doesNotMatch(String(f.renderChat().lastReply),/WORKFLOW|runId/);
});
