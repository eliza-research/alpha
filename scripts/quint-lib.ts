import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_STATE_MANIFEST, coreStateRequiredTargets, verifyCoreStateBuildRecord } from './core-state-patch.ts';

export const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const quintRoot = join(repositoryRoot, 'specs/quint');
export const sourceRoots = ['apps/app/src', 'apps/app/public', 'backend', 'android'];
export const runtimeScriptPaths = ['scripts/browser-cloud-dev-bridge.ts', 'scripts/cloud-resident-host.ts',
  'scripts/cloud-email-code.ts', 'scripts/private-runtime-launch.ts', 'scripts/dev-agent.ts', 'scripts/dev-cloud.ts', 'scripts/dev-local.ts',
  'scripts/start-local-agent.ts', 'scripts/start-local-voice-agent.ts', 'scripts/start-local-remote.ts',
  'scripts/core-state-patch.ts', 'scripts/core-state-preload.ts', 'scripts/start-reviewed-workflow-agent.ts',
  'scripts/start-cloud-qa.ts', 'scripts/start-combined-agent.ts', 'scripts/launcher-child.ts',
  'scripts/local-agent-dev-bridge.ts', 'scripts/local-agent-dev-storage.ts',
  'scripts/prepare-local-agent.ts', 'scripts/local-agent-source.ts', 'scripts/copy-file-clone.ts',
  'scripts/prepare-client-features.ts', 'scripts/prepare-patched-native.ts',
  'scripts/build-workflow-worker.ts', 'scripts/prepared-workflow-worker.ts',
  'scripts/workflow-worker-artifact.ts', 'scripts/stage-workflow-worker.ts',
  'scripts/native-google-host-artifact.ts', 'scripts/build-native-google-host.ts',
  'scripts/combined-agent-source.ts', 'scripts/gmail-agent-mailbox-host.ts',
  'scripts/build-mobile-agent.ts', 'scripts/mobile-uuid-adapter.ts', 'scripts/mobile-bundle-smoke.ts',
  'scripts/stage-local-agent-runtime.ts', 'scripts/stage-local-agent-sources.ts',
  'scripts/agent-bundle-dependencies.ts', 'scripts/runtime-profile.ts',
  'scripts/build-embedding-host.ts', 'scripts/prepare-embedding-host.ts',
  'scripts/stage-embedding-host.ts', 'scripts/voice-host.ts',
  'scripts/android-build-preflight.ts', 'scripts/build-android.ts',
  'scripts/android-host.ts', 'scripts/android-gzip-assets.ts', 'scripts/stage-aosp.ts',
  'scripts/audit-production-bundle.ts', 'scripts/regular-files.ts', 'scripts/generate-licenses.ts',
  'scripts/cloud-deployment.ts', 'scripts/with-test-mocks.ts', 'scripts/child-command.ts', 'capacitor.config.ts', 'vite.config.ts',
  'scripts/apk.ts', 'scripts/source-snapshot.ts', 'scripts/verify-apks.ts', 'scripts/verify-packaged-runtime.py'];
export const runtimeAssetPaths = ['apps/app/index.html'];
const omittedDirectories = new Set(['node_modules', 'build', '.generated', '.gradle', '.cxx', '.kotlin', 'assets', 'jniLibs', 'capacitor-cordova-android-plugins']);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.java', '.kt', '.cpp', '.h', '.c', '.html', '.mjs', '.jsx', '.cc', '.hpp', '.rs', '.swift']);

const modelFamilies = ['application', 'services', 'native', 'legacy'] as const;
type ModelFamily = (typeof modelFamilies)[number];
type ExpectedCheck = 'pass' | 'violation';
interface ModelCheck {
  init: string;
  step: string;
  invariant: string;
  expected?: ExpectedCheck;
}
interface TemporalCheck {
  init: string;
  step: string;
  property: string;
  expected?: ExpectedCheck;
}
interface ModelDefinition {
  path: string;
  module: string;
  init: string;
  step: string;
  invariant: string;
  tests: string[];
  sources?: string[];
  sharedSources?: string[];
  temporal?: string[];
  currentChecks?: ModelCheck[];
  currentTemporalChecks?: TemporalCheck[];
  expectedViolations?: Array<ModelCheck | TemporalCheck>;
}
export interface QuintModel extends ModelDefinition {
  family: ModelFamily;
  sources: string[];
}
interface SourceAllocation {
  path: string;
  sha256: string;
  models: string[];
}
export interface SourceCoverage {
  upstream: {commit: string};
  files: Array<SourceAllocation & {treatment: string; scope: string}>;
  configurationInputs?: SourceAllocation[];
}
interface UpstreamPin {
  commit: string;
  appSource?: unknown;
}
interface RuntimeBundleInput {
  tracked: boolean;
  sha256: string;
  effectiveSourceSha256?: string;
  generatedSource?: {
    source?: string;
    sourceSha256?: string;
    config?: string;
    configSha256?: string;
    sourceMaps?: {path: string; sha256: string}[];
  };
}
interface RuntimeBundleGraph {
  schema: number;
  sourcePin: string;
  classification: string;
  files: Record<string, RuntimeBundleInput>;
  producer?: {
    sourceTreeVerifiedBeforeAndAfter?: boolean;
    inputHashesUnchanged?: boolean;
    inputHashes?: Record<string, string>;
    coreState?: {transforms: {path: string; sourceSha256: string; outputSha256: string}[]};
  };
}
export interface CheckerResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
  stdout?: string;
  stderr?: string;
}
type InterruptedAttempt = Pick<CheckerResult, 'signal'> & {exitCode: null};

function readModelFamily(family: ModelFamily) {
  const document = readJson<ModelDefinition[] | {models: ModelDefinition[]}>(join(quintRoot, family, 'manifest.json'));
  const models = Array.isArray(document) ? document : document.models;
  return models.map(model => ({...model, family,
    sources: [...new Set([...(model.sources || []), ...(model.sharedSources || []).map(path => `vendor/eliza/${path}`)])]}));
}

export function filesWithin(directory: string, accept: (path: string) => boolean = () => true): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (omittedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesWithin(path, accept));
    else if (entry.isFile() && accept(path)) result.push(path);
  }
  return result;
}

export const relativePath = (path: string) => relative(repositoryRoot, path).split('\\').join('/');
export const sha256 = (bytes: string | NodeJS.ArrayBufferView) => createHash('sha256').update(bytes).digest('hex');
/** Admit the tracked inputs and declared origins of the audited Android bundle. */
function runtimeBundleSourcePaths(pin: UpstreamPin) {
  const graph = readJson<RuntimeBundleGraph>(join(quintRoot, 'refinement/services/runtime-bundle-inputs.json'));
  if (graph.schema !== 1 || graph.sourcePin !== pin.commit
      || graph.classification !== 'observed-product-android-bundle-inputs'
      || !graph.files || Array.isArray(graph.files) || Object.keys(graph.files).length === 0
      || !graph.producer?.sourceTreeVerifiedBeforeAndAfter || !graph.producer?.inputHashesUnchanged) {
    throw Error('Refresh the authenticated runtime bundle inventory for the current upstream pin');
  }
  for (const [path, digest] of Object.entries(graph.producer.inputHashes || {})) {
    if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')
        || !/^[a-f0-9]{64}$/.test(digest) || sha256(readFileSync(join(repositoryRoot, path))) !== digest) {
      throw Error(`Runtime bundle producer input changed ${path}`);
    }
  }
  if (existsSync(join(repositoryRoot, CORE_STATE_MANIFEST))) {
    const core = graph.producer.coreState;
    verifyCoreStateBuildRecord(repositoryRoot, core, coreStateRequiredTargets(Object.keys(graph.files)));
    if (!core) throw Error('Missing core state build receipt');
    const transforms = new Map(core.transforms.map(row => [row.path, row]));
    for (const [path, input] of Object.entries(graph.files)) {
      const transform = transforms.get(path);
      if (transform ? input.sha256 !== transform.sourceSha256 || input.effectiveSourceSha256 !== transform.outputSha256
        : input.effectiveSourceSha256 !== undefined) {
        throw Error(`Runtime bundle effective source differs from its core transformation ${path}`);
      }
    }
  }
  const inputs = new Map<string, string>();
  const include = (path: string, digest: string | undefined) => {
    if (typeof path !== 'string' || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '..' || part === '.')) {
      throw Error(`Invalid runtime bundle source path ${path}`);
    }
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest) || (inputs.has(path) && inputs.get(path) !== digest)) {
      throw Error(`Inconsistent runtime bundle source hash ${path}`);
    }
    inputs.set(path, digest);
  };
  for (const [path, input] of Object.entries(graph.files)) {
    if (input.tracked) include(path, input.sha256);
    else {
      const origin = input.generatedSource;
      if (!origin?.source && !origin?.sourceMaps?.length) throw Error(`Unmapped generated runtime input ${path}`);
      if (origin.source) include(origin.source, origin.sourceSha256);
      if (origin.config) include(origin.config, origin.configSha256);
      for (const source of origin.sourceMaps || []) include(source.path, source.sha256);
    }
  }
  return [...inputs].map(([path, digest]) => {
    const source = `vendor/eliza/${path}`;
    if (sha256(readFileSync(join(repositoryRoot, source))) !== digest) {
      throw Error(`Runtime bundle input changed and needs a new producer inventory ${source}`);
    }
    return source;
  });
}

/** Discover the shared source consumed by this product from its authenticated inputs. */
export function sharedSourcePaths() {
  const pin = readJson<UpstreamPin>(join(repositoryRoot, 'upstream.lock.json'));
  // Minimal checker fixtures have no product source descriptor.
  if (!pin.appSource) return [];
  const client = readJson<{baseCommit: string; sourceFiles: Record<string, string>}>(join(repositoryRoot, '.eliza/client-features/.source.json'));
  if (client.baseCommit !== pin.commit) throw Error('Prepare client sources for the current upstream pin before checking Quint coverage');
  const host = readJson<{profile: {modules: {source: {root: string; path: string}}[]}; residentHost: {helpers: string[]}}>(join(repositoryRoot, 'android/consumer-host.json'));
  const patches = readJson<{modules?: string[]; patches: {module: string}[]}>(join(repositoryRoot, 'patches/eliza/native-manifest.json'));
  const prefixes = new Set([
    ...Object.keys(client.sourceFiles),
    ...host.profile.modules.filter(module => ['upstream', 'patchedNative'].includes(module.source.root)).map(module => module.source.path),
    ...host.residentHost.helpers,
    ...(patches.modules || []), ...patches.patches.map(patch => patch.module),
    'packages/app/platforms/android/sense/src/main',
    'packages/os/android/sense/systemui/chip/source',
  ]);
  // A finer model may expose a worker source outside the client/native projection.
  // Keep those registered source dependencies in drift admission as well.
  for (const model of modelFamilies.flatMap(readModelFamily)) {
    for (const source of model.sources) {
      if (!source.startsWith('vendor/eliza/')) continue;
      if (source.split('/').includes('..')) throw Error(`Invalid shared model source ${source}`);
      prefixes.add(source.slice('vendor/eliza/'.length));
    }
  }
  const sources = new Set(runtimeBundleSourcePaths(pin));
  for (const prefix of prefixes) {
    if (typeof prefix !== 'string' || prefix.startsWith('/') || prefix.split(/[\\/]/).includes('..')) throw Error(`Invalid shared source prefix ${prefix}`);
    const target = join(repositoryRoot, 'vendor/eliza', prefix);
    const paths = statSync(target).isDirectory() ? filesWithin(target) : [target];
    for (const path of paths) if (sourceExtensions.has(extname(path))) sources.add(relativePath(path));
  }
  return [...sources].sort();
}

export const sourcePaths = () => [...new Set([
  // Product CSS controls mounted visibility, focus affordances and pointer ownership.
  ...sourceRoots.flatMap(root => filesWithin(join(repositoryRoot, root),
    path => sourceExtensions.has(extname(path)) || extname(path) === '.css')).map(relativePath),
  ...runtimeScriptPaths, ...runtimeAssetPaths, ...sharedSourcePaths(),
])].sort();
export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function detectedCounterexample(output: string) {
  const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
  if (/^error: \[QNT\d+\]|^error: Argument error\s*$|^\[failure\]/m.test(plain)) return false;
  return /^\[violation\] Found an issue(?: |$)/m.test(plain)
    && /^error: (?:found a counterexample|Invariant violated)\s*$/m.test(plain);
}

export async function runQuintChecker(run: () => CheckerResult | Promise<CheckerResult>): Promise<{result: CheckerResult; interruptedAttempt?: InterruptedAttempt}> {
  const first = await run();
  const silentFault = first.status === null && (first.signal === 'SIGSEGV' || first.signal === 'SIGILL')
    && !first.error && !first.stdout?.trim() && !first.stderr?.trim();
  if (!silentFault) return {result: first};
  return {result: await run(), interruptedAttempt: {exitCode: null, signal: first.signal}};
}

export function loadModels(): QuintModel[] {
  const models = modelFamilies.flatMap(readModelFamily);
  const names = new Set();
  const paths = new Set<string>();
  for (const model of models) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(model.module) || names.has(model.module)) throw Error(`Invalid or duplicate module ${model.module}`);
    if (!/^specs\/quint\/(application|services|native|legacy)\/[A-Za-z][A-Za-z0-9_]*\.qnt$/.test(model.path) || paths.has(model.path)) throw Error(`Invalid or duplicate model path ${model.path}`);
    for (const field of ['init', 'step', 'invariant'] as const) if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(model[field])) throw Error(`Invalid ${field} in ${model.module}`);
    if (!Array.isArray(model.tests) || model.tests.length === 0) throw Error(`No scenarios declared for ${model.module}`);
    const text = readFileSync(join(repositoryRoot, model.path), 'utf8');
    for (const test of model.tests) if (!new RegExp(`\\brun\\s+${test}\\s*=`).test(text)) throw Error(`Missing scenario ${model.module}.${test}`);
    for (const source of model.sources || []) readFileSync(join(repositoryRoot, source));
    names.add(model.module);
    paths.add(model.path);
  }
  const actual = filesWithin(quintRoot, path => path.endsWith('.qnt')).map(relativePath);
  for (const path of actual) if (!paths.has(path)) throw Error(`Model absent from manifest ${path}`);
  for (const path of paths) if (!actual.includes(path)) throw Error(`Manifest model is missing ${path}`);
  return models;
}

export function checkCoverage(models: QuintModel[], inventory: SourceCoverage) {
  const errors: string[] = [];
  const sourceSet = new Set(sourcePaths());
  const modelSet = new Set(models.map(model => model.module));
  const recorded = new Set();
  for (const entry of inventory.files) {
    if (recorded.has(entry.path)) errors.push(`Duplicate source ${entry.path}`);
    recorded.add(entry.path);
    if (!sourceSet.has(entry.path)) { errors.push(`Removed source ${entry.path}`); continue; }
    if (entry.sha256 !== sha256(readFileSync(join(repositoryRoot, entry.path)))) errors.push(`Changed source needs model review ${entry.path}`);
    if (!Array.isArray(entry.models) || entry.models.length === 0) errors.push(`Unassigned source ${entry.path}`);
    for (const model of entry.models || []) if (!modelSet.has(model)) errors.push(`Unknown model ${model} for ${entry.path}`);
    if (!entry.treatment || !entry.scope) errors.push(`Missing coverage treatment ${entry.path}`);
  }
  for (const path of sourceSet) if (!recorded.has(path)) errors.push(`New source needs model review ${path}`);
  const upstream = readJson<UpstreamPin>(join(repositoryRoot, 'upstream.lock.json'));
  if (inventory.upstream.commit !== upstream.commit) errors.push('Upstream revision changed and needs contract model review');
  if (models.some(model => (model.sources || []).some(path => path.startsWith('vendor/eliza/')))) {
    try {
      const actual = execFileSync('git', ['-C', join(repositoryRoot, 'vendor/eliza'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      if (actual !== upstream.commit) errors.push('Checked-out upstream revision does not match the reviewed source pin');
      execFileSync('git', ['-C', join(repositoryRoot, 'vendor/eliza'), 'diff', '--quiet', 'HEAD'], { stdio: 'ignore' });
    } catch { errors.push('Upstream source checkout is unavailable or has tracked changes'); }
  }
  for (const input of inventory.configurationInputs || []) {
    if (input.sha256 !== sha256(readFileSync(join(repositoryRoot, input.path)))) errors.push(`Changed configuration needs model review ${input.path}`);
    for (const model of input.models) if (!modelSet.has(model)) errors.push(`Unknown configuration model ${model}`);
  }
  for (const model of models) for (const source of model.sources || []) {
    if (sourceSet.has(source) && !inventory.files.find(entry => entry.path === source)?.models.includes(model.module)) {
      errors.push(`Model source link is absent from coverage ${model.module}: ${source}`);
    }
  }
  return errors;
}
