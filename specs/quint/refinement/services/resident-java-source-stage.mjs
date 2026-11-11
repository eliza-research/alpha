import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {residentJavaStageFixture, residentJavaStageInputs} from '../../../../test/fixtures/resident-java-source-stage.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const action = (name, ...args) => ({name, args});
// Bun reports an uncaught plain Error as 'error: message' and a named one as 'Name: message'.
// It also lists an AggregateError's members as top-level errors, so the stranded report is matched first.
const refused = [
  ['stranded', /^AggregateError: Resident Java publication and restore failed\. Previous output retained at /m],
  ['sourceRefused', /^(?:error: (?:Unexpected native runtime source pin|Prepared runtime source .* is missing)|ConsumerSourceError: Unexpected runtime source change)/m],
  ['rewriteRefused', /^ResidentHostSourceError: Review changed runtime notification presentation/m],
  ['manifestRefused', /^error: fixture manifest refused$/m],
  ['outputRefused', /^error: Unexpected resident Java staging directory contents$/m],
  ['moveRefused', /^error: fixture move refused$/m],
  ['publishRefused', /^error: fixture publish refused$/m],
];

function trace(name, initial, operations) {
  const directory = fs.mkdtempSync(join(tmpdir(), 'alpha-quint-resident-java-stage-'));
  try {
    const fixture = residentJavaStageFixture(directory);
    fixture.select(1);
    if (initial) {
      const published = fixture.run();
      assert.equal(published.status, 0, published.stderr);
    }
    let state = fixture.observe();
    const project = (result = 'none', before = 0) => Object.fromEntries(
      Object.entries({...state, before, result}).map(([key, value]) => ['s.'+key, value]),
    );
    const expect = project();
    const steps = operations.map(([operation, ...args]) => {
      let result = 'none', before = 0;
      if (operation === 'stage') {
        before = state.published;
        const previous = fixture.snapshot(), retained = fixture.retainedSnapshot();
        const child = fixture.run(args[0]);
        if (child.status === 0) {
          assert.match(child.stdout, /^Generated \d+ pinned local-agent sources for /m);
          result = 'published';
          if (before === state.selected) assert.deepEqual(fixture.snapshot(), previous);
        } else {
          assert.equal(child.status, 1, child.stderr);
          const match = refused.find(([, pattern]) => pattern.test(child.stderr));
          assert.ok(match, child.stderr);
          [result] = match;
          if (result === 'stranded') {
            assert.equal(fixture.snapshot(), null);
            assert.deepEqual(fixture.retainedSnapshot(), previous);
          } else assert.deepEqual(fixture.snapshot(), previous);
        }
        if (retained) assert.deepEqual(fixture.retainedSnapshot(), retained);
      } else if (operation === 'selectGeneration') fixture.select(...args);
      else fixture[operation](...args);
      state = fixture.observe();
      return {action: action(operation, ...args), expect: project(result, before)};
    });
    return {name, init: action('initFor', initial), expect, steps};
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

export async function checkResidentJavaSourceStage(extraSources = []) {
  const sources = [...residentJavaStageInputs, 'test/fixtures/resident-java-source-stage.mjs',
    fileURLToPath(import.meta.url), ...extraSources];
  const driverHashes = captureInputs(sources);
  const stage = (fault = 'none') => ['stage', fault];
  const select = generation => ['selectGeneration', generation];
  const cases = [
    ['initial-repeat-and-replace', 0, [stage(), stage(), select(2), stage()]],
    ['committed-anchor-refusal-keeps-prior', 1, [select(3), stage(), select(2), stage()]],
    ['committed-anchor-refusal-before-first-publication', 0, [select(3), stage(), select(1), stage()]],
    ['pin-stamp-and-dirty-input-refusal', 1, [['setAdmission', 'wrongPin'], stage(), ['setAdmission', 'noStamp'], stage(),
      ['setAdmission', 'dirty'], stage(), ['setAdmission', 'ready'], select(2), stage()]],
    ['candidate-manifest-refusal', 1, [select(2), stage('manifest'), stage()]],
    ['move-of-prior-refused', 1, [select(2), stage('move'), stage()]],
    ['publication-refused-before-and-after-prior', 0, [stage('publish'), stage(), select(2), stage('publish'), stage()]],
    ['refused-restore-retains-exact-old-and-candidate-through-retry', 1, [select(2), stage('restore'), stage()]],
    ['unexpected-output-refused-until-cleared', 1, [['occupy', true], select(2), stage(), ['occupy', false], stage()]],
  ];
  const traces = cases.map(([name, initial, operations]) => trace(name, initial, operations));
  return checkTraces({model: 'ResidentJavaSourceStage', sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: [
    'The normal product CLI, shared source authentication and upstream Java generator execute in disposable committed SDK and product directories.',
    'Two approved synthetic Git generations use the reviewed Java inputs. A third committed generation changes one exact rewrite anchor. All generated and original hashes, relative destinations and manifest membership are checked.',
    'Manifest write and directory move failures are injected only at the selected private stage paths. One refused restore preserves both exact pairs across a later successful invocation.',
    'This relation observes settled serial invocations. Independent readers, concurrent producers, interruption between renames, cleanup failures and actual Gradle builds are separate.',
  ]});
}
