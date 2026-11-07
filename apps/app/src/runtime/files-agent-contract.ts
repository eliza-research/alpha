import {validateFilesFilter, validName, validPath, filterLabel, baseName, type FilesFilter} from './files-storage';

/**
 * Files agent tools (design/view-refresh-2026-11/PLAN.md section 4, spec files-browser).
 * files_filter only narrows what Files shows (a dismissible chip); files_open shows one file.
 * Share, move, trash and folder creation are proposals the owner reviews in Alpha before
 * anything changes or leaves the phone (AgentMoveOnlyReviewed: a move applies only while the
 * file is still where the owner reviewed it, and is still the file reviewed). A move or trash
 * carries `reviewed`, each path's identity (size, modified time) read when the proposal card
 * was built (the coordinator's filesIdentity port, filesReviewIdentity here); native leaves a
 * file whose identity has changed untouched. Paths are volume-relative ("Download/a.pdf").
 *
 * The same contract, the agent tool schema and the phone-side coordinator wiring are the
 * proposed upstream change patches/eliza/files-browser-agent.patch (plugin-assistant
 * files-browser-contract.ts). Operations keep one flat shape so a validated operation
 * validates again unchanged; test/files-agent-patch.test.mjs keeps both in step.
 */
/** What the owner reviewed for one path: size in bytes (0 for a folder) and modified time (ms). */
export type FilesIdentity = {size: number; modified: number};
export type FilesAgentOperation =
  | ({type: 'files_filter'} & FilesFilter)
  | {type: 'files_open'; path: string}
  | {type: 'files_share'; paths: string[]}
  | {type: 'files_move'; paths: string[]; dest: string; reviewed?: FilesIdentity[]}
  | {type: 'files_trash'; paths: string[]; reviewed?: FilesIdentity[]}
  | {type: 'files_folder_create'; parent: string; name: string};
export const FILES_CAPABILITY = 'files.browser.v1';
export const FILES_OPERATION_TYPES: readonly string[] = ['files_filter', 'files_open', 'files_share', 'files_move', 'files_trash', 'files_folder_create'];
/** Read-only or view-only: they change nothing, so they need no separate review. */
export const FILES_DIRECT_TYPES: readonly string[] = ['files_filter', 'files_open'];
export const FILES_PATHS_MAX = 50;

type Bag = Record<string, unknown>;
const bag = (value: unknown): Bag => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid files operation'); return value as Bag; };
export function isFilesOperation(value: unknown): value is FilesAgentOperation {
  return !!value && typeof value === 'object' && FILES_OPERATION_TYPES.includes(String((value as Bag).type));
}
function paths(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > FILES_PATHS_MAX) throw Error('Select 1–50 files');
  const out = value.map(item => validPath(item));
  if (new Set(out).size !== out.length) throw Error('Duplicate files');
  return out;
}
function identities(value: unknown, count: number): FilesIdentity[] {
  if (!Array.isArray(value) || value.length !== count) throw Error('Invalid reviewed files');
  return value.map(item => {
    const identity = bag(item);
    for (const key of Object.keys(identity)) if (key !== 'size' && key !== 'modified') throw Error('Invalid reviewed files');
    const {size, modified} = identity;
    if (!Number.isSafeInteger(size) || (size as number) < 0 || !Number.isSafeInteger(modified) || (modified as number) < 0) throw Error('Invalid reviewed files');
    return {size: size as number, modified: modified as number};
  });
}
/** Files operations that change files the owner reviewed by identity. */
export function filesNeedsIdentity(op: FilesAgentOperation): op is Extract<FilesAgentOperation, {type: 'files_move' | 'files_trash'}> {
  return op.type === 'files_move' || op.type === 'files_trash';
}
export function validateFilesOperation(value: unknown): FilesAgentOperation {
  const op = bag(value);
  const allowed = (keys: string[]) => { for (const key of Object.keys(op)) if (!keys.includes(key)) throw Error('Unexpected files operation field'); };
  switch (op.type) {
    case 'files_filter': {
      allowed(['type', 'text', 'kind', 'folder', 'from', 'to']);
      const {type: _type, ...filter} = op;
      return {type: 'files_filter', ...validateFilesFilter(filter)};
    }
    case 'files_open': allowed(['type', 'path']); return {type: 'files_open', path: validPath(op.path)};
    case 'files_share': allowed(['type', 'paths']); return {type: 'files_share', paths: paths(op.paths)};
    case 'files_trash': {
      allowed(['type', 'paths', 'reviewed']);
      const list = paths(op.paths);
      return {type: 'files_trash', paths: list, ...(op.reviewed === undefined ? {} : {reviewed: identities(op.reviewed, list.length)})};
    }
    case 'files_move': {
      allowed(['type', 'paths', 'dest', 'reviewed']);
      const list = paths(op.paths);
      return {type: 'files_move', paths: list, dest: validPath(op.dest, true), ...(op.reviewed === undefined ? {} : {reviewed: identities(op.reviewed, list.length)})};
    }
    case 'files_folder_create': {
      allowed(['type', 'parent', 'name']);
      const name = validName(op.name);
      if (name.startsWith('.')) throw Error('Invalid name');
      return {type: 'files_folder_create', parent: validPath(op.parent, true), name};
    }
  }
  throw Error('Unsupported files operation');
}
/** The filter fields of a files_filter operation. */
export function filesFilterOf(op: {type: 'files_filter'} & FilesFilter): FilesFilter {
  const {type: _type, ...filter} = op;
  return filter;
}
const place = (path: string) => path ? path.split('/').join(' › ') : 'Internal storage';
const listed = (list: string[]) => list.length <= 3 ? list.map(baseName).join(', ') : `${list.slice(0, 2).map(baseName).join(', ')} and ${list.length - 2} more`;
const count = (n: number) => n === 1 ? '1 item' : `${n} items`;
/** Owner-facing title and the exact effect of a proposal. */
export function describeFilesOperation(op: FilesAgentOperation): {title: string; description: string} {
  switch (op.type) {
    case 'files_filter': return {title: 'Show files', description: filterLabel(filesFilterOf(op))};
    case 'files_open': return {title: 'Open file', description: place(op.path)};
    case 'files_share': return {title: `Share ${count(op.paths.length)}`, description: listed(op.paths)};
    case 'files_trash': return {title: `Move ${count(op.paths.length)} to Trash`, description: listed(op.paths)};
    case 'files_move': return {title: `Move ${count(op.paths.length)}`, description: `${listed(op.paths)} → ${place(op.dest)}`};
    case 'files_folder_create': return {title: 'New folder', description: place(op.parent ? op.parent + '/' + op.name : op.name)};
  }
}
/** Files tools are reviewed where the owner sees Files on the unlocked phone; the filter and
 * open tools may start from any unlocked screen and bring Files forward. */
export function filesContextAllowed(op: FilesAgentOperation, context: {view: string; sensitive?: boolean}): boolean {
  if (context.sensitive) return false;
  return FILES_DIRECT_TYPES.includes(op.type) || context.view === 'files';
}

/** The Files view registers the runner while it is installed (agent-adapter calls it). */
export type FilesAgentRunner = {
  run(op: FilesAgentOperation, signal: AbortSignal): Promise<{status: 'succeeded' | 'failed'; summary: string}>;
  /** Each path's identity as Files reads it now, in order; rejects when one is missing. */
  identity(paths: string[], signal: AbortSignal): Promise<FilesIdentity[]>;
};
let runner: FilesAgentRunner | undefined;
export function registerFilesAgent(value: FilesAgentRunner | undefined) { runner = value; }
export function filesAgent(): FilesAgentRunner | undefined { return runner; }
/** The coordinator's filesIdentity port: read while the proposal card is built. */
export async function filesReviewIdentity(paths: string[], signal: AbortSignal): Promise<FilesIdentity[]> {
  if (!runner) throw Error('Files is unavailable');
  return runner.identity(paths, signal);
}
