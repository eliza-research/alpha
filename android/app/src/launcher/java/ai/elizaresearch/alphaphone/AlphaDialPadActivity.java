package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.phone.TelecomDialPadActivity;

/**
 * ACTION_DIAL for the dialer role (shared native TelecomDialPadActivity). A number from another app
 * is shown for review; only the owner's Call press places it, through Telecom, which owns emergency
 * routing. Enabled only on the verified image.
 */
public final class AlphaDialPadActivity extends TelecomDialPadActivity {
 @Override protected String title() { return "Alpha Phone"; }
}
