import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeSource,sharedSpeechSource,fixture,runJvm} from './fixtures/jvm-tools.mjs';
test('native streaming speech validates bounded PCM and preserves every phrase before dispatch',()=>{
 assert.match(runJvm([sharedSpeechSource('CloudSpeechWire.java'),fixture('CloudSpeechWireTest.java')],'ai.eliza.voice.CloudSpeechWireTest'),/^PASS streaming speech/);
});
test('native Cloud streaming keeps credentials native and feeds PCM before provider completion',()=>{
 const source=fs.readFileSync(sharedSpeechSource('SpeechStreamBridgePlugin.java'),'utf8');
 assert.match(source,/own\.origin=cloudOrigin\(environment\)/);
 assert.match(source,/readCredential\(environment,credential,own\.epoch\)/);
 assert.match(source,/recorder==next/);
 assert.match(source,/new StreamingSpeechPlayback\(16000\*5,16000/);
 assert.match(source,/AudioTrackSpeechOutput\.open\(16000\)/);
 assert.match(source,/u\.playback\.offer\(Arrays\.copyOfRange\(samples/);
 assert.match(source,/u\.playback\.offer\(null,true\)/);
 assert.doesNotMatch(source,/MediaPlayer|FileOutputStream|android\.util\.Log/);
});
