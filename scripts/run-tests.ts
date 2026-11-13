#!/usr/bin/env bun
// Host tests and formal conformance have separate suites; preserve one process per file.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { exitFromChild, runChild } from './child-command.ts';
import { ensureHostTestRuntime, hostTestBuilder } from './host-test-runtime.ts';

const concurrency = process.env.ALPHA_TEST_CONCURRENCY || '4';
if (!/^[1-9]\d*$/.test(concurrency)) {
  console.error('ALPHA_TEST_CONCURRENCY must be a positive integer');
  process.exit(2);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const options = { stdio: 'inherit' as const, cwd: root };
const forwarded = process.argv.slice(2);
const isSuite = (argument: string) => /\.test\.(?:mjs|ts)$/.test(argument);
const suites = forwarded.filter(isSuite);
// Bun takes path filters, not shell globs. Expand the explicit formal suite while keeping
// option values (for example --test-name-pattern NAME) separate from suite selection.
const expand = (pattern: string): string[] => {
  const absolute = resolve(root, pattern);
  if (!pattern.includes('*')) return [absolute];
  const expression = new RegExp('^' + basename(absolute).split('*')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return readdirSync(dirname(absolute)).filter(name => expression.test(name))
    .sort().map(name => resolve(dirname(absolute), name));
};
try {
  const paths = suites.length ? suites.flatMap(expand)
    : readdirSync(resolve(root, 'test')).filter(name => /\.test\.(?:mjs|ts)$/.test(name) && !name.startsWith('quint-'))
      .sort().map(name => resolve(root, 'test', name));
  if (!paths.length) throw new Error('No test files matched the selected suite');
  const builder = await hostTestBuilder(), runtime = await ensureHostTestRuntime();
  const args = ['test', `--parallel=${concurrency}`, '--timeout=600000',
    ...forwarded.filter(argument => !isSuite(argument)), ...paths];
  const inventorySha256 = createHash('sha256').update(JSON.stringify(paths)).digest('hex');
  const identity = {runtime, builder, files: paths, args, inventorySha256,
    scope: 'Host tests only; SDK, bytecode and Android build/runtime retain the builder Bun.'};
  mkdirSync(resolve(root, 'test-results'), {recursive: true});
  writeFileSync(resolve(root, 'test-results/host-test-runtime.json'), JSON.stringify(identity, null, 2) + '\n');
  console.log('Host test runtime ' + JSON.stringify({runtime, builder,
    selectedFileCount: paths.length, inventorySha256}));
  exitFromChild(await runChild(runtime.file, args, {...options,
    env: {...process.env, ALPHA_BUN: builder.file}}));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
