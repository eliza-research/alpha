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

export interface IncidentIocs {
  actor: string;
  window: {start: string; end: string; cleanupEnd?: string; reviewFrom: string};
  defaultOwner: string;
  ownerOverrides?: Record<string, string>;
  ciRunsOnForgedCommits: Record<string, number>;
  repositories: string[];
  markers: {
    paths: string[];
    pathPatterns: string[];
    packageScriptPattern: string;
    contentPatterns: string[];
  };
  branches: {repo: string; branch: string; forged: string; legitimate?: string}[];
}

export function loadIocs(root = ROOT): IncidentIocs {
  return JSON.parse(fs.readFileSync(path.join(root, IOC_FILE), 'utf8'));
}

/** owner/name for a repository listed in the IOC file. */
export function fullName(iocs: Pick<IncidentIocs, 'ownerOverrides' | 'defaultOwner'>, repo: string) {
  if (repo.includes('/')) return repo;
  return `${iocs.ownerOverrides?.[repo] ?? iocs.defaultOwner}/${repo}`;
}

/** Only GET endpoints are accepted; anything else is a programming error. */
export function assertReadOnlyEndpoint(endpoint: unknown) {
  if (typeof endpoint !== 'string' || !/^[\w./~%?&=:,+()!*'-]+$/.test(endpoint) || endpoint.startsWith('-'))
    throw new Error(`refusing endpoint ${JSON.stringify(endpoint)}`);
  return endpoint;
}

function statusOf(text: string) {
  return Number(/\(HTTP (\d{3})\)/.exec(text)?.[1] ?? /"status":\s*"(\d{3})"/.exec(text)?.[1] ?? 0);
}

export interface GitHubFailure {
  ok: false;
  status: number;
  message: string;
}
export type GitHubResult<T> = {ok: true; data: T | null} | GitHubFailure;
export type GitHubRead = <T = unknown>(endpoint: string) => GitHubResult<T>;

interface GitHubReadOptions {
  bin?: string;
  timeoutMs?: number;
  maxBuffer?: number;
  killSignal?: NodeJS.Signals;
}

/** One explicit GET. The caller selects the response shape for its endpoint. */
export function ghGet<T = unknown>(endpoint: string, {
  bin = process.env.GH_BIN || 'gh', timeoutMs = 90_000, maxBuffer = 64 * 1024 * 1024, killSignal,
}: GitHubReadOptions = {}): GitHubResult<T> {
  assertReadOnlyEndpoint(endpoint);
  try {
    const out = execFileSync(bin, ['api', '--method', 'GET', '-H', 'Accept: application/vnd.github+json', endpoint], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer, timeout: timeoutMs, killSignal,
    });
    return {ok: true, data: out.trim() ? JSON.parse(out) : null};
  } catch (error) {
    const failed = error instanceof Error ? error : new Error(String(error));
    if ('code' in failed && failed.code === 'ETIMEDOUT') {
      return {ok: false, status: 0, message: `gh timed out after ${timeoutMs / 1000}s`};
    }
    const stdout = 'stdout' in failed ? failed.stdout : '';
    const stderr = 'stderr' in failed ? failed.stderr : '';
    const text = `${stdout ?? ''}${stderr ?? ''}`.trim();
    return {ok: false, status: statusOf(text), message: (text.split('\n').pop() || failed.message).slice(0, 300)};
  }
}

interface PageOptions {
  perPage?: number;
  maxPages?: number;
  get?: GitHubRead;
}
type PageResult<Row> = {ok: true; data: Row[]; truncated?: string} | GitHubFailure;

/** Paginated GET. Stops on a short page or after maxPages. */
export function ghGetAll<Row>(endpoint: string, options?: PageOptions): PageResult<Row>;
export function ghGetAll<Row, Page>(
  endpoint: string, options: PageOptions & {pick: (page: Page) => readonly Row[] | undefined},
): PageResult<Row>;
export function ghGetAll<Row, Page>(
  endpoint: string,
  {pick, perPage = 100, maxPages = 20, get = ghGet}: PageOptions & {pick?: (page: Page) => readonly Row[] | undefined} = {},
): PageResult<Row> {
  const rows: Row[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const result = get<Page | Row[]>(`${endpoint}${sep}per_page=${perPage}&page=${page}`);
    if (!result.ok) return page === 1 ? result : {ok: true, data: rows, truncated: `page ${page}: ${result.status}`};
    if (result.data === null) return {ok: true, data: rows};
    const items = (pick ? pick(result.data as Page) : result.data as Row[]) ?? [];
    rows.push(...items);
    if (items.length < perPage) return {ok: true, data: rows};
  }
  return {ok: true, data: rows, truncated: `stopped after ${maxPages} pages`};
}

type OptionName<T extends string> = T extends `--${infer Name}` ? Name : never;
export function parseArgs<Flag extends string, Option extends string, Multi extends string>(
  argv: readonly string[],
  {flags = [], options = [], multi = []}: {
    flags?: readonly Flag[];
    options?: readonly Option[];
    multi?: readonly Multi[];
  } = {},
) {
  const out: Record<string, boolean | string | string[]> & {_: string[]} = {_: []};
  const toggles: readonly string[] = flags;
  const singles: readonly string[] = options;
  const repeatable: readonly string[] = multi;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (toggles.includes(arg)) out[arg.slice(2)] = true;
    else if (singles.includes(arg) || repeatable.includes(arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      const key = arg.slice(2);
      if (repeatable.includes(arg)) {
        const values = out[key];
        if (Array.isArray(values)) values.push(value);
        else out[key] = [value];
      } else out[key] = value;
    } else throw new Error(`unknown argument ${arg}`);
  }
  return out as {_: string[]} & Partial<Record<OptionName<Flag>, boolean>>
    & Partial<Record<OptionName<Option>, string>> & Partial<Record<OptionName<Multi>, string[]>>;
}

export const unreadableNote = (result: GitHubFailure) => `${result.status || 'no HTTP status'}: ${result.message}`;

/** Keep partial pagination visible in the enclosing report. */
export function collectRows<Row>(result: PageResult<Row>, label: string, unreadable: string[]): Row[] | null {
  if (!result.ok) {
    unreadable.push(`${label}: ${unreadableNote(result)}`);
    return null;
  }
  if (result.truncated) unreadable.push(`${label}: incomplete (${result.truncated})`);
  return result.data;
}
