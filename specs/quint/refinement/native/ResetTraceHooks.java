package ai.elizaresearch.alphaphone;

import java.util.function.BiConsumer;

/** Observation-only hooks called by the external Android fixture ports. */
public final class ResetTraceHooks {
 public static BiConsumer<String, String> observer = (kind, detail) -> {};
 public static String failWrite;
 public static String crashAfterCommit;
 public static String failDirectoryAfter;
 public static String lastCommittedName;
 public static String skipCommitFor;
 public static boolean listenerAcknowledged;
 public static boolean dispatched;
 public static boolean recoveryVisible;
 public static final class Interruption extends Error { private static final long serialVersionUID = 1L; }
 public static void initialized(){NativeSourceHost.started++;}
 public static void event(String kind, String detail) { observer.accept(kind, detail); }
 public static void listenerResult(boolean accepted) {
  listenerAcknowledged = accepted;
  event("listener-result", Boolean.toString(accepted));
 }
 public static void androidResult(boolean accepted) {
  dispatched = accepted;
  event("android-result", Boolean.toString(accepted));
 }
 public static void visibleRecovery() { recoveryVisible = true; event("recovery-visible", ""); }
}
