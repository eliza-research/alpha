import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import {captureInputs, checkTraces, qmap} from '../check-traces.mjs';
import {serviceInputs} from './source-inputs.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const probe = fileURLToPath(new URL('./gmail-agent-mailbox-recovery-probe.mjs', import.meta.url));
const observations = row => ({...row, 's.durable': qmap(row['s.durable'])});

export async function checkGmailAgentMailboxRecovery(extraSources = []) {
  const graph = buildSync({absWorkingDir: root, entryPoints: [probe], bundle: true, packages: 'external',
    platform: 'node', format: 'esm', write: false, metafile: true}).metafile.inputs;
  const sources = serviceInputs([...Object.keys(graph), fileURLToPath(import.meta.url), probe,
    'vendor/eliza/plugins/plugin-inbox/src/mailbox/managed-gmail-client.ts',
    'scripts/prepare-client-features.ts', 'upstream.lock.json', 'package.json', 'bun.lock', 'tsconfig.json',
    ...extraSources]);
  const driverHashes = captureInputs(sources);
  const run = spawnSync(process.execPath, [probe], {
    cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 2*1024*1024,
    env: {PATH: '/usr/bin:/bin', TSX_DISABLE_CACHE: '1'},
  });
  if (run.error) throw run.error;
  assert.equal(run.status, 0, run.stderr);
  const traces = JSON.parse(run.stdout).map(trace => ({
    ...trace, expect: observations(trace.expect),
    steps: trace.steps.map(step => ({...step, expect: observations(step.expect)})),
  }));
  return checkTraces({model: 'GmailAgentMailboxRecovery', scope: 'bounded-orchestration', sources, driverHashes, traces,
    assumptions: [
      'Actual shared gmailAgentMailbox, managed Google client and staged upstream Gmail client execute against an in-memory request and read-only opaque reference port. No socket, credential file, native plugin or real provider is used.',
      'The fixture binds the exact selected grant, message, turn, expected history and review digest from the actual wire arguments. Prepared and terminal durable receipt rows are port inputs, with two representative IDs and up to two sequential invocations.',
      'No non-prepared prior receipt is resubmitted. A prior prepared receipt can be reviewed again. This campaign checks caller dispatch count and recovery order, without assuming provider exactly-once or installed-account effects.',
    ]});
}
