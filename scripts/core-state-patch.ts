import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {SourceManifest} from './combined-agent-source.ts';
import {parseBuildPolicy} from './build-policy-source.ts';

export const CORE_STATE_MANIFEST = 'scripts/upstream-core-sources.ts';
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
  'plugins/plugin-notes/src/types.ts', 'plugins/plugin-notes/src/validation.ts', 'plugins/plugin-notes/src/trash-retention.ts'];
export const CORE_STATE_TARGETS = [
  CORE_STATE_TARGET, ...NOTES_STATE_TARGETS, TURN_STATE_TARGET,
  ROOM_QUEUE_TARGET, EMBEDDING_STATE_TARGET, ...NAMED_EMBEDDING_TARGETS,
  PLUGIN_CONNECTOR_TARGET,
];
export const CORE_STATE_INPUTS = ['scripts/core-state-patch.ts', 'scripts/core-state-preload.ts',
  'scripts/combined-agent-source.ts', 'scripts/build-policy-source.ts', CORE_STATE_MANIFEST];
const sha = (value: string | NodeJS.ArrayBufferView) => createHash('sha256').update(value).digest('hex');
const hex = /^[a-f0-9]{64}$/;
type HashPair = {beforeSha256: string; afterSha256: string};
interface CoreTransform {path: string; sourceSha256: string; outputSha256: string}
type RequiredTargets = boolean | readonly string[];
interface CoreBuildContext {
  onLoad(options: {filter: RegExp}, callback: (args: {path: string}) => {
    contents: string;
    loader: 'ts';
    resolveDir: string;
  }): void;
}

const isDigest = (value: unknown): value is string => typeof value === 'string' && hex.test(value);
const exact = <K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
function readRegular(root: string, name: string) {
  const file = path.resolve(root, name);
  if (!file.startsWith(path.resolve(root) + path.sep)) throw Error('Core source input escaped its root');
  for (let current = file; current !== path.resolve(root); current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Linked core source input');
  }
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw Error('Invalid core source input');
  return fs.readFileSync(file);
}

/** Bind runtime and bundle producers to the same reviewed upstream source. */
export function coreStateReceipt(root: string) {
  const manifestBytes = readRegular(root, CORE_STATE_MANIFEST);
  const manifest = parseBuildPolicy(manifestBytes);
  const pin = JSON.parse(readRegular(root, 'upstream.lock.json').toString('utf8')).commit;
  if (!exact(manifest, ['schema', 'baseCommit', 'files']) || manifest.schema !== 1 ||
      manifest.baseCommit !== pin || !/^[a-f0-9]{40}$/.test(pin) ||
      !exact(manifest.files, CORE_STATE_TARGETS)) throw Error('Core source catalog pin/schema mismatch');
  const files: Record<string, HashPair> = {};
  for (const name of CORE_STATE_TARGETS) {
    const digest = manifest.files[name];
    if (!isDigest(digest)) throw Error('Invalid core source digest: ' + name);
    // Keep the existing producer receipt fields. Effective bytes are the
    // same committed bytes observed before the bundle consumes this file.
    files[name] = {beforeSha256: digest, afterSha256: digest};
  }
  return {version: 2, baseCommit: pin, manifestSha256: sha(manifestBytes),
    inputHashes: Object.fromEntries(CORE_STATE_INPUTS.map(name => [name, sha(readRegular(root, name))])),
    patches: [], files};
}

/** Read the exact pinned modules without altering their contents. */
export function coreStatePatch(root: string, source = path.join(root, 'vendor/eliza')) {
  root = path.resolve(root);
  source = path.resolve(source);
  const receipt = coreStateReceipt(root);
  const files = new Map(Object.entries(receipt.files).map(([name, expected]) => {
    const bytes = readRegular(source, name);
    if (sha(bytes) !== expected.beforeSha256) throw Error('Core source differs from the pin: ' + name);
    return [name, {bytes, ...expected}];
  }));
  return {files, receipt};
}

/** Find reviewed targets in a concrete producer graph, including prepared-source paths. */
export function coreStateRequiredTargets(inputs: readonly string[]) {
  if (!Array.isArray(inputs) || !inputs.every(value => typeof value === 'string')) throw Error('Invalid core producer inputs');
  const paths = inputs.map(value => value.replaceAll('\\', '/'));
  return CORE_STATE_TARGETS.filter(target => paths.some(file => file === target || file.endsWith('/' + target)));
}

export function coreStateBuildPlugin(root: string, source: string) {
  const prepared = coreStatePatch(root, source);
  const transforms: CoreTransform[] = [];
  const byPath = new Map([...prepared.files].map(([name, entry]) => [path.resolve(source, name), {name, entry}]));
  const plugin = {name: 'authenticated-core-state', setup(build: CoreBuildContext) {
    build.onLoad({filter: /(?:[\\/]packages[\\/]core[\\/]src[\\/]services[\\/]task\.ts|[\\/]packages[\\/]core[\\/]src[\\/]plugin-lifecycle\.ts|[\\/]packages[\\/]core[\\/]src[\\/]runtime[\\/](?:turn-controller|room-handler-queue|embeddings)\.ts|[\\/]plugins[\\/]plugin-notes[\\/]src[\\/](?:service|store|types|validation|trash-retention)\.ts|[\\/]plugins[\\/]plugin-sql[\\/]src[\\/]base\.ts|[\\/]packages[\\/]agent[\\/]src[\\/]api[\\/]conversation-routes\.ts|[\\/]plugins[\\/]plugin-assistant[\\/]src[\\/]features[\\/]advanced-capabilities[\\/]experience[\\/]service\.ts)$/}, args => {
      const selected = byPath.get(path.resolve(args.path));
      if (!selected) throw Error('Unexpected core source module path');
      const {name, entry} = selected;
      if (sha(readRegular(source, name)) !== entry.beforeSha256) throw Error('Core source input changed before compilation');
      if (!transforms.some(value => value.path === name)) transforms.push({path: name, sourceSha256: entry.beforeSha256, outputSha256: entry.afterSha256});
      return {contents: entry.bytes.toString('utf8'), loader: 'ts', resolveDir: path.dirname(args.path)};
    });
  }};
  return {...prepared, transforms, plugin};
}

function verifyCoreStateTransforms(receipt: ReturnType<typeof coreStateReceipt>, transforms: unknown, required: RequiredTargets): asserts transforms is CoreTransform[] {
  if (!Array.isArray(transforms) || transforms.length > Object.keys(receipt.files).length ||
      new Set(transforms.map(value => value.path)).size !== transforms.length) throw Error('Missing or invalid core source observation');
  for (const transform of transforms) {
    if (!exact(transform, ['path', 'sourceSha256', 'outputSha256']) || typeof transform.path !== 'string') {
      throw Error('Core patch transformation mismatch');
    }
    const expected = receipt.files[transform.path];
    if (!exact(transform, ['path', 'sourceSha256', 'outputSha256']) || !expected || transform.sourceSha256 !== expected.beforeSha256 || transform.outputSha256 !== expected.afterSha256) throw Error('Core source observation mismatch');
  }
  const expectedTargets = required === true ? [CORE_STATE_TARGET] : required === false ? null : required;
  if (expectedTargets !== null && (!Array.isArray(expectedTargets) ||
      !expectedTargets.every(name => Object.hasOwn(receipt.files, name)) || new Set(expectedTargets).size !== expectedTargets.length ||
      !isDeepStrictEqual([...expectedTargets].sort(), transforms.map(value => value.path).sort()))) throw Error('Missing or invalid selected core source observation');
}

export function coreStateBuildRecord(root: string, transforms: unknown, required: RequiredTargets = false) {
  const receipt = coreStateReceipt(root);
  verifyCoreStateTransforms(receipt, transforms, required);
  return {...receipt, transforms: [...transforms].sort((a, b) => a.path.localeCompare(b.path))};
}

export function verifyCoreStateBuildRecord(root: string, record: unknown, required: RequiredTargets = false): asserts record is ReturnType<typeof coreStateBuildRecord> {
  const transforms = record !== null && typeof record === 'object' && 'transforms' in record ? record.transforms : undefined;
  if (!isDeepStrictEqual(record, coreStateBuildRecord(root, transforms, required))) throw Error('Core source build receipt changed');
}

/** The preload authenticates the selected checkout before any reviewed module is evaluated. */
export function coreRuntimeArguments(root: string, source: string, args: readonly string[]) {
  if (!Array.isArray(args) || !args.every(value => typeof value === 'string')) throw Error('Invalid core runtime arguments');
  if (!path.isAbsolute(source)) throw Error('Core runtime source must be absolute');
  coreStateReceipt(root);
  return ['--preload', path.join(root, 'scripts/core-state-preload.ts'), ...args];
}

/** Independently reviewed frozen snapshots retain their own version contract. */
export function combinedCoreRuntime(
  root: string, source: string, manifest: string,
  snapshot: Pick<SourceManifest,'revision'> & Partial<Pick<SourceManifest,'entries'>>,
  args: string[],
) {
  const receipt = coreStateReceipt(root);
  const matches = snapshot.revision === receipt.baseCommit && Object.entries(receipt.files)
    .every(([name, target]) => {
      const entry = snapshot.entries?.[name];
      return entry && 'sha256' in entry && entry.sha256 === target.beforeSha256;
    });
  if (!matches) return {args, environment: {}, status: {applied: false,
    reason: 'independent-snapshot-requires-separate-patch-review', sourceRevision: snapshot.revision}};
  return {args: coreRuntimeArguments(root, source, args),
    environment: {ALPHA_CORE_STATE_SOURCE: source, ALPHA_CORE_STATE_FROZEN_MANIFEST: manifest},
    status: {applied: true, sourceRevision: snapshot.revision, manifestSha256: receipt.manifestSha256}};
}
