import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qmap} from '../check-traces.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const actors = ['reader', 'peer1', 'peer2'];
const tree = name => {
  const value = {absent: 0, stale: 1, current: 2, other: 3}[name];
  assert.notEqual(value, undefined, 'The source inventory must name an explicit byte/provenance class');
  return value;
};
const indexed = read => qmap(actors.map((actor, index) => [index + 1, read(actor)]));
const action = (name, ...args) => ({name, args});

export async function checkClientFeaturePublication(extraSources = []) {
  const sources = [fileURLToPath(import.meta.url), 'scripts/prepare-client-features.mjs',
    'scripts/upstream-native-source.mjs', 'test/client-feature-preparation.test.mjs',
    'test/fixtures/git-fixture.mjs', 'upstream.lock.json', 'package-lock.json',
    'vendor/eliza/packages/app/scripts/lib/immutable-workspace-source.mjs',
    'vendor/eliza/packages/app/scripts/lib/committed-source.mjs', ...extraSources];
  const driverHashes = captureInputs(sources);
  const directory = fs.mkdtempSync(join(tmpdir(), 'alpha-quint-client-publication-'));
  let concrete;
  try {
    const output = join(directory, 'observations.json');
    const child = spawnSync(process.execPath, ['--test',
      '--test-name-pattern=^client feature publication retires once while a peer moves the winner$',
      'test/client-feature-preparation.test.mjs'], {cwd: root,
      env: {...process.env, ALPHA_CLIENT_FEATURE_PUBLICATION_TRACE: output},
      encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024});
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, child.stderr + child.stdout);
    concrete = JSON.parse(fs.readFileSync(output, 'utf8'));
  } finally {fs.rmSync(directory, {recursive: true, force: true});}
  assert.equal(concrete.schema, 'alpha-client-feature-publication-trace/v1');
  assert.deepEqual(concrete.final.statuses.map(row => [row.actor, row.status]), actors.map(actor => [actor, 0]));
  assert.equal(concrete.final.authenticated, true);
  assert.equal(concrete.final.noSidecars, true);
  assert.deepEqual(concrete.final.reader, {status: 0, retire: 1, publish: 1, read: 2});
  const counts = Object.fromEntries(actors.map(actor => [actor, {retire: 0, publish: 0, read: 0}]));
  const project = event => ({
    's.visible': tree(event.visible), 's.kind': 'regular',
    candidates: indexed(actor => tree(event.actors[actor].stage) !== 0),
    asides: indexed(actor => tree(event.actors[actor].aside)),
    retirements: indexed(actor => counts[actor].retire),
    publications: indexed(actor => counts[actor].publish),
    reads: indexed(actor => Math.min(counts[actor].read, 2)),
  });
  const [first, ...events] = concrete.events;
  assert.equal(first.operation, 'prepared');
  assert.equal(first.actor, 'all');
  const trace = {name: 'three-actual-publishers-with-vanished-peer-readback',
    init: action('preparedPublishers'), expect: project(first), steps: [], concreteSourceObservations: concrete};
  const collision = new Set(), cleanupStarted = new Set();
  for (const event of events) {
    const id = actors.indexOf(event.actor) + 1;
    assert.ok(id > 0, 'Source event belongs to a selected live process');
    let actions;
    if (event.operation === 'retire' || event.operation === 'publish' || event.operation === 'read') {
      counts[event.actor][event.operation]++;
      assert.equal(event.attempt, counts[event.actor][event.operation]);
    }
    if (event.operation === 'retire') {
      assert.ok(['success', 'ENOENT'].includes(event.outcome));
      actions = action('retire', id);
    } else if (event.operation === 'publish') {
      assert.ok(['success', 'EEXIST', 'ENOTEMPTY'].includes(event.outcome));
      if (event.outcome !== 'success') collision.add(event.actor);
      actions = action('publish', id);
    } else if (event.operation === 'read') {
      assert.ok(['present', 'ENOENT'].includes(event.outcome));
      // A successful lstat is only a probe. It does not stand for current() authentication.
      actions = action('probe', id);
    } else {
      assert.equal(event.operation, 'cleanup');
      assert.equal(event.outcome, 'success');
      assert.ok(['aside', 'stage'].includes(event.slot));
      actions = [];
      if (collision.has(event.actor) && !cleanupStarted.has(event.actor)) {
        // The source's successful return (recorded after finally) and exact inventory bind
        // this current()->finally boundary. Neither a lstat nor a filename grants acceptance.
        assert.equal(concrete.final.statuses.find(row => row.actor === event.actor).status, 0);
        actions.push(action('readback', id, true));
      }
      cleanupStarted.add(event.actor);
      actions.push(action(event.slot === 'aside' ? 'cleanupAside' : 'cleanupStage', id, true));
    }
    trace.steps.push({label: event.actor + ' actual ' + event.operation + (event.slot ? ' ' + event.slot : ''),
      action: actions, expect: project(event)});
  }
  trace.steps.push({label: 'all actual function returns and independent exact cache readback', action: null,
    expect: {...project(events.at(-1)), completed: indexed(() => true), accepted: indexed(() => 2)}});
  return checkTraces({model: 'ClientFeaturePublication', sources, driverHashes, traces: [trace],
    scope: 'bounded-orchestration', assumptions: [
      'Three real Node preparer processes authenticate committed disposable Git source and fully materialize private candidates. The fixture gates real rename/lstat/rm syscalls; no collision or missing-path errors are invented.',
      'The first observed checkpoint joins three complete private candidates. The named preparedPublishers initializer is the actual model init followed by three prepare actions. Every later syscall boundary compares all candidate/aside byte classes, visible cache class and rename/probe counts.',
      'A present lstat is probe-only. The readback acceptance macrostep is justified by the actual successful function return after finally, the authenticated complete inventory and the source current() inode/stamp checks. No separate intermediate authentication callback is observed.',
      'Three finite same-target contenders, one stale cache and one actual vanished-directory readback. Model targets/foreign trees, timeout, initial path refusal, IO and cleanup failures have named model scenarios but are not additional source-conformance traces in this campaign.',
      'The source waits cooperatively 25ms against a monotonic 30-second readback deadline. The model uses read-count classes0,1,2-or-more and an explicit timeout; it does not claim OS scheduling or filesystem IO completes before that deadline.',
      'No lock, power-loss durability, automatic orphan recovery or stable path lease for independent readers is established. A crashed process can retain its own stage/aside; a reader can still see a transient gap while a finite preexisting publisher retires once.',
    ]});
}
