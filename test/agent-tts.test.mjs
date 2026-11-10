import test from 'node:test';
import assert from 'node:assert/strict';
import {speechEnvironment} from '../scripts/host-speech-admission.ts';
const configure = env => speechEnvironment('tts', env);
test('TTS is opt-in, off is authoritative, required refuses absent configuration',()=>{
 assert.deepEqual(configure({}),{}); assert.deepEqual(configure({ELIZA_PARADEE_ENABLED:'0',ELIZA_PARADEE_MODEL_DIR:'/missing'}),{});
 assert.throws(()=>configure({ELIZA_PARADEE_ENABLED:'1'}),/absolute/);
 assert.throws(()=>configure({ELIZA_PARADEE_ENABLED:'invalid'}),/must be 1, 0 or unset/);
 assert.throws(()=>configure({ELIZA_PARADEE_MODEL_DIR:'/missing',ELIZA_INFERENCE_LIBRARY:'/missing'}),/reviewed SHA-256/);
});
test('the earlier Alpha-only and Kokoro speech names are refused with their upstream replacement',()=>{
 assert.throws(()=>configure({ALPHA_LOCAL_TTS:'off'}),/ALPHA_LOCAL_TTS was renamed to the upstream ELIZA_PARADEE_ENABLED/);
 assert.throws(()=>configure({ALPHA_TTS_MODEL_DIR:'/models'}),/renamed to the upstream ELIZA_PARADEE_MODEL_DIR/);
 assert.throws(()=>configure({ALPHA_TTS_LIBRARY:'/lib'}),/renamed to the upstream ELIZA_INFERENCE_LIBRARY/);
 assert.throws(()=>configure({ELIZA_KOKORO_MODEL_DIR:'/models'}),/Retired speech configuration/);
});
