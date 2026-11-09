import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';

export const CORE_STATE_MANIFEST = 'patches/eliza/core-state-manifest.json';
export const CORE_STATE_TARGET = 'packages/core/src/services/task.ts';
export const TURN_STATE_TARGET = 'packages/core/src/runtime/turn-controller.ts';
export const ROOM_QUEUE_TARGET = 'packages/core/src/runtime/room-handler-queue.ts';
export const PLUGIN_CONNECTOR_TARGET = 'packages/core/src/plugin-lifecycle.ts';
export const EMBEDDING_STATE_TARGET = 'packages/core/src/runtime/embeddings.ts';
export const NAMED_EMBEDDING_TARGETS = [
  'plugins/plugin-sql/src/base.ts',
  'packages/agent/src/api/conversation-routes.ts',
  'plugins/plugin-assistant/src/features/advanced-capabilities/experience/service.ts',
];
export const NOTES_STATE_TARGET = 'plugins/plugin-notes/src/service.ts';
export const NOTES_STATE_TARGETS = [NOTES_STATE_TARGET, 'plugins/plugin-notes/src/store.ts',
  'plugins/plugin-notes/src/types.ts', 'plugins/plugin-notes/src/validation.ts'];
const reviewedPatches = [
  {file: 'task-service-stop.patch', paths: [CORE_STATE_TARGET]},
  {file: 'notes-state-runtime.patch', paths: NOTES_STATE_TARGETS},
  {file: 'turn-controller-isolation.patch', paths: [TURN_STATE_TARGET]},
  {file: 'room-queue-admission.patch', paths: [ROOM_QUEUE_TARGET]},
  {file: 'embedding-store-identity.patch', paths: [EMBEDDING_STATE_TARGET]},
  {file: 'named-embedding-provenance.patch', paths: NAMED_EMBEDDING_TARGETS},
  {file: 'plugin-connector-custody.patch', paths: [PLUGIN_CONNECTOR_TARGET]},
];
export const CORE_STATE_INPUTS = ['scripts/core-state-patch.mjs', 'scripts/core-state-preload.mjs',
  'scripts/combined-agent-source.mjs', CORE_STATE_MANIFEST,
  ...reviewedPatches.map(patch => 'patches/eliza/' + patch.file)];
const sha = value => createHash('sha256').update(value).digest('hex');
const hex = /^[a-f0-9]{64}$/;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
function readRegular(root, name) {
  const file = path.resolve(root, name);
  if (!file.startsWith(path.resolve(root) + path.sep)) throw Error('Core patch input escaped its root');
  for (let current = file; current !== path.resolve(root); current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Linked core patch input');
  }
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw Error('Invalid core patch input');
  return fs.readFileSync(file);
}

/** The same receipt is used by source preload, bundling and packaged verification. */
export function coreStateReceipt(root) {
  const manifestBytes = readRegular(root, CORE_STATE_MANIFEST);
  const manifest = JSON.parse(manifestBytes);
  const pin = JSON.parse(readRegular(root, 'upstream.lock.json')).commit;
  if (!exact(manifest, ['schema', 'baseCommit', 'patches']) || manifest.schema !== 1 || manifest.baseCommit !== pin ||
      !/^[a-f0-9]{40}$/.test(pin) || !Array.isArray(manifest.patches) || manifest.patches.length !== reviewedPatches.length) throw Error('Core patch pin/schema mismatch');
  const patches = [], files = {};
  for (const [index, reviewed] of reviewedPatches.entries()) {
    const patch = manifest.patches[index];
    if (!exact(patch, ['file', 'sha256', 'targets']) || patch.file !== reviewed.file || !hex.test(patch.sha256) ||
        !Array.isArray(patch.targets) || patch.targets.length !== reviewed.paths.length) throw Error('Invalid core patch record');
    for (const [targetIndex, target] of patch.targets.entries()) {
      if (!exact(target, ['path', 'beforeSha256', 'afterSha256']) || target.path !== reviewed.paths[targetIndex] ||
          !hex.test(target.beforeSha256) || !hex.test(target.afterSha256)) throw Error('Core patch target is not allowed');
      files[target.path] = {beforeSha256: target.beforeSha256, afterSha256: target.afterSha256};
    }
    const bytes = readRegular(root, 'patches/eliza/' + patch.file);
    if (sha(bytes) !== patch.sha256) throw Error('Core patch digest mismatch');
    const headers = bytes.toString('utf8').split('\n').filter(line => line.startsWith('--- ') || line.startsWith('+++ '));
    const expectedHeaders = reviewed.paths.flatMap(name => ['--- a/' + name, '+++ b/' + name]);
    if (!isDeepStrictEqual(headers, expectedHeaders)) throw Error('Core patch headers mismatch');
    patches.push({file: patch.file, sha256: patch.sha256});
  }
  return {version: 1, baseCommit: pin, manifestSha256: sha(manifestBytes),
    inputHashes: Object.fromEntries(CORE_STATE_INPUTS.map(name => [name, sha(readRegular(root, name))])), patches, files};
}

/** Materialize exactly the reviewed targets in scratch space. */
export function coreStatePatch(root, source = path.join(root, 'vendor/eliza')) {
  root = path.resolve(root); source = path.resolve(source);
  const receipt = coreStateReceipt(root);
  const patchInputs = receipt.patches.map(patch => {
    const bytes = readRegular(root, 'patches/eliza/' + patch.file);
    if (sha(bytes) !== patch.sha256) throw Error('Core patch changed before application');
    return bytes;
  });
  const originals = Object.entries(receipt.files).map(([name, expected]) => {
    const bytes = readRegular(source, name);
    if (sha(bytes) !== expected.beforeSha256) throw Error('Core patch preimage mismatch');
    return [name, bytes];
  });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-core-patch-'));
  try {
    for (const [name, bytes] of originals) {
      const file = path.join(temporary, name);
      fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, bytes, {mode: 0o644});
    }
    for (const input of patchInputs) execFileSync('patch', ['--batch', '--fuzz=0', '--forward', '-p1'], {
      cwd: temporary, input, stdio: 'pipe', timeout: 30000,
    });
    const inventory = fs.readdirSync(temporary, {recursive: true, withFileTypes: true})
      .filter(entry => !entry.isDirectory()).map(entry => path.relative(temporary, path.join(entry.parentPath, entry.name))).sort();
    if (!isDeepStrictEqual(inventory, Object.keys(receipt.files).sort())) throw Error('Core patch created unexpected files');
    const files = new Map();
    for (const [name, expected] of Object.entries(receipt.files)) {
      const output = readRegular(temporary, name);
      if (sha(output) !== expected.afterSha256) throw Error('Core patch postimage mismatch');
      files.set(name, {bytes: output, ...expected});
    }
    return {files, receipt};
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
}

/** Find reviewed targets in a concrete producer graph, including prepared-source paths. */
export function coreStateRequiredTargets(inputs) {
  if (!Array.isArray(inputs) || !inputs.every(value => typeof value === 'string')) throw Error('Invalid core producer inputs');
  const paths = inputs.map(value => value.replaceAll('\\', '/'));
  return reviewedPatches.flatMap(patch => patch.paths).filter(target => paths.some(file => file === target || file.endsWith('/' + target)));
}

export function coreStateBuildPlugin(root, source) {
  const prepared = coreStatePatch(root, source), transforms = [];
  const byPath = new Map([...prepared.files].map(([name, entry]) => [path.resolve(source, name), {name, entry}]));
  const plugin = {name: 'authenticated-core-state', setup(build) {
    build.onLoad({filter: /(?:[\\/]packages[\\/]core[\\/]src[\\/]services[\\/]task\.ts|[\\/]packages[\\/]core[\\/]src[\\/]plugin-lifecycle\.ts|[\\/]packages[\\/]core[\\/]src[\\/]runtime[\\/](?:turn-controller|room-handler-queue|embeddings)\.ts|[\\/]plugins[\\/]plugin-notes[\\/]src[\\/](?:service|store|types|validation)\.ts|[\\/]plugins[\\/]plugin-sql[\\/]src[\\/]base\.ts|[\\/]packages[\\/]agent[\\/]src[\\/]api[\\/]conversation-routes\.ts|[\\/]plugins[\\/]plugin-assistant[\\/]src[\\/]features[\\/]advanced-capabilities[\\/]experience[\\/]service\.ts)$/}, args => {
      const selected = byPath.get(path.resolve(args.path));
      if (!selected) throw Error('Unexpected core patch module path');
      const {name, entry} = selected;
      if (sha(readRegular(source, name)) !== entry.beforeSha256) throw Error('Core patch input changed before compilation');
      if (!transforms.some(value => value.path === name)) transforms.push({path: name, sourceSha256: entry.beforeSha256, outputSha256: entry.afterSha256});
      return {contents: entry.bytes.toString('utf8'), loader: 'ts', resolveDir: path.dirname(args.path)};
    });
  }};
  return {...prepared, transforms, plugin};
}

export function verifyCoreStateTransforms(receipt, transforms, required = false) {
  if (!Array.isArray(transforms) || transforms.length > Object.keys(receipt.files).length ||
      new Set(transforms.map(value => value.path)).size !== transforms.length) throw Error('Missing or invalid core patch transformation');
  for (const transform of transforms) {
    const expected = receipt.files[transform.path];
    if (!exact(transform, ['path', 'sourceSha256', 'outputSha256']) || !expected || transform.sourceSha256 !== expected.beforeSha256 || transform.outputSha256 !== expected.afterSha256) throw Error('Core patch transformation mismatch');
  }
  const expectedTargets = required === true ? [CORE_STATE_TARGET] : required === false ? null : required;
  if (expectedTargets !== null && (!Array.isArray(expectedTargets) ||
      !expectedTargets.every(name => Object.hasOwn(receipt.files, name)) || new Set(expectedTargets).size !== expectedTargets.length ||
      !isDeepStrictEqual([...expectedTargets].sort(), transforms.map(value => value.path).sort()))) throw Error('Missing or invalid selected core transformation');
}

export function coreStateBuildRecord(root, transforms, required = false) {
  const receipt = coreStateReceipt(root);
  verifyCoreStateTransforms(receipt, transforms, required);
  return {...receipt, transforms: [...transforms].sort((a, b) => a.path.localeCompare(b.path))};
}

export function verifyCoreStateBuildRecord(root, record, required = false) {
  if (!isDeepStrictEqual(record, coreStateBuildRecord(root, record?.transforms, required))) throw Error('Core patch build receipt changed');
}

/** The preload authenticates the selected checkout before any patched module is evaluated. */
export function coreRuntimeArguments(root, source, args) {
  if (!Array.isArray(args) || !args.every(value => typeof value === 'string')) throw Error('Invalid core runtime arguments');
  if (!path.isAbsolute(source)) throw Error('Core runtime source must be absolute');
  coreStateReceipt(root);
  return ['--preload', path.join(root, 'scripts/core-state-preload.mjs'), ...args];
}

/** Independently reviewed frozen snapshots retain their own version contract. */
export function combinedCoreRuntime(root, source, manifest, snapshot, args) {
  const receipt = coreStateReceipt(root);
  const matches = snapshot.revision === receipt.baseCommit && Object.entries(receipt.files)
    .every(([name, target]) => snapshot.entries?.[name]?.sha256 === target.beforeSha256);
  if (!matches) return {args, environment: {}, status: {applied: false,
    reason: 'independent-snapshot-requires-separate-patch-review', sourceRevision: snapshot.revision}};
  return {args: coreRuntimeArguments(root, source, args),
    environment: {ALPHA_CORE_STATE_SOURCE: source, ALPHA_CORE_STATE_FROZEN_MANIFEST: manifest},
    status: {applied: true, sourceRevision: snapshot.revision, manifestSha256: receipt.manifestSha256}};
}
