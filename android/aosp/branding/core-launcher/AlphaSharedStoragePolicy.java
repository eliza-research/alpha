// SPDX-License-Identifier: Apache-2.0
package com.android.server.pm.permission;

/** Factory default for Alpha's shared Files view; an owner's existing allow/deny is retained. */
final class AlphaSharedStoragePolicy {
    static final String PACKAGE = "ai.elizaresearch.alphaphone";
    private AlphaSharedStoragePolicy() {}
    static boolean shouldGrant(int userId, String name, boolean enabledAndInstalled,
            boolean preinstalled, boolean requested, boolean unconfigured) {
        return userId == 0 && PACKAGE.equals(name) && enabledAndInstalled && preinstalled
                && requested && unconfigured;
    }
}
