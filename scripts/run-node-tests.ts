#!/usr/bin/env node
// Forward npm test options to Node before the default suite paths.
import { exitFromChild, runChild } from './child-command.ts';

const concurrency = process.env.ALPHA_TEST_CONCURRENCY || '4';
if (!/^[1-9]\d*$/.test(concurrency)) {
  console.error('ALPHA_TEST_CONCURRENCY must be a positive integer');
  process.exit(2);
}

const options = { stdio: 'inherit' as const, cwd: new URL('..', import.meta.url) };
try {
  exitFromChild(await runChild(process.execPath, ['--test', `--test-concurrency=${concurrency}`,
    '--test-timeout=600000', ...process.argv.slice(2), 'test/*.test.mjs', 'test/*.test.ts'], options));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
