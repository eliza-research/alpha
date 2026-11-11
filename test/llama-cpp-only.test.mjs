// Owner rule: on-device speech and inference use only the native
// llama.cpp-based libelizainference stack; the web build has no in-browser inference engine.
// The banned word is assembled from pieces so this file does not trip its own search.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {auditWebBundle, engineFindings} from '../scripts/audit-production-bundle.ts';
import {REMOVED_SPEECH_CLASSES, REMOVED_SPEECH_ENTRY} from '../scripts/apk.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORD = 'on' + 'nx';
const BANNED = new RegExp(`${WORD}|sher${'pa'}|k2${'fsa'}`, 'i');
// Reference material and dated historical snapshots stay as written.
const HISTORICAL = [/^design-assets\//, /^docs\/market-research\//, /^docs\/mvp-audit-\d{4}-\d{2}-\d{2}\./, /^docs\/mvp-remaining-work-\d{4}-\d{2}-\d{2}\./];
const historical = file => HISTORICAL.some(pattern => pattern.test(file));
const tracked = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);

test('no tracked file path names a banned model, runtime or Sherpa', () => {
  assert.deepEqual(tracked.filter(file => !historical(file) && BANNED.test(file)), []);
});

test('package-lock.json resolves no banned runtime package, directly or transitively', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.deepEqual(Object.keys(lock.packages).filter(key => BANNED.test(key)), []);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) assert.deepEqual(Object.keys(manifest[field] ?? {}).filter(name => BANNED.test(name)), [], field);
  assert.deepEqual(Object.entries(manifest.scripts).filter(([name, command]) => /browser-speech/.test(`${name} ${command}`)).map(([name]) => name), []);
});

// The web build's sources, build configuration and tooling: none may name the engine.
const WEB_OWNED = [/^apps\/app\/src\//, /^config\//, /^vite\.config\.ts$/, /^playwright\.config\.ts$/, /^package\.json$/, /^\.github\/workflows\/browser\.yml$/,
  /^scripts\/(prepare-client-features|generate-licenses|generate-sbom|local-agent-dev-bridge\.ts|agent-asr|agent-tts|start-combined-agent|combined-agent-proxy|fingerprint-voice-assets|dev-speech-settings)/,
  /^licenses\//, /^apps\/app\/public\/licenses\//];
test('the web sources, build configuration, licence inputs and shipped notices never name the banned engine', () => {
  const offenders = tracked.filter(file => WEB_OWNED.some(pattern => pattern.test(file)) && fs.existsSync(path.join(root, file)))
    .filter(file => new RegExp(WORD, 'i').test(fs.readFileSync(path.join(root, file), 'latin1')));
  assert.deepEqual(offenders, []);
});

function bundle(t, files, flags = {testMocks: false}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-no-engine-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Alpha Phone</title>');
  fs.writeFileSync(path.join(dir, 'build-flags.json'), JSON.stringify(flags));
  for (const [file, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true}); fs.writeFileSync(path.join(dir, file), content); }
  return dir;
}

test('the bundle audit fails any engine file or reference, even in a test-mocks bundle', t => {
  const cases = {
    [`browser-speech/encoder_model_quantized.${WORD}`]: 'binary',
    'assets/ort-wasm-simd-threaded.wasm': 'binary',
    'assets/index.js': `import('${WORD}runtime-web/wasm');`,
    'assets/model.js': `fetch('models/decoder.${WORD}')`,
    'assets/native.json': `{"class":"com.k2${'fsa'}.sher${'pa'}.${WORD}.OfflineRecognizer"}`,
  };
  for (const [file, content] of Object.entries(cases)) for (const flags of [{testMocks: false}, {testMocks: true}]) {
    const result = auditWebBundle(bundle(t, {[file]: content}, flags), {testMocks: flags.testMocks});
    assert.equal(result.ok, false, `${file} testMocks=${flags.testMocks}`);
    assert.ok(result.findings.every(finding => finding.file === file && /forbidden (inference engine|model)/.test(finding.rule)), JSON.stringify(result.findings));
  }
});

test('the engine rule does not fire on ordinary bundle content or base64 data', t => {
  // A long base64 payload (fonts, images) must not trip the guard by chance.
  const noise = Buffer.from(Array.from({length: 1 << 16}, (_, index) => (index * 2654435761) & 255)).toString('base64');
  const dir = bundle(t, {'assets/index.js': `const font="data:font/woff2;base64,${noise}";const sport="person";`, 'licenses/third-party-notices.json': '[]'});
  assert.deepEqual(auditWebBundle(dir).findings, []);
  assert.deepEqual(engineFindings('assets/maplibre-gl-worker.js', 'self.onmessage=()=>{}'), []);
});

test('the APK check names every removed speech entry and class, and spares the fused engine', () => {
  for (const name of [`assets/models/encoder.${WORD}`, `lib/arm64-v8a/lib${WORD}runtime.so`, `lib/arm64-v8a/libsher${'pa'}-${WORD}-jni.so`, 'assets/public/ort-wasm-simd.wasm',
    'assets/public/browser-speech/manifest.json', `assets/k2${'fsa'}/tokens.txt`]) assert.match(name, REMOVED_SPEECH_ENTRY, name);
  for (const name of ['lib/arm64-v8a/libelizainference.so', 'lib/arm64-v8a/libelizavoicejni.so', 'assets/voice/v1/tts/kokoro/kokoro-82m-v1_0.gguf',
    'assets/public/assets/pdf.worker.wasm', 'assets/public/licenses/third-party-notices.json']) assert.doesNotMatch(name, REMOVED_SPEECH_ENTRY, name);
  assert.deepEqual([...REMOVED_SPEECH_CLASSES], [`Lcom/k2${'fsa'}/`, 'Lai/eliza/speech/']);
});
