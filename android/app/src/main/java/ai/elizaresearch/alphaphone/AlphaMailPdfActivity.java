package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.media.IsolatedPdfRenderService;
import ai.eliza.plugins.media.IsolatedPdfViewerActivity;
import android.graphics.Color;
import android.net.Uri;

/**
 * Alpha's viewer for a reviewed PDF attachment. Displays only bounded pixels from
 * {@link IsolatedPdfService} through the shared {@link IsolatedPdfViewerActivity}; it admits only
 * the current reviewed copy under Alpha's attachment provider.
 */
public final class AlphaMailPdfActivity extends IsolatedPdfViewerActivity {
 @Override protected Class<? extends IsolatedPdfRenderService> renderer(){return IsolatedPdfService.class;}
 @Override protected boolean admits(Uri source){return AlphaMailAttachmentsPlugin.handoff(this).admits(source);}
 @Override protected String refusedSourceMessage(){return "Only the reviewed attachment can be opened.";}
 @Override protected String expiredSourceMessage(){return "The reviewed PDF expired or could not be opened. Return to Inbox and review it again.";}
 @Override protected int backgroundColor(){return Color.rgb(244,243,238);}
 @Override protected int textColor(){return Color.rgb(32,32,25);}
 @Override protected int accentColor(){return Color.rgb(57,58,203);}
}
