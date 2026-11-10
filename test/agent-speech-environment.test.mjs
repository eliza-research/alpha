import test from 'node:test';
import assert from 'node:assert/strict';
import {agentAsrEnvironment} from '../scripts/agent-asr.ts';
import {agentTtsEnvironment} from '../scripts/agent-tts.ts';

const profiles = {
  ASR: {
    configure: agentAsrEnvironment,
    prefix: 'ELIZA_ASR',
    renames: {
      ALPHA_LOCAL_ASR: 'ELIZA_ASR_ENABLED',
      ALPHA_ASR_MODEL_DIR: 'ELIZA_ASR_MODEL_DIR',
    },
    retired: ['ALPHA_WHISPER_BIN', 'ALPHA_WHISPER_BACKEND', 'ALPHA_ASR_MODEL'],
  },
  TTS: {
    configure: agentTtsEnvironment,
    prefix: 'ELIZA_PARADEE',
    renames: {
      ALPHA_LOCAL_TTS: 'ELIZA_PARADEE_ENABLED',
      ALPHA_TTS_MODEL_DIR: 'ELIZA_PARADEE_MODEL_DIR',
      ALPHA_TTS_LIBRARY: 'ELIZA_INFERENCE_LIBRARY',
    },
    retired: ['ELIZA_KOKORO_MODEL_DIR'],
  },
};

for (const [name, {configure, prefix, renames, retired}] of Object.entries(profiles)) {
  const enabled = `${prefix}_ENABLED`;
  const model = `${prefix}_MODEL_DIR`;

  test(`${name} is opt-in and refuses incomplete or unreviewed runtime inputs`, () => {
    assert.deepEqual(configure({}), {});
    assert.deepEqual(configure({[enabled]: '0', [model]: '/missing'}), {});
    assert.throws(() => configure({[enabled]: '1'}), /absolute/);
    assert.throws(() => configure({[enabled]: 'invalid'}), /must be 1, 0 or unset/);
    assert.throws(() => configure({[model]: '/missing', ELIZA_INFERENCE_LIBRARY: '/missing'}), /reviewed SHA-256/);
  });

  test(`${name} reports renamed and retired environment variables`, () => {
    for (const [old, replacement] of Object.entries(renames)) {
      assert.throws(() => configure({[old]: 'old value'}), new RegExp(`${old} was renamed to the upstream ${replacement}`));
    }
    for (const key of retired) {
      assert.throws(() => configure({[key]: 'old value'}), /Retired speech configuration/);
    }
  });
}
