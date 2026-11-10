import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {main} from '../../../../scripts/app-update-candidate.mjs';
import {candidateFixture, hash, json, read} from '../../../../test/fixtures/app-update-candidate.mjs';
import {captureInputs, checkTraces, qmap} from '../check-traces.mjs';

const action = (name, ...args) => ({name, args});
const actors = [1, 2];
const floorClass = value => value < 705 ? 1 : value === 705 ? 2 : 3;

/** Settled real helper calls with real exclusive files and scratch Git identities.
 * GitHub/public metadata and the archive admission records are controlled inputs.
 */
export async function checkAppUpdateCandidate(extraSources = []) {
  const sources = [fileURLToPath(import.meta.url), 'scripts/app-update-candidate.mjs',
    'scripts/deliver-app-update.mjs', 'scripts/update-artifact.mjs',
    'test/fixtures/app-update-candidate.mjs', '.github/workflows/resident-android.yml', ...extraSources];
  const driverHashes = captureInputs(sources), traces = [], cleanups = [];
  try {
    async function scenario(name, drive) {
      const fixture = candidateFixture({after: cleanup => cleanups.push(cleanup)});
      const attempts = {1: 1, 2: 1}, outcomes = {1: 'none', 2: 'none'};
      const before = {1: [0, 0], 2: [0, 0]}, calls = [], archives = {};
      let floor = 1;
      const version = actor => `test-results/version-${actor}.json`;
      const archive = actor => `test-results/distribution-${actor}`;
      const readIf = relative => fs.existsSync(path.join(fixture.root, relative)) ? read(path.join(fixture.root, relative)) : null;
      const bytesIf = relative => fs.existsSync(path.join(fixture.root, relative)) ? fs.readFileSync(path.join(fixture.root, relative)) : null;
      const receiptPath = actor => archive(actor) + '/app-update-candidate.json';
      function project() {
        return {'s': {floor, candidates: qmap(actors.map(actor => {
          const first = readIf(version(actor)), final = readIf(receiptPath(actor));
          if (final !== null) {
            assert.equal(typeof final.signed, 'boolean', 'Present receipt must report its actual signing state');
            assert.equal(typeof final.distributionQualified, 'boolean', 'Present receipt must report its actual qualification state');
          }
          return [actor, {attempt: attempts[actor], firstAttempt: Number(first?.runAttempt ?? 0),
            finalAttempt: Number(final?.runAttempt ?? 0), firstFloor: first ? floorClass(first.observedFloor) : 0,
            finalFloor: final ? floorClass(final.finalObservedFloor) : 0,
            versionWrites: Number(first !== null), receiptWrites: Number(final !== null),
            beforeVersionWrites: before[actor][0], beforeReceiptWrites: before[actor][1],
            signed: final === null ? false : final.signed,
            qualified: final === null ? false : final.distributionQualified,
            outcome: outcomes[actor]}];
        }))}};
      }
      const trace = {name, expect: project(), steps: [], concreteSourceObservations: calls};
      const checkpoint = (label, modelAction) => trace.steps.push({label, action: modelAction, expect: project()});
      function select(actor) {
        fixture.env.GITHUB_RUN_NUMBER = String(704 + actor);
        fixture.env.GITHUB_RUN_ID = String(42885443021 + actor);
        fixture.env.GITHUB_RUN_ATTEMPT = String(attempts[actor]);
      }
      async function call(mode, actor, valid) {
        select(actor);
        const prior = [bytesIf(version(actor)), bytesIf(receiptPath(actor))];
        before[actor] = prior.map(bytes => Number(bytes !== null));
        let result, error;
        try {result = await main(mode === 'version' ? ['version', version(actor)] : ['receipt', version(actor), archive(actor)], fixture);}
        catch (failure) {error = failure.message;}
        outcomes[actor] = error ? 'refused' : mode;
        const after = [bytesIf(version(actor)), bytesIf(receiptPath(actor))];
        // A refused real call must preserve the exact earlier evidence bytes.
        if (error) assert.deepEqual(after, prior, 'Refusal changed existing candidate evidence');
        calls.push({mode, actor, runNumber: fixture.env.GITHUB_RUN_NUMBER, attempt: fixture.env.GITHUB_RUN_ATTEMPT,
          inputClass: valid ? 'admitted inputs' : 'selected invalid input', error: error ?? null,
          before: prior.map(bytes => bytes === null ? null : hash(bytes)),
          after: after.map(bytes => bytes === null ? null : hash(bytes)),
          result: result ?? null});
        checkpoint(`${mode} ${actor}: ${error ? 'refused' : 'wrote'}`, action(mode, actor, valid));
        return result;
      }
      function stage(actor) {
        const admission = readIf(version(actor));
        assert.ok(admission, 'A staged synthetic archive needs the actual admitted version');
        archives[actor] = fixture.archive(admission, archive(actor));
        return archives[actor];
      }
      function advance(value) {
        fixture.state.pages = [[{name: `alpha-phone-${value}.apk`}]];
        floor = floorClass(value);
        calls.push({mode: 'external inventory advance', asset: fixture.state.pages[0][0].name});
        checkpoint('retained release inventory advanced', action('advanceFloor', floor));
      }
      function rerun(actor) {
        attempts[actor] = 2;
        calls.push({mode: 'external rerun', actor, sameRunNumber: String(704 + actor), attempt: 2});
        checkpoint('GitHub rerun changed attempt, kept run number', action('rerun', actor));
      }
      await drive({fixture, call, stage, advance, rerun, archive, version});
      traces.push(trace);
    }

    await scenario('two runs: release advances between first and final reads', async ({call, stage, advance}) => {
      await call('version', 1, true); stage(1);
      await call('version', 2, true); stage(2);
      advance(705);
      await call('receipt', 1, true);
      await call('receipt', 2, true);
    });
    await scenario('a rerun cannot overwrite earlier admission or bind its receipt', async ({call, stage, rerun}) => {
      await call('version', 1, true); stage(1); rerun(1);
      await call('version', 1, true); await call('receipt', 1, true);
    });
    await scenario('a fresh rerun has the same code and its own exact attempt', async ({call, stage, rerun}) => {
      rerun(1); await call('version', 1, true); stage(1); await call('receipt', 1, true);
      await call('receipt', 1, true);
    });
    await scenario('a completed unsigned receipt can become stale and grants no release', async ({call, stage, advance}) => {
      await call('version', 1, true); stage(1); await call('receipt', 1, true);
      advance(706); await call('receipt', 1, true);
    });
    for (const pages of [null, []]) await scenario(`incomplete retained inventory ${JSON.stringify(pages)}`, async ({fixture, call}) => {
      fixture.state.pages = pages; await call('version', 1, false);
    });
    await scenario('malformed anonymous pointer cannot admit a version', async ({fixture, call}) => {
      fixture.state.pointer = {bytes: Buffer.from('{}'), sha256: hash('{}')}; await call('version', 1, false);
    });
    await scenario('wrong trusted workflow epoch cannot admit a version', async ({fixture, call}) => {
      fixture.state.runChanges.workflow_id = 373209005; await call('version', 1, false);
    });
    await scenario('missing first stable release is an explicit valid empty inventory', async ({fixture, call, stage}) => {
      fixture.state.missing = true; await call('version', 1, true); stage(1); await call('receipt', 1, true);
    });
    for (const mutation of ['bytes', 'freeze', 'signed', 'profile', 'final inventory']) {
      await scenario(`final ${mutation} refusal preserves the actual first admission`, async ({fixture, call, stage}) => {
        await call('version', 1, true); const output = stage(1).output;
        if (mutation === 'bytes') fs.appendFileSync(path.join(output, 'launcher-release-unsigned.apk'), 'changed');
        else if (mutation === 'freeze') json(path.join(output, 'inputs-after.json'), {digest: '0'.repeat(64)});
        else if (mutation === 'final inventory') fixture.state.pages = [];
        else {
          const file = path.join(output, 'apk-verification.json'), value = read(file);
          if (mutation === 'signed') value.results[1].signed = true;
          else value.runtimeProfile = 'cloud';
          json(file, value);
        }
        await call('receipt', 1, false);
      });
    }
    return await checkTraces({model: 'AppUpdateCandidate', sources, driverHashes, traces,
      scope: 'bounded-orchestration', assumptions: [
        'Two candidate run numbers705/706 and attempts1/2 use real disposable Git checkouts, real exclusive JSON creation and real archive byte hashing. Floor classes1/2/3 mean below705, equal705 and at-or-above706. The actual raw admitted floors and source/SDK/run fields are retained in each concrete observation.',
        'GitHub API and anonymous pointer transport are closed metadata ports. The fixed existing workflow epoch and GitHub uniqueness/stability of run_number are trusted platform inputs, not proved by this model or by a simulated Actions run.',
        'Each model call is one settled production main() operation. An advancing release between first and final calls is exercised. Publication after the final read can stale an unsigned receipt; its recorded read witness is not a reservation or permission to sign or publish.',
        'Archive members are explicit synthetic bytes with matching or changed admission records. The helper rehashes these real private files. This does not build or admit an actual APK, run verify-apks, qualify native voice, operate protected signing, publish a channel, or execute Android.',
        'Missing release, incomplete pages, malformed pointer, wrong workflow epoch, changed run attempt, changed archive bytes/freeze/profile/signed flag and exclusive-write collisions are source schedules. Full GitHub pagination/network behavior, concurrent filesystem mutation, process death, storage durability and downstream promotion remain separate.',
      ]});
  } finally {for (const cleanup of cleanups.reverse()) cleanup();}
}
