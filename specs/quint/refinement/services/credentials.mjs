import {fileURLToPath} from 'node:url';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {javaTraces} from '../native/java.mjs';
import {credentialPlatform} from './credential-platform.mjs';
export async function credentialRefinement() {
  const base = 'android/app/src/main/java/ai/elizaresearch/alphaphone/';
  const product = ['AlphaCredentialStore.java', 'LocalAgentProviderAdmission.java', 'CloudDeployment.java', 'LegacyCloudRecovery.java', 'GoogleWorkspaceReturn.java'].map(name => base + name).concat('vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProviderAdmission.java');
  const sources = [...product, fileURLToPath(import.meta.url), 'specs/quint/refinement/services/ServiceCredentialTraces.java', 'specs/quint/refinement/services/credential-platform.mjs', 'specs/quint/refinement/native/java.mjs', 'specs/quint/refinement/native/Trace.java'];
  const driverHashes = captureInputs(sources), platform = credentialPlatform();
  try {
    const traces = javaTraces('../services/ServiceCredentialTraces.java', [...product, ...platform.paths], [], 'ai.elizaresearch.alphaphone.ServiceCredentialTraces');
    return await checkTraces({model: 'NativeCredentialMutation', sources, driverHashes, traces, scope: 'bounded-component', assumptions: ['Actual AlphaCredentialStore class executes its mutation classification, before/provider recheck, admission stripping, and byte-cap preflight.', 'In-memory slot primitives and an immediate lifecycle callback are controlled ports. Shutdown confirmation steps are environmental preconditions, not observations of AlphaLocalAgentPlugin.', 'Encrypted storage durability, asynchronous shutdown and lock interleavings still require native orchestration tests.']});
  } finally { platform.close(); }
}
