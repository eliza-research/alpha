package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.media.IsolatedPdfRenderService;
import android.os.Bundle;

/**
 * Alpha's isolated PDF renderer component (manifest name {@code .IsolatedPdfService}, process
 * {@code :isolated_pdf}). Rendering, limits and the watchdog are the shared
 * {@link IsolatedPdfRenderService} (elizaOS plugin-native-media); only development builds admit
 * the watchdog fixture that stalls a request past the deadline.
 */
public final class IsolatedPdfService extends IsolatedPdfRenderService {
 @Override protected boolean stallFixture(Bundle request){return BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS&&"watchdog".equals(request.getString("fixture"));}
}
