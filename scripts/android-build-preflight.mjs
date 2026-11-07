#!/usr/bin/env node
/**
 * Fail fast, before web sync and Gradle, when an Android build input is missing.
 *
 *   node scripts/android-build-preflight.mjs [--before-prepare] [--allow-unpackaged-runtime] [--test-mocks] [--allow-older-upstream-pin]
 *   node scripts/android-build-preflight.mjs --report [--json]     (npm run android:build:inputs)
 *
 * build-android.mjs runs the full check. `--before-prepare` checks only inputs that
 * android:build:local does not produce (the pinned checkout and the on-device voice outputs), so
 * that chain stops before the long runtime preparation instead of after it.
 * `--report` lists every input of the strict distribution build with its state and whether a
 * script or a person supplies it. It reads files only, builds nothing and always exits 0.
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyEmbeddingHost} from './stage-embedding-host.mjs';
import {VOICE_ASSET_ROOT, VOICE_HOST_MANIFEST, verifyVoiceHost} from './voice-host.mjs';
import {BUILD_TOOLCHAIN, HUMAN_ACTION, QUALIFIED_HOST, stagedLibraries} from './build-embedding-host.mjs';
import {verifyMobileBuildReceipt,MOBILE_UUID_POLICY} from './mobile-uuid-adapter.mjs';

export {VOICE_ASSET_ROOT, VOICE_HOST_MANIFEST};
export const GRADLE_VERIFICATION = 'android/gradle/verification-metadata.xml';
const FULL_CHAIN = 'npm run android:build:local';
const VOICE_GUIDE = 'docs/fused-speech.md';

function readHead(directory) {
  try {
    return execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return null;
  }
}

const MAIN_REFS = ['refs/remotes/origin/main', 'origin/main'];
export const ALLOW_OLDER_PIN = '--allow-older-upstream-pin';

const git = (directory, args) => execFileSync('git', ['-C', directory, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});

/**
 * Whether this branch's pin is the upstream pin on origin/main or a descendant of it. A branch
 * whose lock and checkout agree but pin an older upstream builds an agent that rejects the newer
 * state a device already holds, so a consistent pin is not enough.
 *   state: 'equal' | 'descendant' | 'older' | 'unknown' (main's pin is not in vendor/eliza)
 *        | 'shallow' (vendor/eliza history too short to decide) | 'unavailable' (no origin/main ref)
 */
export function mainPinStatus(root, pin) {
  let mainPin = null, ref = null;
  for (const candidate of MAIN_REFS) {
    try {
      mainPin = JSON.parse(git(root, ['show', `${candidate}:upstream.lock.json`])).commit;
      ref = candidate;
      break;
    } catch { /* try the next spelling of the ref */ }
  }
  if (typeof mainPin !== 'string' || !mainPin) return {state: 'unavailable', mainPin: null, ref: null};
  if (mainPin === pin) return {state: 'equal', mainPin, ref};
  const upstream = path.join(root, 'vendor/eliza');
  try { git(upstream, ['cat-file', '-e', `${mainPin}^{commit}`]); } catch { return {state: 'unknown', mainPin, ref}; }
  try {
    git(upstream, ['merge-base', '--is-ancestor', mainPin, pin]);
    return {state: 'descendant', mainPin, ref};
  } catch {
    let shallow = false;
    try { shallow = git(upstream, ['rev-parse', '--is-shallow-repository']).trim() === 'true'; } catch { /* treat as complete */ }
    return {state: shallow ? 'shallow' : 'older', mainPin, ref};
  }
}

/** The problem a non-descendant pin reports, or null. `notes` receives what was not checked. */
export function mainPinProblem(root, pin, {allowOlderUpstreamPin = false, notes = []} = {}) {
  const status = mainPinStatus(root, pin);
  const override = `Only a deliberate, reviewed upstream rollback may pass ${ALLOW_OLDER_PIN}.`;
  switch (status.state) {
    case 'unavailable':
      notes.push(`No origin/main ref in this clone, so the upstream pin ${pin} was not compared with main's (git fetch origin main to check it).`);
      return null;
    case 'older':
    case 'shallow':
      if (allowOlderUpstreamPin) {
        notes.push(`${ALLOW_OLDER_PIN}: building upstream pin ${pin}, which does not descend from ${status.ref}'s pin ${status.mainPin}.`);
        return null;
      }
      return status.state === 'older'
        ? `upstream.lock.json pins ${pin}, which is older than or diverged from the pin ${status.mainPin} on ${status.ref}; an APK from it can reject state written by the newer agent on a device. Run: git fetch origin && git rebase origin/main (or merge it), then git submodule update --init vendor/eliza. ${override}`
        : `vendor/eliza is a shallow clone, so it cannot show that the pin ${pin} descends from the pin ${status.mainPin} on ${status.ref}. Run: git -C vendor/eliza fetch --unshallow origin. ${override}`;
    case 'unknown':
      if (allowOlderUpstreamPin) {
        notes.push(`${ALLOW_OLDER_PIN}: ${status.ref}'s pin ${status.mainPin} is not in vendor/eliza; not compared.`);
        return null;
      }
      return `The upstream pin ${status.mainPin} on ${status.ref} is not in vendor/eliza, so the pin ${pin} cannot be shown to descend from it. Run: git -C vendor/eliza fetch origin. ${override}`;
    default:
      return null;
  }
}

/** Inputs no preparation step produces: the pinned checkout and the on-device voice outputs. */
export function checkoutProblems(root, {voiceHost = verifyVoiceHost, allowUnpackagedRuntime = false, runtimeProfile = "native", allowOlderUpstreamPin = false, notes = []} = {}) {
  const problems = [];
  const pin = JSON.parse(fs.readFileSync(path.join(root, 'upstream.lock.json'), 'utf8')).commit;
  const head = readHead(path.join(root, 'vendor/eliza'));
  if (head !== pin)
    problems.push(`vendor/eliza is ${head ? `at ${head}` : 'not checked out'}; upstream.lock.json pins ${pin}. Run: git submodule update --init vendor/eliza`);
  else {
    const older = mainPinProblem(root, pin, {allowOlderUpstreamPin, notes});
    if (older) problems.push(older);
  }
  if(runtimeProfile !== "cloud") problems.push(...voiceHostProblems(root, {voiceHost, allowUnpackagedRuntime}));
  return problems;
}

/**
 * The on-device voice outputs (libelizainference with the shared paradee-voice library: Paradee TTS,
 * misaki G2P, the ASR slot pair, Silero VAD) in .eliza/paradee-voice/native. A distribution build
 * needs them (speech is on-device only); the explicit unpackaged developer lane may omit them, and
 * local speech then reports unavailable. Staged outputs must match
 * android/voice-host/qualified-voice-host.json byte for byte (Gradle :app:verifyVoiceHost).
 */
export function voiceHostProblems(root, {allowUnpackagedRuntime = false, voiceHost = verifyVoiceHost} = {}) {
  try {
    voiceHost(root, {allowAbsentRuntime: allowUnpackagedRuntime});
    return [];
  } catch (error) {
    return [`The on-device voice outputs in ${VOICE_ASSET_ROOT} are not admitted by ${VOICE_HOST_MANIFEST} (${error.message}; Gradle :app:verifyVoiceHost rejects the build). ${FULL_CHAIN} does not produce them: stage them with node scripts/android-stage-voice-models.mjs --from <directory of the recorded voice outputs and models> (see ${VOICE_GUIDE}).`];
  }
}

/**
 * Prepared runtime inputs. `preparedSource` is the resolved prepared runtime
 * directory (sourceDirectory()). Distribution builds also need the staged runtime.
 */
export function preparedRuntimeProblems(root, preparedSource, {allowUnpackagedRuntime = false, testMocks = false, embeddingHost = verifyEmbeddingHost, googleHost = verifyStagedGoogleHost, runtimeProfile = "native", localEmbeddings = false} = {}) {
  if(runtimeProfile === "cloud") {
    if(allowUnpackagedRuntime || testMocks) return ["Cloud profile requires a genuine packaged resident and test mocks off"];
    try { execFileSync(process.execPath,[path.join(root,'scripts/runtime-profile.mjs'),'--verify-cloud',...(localEmbeddings?['--local-embeddings']:[])],{cwd:root,env:{...process.env,ALPHA_LOCAL_AGENT_SOURCE_DIR:preparedSource},stdio:['ignore','pipe','pipe']}); return []; } catch(error) { return [error.message]; }
  }
  const stamp = path.join(preparedSource, '.alpha-runtime-source.json');
  if (!fs.existsSync(stamp))
    return [`Prepared runtime source ${path.relative(root, preparedSource)} is missing (Gradle :app:stageLocalAgentSources reads it). Run: ${FULL_CHAIN} for distributable APKs, or npm run agent:prepare before npm run android:build -- --allow-unpackaged-runtime for developer APKs.`];
  // Gradle's :app:verifyEmbeddingHost runs for every build. Only the explicit unpackaged
  // developer build may omit the host, and only when no resident payload is staged at all.
  const embedding = embeddingHostProblems(root, {allowUnpackagedRuntime, embeddingHost});
  if (allowUnpackagedRuntime || testMocks) return embedding;
  const staged = path.join(root, 'android/app/src/main/assets/agent/alpha-source.json');
  const worker = path.join(root, 'android/app/src/main/assets/agent/workflow-worker/manifest.json');
  if (!fs.existsSync(staged) || !fs.existsSync(worker))
    return [`The resident runtime is not staged, so release APKs would not be distributable. Run: npm run agent:build-workflow-worker && npm run agent:stage-android (or ${FULL_CHAIN}), or pass -- --allow-unpackaged-runtime for non-distributable developer APKs.`, ...embedding];
  if (fs.readFileSync(staged, 'utf8') !== fs.readFileSync(stamp, 'utf8'))
    return [`The staged resident runtime was built from a different prepared source than ${path.relative(root, preparedSource)}. Run: npm run agent:build-workflow-worker && npm run agent:stage-android (or ${FULL_CHAIN}).`, ...embedding];
  if(fs.existsSync(path.join(root,MOBILE_UUID_POLICY))){
    try{verifyMobileBuildReceipt(root,preparedSource,path.dirname(staged));}
    catch(error){return [`The staged resident build producer is not admitted (${error.message}). Run: npm run agent:stage-android.`,...embedding];}
  }
  // The in-process Google host is built from product sources the upstream stamp does not cover.
  try { googleHost(root, preparedSource); }
  catch (error) { return [`The staged native Google host is not current (${error.message}; Gradle :app:verifyNativeGoogleHost rejects the build). Run: npm run agent:build-workflow-worker && npm run agent:stage-android (or ${FULL_CHAIN}).`, ...embedding]; }
  return embedding;
}

/** Runs scripts/runtime-profile.mjs --verify-native, the same check Gradle runs. */
function verifyStagedGoogleHost(root, preparedSource) {
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts/runtime-profile.mjs'), '--verify-native'], {cwd: root, env: {...process.env, ALPHA_LOCAL_AGENT_SOURCE_DIR: preparedSource}, stdio: ['ignore', 'pipe', 'pipe']});
  } catch (error) {
    throw new Error(String(error.stderr ?? '').match(/^Error: (.*)$/m)?.[1] ?? error.message);
  }
}

/**
 * The reviewed ARM64 embedding host (android/embedding-host/qualified-host.json). Its libraries
 * are staged byte for byte: by `npm run agent:build-embedding-host` when a rebuild reproduces
 * them, otherwise by a person from the qualification receipt.
 */
export function embeddingHostProblems(root, {allowUnpackagedRuntime = false, embeddingHost = verifyEmbeddingHost} = {}) {
  try {
    embeddingHost(root, {allowAbsentRuntime: allowUnpackagedRuntime});
    return [];
  } catch (error) {
    const partial = allowUnpackagedRuntime
      ? ' An unpackaged developer build must have no resident payload at all: remove android/app/src/main/assets/agent and android/app/src/main/jniLibs, or stage the host.'
      : '';
    return [`The qualified embedding host is not staged (${error.message}; Gradle :app:verifyEmbeddingHost rejects the build). npm run agent:build-embedding-host (a step of ${FULL_CHAIN}) stages the libraries only when it can reproduce the reviewed bytes, and says so when it cannot. ${HUMAN_ACTION}${partial}`];
  }
}

export function formatProblems(problems) {
  return `Android build prerequisites are missing:\n${problems.map(problem => `  - ${problem}`).join('\n')}`;
}

const SIGNING_ENV = ['ELIZAOS_KEYSTORE_PATH', 'ELIZAOS_KEYSTORE_PASSWORD', 'ELIZAOS_KEY_ALIAS', 'ELIZAOS_KEY_PASSWORD'];
const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

/**
 * Every input of the strict distribution build (`npm run android:build:local` with no override),
 * in the order the chain needs it. `suppliedBy` is 'script' when a committed command produces the
 * input from pinned source and 'person' when no script may. `preparedSource` is null while the
 * pinned checkout is absent (its location cannot be resolved then).
 */
export function strictBuildInputs(root, preparedSource, {env = process.env, voiceHost = verifyVoiceHost} = {}) {
  const rows = [];
  const add = (input, ok, suppliedBy, detail, action) => rows.push({input, state: ok ? 'ready' : 'missing', suppliedBy, detail, action: ok ? null : action});
  const pin = readJson(root, 'upstream.lock.json').commit;
  const head = readHead(path.join(root, 'vendor/eliza'));
  // The checkout must match the lock, and the lock must not pin an upstream older than main's.
  const notes = [];
  const older = head === pin ? mainPinProblem(root, pin, {notes}) : null;
  add('pinned upstream checkout', head === pin && !older, 'script',
    [`vendor/eliza ${head ? `at ${head}` : 'not checked out'}; pin ${pin}`, ...(older ? [older] : notes)].join('; '),
    older ? 'Rebase on origin/main (or fetch vendor/eliza), then git submodule update --init vendor/eliza' : 'git submodule update --init vendor/eliza');

  // On-device voice is the only speech route: a distribution build needs the staged outputs, and
  // verify-apks records a release without a qualified voice host as distributable:false.
  let voiceStatus = null;
  const voice = voiceHostProblems(root, {voiceHost: (...args) => { voiceStatus = voiceHost(...args); return voiceStatus; }});
  add('on-device voice outputs', voice.length === 0, 'person',
    voice.length ? voice[0] : `staged outputs match ${VOICE_HOST_MANIFEST}`,
    `Needs a person to supply the recorded voice outputs and models: node scripts/android-stage-voice-models.mjs --from <directory> (see ${VOICE_GUIDE}; docs/human-actions.md H-18).`);
  add('on-device voice qualified', voiceStatus?.qualified === true, 'person',
    voiceStatus?.qualified === true ? `${VOICE_HOST_MANIFEST} records device qualification` : `${VOICE_HOST_MANIFEST} is not qualified (no device acceptance recorded)`,
    'Needs a person: on-device qualification on both ABIs (packages/app/scripts/paradee-voice/qualify) and device acceptance, recorded by a named reviewer (docs/human-actions.md H-18).');

  const host = readJson(root, QUALIFIED_HOST), toolchain = readJson(root, BUILD_TOOLCHAIN);
  const libraries = stagedLibraries(root, host);
  const hostReady = libraries.every(row => row.state === 'staged');
  const reproducible = toolchain.remapBuildPath === true;
  add('embedding host libraries', hostReady, reproducible ? 'script' : 'person',
    hostReady ? `reviewed bytes staged in android/app/src/main/jniLibs/${host.abi}` : libraries.filter(row => row.state !== 'staged').map(row => `${row.name} ${row.state === 'missing' ? 'missing' : 'is not the reviewed bytes'}`).join(', '),
    reproducible ? 'npm run agent:build-embedding-host' : `${HUMAN_ACTION} (${toolchain.remapBuildPathEvidence})`);

  const stamp = preparedSource ? path.join(preparedSource, '.alpha-runtime-source.json') : null;
  const prepared = stamp !== null && fs.existsSync(stamp);
  add('prepared resident runtime source', prepared, 'script', preparedSource ? path.relative(root, preparedSource) : 'needs the pinned checkout first', 'npm run agent:prepare');
  const worker = path.join(root, 'artifacts', `mobile-workflow-worker-${pin}`, 'manifest.json');
  add('workflow worker artifact', fs.existsSync(worker), 'script', path.relative(root, path.dirname(worker)), 'npm run agent:build-workflow-worker');
  const staged = path.join(root, 'android/app/src/main/assets/agent/alpha-source.json');
  const stagedWorker = path.join(root, 'android/app/src/main/assets/agent/workflow-worker/manifest.json');
  const current = prepared && fs.existsSync(staged) && fs.existsSync(stagedWorker) && fs.readFileSync(staged, 'utf8') === fs.readFileSync(stamp, 'utf8');
  add('staged resident runtime payload', current, 'script', !fs.existsSync(staged) ? 'android/app/src/main/assets/agent is not staged' : current ? 'staged from the prepared source' : 'staged from a different prepared source', 'npm run agent:stage-android');
  const model = path.join(root, host.model.path);
  add('embedding model', fs.existsSync(model), 'script', host.model.path, 'npm run agent:stage-android (it stages the pinned model with the payload)');
  add('Gradle dependency verification metadata', fs.existsSync(path.join(root, GRADLE_VERIFICATION)), 'script', GRADLE_VERIFICATION, 'npm run android:deps:write-verification (then review the diff)');

  const signer = readJson(root, 'android/release-signer.json').signerSha256;
  const missingSigning = SIGNING_ENV.filter(name => !(typeof env[name] === 'string' && env[name].trim() !== ''));
  add('release signer', signer !== 'unset' && missingSigning.length === 0, 'person',
    [signer === 'unset' ? 'android/release-signer.json says unset' : `android/release-signer.json names ${signer}`, missingSigning.length ? `not set in this environment: ${missingSigning.join(', ')}` : 'signing variables are set'].join('; '),
    'Needs a person: Alpha Compute controls signing and Shaw owns release/support/rollback (#400). After the offline key ceremony, node scripts/enroll-release-keys.mjs records the certificate digest in android/release-signer.json (docs/human-actions.md H-08, H-09); then the release operator either supplies ELIZAOS_KEYSTORE_PATH, ELIZAOS_KEYSTORE_PASSWORD, ELIZAOS_KEY_ALIAS and ELIZAOS_KEY_PASSWORD to the build or signs the unsigned releases afterwards with node scripts/sign-release-apks.mjs (ceremony key files or a PKCS#11 token; H-10). Without either the build still completes and records unsigned, non-distributable releases.');
  return rows;
}

export function formatReport(rows) {
  const lines = rows.map(row => `${row.state === 'ready' ? '[ready]  ' : row.suppliedBy === 'person' ? '[PERSON] ' : '[script] '}${row.input}: ${row.detail}${row.action ? `\n          -> ${row.action}` : ''}`);
  const open = rows.filter(row => row.state !== 'ready');
  const person = open.filter(row => row.suppliedBy === 'person'), script = open.filter(row => row.suppliedBy === 'script');
  lines.push('', open.length === 0 ? 'Every strict-build input is present. This is an input check, not a build or a distributable APK.'
    : `${script.length} input(s) a script can produce: ${script.map(row => row.input).join(', ') || 'none'}.\n${person.length} input(s) only a person can supply: ${person.map(row => row.input).join(', ') || 'none'}.`);
  // The embedding host stops the chain; an unset signer does not stop it, it makes the chain's releases non-distributable.
  const stopper = open.find(row => row.input === 'embedding host libraries' && row.suppliedBy === 'person');
  if (stopper) lines.push('The chain cannot pass Gradle :app:verifyEmbeddingHost until a person supplies the embedding host libraries.');
  if (person.some(row => row.input === 'release signer')) lines.push('An unset release signer does not stop the build: verify-apks records its releases distributable:false and names them.');
  if (person.some(row => row.input === 'on-device voice outputs')) lines.push('Missing or changed voice outputs stop Gradle :app:verifyVoiceHost in a distribution build; an unqualified voice host makes its releases distributable:false.');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  for (const arg of args)
    if (!['--before-prepare', '--allow-unpackaged-runtime', '--test-mocks', '--report', '--json', '--runtime-profile=cloud','--local-embeddings', ALLOW_OLDER_PIN].includes(arg)) throw new Error(`Unknown option ${arg}`);
  const root = path.resolve(import.meta.dirname, '..');
  if (args.includes('--report')) {
    // The source guard imports the pinned checkout; without it the prepared path is unknown.
    let prepared = null;
    try { prepared = (await import('./local-agent-source.mjs')).sourceDirectory(root); } catch { /* reported as the missing checkout */ }
    const rows = strictBuildInputs(root, prepared);
    console.log(args.includes('--json') ? JSON.stringify(rows, null, 2) : formatReport(rows));
    return;
  }
  const runtimeProfile=args.includes('--runtime-profile=cloud')?'cloud':'native';
  if(args.includes('--local-embeddings')&&runtimeProfile!=='cloud')throw Error('--local-embeddings requires the Cloud profile');
  const notes = [];
  let problems = checkoutProblems(root,{allowUnpackagedRuntime:args.includes('--allow-unpackaged-runtime'),runtimeProfile,allowOlderUpstreamPin:args.includes(ALLOW_OLDER_PIN),notes});
  for (const note of notes) console.error(`Note: ${note}`);
  if (!problems.length && !args.includes('--before-prepare')) {
    // The source guard imports the pinned checkout, so load it only once that is verified.
    const {sourceDirectory} = await import('./local-agent-source.mjs');
    problems = [...preparedRuntimeProblems(root, sourceDirectory(root), {
      allowUnpackagedRuntime: args.includes('--allow-unpackaged-runtime'),
      testMocks: args.includes('--test-mocks'),runtimeProfile,localEmbeddings:args.includes('--local-embeddings'),
    })];
  }
  if (problems.length) {
    console.error(formatProblems(problems));
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
