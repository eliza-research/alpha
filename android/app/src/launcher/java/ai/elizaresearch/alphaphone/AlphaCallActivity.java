package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.phone.TelecomCallActivity;

/** Alpha's native call screen (shared TelecomCallActivity); not exported, enabled only on the verified image. */
public final class AlphaCallActivity extends TelecomCallActivity {
 @Override protected String title() { return "Alpha Phone"; }
}
