#!/usr/bin/env node
// Run module checks before the long complete campaigns, retaining every test and the Notes flow.
import {spawn} from 'node:child_process';
import {readdirSync} from 'node:fs';

const concurrency = process.env.ALPHA_TEST_CONCURRENCY || '4';
if (!/^[1-9]\d*$/.test(concurrency)) {
  console.error('ALPHA_TEST_CONCURRENCY must be a positive integer');
  process.exit(2);
}
const campaigns = new Set([
  'quint-application-refinement.test.mjs',
  'quint-native-refinement.test.mjs',
  'quint-services-refinement.test.mjs',
]);
const files = readdirSync(new URL('../test/', import.meta.url)).filter(file => file.endsWith('.test.mjs')).sort();
const testArgs = names => ['--test', `--test-concurrency=${concurrency}`, '--test-timeout=600000', ...process.argv.slice(2), ...names.map(name => `test/${name}`)];
const phases = [
  testArgs(files.filter(file => !campaigns.has(file))),
  testArgs(files.filter(file => campaigns.has(file))),
  ['--import=tsx', 'scripts/test-notes-query-flow.ts'],
];
const options = {stdio: 'inherit', cwd: new URL('..', import.meta.url)};
let child;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { if (child && !child.killed) child.kill(signal); });
}
function finish(code, signal) {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  } else process.exit(code ?? 1);
}
function run(index) {
  if (index === phases.length) return finish(0);
  child = spawn(process.execPath, phases[index], options);
  child.on('error', error => { console.error(error.message); process.exit(1); });
  child.on('exit', (code, signal) => {
    if (signal || code !== 0) return finish(code, signal);
    run(index + 1);
  });
}
run(0);
