#!/usr/bin/env bun
// Runs the host tests that cannot run on Bun (test/support/node-only.mjs) on a real Node.js.
// Everything else in this repository runs on Bun; Node is needed for this lane only.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Each file holds at least one case that states why with nodeOnly(reason). */
export const NODE_ONLY_TESTS = [
  // jsdom runScripts: JavaScriptCore refuses a Proxy in the global prototype chain.
  'test/quint-conformance.test.mjs',
  // Web Locks: Bun has no navigator.locks.
  'test/quint-browser-files-trash-refinement.test.mjs',
];
const MINIMUM_MAJOR = 24;

/** `bun run` puts a `node` that is Bun first on PATH; find one that is Node. */
export function realNode(): string | undefined {
  const candidates = [process.env.ALPHA_NODE, ...(process.env.PATH ?? '').split(delimiter).map(directory => join(directory, 'node'))];
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ['-p', 'process.versions.bun ? "" : process.versions.node'], { encoding: 'utf8', timeout: 5000 });
    const version = probe.status === 0 ? probe.stdout.trim() : '';
    if (version && Number(version.split('.')[0]) >= MINIMUM_MAJOR) return candidate;
  }
  return undefined;
}

if (import.meta.main) {
  const node = realNode();
  if (!node) {
    console.error(`No Node.js ${MINIMUM_MAJOR}+ on PATH (or ALPHA_NODE). These tests need it; nothing was run:\n  ${NODE_ONLY_TESTS.join('\n  ')}`);
    process.exit(1);
  }
  const result = spawnSync(node, ['--test', '--test-timeout=600000', ...process.argv.slice(2), ...NODE_ONLY_TESTS],
    { stdio: 'inherit', cwd: new URL('..', import.meta.url) });
  process.exit(result.status ?? 1);
}
