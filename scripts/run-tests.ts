#!/usr/bin/env bun
// Forward `bun run test` options to Bun's test runner before the default suite paths.
// Each file runs in its own worker process, as the suite was written for.
import { readdirSync } from 'node:fs';
import { exitFromChild, runChild } from './child-command.ts';

const concurrency = process.env.ALPHA_TEST_CONCURRENCY || '4';
if (!/^[1-9]\d*$/.test(concurrency)) {
  console.error('ALPHA_TEST_CONCURRENCY must be a positive integer');
  process.exit(2);
}

const root = new URL('..', import.meta.url);
const options = { stdio: 'inherit' as const, cwd: root };
const forwarded = process.argv.slice(2);
const flagsWithValue = new Set([
  '--timeout', '--rerun-each', '--retry', '--seed', '--coverage-reporter', '--coverage-dir',
  '-t', '--test-name-pattern', '--reporter', '--reporter-outfile', '--max-concurrency',
  '--path-ignore-patterns', '--parallel-delay', '--shard', '--timings',
]);
// Keep test discovery within the host suite unless the caller supplied a path filter.
const hasPathFilter = forwarded.some((argument, index) =>
  !argument.startsWith('-') && !flagsWithValue.has(forwarded[index - 1]));
const paths = hasPathFilter
  ? []
  : readdirSync(new URL('test/', root)).filter(name => /\.test\.(?:mjs|ts)$/.test(name)).sort().map(name => `./test/${name}`);
try {
  exitFromChild(await runChild(process.execPath, ['test', `--parallel=${concurrency}`,
    '--timeout=600000', ...forwarded, ...paths], options));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
