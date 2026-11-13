import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareLocalAgentFixture, preparedSourceFixtureInputs} from './fixtures/prepare-local-agent.mjs';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';

const action = (name, ...args) => ({name, args});
const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fixture(temp) {
  const f = prepareLocalAgentFixture(temp);
  const readme = join(f.runtime, 'README.md');
  const normalReadme = fs.readFileSync(readme);
  let result = 'none';

  function sourceStatus(status) {
    const head = f.git(['rev-parse', 'HEAD'], f.runtime);
    fs.writeFileSync(readme, f.git(['show', 'HEAD:README.md'], f.runtime)+'\n');
    const next = status === 'wrongCommit' ? f.after : f.before;
    if (head !== next) f.git(['checkout', '--quiet', '--detach', next], f.runtime);
    if (status === 'dirty') fs.appendFileSync(readme, 'fixture edit\n');
    result = 'none';
  }

  function lockStatus(status) {
    f.pin(status === 'moved' ? f.after : f.before);
    result = 'none';
  }

  function prepare(refusal) {
    const child = f.prepare();
    assert.ifError(child.error);
    assert.equal(child.signal, null);
    if (child.status === 0) {
      assert.equal(refusal, undefined);
      assert.ok(child.stdout.split('\n').includes('Prepared local runtime: '+f.runtime));
      result = 'prepared';
    } else {
      assert.equal(child.status, 1, child.stderr);
      assert.ok(refusal, child.stderr);
      // The code excerpt in Bun's error output can contain all branch messages.
      // Match the actual error line ('error: message' for a plain Error, the bare
      // message for a system error) to avoid admitting the wrong failure path.
      assert.match(child.stderr, refusal);
      result = 'refused';
    }
  }

  function observe() {
    const stamp = fs.readFileSync(f.stamp);
    assert.ok(stamp.equals(f.prepared), 'An existing stamp is never rewritten');
    const checkedOut = f.git(['rev-parse', 'HEAD'], f.runtime);
    assert.ok([f.before, f.after].includes(checkedOut));
    const source = checkedOut === f.after ? 'wrongCommit' : fs.readFileSync(readme).equals(normalReadme) ? 'verified' : 'dirty';
    return {'s.source': source, 's.current': JSON.parse(stamp).lockSha256 === hashFile(f.lock), 's.result': result};
  }
  return {sourceStatus, lockStatus, prepare, observe};
}

async function checkPreparedSourceStamp(extraSources = []) {
  const sources = [...preparedSourceFixtureInputs, 'test/fixtures/prepare-local-agent.mjs', fileURLToPath(import.meta.url), ...extraSources];
  const driverHashes = captureInputs(sources);
  const stampMismatch = /^error: Prepared runtime differs or preparation was interrupted\./m;
  const cases = [
    ['current-stamp-reuse', [['prepare'], ['prepare']]],
    ['moved-lock-refuses-stale-stamp', [['lockStatus', 'moved'], ['prepare', stampMismatch], ['lockStatus', 'pinned'], ['prepare']]],
    ['dirty-tracked-bytes', [['sourceStatus', 'dirty'], ['prepare', /^ConsumerSourceError: Unexpected runtime source change: README\.md/m],
      ['sourceStatus', 'verified'], ['prepare']]],
    ['wrong-base-revision', [['sourceStatus', 'wrongCommit'], ['prepare', /^ConsumerSourceError: Prepared runtime base commit changed/m],
      ['lockStatus', 'moved'], ['prepare', stampMismatch]]],
  ];
  const traces = cases.map(([name, operations]) => {
    const temp = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'alpha-quint-source-stamp-')));
    try {
      const driver = fixture(temp);
      const expect = driver.observe();
      const steps = operations.map(([op, argument]) => {
        driver[op](argument);
        return op === 'prepare' ? {label: op, action: action(op), expect: driver.observe()}
          : {label: op+' '+argument, action: action(op, argument), expect: driver.observe()};
      });
      return {name, expect, steps};
    } finally {
      fs.rmSync(temp, {recursive: true, force: true});
    }
  });
  return checkTraces({model: 'PreparedSourceStamp', sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: [
    'The production preparer and immutable verifier operate on disposable local Git repositories. Only source-only invocations run.',
    'The live stamp bytes, pinned lock, selected commit, tracked input and output status are observed after each operation.',
  ]});
}

test('a prepared runtime is reused only with its current stamp and verified source', async () => {
  const receipt = await checkPreparedSourceStamp([fileURLToPath(import.meta.url)]);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
  assert.equal(receipt.traces, 4);
});
