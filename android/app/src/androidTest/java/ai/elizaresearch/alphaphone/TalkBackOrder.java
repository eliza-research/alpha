package ai.elizaresearch.alphaphone;

import static org.junit.Assert.*;

import android.graphics.Rect;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.Configurator;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * The TalkBack linear-order check of the app window, shared by the accessibility classes
 * (AccessibilityInstrumentedTest, AccessibilityViewsInstrumentedTest,
 * AccessibilityLifecycleInstrumentedTest): every actionable node TalkBack reaches has a label, is
 * not clipped off-screen, and appears in reading order; the floating assistant controls form at
 * most one group, read after the app content. test/browser/accessibility-audit.ts
 * (auditReadingOrder) makes the same check in Chromium for every view of the browser sweep.
 *
 * It reads the tree with the UiAutomation flags the caller configured (Configurator), so a test
 * that keeps accessibility services bound (AccessibilityInstrumentedTest's stand-in screen
 * reader) is not reconnected without them. Emulator evidence only.
 */
final class TalkBackOrder {
 private TalkBackOrder() {}
 /** The accessible name of the one group that holds the floating assistant controls. */
 static final String ASSISTANT_GROUP = "Assistant controls";
 /** What the surface must show of the assistant controls. */
 enum Assistant {
  /** Home, Settings, the composer: the group is exposed once and read last. */
  REQUIRED_LAST,
  /** A surface that replaces the phone (the required Cloud sign-in page): no group is exposed behind it. */
  ABSENT,
  /** An app view: if a group is exposed, there is one and it is read last. */
  LAST_IF_PRESENT,
 }
 /** What one read found. Problems are failures; the counts let callers add their own checks. */
 static final class Result {
  final List<String> problems = new ArrayList<>();
  int actionable;
  int groups;
  boolean seenAssistant;
 }
 private static android.app.UiAutomation automation() {
  return InstrumentationRegistry.getInstrumentation().getUiAutomation(Configurator.getInstance().getUiAutomationFlags());
 }
 private static String js(String code) throws Exception { return WebViewTestDriver.evaluate(code); }

 /** Actionable or labelled leaf nodes in accessibility-tree (TalkBack linear) order. */
 static void collect(UiObject2 node, List<UiObject2> out) {
  List<UiObject2> children = node.getChildren();
  boolean actionable = node.isClickable() || node.isCheckable() || node.isLongClickable();
  String label = (node.getText() == null ? "" : node.getText()) + (node.getContentDescription() == null ? "" : node.getContentDescription());
  if (actionable || (children.isEmpty() && !label.trim().isEmpty())) out.add(node);
  for (UiObject2 child : children) collect(child, out);
 }
 /** Failure evidence uses raw AX rectangles as well as UiAutomator's visible bounds. The
  * pinned UiAutomator helper retains the original rectangle when intersection is empty. */
 private static android.view.accessibility.AccessibilityNodeInfo geometryNode(android.view.accessibility.AccessibilityNodeInfo node, String label, int depth) {
  if (node == null || depth > 60) return null;
  if (label.contentEquals(node.getText() == null ? "" : node.getText()) || label.contentEquals(node.getContentDescription() == null ? "" : node.getContentDescription())) return node;
  for (int i = 0; i < node.getChildCount(); i++) { android.view.accessibility.AccessibilityNodeInfo found = geometryNode(node.getChild(i), label, depth + 1); if (found != null) return found; }
  return null;
 }
 static String accessibilityGeometry(String label) {
  android.view.accessibility.AccessibilityNodeInfo root = automation().getRootInActiveWindow();
  android.view.accessibility.AccessibilityNodeInfo node = geometryNode(root, label, 0);
  StringBuilder out = new StringBuilder(label);
  for (int depth = 0; node != null && depth < 16; depth++, node = node.getParent()) {
   Rect raw = new Rect(); node.getBoundsInScreen(raw);
   out.append(" < ").append(node.getClassName()).append(" raw=").append(raw.toShortString())
    .append(" scrollable=").append(node.isScrollable()).append(" visible=").append(node.isVisibleToUser());
  }
  return out.toString();
 }
 /** UiAutomator 2.3.0 keeps a nonempty rectangle when intersection with a scrollable
  * ancestor fails. Intersect explicitly so fully clipped descendants do not masquerade as
  * visible controls; partially visible nodes keep only their painted area. */
 static Rect visibleBounds(UiObject2 node, UiDevice device) {
  Rect bounds = node.getVisibleBounds(); List<int[]> frames = new ArrayList<>();
  frames.add(new int[]{0, 0, device.getDisplayWidth(), device.getDisplayHeight()});
  for (UiObject2 parent = node.getParent(); parent != null; parent = parent.getParent()) if (parent.isScrollable()) {
   Rect frame = parent.getVisibleBounds(); frames.add(new int[]{frame.left, frame.top, frame.right, frame.bottom});
  }
  int[] clipped = AccessibilityBounds.clip(new int[]{bounds.left, bounds.top, bounds.right, bounds.bottom}, frames);
  return new Rect(clipped[0], clipped[1], clipped[2], clipped[3]);
 }
 /** A named semantic group, not a geometry/class exception for arbitrary controls. */
 static boolean assistantGroup(UiObject2 node) {
  for (UiObject2 current = node; current != null; current = current.getParent())
   if (ASSISTANT_GROUP.equals(current.getContentDescription()) || ASSISTANT_GROUP.equals(current.getText())) return true;
  return false;
 }
 static int assistantGroups(UiObject2 node) {
  int count = ASSISTANT_GROUP.equals(node.getContentDescription()) || ASSISTANT_GROUP.equals(node.getText()) ? 1 : 0;
  for (UiObject2 child : node.getChildren()) count += assistantGroups(child);
  return count;
 }

 /**
  * Bars of controls read in one order in every layout (READING_GROUPS in
  * test/browser/accessibility-audit.ts): an app header keeps the navigation, title, actions order of
  * an Android toolbar when a large font moves its title below the buttons, and the camera's capture
  * row keeps its portrait order when landscape turns it into an upward rail. Order is judged between
  * bars and the rest of the screen, not inside one bar. The page lists each visible bar's names.
  */
 static final String GROUPS = "JSON.stringify([...document.querySelectorAll('[data-alpha-app-header],[data-alpha-camera=\"capture\"]')]"
  + ".filter(b=>b.getClientRects().length&&!b.closest('[inert],[aria-hidden=\"true\"]'))"
  + ".map(b=>[...b.querySelectorAll('button,a[href],input,textarea,h1,h2,h3,[role=heading],span,p')].map(e=>(e.getAttribute('aria-label')||e.textContent||'').trim()).filter(Boolean)))";
 private static List<List<String>> groups() {
  List<List<String>> out = new ArrayList<>();
  try {
   org.json.JSONArray bars = new org.json.JSONArray((String) new org.json.JSONTokener(js(GROUPS)).nextValue());
   for (int i = 0; i < bars.length(); i++) { List<String> names = new ArrayList<>(); org.json.JSONArray list = bars.getJSONArray(i); for (int j = 0; j < list.length(); j++) names.add(list.getString(j)); out.add(names); }
  } catch (Exception unreadable) { System.out.println("ALPHA_ACCESSIBILITY_GROUPS_UNREAD " + unreadable.getClass().getSimpleName()); }
  return out;
 }
 private static int groupOf(List<List<String>> bars, String label) {
  for (int i = 0; i < bars.size(); i++) for (String name : bars.get(i)) if (label.equals(name) || label.startsWith(name + " ") || label.endsWith(" " + name)) return i;
  return -1;
 }

 /** Reads the app window's tree in TalkBack order and judges it; nothing is asserted here. */
 static Result read(UiDevice device, String surface, Assistant expectation) throws Exception {
  device.waitForIdle(2000);
  // The WebView publishes a layer's accessibility nodes shortly after the layer appears; read the
  // tree again until it holds a clickable control (five seconds at most). The checks below are unchanged.
  UiObject2 root = null; List<UiObject2> nodes = new ArrayList<>();
  for (int attempt = 0; attempt < 25; attempt++) {
   root = device.findObject(By.pkg(BuildConfig.APPLICATION_ID).depth(0)); nodes = new ArrayList<>();
   if (root != null) { try { collect(root, nodes); } catch (androidx.test.uiautomator.StaleObjectException changing) { nodes.clear(); } }
   boolean clickable = false; try { for (UiObject2 node : nodes) if (node.isClickable() && !visibleBounds(node, device).isEmpty()) clickable = true; } catch (androidx.test.uiautomator.StaleObjectException changing) { clickable = false; }
   if (clickable) break;
   SystemClock.sleep(200);
  }
  assertNotNull(surface + ": app window has an accessibility tree", root);
  Result result = new Result();
  List<String> problems = result.problems;
  int width = device.getDisplayWidth();
  UiObject2 previous = null; Rect previousBounds = null;
  boolean previousAssistant = false;
  List<List<String>> bars = groups(); int previousGroup = -1;
  result.groups = assistantGroups(root);
  if (result.groups > 1) problems.add("more than one assistant control group (" + result.groups + ")");
  for (UiObject2 node : nodes) {
   Rect r = visibleBounds(node, device);
   if (r.isEmpty()) continue;
   String label = ((node.getText() == null ? "" : node.getText()) + " " + (node.getContentDescription() == null ? "" : node.getContentDescription())).trim();
   // An empty text field has no text; Android carries its accessible name (aria-label/placeholder) as the hint, which TalkBack reads.
   if (label.isEmpty() && "android.widget.EditText".equals(node.getClassName()) && node.getHint() != null) label = node.getHint().trim();
   if (node.isClickable()) { result.actionable++; if (label.isEmpty() && node.getChildren().stream().noneMatch(c -> c.getText() != null && !c.getText().trim().isEmpty())) problems.add("unlabelled control at " + r.toShortString()); }
   if (r.left < 0 || r.right > width) problems.add("clipped '" + label + "' at " + r.toShortString());
   boolean assistant = assistantGroup(node);
   if (result.seenAssistant && !assistant) problems.add("App content follows the assistant control group ('" + label + "')");
   result.seenAssistant |= assistant;
   // Main app content is read before the persistent assistant group. That group
   // floats above the bottom edge, so this semantic transition may move upward.
   // Check every node and retain geometric order checks within each region.
   int group = groupOf(bars, label);
   if (previous != null && assistant == previousAssistant && !(group >= 0 && group == previousGroup)) {
    Rect p = previousBounds;
    // The next node may start a new column to the right, otherwise it must not read upward.
    if (r.top < p.top - Math.max(p.height(), r.height()) / 2 && r.left < p.right) {
     problems.add("reading order goes up from '" + previous.getText() + "' to '" + label + "'");
     System.out.println("ALPHA_ACCESSIBILITY_ORDER_BOUNDS previous=" + p.toShortString() + " next=" + r.toShortString());
     System.out.println("ALPHA_ACCESSIBILITY_PREVIOUS " + accessibilityGeometry(previous.getText() == null ? String.valueOf(previous.getContentDescription()) : previous.getText()));
     System.out.println("ALPHA_ACCESSIBILITY_NEXT " + accessibilityGeometry(label));
    }
   }
   previous = node; previousBounds = r; previousAssistant = assistant; previousGroup = group;
  }
  if (expectation == Assistant.REQUIRED_LAST && !(result.seenAssistant && result.groups == 1)) problems.add("the assistant controls are not one final accessible group (groups " + result.groups + ", reached " + result.seenAssistant + ")");
  if (expectation == Assistant.ABSENT && result.groups > 0) problems.add("assistant controls are exposed behind this surface (" + result.groups + ")");
  if (result.actionable == 0) problems.add("TalkBack reaches no actionable control");
  if (!problems.isEmpty()) diagnose(surface);
  return result;
 }

 /** Asserts the surface reads in order; the message names the surface and every problem. */
 static void check(UiDevice device, String surface, Assistant expectation) throws Exception {
  Result result = read(device, surface, expectation);
  assertTrue(surface + " at 200% font: " + result.problems, result.problems.isEmpty());
 }

 /** Geometry and a screenshot for a failed read. They do not change the result or the UI. */
 private static void diagnose(String surface) throws Exception {
  System.out.println("ALPHA_ACCESSIBILITY_HOME_GEOMETRY " + js("(()=>{const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,overflowX:s.overflowX,overflowY:s.overflowY,scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight};};const q=s=>document.querySelector(s),css=getComputedStyle(document.documentElement);return JSON.stringify({activeView:document.documentElement.dataset.activeView,viewport:{width:innerWidth,height:innerHeight},textScale:css.getPropertyValue('--alpha-text-scale'),dockClearance:css.getPropertyValue('--alpha-dock-clearance'),dockRest:css.getPropertyValue('--alpha-dock-rest'),phoneScale:css.getPropertyValue('--phone-scale'),home:rect(q('[data-alpha-layer=home]')),allApps:rect(q('[data-alpha-home-apps] button[aria-label=\"Apps\"]')),composer:rect(q('[data-alpha-layer=composer]')),pill:rect(q('[data-alpha-layer=pill]')),inputBar:rect(q('[data-alpha-input-bar]'))});})()"));
  System.out.println("ALPHA_ACCESSIBILITY_SETTINGS_GEOMETRY " + js("(()=>{const rect=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,classes:e.className,x:r.x,y:r.y,width:r.width,height:r.height,overflowX:s.overflowX,overflowY:s.overflowY,scrollTop:e.scrollTop,scrollLeft:e.scrollLeft,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,position:s.position};};const nodes=[...document.querySelectorAll('button,[role=button]')].filter(e=>(e.getAttribute('aria-label')==='Notifications'||e.textContent.trim()==='Notifications')).slice(0,2);return JSON.stringify({activeView:document.documentElement.dataset.activeView,notifications:nodes.map(e=>{const ancestors=[];for(let p=e.parentElement;p&&ancestors.length<12;p=p.parentElement)ancestors.push(rect(p));return {control:rect(e),ancestors};})});})()"));
  // This owned-emulator diagnostic survives app uninstall so the host can pull and
  // remove its unique file. It does not change the collected assertion or UI state.
  String screenshot = "/sdcard/Download/alpha-accessibility-fixture-" + java.util.UUID.randomUUID() + ".png";
  try (InputStream capture = new ParcelFileDescriptor.AutoCloseInputStream(automation().executeShellCommand("screencap -p " + screenshot))) {
   capture.readAllBytes(); System.out.println("ALPHA_ACCESSIBILITY_SCREENSHOT " + surface + " " + screenshot);
  } catch (Exception error) { System.out.println("ALPHA_ACCESSIBILITY_SCREENSHOT_ERROR " + error.getClass().getName()); }
 }
}
