import {fileURLToPath} from 'node:url';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {preparePatchedNative} from '../../../../scripts/prepare-patched-native.mjs';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {javaTraces} from '../native/java.mjs';
import {signInPlatform} from './sign-in-platform.mjs';

const defaultScenarios = [
  'retry', 'precommit-cancel', 'postcommit-cancel', 'ack-restart',
  'burn-failure', 'cold-burn-failure', 'cancel-burn-failure', 'failed-cancel-then-email',
  'cancel-replacement', 'unowned-cancel-replacement', 'cancel-during-callback-read', 'receipt-failure',
  'stale-read-replacement', 'cancel-then-email', 'cancel-then-phone', 'callback-cas-lost',
  'activation-overlap-pending', 'activation-overlap-receipt',
];

export async function runSignInCoordinatorRefinement(scenarios = defaultScenarios, extraSources = []) {
  const base = 'android/app/src/main/java/ai/elizaresearch/alphaphone/';
  const prepared = preparePatchedNative();
  const sharedDirectory = join(prepared.root, 'packages/auth/android/src/main/java/ai/eliza/auth/cloud');
  const product = ['AlphaCloudSignInPlugin.java', 'CloudDeployment.java', 'PluginWorkers.java'].map(name => base + name)
    .concat(readdirSync(sharedDirectory).filter(name => name.endsWith('.java') && name !== 'NativeGoogleCredential.java')
      .map(name => join(sharedDirectory, name)));
  const fixture = [
    'specs/quint/refinement/services/SignInTestPorts.java',
    'specs/quint/refinement/services/SignInCoordinatorTraces.java',
  ];
  const sources = [
    ...product, base + 'AlphaCredentialStore.java', 'docs/architecture.md', ...fixture,
    'patches/eliza/native-manifest.json', 'patches/eliza/google-browser-sign-in.patch', 'scripts/prepare-patched-native.mjs',
    ...Object.keys(prepared.files).filter(name => name.startsWith('packages/auth/android/')).map(name => 'vendor/eliza/' + name),
    fileURLToPath(import.meta.url), 'specs/quint/refinement/services/sign-in-platform.mjs',
    'specs/quint/refinement/native/java.mjs', 'specs/quint/refinement/native/Trace.java', ...extraSources,
  ];
  const driverHashes = captureInputs(sources);
  const platform = signInPlatform();
  const traces = [];
  try {
    for (const scenario of scenarios) {
      traces.push(...javaTraces(
        '../services/SignInCoordinatorTraces.java',
        [...product, fixture[0], ...platform.paths],
        [scenario],
        'ai.elizaresearch.alphaphone.SignInCoordinatorTraces',
      ));
    }
    return await checkTraces({
      model: 'IdentitySession',
      id: scenarios.length === 1 ? 'IdentitySession-' + scenarios[0] : 'IdentitySession-coordinator',
      sources,
      driverHashes,
      traces,
      scope: 'bounded-orchestration',
      assumptions: [
        'The actual AlphaCloudSignInPlugin orchestrates callbacks, authorization, HTTP, persistence, acknowledgement, revocation and recovery on its own executors.',
        'Every HTTPS connection is intercepted at URL.openConnection and unmatched hosts/routes are refused. Android presentation, primitive storage and credential-intent tickets are controlled ports.',
        'Replacement and receipt-failure scenarios start with a full successful source sign-in. Burn-failure and cancellation-race scenarios begin with a fresh persisted attempt. App Link verification, Keystore and real provider behavior remain installed-integration obligations.',
      ],
    });
  } finally {
    platform.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const receipt = await runSignInCoordinatorRefinement(process.argv.length > 2 ? process.argv.slice(2) : undefined);
  console.log(`Native sign-in coordinator passed ${receipt.traces} traces and ${receipt.checkpoints} checkpoints`);
}
