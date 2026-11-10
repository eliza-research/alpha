package ai.elizaresearch.alphaphone;

import android.content.Intent;
import android.graphics.drawable.Icon;

import ai.eliza.plugins.system.AssistantEntryTile;

/**
 * An explicit assistant entry, not a connection indicator or a microphone toggle. The shared
 * AssistantEntryTile (plugin-native-system) keeps the tile inactive, waits for unlock on a locked
 * device and opens one immutable entry; Alpha supplies only its entry, wording and icon under
 * this installed component name.
 */
public final class AlphaQuickSettingsTile extends AssistantEntryTile {
    /** The existing assist entry sanitizes all incoming context and retains account and microphone
     * admission. Opening it does not grant permissions or start voice capture. */
    @Override protected Intent entryIntent() {
        return new Intent(this, AlphaAssistActivity.class)
                .setAction(Intent.ACTION_ASSIST)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    }

    @Override protected CharSequence label() {
        return getString(R.string.alpha_quick_settings_label);
    }

    @Override protected CharSequence subtitle(boolean locked) {
        return getString(locked ? R.string.alpha_quick_settings_locked : R.string.alpha_quick_settings_open);
    }

    @Override protected CharSequence contentDescription() {
        return getString(R.string.alpha_quick_settings_description);
    }

    @Override protected Icon icon() {
        return Icon.createWithResource(this, R.drawable.notification_icon);
    }

    @Override protected int requestCode() {
        return 41;
    }
}
