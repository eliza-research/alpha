package ai.elizaresearch.alphaphone;

import android.app.UiAutomation;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayDeque;

/**
 * Android's own notification shade, as instrumented tests observe it (#416, #417). Alpha draws no
 * shade: its notices are Android notifications and are opened, tapped and cleared in SystemUI.
 * The shade counts as open while SystemUI holds the active window, the same signal
 * RealClockInstrumentedTest uses for an expanded shade (measured on API 35/36 emulators only).
 */
final class AndroidShade {
 private AndroidShade() {}
 static final String SYSTEM_UI = "com.android.systemui";
 /** The page draws no Alpha notification shade at all (no stand-in outside a browser). */
 static final String ALPHA_SHADE_ABSENT = "document.querySelector('[data-alpha-layer=\"shade\"]')===null";

 /**
  * The flags of the caller's UiAutomation connection. Instrumentation.getUiAutomation(flags) drops and
  * reconnects the shared connection whenever the flags differ, and a connection without
  * FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES suspends every accessibility service. A test that holds
  * a flagged connection (AccessibilityInstrumentedTest) sets its flags
  * here for as long as it holds it, so observing the shade never unbinds a service.
  */
 private static volatile int automationFlags = 0;
 static void useAutomationFlags(int flags) { automationFlags = flags; }
 private static UiAutomation ui() { return InstrumentationRegistry.getInstrumentation().getUiAutomation(automationFlags); }
 private static boolean systemUi(AccessibilityNodeInfo node) { return node != null && SYSTEM_UI.contentEquals(node.getPackageName() == null ? "" : node.getPackageName()); }

 static boolean isOpen() { return systemUi(ui().getRootInActiveWindow()); }

 /** Polls for the expanded shade; false when it did not open within the time given. */
 static boolean waitOpen(long millis) {
  long end = SystemClock.uptimeMillis() + millis;
  do { if (isOpen()) return true; SystemClock.sleep(100); } while (SystemClock.uptimeMillis() < end);
  return false;
 }

 /** Polls until SystemUI no longer holds the active window. */
 static boolean waitClosed(long millis) {
  long end = SystemClock.uptimeMillis() + millis;
  do { if (!isOpen()) return true; SystemClock.sleep(100); } while (SystemClock.uptimeMillis() < end);
  return false;
 }

 /** Opens the shade the way a person would without Alpha: Android's own global action. */
 static boolean openWithoutAlpha() {
  return ui().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS) && waitOpen(5000);
 }

 /**
  * Collapses the shade (one Back, then the shell's statusbar command) and waits for Alpha's window.
  * Only one Back is ever sent: SystemUI keeps the active window while its collapse animation runs,
  * so a second Back sent on a slow emulator reached the app behind it instead, and the standalone
  * app's root Back finishes its task (measured on the API 36 emulator: "Alpha is in front again
  * after Android's shade closes" failed after that stray Back).
  */
 static void collapse() throws Exception {
  if (!isOpen()) return;
  ui().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
  if (waitClosed(3000)) return;
  try (java.io.InputStream done = new android.os.ParcelFileDescriptor.AutoCloseInputStream(ui().executeShellCommand("cmd statusbar collapse"))) { done.readAllBytes(); }
  if (!waitClosed(5000)) throw new AssertionError("Android's notification shade did not close");
 }

 /** The first visible SystemUI node whose text is exactly this, or null. */
 static AccessibilityNodeInfo text(String value) {
  AccessibilityNodeInfo root = ui().getRootInActiveWindow();
  if (!systemUi(root)) return null;
  ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
  queue.add(root);
  for (int seen = 0; !queue.isEmpty() && seen < 2000; seen++) {
   AccessibilityNodeInfo node = queue.remove();
   if (node.isVisibleToUser() && value.contentEquals(node.getText() == null ? "" : node.getText())) return node;
   for (int i = 0; i < node.getChildCount(); i++) { AccessibilityNodeInfo child = node.getChild(i); if (child != null) queue.add(child); }
  }
  return null;
 }

 static AccessibilityNodeInfo waitText(String value, long millis) {
  long end = SystemClock.uptimeMillis() + millis;
  do { AccessibilityNodeInfo found = text(value); if (found != null) return found; SystemClock.sleep(150); } while (SystemClock.uptimeMillis() < end);
  return null;
 }

 static final String ROW_ID = SYSTEM_UI + ":id/expandableNotificationRow";

 /** The notification row that owns this node (SystemUI's ExpandableNotificationRow), or null. */
 static AccessibilityNodeInfo ownRow(AccessibilityNodeInfo node) {
  for (int i = 0; node != null && i < 12; i++, node = node.getParent())
   if (ROW_ID.equals(node.getViewIdResourceName())) return node;
  return null;
 }

 private static boolean expandable(AccessibilityNodeInfo node) {
  for (AccessibilityNodeInfo.AccessibilityAction action : node.getActionList())
   if (action.getId() == AccessibilityNodeInfo.ACTION_EXPAND) return true;
  return false;
 }

 /**
  * Whether this row holds other notification rows, which makes it a group's summary row and never
  * one notice's own row. Clicking it is a tap on the whole group.
  */
 static boolean holdsRows(AccessibilityNodeInfo row) {
  ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
  for (int i = 0; i < row.getChildCount(); i++) { AccessibilityNodeInfo child = row.getChild(i); if (child != null) queue.add(child); }
  for (int seen = 0; !queue.isEmpty() && seen < 1000; seen++) {
   AccessibilityNodeInfo node = queue.remove();
   if (ROW_ID.equals(node.getViewIdResourceName())) return true;
   for (int i = 0; i < node.getChildCount(); i++) { AccessibilityNodeInfo child = node.getChild(i); if (child != null) queue.add(child); }
  }
  return false;
 }

 /** A row that is this one notice's own and can be clicked. */
 private static boolean ownClickable(AccessibilityNodeInfo row) { return row != null && row.isClickable() && !holdsRows(row); }

 /**
  * Taps the notification row that shows this text, as a person tapping that notice in the shade.
  * Only the notice's own row is clicked. Android 15 bundles two or more notices of one app into
  * an automatic group ("ranker_group"); while that group is collapsed its children are previews
  * inside the group's summary row, and clicking the summary is a tap on the group (measured on
  * the API 35 emulator: it dispatched no child's intent and cancelled every notice in the group).
  * So a collapsed group is expanded first, the way a person opens it, and the notice is found
  * again and tapped on its own row. A row that holds other rows (a group summary) is never
  * clicked. Returns false when no row of this notice can be tapped.
  */
 static boolean tap(AccessibilityNodeInfo node) {
  if (node == null) return false;
  CharSequence label = node.getText();
  AccessibilityNodeInfo row = ownRow(node);
  if (row == null) return false;
  if (ownClickable(row)) return row.performAction(AccessibilityNodeInfo.ACTION_CLICK);
  // The text may sit in the group's summary itself, or in a child row inside a collapsed group.
  AccessibilityNodeInfo group = holdsRows(row) ? row : ownRow(row.getParent());
  if (group == null || label == null || !expandable(group) || !group.performAction(AccessibilityNodeInfo.ACTION_EXPAND)) return false;
  long end = SystemClock.uptimeMillis() + 5000;
  do {
   SystemClock.sleep(200);
   AccessibilityNodeInfo again = ownRow(text(label.toString()));
   if (ownClickable(again)) return again.performAction(AccessibilityNodeInfo.ACTION_CLICK);
  } while (SystemClock.uptimeMillis() < end);
  return false;
 }
}
