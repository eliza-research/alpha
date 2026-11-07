import {fileURLToPath} from 'node:url';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {javaTraces} from '../native/java.mjs';
const app = 'android/app/src/main/java/ai/elizaresearch/alphaphone/';
const upstream = 'vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/';
export async function policyRefinement() {
  const product = [app + 'CloudDeployment.java', app + 'CloudSignInFlow.java', app + 'BrowserPermissionRecords.java', app + 'BrowserPasskeys.java', upstream + 'BrowserSitePermissions.java', upstream + 'BrowserWebOrigin.java', upstream + 'BrowserDownloadPolicy.java'];
  const sources = [...product, fileURLToPath(import.meta.url), 'specs/quint/refinement/services/ServicePolicies.java', 'specs/quint/refinement/native/java.mjs', 'specs/quint/refinement/native/Trace.java'];
  const driverHashes = captureInputs(sources);
  const byModel = javaTraces('../services/ServicePolicies.java', product, [], 'ai.elizaresearch.alphaphone.ServicePolicies');
  const receipts = [];
  for (const [model, traces] of Object.entries(byModel)) receipts.push(await checkTraces({model, sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    model === 'IdentitySession' ? 'Real Pending serialization, callback parsing and expiry/state match execute. Native plugin consumption, key/receipt persistence and acknowledgement still need orchestration instrumentation.'
      : model === 'BrowserSiteState' ? 'Real passkey readback and site-permission persistence helpers execute. WebView creation, Android runtime permission callbacks and HTTP prompt lifecycle remain instrumentation obligations.'
        : 'Real upstream cookie-origin and history lifecycle policies execute. Transfer bytes, MediaStore publication and capture message ordering remain native BrowserDownloads obligations.',
    'The JVM driver emits observations from actual helper results and retained state. Platform events and provider completion are explicit inputs.'
  ]}));
  return receipts;
}
