package ai.alphacompute.thinapp;

import ai.eliza.plugins.phone.TelecomCallActivity;

/** Standalone native Telecom call screen for {@code ai.alphacompute.phone}. */
public final class ThinCallActivity extends TelecomCallActivity {
    @Override protected String title() {
        return "Alpha Phone";
    }
}
