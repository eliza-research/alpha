import {constants, openSync, closeSync, fstatSync, readSync} from 'node:fs';
import {join, isAbsolute} from 'node:path';

import {RENAMED, RETIRED} from './speech-env.ts';

// Upstream elizaOS names only (scripts/speech-env.ts).
const modes:Readonly<Record<string,readonly string[]>> = {
  ELIZA_ASR_ENABLED: ['0', '1'],
  ELIZA_PARADEE_ENABLED: ['0', '1'],
};
const paths = new Set(['ELIZA_INFERENCE_LIBRARY', 'ELIZA_ASR_MODEL_DIR', 'ELIZA_PARADEE_MODEL_DIR']);
// The earlier Alpha-only keys are refused with their upstream replacement, never read as it, and
// the retired keys (Whisper CLI, single ASR model, Kokoro) are refused: nothing is mapped or ignored.

/** Host-only, nonsecret asset selection. Existing asset admission still runs at startup. */
export function developmentSpeechEnvironment(profile: string, inherited: NodeJS.ProcessEnv = process.env):NodeJS.ProcessEnv {
  const file = join(profile, 'local-speech.json');
  let fd;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error: any) { if (error.code === 'ENOENT') return {...inherited}; throw error; }
  let saved;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) {
      throw Error('Local speech settings must be an owner-only regular file.');
    }
    if (stat.size > 16384) throw Error('Local speech settings are too large.');
    const bytes = Buffer.alloc(16385); let length = 0;
    while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    if (length > 16384) throw Error('Local speech settings are too large.');
    const text = bytes.subarray(0, length).toString('utf8');
    try { saved = JSON.parse(text); } catch { throw Error('Local speech settings must contain valid JSON.'); }
  } finally { closeSync(fd); }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw Error('Local speech settings must be an object.');
  for (const [old, replacement] of Object.entries(RENAMED)) if (Object.hasOwn(saved, old)) {
    throw Error(`local-speech.json: ${old} is not supported; rename it to the upstream ${replacement}.`);
  }
  for (const name of RETIRED) if (Object.hasOwn(saved, name)) {
    throw Error(`local-speech.json: ${name} is retired; configure ELIZA_INFERENCE_LIBRARY with ELIZA_INFERENCE_LIBRARY_SHA256, ELIZA_ASR_MODEL_DIR and ELIZA_PARADEE_MODEL_DIR.`);
  }
  for (const [key, value] of Object.entries(saved)) {
    if (!Object.hasOwn(modes, key) && !paths.has(key) && key !== 'ELIZA_INFERENCE_LIBRARY_SHA256') throw Error('Unsupported local speech setting. Store credentials separately.');
    if (typeof value !== 'string' || (Object.hasOwn(modes, key) ? !modes[key].includes(value) : key === 'ELIZA_INFERENCE_LIBRARY_SHA256' ? !/^[a-f0-9]{64}$/.test(value) : !isAbsolute(value) || value.includes('\0'))) {
      throw Error('Invalid local speech setting. Use supported modes and absolute asset paths.');
    }
  }
  // Explicit environment choices, including "off", always win over saved defaults.
  return {...saved, ...inherited};
}
