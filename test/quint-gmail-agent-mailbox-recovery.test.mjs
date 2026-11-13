import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs, captureInputs, checkTraces, qmap} from '../specs/quint/refinement/check-traces.mjs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {buildSync} from 'esbuild';
import {serviceInputs} from '../specs/quint/refinement/services/source-inputs.mjs';

const root = resolve(fileURLToPath(new URL('../specs/quint/refinement/services', import.meta.url)), '../../../..');
const probe = fileURLToPath(new URL('../specs/quint/refinement/services/gmail-agent-mailbox-recovery-probe.mjs', import.meta.url));
const observations = row => ({...row, 's.durable': qmap(row['s.durable'])});

async function checkGmailAgentMailboxRecovery(extraSources = []) {
  const graph = buildSync({absWorkingDir: root, entryPoints: [probe], bundle: true, packages: 'external',
    platform: 'node', format: 'esm', write: false, metafile: true}).metafile.inputs;
  const sources = serviceInputs([...Object.keys(graph), fileURLToPath(import.meta.url), probe,
    'vendor/eliza/plugins/plugin-inbox/src/mailbox/managed-gmail-client.ts',
    'scripts/prepare-client-features.ts', 'upstream.lock.json', 'package.json', 'bun.lock', 'tsconfig.json',
    ...extraSources]);
  const driverHashes = captureInputs(sources);
  const run = spawnSync(process.execPath, [probe], {
    cwd: root, encoding: 'utf8', timeout: scaledTimeout(10000), maxBuffer: 2*1024*1024,
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

test('Gmail agent mailbox confirms the exact review and only reads back a lost dispatch', {timeout: scaledTimeout(30000)}, async () => {
  const receipt = await checkGmailAgentMailboxRecovery([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 45);
  assert.equal(receipt.checkpoints, 299);
  assert.ok(receipt.passed && receipt.driverInputsBound && verifyRefinementReceiptInputs(receipt));
  const outcome = name => receipt.traceInputs.find(trace => trace.name === name).steps.at(-1).expect;
  assert.equal(outcome('lost success reads one receipt and repeat stays read-only')['s.totalDispatches'], 1);
  assert.equal(outcome('lost uncertain reply never resubmits a durable unknown')['s.result'], 'unconfirmed');
  assert.equal(outcome('readback abort preserves first dispatch error')['s.result'], 'dispatch-error');
  assert.equal(outcome('abort before dispatch transport')['s.totalDispatches'], 0);
});
