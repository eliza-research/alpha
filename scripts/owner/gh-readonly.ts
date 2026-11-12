/**
 * Read-only GitHub access.
 *
 * Every request is `gh api --method GET`. Nothing here creates, edits or deletes anything,
 * and nothing prints a secret value: the GitHub API never returns secret values.
 *
 * GH_BIN selects the gh binary (default `gh`), for hosts where the PATH shim hangs.
 */
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Only GET endpoints are accepted; anything else is a programming error. */
function assertReadOnlyEndpoint(endpoint: unknown) {
  if (typeof endpoint !== 'string' || !/^[\w./~%?&=:,+()!*'-]+$/.test(endpoint) || endpoint.startsWith('-'))
    throw new Error(`refusing endpoint ${JSON.stringify(endpoint)}`);
  return endpoint;
}

function statusOf(text: string) {
  return Number(/\(HTTP (\d{3})\)/.exec(text)?.[1] ?? /"status":\s*"(\d{3})"/.exec(text)?.[1] ?? 0);
}

interface GitHubFailure {
  ok: false;
  status: number;
  message: string;
}
type GitHubResult<T> = {ok: true; data: T | null} | GitHubFailure;

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
