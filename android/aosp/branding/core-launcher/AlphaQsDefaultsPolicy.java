// SPDX-License-Identifier: Apache-2.0
package com.android.systemui.qs.pipeline.data.repository;

import com.android.systemui.qs.AlphaCoreLauncherPolicy;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Update known stock layouts and carry the Alpha tile into the renamed package. */
public final class AlphaQsDefaultsPolicy {
    public static final String ALPHA = tile(AlphaCoreLauncherPolicy.PACKAGE);
    public static final int VERSION = 3;
    public static final String VERSION_SETTING = "alpha_qs_layout_migration_version";
    // Match saved settings from the retained pre-rename image.
    private static final String LEGACY_ALPHA = tile(String.join(".", "ai", "elizaresearch", "alphaphone"));
    private AlphaQsDefaultsPolicy() {}

    private static String tile(String packageName) {
        return "custom(" + packageName + "/.AlphaQuickSettingsTile)";
    }
    public static List<String> migrate(List<String> saved, List<String> defaults, int reviewedVersion) {
        if (shouldMigrate(saved, defaults, reviewedVersion)) return defaults;
        if (reviewedVersion >= VERSION || !defaults.contains(ALPHA) || !saved.contains(LEGACY_ALPHA)) return saved;

        List<String> migrated = new ArrayList<>();
        boolean hasCurrentTile = saved.contains(ALPHA);
        for (String tile : saved) {
            if (!tile.equals(LEGACY_ALPHA)) {
                migrated.add(tile);
            } else if (!hasCurrentTile) {
                migrated.add(ALPHA);
                hasCurrentTile = true;
            }
        }
        return migrated;
    }

    public static boolean shouldMigrate(List<String> saved, List<String> defaults, int reviewedVersion) {
        if (reviewedVersion >= VERSION || !defaults.contains(ALPHA)) return false;
        for (String stock : Arrays.asList(
                "internet,bt,dnd,cast,flashlight,airplane,rotation,wallet,alarm,controls,screenrecord,battery",
                "wifi,bt,dnd,cast,flashlight,airplane,rotation,wallet,alarm,controls,screenrecord,battery",
                "wifi,bt,cell,cast,dnd,wallet,airplane,rotation,flashlight,battery,alarm,controls,screenrecord")) {
            List<String> old = Arrays.asList(stock.split(","));
            if (saved.equals(old)) return true;
            List<String> branded = new ArrayList<>();
            branded.add(ALPHA);
            branded.addAll(old);
            if (saved.equals(branded)) return true;
            branded.set(0, LEGACY_ALPHA);
            if (saved.equals(branded)) return true;
        }
        return false;
    }
}
