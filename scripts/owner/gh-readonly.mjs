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

export function loadIocs(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, IOC_FILE), 'utf8'));
}

/** owner/name for a repository listed in the IOC file. */
export function fullName(iocs, repo) {
  if (repo.includes('/')) return repo;
  return `${iocs.ownerOverrides?.[repo] ?? iocs.defaultOwner}/${repo}`;
}

/** Only GET endpoints are accepted; anything else is a programming error. */
export function assertReadOnlyEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !/^[\w./~%?&=:,+()!*'-]+$/.test(endpoint) || endpoint.startsWith('-'))
    throw new Error(`refusing endpoint ${JSON.stringify(endpoint)}`);
  return endpoint;
}

export function statusOf(text) {
  return Number(/\(HTTP (\d{3})\)/.exec(text)?.[1] ?? /"status":\s*"(\d{3})"/.exec(text)?.[1] ?? 0);
}

/** One explicit GET. Returns {ok, data} or {ok:false, status, message}. */
export function ghGet(endpoint, {bin = process.env.GH_BIN || 'gh', timeoutMs = 90_000} = {}) {
  assertReadOnlyEndpoint(endpoint);
  try {
    const out = execFileSync(bin, ['api', '--method', 'GET', '-H', 'Accept: application/vnd.github+json', endpoint], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs,
    });
    return {ok: true, data: out.trim() ? JSON.parse(out) : null};
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    return {ok: false, status: statusOf(text), message: (text.split('\n').pop() || error.message).slice(0, 300)};
  }
}

/**
 * Paginated GET. `pick` extracts the array from each page (default: the page itself).
 * Stops on a short page or after maxPages.
 */
export function ghGetAll(endpoint, {pick = page => page, perPage = 100, maxPages = 20, get = ghGet} = {}) {
  const rows = [];
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

export function parseArgs(argv, {flags = [], options = [], multi = []} = {}) {
  const out = {_: []};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flags.includes(arg)) out[arg.slice(2)] = true;
    else if (options.includes(arg) || multi.includes(arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      const key = arg.slice(2);
      if (multi.includes(arg)) (out[key] ??= []).push(value); else out[key] = value;
    } else throw new Error(`unknown argument ${arg}`);
  }
  return out;
}

export const unreadableNote = result => `${result.status || 'no HTTP status'}: ${result.message}`;
