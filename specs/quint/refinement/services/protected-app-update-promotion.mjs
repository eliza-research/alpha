import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {deliver} from '../../../../scripts/deliver-app-update.ts';
import {APP_UPDATE_MANIFEST, APP_UPDATE_TAG, LEGACY_APP_UPDATE_TAG, appUpdateManifestUrl} from '../../../../scripts/update-channel.ts';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const workflow = name => '.github/workflows/' + name + '.yml';
const signer = workflow('release-cloud-app-signing');
const verifier = workflow('verify-cloud-signing-input');
const publisher = workflow('publish-qualified-app-update');
const producer = workflow('resident-android');
const python = 'specs/quint/refinement/services/protected-app-update-promotion.py';
const manifestName = APP_UPDATE_MANIFEST;
const manifestUrl = appUpdateManifestUrl();
const legacyUrl = appUpdateManifestUrl(LEGACY_APP_UPDATE_TAG);
const read = file => fs.readFileSync(file, 'utf8');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const object = bytes => ({bytes: Buffer.from(bytes), size: bytes.length, sha256: sha(bytes)});

function ordered(steps, ...conditions) {
  let previous = -1;
  for (const condition of conditions) {
    const current = steps.findIndex(condition);
    assert.ok(current > previous, 'Missing or reordered protected release step: ' + condition);
    previous = current;
  }
}
const runs = fragment => step => step.run?.includes(fragment);

function checkWorkflows() {
  const producerJob = Object.values(YAML.parse(read(producer)).jobs)
    .find(job => job.env?.ALPHA_APP_UPDATE_CANDIDATE);
  assert.match(producerJob.env.ALPHA_APP_UPDATE_CANDIDATE, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  ordered(producerJob.steps, runs('app-update-candidate.ts version'), runs('app-update-candidate.ts receipt'),
    step => step.with?.name?.startsWith('app-native-candidate-'));
  const signing = YAML.parse(read(signer)).jobs;
  assert.equal(signing.admit.uses, './' + verifier);
  assert.match(signing.admit.if, /inputs\.workflow_commit == github\.sha/);
  assert.equal(signing.sign.needs, 'admit');
  assert.equal(signing.sign.environment, 'release');
  assert.match(signing.sign.if, /needs\.admit\.result == 'success'.*needs\.admit\.outputs\.plan_sha256 != ''/);
  const verify = YAML.parse(read(verifier)).jobs.admit;
  assert.equal(verify.outputs.plan_sha256, '$' + '{{ steps.verify.outputs.plan_sha256 }}');
  assert.ok(verify.steps.some(runs('bash scripts/ci/verify-cloud-signing-input.sh')));
  ordered(signing.sign.steps, runs('verify-cloud-signing-input.sh --stage'), runs('node scripts/sign-release-apks.ts --keystore'),
    runs('apksigner" verify'), step => step.with?.name?.startsWith('private-cloud-apk-delivery-'));
  const staged = signing.sign.steps.find(runs('verify-cloud-signing-input.sh --stage'));
  assert.equal(staged.env.EXPECTED_PLAN, '$' + '{{ needs.admit.outputs.plan_sha256 }}');
  assert.match(staged.run, /\$EXPECTED_PLAN/);
  const secretSteps = signing.sign.steps.filter(step => Object.values(step.env ?? {}).some(value => String(value).includes('secrets.')));
  assert.equal(secretSteps.length, 1);
  const [signingKeyStep] = secretSteps;
  assert.match(signingKeyStep.run, /sha256sum --check --strict[\s\S]+keytool -exportcert[\s\S]+test "\$actual" = "\$expected"[\s\S]+sign-release-apks\.ts/);
  assert.ok(signing.sign.steps.find(runs('apksigner" verify')).run.includes('private-apk-storage.py upload'));

  const publishing = YAML.parse(read(publisher)).jobs;
  assert.equal(publishing.publish.needs, 'admit');
  assert.equal(publishing.publish.environment, 'release');
  assert.match(publishing.admit.if, /inputs\.workflow_commit == github\.sha/);
  assert.match(publishing.publish.if, /needs\.admit\.result == 'success'.*needs\.admit\.outputs\.qualification_sha256 != ''/);
  const restored = publishing.publish.steps.find(runs('--product "$GITHUB_WORKSPACE/qualified-product"'));
  assert.equal(restored.env.EXPECTED_QUALIFICATION, '$' + '{{ needs.admit.outputs.qualification_sha256 }}');
  assert.match(restored.run, /\$EXPECTED_QUALIFICATION/);
  assert.equal(publishing.publish.steps.find(step => step.with?.path === 'qualified-product').with.ref,
    '$' + '{{ needs.admit.outputs.source_commit }}');
  const reverify = publishing.publish.steps.find(runs('npm run android:verify -- --cloud-voice-evidence='));
  assert.equal(reverify?.['working-directory'], 'qualified-product');
  assert.equal(reverify.run, 'npm run android:verify -- --cloud-voice-evidence="$RUNNER_TEMP/qualified-stage/cloud-voice.json"');
  assert.equal(JSON.parse(read('package.json')).scripts['android:verify'], 'node scripts/verify-apks.ts');
  ordered(publishing.publish.steps, runs('--product "$GITHUB_WORKSPACE/qualified-product"'),
    step => step === reverify, runs("row['cloudVoice']['evidenceSha256']"),
    runs('scripts/deliver-app-update.ts --variant launcher'));
}

const initial = {release: false, apk: 'missing', pointer: 'missing', floor: 1, apkVerified: false,
  pointerWrite: false, receipt: false};

function publicFixture(directory, launcherBytes, version) {
  const bytes = Buffer.from(launcherBytes);
  const apkName = 'alpha-phone-' + version + '.apk';
  const offer = {schema: 'alpha-update/v1', variant: 'launcher', versionCode: version, signerSha256: 'f'.repeat(64),
    sha256: sha(bytes), sizeBytes: bytes.length, apkUrl: new URL(apkName, manifestUrl).href};
  const manifest = Buffer.from(JSON.stringify(offer));
  const otherPointer = versionCode => object(Buffer.from(JSON.stringify({...offer, versionCode})));
  fs.writeFileSync(path.join(directory, apkName), bytes);
  fs.writeFileSync(path.join(directory, manifestName), manifest);
  let release = false, apk = null, pointer = null, floor = 1;
  let apkVerified = false, pointerWrite = false, receipt = null;
  return {
    observe() {
      return {release, apk: !apk ? 'missing' : apk.sha256 === sha(bytes) ? 'exact' : 'partial',
        pointer: !pointer ? 'missing' : pointer.sha256 === sha(manifest) ? 'exact' : JSON.parse(pointer.bytes).versionCode > version ? 'newer' : 'old',
        floor, apkVerified, pointerWrite, receipt: receipt !== null};
    },
    existingRelease() {
      release = true;
      pointer = otherPointer(version - 1);
    },
    advanceFloor() {
      release = true;
      floor = 3;
    },
    advanceLegacyFloor() { floor = 2; },
    async publish(fault) {
      apkVerified = false;
      pointerWrite = false;
      receipt = null;
      let manifestReads = 0, legacyChecks = 0, stableChecks = 0;
      const effects = [];
      function fail(at) {
        if (fault === at) throw Error('Closed publication port ' + at);
      }
      try {
        receipt = await deliver({directory, manifestUrl, source: '1'.repeat(40)}, {
          wait: async () => {},
          run(args) {
            if (args[0] === 'api') {
              assert.deepEqual(args, ['api', 'repos/eliza-research/alpha']);
              return JSON.stringify({id: 1396333361, full_name: 'eliza-research/alpha', owner: {id: 314117943}, private: false});
            }
            if (args[0] !== 'release') assert.fail('Unexpected command: ' + args.join(' '));
            if (args[1] === 'view' && args[2] === LEGACY_APP_UPDATE_TAG) {
              legacyChecks++;
              if (apkVerified && fault === 'late-legacy-floor') floor = 2;
              return floor === 2
                ? JSON.stringify({isDraft: false, assets: [{name: apkName}]})
                : null;
            }
            assert.equal(args[2], APP_UPDATE_TAG);
            if (args[1] === 'view') {
              stableChecks++;
              if (apkVerified && fault === 'late-stable-floor') floor = 3;
              if (apkVerified && fault === 'lost-apk') apk = null;
              const names = [apk && apkName, pointer && manifestName, floor === 3 && ('alpha-phone-' + (version + 1) + '.apk')];
              return release ? JSON.stringify({isDraft: false, assets: names.filter(Boolean).map(name => ({name}))}) : null;
            }
            effects.push(args[1] === 'upload' ? path.basename(args[3]) : args[1]);
            if (args[1] === 'create') {
              fail('create-before');
              release = true;
              fail('create-after');
            } else if (args[1] === 'upload' && path.basename(args[3]) === apkName) {
              assert.equal(args.includes('--clobber'), false);
              assert.equal(apk, null, 'A retained versioned APK must never be overwritten');
              fail('apk-before');
              apk = object(fault === 'apk-partial' ? bytes.subarray(0, 2) : fs.readFileSync(args[3]));
              fail('apk-partial');
              fail('apk-after');
            } else {
              assert.equal(path.basename(args[3]), manifestName);
              assert.equal(args.includes('--clobber'), true);
              assert.equal(apkVerified, true, 'Pointer write requires exact anonymous APK readback');
              assert.ok(legacyChecks >= 2 && stableChecks >= 2, 'Pointer write requires both final floor checks');
              assert.equal(apk?.sha256, offer.sha256, 'Final inventory must still contain the verified APK');
              pointerWrite = true;
              fail('manifest-before');
              pointer = fault === 'manifest-partial' ? null : object(fs.readFileSync(args[3]));
              fail('manifest-partial');
              fail('manifest-after');
            }
            return '';
          },
          async read(url) {
            if (url === legacyUrl) return null;
            if (url === manifestUrl) {
              manifestReads++;
              if (manifestReads === 2 && fault === 'pointer-race') {
                pointer = otherPointer(version + 1);
                floor = 3;
              }
              if (manifestReads === 2 && fault === 'hidden-pointer') return null;
              if (manifestReads >= 3 && fault === 'manifest-readback') return null;
              return pointer;
            }
            assert.equal(url, offer.apkUrl);
            if (!apk || fault === 'apk-readback') return null;
            apkVerified = apk.sha256 === offer.sha256 && apk.size === offer.sizeBytes;
            return apk;
          },
        });
        assert.equal(receipt.apkSha256, offer.sha256);
        assert.equal(receipt.manifestSha256, sha(manifest));
        assert.equal(receipt.anonymousReadback, true);
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
        return {fault, effects, refusal: error.message};
      }
      return {fault, effects, refusal: null};
    },
  };
}

const faults = ['create-before', 'create-after', 'apk-before', 'apk-partial', 'apk-after',
  'apk-readback', 'manifest-before', 'manifest-partial', 'manifest-after', 'manifest-readback'];

export async function checkProtectedAppUpdatePromotion(extraSources = []) {
  const sources = [
    fileURLToPath(import.meta.url), python, signer, verifier, publisher, producer, 'package.json',
    'scripts/app-update-candidate.ts', 'scripts/ci/verify-cloud-signing-input.sh',
    'scripts/ci/admit-cloud-signing-input.py', 'scripts/ci/private-apk-storage.py',
    'scripts/ci/qualified-app-update.py', 'scripts/verify-apks.ts', 'scripts/sign-release-apks.ts',
    'scripts/deliver-app-update.ts', 'scripts/update-artifact.ts', 'scripts/update-channel.ts', 'scripts/publish-update-manifest.ts',
    'test/cloud-signing-input.test.py', 'test/qualified-app-update.test.py', ...extraSources,
  ];
  const driverHashes = captureInputs(sources);
  checkWorkflows();
  const {traces, launcherBytes, versionCode} = JSON.parse(execFileSync('python3', ['-B', python], {
    encoding: 'utf8', timeout: 120_000,
  }));
  for (const trace of traces) {
    trace.expect.s.public = initial;
    for (const step of trace.steps) step.expect.s.public = initial;
  }
  const admitted = traces[0];
  const restored = admitted.steps.at(-1).expect.s;
  assert.equal(restored.restored, true);
  assert.equal(admitted.concreteSourceObservations.at(-1).stagedSignedSHA256.launcher, sha(launcherBytes));
  const cases = [
    ['raised retained version floor blocks otherwise exact bytes', ['advanceFloor', 'ok']],
    ['equal retained legacy floor blocks the current channel write', ['advanceLegacyFloor', 'ok']],
    ['changed stable pointer prevents moving it after APK readback', ['pointer-race', 'ok']],
    ['complete delivery and idempotent retry', ['ok', 'ok']],
    ['legacy inventory changes during APK readback', ['late-legacy-floor', 'ok']],
    ['current inventory changes during APK readback', ['late-stable-floor', 'ok']],
    ['verified APK disappears from the final inventory', ['lost-apk', 'ok']],
    ['final inventory has a temporarily unreadable pointer', ['existingRelease', 'hidden-pointer', 'ok']],
    ...faults.map(fault => ['before/after public effect: ' + fault,
      [...(fault.startsWith('manifest-') ? ['existingRelease'] : []), fault, 'ok']]),
  ];
  for (const [name, schedule] of cases) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-promotion-public-'));
    try {
      const fixture = publicFixture(directory, launcherBytes, versionCode);
      const trace = {name, expect: admitted.expect, steps: [...admitted.steps], concreteSourceObservations: [...admitted.concreteSourceObservations]};
      for (const fault of schedule) {
        const effect = fault === 'advanceFloor' || fault === 'advanceLegacyFloor' || fault === 'existingRelease';
        if (effect) fixture[fault]();
        else trace.concreteSourceObservations.push(await fixture.publish(fault));
        trace.steps.push({label: fault, action: {name: effect ? fault : 'publish', args: effect ? [] : [fault]},
          expect: {s: {...restored, public: fixture.observe()}}});
      }
      traces.push(trace);
    } finally {
      fs.rmSync(directory, {recursive: true, force: true});
    }
  }
  return checkTraces({model: 'ProtectedAppUpdatePromotion', sources, driverHashes, traces, scope: 'bounded-orchestration',
    assumptions: [
      'The adjacent AppUpdateCandidate campaign exercises the live version and unsigned-receipt helper. The release workflow structures are parsed and their exact admission, verification and write order checked without executing jobs.',
      'The current signing admission shell runs against scratch Git and a closed gh command. Private object media, receipt staging and signed byte restoration run actual Python implementations against controlled transports. Signed APKs, signer facts and reviewed voice receipts are synthetic inputs.',
      'The actual publication helper runs with closed release and anonymous read ports using the restored launcher bytes. The ports choose possible failures before effects, after committed effects, and during a partial upload. They do not predict GitHub or object-storage durability or concurrency.',
      'The main-push receipt has no current signer route. The dispatched archive path does not pin its producer attempt. The publication reader does pin the protected signing attempt and exact private object generation. No live credentials, approvals, signed APKs, rollout, voice qualification or device acceptance are exercised.',
    ],
  });
}
