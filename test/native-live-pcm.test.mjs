import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSource,fixture,runJvm,jsonJarSkip,upstreamVoiceSource,upstreamVoiceFixture} from './fixtures/jvm-tools.mjs';

// The bounded pipe and buffered IPC exchange are the shared ai.eliza.voice LiveSegmentPipe and
// BufferedStreamExchange; Alpha keeps only the owner-bound enrollment that feeds them.
test('shared PCM pipe bounds queued audio and fences cancellation/re-enrollment',{skip:jsonJarSkip},()=>{
 assert.match(runJvm([upstreamVoiceSource('LiveSegmentPipe.java'),upstreamVoiceFixture('LiveSegmentPipeTest.java')],'ai.eliza.voice.LiveSegmentPipeTest',{json:true}),/^PASS live segment pipe/);
});

test('shared IPC exchange has its own cancellable deadline and bounded response',{skip:jsonJarSkip},()=>{
 assert.match(runJvm([upstreamVoiceSource('BufferedStreamExchange.java'),upstreamVoiceFixture('BufferedStreamExchangeTest.java')],'ai.eliza.voice.BufferedStreamExchangeTest',{json:true}),/^PASS buffered stream exchange/);
});

test('Alpha voice enrollment binding rejects re-enrollment, epoch, owner, runtime and expiry changes',()=>{
 assert.match(runJvm(['NativeVoiceBinding.java','VoiceEventAdmission.java'].map(nativeSource).concat(fixture('NativeVoiceBindingTest.java')),'ai.elizaresearch.alphaphone.NativeVoiceBindingTest'),/^PASS native voice binding/);
});
