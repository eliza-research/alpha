import {selectedAndroidAbis, abiArguments} from './android-abis.ts';
/**
 * On-device voice host record (android/voice-host/qualified-voice-host.json, schema 2).
 *
 * The voice engine is the shared paradee-voice library on libelizainference (Paradee-8M TTS with
 * native misaki G2P, the voice bundle's model-agnostic ASR slot, Silero VAD). The record pins the
 * exact engine libraries per ABI and every bundle file that scripts/android-stage-voice-models.ts
 * may stage into .eliza/paradee-voice/native. Integrity only: `qualified` stays false until device
 * acceptance, and nothing here establishes emulator, device or user acceptance.
 */
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ASR_BACKEND_ROLES, PARADEE_NATIVE, PARADEE_SOURCE, asrSlotFiles, verifyParadeeRuntime} from './paradee-runtime.ts';

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
const isCommit = (value: any) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const isSha = (value: any) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isBytes = (value: any) => Number.isSafeInteger(value) && value > 0;
const BUNDLE_PATH = /^(?:asr|vad|notices|tts\/paradee)\/[A-Za-z0-9][A-Za-z0-9_.\/-]{0,159}$/;
const readJson = (root: any, relative: any) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

/** Problems with a record value (schema only). An empty list means usable. */
export function voiceHostProblems(record: any, label: any = VOICE_HOST_MANIFEST) {
  const problems: any[] = [], at = (where: any, message: any) => problems.push(`${label}: ${where} ${message}`);
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
    const asrRows = (Array.isArray(record.models) ? record.models : []).filter((model: any) => model?.role === 'asr-model' || model?.role === 'asr-mmproj');
    if (asrRows.map((model: any) => model.role).sort().join() !== [...backendRoles].sort().join()) at('models', `ASR rows must be exactly ${backendRoles.join(' and ')} for the ${record.asrSlot.backend} backend`);
    if (JSON.stringify(record.asrSlot.paths) !== JSON.stringify(asrRows.map((model: any) => model.path))) at('asrSlot.paths', 'must list the ASR rows in order');
  }
  if (!Array.isArray(record.abis) || record.abis.map((row: any) => row?.abi).join() !== VOICE_ABIS.join()) at('abis', `must record ${VOICE_ABIS.join(' and ')}`);
  for (const [index, row] of (Array.isArray(record.abis) ? record.abis : []).entries()) {
    if (!Array.isArray(row?.libraries) || row.libraries.map((lib: any) => lib?.name).join() !== VOICE_LIBRARIES.join()) { at(`abis[${index}].libraries`, `must list ${VOICE_LIBRARIES.join(', ')}`); continue; }
    for (const [n, lib] of row.libraries.entries()) if (!isSha(lib.sha256) || !isBytes(lib.bytes)) at(`abis[${index}].libraries[${n}]`, 'needs a lowercase SHA-256 and positive bytes');
    if (row.alignment16KiB !== true || !Number.isSafeInteger(row.abiVersion) || row.abiVersion < 17) at(`abis[${index}]`, 'needs 16 KiB alignment and voice ABI 17 or later');
  }
  if (!Array.isArray(record.models) || new Set(record.models.map((row: any) => row?.path)).size !== record.models.length) at('models', 'must be an array of unique bundle paths');
  for (const [index, model] of (Array.isArray(record.models) ? record.models : []).entries()) {
    if (!BUNDLE_PATH.test(model?.path ?? '') || model.path.split('/').some((part: any) => part === '..' || part === '.')) at(`models[${index}].path`, 'is not a bundle path');
    if (!VOICE_ROLES.includes(model?.role)) at(`models[${index}].role`, `must be one of ${VOICE_ROLES.join(', ')}`);
    if (!isSha(model?.sha256) || !isBytes(model?.bytes)) at(`models[${index}]`, 'needs a lowercase SHA-256 and positive bytes');
    for (const key of ['name', 'license', 'source']) if (typeof model?.[key] !== 'string' || !model[key]) at(`models[${index}].${key}`, 'is missing');
    if (['tts-model', 'asr-model', 'asr-mmproj', 'vad-model'].includes(model?.role) && !/\.gguf$/.test(model.path ?? '')) at(`models[${index}].path`, 'must be a GGUF file; libelizainference loads only GGUF models');
  }
  for (const role of VOICE_REQUIRED_ROLES) if (!(record.models ?? []).some((model: any) => model?.role === role)) at('models', `has no ${role}`);
  if (!Array.isArray(record.components)) at('components', 'must be an array');
  for (const [index, component] of (Array.isArray(record.components) ? record.components : []).entries())
    for (const key of ['name', 'license', 'source']) if (typeof component?.[key] !== 'string' || !component[key]) at(`components[${index}].${key}`, 'is missing');
  return problems;
}

/** Reads and admits the committed record against the pin, the shared Paradee inputs and the ASR slot. */
export function readVoiceHost(root: any) {
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
  const asr = record.models.filter((model: any) => model.role === 'asr-model' || model.role === 'asr-mmproj');
  if (slot.backend !== record.asrSlot.backend || files.length !== asr.length || files.some((file: any) => !asr.some((model: any) => model.path === file.path && model.role === file.role && model.sha256 === file.sha256 && model.bytes === file.bytes)))
    throw Error(`${VOICE_HOST_MANIFEST} ASR rows differ from ${VOICE_ASR_SLOT}`);
  const inputsFile = path.join(root, PARADEE_SOURCE, 'inputs.json');
  if (fs.existsSync(inputsFile)) {
    const inputs = JSON.parse(fs.readFileSync(inputsFile, 'utf8'));
    for (const pinned of [inputs.paradee, inputs.lexicon]) {
      const row = record.models.find((model: any) => model.path === pinned.path);
      if (!row || row.sha256 !== pinned.sha256 || row.bytes !== pinned.bytes) throw Error(`${VOICE_HOST_MANIFEST} does not match the pinned ${pinned.path}`);
    }
  }
  return record;
}

/**
 * A packaged voice bundle (assets/paradee-voice/v1) and its engine libraries against the record.
 * `names` lists the APK entries and `read(entry)` returns an entry's bytes. The bundle must list and
 * carry every recorded non-ASR file; the ASR slot is all or nothing (`asr` says which). Each ABI
 * that packages the voice JNI must carry every recorded library byte for byte. Records whether
 * on-device voice is packaged; qualification is never inferred from bytes. A host loader is
 * invoked only when native speech bytes are present in the APK.
 */
export function voiceBundleAdmission({names, read}: any, host: any) {
  const root = `${VOICE_BUNDLE_ASSETS}/`, manifestEntry = `${root}manifest.json`;
  const bundle = names.filter((name: any) => name.startsWith(root));
  if (!bundle.length) return {packaged: false, asr: false, differences: [], qualified: false};
  if (typeof host === 'function') host = host();
  const differences: any[] = [];
  const digest = (bytes: any) => createHash('sha256').update(bytes).digest('hex');
  let manifest: any = null;
  try { manifest = names.includes(manifestEntry) ? JSON.parse(read(manifestEntry).toString('utf8')) : null; } catch { /* reported below */ }
  if (manifest?.format !== VOICE_BUNDLE_FORMAT) differences.push(`${manifestEntry} is missing or has another format`);
  const listed = new Set<string>((Array.isArray(manifest?.files) ? manifest.files : []).map((row: any) => row?.path));
  const pinned = new Map<string,{bytes:number;sha256:string}>(host.models.map((row: any) => [row.path, row]));
  for (const file of listed) {
    const entry = `${root}${file}`, expected = pinned.get(file);
    if (!expected || !names.includes(entry)) { differences.push(`${entry}: not a recorded voice file`); continue; }
    const bytes = read(entry);
    if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256) differences.push(`${entry}: differs from the recorded bytes`);
  }
  const slot = host.asrSlot.paths;
  for (const row of host.models) if (!slot.includes(row.path) && !listed.has(row.path)) differences.push(`${root}${row.path}: recorded voice file is not packaged`);
  const asrListed = slot.filter((file: any) => listed.has(file));
  if (asrListed.length && asrListed.length !== slot.length) differences.push(`${root}: the ASR slot is incomplete (${slot.filter((file: any) => !listed.has(file)).join(', ')} missing)`);
  for (const name of bundle) if (name !== manifestEntry && !listed.has(name.slice(root.length))) differences.push(`${name}: unlisted voice entry`);
  for (const abi of new Set(names.filter((name: any) => /^lib\/[^/]+\/libparadeevoicejni\.so$/.test(name)).map((name: any) => name.split('/')[1]))) {
    const libraries = host.abis.find((row: any) => row.abi === abi)?.libraries;
    if (!libraries) { differences.push(`lib/${abi}: no voice host engine is recorded for this ABI`); continue; }
    for (const library of libraries) {
      const entry = `lib/${abi}/${library.name}`, bytes = names.includes(entry) ? read(entry) : null;
      if (!bytes || bytes.length !== library.bytes || digest(bytes) !== library.sha256) differences.push(`${entry}: differs from the recorded voice host library`);
    }
  }
  return {packaged: true, asr: slot.length > 0 && asrListed.length === slot.length, differences, qualified: host.qualified === true};
}

/** Metadata-only staging classification for the explicit unavailable lane.
 * The normal stager owns .eliza/paradee-voice/native. Raw/default Gradle
 * speech roots and old upstream outputs must not masquerade as its absence.
 * This says nothing about a built APK, native capability or voice acceptance.
 */
function voiceStagingState(root: any) {
  const at = (relative: any) => {
    let current = path.resolve(root);
    const rootStat = fs.lstatSync(current);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('Voice staging root must be a real directory');
    let value;
    const parts = relative.split('/');
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]);
      try { value = fs.lstatSync(current); }
      catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error; }
      if (value.isSymbolicLink() || (index < parts.length - 1 && !value.isDirectory())) throw Error('Voice staging contains a link or non-directory parent');
    }
    return value;
  };
  for (const relative of [
    'vendor/eliza/plugins/plugin-local-inference/native/android/native',
    'vendor/eliza/packages/app/platforms/android/paradee-voice/native',
  ]) if (at(relative)) throw Error(`Unrecognized voice staging outside the admitted product output: ${relative}`);
  const checkRawVoiceJni = (rawJni: any) => {
    if (!at(rawJni)) return;
    const entries = fs.readdirSync(path.join(root, rawJni), {withFileTypes: true});
    if (entries.length > 64) throw Error('Voice staging ABI inventory is unbounded');
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw Error('Voice staging JNI sources contain a link');
      if (entry.name === 'libparadeevoicejni.so' || entry.isDirectory() && at(`${rawJni}/${entry.name}/libparadeevoicejni.so`))
        throw Error('Unrecorded voice JNI payload is staged in the application');
    }
  };
  // AGP's ordinary main/build-type/flavor/variant overlays stay active in the
  // Java-only branch too. Check every real src/* directory conservatively,
  // including release/debug and standalone/launcher combinations.
  for (const module of ['android/local-speech', 'android/app']) {
    const sourceRoot = `${module}/src`;
    const present = at(sourceRoot);
    if (!present) continue;
    if (!present.isDirectory()) throw Error('Voice source-set root is not a directory');
    const sets = fs.readdirSync(path.join(root, sourceRoot), {withFileTypes: true});
    if (sets.length > 64) throw Error('Voice source-set inventory is unbounded');
    for (const set of sets) {
      if (set.isSymbolicLink()) throw Error('Voice source-set overlay contains a link');
      if (!set.isDirectory()) continue;
      const base = `${sourceRoot}/${set.name}`;
      if (module === 'android/local-speech') {
        if (at(`${base}/assets`) || at(`${base}/jniLibs`)) throw Error(`Unrecognized voice staging in a speech source-set overlay: ${base}`);
      } else {
        if (at(`${base}/assets/paradee-voice`)) throw Error(`Unrecognized voice staging in an application source-set overlay: ${base}`);
        checkRawVoiceJni(`${base}/jniLibs`);
      }
    }
  }
  const owner = '.eliza/paradee-voice';
  const ownerStat = at(owner);
  if (!ownerStat) return 'absent';
  if (!ownerStat.isDirectory()) throw Error('Voice staging owner is not a directory');
  const children = fs.readdirSync(path.join(root, owner));
  if (children.length !== 1 || children[0] !== 'native') throw Error('Partial or unknown voice staging owner is present');
  const native = at(`${owner}/native`);
  if (!native?.isDirectory()) throw Error('Voice staging native output is not a real directory');
  return 'present';
}

/**
 * Build admission. Absent native voice outputs are accepted only for the explicit unpackaged
 * developer lane (`allowAbsentRuntime`); present outputs must be complete and byte-exact against
 * both the shared build record (scripts/paradee-runtime.ts) and this record. Never downloads.
 */
export function verifyVoiceHost(root: any, {allowAbsentRuntime = false, runtime = verifyParadeeRuntime, abis}: any = {}) {
  const selected = selectedAndroidAbis(abis);
  const staging = voiceStagingState(root);
  // Only explicit mode + metadata-proven absence can avoid reading a record.
  // Present/partial/orphaned output never inherits a stale source admission.
  if (allowAbsentRuntime === true && staging === 'absent') return {status: 'not-packaged', qualified: false};
  const record = readVoiceHost(root);
  const native = path.join(root, PARADEE_NATIVE);
  if (staging === 'absent') {
    throw Error(`On-device voice outputs are not staged in ${PARADEE_NATIVE}; run node scripts/android-stage-voice-models.ts`);
  }
  runtime(root, {abis: selected});
  const build = JSON.parse(fs.readFileSync(path.join(native, 'build-record.json'), 'utf8'));
  const recorded = new Map<string,{bytes:number;sha256:string}>(build.files.map((row: any) => [row.path, row]));
  for (const model of record.models) {
    const row = recorded.get(`${VOICE_BUNDLE_ASSETS}/${model.path}`);
    if (!row || row.sha256 !== model.sha256 || row.bytes !== model.bytes) throw Error(`Staged ${model.path} is not the bytes recorded in ${VOICE_HOST_MANIFEST}`);
  }
  for (const abi of record.abis.filter((row: any) => selected.includes(row.abi))) {
    const engine = abi.libraries.find((lib: any) => lib.name === 'libelizainference.so');
    const row = recorded.get(`jniLibs/${abi.abi}/libelizainference.so`);
    if (!row || row.sha256 !== engine.sha256 || row.bytes !== engine.bytes) throw Error(`Staged ${abi.abi} engine is not the library recorded in ${VOICE_HOST_MANIFEST}`);
  }
  return {status: 'packaged', qualified: record.qualified === true};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {rest: args, abis} = abiArguments(process.argv.slice(2));
  if (args[0] !== '--verify' || args.slice(1).some((arg: any) => arg !== '--allow-absent')) throw Error('Usage: node scripts/voice-host.ts --verify [--allow-absent]');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log(JSON.stringify(verifyVoiceHost(root, {allowAbsentRuntime: args.includes('--allow-absent'), abis})));
}
