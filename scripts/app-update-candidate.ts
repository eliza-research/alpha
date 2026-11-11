#!/usr/bin/env bun
/** Read-only version admission and receipts for unsigned main-push candidates.
 * This does not sign, reserve release versions, or publish an update.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicObject} from './deliver-app-update.ts';
import {updateArtifactDigest} from './update-artifact.ts';
import {
  APP_UPDATE_MANIFEST, APP_UPDATE_REPOSITORY as REPOSITORY, APP_UPDATE_REPOSITORY_ID as REPOSITORY_ID,
  APP_UPDATE_TAG, LEGACY_APP_UPDATE_TAG,
  appUpdateManifestUrl, isPublishedUpdateApkUrl,
} from './update-channel.ts';

type CandidateOptions = {root?: string; env?: NodeJS.ProcessEnv; api?: InventoryApi; read?: typeof publicObject};
type InventoryApi = (args: string[], options?: {missing?: boolean}) => unknown;
interface ProductConfig {appId: string; versionCode: number; updateManifestUrl: string}
interface RepositoryIdentity {id: number; full_name: string}
interface CandidateRun {id: number; workflow_id: number; path: string; event: string; head_branch: string; head_sha: string; repository?: RepositoryIdentity; head_repository?: RepositoryIdentity; run_number: number; run_attempt: number}
interface StableRelease {id: number; draft: boolean}
interface StableAsset {name: string}
interface UpdateOffer {schema: string; variant: string; signerSha256: string; sha256: string; sizeBytes: number; apkUrl: string; versionCode: number}
interface ArchiveRecord {testMocks: boolean; runtimeProfile: string; updateChannel: {kind: string; manifestUrlSha256: string}}
interface VerifiedApk extends ArchiveRecord {mode: string; variant: string; file: string; packageName: string; versionCode: number; signed: boolean; signerSha256: string | null; distributable: boolean; debuggable: boolean; runtime: string; home: boolean; launcher: boolean; sha256: string; releaseAdmission: {failures: unknown[]; blockers: string[]}}
interface ArchiveVerification extends ArchiveRecord {upstream: {commit: string}; allowUnpackagedRuntime: boolean; results: VerifiedApk[]}
interface InputFreeze {files: Record<string, string>; digest: string}
interface NativeInputAdmission {
  schema: string; source: string; sdkCommit: string; packageName: string; runId: string; attempt: string;
  manifestSha256: string; voiceRecordSha256: string; embeddingRecordSha256: string;
  artifacts: Record<string, {artifactId: number; sha256: string; source: string; run: number; archiveBytes: number; expandedBytes: number}>;
  embedding: {compiledAlpha: string; compiledSDK: string; native: string; qualifiedAt: string; qualificationTransferred: boolean};
}
interface NativeInputPlan {artifacts: Record<string, {id: string; sha256: string}>}
interface UploadedCandidate {
  id: number; name: string; digest: string; expired: boolean; size_in_bytes: number;
  workflow_run?: {id: number; head_sha: string; head_branch: string; repository_id: number; head_repository_id: number};
}
type VersionAdmission = Awaited<ReturnType<typeof candidateVersion>>;
type ApkDigest = {file: string; bytes: number; sha256: string};

const WORKFLOW = '.github/workflows/resident-android.yml';
// This existing workflow owns the run-number epoch. Recreating or replacing it
// requires a reviewed version migration, even if its path is unchanged.
const WORKFLOW_ID = 373209004;
const MAX_CODE = 2100000000;
const NATIVE_INPUT_RECEIPT = 'native-input-admission.json';
const GENERATED_NATIVE_INPUT_RECEIPT = 'test-results/resident-ci-native-inputs/admission.json';
const NATIVE_ARTIFACTS = ['voice', 'embeddingComponent', 'embeddingQualification'];
const NATIVE_INPUT_RECORDS = {
  manifestSha256: 'android/hosted-native-inputs.json',
  voiceRecordSha256: 'android/voice-host/qualified-voice-host.json',
  embeddingRecordSha256: 'android/embedding-host/qualified-host.json',
} as const;
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;
function code(value: number) {
  assert.ok(Number.isSafeInteger(value) && value > 0 && value <= MAX_CODE, 'Invalid Android versionCode');
  return value;
}
function identity(root: string, env: NodeJS.ProcessEnv) {
  assert.equal(env.GITHUB_REPOSITORY, REPOSITORY, 'Candidates require the product repository');
  assert.equal(env.GITHUB_REPOSITORY_ID, String(REPOSITORY_ID), 'Candidate repository ID differs');
  assert.equal(env.GITHUB_EVENT_NAME, 'push', 'Candidates require a main push');
  assert.equal(env.GITHUB_REF, 'refs/heads/main', 'Candidates require main');
  assert.equal(env.GITHUB_WORKFLOW_REF, `${REPOSITORY}/${WORKFLOW}@refs/heads/main`, 'Candidate workflow changed; review its version epoch');
  assert.match(env.GITHUB_SHA || '', /^[0-9a-f]{40}$/, 'Exact source commit required');
  for (const name of ['GITHUB_RUN_ID', 'GITHUB_RUN_NUMBER', 'GITHUB_RUN_ATTEMPT']) {
    assert.match(env[name] || '', /^[1-9][0-9]{0,15}$/, `Exact ${name} required`);
    assert.ok(Number.isSafeInteger(Number(env[name])), `Invalid ${name}`);
  }
  const git = (args: string[]) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
  assert.equal(git(['rev-parse', 'HEAD']), env.GITHUB_SHA, 'Candidate source changed');
  const sdkCommit = readJson<{commit: string}>(path.join(root, 'upstream.lock.json')).commit;
  assert.match(sdkCommit || '', /^[0-9a-f]{40}$/);
  assert.equal(git(['-C', 'vendor/eliza', 'rev-parse', 'HEAD']), sdkCommit, 'Candidate SDK changed');
  return {sourceCommit: env.GITHUB_SHA, sdkCommit, workflow: env.GITHUB_WORKFLOW_REF, workflowId: WORKFLOW_ID,
    runId: env.GITHUB_RUN_ID, runNumber: env.GITHUB_RUN_NUMBER, runAttempt: env.GITHUB_RUN_ATTEMPT,
    versionCode: code(Number(env.GITHUB_RUN_NUMBER))};
}
function gh(args: string[], {missing = false}: {missing?: boolean} = {}): unknown {
  try {return JSON.parse(execFileSync('gh', ['api', ...args], {encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024**2, stdio: ['ignore', 'pipe', 'pipe']}));}
  catch (error) {
    if (missing && /HTTP 404/.test(String((error as {stderr?: unknown}).stderr))) return null;
    throw Error('Candidate inventory read failed; do not guess a version floor');
  }
}
function archiveDirectory(root: string, archive: string) {
  const directory = path.resolve(root, archive);
  assert.ok(directory.startsWith(path.join(root, 'test-results') + path.sep), 'Candidate archive must be an owned test-results leaf');
  return directory;
}
function nativeInputReceipt(archive: string) {
  const file = path.join(archive, NATIVE_INPUT_RECEIPT), stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 65536, 'Candidate needs a bounded native input admission receipt');
  const bytes = fs.readFileSync(file);
  return {record: JSON.parse(bytes.toString('utf8')) as NativeInputAdmission, sha256: hash(bytes)};
}

/** Reuse delivery's stable APK names and anonymous manifest transport. Read all
 * asset pages, including retained APKs left by an interrupted pointer upload.
 */
export async function candidateVersion({root = process.cwd(), env = process.env, api = gh, read = publicObject}: CandidateOptions = {}) {
  const context = identity(root, env);
  const run = api([`repos/${REPOSITORY}/actions/runs/${context.runId}`]) as CandidateRun;
  assert.ok(run.id === Number(context.runId) && run.workflow_id === WORKFLOW_ID &&
    run.path === WORKFLOW && run.event === 'push' && run.head_branch === 'main' &&
    run.head_sha === context.sourceCommit && [run.repository, run.head_repository].every(repository =>
      repository?.id === REPOSITORY_ID && repository.full_name === REPOSITORY) &&
    run.run_number === context.versionCode && run.run_attempt === Number(context.runAttempt),
  'Candidate run identity or workflow version epoch changed');
  const config = readJson<ProductConfig>(path.join(root, 'app.config.json'));
  assert.equal(config.updateManifestUrl, appUpdateManifestUrl(), 'Candidate channel changed');
  const descriptor = readJson<{lastRelease?: {versionCode: number | null}}>(path.join(root, 'android/release-signer.json'));
  const floors = [code(config.versionCode)];
  if (descriptor.lastRelease?.versionCode !== null) floors.push(code(descriptor.lastRelease?.versionCode as number));
  const repository = api([`repos/${REPOSITORY}`]) as RepositoryIdentity & {private: boolean};
  assert.ok(repository.id === REPOSITORY_ID && repository.full_name === REPOSITORY && repository.private === false, 'Candidate inventory must be the public product repository');
  let manifestSha256: string | null = null;
  for (const tag of [LEGACY_APP_UPDATE_TAG, APP_UPDATE_TAG] as const) {
    const url = appUpdateManifestUrl(tag);
    const release = api([`repos/${REPOSITORY}/releases/tags/${tag}`], {missing: true}) as StableRelease | null;
    let assets: StableAsset[] = [];
    if (release !== null) {
      assert.equal(release.draft, false, 'Stable release is a draft');
      assert.ok(Number.isSafeInteger(release.id) && release.id > 0, 'Stable release identity missing');
      const pages = api(['--paginate', '--slurp', `repos/${REPOSITORY}/releases/${release.id}/assets?per_page=100`]) as StableAsset[][];
      assert.ok(Array.isArray(pages) && pages.length >= 1 && pages.every(Array.isArray), 'Incomplete stable asset inventory');
      assets = pages.flat();
      for (const asset of assets) {
        assert.equal(typeof asset.name, 'string', 'Malformed stable asset inventory');
        const match = /^alpha-phone-([1-9][0-9]*)\.apk$/.exec(asset.name);
        if (match) floors.push(code(Number(match[1])));
      }
    }
    const pointer = await read(url, {maxBytes: 32768, missing: true});
    if (pointer !== null) {
      assert.notEqual(release, null, 'Public pointer has no authoritative stable release');
      assert.ok(pointer.bytes, 'Public pointer bytes missing');
      const offer = JSON.parse(pointer.bytes.toString('utf8')) as UpdateOffer;
      assert.ok(offer.schema === 'alpha-update/v1' && offer.variant === 'launcher' &&
        /^[0-9a-f]{64}$/.test(offer.signerSha256 || '') && /^[0-9a-f]{64}$/.test(offer.sha256 || '') &&
        Number.isSafeInteger(offer.sizeBytes) && offer.sizeBytes > 0 && offer.sizeBytes <= 2**31 &&
        isPublishedUpdateApkUrl(offer.apkUrl, tag, code(offer.versionCode)), 'Malformed stable pointer');
      floors.push(offer.versionCode);
      if (tag === APP_UPDATE_TAG) manifestSha256 = pointer.sha256;
    } else {
      assert.ok(!assets.some(asset => asset.name === APP_UPDATE_MANIFEST), 'Stable pointer is not anonymously readable');
    }
  }
  const observedFloor = floors.reduce((highest, value) => Math.max(highest, value), 0);
  assert.ok(context.versionCode > observedFloor, 'Workflow run_number must exceed the retained/manual version floor; review a workflow version-epoch migration, do not reuse or guess a code');
  return {schema: 'alpha-app-candidate-version/v1', ...context, observedFloor,
    manifestSha256,
    runtimeProfile: 'native', updateChannel: {kind: 'public', manifestUrlSha256: hash(config.updateManifestUrl)}};
}

/** Bind the existing build-archive source freeze and actual unsigned bytes.
 * These checks do not replace verify-apks or grant distribution admission.
 */
export function candidateReceipt({root = process.cwd(), env = process.env, admission, archive}: {root?: string; env?: NodeJS.ProcessEnv; admission: VersionAdmission; archive: string}) {
  const context = identity(root, env);
  for (const name of Object.keys(context) as (keyof typeof context)[]) assert.equal(admission[name], context[name], `Candidate ${name} changed`);
  assert.equal(admission.schema, 'alpha-app-candidate-version/v1');
  assert.equal(admission.runtimeProfile, 'native');
  assert.ok(context.versionCode > code(admission.observedFloor));
  const config = readJson<ProductConfig>(path.join(root, 'app.config.json'));
  const channel = {kind: 'public', manifestUrlSha256: hash(config.updateManifestUrl)};
  assert.deepEqual(admission.updateChannel, channel, 'Candidate update channel changed');
  archive = archiveDirectory(root, archive);
  const configuration = readJson<ArchiveRecord>(path.join(archive, 'configuration.json'));
  const verified = readJson<ArchiveVerification>(path.join(archive, 'apk-verification.json'));
  for (const record of [configuration, verified]) {
    assert.equal(record.testMocks, false, 'Test-mocks are not update candidates');
    assert.equal(record.runtimeProfile, 'native', 'Automatic candidates retain the native profile');
    assert.deepEqual(record.updateChannel, channel, 'Archive update channel changed');
  }
  assert.equal(verified.upstream.commit, context.sdkCommit, 'Archive SDK differs');
  assert.equal(verified.allowUnpackagedRuntime, false, 'Candidate requires the packaged resident');
  const before = readJson<InputFreeze>(path.join(archive, 'inputs-before.json'));
  const after = readJson<InputFreeze>(path.join(archive, 'inputs-after.json'));
  assert.deepEqual(after, before, 'Archive inputs changed');
  assert.equal(hash(JSON.stringify(before.files)), before.digest, 'Archive input fingerprint differs');
  assert.equal(before.files['upstream.lock.json'], hash(fs.readFileSync(path.join(root, 'upstream.lock.json'))), 'Archive source lock differs');
  const native = nativeInputReceipt(archive);
  assert.equal(before.files[GENERATED_NATIVE_INPUT_RECEIPT], native.sha256, 'Generated native input receipt differs from the build freeze');
  assert.ok(native.record.schema === 'alpha-hosted-native-input-admission/v1' &&
    native.record.source === context.sourceCommit && native.record.sdkCommit === context.sdkCommit &&
    native.record.packageName === config.appId && native.record.runId === context.runId && native.record.attempt === context.runAttempt,
  'Native input admission does not bind the exact candidate source, package, SDK and run attempt');
  for (const key of Object.keys(NATIVE_INPUT_RECORDS) as (keyof typeof NATIVE_INPUT_RECORDS)[]) {
    const file = NATIVE_INPUT_RECORDS[key], digest = native.record[key];
    assert.ok(/^[0-9a-f]{64}$/.test(digest) && before.files[file] === digest &&
      hash(fs.readFileSync(path.join(root, file))) === digest, `Native input admission differs from frozen ${file}`);
  }
  const plan = readJson<NativeInputPlan>(path.join(root, NATIVE_INPUT_RECORDS.manifestSha256));
  assert.deepEqual(Object.keys(native.record.artifacts ?? {}).sort(), [...NATIVE_ARTIFACTS].sort(), 'Native input admission needs all three artifacts');
  for (const name of NATIVE_ARTIFACTS) {
    const actual = native.record.artifacts[name], expected = plan.artifacts[name];
    assert.ok(expected && Number.isSafeInteger(actual.artifactId) && String(actual.artifactId) === expected.id &&
      actual.sha256 === expected.sha256 && /^[0-9a-f]{64}$/.test(actual.sha256) && /^[0-9a-f]{40}$/.test(actual.source) &&
      Number.isSafeInteger(actual.run) && actual.run > 0 &&
      Number.isSafeInteger(actual.archiveBytes) && actual.archiveBytes > 0 &&
      Number.isSafeInteger(actual.expandedBytes) && actual.expandedBytes > 0, `Native input artifact ${name} differs from its frozen plan`);
  }
  const component = native.record.embedding;
  const engine = readJson<{forkPin: string}>(path.join(root, NATIVE_INPUT_RECORDS.embeddingRecordSha256)).forkPin;
  assert.ok(component && /^[0-9a-f]{40}$/.test(component.compiledAlpha) && /^[0-9a-f]{40}$/.test(component.compiledSDK) &&
    component.native === engine && typeof component.qualifiedAt === 'string' && Number.isFinite(Date.parse(component.qualifiedAt)) &&
    component.qualificationTransferred === false, 'Native input embedding qualification is incomplete');
  const manifest = readJson<Record<string, string>>(path.join(archive, 'apk-manifest.json'));
  const releases = verified.results.filter(row => row.mode === 'release');
  assert.equal(releases.length, 2, 'Exactly two release variants required');
  const apks: Record<string, ApkDigest> = {};
  for (const variant of ['standalone', 'launcher']) {
    const name = `${variant}-release-unsigned.apk`, file = path.join(archive, name);
    const row = releases.find(entry => entry.variant === variant);
    assert.ok(row && row.file === `artifacts/${name}` && row.packageName === config.appId &&
      row.versionCode === context.versionCode && row.signed === false && row.signerSha256 === null &&
      row.distributable === false && row.testMocks === false && row.debuggable === false &&
      row.runtime === 'PACKAGED' && row.home === (variant === 'launcher') && row.launcher === true &&
      row.releaseAdmission.failures.length === 0 && row.releaseAdmission.blockers.includes('unsigned release'), 'Archive is not a genuine unsigned candidate');
    assert.deepEqual(row.updateChannel, channel);
    const stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Candidate APK must be a regular file');
    const digest = updateArtifactDigest(file), afterStat = fs.lstatSync(file);
    assert.deepEqual([stat.ino, stat.size, stat.mtimeMs], [afterStat.ino, afterStat.size, afterStat.mtimeMs], 'Candidate APK changed');
    assert.ok(afterStat.isFile() && !afterStat.isSymbolicLink() && digest.size > 0 && digest.size <= 2**31, 'Candidate APK size or type differs');
    assert.equal(digest.sha256, row.sha256, 'Candidate APK differs from verification');
    assert.equal(digest.sha256, manifest[name], 'Candidate archive digest differs');
    apks[variant] = {file: name, bytes: digest.size, sha256: digest.sha256};
  }
  return {...admission, schema: 'alpha-app-update-candidate/v1',
    sourceScope: 'checkout-commit-and-frozen-build-inputs', sourceFingerprint: before.digest,
    apks, nativeInputAdmissionSha256: native.sha256, verificationSha256: hash(fs.readFileSync(path.join(archive, 'apk-verification.json'))),
    signed: false, distributionQualified: false, qualificationScope: 'unsigned-build-and-source-freeze-only'};
}

/** The uploaded ZIP size comes from GitHub. Expanded bytes are the files sent by
 * the upload step, whose default artifact path excludes hidden files. */
export function candidateArchiveSize({root = process.cwd(), env = process.env, api = gh, archive}:
  CandidateOptions & {archive: string}) {
  const context = identity(root, env);
  archive = archiveDirectory(root, archive);
  const candidateBytes = fs.readFileSync(path.join(archive, 'app-update-candidate.json'));
  const candidate = JSON.parse(candidateBytes.toString('utf8')) as ReturnType<typeof candidateReceipt>;
  assert.equal(candidate.schema, 'alpha-app-update-candidate/v1');
  for (const key of Object.keys(context) as (keyof typeof context)[]) assert.equal(candidate[key], context[key], `Candidate ${key} changed`);
  assert.equal(candidate.nativeInputAdmissionSha256, nativeInputReceipt(archive).sha256, 'Candidate native input receipt changed');
  const verification = fs.readFileSync(path.join(archive, 'apk-verification.json'));
  assert.equal(candidate.verificationSha256, hash(verification), 'Candidate APK verification changed');
  const rows = (JSON.parse(verification.toString('utf8')) as ArchiveVerification).results;
  const manifest = readJson<Record<string, string>>(path.join(archive, 'apk-manifest.json'));
  const debugApks: Record<string, ApkDigest> = {};
  for (const variant of ['standalone', 'launcher']) {
    for (const mode of ['debug', 'release']) {
      const name = `${variant}-${mode === 'debug' ? 'debug' : 'release-unsigned'}.apk`;
      const row = rows.find(item => item.variant === variant && item.mode === mode && item.file === 'artifacts/' + name);
      const digest = updateArtifactDigest(path.join(archive, name));
      assert.ok(row && row.sha256 === digest.sha256 && manifest[name] === digest.sha256, 'Measured APK differs from the verified archive');
      const measured = {file: name, bytes: digest.size, sha256: digest.sha256};
      if (mode === 'debug') debugApks[variant] = measured;
      else assert.deepEqual(candidate.apks[variant], measured, 'Measured release APK differs from the candidate');
    }
  }
  const id = env.ALPHA_CANDIDATE_ARTIFACT_ID ?? '', digest = env.ALPHA_CANDIDATE_ARTIFACT_SHA256 ?? '';
  assert.ok(/^[1-9][0-9]{0,15}$/.test(id) && Number.isSafeInteger(Number(id)) && /^[0-9a-f]{64}$/.test(digest), 'Exact uploaded candidate artifact required');
  const metadata = api([`repos/${REPOSITORY}/actions/artifacts/${id}`]) as UploadedCandidate;
  const name = `app-native-candidate-${context.runNumber}-${context.sourceCommit}-${context.runId}-${context.runAttempt}`;
  assert.ok(metadata.id === Number(id) && metadata.name === name && metadata.digest === 'sha256:' + digest && metadata.expired === false &&
    metadata.workflow_run?.id === Number(context.runId) && metadata.workflow_run.head_sha === context.sourceCommit &&
    metadata.workflow_run.head_branch === 'main' && metadata.workflow_run.repository_id === REPOSITORY_ID &&
    metadata.workflow_run.head_repository_id === REPOSITORY_ID &&
    Number.isSafeInteger(metadata.size_in_bytes) && metadata.size_in_bytes > 0, 'Uploaded candidate artifact identity or size differs');
  let expandedBytes = 0, files = 0;
  function count(directory: string) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) count(file);
      else {
        assert.ok(entry.isFile(), 'Candidate archive must contain regular files');
        expandedBytes += fs.statSync(file).size;
        files++;
      }
    }
  }
  count(archive);
  assert.ok(Number.isSafeInteger(expandedBytes) && expandedBytes > 0);
  return {schema: 'alpha-app-candidate-archive-size/v1', ...context, artifactId: Number(id), artifactSha256: digest,
    candidateSha256: hash(candidateBytes), nativeInputAdmissionSha256: candidate.nativeInputAdmissionSha256,
    compressedBytes: metadata.size_in_bytes, expandedBytes, files, apks: candidate.apks, debugApks};
}

export async function main(argv: string[], {root = process.cwd(), env = process.env, api, read}: CandidateOptions = {}) {
  const [mode, destination, archive] = argv;
  assert.ok((mode === 'version' && argv.length === 2) || (['receipt', 'archive-size'].includes(mode) && argv.length === 3),
    'Use: app-update-candidate.ts version FILE | receipt VERSION_FILE ARCHIVE | archive-size FILE ARCHIVE');
  const file = path.resolve(root, mode === 'receipt' ? path.join(archive, 'app-update-candidate.json') : destination);
  assert.ok(file.startsWith(path.join(root, 'test-results') + path.sep), 'Candidate output must be under test-results');
  let result;
  if (mode === 'version') result = await candidateVersion({root, env, api, read});
  else if (mode === 'archive-size') result = candidateArchiveSize({root, env, api, archive});
  else {
    const admission = readJson<VersionAdmission>(path.resolve(root, destination));
    // The published floor may advance while this unsigned build is running.
    const finalAdmission = await candidateVersion({root, env, api, read});
    result = {...candidateReceipt({root, env, admission, archive}),
      finalObservedFloor: finalAdmission.observedFloor, finalManifestSha256: finalAdmission.manifestSha256};
  }
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {await main(process.argv.slice(2));}
  catch (error) {console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;}
}
