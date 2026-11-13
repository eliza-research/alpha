#!/usr/bin/env bun
// Runs the host tests that need Node.js platform features (test/support/node-only.mjs).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { scaledTimeout } from '../specs/quint/refinement/timeouts.mjs';

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
  for (const candidate of (process.env.PATH ?? '').split(delimiter).map(directory => join(directory, 'node'))) {
    if (!existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ['-p', 'process.versions.bun ? "" : process.versions.node'], { encoding: 'utf8', timeout: scaledTimeout(5000) });
    const version = probe.status === 0 ? probe.stdout.trim() : '';
    if (version && Number(version.split('.')[0]) >= MINIMUM_MAJOR) return candidate;
  }
  return undefined;
}

if (import.meta.main) {
  const node = realNode();
  if (!node) {
    console.error(`No Node.js ${MINIMUM_MAJOR}+ on PATH. These tests need it; nothing was run:\n  ${NODE_ONLY_TESTS.join('\n  ')}`);
    process.exit(1);
  }
  const result = spawnSync(node, ['--test', `--test-timeout=${scaledTimeout(600000)}`, ...process.argv.slice(2), ...NODE_ONLY_TESTS],
    { stdio: 'inherit', cwd: new URL('..', import.meta.url) });
  process.exit(result.status ?? 1);
}
