import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const quintRoot = join(repositoryRoot, 'specs/quint');
export const sourceRoots = ['apps/app/src', 'apps/app/public', 'android'];
export const runtimeScriptPaths = ['scripts/stage-alpha-os-branding.py', 'scripts/generate-alpha-os-branding.ts', 'scripts/fetch-alpha-os-preset-inputs.py',
  'scripts/browser-cloud-dev-bridge.ts', 'scripts/cloud-resident-host.ts',
  'scripts/cloud-email-code.ts', 'scripts/dev-cloud.ts', 'scripts/dev-local.ts',
  'scripts/start-local-voice-agent.ts', 'scripts/start-local-remote.ts',
  'scripts/core-state-patch.ts', 'scripts/core-state-preload.ts', 'scripts/build-policy-source.ts',
  'scripts/start-combined-agent.ts', 'scripts/launcher-child.ts',
  'scripts/private-runtime-launch.ts', 'scripts/host-speech-admission.ts',
  'scripts/local-agent-dev-bridge.ts', 'scripts/local-agent-dev-storage.ts',
  'scripts/prepare-local-agent.ts', 'scripts/local-agent-source.ts', 'scripts/copy-file-clone.ts',
  'scripts/prepare-client-features.ts', 'scripts/prepare-patched-native.ts',
  'scripts/build-workflow-worker.ts', 'scripts/prepared-workflow-worker.ts',
  'scripts/workflow-worker-artifact.ts', 'scripts/stage-workflow-worker.ts',
  'scripts/native-google-host-artifact.ts', 'scripts/build-native-google-host.ts',
  'scripts/combined-agent-source.ts', 'scripts/native-google-product-host.ts',
  'scripts/build-mobile-agent.ts', 'scripts/mobile-uuid-adapter.ts', 'scripts/mobile-bundle-smoke.ts',
  'scripts/stage-local-agent-runtime.ts', 'scripts/stage-local-agent-sources.ts',
  'scripts/agent-bundle-dependencies.ts', 'scripts/runtime-profile.ts',
  'scripts/build-embedding-host.ts', 'scripts/prepare-embedding-host.ts',
  'scripts/stage-embedding-host.ts', 'scripts/voice-host.ts',
  'scripts/android-build-preflight.ts', 'scripts/build-android.ts',
  'scripts/android-host.ts', 'scripts/android-gzip-assets.ts', 'scripts/stage-aosp.ts',
  'scripts/audit-production-bundle.ts', 'scripts/generate-licenses.ts',
  'scripts/cloud-deployment.ts', 'scripts/cloud-deployment-policy.ts', 'scripts/native-view-policy.ts',
  'scripts/with-test-mocks.ts', 'scripts/child-command.ts', 'scripts/regular-files.ts', 'capacitor.config.ts', 'vite.config.ts',
  'scripts/apk.ts', 'scripts/source-snapshot.ts', 'scripts/verify-apks.ts', 'scripts/verify-packaged-runtime.py',
  'scripts/provision-unit.ts', 'scripts/publish-update-manifest.ts', 'scripts/deliver-app-update.ts',
  'scripts/update-apk-admission.ts', 'scripts/update-artifact.ts', 'scripts/owner/InspectUpdateApk.java',
  'scripts/ci/qualified-app-update.py', 'scripts/ci/admit-cloud-signing-input.py', 'scripts/ci/app_update_producer.py',
  'scripts/ci/private-apk-storage.py'];
export const runtimeAssetPaths = ['apps/app/index.html'];
const omittedDirectories = new Set(['.cache', 'node_modules', 'build', '.generated', '.gradle', '.cxx', '.kotlin', 'assets', 'jniLibs', 'capacitor-cordova-android-plugins']);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.java', '.kt', '.cpp', '.h', '.c', '.html', '.mjs', '.jsx', '.cc', '.hpp', '.rs', '.swift']);

const modelFamilies = ['application', 'services', 'native', 'legacy'] as const;
type ModelFamily = (typeof modelFamilies)[number];
type ExpectedCheck = 'pass' | 'violation';
export type QuintProofBackend = 'apalache' | 'tlc';
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
  verifyBackend?: QuintProofBackend;
  tests: string[];
  sources?: string[];
  sharedSources?: string[];
  temporal?: string[];
  currentChecks?: ModelCheck[];
  currentTemporalChecks?: TemporalCheck[];
  expectedViolations?: Array<ModelCheck | TemporalCheck>;
  bounds?: {maxSamples?: number; maxSteps?: number; maxVerifyDepth?: number; seed?: string | number};
  invariants?: string[];
  additionalProofInit?: string;
  witnesses?: string[];
  symbols?: Array<{path: string; name: string}>;
}
export interface QuintModel extends ModelDefinition {
  family: ModelFamily;
  sources: string[];
}
interface UpstreamPin { commit: string; appSource?: unknown }
export interface CheckerResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
  stdout?: string;
  stderr?: string;
}
type InterruptedAttempt = Pick<CheckerResult, 'signal'> & {exitCode: null};

function readModelFamily(family: ModelFamily) {
  return readJson<ModelDefinition[]>(join(quintRoot, family, 'manifest.json')).map(model => ({...model, family,
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
/** Discover the shared source consumed by this product from its authenticated inputs. */
export function sharedSourcePaths() {
  const pin = readJson<UpstreamPin>(join(repositoryRoot, 'upstream.lock.json'));
  // Minimal checker fixtures have no product source descriptor.
  if (!pin.appSource) return [];
  const client = readJson<{baseCommit: string; sourceFiles: Record<string, string>}>(join(repositoryRoot, '.eliza/client-features/.source.json'));
  if (client.baseCommit !== pin.commit) throw Error('Prepare client sources for the current upstream pin before capturing Quint conformance inputs');
  const host = readJson<{profile: {modules: {source: {root: string; path: string}}[]}; residentHost: {helpers: string[]}}>(join(repositoryRoot, 'android/consumer-host.json'));
  const patches = readJson<{modules?: string[]; patches: {module: string}[]}>(join(repositoryRoot, 'android/upstream-native-sources.json'));
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
  const sources = new Set();
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

/** Match the pinned CLI's successful scenario records, not its aggregate exit code. */
export function missingQuintScenarios(tests: readonly string[], output: string) {
  const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
  const executed = new Set([...plain.matchAll(/^\s*ok ([A-Za-z][A-Za-z0-9_]*) passed [1-9][0-9]* test\(s\)\s*$/gm)].map(match => match[1]));
  return tests.filter(name => !executed.has(name));
}

export function quintModelOptions(model: ModelDefinition, command: string = 'check', overrides: {samples?: number; steps?: number; seed?: string | number} = {}) {
  const checking = ['verify', 'temporal', 'compare'].includes(command);
  return {
    samples: overrides.samples ?? model.bounds?.maxSamples ?? 80,
    steps: overrides.steps ?? (checking ? model.bounds?.maxVerifyDepth : model.bounds?.maxSteps)
      ?? (command === 'compare' ? 20 : checking ? 6 : 40),
    seed: String(overrides.seed ?? model.bounds?.seed ?? '20261107'),
  };
}

export function quintProofBackend(model: Pick<ModelDefinition, 'verifyBackend'>, command: string, override?: QuintProofBackend): QuintProofBackend {
  if (override) return override;
  if (command === 'temporal' || command === 'compare') return 'tlc';
  return command === 'verify' ? model.verifyBackend ?? 'apalache' : 'apalache';
}

export function validateQuintModelMetadata(model: ModelDefinition, text: string) {
  if (model.verifyBackend !== undefined && model.verifyBackend !== 'apalache' && model.verifyBackend !== 'tlc') {
    throw Error(`Invalid verifyBackend in ${model.module}`);
  }
  for (const test of model.tests) if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(test)) throw Error(`Invalid scenario ${model.module}.${test}`);
  if (new Set(model.tests).size !== model.tests.length) throw Error(`Duplicate scenarios in ${model.module}`);
  for (const key of ['maxSamples', 'maxSteps', 'maxVerifyDepth'] as const) {
    const value = model.bounds?.[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw Error(`Invalid bounds.${key} in ${model.module}`);
  }
  if (!model.invariants && !model.additionalProofInit) return;
  // Use Quint's own parser: an action-local val is not a declared invariant.
  const require = createRequire(import.meta.url);
  const {parsePhase1fromText} = require('@informalsystems/quint/dist/src/parsing/quintParserFrontend.js') as typeof import('@informalsystems/quint/dist/src/parsing/quintParserFrontend.js');
  const {newIdGenerator} = require('@informalsystems/quint/dist/src/idGenerator.js') as typeof import('@informalsystems/quint/dist/src/idGenerator.js');
  const parsed = parsePhase1fromText(newIdGenerator(), text, model.path);
  if (parsed.errors.length) throw Error(`Cannot parse metadata for ${model.module}: ${parsed.errors.map(error => error.message).join('; ')}`);
  const declarations = parsed.modules.find(module => module.name === model.module)?.declarations ?? [];
  for (const name of model.invariants ?? []) {
    const [qualifier, member] = name.split('::');
    const candidate = member ? declarations.find(declaration => declaration.kind === 'instance' && declaration.qualifiedName === qualifier) : undefined;
    const instance = candidate?.kind === 'instance' ? candidate : undefined;
    const instanceModule = instance && parsed.modules.find(module => module.name === instance.protoName);
    const declared = member
      ? instanceModule?.declarations.some(declaration => declaration.kind === 'export' && declaration.defName === member
        || declaration.kind === 'def' && declaration.name === member && ['val', 'pureval'].includes(declaration.qualifier))
      : declarations.some(declaration => declaration.kind === 'def' && declaration.name === name && ['val', 'pureval'].includes(declaration.qualifier));
    if (!declared) throw Error(`Missing top-level invariant ${model.module}.${name}`);
  }
  if (model.additionalProofInit && !declarations.some(declaration => declaration.kind === 'def'
    && declaration.name === model.additionalProofInit && declaration.qualifier === 'action')) {
    throw Error(`Missing additional proof init ${model.module}.${model.additionalProofInit}`);
  }
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
    validateQuintModelMetadata(model, text);
    for (const test of model.tests) if (!new RegExp(`\\brun\\s+${test}\\s*=`).test(text)) throw Error(`Missing scenario ${model.module}.${test}`);
    for (const source of model.sources || []) readFileSync(join(repositoryRoot, source));
    for (const name of model.witnesses || []) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*$/.test(name)) throw Error(`Invalid witness ${model.module}.${name}`);
      if (!name.includes('::') && !new RegExp(`\\b(?:val|def|pure val|pure def|temporal)\\s+${name}\\b`).test(text)) throw Error(`Manifest names an undefined property ${model.module}.${name}`);
    }
    for (const symbol of model.symbols || []) {
      if (!symbol.path || symbol.path.startsWith('/') || symbol.path.split(/[\\/]/).includes('..') || !symbol.name) throw Error(`Invalid source symbol in ${model.module}`);
      const source = readFileSync(join(repositoryRoot, symbol.path), 'utf8');
      const escaped = symbol.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).test(source)) throw Error(`Source symbol is missing ${model.module}: ${symbol.path} ${symbol.name}`);
      if (!model.sources.includes(symbol.path)) model.sources.push(symbol.path);
    }
    names.add(model.module);
    paths.add(model.path);
  }
  const actual = filesWithin(quintRoot, path => path.endsWith('.qnt')).map(relativePath);
  for (const path of actual) if (!paths.has(path)) throw Error(`Model absent from manifest ${path}`);
  for (const path of paths) if (!actual.includes(path)) throw Error(`Manifest model is missing ${path}`);
  return models;
}
