import { createHash } from 'node:crypto';
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
  'scripts/start-reviewed-workflow-agent.ts',
  'scripts/start-cloud-qa.ts', 'scripts/start-combined-agent.ts', 'scripts/launcher-child.ts',
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
  'scripts/with-test-mocks.ts', 'capacitor.config.ts', 'vite.config.ts',
  'scripts/apk.ts', 'scripts/source-snapshot.ts', 'scripts/verify-apks.ts', 'scripts/verify-packaged-runtime.py',
  'scripts/provision-unit.ts', 'scripts/publish-update-manifest.ts', 'scripts/deliver-app-update.ts',
  'scripts/update-apk-admission.ts', 'scripts/update-artifact.ts', 'scripts/owner/InspectUpdateApk.java',
  'scripts/ci/qualified-app-update.py', 'scripts/ci/admit-cloud-signing-input.py', 'scripts/ci/private-apk-storage.py'];
export const runtimeAssetPaths = ['apps/app/index.html'];
const omittedDirectories = new Set(['.cache', 'node_modules', 'build', '.generated', '.gradle', '.cxx', '.kotlin', 'assets', 'jniLibs', 'capacitor-cordova-android-plugins']);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.java', '.kt', '.cpp', '.h', '.c', '.html', '.mjs', '.jsx', '.cc', '.hpp', '.rs', '.swift']);

export function filesWithin(directory: any, accept: any = () => true) {
  const result: any[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a: any, b: any) => a.name.localeCompare(b.name, 'en'))) {
    if (omittedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesWithin(path, accept));
    else if (entry.isFile() && accept(path)) result.push(path);
  }
  return result;
}

export const relativePath = (path: any) => relative(repositoryRoot, path).split('\\').join('/');
export const sha256 = (bytes: any) => createHash('sha256').update(bytes).digest('hex');
/** Discover the shared source consumed by this product from its authenticated inputs. */
export function sharedSourcePaths() {
  const pin = readJson(join(repositoryRoot, 'upstream.lock.json'));
  // Minimal checker fixtures have no product source descriptor.
  if (!pin.appSource) return [];
  const client = readJson(join(repositoryRoot, '.eliza/client-features/.source.json'));
  if (client.baseCommit !== pin.commit) throw Error('Prepare client sources for the current upstream pin before capturing Quint conformance inputs');
  const host = readJson(join(repositoryRoot, 'android/consumer-host.json'));
  const patches = readJson(join(repositoryRoot, 'android/upstream-native-sources.json'));
  const prefixes = new Set([
    ...Object.keys(client.sourceFiles),
    ...host.profile.modules.filter((module: any) => ['upstream', 'patchedNative'].includes(module.source.root)).map((module: any) => module.source.path),
    ...host.residentHost.helpers,
    ...(patches.modules || []), ...patches.patches.map((patch: any) => patch.module),
    'packages/app/platforms/android/sense/src/main',
    'packages/os/android/sense/systemui/chip/source',
  ]);
  // A finer model may expose a worker source outside the client/native projection.
  // Keep those registered source dependencies in drift admission as well.
  for (const family of ['application', 'services', 'native', 'legacy']) {
    const document = readJson(join(quintRoot, family, 'manifest.json'));
    for (const model of Array.isArray(document) ? document : document.models) {
      for (const source of [...(model.sources || []), ...(model.sharedSources || []).map((path: any) => `vendor/eliza/${path}`)]) {
        if (!source.startsWith('vendor/eliza/')) continue;
        if (source.split('/').includes('..')) throw Error(`Invalid shared model source ${source}`);
        prefixes.add(source.slice('vendor/eliza/'.length));
      }
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
  ...sourceRoots.flatMap((root: any) => filesWithin(join(repositoryRoot, root),
    (path: any) => sourceExtensions.has(extname(path)) || extname(path) === '.css')).map(relativePath),
  ...runtimeScriptPaths, ...runtimeAssetPaths, ...sharedSourcePaths(),
])].sort();
export const readJson = (path: any) => JSON.parse(readFileSync(path, 'utf8'));

export function detectedCounterexample(output: any) {
  const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
  if (/^error: \[QNT\d+\]|^error: Argument error\s*$|^\[failure\]/m.test(plain)) return false;
  return /^\[violation\] Found an issue(?: |$)/m.test(plain)
    && /^error: (?:found a counterexample|Invariant violated)\s*$/m.test(plain);
}

export async function runQuintChecker(run: any) {
  const first = await run();
  const silentFault = first.status === null && ['SIGSEGV', 'SIGILL'].includes(first.signal)
    && !first.error && !first.stdout?.trim() && !first.stderr?.trim();
  if (!silentFault) return {result: first};
  return {result: await run(), interruptedAttempt: {exitCode: first.status, signal: first.signal}};
}

export function loadModels() {
  const models = ['application', 'services', 'native', 'legacy'].flatMap((family: any) => {
    const document = readJson(join(quintRoot, family, 'manifest.json'));
    return (Array.isArray(document) ? document : document.models).map((model: any) => ({ ...model, family,
      sources: [...new Set([...(model.sources || []), ...(model.sharedSources || []).map((path: any) => `vendor/eliza/${path}`)])] }));
  });
  const names = new Set();
  const paths = new Set<string>();
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
  const actual = filesWithin(quintRoot, (path: any) => path.endsWith('.qnt')).map(relativePath);
  for (const path of actual) if (!paths.has(path)) throw Error(`Model absent from manifest ${path}`);
  for (const path of paths) if (!actual.includes(path)) throw Error(`Manifest model is missing ${path}`);
  return models;
}
