// SPDX-License-Identifier: Apache-2.0
package com.android.systemui.qs.pipeline.data.repository;

import com.android.systemui.qs.AlphaCoreLauncherPolicy;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Update known stock layouts once; owner layouts are kept. */
public final class AlphaQsDefaultsPolicy {
    public static final String ALPHA = tile(AlphaCoreLauncherPolicy.PACKAGE);
    public static final int VERSION = 3;
    public static final String VERSION_SETTING = "alpha_qs_layout_migration_version";
    private static final int STOCK_LAYOUT_VERSION = 2;
    private AlphaQsDefaultsPolicy() {}

    private static String tile(String packageName) {
        return "custom(" + packageName + "/.AlphaQuickSettingsTile)";
    }
    public static List<String> migrate(List<String> saved, List<String> defaults, int reviewedVersion) {
        return shouldMigrate(saved, defaults, reviewedVersion) ? defaults : saved;
    }

    public static boolean shouldMigrate(List<String> saved, List<String> defaults, int reviewedVersion) {
        if (reviewedVersion >= STOCK_LAYOUT_VERSION || !defaults.contains(ALPHA)) return false;
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
        }
        return false;
    }
}
