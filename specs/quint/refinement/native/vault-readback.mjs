import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from '../../../../scripts/sha256.ts';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {directory, javaTraceCampaign} from './java.mjs';
import {vaultReadbackPlatform, vaultResources, vaultSources} from './vault-readback-platform.mjs';

export async function checkVaultReadback(owner) {
  const harness = 'VaultReadbackTraces.java';
  const sources = [
    ...vaultSources, ...vaultResources,
    join(directory, harness), join(directory, 'Trace.java'), jsonJar, owner,
    ...['./java.mjs', './vault-readback-platform.mjs', '../observed-replay.mjs',
      '../../../../test/fixtures/jvm-tools.mjs'].map(path => fileURLToPath(new URL(path, import.meta.url))),
    fileURLToPath(import.meta.url),
  ];
  const driverHashes = captureInputs(sources);
  const platform = vaultReadbackPlatform();
  try {
    for (const path of platform.paths) driverHashes[path] = sha256(readFileSync(path));
    const scenarios = ['metadata', 'retired-reset', 'authorized-reset', 'expired-reset'];
    const traces = javaTraceCampaign(harness, [...vaultSources, ...platform.paths],
      scenarios.map(name => [name, platform.directory]), 'ai.eliza.plugins.passwords.VaultReadbackTraces');
    return await checkTraces({
      model: 'CredentialVaultReadback', id: 'CredentialVaultNativeReadback',
      traces, sources: [...sources, ...platform.paths], driverHashes, generatedSources: platform.paths, scope: 'bounded-component',
      assumptions: [
        'Whole pinned Java bridge, grant coordinator, challenge callback, encrypted frame and vault store execute on a host JVM. The platform ports provide an isolated temporary file, synthetic key registry and manually delivered authenticator callback.',
        'The renderer supplies review and lifetime inputs. Its leave is represented by the native lock call. Readback checks the bridge grant and exact temporary vault-file removal; real Android authentication, renderer listing generations, typed input, and origin/fill stay outside this replay.',
        'The native reset grant begins at the platform success callback. Model authenticateReset records review authority, so successful authentication and reset, or authentication and expiry, are compared together rather than equating those intermediate states.',
        'Metadata fields, key-invalidated classification, exact bytes retained on refusal, and the reset sibling file are independently checked by the native driver. No payload fields or credential bytes appear in model observations.',
      ],
    });
  } finally {
    platform.close();
  }
}
