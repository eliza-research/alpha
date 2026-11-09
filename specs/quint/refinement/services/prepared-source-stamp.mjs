import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareLocalAgentFixture, preparedSourceFixtureInputs} from '../../../../test/fixtures/prepare-local-agent.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const action = (name, ...args) => ({name, args});
const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sidecarContents = Buffer.from('preexisting fixture bytes\n');

function fixture(temp) {
  const f = prepareLocalAgentFixture(temp);
  const sidecars = {backup: f.backup, lock: f.stamp+'.requalify-lock', candidate: f.stamp+'.requalify'};
  const readme = join(f.runtime, 'README.md');
  const normalReadme = fs.readFileSync(readme);
  const currentStamp = Buffer.from(JSON.stringify({
    lockSha256: hashFile(f.lock),
    preparerSha256: hashFile(join(f.product, 'scripts/prepare-local-agent.mjs')),
    guardSha256: hashFile(join(f.product, 'scripts/local-agent-source.mjs')),
    copySha256: hashFile(join(f.product, 'scripts/copy-file-clone.mjs')),
    base: f.after, patches: [],
  }, null, 2)+'\n');
  let result = 'none';

  function sourceStatus(status) {
    const head = f.git(['rev-parse', 'HEAD'], f.runtime);
    fs.writeFileSync(readme, f.git(['show', 'HEAD:README.md'], f.runtime)+'\n');
    const next = status === 'wrongCommit' ? f.before : f.after;
    if (head !== next) f.git(['checkout', '--quiet', '--detach', next], f.runtime);
    if (status === 'dirty') fs.appendFileSync(readme, 'fixture edit\n');
    result = 'none';
  }

  function placeSidecar(slot) {
    fs.writeFileSync(sidecars[slot], sidecarContents, {flag: 'wx'});
    result = 'none';
  }

  function clearSidecar(slot) {
    assert.deepEqual(fs.readFileSync(sidecars[slot]), sidecarContents);
    fs.unlinkSync(sidecars[slot]);
    result = 'none';
  }

  function prepare(request, refusal) {
    let args = f.args, env = {}, preload;
    if (request === 'ordinary') args = [];
    if (request === 'stale') args = ['--requalify-from', '0'.repeat(64), '--preserve-stamp', f.backup];
    if (request === 'noSelection') env = {ALPHA_LOCAL_AGENT_SOURCE_DIR: ''};
    if (request === 'linkedBackup') {
      const alias = join(temp, 'linked-backup-parent');
      fs.symlinkSync(f.runtime, alias, 'dir');
      args = [...f.args.slice(0, -1), join(alias, 'prior-stamp.json')];
    }
    if (request === 'candidateRefusal') {
      preload = join(temp, 'candidate-refusal.mjs');
      fs.writeFileSync(preload, `import fs from 'node:fs';
const open = fs.openSync;
fs.openSync = (file, ...args) => {
  if (file === ${JSON.stringify(sidecars.candidate)}) throw Error('fixture candidate open refused');
  return open(file, ...args);
};
`);
    }
    const child = f.prepare(args, env, preload);
    assert.ifError(child.error);
    assert.equal(child.signal, null);
    if (child.status === 0) {
      assert.equal(refusal, undefined);
      assert.ok(child.stdout.split('\n').includes('Prepared local runtime: '+f.runtime));
      result = 'prepared';
    } else {
      assert.equal(child.status, 1, child.stderr);
      assert.ok(refusal, child.stderr);
      // The code excerpt in Node's error output can contain all branch messages.
      // Match the actual error line to avoid admitting the wrong failure path.
      assert.match(child.stderr, refusal);
      result = 'refused';
    }
  }

  function observe() {
    const stamp = fs.readFileSync(f.stamp);
    assert.ok(stamp.equals(f.old) || stamp.equals(currentStamp), 'The exact old or current stamp must occupy the live slot');
    const backup = fs.existsSync(f.backup) ? fs.readFileSync(f.backup) : null;
    assert.ok(!backup || backup.equals(f.old) || backup.equals(sidecarContents), 'The backup must retain exact prior or peer bytes');
    const checkedOut = f.git(['rev-parse', 'HEAD'], f.runtime);
    assert.ok([f.before, f.after].includes(checkedOut));
    const source = checkedOut === f.before ? 'wrongCommit' : fs.readFileSync(readme).equals(normalReadme) ? 'verified' : 'dirty';
    const present = slot => {
      if (!fs.existsSync(sidecars[slot])) return false;
      assert.deepEqual(fs.readFileSync(sidecars[slot]), sidecarContents);
      return true;
    };
    return {'s.source': source, 's.current': stamp.equals(currentStamp),
      's.backup': backup ? backup.equals(f.old) ? 'prior' : 'peer' : 'absent',
      's.locked': present('lock'), 's.candidate': present('candidate'), 's.result': result};
  }
  return {sourceStatus, placeSidecar, clearSidecar, prepare, observe};
}

export async function checkPreparedSourceStamp(extraSources = []) {
  const sources = [...preparedSourceFixtureInputs, 'test/fixtures/prepare-local-agent.mjs', fileURLToPath(import.meta.url), ...extraSources];
  const driverHashes = captureInputs(sources);
  const stampMismatch = /^Error: Prepared runtime differs or preparation was interrupted\./m;
  const untracked = /^ConsumerSourceError: Unexpected untracked runtime source: /m;
  const cases = [
    ['requalify-and-reuse', [['prepare', 'exact'], ['prepare', 'ordinary'], ['prepare', 'stale']]],
    ['missing-or-stale-explicit-stamp', [['prepare', 'ordinary', stampMismatch], ['prepare', 'stale', stampMismatch]]],
    ['unselected-and-linked-paths', [['prepare', 'noSelection', /^Error: Requalification requires an exact prior stamp /m],
      ['prepare', 'linkedBackup', /^Error: Preserved stamp parent must contain no symlinks/m]]],
    ['dirty-tracked-bytes', [['sourceStatus', 'dirty'], ['prepare', 'exact', /^ConsumerSourceError: Unexpected runtime source change: README\.md/m],
      ['sourceStatus', 'verified'], ['prepare', 'exact']]],
    ['wrong-base-revision', [['sourceStatus', 'wrongCommit'], ['prepare', 'exact', /^ConsumerSourceError: Prepared runtime base commit changed/m]]],
    ['preexisting-lock-refuses-source', [['placeSidecar', 'lock'], ['prepare', 'exact', untracked], ['clearSidecar', 'lock'], ['prepare', 'exact']]],
    ['preexisting-candidate-refuses-source', [['placeSidecar', 'candidate'], ['prepare', 'exact', untracked], ['clearSidecar', 'candidate'], ['prepare', 'exact']]],
    ['occupied-backup-remains-owned', [['placeSidecar', 'backup'], ['prepare', 'exact', /^Error: EEXIST: .*prior-stamp\.json/m],
      ['clearSidecar', 'backup'], ['prepare', 'exact']]],
    ['refused-candidate-leaves-prior-and-no-new-stamp', [['prepare', 'candidateRefusal', /^Error: fixture candidate open refused/m],
      ['prepare', 'exact', /^Error: EEXIST: .*prior-stamp\.json/m], ['prepare', 'ordinary', stampMismatch]]],
    ['reuse-still-authenticates-tracked-bytes', [['prepare', 'exact'], ['sourceStatus', 'dirty'],
      ['prepare', 'ordinary', /^ConsumerSourceError: Unexpected runtime source change: README\.md/m], ['sourceStatus', 'verified'], ['prepare', 'ordinary']]],
  ];
  const traces = cases.map(([name, operations]) => {
    const temp = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'alpha-quint-source-stamp-')));
    try {
      const driver = fixture(temp);
      const expect = driver.observe();
      const steps = operations.map(([op, argument, refusal]) => {
        driver[op](argument, refusal);
        return {label: op+' '+argument, action: action(op, argument), expect: driver.observe()};
      });
      return {name, expect, steps};
    } finally {
      fs.rmSync(temp, {recursive: true, force: true});
    }
  });
  return checkTraces({model: 'PreparedSourceStamp', sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: [
    'The production preparer and immutable verifier operate on disposable local Git repositories. Only source-only invocations run.',
    'Live and retained stamp bytes, selected commit and tracked input, output status, and lock and candidate sidecars are observed after each operation.',
    'A narrowly scoped preload can refuse opening the candidate only inside the scratch root after backup preservation. Real cross-process and power-loss schedules are outside these receipts.',
  ]});
}
