package com.android.role.controller.service;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/** One preserving transition, serialized with the role controller's normal requests. */
final class AlphaRoleUpgrade {
    static final String ALPHA = "ai.alphacompute.alphaphone";
    static final String PREVIOUS = "ai.elizaresearch.alphaphone";
    static final List<String> ROLES = Collections.unmodifiableList(Arrays.asList(
            "android.app.role.HOME", "android.app.role.DIALER", "android.app.role.SMS"));
    static final String PENDING = "pending";
    static final String DONE = "done";

    interface Port {
        boolean eligible();
        boolean qualified(String role);
        List<String> holders(String role);
        String state(String role);
        boolean save(String role, String state);
        boolean adopt(String role);
        boolean restorePrevious(String role);
    }

    private AlphaRoleUpgrade() {}

    static boolean run(Port port) {
        if (!port.eligible()) return true;
        for (String role : ROLES) {
            if (DONE.equals(port.state(role))) continue;
            List<String> holders = port.holders(role);
            if (holders.equals(Collections.singletonList(ALPHA))) {
                if (!port.save(role, DONE)) return false;
                continue;
            }
            boolean recovery = PENDING.equals(port.state(role)) && holders.isEmpty();
            if (!holders.equals(Collections.singletonList(PREVIOUS)) && !recovery) {
                if (!port.save(role, DONE)) return false;
                continue;
            }
            if (!port.eligible() || !port.qualified(role)) return false;
            if (!port.save(role, PENDING)) return false;
            // Recheck after the durable intent. The platform worker also serializes owner requests.
            if (!port.eligible() || !port.holders(role).equals(holders)) {
                return false;
            }
            boolean adopted;
            try {
                adopted = port.adopt(role);
            } catch (RuntimeException failure) {
                if (port.holders(role).isEmpty()) port.restorePrevious(role);
                throw failure;
            }
            if (!adopted || !port.holders(role).equals(Collections.singletonList(ALPHA))) {
                if (port.holders(role).isEmpty()) port.restorePrevious(role);
                return false;
            }
            if (!port.save(role, DONE)) return false;
        }
        return true;
    }
}
