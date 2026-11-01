import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSource,fixture,runJvm} from './fixtures/jvm-tools.mjs';
test('Cloud request timing separates safe network and preparation stages',()=>{
 assert.match(runJvm([nativeSource('CloudSpeechTimings.java'),fixture('CloudSpeechTimingsTest.java')],'ai.elizaresearch.alphaphone.CloudSpeechTimingsTest'),/^PASS Cloud speech timing/);
});
