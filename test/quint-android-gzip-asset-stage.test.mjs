import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import zlib from 'node:zlib';
import {packagedGzipProblems, protectGzipAssets} from '../scripts/android-gzip-assets.ts';
import {mergeGzipAssets} from './fixtures/android-gzip-assets.mjs';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';

const asset = 'ocr/fixture.traineddata.gz';
const invalid = Buffer.from('fixture is not gzip');
const bytes = [null, ...[1, 2].map(version => zlib.gzipSync(Buffer.from('fixture model '+version)))];
const wrappers = bytes.map(value => value && zlib.gzipSync(value, {level: 1}));
const action = (name, ...args) => ({name, args});

function fixture(directory, initial) {
  const web = join(directory, 'web');
  const staged = join(directory, 'stage');
  const apk = join(directory, 'packaged');
  const raw = join(staged, asset);
  let protection = 'none';
  let result = 'none';

  function write(file, value) {
    fs.mkdirSync(dirname(file), {recursive: true});
    fs.writeFileSync(file, value);
  }

  function versionOf(file, identities) {
    if (!fs.existsSync(file)) return 0;
    const actual = fs.readFileSync(file);
    const version = identities.findIndex(identity => identity?.equals(actual));
    assert.ok(version > 0, 'Unexpected bytes at '+file);
    return version;
  }

  function syncWeb(version) {
    write(join(web, asset), bytes[version]);
    fs.rmSync(staged, {recursive: true, force: true});
    write(raw, bytes[version]);
    protection = 'none';
    result = 'none';
  }

  function malformedInput() {
    fs.rmSync(staged, {recursive: true, force: true});
    write(raw, invalid);
    protection = 'none';
  }

  function protect(removalRefused) {
    const remove = fs.rmSync;
    if (removalRefused) fs.rmSync = (file, ...options) => {
      if (file === raw) throw Error('fixture raw removal refused');
      return remove(file, ...options);
    };
    try {
      const wrapped = protectGzipAssets(staged);
      assert.ok(!removalRefused);
      assert.deepEqual(wrapped, wrapped.length ? [asset] : []);
      protection = wrapped.length ? 'wrapped' : 'unchanged';
    } catch (error) {
      if (removalRefused) assert.equal(error.message, 'fixture raw removal refused');
      else assert.match(error.message, /already exists beside|is not gzip data/);
      protection = removalRefused ? 'partial' : 'refused';
    } finally {
      fs.rmSync = remove;
    }
  }

  function merge() {
    fs.rmSync(apk, {recursive: true, force: true});
    fs.mkdirSync(apk);
    if (fs.existsSync(staged)) fs.cpSync(staged, apk, {recursive: true});
    mergeGzipAssets(apk);
    result = 'none';
  }

  function audit() {
    const problems = packagedGzipProblems(apk, web);
    assert.ok(problems.length <= 1);
    if (problems.length === 0) result = 'matches';
    else if (problems[0].includes(' is missing from the APK web payload')) result = 'missing';
    else {
      assert.match(problems[0], /differs from the web build$/);
      result = 'differs';
    }
  }

  function observe() {
    const packaged = join(apk, asset);
    const plain = packaged.slice(0, -3);
    if (fs.existsSync(plain)) assert.ok(bytes.slice(1).some(value => zlib.gunzipSync(value).equals(fs.readFileSync(plain))));
    return {'s.web': versionOf(join(web, asset), bytes), 's.raw': versionOf(raw, [...bytes, invalid]),
      's.wrapper': versionOf(raw+'.gz', wrappers), 's.packaged': versionOf(packaged, bytes),
      's.plain': fs.existsSync(plain), 's.protection': protection, 's.audit': result};
  }

  write(join(web, asset), bytes[1]);
  if (initial) write(raw, bytes[1]);
  return {syncWeb, malformedInput, protect, merge, audit, observe};
}

async function checkAndroidGzipAssetStage(extraSources = []) {
  const sources = ['scripts/android-gzip-assets.ts', 'scripts/build-android.ts', 'scripts/verify-apks.ts',
    'test/fixtures/android-gzip-assets.mjs', fileURLToPath(import.meta.url), ...extraSources];
  const driverHashes = captureInputs(sources);
  const wrap = ['protect', false];
  const publish = [['merge'], ['audit']];
  const cases = [
    ['unwrapped-original-name-missing', 1, publish],
    ['exact-wrapper-and-idempotent-protection', 1, [wrap, wrap, ...publish]],
    ['stale-apk-compared-with-new-web-build', 1, [wrap, ...publish, ['syncWeb', 2], ['audit'], wrap, ...publish]],
    ['malformed-gzip-refusal-and-resync', 1, [['malformedInput'], wrap, ['syncWeb', 1], wrap, ...publish]],
    ['refused-removal-retains-both-until-resync', 1, [['protect', true], wrap, ['syncWeb', 1], wrap, ...publish]],
    ['absent-stage-is-unchanged', 0, [wrap, ...publish]],
  ];
  const traces = cases.map(([name, initial, operations]) => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'alpha-quint-gzip-'));
    try {
      const f = fixture(directory, initial);
      const expect = f.observe();
      const steps = operations.map(([operation, ...args]) => {
        f[operation](...args);
        return {action: action(operation, ...args), expect: f.observe()};
      });
      return {name, init: action('initFor', initial), expect, steps};
    } finally {
      fs.rmSync(directory, {recursive: true, force: true});
    }
  });
  return checkTraces({model: 'AndroidGzipAssetStage', sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: [
    'Actual gzip protection and package byte verification use private scratch paths with one selected web asset and two content identities.',
    'The shared fixture simulates one layer of Android asset merging. A separate normal APK verification checks actual Gradle output.',
    'The removal refusal is confined to the disposable input file after the wrapper is written. Concurrent writers, partial wrapper writes and installed OCR remain separate.',
  ]});
}

test('Android gzip protection and byte verification preserve the published asset', async () => {
  const receipt = await checkAndroidGzipAssetStage([fileURLToPath(import.meta.url)]);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
  assert.equal(receipt.traces, 6);
});
