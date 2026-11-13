import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceFailure} from '../apps/app/src/runtime/voice-states.ts';

test('a kept recording that failed to transcribe says so without reciting its controls',()=>{
 const shown=[
  voiceFailure({code:'no-speech'},{transcribing:true,browser:false,cloud:true,serviceName:'Eliza Cloud'}),
  voiceFailure({code:'local-agent-starting'},{transcribing:true,browser:false}),
  voiceFailure({code:'recognition-failed'},{transcribing:true,browser:false}),
 ].map(failure=>failure.message);
 assert.deepEqual(shown,['Eliza Cloud heard no speech. Your recording is kept.','Your agent is starting. Try again soon. Your recording is kept.','Transcription failed. Your recording is kept.']);
});
