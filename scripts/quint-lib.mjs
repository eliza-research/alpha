import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const quintRoot = join(repositoryRoot, 'specs/quint');
export const sourceRoots = ['apps/app/src', 'apps/app/public', 'backend', 'android'];
export const runtimeScriptPaths = ['scripts/browser-cloud-dev-bridge.ts', 'scripts/cloud-resident-host.mjs',
  'scripts/cloud-email-code.ts', 'scripts/dev-agent.mjs', 'scripts/dev-cloud.mjs', 'scripts/dev-local.mjs',
  'scripts/start-local-agent.mjs', 'scripts/start-local-voice-agent.mjs', 'scripts/start-local-remote.mjs'];
export const runtimeAssetPaths = ['apps/app/index.html'];
const omittedDirectories = new Set(['node_modules', 'build', '.gradle', '.cxx', '.kotlin', 'assets', 'jniLibs', 'capacitor-cordova-android-plugins']);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.java', '.kt', '.cpp', '.h', '.c', '.html', '.mjs', '.jsx', '.cc', '.hpp', '.rs', '.swift']);

export function filesWithin(directory, accept = () => true) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (omittedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesWithin(path, accept));
    else if (entry.isFile() && accept(path)) result.push(path);
  }
  return result;
}

export const relativePath = path => relative(repositoryRoot, path).split('\\').join('/');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Admit the tracked inputs and declared origins of the audited Android bundle. */
function runtimeBundleSourcePaths(pin) {
  const graph = readJson(join(quintRoot, 'refinement/services/runtime-bundle-inputs.json'));
  if (graph.schema !== 1 || graph.sourcePin !== pin.commit
      || graph.classification !== 'observed-product-android-bundle-inputs'
      || !graph.producer?.sourceTreeVerifiedBeforeAndAfter || !graph.producer?.inputHashesUnchanged) {
    throw Error('Refresh the authenticated runtime bundle inventory for the current upstream pin');
  }
  const inputs = new Map();
  const include = (path, digest) => {
    if (typeof path !== 'string' || path.startsWith('/') || path.split('/').some(part => !part || part === '..' || part === '.')) {
      throw Error(`Invalid runtime bundle source path ${path}`);
    }
    if (!/^[a-f0-9]{64}$/.test(digest) || (inputs.has(path) && inputs.get(path) !== digest)) {
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
  const pin = readJson(join(repositoryRoot, 'upstream.lock.json'));
  // Minimal checker fixtures have no product source descriptor.
  if (!pin.appSource) return [];
  const client = readJson(join(repositoryRoot, '.eliza/client-features/.source.json'));
  if (client.baseCommit !== pin.commit) throw Error('Prepare client sources for the current upstream pin before checking Quint coverage');
  const host = readJson(join(repositoryRoot, 'android/consumer-host.json'));
  const patches = readJson(join(repositoryRoot, 'patches/eliza/native-manifest.json'));
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
  for (const family of ['application', 'services', 'native', 'legacy']) {
    const document = readJson(join(quintRoot, family, 'manifest.json'));
    for (const model of Array.isArray(document) ? document : document.models) {
      for (const source of model.sources || []) {
        if (!source.startsWith('vendor/eliza/')) continue;
        if (source.split('/').includes('..')) throw Error(`Invalid shared model source ${source}`);
        prefixes.add(source.slice('vendor/eliza/'.length));
      }
    }
  }
  const sources = new Set(runtimeBundleSourcePaths(pin));
  for (const prefix of prefixes) {
    const target = join(repositoryRoot, 'vendor/eliza', prefix);
    const paths = statSync(target).isDirectory() ? filesWithin(target) : [target];
    for (const path of paths) if (sourceExtensions.has(extname(path))) sources.add(relativePath(path));
  }
  return [...sources].sort();
}

export const sourcePaths = () => [...new Set([
  ...sourceRoots.flatMap(root => filesWithin(join(repositoryRoot, root), path => sourceExtensions.has(extname(path)))).map(relativePath),
  ...runtimeScriptPaths, ...runtimeAssetPaths, ...sharedSourcePaths(),
])].sort();
export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

export function detectedCounterexample(output) {
  const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
  if (/^error: \[QNT\d+\]|^error: Argument error\s*$|^\[failure\]/m.test(plain)) return false;
  return /^\[violation\] Found an issue(?: |$)/m.test(plain)
    && /^error: (?:found a counterexample|Invariant violated)\s*$/m.test(plain);
}

export function loadModels() {
  const models = ['application', 'services', 'native', 'legacy'].flatMap(family => {
    const document = readJson(join(quintRoot, family, 'manifest.json'));
    return (Array.isArray(document) ? document : document.models).map(model => ({ ...model, family }));
  });
  const names = new Set();
  const paths = new Set();
  for (const model of models) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(model.module) || names.has(model.module)) throw Error(`Invalid or duplicate module ${model.module}`);
    if (!/^specs\/quint\/(application|services|native|legacy)\/[A-Za-z][A-Za-z0-9_]*\.qnt$/.test(model.path) || paths.has(model.path)) throw Error(`Invalid or duplicate model path ${model.path}`);
    for (const field of ['init', 'step', 'invariant']) if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(model[field])) throw Error(`Invalid ${field} in ${model.module}`);
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

export function checkCoverage(models, inventory) {
  const errors = [];
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
  const upstream = readJson(join(repositoryRoot, 'upstream.lock.json'));
  if (inventory.upstream.commit !== upstream.commit) errors.push('Upstream revision changed and needs contract model review');
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
