import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
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
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.java', '.kt', '.cpp', '.h', '.c', '.html']);

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
export const sourcePaths = () => [...sourceRoots.flatMap(root => filesWithin(join(repositoryRoot, root), path => sourceExtensions.has(extname(path)))).map(relativePath), ...runtimeScriptPaths, ...runtimeAssetPaths].sort();
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
    return (Array.isArray(document) ? document : document.models).map(model => ({ ...model, family,
      sources: [...new Set([...(model.sources || []), ...(model.sharedSources || []).map(path => `vendor/eliza/${path}`)])] }));
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
