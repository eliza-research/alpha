#!/usr/bin/env node
/**
 * Stage the on-device voice outputs (.eliza/paradee-voice/native) from operator-supplied files.
 *
 *   node scripts/android-stage-voice-models.mjs --from <directory> [--from <directory> ...]
 *   node scripts/android-stage-voice-models.mjs --plan
 *   node scripts/android-stage-voice-models.mjs --from <directory> ... --unrecorded-engine   (hosted CI only)
 *
 * Every row of android/voice-host/qualified-voice-host.json (the engine library per ABI and every
 * bundle file: Paradee GGUF, misaki lexicon, eSpeak NG data, the ASR slot pair, Silero VAD and the
 * notices) is looked up in the --from directories by its bundle path, its upstream build output
 * path (assets/paradee-voice/v1/<path>, jniLibs/<abi>/<name>, <abi>/<name>), its file name or its
 * recorded sourceFile, then checked by size and SHA-256 and copied. The result is the layout the
 * shared paradee-voice consumer.gradle reads: jniLibs/<abi>/libelizainference.so, the bundle
 * manifest at assets/paradee-voice/v1/manifest.json and build-record.json, which
 * scripts/paradee-runtime.mjs and scripts/voice-host.mjs verify before Gradle runs.
 *
 * The bundle ships in the APK assets (about 1.1 GB with the ASR pair) and the app copies it to
 * its storage with per-file hash verification on first use. Nothing is downloaded or repaired;
 * an existing output with other bytes is refused. Staging grants no qualification.
 *
 * `--unrecorded-engine` is for hosted developer-APK runs that rebuild the engine with the shared
 * builder: a rebuild cannot reproduce the recorded bytes (build IDs), so the rebuilt engine is
 * staged and this workspace's record is rewritten to name it with engineAdmission
 * 'unreviewed workspace build'. That record must never be committed; every model byte must still
 * match exactly, and the result is never distributable (the record stays qualified:false).
 */
import {selectedAndroidAbis, abiArguments} from './android-abis.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PARADEE_SOURCE} from './paradee-runtime.mjs';
import {VOICE_ASSET_ROOT, VOICE_BUNDLE_ASSETS, VOICE_BUNDLE_FORMAT, VOICE_HOST_MANIFEST, readVoiceHost, verifyVoiceHost} from './voice-host.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = file => {
  const hash = createHash('sha256'), fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(4 * 1024 * 1024);
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, n)); } finally { fs.closeSync(fd); }
  return hash.digest('hex');
};

/** Finds a pinned row's bytes under one of `from`. Returns null when no candidate exists. */
export function locate(from, row, candidates, {acceptOther = false} = {}) {
  for (const directory of from) for (const relative of candidates) {
    const candidate = path.join(directory, relative);
    if (!fs.existsSync(candidate)) continue;
    if (fs.lstatSync(candidate).isSymbolicLink()) throw Error(`Refusing linked input ${candidate}`);
    if (acceptOther || (fs.statSync(candidate).size === row.bytes && digest(candidate) === row.sha256)) return candidate;
    throw Error(`${candidate} does not match the pinned ${row.path ?? row.name} (${row.sha256}, ${row.bytes} bytes)`);
  }
  return null;
}

/** A rebuilt engine must carry its own matching source and byte provenance before admission. */
function verifyEngineBuild(source, directories, record, actual) {
  const directory = directories.find(directory => record.abis.some(abi =>
    [`jniLibs/${abi.abi}/libelizainference.so`, `${abi.abi}/libelizainference.so`].some(relative => path.join(directory, relative) === source)));
  const filename = path.join(directory, 'build-record.json');
  if (!fs.existsSync(filename) || !fs.lstatSync(filename).isFile()) throw Error('Rebuilt engine source build record is missing or nonregular');
  const build = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (build.sourceCommit !== record.pin || build.nativeCommit !== record.forkPin) throw Error('Rebuilt engine source revisions do not match the pinned source revisions');
  const relative = path.relative(directory, source);
  const rows = Array.isArray(build.files) ? build.files.filter(row => row.path === relative) : [];
  if (rows.length !== 1 || rows[0].sha256 !== actual.sha256 || rows[0].bytes !== actual.bytes) throw Error('Rebuilt engine bytes do not match its source build record');
}

export function stageVoiceModels(productRoot, {from, unrecordedEngine = false, abis}) {
  const record = readVoiceHost(productRoot);
  const selected = selectedAndroidAbis(abis);
  const selectedRows = selected.map(abi => record.abis.find(row => row.abi === abi));
  const directories = from.map(directory => path.resolve(directory));
  const rows = [];
  for (const model of record.models) {
    const names = [model.path, `${VOICE_BUNDLE_ASSETS}/${model.path}`, `assets/paradee-voice/v1/${model.path}`, path.basename(model.path), ...(model.sourceFile ? [model.sourceFile, `${path.dirname(model.path)}/${model.sourceFile}`] : [])];
    const source = locate(directories, model, names);
    if (!source) throw Error(`Missing ${model.path} (${model.sourceFile ?? path.basename(model.path)}) in ${from.join(', ')}; pinned source: ${model.source}`);
    rows.push({target: `${VOICE_BUNDLE_ASSETS}/${model.path}`, bundlePath: model.path, sha256: model.sha256, bytes: model.bytes, source});
  }
  for (const abi of selectedRows) {
    const engine = abi.libraries.find(lib => lib.name === 'libelizainference.so');
    const source = locate(directories, engine, [`jniLibs/${abi.abi}/${engine.name}`, `${abi.abi}/${engine.name}`], {acceptOther: unrecordedEngine});
    if (!source) throw Error(`Missing ${abi.abi}/${engine.name} in ${from.join(', ')}`);
    const actual = {sha256: digest(source), bytes: fs.statSync(source).size};
    if (unrecordedEngine) verifyEngineBuild(source, directories, record, actual);
    if (actual.sha256 !== engine.sha256 || actual.bytes !== engine.bytes) {
      // Only reachable with --unrecorded-engine: this workspace's record names the rebuilt bytes.
      Object.assign(engine, actual);abi.engineAdmission = 'unreviewed workspace build (hosted CI; never commit this record)';
    }
    rows.push({target: `jniLibs/${abi.abi}/${engine.name}`, sha256: engine.sha256, bytes: engine.bytes, source});
  }
  if (record.abis.some(abi => abi.engineAdmission)) {
    record.qualified = false;
    fs.writeFileSync(path.join(productRoot, VOICE_HOST_MANIFEST), `${JSON.stringify(record, null, 2)}\n`);
  }
  const output = path.join(productRoot, VOICE_ASSET_ROOT);
  for (let p = output; p !== productRoot && p !== path.dirname(p); p = path.dirname(p))
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw Error('Voice outputs must not traverse a link');
  for (const row of rows) {
    const destination = path.join(output, row.target);
    if (fs.existsSync(destination) && (fs.lstatSync(destination).isSymbolicLink() || fs.statSync(destination).size !== row.bytes || digest(destination) !== row.sha256))
      throw Error(`${path.relative(productRoot, destination)} already exists with other bytes; review before replacing`);
  }
  for (const row of rows) {
    const destination = path.join(output, row.target);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    if (!fs.existsSync(destination)) fs.copyFileSync(row.source, destination, fs.constants.COPYFILE_EXCL);
  }
  const inputs = JSON.parse(fs.readFileSync(path.join(productRoot, PARADEE_SOURCE, 'inputs.json'), 'utf8'));
  const bundleFiles = rows.filter(row => row.bundlePath).map(row => ({path: row.bundlePath, bytes: row.bytes, sha256: row.sha256})).sort((a, b) => a.path.localeCompare(b.path));
  const manifest = {format: VOICE_BUNDLE_FORMAT, model: inputs.paradee.path, lexicon: inputs.lexicon.path, espeakDir: 'tts/paradee', files: bundleFiles};
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`, manifestFile = path.join(output, VOICE_BUNDLE_ASSETS, 'manifest.json');
  if (fs.existsSync(manifestFile) && fs.readFileSync(manifestFile, 'utf8') !== manifestText) throw Error(`${path.relative(productRoot, manifestFile)} already exists with other content; review before replacing`);
  fs.writeFileSync(manifestFile, manifestText);
  const files = [{path: `${VOICE_BUNDLE_ASSETS}/manifest.json`, bytes: Buffer.byteLength(manifestText), sha256: createHash('sha256').update(manifestText).digest('hex')},
    ...rows.map(row => ({path: row.target, bytes: row.bytes, sha256: row.sha256}))].sort((a, b) => a.path.localeCompare(b.path));
  fs.writeFileSync(path.join(output, 'build-record.json'), `${JSON.stringify({sourceCommit:record.pin, nativeCommit:record.forkPin, inputs, abis: selected, files}, null, 2)}\n`);
  return {staged: files.map(row => row.path), asr: bundleFiles.some(row => row.path.startsWith('asr/'))};
}

function main() {
  const {rest: args, abis} = abiArguments(process.argv.slice(2));
  if (args.length === 1 && args[0] === '--plan') {
    const record = readVoiceHost(root);
    for (const abi of record.abis.filter(row => abis.includes(row.abi))) for (const lib of abi.libraries) console.log(`${abi.abi}/${lib.name}\t${lib.sha256}\t${lib.bytes}`);
    for (const row of record.models) console.log(`${row.path}\t${row.sha256}\t${row.bytes}\t${row.source}`);
    return;
  }
  const from = [];let unrecordedEngine = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--unrecorded-engine') { unrecordedEngine = true; continue; }
    if (args[i] === '--from' && args[i + 1] && !args[i + 1].startsWith('--')) { from.push(args[++i]); continue; }
    throw Error('Usage: node scripts/android-stage-voice-models.mjs --from <directory> [--from <directory> ...] [--unrecorded-engine] | --plan');
  }
  if (!from.length) throw Error('--from <directory of pinned voice outputs and models> is required');
  const result = stageVoiceModels(root, {from, unrecordedEngine, abis});
  const admission = verifyVoiceHost(root, {abis});
  console.log(JSON.stringify({...result, admission: admission.status, qualified: admission.qualified, note: 'Integrity only: on-device qualification and device acceptance are still required.'}, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
