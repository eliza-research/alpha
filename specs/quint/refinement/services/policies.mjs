import {fileURLToPath} from 'node:url';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {javaTraces} from '../native/java.mjs';
const app = 'android/app/src/main/java/ai/elizaresearch/alphaphone/';
const upstream = 'vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/';
export async function policyRefinement(extraSources = []) {
  const product = ['BrowserSitePermissionRecord.java', 'BrowserSitePermissions.java', 'BrowserWebOrigin.java', 'BrowserDownloadPolicy.java'].map(name => upstream + name);
  const sources = [...product, ...extraSources, fileURLToPath(import.meta.url), 'specs/quint/refinement/services/ServicePolicies.java', 'specs/quint/refinement/native/java.mjs', 'specs/quint/refinement/native/Trace.java'];
  const driverHashes = captureInputs(sources);
  const byModel = javaTraces('../services/ServicePolicies.java', product, [], 'ai.elizaresearch.alphaphone.ServicePolicies');
  const receipts = [];
  for (const [model, traces] of Object.entries(byModel)) receipts.push(await checkTraces({model, sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    model === 'BrowserSiteState' ? 'Real site-permission persistence helpers execute. Successful WebView creation is a supplied precondition, and its default disabled passkey state is unobserved here. WebView creation, Android runtime permission callbacks and HTTP prompt lifecycle remain instrumentation obligations.'
        : 'Real upstream cookie-origin and history lifecycle policies execute. Transfer bytes, MediaStore publication and capture message ordering remain native BrowserDownloads obligations.',
    'The JVM driver emits observations from actual helper results and retained state. Platform events and provider completion are explicit inputs.'
  ]}));
  return receipts;
}
