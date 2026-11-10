import test from 'node:test';
import assert from 'node:assert/strict';
import {speechEnvironment} from '../scripts/host-speech-admission.ts';
const configure = env => speechEnvironment('asr', env);
test('ASR is opt-in, off is authoritative, required refuses absent configuration',()=>{
 assert.deepEqual(configure({}),{}); assert.deepEqual(configure({ELIZA_ASR_ENABLED:'0',ELIZA_ASR_MODEL_DIR:'/missing'}),{});
 assert.throws(()=>configure({ELIZA_ASR_ENABLED:'1'}),/absolute/);
 assert.throws(()=>configure({ELIZA_ASR_ENABLED:'invalid'}),/must be 1, 0 or unset/);
 assert.throws(()=>configure({ELIZA_ASR_MODEL_DIR:'/missing',ELIZA_INFERENCE_LIBRARY:'/missing'}),/reviewed SHA-256/);
});
test('the earlier Alpha-only speech names are refused with their upstream replacement',()=>{
 assert.throws(()=>configure({ALPHA_LOCAL_ASR:'off'}),/ALPHA_LOCAL_ASR was renamed to the upstream ELIZA_ASR_ENABLED/);
 assert.throws(()=>configure({ALPHA_ASR_MODEL_DIR:'/models'}),/renamed to the upstream ELIZA_ASR_MODEL_DIR/);
 for(const name of ['ALPHA_WHISPER_BIN','ALPHA_WHISPER_BACKEND','ALPHA_ASR_MODEL'])assert.throws(()=>configure({[name]:'x'}),/Retired speech configuration/);
});
