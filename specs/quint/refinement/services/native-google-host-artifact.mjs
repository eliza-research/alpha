import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {coreStateReceipt} from '../../../../scripts/core-state-patch.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const repository = resolve(import.meta.dirname, '../../../..');
const probe = join(import.meta.dirname, 'native-google-host-artifact-probe.mjs');

function runProbe(args = []) {
  // Node reports the physical cwd on macOS; pass the same owned directory to the probe.
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'quint-native-google-host-')));
  try {
    const home = join(scratch, 'home');
    mkdirSync(home, {mode: 0o700});
    const identity = {NAME: 'Fixture', EMAIL: 'fixture@example.invalid'};
    const result = spawnSync(process.execPath, [probe, scratch, ...args], {
      cwd: scratch, encoding: 'utf8', maxBuffer: 2*1024*1024, timeout: 90000,
      env: {PATH: '/usr/bin:/bin', HOME: home, TMPDIR: scratch, GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_ALLOW_PROTOCOL: 'file',
        GIT_AUTHOR_NAME: identity.NAME, GIT_AUTHOR_EMAIL: identity.EMAIL,
        GIT_COMMITTER_NAME: identity.NAME, GIT_COMMITTER_EMAIL: identity.EMAIL},
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {rmSync(scratch, {recursive: true, force: true});}
}

export function checkNativeGoogleHostLoaderCompatibility(bun) {
  return runProbe([resolve(bun)]);
}

export async function checkNativeGoogleHostArtifact(extraSources = []) {
  const core = coreStateReceipt(repository);
  const sources = [
    fileURLToPath(import.meta.url), probe, 'test/fixtures/native-google-host-builder-port.mjs', 'test/fixtures/core-state-root.mjs',
    'scripts/native-google-host-artifact.mjs', 'scripts/build-native-google-host.ts', 'scripts/workflow-worker-artifact.mjs',
    'scripts/local-agent-source.mjs', 'scripts/copy-file-clone.mjs', 'scripts/prepare-client-features.mjs',
    'package.json', 'tsconfig.json', 'upstream.lock.json', 'vendor/eliza/tsconfig.json',
    'vendor/eliza/packages/app/scripts/lib/immutable-workspace-source.mjs',
    'vendor/eliza/packages/app/scripts/lib/committed-source.mjs',
    ...Object.keys(core.inputHashes), ...Object.keys(core.files).map(name => 'vendor/eliza/'+name),
    ...extraSources,
  ];
  const driverHashes = captureInputs(sources);
  for (const [name, digest] of Object.entries(core.inputHashes)) assert.equal(driverHashes[resolve(repository,name)], digest);
  const traces = runProbe();
  return checkTraces({model: 'NativeGoogleHostArtifact', sources, driverHashes, traces, scope: 'bounded-orchestration',
    assumptions: [
      'The actual native Google host artifact producer wrapper, TypeScript builder, immutable SDK verification and worker/host readback execute with a synthetic Git SDK and private worker output. Client projection, compiler output and version are controlled ports.',
      'The compiler port invokes actual resolver, source capture and selected core interception callbacks. Output embeds the digest of the bytes those callbacks returned, while the actual wrapper validates the exact source binding and candidate.',
      'One product input, two file identities, one selected worker output and one representative optional core transform. The other generic worker inputs remain fixed.',
      'Build outcomes group actual port events and definite serial publication refusals. The old pair is checked by exact bytes and mode. Concurrent writers, crash recovery, full product compiler graph, Android staging and installed host execution remain separate.',
    ]});
}
