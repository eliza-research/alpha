/**
 * Development speech configuration uses the upstream elizaOS names only:
 *   ELIZA_INFERENCE_LIBRARY (+ its reviewed ELIZA_INFERENCE_LIBRARY_SHA256)
 *   ELIZA_PARADEE_ENABLED / ELIZA_PARADEE_MODEL_DIR   (Paradee-8M TTS)
 *   ELIZA_ASR_ENABLED / ELIZA_ASR_MODEL_DIR           (the voice bundle's ASR slot and VAD)
 * An *_ENABLED value of 1 requires the service, 0 turns it off, and unset enables it only when a
 * model directory is configured. The earlier Alpha-only names are refused with their replacement.
 */
export const RENAMED = Object.freeze({
  ALPHA_LOCAL_TTS: 'ELIZA_PARADEE_ENABLED', ALPHA_TTS_MODEL_DIR: 'ELIZA_PARADEE_MODEL_DIR', ALPHA_TTS_LIBRARY: 'ELIZA_INFERENCE_LIBRARY',
  ALPHA_LOCAL_ASR: 'ELIZA_ASR_ENABLED', ALPHA_ASR_MODEL_DIR: 'ELIZA_ASR_MODEL_DIR',
});
/** Retired with no equivalent: the shared ASR slot replaced the Whisper CLI and its single model. */
export const RETIRED = Object.freeze(['ALPHA_WHISPER_BIN', 'ALPHA_WHISPER_BACKEND', 'ALPHA_ASR_MODEL', 'ELIZA_KOKORO_MODEL_DIR', 'ELIZA_KOKORO_ENABLED']);

export function refuseRetiredSpeechNames(env: NodeJS.ProcessEnv) {
  for (const [old, replacement] of Object.entries(RENAMED)) if (env[old] !== undefined) throw Error(`${old} was renamed to the upstream ${replacement}`);
  for (const name of RETIRED) if (env[name] !== undefined) throw Error(`Retired speech configuration ${name}: use ELIZA_INFERENCE_LIBRARY with its reviewed SHA-256 and ELIZA_ASR_MODEL_DIR / ELIZA_PARADEE_MODEL_DIR`);
}

/** 'auto' (unset), 'off' (0) or 'required' (1) for an upstream *_ENABLED variable. */
export function speechMode(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name];
  if (value === undefined || value === '') return 'auto';
  if (value === '0') return 'off';
  if (value === '1') return 'required';
  throw Error(`${name} must be 1, 0 or unset`);
}
