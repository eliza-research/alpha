import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT, VOICE_HOST, collectNotices, voiceHostProblems} from '../scripts/generate-licenses.mjs';
import {buildSbom as generateSbom} from '../scripts/generate-sbom.mjs';
import {readVoiceHost, verifyVoiceHost, VOICE_ASR_SLOT} from '../scripts/voice-host.mjs';
import {stageVoiceModels} from '../scripts/android-stage-voice-models.mjs';
import {fixtureProduct} from './fixtures/voice-host-product.mjs';

// The on-device speech engine is libelizainference with the shared paradee-voice library. Its
// record (android/voice-host/qualified-voice-host.json) drives staging,
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
  assert.ok(record.models.some(row => row.path === 'notices/phonon-2/NOTICE' && row.sha256 === '00624a5043e7ce74029317b024132ca5286116d6fbf3191d226374bc8273789f'), 'Fermion NOTICE ships in the bundle');
  assert.equal(record.models.some(row => row.role === 'asr-mmproj'), false);
  const paradee = record.models.find(row => row.role === 'tts-model');
  assert.equal(paradee.path, 'tts/paradee/paradee-8m-v1_2.gguf');
  assert.ok(paradee.bytes < 40 * 1024 * 1024, 'Paradee ships in the APK assets');
  assert.equal(record.models.some(row => row.role !== 'notice' && /kokoro|\.on{2}x|\.bin$/i.test(row.path)), false, 'no Kokoro, other-runtime model or voice preset');
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

test('the schema rejects bad hashes, missing ABIs, non-GGUF models, an incomplete ASR slot', () => {
  const bad = structuredClone(committed);
  bad.abis[0].libraries[0].sha256 = 'nope';
  bad.models.find(row => row.role === 'tts-model').path = 'tts/paradee/paradee.pt';
  bad.models = bad.models.filter(row => row.role !== 'asr-model');
  const problems = voiceHostProblems(bad, 'fixture');
  for (const expected of ['abis[0].libraries[0] needs a lowercase SHA-256', 'must be a GGUF file', 'has no asr-model', 'ASR rows must be exactly asr-model for the parakeet backend'])
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
  const {entries, errors} = collectNotices(ROOT, {packagedRuntime:false});
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

test('staging copies exactly the recorded bytes into the shared paradee-voice layout, ASR slot included', t => {
  const {dir, from, record} = fixtureProduct(t);
  assert.deepEqual(verifyVoiceHost(dir, {allowAbsentRuntime: true}), {status: 'not-packaged', qualified: false});
  assert.throws(() => verifyVoiceHost(dir), /not staged/, 'a distribution build needs the voice outputs');
  const result = stageVoiceModels(dir, {from: [from]});
  assert.equal(result.asr, true);
  const native = path.join(dir, '.eliza/paradee-voice/native');
  const manifest = JSON.parse(fs.readFileSync(path.join(native, 'assets/paradee-voice/v1/manifest.json'), 'utf8'));
  assert.equal(manifest.format, 'eliza-paradee-voice-v2');
  assert.deepEqual(manifest.files.map(row => row.path).sort(), record.models.map(row => row.path).sort());
  const build = JSON.parse(fs.readFileSync(path.join(native, 'build-record.json'), 'utf8'));
  assert.deepEqual(build.abis, ['arm64-v8a', 'x86_64']);
  assert.ok(build.files.some(row => row.path === 'jniLibs/x86_64/libelizainference.so'));
  for (const abi of record.abis) for (const library of abi.libraries) {
    const installed = path.join(dir, 'android/app/src/main/jniLibs', abi.abi, library.name);
    assert.equal(fs.statSync(installed).size, library.bytes);
    assert.equal(sha(fs.readFileSync(installed)), library.sha256);
  }
  // Record admission (the shared runtime check needs the real nested FFI checkout and is skipped here).
  assert.deepEqual(verifyVoiceHost(dir, {runtime: () => {}}), {status: 'packaged', qualified: false});
  // A second run with the same bytes is idempotent; changed staged bytes are refused, never repaired.
  stageVoiceModels(dir, {from: [from]});
  fs.writeFileSync(path.join(native, 'assets/paradee-voice/v1/vad/silero-vad-v5.gguf'), 'other');
  assert.throws(() => stageVoiceModels(dir, {from: [from]}), /already exists with other bytes/);
});

test('voice host conflicts and linked destinations are refused before staging outputs', t => {
  const {dir, from, record} = fixtureProduct(t);
  const target = path.join(dir, 'android/app/src/main/jniLibs/arm64-v8a/libelizainference.so');
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, 'other engine');
  assert.throws(() => stageVoiceModels(dir, {from: [from]}), /already exists with other bytes/);
  assert.equal(fs.existsSync(path.join(dir, '.eliza/paradee-voice/native')), false);
  fs.unlinkSync(target);
  fs.symlinkSync(path.join(dir, 'missing-library'), target);
  assert.throws(() => stageVoiceModels(dir, {from: [from]}), /already exists with other bytes/);
  fs.unlinkSync(target);
  fs.writeFileSync(path.join(from, 'jniLibs/arm64-v8a/libc++_shared.so'), 'other STL');
  assert.throws(() => stageVoiceModels(dir, {from: [from]}), /does not match the pinned libc\+\+_shared.so/);
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, VOICE_HOST))), record);
});

test('failed host publication retains verified libraries and a retry completes', t => {
  const {dir, from, record} = fixtureProduct(t);
  const host = path.join(dir, 'android/app/src/main/jniLibs');
  const existing = path.join(host, 'arm64-v8a/libelizainference.so');
  fs.mkdirSync(path.dirname(existing), {recursive: true});
  fs.copyFileSync(path.join(from, 'jniLibs/arm64-v8a/libelizainference.so'), existing);
  const link = fs.linkSync;
  let links = 0;
  try {
    fs.linkSync = (source, target) => {
      if (target.startsWith(host) && ++links === 2) throw new Error('injected host publication failure');
      return link(source, target);
    };
    assert.throws(() => stageVoiceModels(dir, {from: [from]}), /injected host publication failure/);
  } finally {
    fs.linkSync = link;
  }
  assert.equal(sha(fs.readFileSync(existing)), record.abis[0].libraries[0].sha256);
  assert.equal(fs.existsSync(path.join(host, 'arm64-v8a/libc++_shared.so')), true);
  assert.equal(fs.existsSync(path.join(host, 'x86_64/libelizainference.so')), false);
  stageVoiceModels(dir, {from: [from]});
  for (const abi of record.abis) for (const library of abi.libraries)
    assert.equal(sha(fs.readFileSync(path.join(host, abi.abi, library.name))), library.sha256);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, VOICE_HOST))).qualified, false);
});

test('a failing stager preserves libraries adopted by a completed concurrent stager', t => {
  const {dir, from, record} = fixtureProduct(t);
  const link = fs.linkSync;
  let publications = 0;
  let concurrentCompleted = false;
  try {
    fs.linkSync = (source, target) => {
      if (++publications === 2) {
        fs.linkSync = link;
        stageVoiceModels(dir, {from: [from]});
        concurrentCompleted = true;
        throw new Error('first stager failed after concurrent completion');
      }
      return link(source, target);
    };
    assert.throws(() => stageVoiceModels(dir, {from: [from]}), /first stager failed/);
  } finally {
    fs.linkSync = link;
  }
  assert.equal(concurrentCompleted, true);
  for (const abi of record.abis) for (const library of abi.libraries)
    assert.equal(sha(fs.readFileSync(path.join(dir, 'android/app/src/main/jniLibs', abi.abi, library.name))), library.sha256);
  stageVoiceModels(dir, {from: [from]});
});

test('a vanished concurrent host publication cannot report successful staging', t => {
  const {dir, from} = fixtureProduct(t);
  const link = fs.linkSync;
  try {
    fs.linkSync = () => { throw Object.assign(new Error('concurrent publication'), {code: 'EEXIST'}); };
    assert.throws(() => stageVoiceModels(dir, {from: [from]}), /destination disappeared/);
  } finally {
    fs.linkSync = link;
  }
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

test('an unrecorded engine refused at a conflicting destination leaves the tracked record byte-identical', t => {
  const {dir, from} = fixtureProduct(t);
  stageVoiceModels(dir, {from: [from]});
  const before = fs.readFileSync(path.join(dir, VOICE_HOST));
  fs.writeFileSync(path.join(from, 'jniLibs/x86_64/libelizainference.so'), 'rebuilt engine');
  const expected = readVoiceHost(dir);
  fs.writeFileSync(path.join(from, 'build-record.json'), JSON.stringify({sourceCommit: expected.pin, nativeCommit: expected.forkPin, files: expected.abis.map(abi => {
    const relative = `jniLibs/${abi.abi}/libelizainference.so`, bytes = fs.readFileSync(path.join(from, relative));
    return {path: relative, sha256: sha(bytes), bytes: bytes.length};
  })}));
  assert.throws(() => stageVoiceModels(dir, {from: [from], unrecordedEngine: true}), /already exists with other bytes/);
  assert.deepEqual(fs.readFileSync(path.join(dir, VOICE_HOST)), before);
});
