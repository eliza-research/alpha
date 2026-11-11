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
// Bun treats positional arguments as path filters; with none, run the whole host suite.
const paths = forwarded.some(argument => !argument.startsWith('-'))
  ? []
  : readdirSync(new URL('test/', root)).filter(name => /\.test\.(?:mjs|ts)$/.test(name)).sort().map(name => `./test/${name}`);
try {
  exitFromChild(await runChild(process.execPath, ['test', `--parallel=${concurrency}`,
    '--timeout=600000', ...forwarded, ...paths], options));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
