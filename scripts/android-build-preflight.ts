#!/usr/bin/env bun
/**
 * Fail fast, before web sync and Gradle, when an Android build input is missing.
 *
 *   bun scripts/android-build-preflight.ts [--before-prepare] [--allow-unpackaged-runtime] [--test-mocks]
 *   bun scripts/android-build-preflight.ts --report     (bun run android:build:inputs)
 *
 * build-android.ts runs the full check. `--before-prepare` checks only inputs that
 * android:build:local does not produce (the pinned checkout and the on-device voice outputs), so
 * that chain stops before the long runtime preparation instead of after it.
 * `--report` lists every input of the strict distribution build with its state and whether a
 * script or a person supplies it. It reads files only, builds nothing and always exits 0.
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyEmbeddingHost} from './stage-embedding-host.ts';
import {VOICE_ASSET_ROOT, VOICE_HOST_MANIFEST, verifyVoiceHost} from './voice-host.ts';
import {BUILD_TOOLCHAIN, QUALIFIED_HOST, embeddingHostState, stagedLibraries} from './build-embedding-host.ts';
import {verifyMobileBuildReceipt,MOBILE_UUID_POLICY} from './mobile-uuid-adapter.ts';
import {readNativeBuildReceipt} from './native-build-inputs.ts';

export {VOICE_ASSET_ROOT, VOICE_HOST_MANIFEST};
export const GRADLE_VERIFICATION = 'android/gradle/verification-metadata.xml';
const FULL_CHAIN = 'bun run android:build:local';
const VOICE_GUIDE = 'README.md';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

type VoiceHostVerifier = (root: string, options: {allowAbsentRuntime: boolean}) => {qualified: boolean};
type EmbeddingHostVerifier = (root: string, options: {allowAbsentRuntime: boolean}) => unknown;
interface PinOptions {
  notes?: string[];
}
interface VoiceOptions {
  allowUnpackagedRuntime?: boolean;
  voiceHost?: VoiceHostVerifier;
}
interface RuntimeOptions {
  allowUnpackagedRuntime?: boolean;
  testMocks?: boolean;
  embeddingHost?: EmbeddingHostVerifier;
  googleHost?: (root: string, preparedSource: string) => unknown;
}
interface InputReportOptions {
  env?: NodeJS.ProcessEnv;
  voiceHost?: VoiceHostVerifier;
  workerDirectory?: string;
}
interface InputReportRow {
  input: string;
  state: 'ready' | 'missing';
  suppliedBy: 'person' | 'script';
  detail: string;
  action: string | null;
}

function readHead(directory: string) {
  try {
    return execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return null;
  }
}

const MAIN_REFS = ['refs/remotes/origin/main', 'origin/main'];

const git = (directory: string, args: string[]) => execFileSync('git', ['-C', directory, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});

/**
 * Whether this branch's pin is the upstream pin on origin/main or a descendant of it. A branch
 * whose lock and checkout agree but pin an older upstream builds an agent that rejects the newer
 * state a device already holds, so a consistent pin is not enough.
 *   state: 'equal' | 'descendant' | 'older' | 'unknown' (main's pin is not in vendor/eliza)
 *        | 'shallow' (vendor/eliza history too short to decide) | 'unavailable' (no origin/main ref)
 */
export function mainPinStatus(root: string, pin: string) {
  let mainPin: unknown = null, ref: string | null = null;
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
export function mainPinProblem(root: string, pin: string, {notes = []}: PinOptions = {}) {
  const status = mainPinStatus(root, pin);
  switch (status.state) {
    case 'unavailable':
      notes.push(`No origin/main ref in this clone, so the upstream pin ${pin} was not compared with main's (git fetch origin main to check it).`);
      return null;
    case 'older':
    case 'shallow':
      return status.state === 'older'
        ? `upstream.lock.json pins ${pin}, which is older than or diverged from the pin ${status.mainPin} on ${status.ref}; an APK from it can reject state written by the newer agent on a device. Run: git fetch origin && git rebase origin/main (or merge it), then git submodule update --init vendor/eliza.`
        : `vendor/eliza is a shallow clone, so it cannot show that the pin ${pin} descends from the pin ${status.mainPin} on ${status.ref}. Run: git -C vendor/eliza fetch --unshallow origin.`;
    case 'unknown':
      return `The upstream pin ${status.mainPin} on ${status.ref} is not in vendor/eliza, so the pin ${pin} cannot be shown to descend from it. Run: git -C vendor/eliza fetch origin.`;
    default:
      return null;
  }
}

/** Inputs no preparation step produces: the pinned checkout and the on-device voice outputs. */
export function checkoutProblems(root: string, {voiceHost = verifyVoiceHost, allowUnpackagedRuntime = false, notes = []}: VoiceOptions & PinOptions = {}) {
  const problems: string[] = [];
  const pin = JSON.parse(fs.readFileSync(path.join(root, 'upstream.lock.json'), 'utf8')).commit;
  const head = readHead(path.join(root, 'vendor/eliza'));
  if (head !== pin)
    problems.push(`vendor/eliza is ${head ? `at ${head}` : 'not checked out'}; upstream.lock.json pins ${pin}. Run: git submodule update --init vendor/eliza`);
  else {
    const older = mainPinProblem(root, pin, {notes});
    if (older) problems.push(older);
  }
  problems.push(...voiceHostProblems(root, {voiceHost, allowUnpackagedRuntime}));
  return problems;
}

/**
 * The on-device voice outputs (libelizainference with the shared paradee-voice library: Paradee TTS,
 * misaki G2P, the ASR slot pair, Silero VAD) in .eliza/paradee-voice/native. A distribution build
 * needs them (speech is on-device only); the explicit unpackaged developer lane may omit them, and
 * local speech then reports unavailable. Staged outputs must match
 * android/voice-host/qualified-voice-host.json byte for byte (Gradle :app:verifyVoiceHost).
 */
export function voiceHostProblems(root: string, options: VoiceOptions = {}): string[] {
  return assessVoiceHost(root, options).problems;
}

function assessVoiceHost(root: string, {allowUnpackagedRuntime = false, voiceHost = verifyVoiceHost}: VoiceOptions) {
  try {
    return {status: voiceHost(root, {allowAbsentRuntime: allowUnpackagedRuntime}), problems: []};
  } catch (error) {
    return {status: null, problems: [`The on-device voice outputs in ${VOICE_ASSET_ROOT} are not admitted by ${VOICE_HOST_MANIFEST} (${message(error)}; Gradle :app:verifyVoiceHost rejects the build). ${FULL_CHAIN} produces them automatically from pinned public source and model inputs; run bun run agent:build-embedding-host to prepare the native cache.`]};
  }
}

/**
 * Prepared runtime inputs. `preparedSource` is the resolved prepared runtime
 * directory (sourceDirectory()). Distribution builds also need the staged runtime.
 */
export function preparedRuntimeProblems(root: string, preparedSource: string, {allowUnpackagedRuntime = false, testMocks = false, embeddingHost = verifyEmbeddingHost, googleHost = verifyStagedGoogleHost}: RuntimeOptions = {}): string[] {
  const stamp = path.join(preparedSource, '.alpha-runtime-source.json');
  if (!fs.existsSync(stamp))
    return [`Prepared runtime source ${path.relative(root, preparedSource)} is missing (Gradle :app:stageLocalAgentSources reads it). Run: ${FULL_CHAIN} for distributable APKs, or bun run agent:prepare before bun run android:build -- --allow-unpackaged-runtime for developer APKs.`];
  // Gradle's :app:verifyEmbeddingHost runs for every build. Only the explicit unpackaged
  // developer build may omit the host, and only when no resident payload is staged at all.
  const embedding = embeddingHostProblems(root, {allowUnpackagedRuntime, embeddingHost});
  if (allowUnpackagedRuntime || testMocks) return embedding;
  const staged = path.join(root, 'android/app/src/main/assets/agent/alpha-source.json');
  const worker = path.join(root, 'android/app/src/main/assets/agent/workflow-worker/manifest.json');
  if (!fs.existsSync(staged) || !fs.existsSync(worker))
    return [`The resident runtime is not staged, so release APKs would not be distributable. Run: bun run agent:build-workflow-worker && bun run agent:stage-android (or ${FULL_CHAIN}), or pass -- --allow-unpackaged-runtime for non-distributable developer APKs.`, ...embedding];
  if (fs.readFileSync(staged, 'utf8') !== fs.readFileSync(stamp, 'utf8'))
    return [`The staged resident runtime was built from a different prepared source than ${path.relative(root, preparedSource)}. Run: bun run agent:build-workflow-worker && bun run agent:stage-android (or ${FULL_CHAIN}).`, ...embedding];
  // agent:stage-android writes the profile marker; a payload staged for the removed Cloud
  // profile omitted the local embedding model and is refused.
  const marker = path.join(path.dirname(staged), 'alpha-runtime-profile.json');
  let profile: {version?: unknown; runtimeProfile?: unknown} | null = null;
  try { profile = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch {}
  if (JSON.stringify(profile) !== JSON.stringify({version: 1, runtimeProfile: 'native'}))
    return [`The staged resident runtime is not the native profile (${path.relative(root, marker)} ${profile ? `names ${JSON.stringify(profile.runtimeProfile)}` : 'is missing or unreadable'}). Run: bun run agent:stage-android (or ${FULL_CHAIN}).`, ...embedding];
  if(fs.existsSync(path.join(root,MOBILE_UUID_POLICY))){
    try{verifyMobileBuildReceipt(root,preparedSource,path.dirname(staged));}
    catch(error){return [`The staged resident build producer is not admitted (${message(error)}). Run: bun run agent:stage-android.`,...embedding];}
  }
  // The in-process Google host is built from product sources the upstream stamp does not cover.
  try { googleHost(root, preparedSource); }
  catch (error) { return [`The staged native Google host is not current (${message(error)}; Gradle :app:verifyNativeGoogleHost rejects the build). Run: bun run agent:build-workflow-worker && bun run agent:stage-android (or ${FULL_CHAIN}).`, ...embedding]; }
  return embedding;
}

/** Runs scripts/runtime-profile.ts --verify-native, the same check Gradle runs. */
function verifyStagedGoogleHost(root: string, preparedSource: string) {
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts/runtime-profile.ts'), '--verify-native'], {cwd: root, env: {...process.env, ALPHA_LOCAL_AGENT_SOURCE_DIR: preparedSource}, stdio: ['ignore', 'pipe', 'pipe']});
  } catch (error) {
    throw new Error(String(error instanceof Error && 'stderr' in error ? error.stderr ?? '' : '').match(/^Error: (.*)$/m)?.[1] ?? message(error));
  }
}

/**
 * The reviewed ARM64 embedding host (android/embedding-host/qualified-host.json). Its libraries
 * are staged byte for byte: by `bun run agent:build-embedding-host` when a rebuild reproduces
 * them, or by staging a verified build receipt.
 */
export function embeddingHostProblems(root: string, {allowUnpackagedRuntime = false, embeddingHost = verifyEmbeddingHost}: Pick<RuntimeOptions, "allowUnpackagedRuntime" | "embeddingHost"> = {}): string[] {
  try {
    embeddingHost(root, {allowAbsentRuntime: allowUnpackagedRuntime});
    return [];
  } catch (error) {
    const partial = allowUnpackagedRuntime
      ? ' An unpackaged developer build must have no resident payload at all: remove android/app/src/main/assets/agent, android/app/src/main/jniLibs and .eliza/paradee-voice/native (its staged voice outputs keep :app:verifyParadeeAppLinkage checking jniLibs), or stage the host.'
      : '';
    return [`The qualified embedding host is not staged (${message(error)}; Gradle :app:verifyEmbeddingHost rejects the build). bun run agent:build-embedding-host (a step of ${FULL_CHAIN}) downloads pinned inputs, builds the libraries and verifies generated source/output receipts. ${partial}`];
  }
}

export function formatProblems(problems: readonly string[]) {
  return `Android build prerequisites are missing:\n${problems.map(problem => `  - ${problem}`).join('\n')}`;
}

const SIGNING_ENV = ['ELIZAOS_KEYSTORE_PATH', 'ELIZAOS_KEYSTORE_PASSWORD', 'ELIZAOS_KEY_ALIAS', 'ELIZAOS_KEY_PASSWORD'];
const readJson = (root: string, rel: string) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

/**
 * Every input of the strict distribution build (`bun run android:build:local` with no override),
 * in the order the chain needs it. `suppliedBy` is 'script' when a committed command produces the
 * input from pinned source and 'person' when no script may. `preparedSource` is null while the
 * pinned checkout is absent (its location cannot be resolved then).
 */
export function strictBuildInputs(root: string, preparedSource: string | null, {env = process.env, voiceHost = verifyVoiceHost, workerDirectory}: InputReportOptions = {}) {
  const rows: InputReportRow[] = [];
  const add = (input: string, ok: boolean, suppliedBy: InputReportRow["suppliedBy"], detail: string, action: string) => rows.push({input, state: ok ? 'ready' : 'missing', suppliedBy, detail, action: ok ? null : action});
  const pin = readJson(root, 'upstream.lock.json').commit;
  const head = readHead(path.join(root, 'vendor/eliza'));
  // The checkout must match the lock, and the lock must not pin an upstream older than main's.
  const notes: string[] = [];
  const older = head === pin ? mainPinProblem(root, pin, {notes}) : null;
  add('pinned upstream checkout', head === pin && !older, 'script',
    [`vendor/eliza ${head ? `at ${head}` : 'not checked out'}; pin ${pin}`, ...(older ? [older] : notes)].join('; '),
    older ? 'Rebase on origin/main (or fetch vendor/eliza), then git submodule update --init vendor/eliza' : 'git submodule update --init vendor/eliza');

  // Every distribution build packages on-device speech and the embedding host.
  {
    const {status: voiceStatus, problems: voice} = assessVoiceHost(root, {voiceHost});
    add('on-device voice outputs', voice.length === 0, 'script',
      voice.length ? voice[0] : `staged outputs match ${VOICE_HOST_MANIFEST}`,
      'bun run agent:build-embedding-host (downloads pinned public sources, builds and caches voice and embedding inputs)');

  }

  {
    let host;
    try{host=readNativeBuildReceipt(root)?.embedding;}catch{/* A stale generated receipt is a missing input, not a broken report. */}
    host??=readJson(root,QUALIFIED_HOST);
    const toolchain = readJson(root, BUILD_TOOLCHAIN);
    const libraries = stagedLibraries(root, host);
    const hostState = embeddingHostState(host, toolchain, libraries);
    add('embedding host libraries', hostState.ready, hostState.suppliedBy,
      hostState.ready ? `reviewed bytes staged in android/app/src/main/jniLibs/${host.abi}` : libraries.filter(row => row.state !== 'staged').map(row => `${row.name} ${row.state === 'missing' ? 'missing' : 'is not the reviewed bytes'}`).join(', '),
      'bun run agent:build-embedding-host');
  }

  const stamp = preparedSource ? path.join(preparedSource, '.alpha-runtime-source.json') : null;
  const prepared = stamp !== null && fs.existsSync(stamp);
  add('prepared resident runtime source', prepared, 'script', preparedSource ? path.relative(root, preparedSource) : 'needs the pinned checkout first', 'bun run agent:prepare');
  const worker = path.join(workerDirectory || path.join(root, 'artifacts', `mobile-workflow-worker-${pin}`), 'manifest.json');
  add('workflow worker artifact', fs.existsSync(worker), 'script', path.relative(root, path.dirname(worker)), 'bun run agent:build-workflow-worker');
  const staged = path.join(root, 'android/app/src/main/assets/agent/alpha-source.json');
  const stagedWorker = path.join(root, 'android/app/src/main/assets/agent/workflow-worker/manifest.json');
  const current = prepared && fs.existsSync(staged) && fs.existsSync(stagedWorker) && fs.readFileSync(staged, 'utf8') === fs.readFileSync(stamp, 'utf8');
  add('staged resident runtime payload', current, 'script', !fs.existsSync(staged) ? 'android/app/src/main/assets/agent is not staged' : current ? 'staged from the prepared source' : 'staged from a different prepared source', 'bun run agent:stage-android');
  {
    const host = readJson(root, QUALIFIED_HOST), model = path.join(root, host.model.path);
    add('embedding model', fs.existsSync(model), 'script', host.model.path, 'bun run agent:stage-android (it stages the pinned model with the payload)');
  }
  add('Gradle dependency verification metadata', fs.existsSync(path.join(root, GRADLE_VERIFICATION)), 'script', GRADLE_VERIFICATION, 'bun run android:deps:write-verification (then review the diff)');

  const signer = readJson(root, 'android/release-signer.json').signerSha256;
  const missingSigning = SIGNING_ENV.filter(name => {
    const value = env[name];
    return typeof value !== 'string' || !value.trim();
  });
  add('release signer', signer !== 'unset' && missingSigning.length === 0, 'person',
    [signer === 'unset' ? 'android/release-signer.json says unset' : `android/release-signer.json names ${signer}`, missingSigning.length ? `not set in this environment: ${missingSigning.join(', ')}` : 'signing variables are set'].join('; '),
    'Needs a person: Alpha Compute controls signing and Shaw owns release/support/rollback (#400). After the offline key ceremony, bun scripts/enroll-release-keys.ts records the certificate digest in android/release-signer.json; then the release operator either supplies ELIZAOS_KEYSTORE_PATH, ELIZAOS_KEYSTORE_PASSWORD, ELIZAOS_KEY_ALIAS and ELIZAOS_KEY_PASSWORD to the build or signs the unsigned releases afterwards with bun scripts/sign-release-apks.ts (ceremony key files or a PKCS#11 token; H-10). Without either the build still completes and records unsigned, non-distributable releases.');
  return rows;
}

export function formatReport(rows: readonly InputReportRow[]) {
  const lines = rows.map(row => `${row.state === 'ready' ? '[ready]  ' : row.suppliedBy === 'person' ? '[PERSON] ' : '[script] '}${row.input}: ${row.detail}${row.action ? `\n          -> ${row.action}` : ''}`);
  const open = rows.filter(row => row.state !== 'ready');
  const person = open.filter(row => row.suppliedBy === 'person'), script = open.filter(row => row.suppliedBy === 'script');
  lines.push('', open.length === 0 ? 'Every strict-build input is present. This is an input check, not a build or a distributable APK.'
    : `${script.length} input(s) a script can produce: ${script.map(row => row.input).join(', ') || 'none'}.\n${person.length} input(s) only a person can supply: ${person.map(row => row.input).join(', ') || 'none'}.`);
  if (person.some(row => row.input === 'release signer')) lines.push('An unset release signer does not stop the build: verify-apks records its releases distributable:false and names them.');
  if (person.some(row => row.input === 'on-device voice outputs')) lines.push('Missing or changed voice outputs stop Gradle :app:verifyVoiceHost in a distribution build.');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  for (const arg of args)
    if (!['--before-prepare', '--allow-unpackaged-runtime', '--test-mocks', '--report'].includes(arg)) throw new Error(`Unknown option ${arg}`);
  const root = path.resolve(import.meta.dirname, '..');
  if (args.includes('--report')) {
    // The source guard imports the pinned checkout; without it the prepared path is unknown.
    let prepared: string | null = null, workerDirectory: string | undefined;
    try { const source = await import('./local-agent-source.ts'); prepared = source.sourceDirectory(root); workerDirectory = source.workerArtifactDirectory(root); } catch { /* reported as the missing checkout */ }
    console.log(formatReport(strictBuildInputs(root, prepared, {workerDirectory})));
    return;
  }
  const notes: string[] = [];
  if(!args.includes('--allow-unpackaged-runtime')&&readHead(path.join(root,'vendor/eliza'))===readJson(root,'upstream.lock.json').commit) {
    const {preparePortableNativeInputs}=await import('./build-embedding-host.ts');
    await preparePortableNativeInputs(root);
  }
  let problems = checkoutProblems(root,{allowUnpackagedRuntime:args.includes('--allow-unpackaged-runtime'),notes});
  for (const note of notes) console.error(`Note: ${note}`);
  if (!problems.length && !args.includes('--before-prepare')) {
    // The source guard imports the pinned checkout, so load it only once that is verified.
    const {sourceDirectory} = await import('./local-agent-source.ts');
    problems = [...preparedRuntimeProblems(root, sourceDirectory(root), {
      allowUnpackagedRuntime: args.includes('--allow-unpackaged-runtime'),
      testMocks: args.includes('--test-mocks'),
    })];
  }
  if (problems.length) {
    console.error(formatProblems(problems));
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
