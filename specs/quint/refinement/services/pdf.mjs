import {fileURLToPath} from 'node:url';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {javaTraces} from '../native/java.mjs';
import {pdfPlatform} from './pdf-platform.mjs';
export async function pdfRefinement() {
  const product = ['android/app/src/main/java/ai/elizaresearch/alphaphone/IsolatedPdfService.java',
    ...['IsolatedPdfRenderService.java', 'PdfPageLimits.java'].map(name => 'vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/' + name)];
  const sources = [...product, fileURLToPath(import.meta.url), 'specs/quint/refinement/services/ServicePdfTraces.java', 'specs/quint/refinement/services/pdf-platform.mjs', 'specs/quint/refinement/native/java.mjs', 'specs/quint/refinement/native/Trace.java'];
  const driverHashes = captureInputs(sources), platform = pdfPlatform();
  try {
    const traces = javaTraces('../services/ServicePdfTraces.java', [...product, ...platform.paths], [], 'ai.elizaresearch.alphaphone.ServicePdfTraces');
    return await checkTraces({model: 'PdfWorker', sources, driverHashes, traces, scope: 'bounded-component', assumptions: ['Actual IsolatedPdfService request handler and render/finally/main-reply code execute against controlled Android primitive ports.', 'The test observes real busy CAS rejection, refused descriptor cleanup, bitmap/mapping cleanup, protection outcome and producer output close.', 'Platform ports do not establish kernel isolation, real PDF decoding, descriptor duplication, memory-pressure kill or watchdog process death. Existing Android instrumentation must discharge those obligations.']});
  } finally { platform.close(); }
}
