// SPDX-License-Identifier: Apache-2.0
package com.android.systemui.qs;

/** Only the enabled, preinstalled Alpha currently holding Home is a core launcher. */
public final class AlphaCoreLauncherPolicy {
    public static final String PACKAGE = "ai.alphacompute.alphaphone";
    private AlphaCoreLauncherPolicy() {}
    public static boolean protects(String name, boolean enabled, boolean preinstalled,
            boolean currentHome) {
        return PACKAGE.equals(name) && enabled && preinstalled && currentHome;
    }
}
