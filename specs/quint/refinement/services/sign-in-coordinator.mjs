import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {preparePatchedNative} from '../../../../scripts/prepare-patched-native.ts';
import {root} from '../native/java.mjs';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {javaTraceCampaign} from '../native/java.mjs';
import {signInPlatform} from './sign-in-platform.mjs';

const defaultScenarios = [
  'retry', 'precommit-cancel', 'postcommit-cancel', 'ack-restart',
  'burn-failure', 'cold-burn-failure', 'cancel-burn-failure', 'failed-cancel-then-email',
  'cancel-replacement', 'unowned-cancel-replacement', 'cancel-during-callback-read', 'receipt-failure',
  'stale-read-replacement', 'cancel-then-email', 'cancel-then-phone', 'callback-cas-lost',
  'activation-overlap-pending', 'activation-overlap-receipt',
  'email-code-cap', 'phone-code-cap', 'email-mfa',
];

export async function runSignInCoordinatorRefinement(scenarios = defaultScenarios, extraSources = []) {
  const base = 'android/app/src/main/java/ai/elizaresearch/alphaphone/';
  const prepared = preparePatchedNative({root});
  const product = ['AlphaCloudSignInPlugin.java','CloudDeployment.java','PluginWorkers.java'].map(name=>base+name)
    .concat(['CloudCredentialSlots.java','CloudSignInConfig.java','CloudSignInEnvironment.java',
      'CloudSignInFlow.java','CloudSignInReadiness.java','CloudSignInRoutes.java',
      'CloudSignInPlugin.java','CloudEmailCode.java','CloudSmsCode.java','CloudKeyRevocation.java']
      .map(name=>join(prepared.root,'packages/auth/android/src/main/java/ai/eliza/auth/cloud',name)));
  const fixture = [
    'specs/quint/refinement/services/SignInTestPorts.java',
    'specs/quint/refinement/services/SignInCoordinatorTraces.java',
  ];
  const sources = [
    ...product, base + 'AlphaCredentialStore.java',
    'android/upstream-native-sources.json',...fixture,
    fileURLToPath(import.meta.url), 'specs/quint/refinement/services/sign-in-platform.mjs',
    'specs/quint/refinement/native/java.mjs', 'specs/quint/refinement/native/Trace.java', ...extraSources,
  ];
  const driverHashes = captureInputs(sources);
  const platform = signInPlatform();
  const traces = [];
  try {
    const observations = javaTraceCampaign(
      '../services/SignInCoordinatorTraces.java',
      [...product, fixture[0], ...platform.paths],
      scenarios.map(scenario => [scenario]),
      'ai.elizaresearch.alphaphone.SignInCoordinatorTraces',
    );
    traces.push(...observations.flat());
    return await checkTraces({
      model: 'IdentitySession',
      id: scenarios.length === 1 ? 'IdentitySession-' + scenarios[0] : 'IdentitySession-coordinator',
      sources,
      driverHashes,
      traces,
      scope: 'bounded-orchestration',
      assumptions: [
        'The actual patched shared CloudSignInPlugin and Alpha registration orchestrate callbacks, authorization, HTTP, persistence, acknowledgement, revocation and recovery on its own executors.',
        'Every HTTPS connection is intercepted at URL.openConnection and unmatched hosts/routes are refused. Android presentation, primitive storage and credential-intent tickets are controlled ports.',
        'Replacement and receipt-failure scenarios start with a full successful source sign-in. Burn-failure and cancellation-race scenarios begin with a fresh persisted attempt. App Link verification, Keystore and real provider behavior remain installed-integration obligations.',
      ],
    });
  } finally {
    platform.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const receipt = await runSignInCoordinatorRefinement();
  console.log(`Native sign-in coordinator passed ${receipt.traces} traces and ${receipt.checkpoints} checkpoints`);
}
