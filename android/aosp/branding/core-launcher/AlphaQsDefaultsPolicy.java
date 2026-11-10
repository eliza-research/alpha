// SPDX-License-Identifier: Apache-2.0
package com.android.systemui.qs.pipeline.data.repository;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Update only known old stock layouts. Every other saved layout remains the owner's. */
public final class AlphaQsDefaultsPolicy {
    public static final String ALPHA = "custom(ai.elizaresearch.alphaphone/.AlphaQuickSettingsTile)";
    public static final int VERSION = 2;
    public static final String VERSION_SETTING = "alpha_qs_layout_migration_version";
    private static final String LEGACY_ALPHA = "custom(ai.alphacompute.alphaphone/.AlphaQuickSettingsTile)";
    private AlphaQsDefaultsPolicy() {}
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
