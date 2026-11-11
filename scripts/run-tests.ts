#!/usr/bin/env bun
// Host tests and formal conformance have separate suites; preserve one process per file.
import { readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitFromChild, runChild } from './child-command.ts';

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
  exitFromChild(await runChild(process.execPath, ['test', `--parallel=${concurrency}`,
    '--timeout=600000', ...forwarded.filter(argument => !isSuite(argument)), ...paths], options));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
