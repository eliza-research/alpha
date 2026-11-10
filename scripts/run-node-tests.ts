#!/usr/bin/env node
// Forward npm test options to Node and retain the Notes query-flow campaign.
import {spawn} from 'node:child_process';

const concurrency = process.env.ALPHA_TEST_CONCURRENCY || '4';
if (!/^[1-9]\d*$/.test(concurrency)) {
  console.error('ALPHA_TEST_CONCURRENCY must be a positive integer');
  process.exit(2);
}
const options = {stdio: 'inherit' as const, cwd: new URL('..', import.meta.url)};
let child = spawn(process.execPath, ['--test', `--test-concurrency=${concurrency}`,
  '--test-timeout=600000', ...process.argv.slice(2), 'test/*.test.mjs', 'test/*.test.ts'], options);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => { if (!child.killed) child.kill(signal); });
}
function failed(error: any) {
  console.error(error.message);
  process.exit(1);
}
function finish(code: any, signal: any) {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  } else process.exit(code ?? 1);
}
child.on('error', failed);
child.on('exit', (code: any, signal: any) => {
  if (signal || code !== 0) return finish(code, signal);
  child = spawn(process.execPath, ['--import=tsx', 'scripts/test-notes-query-flow.ts'], options);
  child.on('error', failed);
  child.on('exit', finish);
});
