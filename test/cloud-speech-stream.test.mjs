import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedSpeechSource,fixture,runJvm} from './fixtures/jvm-tools.mjs';
test('native streaming speech validates bounded PCM, preserves every phrase before dispatch and bounds relay renewals',()=>{
 assert.match(runJvm([sharedSpeechSource('CloudSpeechWire.java'),fixture('CloudSpeechWireTest.java')],'ai.eliza.voice.CloudSpeechWireTest'),/^PASS streaming speech.*relay renewal bounds/);
});
