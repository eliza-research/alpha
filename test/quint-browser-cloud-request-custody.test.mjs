import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs, captureInputs, checkTraces, qmap, qset} from '../specs/quint/refinement/check-traces.mjs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {buildSync} from 'esbuild';

const root = resolve(fileURLToPath(new URL('../specs/quint/refinement/services', import.meta.url)), '../../../..');
const bridge = 'scripts/browser-cloud-dev-bridge.ts';
const probe = fileURLToPath(new URL('../specs/quint/refinement/services/browser-cloud-request-custody-probe.mjs', import.meta.url));

function observations({dispatched, pending, aborted, closed, status}) {
  const statuses = new Map(status);
  return {
    's.dispatched': qset(dispatched), 's.pending': qset(pending),
    's.aborted': qset(aborted), 's.closed': qset(closed),
    's.status': qmap([1,2,3,4].map(generation => [generation, statuses.get(generation) ?? 0])),
  };
}

async function checkBrowserCloudRequestCustody(extraSources = []) {
  const graph = buildSync({absWorkingDir: root, entryPoints: [bridge], bundle: true, packages: 'external',
    platform: 'node', format: 'esm', write: false, metafile: true}).metafile.inputs;
  const sources = [...new Set([
    ...Object.keys(graph), bridge, probe, fileURLToPath(import.meta.url),
    'scripts/cloud-deployment-policy.ts', 'scripts/native-view-policy.ts',
    'package.json', 'bun.lock', 'tsconfig.json', ...extraSources,
  ])];
  const driverHashes = captureInputs(sources);
  const result = spawnSync(process.execPath, [probe, 'current'], {
    cwd: root, encoding: 'utf8', timeout: scaledTimeout(10000), maxBuffer: 1024*1024,
    env: {PATH: '/usr/bin:/bin', TSX_DISABLE_CACHE: '1'},
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  const traces = JSON.parse(result.stdout).map(({name, initial, steps}) => ({
    name, expect: observations(initial), steps: steps.map(({label, name, args, state}) =>
      ({label, action: {name, args}, expect: observations(state)})),
  }));
  return checkTraces({model: 'BrowserCloudRequestCustody', scope: 'bounded-orchestration', sources, driverHashes, traces,
    assumptions: [
      'Exact createBrowserCloudDevHandler executes on closed request and response objects. Only public entitlement-key GET reaches the closed fetch port. The bridge profile filesystem is fenced and no socket, provider, credentials or real service is used.',
      'The injected port can hold its result after abort. Observations use the captured AbortSignal and source close listener as well as actual responses. Active map membership and request-slot identity are private and checked indirectly through duplicate admission and targeted cancellation.',
      'Two opaque IDs and four invocation identities bound the campaign. Authenticated routes, real HTTP lifecycle, process restarts, sign-in attempts and provider-side effects remain separate.',
    ]});
}

test('browser Cloud retains the exact active request across duplicate rejection and late completion', async () => {
  const receipt = await checkBrowserCloudRequestCustody([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 3);
  assert.equal(receipt.checkpoints, 25);
  assert.ok(receipt.passed && receipt.driverInputsBound && verifyRefinementReceiptInputs(receipt));
});
