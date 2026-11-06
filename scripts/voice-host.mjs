/**
 * On-device voice host record (android/voice-host/qualified-voice-host.json, schema 2).
 *
 * The voice engine is the shared paradee-voice library on libelizainference (Paradee-8M TTS with
 * native misaki G2P, the voice bundle's model-agnostic ASR slot, Silero VAD). The record pins the
 * exact engine libraries per ABI and every bundle file that scripts/android-stage-voice-models.mjs
 * may stage into .eliza/paradee-voice/native. Integrity only: `qualified` stays false until device
 * acceptance, and nothing here establishes emulator, device or user acceptance.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ASR_BACKEND_ROLES, PARADEE_NATIVE, PARADEE_SOURCE, asrSlotFiles, verifyParadeeRuntime} from './paradee-runtime.mjs';

export const VOICE_HOST_MANIFEST = 'android/voice-host/qualified-voice-host.json';
export const VOICE_ASR_SLOT = 'android/paradee-voice/asr-inputs.json';
export const VOICE_ASSET_ROOT = PARADEE_NATIVE;
export const VOICE_BUNDLE_FORMAT = 'eliza-paradee-voice-v2';
export const VOICE_BUNDLE_ASSETS = 'assets/paradee-voice/v1';
export const VOICE_ABIS = Object.freeze(['arm64-v8a', 'x86_64']);
export const VOICE_LIBRARIES = Object.freeze(['libelizainference.so', 'libc++_shared.so']);
export const VOICE_ROLES = Object.freeze(['tts-model', 'g2p-lexicon', 'g2p-data', 'asr-model', 'asr-mmproj', 'vad-model', 'notice']);
/** Roles a packaged bundle must carry: speech output, G2P and an ASR model (the slot record decides the rest). */
export const VOICE_REQUIRED_ROLES = Object.freeze(['tts-model', 'g2p-lexicon', 'asr-model']);
const isCommit = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const isSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isBytes = value => Number.isSafeInteger(value) && value > 0;
const BUNDLE_PATH = /^(?:asr|vad|notices|tts\/paradee)\/[A-Za-z0-9][A-Za-z0-9_.\/-]{0,159}$/;
const readJson = (root, relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

/** Problems with a record value (schema only). An empty list means usable. */
export function voiceHostProblems(record, label = VOICE_HOST_MANIFEST) {
  const problems = [], at = (where, message) => problems.push(`${label}: ${where} ${message}`);
  if (!record || typeof record !== 'object' || Array.isArray(record)) return [`${label}: not a JSON object`];
  if (record.schemaVersion !== 2) at('schemaVersion', 'must be 2');
  for (const key of ['pin', 'forkPin']) if (!isCommit(record[key])) at(key, 'must be a 40-character git commit');
  if (record.provider !== 'libelizainference-paradee') at('provider', 'must be libelizainference-paradee');
  if (typeof record.qualified !== 'boolean') at('qualified', 'must be a boolean');
  if (record.nativeOutput !== PARADEE_NATIVE) at('nativeOutput', `must be ${PARADEE_NATIVE}`);
  if (record.bundle?.format !== VOICE_BUNDLE_FORMAT || record.bundle?.assetRoot !== VOICE_BUNDLE_ASSETS) at('bundle', 'layout changed');
  if (record.asrSlot?.record !== VOICE_ASR_SLOT) at('asrSlot.record', `must be ${VOICE_ASR_SLOT}`);
  const backendRoles = ASR_BACKEND_ROLES[record.asrSlot?.backend];
  if (!backendRoles) at('asrSlot.backend', 'must be parakeet or qwen3');
  else {
    const asrRows = (Array.isArray(record.models) ? record.models : []).filter(model => model?.role === 'asr-model' || model?.role === 'asr-mmproj');
    if (asrRows.map(model => model.role).sort().join() !== [...backendRoles].sort().join()) at('models', `ASR rows must be exactly ${backendRoles.join(' and ')} for the ${record.asrSlot.backend} backend`);
    if (JSON.stringify(record.asrSlot.paths) !== JSON.stringify(asrRows.map(model => model.path))) at('asrSlot.paths', 'must list the ASR rows in order');
  }
  if (!Array.isArray(record.abis) || record.abis.map(row => row?.abi).join() !== VOICE_ABIS.join()) at('abis', `must record ${VOICE_ABIS.join(' and ')}`);
  for (const [index, row] of (Array.isArray(record.abis) ? record.abis : []).entries()) {
    if (!Array.isArray(row?.libraries) || row.libraries.map(lib => lib?.name).join() !== VOICE_LIBRARIES.join()) { at(`abis[${index}].libraries`, `must list ${VOICE_LIBRARIES.join(', ')}`); continue; }
    for (const [n, lib] of row.libraries.entries()) if (!isSha(lib.sha256) || !isBytes(lib.bytes)) at(`abis[${index}].libraries[${n}]`, 'needs a lowercase SHA-256 and positive bytes');
    if (row.alignment16KiB !== true || !Number.isSafeInteger(row.abiVersion) || row.abiVersion < 17) at(`abis[${index}]`, 'needs 16 KiB alignment and voice ABI 17 or later');
  }
  if (!Array.isArray(record.models) || new Set(record.models.map(row => row?.path)).size !== record.models.length) at('models', 'must be an array of unique bundle paths');
  for (const [index, model] of (Array.isArray(record.models) ? record.models : []).entries()) {
    if (!BUNDLE_PATH.test(model?.path ?? '') || model.path.split('/').some(part => part === '..' || part === '.')) at(`models[${index}].path`, 'is not a bundle path');
    if (!VOICE_ROLES.includes(model?.role)) at(`models[${index}].role`, `must be one of ${VOICE_ROLES.join(', ')}`);
    if (!isSha(model?.sha256) || !isBytes(model?.bytes)) at(`models[${index}]`, 'needs a lowercase SHA-256 and positive bytes');
    for (const key of ['name', 'license', 'source']) if (typeof model?.[key] !== 'string' || !model[key]) at(`models[${index}].${key}`, 'is missing');
    if (['tts-model', 'asr-model', 'asr-mmproj', 'vad-model'].includes(model?.role) && !/\.gguf$/.test(model.path ?? '')) at(`models[${index}].path`, 'must be a GGUF file; libelizainference loads only GGUF models');
  }
  for (const role of VOICE_REQUIRED_ROLES) if (!(record.models ?? []).some(model => model?.role === role)) at('models', `has no ${role}`);
  if (!Array.isArray(record.components)) at('components', 'must be an array');
  for (const [index, component] of (Array.isArray(record.components) ? record.components : []).entries())
    for (const key of ['name', 'license', 'source']) if (typeof component?.[key] !== 'string' || !component[key]) at(`components[${index}].${key}`, 'is missing');
  if (!record.evidence || typeof record.evidence.deviceExecuted !== 'boolean' || typeof record.evidence.emulatorDeviceExecuted !== 'boolean') at('evidence', 'must record emulator and device execution');
  if (record.qualified === true && (record.evidence?.deviceExecuted !== true || record.evidence?.userAccepted !== true)) at('qualified', 'cannot be true without device execution and user acceptance');
  return problems;
}

/** Reads and admits the committed record against the pin, the shared Paradee inputs and the ASR slot. */
export function readVoiceHost(root) {
  const record = readJson(root, VOICE_HOST_MANIFEST);
  const problems = voiceHostProblems(record);
  if (problems.length) throw Error(problems.join('\n'));
  const pin = readJson(root, 'upstream.lock.json').commit;
  if (record.pin !== pin) throw Error(`${VOICE_HOST_MANIFEST} records pin ${record.pin}; upstream.lock.json pins ${pin}`);
  const identity = readJson(root, 'app.config.json').appId;
  if (record.identity !== identity) throw Error(`${VOICE_HOST_MANIFEST} identity changed`);
  // Model-agnostic ASR slot: the record's asr rows must be exactly the reviewed slot record.
  const slot = readJson(root, VOICE_ASR_SLOT);
  const files = asrSlotFiles(slot);
  const asr = record.models.filter(model => model.role === 'asr-model' || model.role === 'asr-mmproj');
  if (slot.backend !== record.asrSlot.backend || files.length !== asr.length || files.some(file => !asr.some(model => model.path === file.path && model.role === file.role && model.sha256 === file.sha256 && model.bytes === file.bytes)))
    throw Error(`${VOICE_HOST_MANIFEST} ASR rows differ from ${VOICE_ASR_SLOT}`);
  const inputsFile = path.join(root, PARADEE_SOURCE, 'inputs.json');
  if (fs.existsSync(inputsFile)) {
    const inputs = JSON.parse(fs.readFileSync(inputsFile, 'utf8'));
    for (const pinned of [inputs.paradee, inputs.lexicon]) {
      const row = record.models.find(model => model.path === pinned.path);
      if (!row || row.sha256 !== pinned.sha256 || row.bytes !== pinned.bytes) throw Error(`${VOICE_HOST_MANIFEST} does not match the pinned ${pinned.path}`);
    }
  }
  return record;
}

/**
 * Build admission. Absent native voice outputs are accepted only for the explicit unpackaged
 * developer lane (`allowAbsentRuntime`); present outputs must be complete and byte-exact against
 * both the shared build record (scripts/paradee-runtime.mjs) and this record. Never downloads.
 */
export function verifyVoiceHost(root, {allowAbsentRuntime = false, runtime = verifyParadeeRuntime} = {}) {
  const native = path.join(root, PARADEE_NATIVE);
  if (!fs.existsSync(native)) {
    if (allowAbsentRuntime) return {status: 'not-packaged', qualified: false};
    throw Error(`On-device voice outputs are not staged in ${PARADEE_NATIVE}; run node scripts/android-stage-voice-models.mjs`);
  }
  const record = readVoiceHost(root);
  runtime(root);
  const build = JSON.parse(fs.readFileSync(path.join(native, 'build-record.json'), 'utf8'));
  const recorded = new Map(build.files.map(row => [row.path, row]));
  for (const model of record.models) {
    const row = recorded.get(`${VOICE_BUNDLE_ASSETS}/${model.path}`);
    if (!row || row.sha256 !== model.sha256 || row.bytes !== model.bytes) throw Error(`Staged ${model.path} is not the bytes recorded in ${VOICE_HOST_MANIFEST}`);
  }
  for (const abi of record.abis) {
    const engine = abi.libraries.find(lib => lib.name === 'libelizainference.so');
    const row = recorded.get(`jniLibs/${abi.abi}/libelizainference.so`);
    if (!row || row.sha256 !== engine.sha256 || row.bytes !== engine.bytes) throw Error(`Staged ${abi.abi} engine is not the library recorded in ${VOICE_HOST_MANIFEST}`);
  }
  return {status: 'packaged', qualified: record.qualified === true};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] !== '--verify' || args.slice(1).some(arg => arg !== '--allow-absent')) throw Error('Usage: node scripts/voice-host.mjs --verify [--allow-absent]');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  readVoiceHost(root);
  console.log(JSON.stringify(verifyVoiceHost(root, {allowAbsentRuntime: args.includes('--allow-absent')})));
}
