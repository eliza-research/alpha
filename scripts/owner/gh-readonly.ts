/**
 * Shared read-only GitHub access for the owner incident scripts (issue #658, #679).
 *
 * Every request is `gh api --method GET`. Nothing here creates, edits or deletes anything,
 * and nothing prints a secret value: the GitHub API never returns secret values, and the
 * callers only keep names, ids and timestamps.
 *
 * GH_BIN selects the gh binary (default `gh`), for hosts where the PATH shim hangs.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const IOC_FILE = 'scripts/owner/incident-2026-10-27-iocs.json';

export function loadIocs(root: any = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, IOC_FILE), 'utf8'));
}

/** owner/name for a repository listed in the IOC file. */
export function fullName(iocs: any, repo: any) {
  if (repo.includes('/')) return repo;
  return `${iocs.ownerOverrides?.[repo] ?? iocs.defaultOwner}/${repo}`;
}

/** Only GET endpoints are accepted; anything else is a programming error. */
export function assertReadOnlyEndpoint(endpoint: any) {
  if (typeof endpoint !== 'string' || !/^[\w./~%?&=:,+()!*'-]+$/.test(endpoint) || endpoint.startsWith('-'))
    throw new Error(`refusing endpoint ${JSON.stringify(endpoint)}`);
  return endpoint;
}

export function statusOf(text: any) {
  return Number(/\(HTTP (\d{3})\)/.exec(text)?.[1] ?? /"status":\s*"(\d{3})"/.exec(text)?.[1] ?? 0);
}

/** One explicit GET. Returns {ok, data} or {ok:false, status, message}. */
export function ghGet(endpoint: any, {bin = process.env.GH_BIN || 'gh', timeoutMs = 90_000}: any = {}) {
  assertReadOnlyEndpoint(endpoint);
  try {
    const out = execFileSync(bin, ['api', '--method', 'GET', '-H', 'Accept: application/vnd.github+json', endpoint], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs,
    });
    return {ok: true, data: out.trim() ? JSON.parse(out) : null};
  } catch (error: any) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    return {ok: false, status: statusOf(text), message: (text.split('\n').pop() || error.message).slice(0, 300)};
  }
}

/**
 * Paginated GET. `pick` extracts the array from each page (default: the page itself).
 * Stops on a short page or after maxPages.
 */
export function ghGetAll(endpoint: any, {pick = (page: any) => page, perPage = 100, maxPages = 20, get = ghGet}: any = {}) {
  const rows: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const result = get(`${endpoint}${sep}per_page=${perPage}&page=${page}`);
    if (!result.ok) return page === 1 ? result : {ok: true, data: rows, truncated: `page ${page}: ${result.status}`};
    const items = pick(result.data) ?? [];
    rows.push(...items);
    if (items.length < perPage) return {ok: true, data: rows};
  }
  return {ok: true, data: rows, truncated: `stopped after ${maxPages} pages`};
}

type ArgumentName<T extends string> = T extends `--${infer Name}` ? Name : T;
type ParsedArguments<F extends readonly string[], O extends readonly string[], M extends readonly string[]> =
  {_: string[]} & {[K in ArgumentName<F[number]>]?: boolean} &
  {[K in ArgumentName<O[number]>]?: string} & {[K in ArgumentName<M[number]>]?: string[]};
export function parseArgs<const F extends readonly string[] = [], const O extends readonly string[] = [], const M extends readonly string[] = []>(
  argv: string[], {flags = [] as unknown as F, options = [] as unknown as O, multi = [] as unknown as M}: {flags?: F; options?: O; multi?: M} = {},
): ParsedArguments<F,O,M> {
  const out: {_: string[]; [key: string]: string | string[] | boolean | undefined} = {_: []};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (flags.includes(arg)) out[arg.slice(2)] = true;
    else if (options.includes(arg) || multi.includes(arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      const key = arg.slice(2);
      if (multi.includes(arg)) { const values = (out[key] ??= []) as string[]; values.push(value); }
      else out[key] = value;
    } else throw new Error(`unknown argument ${arg}`);
  }
  return out as ParsedArguments<F,O,M>;
}

export const unreadableNote = (result: any) => `${result.status || 'no HTTP status'}: ${result.message}`;
