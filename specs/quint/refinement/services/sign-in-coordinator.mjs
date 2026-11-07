import {fileURLToPath} from 'node:url';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {javaTraces} from '../native/java.mjs';
import {signInPlatform} from './sign-in-platform.mjs';

const defaultScenarios = [
  'retry', 'precommit-cancel', 'postcommit-cancel', 'ack-restart',
  'burn-failure', 'cold-burn-failure', 'cancel-burn-failure',
  'cancel-replacement', 'unowned-cancel-replacement', 'cancel-during-callback-read', 'receipt-failure',
];

export async function runSignInCoordinatorRefinement(scenarios = defaultScenarios) {
  const base = 'android/app/src/main/java/ai/elizaresearch/alphaphone/';
  const product = [
    'AlphaCloudSignInPlugin.java', 'CloudSignInFlow.java', 'CloudSignInReadiness.java',
    'CloudDeployment.java', 'CloudEmailCode.java', 'CloudSmsCode.java',
    'CloudKeyRevocation.java', 'ConnectionRoutes.java',
  ].map(name => base + name);
  const fixture = [
    'specs/quint/refinement/services/SignInTestPorts.java',
    'specs/quint/refinement/services/SignInCoordinatorTraces.java',
  ];
  const sources = [
    ...product, base + 'AlphaCredentialStore.java', 'docs/architecture.md', ...fixture,
    fileURLToPath(import.meta.url), 'specs/quint/refinement/services/sign-in-platform.mjs',
    'specs/quint/refinement/native/java.mjs', 'specs/quint/refinement/native/Trace.java',
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
  const receipt = await runSignInCoordinatorRefinement();
  console.log(`Native sign-in coordinator passed ${receipt.traces} traces and ${receipt.checkpoints} checkpoints`);
}
