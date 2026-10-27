package com.android.provision;

/** First-run-only decisions. Android adapters own state reads/writes; saved choices remain authoritative. */
final class AlphaFreshSetupPolicy {
    private AlphaFreshSetupPolicy() {}
    static boolean eligible(boolean setupComplete, boolean managed, boolean primaryUser) {
        return !setupComplete && !managed && primaryUser;
    }
    static boolean homeVerified(boolean accepted, boolean alphaHoldsRole) {
        return accepted && alphaHoldsRole;
    }
    enum ImeResult { SKIPPED, EXISTING_CHOICE, READY, FAILED }
    interface ImePort {
        boolean eligible();
        String selected();
        String target();
        String enabled();
        boolean enableIfUnchanged(String expected, String value);
        boolean selectIfEmpty(String value);
    }
    static ImeResult ensureKeyboard(ImePort port) {
        if (!port.eligible()) return ImeResult.SKIPPED;
        String selected = port.selected();
        // A nonempty value may be an explicit choice. Never guess how it was selected.
        if (selected != null && !selected.isEmpty()) return ImeResult.EXISTING_CHOICE;
        String target = port.target();
        if (target == null || target.isEmpty()) return ImeResult.FAILED;
        String enabled = port.enabled();
        boolean contains = false;
        if (enabled != null) for (String item : enabled.split(":")) {
            if (target.equals(item.split(";", 2)[0])) contains = true;
        }
        if (!port.eligible()) return ImeResult.SKIPPED;
        selected = port.selected();
        if (selected != null && !selected.isEmpty()) return ImeResult.EXISTING_CHOICE;
        if (!contains) {
            String next = enabled == null || enabled.isEmpty() ? target : enabled + ":" + target;
            if (!port.enableIfUnchanged(enabled, next)) return ImeResult.FAILED;
        }
        if (!port.eligible()) return ImeResult.SKIPPED;
        if (!port.selectIfEmpty(target)) {
            selected = port.selected();
            return selected != null && !selected.isEmpty() ? ImeResult.EXISTING_CHOICE : ImeResult.FAILED;
        }
        return target.equals(port.selected()) ? ImeResult.READY : ImeResult.FAILED;
    }
}
