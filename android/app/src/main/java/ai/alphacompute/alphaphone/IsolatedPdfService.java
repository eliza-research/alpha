package ai.alphacompute.alphaphone;

import ai.eliza.plugins.media.IsolatedPdfRenderService;

/**
 * Alpha's isolated PDF renderer component (manifest name {@code .IsolatedPdfService}, process
 * {@code :isolated_pdf}). Rendering, limits and the watchdog are the shared
 * {@link IsolatedPdfRenderService} (elizaOS plugin-native-media), with no stall fixture.
 */
public final class IsolatedPdfService extends IsolatedPdfRenderService {
}
