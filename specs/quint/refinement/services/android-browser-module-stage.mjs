import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {androidBrowserModuleStageInputs, loadAndroidBrowserModuleFixture} from '../../../../test/fixtures/android-browser-module-stage.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const failures = [
  ['sourceRefused', /^Upstream source checkout is dirty$/],
  ['cacheRefused', /^Staged patched native source drift$/],
  ['publishRefused', /^fixture source publication refused$/],
  ['routeRefused', /^Android host input is unavailable$/],
  ['collisionRefused', /^Refusing an unowned generated-file collision: settings\.gradle$/],
  ['hostWriteRefused', /^fixture generated settings write refused$/],
];
const action = (name, ...args) => ({name, args});
const fields = (state, result = 'none') => Object.fromEntries(
  Object.entries({...state, result}).map(([key, value]) => ['s.'+key, value]),
);

function trace(name, createFixture, operations) {
  const directory = fs.mkdtempSync(join(tmpdir(), 'alpha-quint-browser-module-'));
  try {
    const f = createFixture(directory);
    const expect = fields(f.observe());
    const methods = {selectManifest: f.select, setRoute: f.route, setSourceValid: f.sourceValid, driftCache: f.drift, occupy: f.occupy};
    const steps = operations.map(([name, ...args]) => {
      let result = 'none';
      if (name === 'generate') {
        const previousHost = f.hostSnapshot(), previousStages = f.cacheSnapshots();
        try {f.generate(args[0]);result = 'generated';}
        catch (error) {
          const failure = failures.find(([, pattern]) => pattern.test(error.message));
          if (!failure) throw error;
          [result] = failure;
          if (result !== 'hostWriteRefused') assert.deepEqual(f.hostSnapshot(), previousHost);
        }
        const stages = f.cacheSnapshots();
        for (const [index, previous] of previousStages.entries()) if (previous) assert.deepEqual(stages[index], previous);
      } else if (name === 'verifyReceipt') {
        try {f.verifyReceipt(args[0]);result = 'receiptAccepted';}
        catch (error) {
          assert.equal(error.message, 'Packaged native patch receipt mismatch');
          result = 'receiptRefused';
        }
      } else methods[name](...args);
      return {action: action(name, ...args), expect: fields(f.observe(), result)};
    });
    return {name, init: action('init'), expect, steps};
  } finally {fs.rmSync(directory, {recursive: true, force: true});}
}

export async function checkAndroidBrowserModuleStage(extraSources = []) {
  const sources = [...androidBrowserModuleStageInputs(), 'test/fixtures/android-browser-module-stage.mjs',
    fileURLToPath(import.meta.url), ...extraSources];
  const driverHashes = captureInputs(sources);
  const createFixture = loadAndroidBrowserModuleFixture();
  const generate = (fault = 'none') => ['generate', fault];
  const second = ['selectManifest', 2];
  const cases = [
    ['the actual generator publishes and reuses one exact browser module', [generate(), generate(), ['verifyReceipt', 1]]],
    ['a refused source change preserves the previous host and stage until valid retry', [generate(), second,
      ['setSourceValid', false], generate(), ['setSourceValid', true], generate()]],
    ['candidate publication refusal preserves the prior generation byte for byte', [generate(), second,
      generate('publish'), generate()]],
    ['a drifted keyed cache is preserved and refused while a distinct key can stage', [generate(),
      ['driftCache'], generate(), second, generate()]],
    ['missing module route retains the earlier generated host and admits the source cache only', [generate(), second,
      ['setRoute', false], generate(), ['setRoute', true], generate()]],
    ['a refused first settings write leaves owned output which a retry completes', [generate('hostWrite'), generate()]],
    ['an unowned settings file is left intact until the owner clears it', [['occupy', true], generate(), ['occupy', false], generate()]],
    ['the exact current packaged provenance accepts only its selected generation', [generate(), second,
      generate(), ['verifyReceipt', 1], ['verifyReceipt', 2]]],
  ];
  const traces = cases.map(([name, steps]) => trace(name, createFixture, steps));
  return checkTraces({model: 'AndroidBrowserModuleStage', scope: 'bounded-orchestration', sources, driverHashes, traces,
    assumptions: ['The real Alpha host wrapper, native source stager and pinned Gradle generator run on a private product projection. The browser module and resource directory match the authenticated Git source.',
      'Two exact source inventory byte identities select distinct cache keys for the same pinned source. The host profile, generated scripts, cached module and source receipt are checked independently. Failed admission preserves old bytes, while an incomplete owned host can retry.',
      'Publication and settings write refusals are confined to the scratch filesystem. Arbitrary process interruption, concurrent publishers, all-module Gradle configuration, APK packaging and installed browser behavior are separate.']});
}
