import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT, VOICE_HOST, collectNotices, voiceHostProblems} from '../scripts/generate-licenses.mjs';
import {buildSbom as generateSbom} from '../scripts/generate-sbom.mjs';
import {readVoiceHost, verifyVoiceHost, VOICE_ASR_SLOT} from '../scripts/voice-host.mjs';
import {stageVoiceModels} from '../scripts/android-stage-voice-models.mjs';

// The on-device speech engine is libelizainference with the shared paradee-voice library. Its
// record (android/voice-host/qualified-voice-host.json, docs/fused-speech.md) drives staging,
// the notices and the SBOM. Fixture bytes only: no real binary or model is read here.
const sha = value => createHash('sha256').update(value).digest('hex');
const committed = JSON.parse(fs.readFileSync(path.join(ROOT, VOICE_HOST), 'utf8'));

test('the committed record satisfies the schema, model inventory and ASR slot', () => {
  assert.deepEqual(voiceHostProblems(committed), []);
  const record = committed;
  assert.equal(record.qualified, false, 'not qualified until device acceptance');
  assert.equal(record.provider, 'libelizainference-paradee');
  assert.deepEqual(record.abis.map(row => row.abi), ['arm64-v8a', 'x86_64']);
  const slot = JSON.parse(fs.readFileSync(path.join(ROOT, VOICE_ASR_SLOT), 'utf8'));
  assert.equal(slot.backend, 'parakeet', 'Phonon-2 is the shipped ASR');
  assert.deepEqual(slot.files.map(row => row.path), ['asr/phonon-2-fv5.gguf'], 'one parakeet-tdt GGUF, no Qwen3 pair');
  assert.equal(record.asrSlot.backend, 'parakeet');
  const phonon = record.models.find(row => row.role === 'asr-model');
  assert.equal(phonon.license, 'CC-BY-4.0');
  assert.match(phonon.attribution, /Fermion Research/);
  for (const file of phonon.noticeFiles) assert.ok(fs.existsSync(path.join(ROOT, file)), file);
  assert.ok(record.models.some(row => row.path === 'notices/Phonon-2-NOTICE.txt' && row.sha256 === '00624a5043e7ce74029317b024132ca5286116d6fbf3191d226374bc8273789f'), 'Fermion NOTICE ships in the bundle');
  assert.equal(record.models.some(row => row.role === 'asr-mmproj'), false);
  const paradee = record.models.find(row => row.role === 'tts-model');
  assert.equal(paradee.path, 'tts/paradee/paradee-8m-v1_2.gguf');
  assert.ok(paradee.bytes < 40 * 1024 * 1024, 'Paradee ships in the APK assets');
  assert.equal(record.models.some(row => /kokoro|\.on{2}x|\.bin$/i.test(row.path)), false, 'no Kokoro, other-runtime model or voice preset');
});

test('only a voice record for the current SDK can admit the native profile', () => {
  const {commit}=JSON.parse(fs.readFileSync(path.join(ROOT,'upstream.lock.json'),'utf8'));
  if (committed.pin===commit) {
    readVoiceHost(ROOT);
  } else {
    assert.equal(committed.qualified,false,'a historical artifact cannot claim current qualification');
    assert.throws(()=>readVoiceHost(ROOT),/upstream\.lock\.json pins/);
  }
});

test('the schema rejects bad hashes, missing ABIs, non-GGUF models, an incomplete ASR slot and unearned qualification', () => {
  const bad = structuredClone(committed);
  bad.abis[0].libraries[0].sha256 = 'nope';
  bad.models.find(row => row.role === 'tts-model').path = 'tts/paradee/paradee.pt';
  bad.models = bad.models.filter(row => row.role !== 'asr-model');
  bad.qualified = true;
  const problems = voiceHostProblems(bad, 'fixture');
  for (const expected of ['abis[0].libraries[0] needs a lowercase SHA-256', 'must be a GGUF file', 'has no asr-model', 'ASR rows must be exactly asr-model for the parakeet backend', 'qualified cannot be true without device execution'])
    assert.ok(problems.some(problem => problem.includes(expected)), expected);
  assert.ok(voiceHostProblems({...committed, abis: committed.abis.slice(0, 1)}).some(problem => problem.includes('must record arm64-v8a and x86_64')));
  assert.deepEqual(voiceHostProblems([], 'fixture'), ['fixture: not a JSON object']);
  // A Qwen3 pair needs the qwen3 backend; a parakeet slot carrying a projector is refused.
  const pair = structuredClone(committed);
  pair.models.push({...pair.models.find(row => row.role === 'asr-model'), name: 'projector', path: 'asr/extra-mmproj.gguf', role: 'asr-mmproj'});
  assert.ok(voiceHostProblems(pair, 'fixture').some(problem => problem.includes('ASR rows must be exactly asr-model')));
  pair.asrSlot = {...pair.asrSlot, backend: 'qwen3', paths: ['asr/phonon-2-fv5.gguf', 'asr/extra-mmproj.gguf']};
  assert.deepEqual(voiceHostProblems(pair, 'fixture'), []);
});

test('notices list the engine components and every voice model, flagging eSpeak NG copyleft without blocking', () => {
  const {entries, errors} = collectNotices(ROOT);
  assert.deepEqual(errors, []);
  const espeak = entries.filter(entry => entry.name.startsWith('eSpeak NG'));
  assert.ok(espeak.length >= 2, 'the linked library and the bundled data');
  for (const entry of espeak) { assert.equal(entry.license, 'GPL-3.0-or-later'); assert.ok(entry.flags.includes('copyleft-strong')); }
  for (const name of ['Paradee-8M v1.2 (F32 GGUF) (tts-model)', 'misaki English (US) lexicon (g2p-lexicon)', 'Phonon-2 (Parakeet-TDT 0.6B, five-value GGUF; ASR slot model) (asr-model)', 'Silero VAD v5 (GGUF) (vad-model)'])
    assert.ok(entries.some(entry => entry.name === name), name);
  // CC-BY-4.0 attribution: the attribution line, Fermion's NOTICE and the licence text ship; the training-data terms are flagged, not blocking.
  const phonon = entries.find(entry => entry.name.startsWith('Phonon-2'));
  assert.equal(phonon.license, 'CC-BY-4.0');
  assert.match(phonon.text, /Phonon-2 by Fermion Research/);
  assert.ok(phonon.text.includes(fs.readFileSync(path.join(ROOT, 'licenses/Phonon-2-NOTICE.txt'), 'utf8').trim().split('\n')[0]));
  assert.match(phonon.text, /Attribution 4\.0 International/);
  assert.ok(phonon.flags.includes('unverified'));
  assert.equal(entries.some(entry => entry.name.startsWith('Qwen3-ASR')), false, 'the Qwen3 pair no longer ships');
  assert.equal(entries.find(entry => entry.name.startsWith('Paradee-8M')).license, 'Apache-2.0');
});

test('the SBOM lists each recorded engine library per ABI and every bundle file with its hash and size', () => {
  const sbom = generateSbom(ROOT);
  const byRef = new Map(sbom.components.map(component => [component['bom-ref'], component]));
  for (const abi of committed.abis) for (const library of abi.libraries) assert.equal(byRef.get(`voice-host:${abi.abi}/${library.name}`).hashes[0].content, library.sha256);
  for (const model of committed.models) {
    const component = byRef.get(`voice-model:${model.path}`);
    assert.equal(component.hashes[0].content, model.sha256, model.path);
    assert.equal(component.properties.find(row => row.name === 'alphaphone:bytes')?.value ?? component.properties.find(row => row.name.endsWith('bytes')).value, String(model.bytes));
  }
});

/** A product root with a fixture record, fixture bundle bytes and the shared inputs it must match. */
function fixtureProduct(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-voice-stage-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const from = path.join(dir, 'from');
  const record = structuredClone(committed);
  // These temporary files are synthetic, including their source identities. Keep
  // the fixture internally consistent without relabeling any real artifact. The
  // separate committed-record test above still enforces the actual product pin.
  record.pin = '1'.repeat(40);
  record.forkPin = '2'.repeat(40);
  const write = (relative, content) => { fs.mkdirSync(path.dirname(path.join(from, relative)), {recursive: true}); fs.writeFileSync(path.join(from, relative), content); return {sha256: sha(content), bytes: Buffer.byteLength(content)}; };
  for (const model of record.models) Object.assign(model, write(model.sourceFile ? path.join(path.dirname(model.path), model.sourceFile) : model.path, `fixture ${model.path}`));
  for (const abi of record.abis) Object.assign(abi.libraries[0], write(`jniLibs/${abi.abi}/libelizainference.so`, `engine ${abi.abi}`));
  const inputs = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor/eliza/plugins/plugin-local-inference/native/android/inputs.json'), 'utf8'));
  for (const key of ['paradee', 'lexicon']) { const row = record.models.find(model => model.path === inputs[key].path); inputs[key] = {...inputs[key], sha256: row.sha256, bytes: row.bytes}; }
  fs.mkdirSync(path.join(dir, 'vendor/eliza/plugins/plugin-local-inference/native/android'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'vendor/eliza/plugins/plugin-local-inference/native/android/inputs.json'), JSON.stringify(inputs, null, 2));
  fs.mkdirSync(path.join(dir, 'android/voice-host'), {recursive: true});fs.mkdirSync(path.join(dir, 'android/paradee-voice'), {recursive: true});
  fs.writeFileSync(path.join(dir, VOICE_HOST), JSON.stringify(record, null, 2));
  fs.writeFileSync(path.join(dir, VOICE_ASR_SLOT), JSON.stringify({backend: record.asrSlot.backend, files: record.models.filter(model => model.role.startsWith('asr-')).map(({path: file, role, sha256, bytes}) => ({path: file, role, sha256, bytes}))}));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'upstream.lock.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'upstream.lock.json'), JSON.stringify({...lock, commit: record.pin}));
  fs.copyFileSync(path.join(ROOT, 'app.config.json'), path.join(dir, 'app.config.json'));
  return {dir, from, record};
}

test('staging copies exactly the recorded bytes into the shared paradee-voice layout, ASR slot included', t => {
  const {dir, from, record} = fixtureProduct(t);
  assert.deepEqual(verifyVoiceHost(dir, {allowAbsentRuntime: true}), {status: 'not-packaged', qualified: false});
  assert.throws(() => verifyVoiceHost(dir), /not staged/, 'a distribution build needs the voice outputs');
  const result = stageVoiceModels(dir, {from: [from]});
  assert.equal(result.asr, true);
  const native = path.join(dir, '.eliza/paradee-voice/native');
  const manifest = JSON.parse(fs.readFileSync(path.join(native, 'assets/paradee-voice/v1/manifest.json'), 'utf8'));
  assert.equal(manifest.format, 'eliza-paradee-voice-v1');
  assert.deepEqual(manifest.files.map(row => row.path).sort(), record.models.map(row => row.path).sort());
  const build = JSON.parse(fs.readFileSync(path.join(native, 'build-record.json'), 'utf8'));
  assert.deepEqual(build.abis, ['arm64-v8a', 'x86_64']);
  assert.ok(build.files.some(row => row.path === 'jniLibs/x86_64/libelizainference.so'));
  // Record admission (the shared runtime check needs the real nested FFI checkout and is skipped here).
  assert.deepEqual(verifyVoiceHost(dir, {runtime: () => {}}), {status: 'packaged', qualified: false});
  // A second run with the same bytes is idempotent; changed staged bytes are refused, never repaired.
  stageVoiceModels(dir, {from: [from]});
  fs.writeFileSync(path.join(native, 'assets/paradee-voice/v1/vad/silero-vad-v5.gguf'), 'other');
  assert.throws(() => stageVoiceModels(dir, {from: [from]}), /already exists with other bytes/);
});

test('staging refuses source bytes that differ from the record and missing rows', t => {
  const {dir, from} = fixtureProduct(t);
  fs.writeFileSync(path.join(from, 'tts/paradee/misaki-en-us.lex'), 'tampered');
  assert.throws(() => stageVoiceModels(dir, {from: [from]}), /does not match the pinned tts\/paradee\/misaki-en-us\.lex/);
  fs.rmSync(path.join(from, 'tts/paradee/misaki-en-us.lex'));
  assert.throws(() => stageVoiceModels(dir, {from: [from]}), /Missing tts\/paradee\/misaki-en-us\.lex/);
  assert.equal(fs.existsSync(path.join(dir, '.eliza/paradee-voice/native')), false, 'nothing is staged on refusal');
});

test('an unrecorded hosted engine rebuild is staged only with the explicit flag and keeps the record unqualified', t => {
  const {dir, from} = fixtureProduct(t);
  fs.writeFileSync(path.join(from, 'jniLibs/x86_64/libelizainference.so'), 'rebuilt engine');
  assert.throws(() => stageVoiceModels(dir, {from: [from]}), /does not match the pinned libelizainference\.so/);
  const expected = readVoiceHost(dir);
  const files = expected.abis.map(abi => {
    const relative = `jniLibs/${abi.abi}/libelizainference.so`, bytes = fs.readFileSync(path.join(from, relative));
    return {path: relative, sha256: sha(bytes), bytes: bytes.length};
  });
  fs.writeFileSync(path.join(from, 'build-record.json'), JSON.stringify({sourceCommit: expected.pin, nativeCommit: expected.forkPin, files}));
  stageVoiceModels(dir, {from: [from], unrecordedEngine: true});
  const record = JSON.parse(fs.readFileSync(path.join(dir, VOICE_HOST), 'utf8'));
  const row = record.abis.find(abi => abi.abi === 'x86_64');
  assert.equal(row.libraries[0].sha256, sha('rebuilt engine'));
  assert.match(row.engineAdmission, /unreviewed workspace build/);
  assert.equal(record.qualified, false);
});


test('unrecorded engines cannot be relabeled with the current source pins', t => {
  const {dir, from, record} = fixtureProduct(t);
  const source = path.join(from, 'jniLibs/x86_64/libelizainference.so');
  fs.writeFileSync(source, 'old-source engine');
  const build = {sourceCommit: '0'.repeat(40), nativeCommit: record.forkPin, files: record.abis.map(abi => {
    const relative = `jniLibs/${abi.abi}/libelizainference.so`, bytes = fs.readFileSync(path.join(from, relative));
    return {path: relative, sha256: sha(bytes), bytes: bytes.length};
  })};
  fs.writeFileSync(path.join(from, 'build-record.json'), JSON.stringify(build));
  assert.throws(() => stageVoiceModels(dir, {from: [from], unrecordedEngine: true}), /source revisions/);
  build.sourceCommit = record.pin; build.nativeCommit = '0'.repeat(40);
  fs.writeFileSync(path.join(from, 'build-record.json'), JSON.stringify(build));
  assert.throws(() => stageVoiceModels(dir, {from: [from], unrecordedEngine: true}), /source revisions/);
  build.nativeCommit = record.forkPin; build.files[0].sha256 = '0'.repeat(64);
  fs.writeFileSync(path.join(from, 'build-record.json'), JSON.stringify(build));
  assert.throws(() => stageVoiceModels(dir, {from: [from], unrecordedEngine: true}), /bytes do not match/);
  fs.unlinkSync(path.join(from, 'build-record.json'));
  assert.throws(() => stageVoiceModels(dir, {from: [from], unrecordedEngine: true}), /record is missing/);
  assert.equal(fs.existsSync(path.join(dir, '.eliza/paradee-voice/native')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, VOICE_HOST))), record, 'refusal does not rewrite the checked-in record');
});
