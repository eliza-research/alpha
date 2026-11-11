package ai.alphacompute.alphaphone;

import android.os.Bundle;
import android.content.Intent;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

/** Derived from packages/app/scripts/mobile/android/templates/main-activity.ts.
 * Product shell: local assets, Eliza's system bridge, no cloud-auth or implicit kiosk policy.
 */
public class MainActivity extends BridgeActivity {
 private volatile int bottomInsetDp = 0;
 private volatile int topInsetDp = 0;
 private boolean keyboardReturnPending;
 public int getTopInsetDp() { return topInsetDp; }
 public int getBottomInsetDp() { return bottomInsetDp; }
 static void refreshKeyboardInsets() {
  MainActivity activity = liveInstance.get();
  if (activity != null && !activity.isDestroyed())
   ViewCompat.requestApplyInsets(activity.getWindow().getDecorView());
 }
 static void beginKeyboardReturn() {
  MainActivity activity = liveInstance.get();
  if (activity != null && !activity.isDestroyed()) activity.keyboardReturnPending = true;
 }
 private boolean voiceKeyboardSelected() {
  String selected = android.provider.Settings.Secure.getString(getContentResolver(), android.provider.Settings.Secure.DEFAULT_INPUT_METHOD);
  android.content.ComponentName component = selected == null ? null : android.content.ComponentName.unflattenFromString(selected);
  return new android.content.ComponentName(this, AlphaKeyboardDictationService.class).equals(component);
 }
 protected boolean isAssistantSurface() { return false; }
 // Renderer recovery is process-wide so a crash loop backs off instead of spinning (RendererRecoveryBudget).
 private static final RendererRecoveryBudget recoveryBudget = new RendererRecoveryBudget();
 private boolean recoveringRenderer = false;
 /** The renderer died while the activity was in the background; rebuild when it is next started. */
 private boolean pendingRebuild = false;
 // Deaths the budget had counted when this activity's WebView was created; a later count means the
 // shared renderer's death was already reported by another activity.
 private long rendererDeathsAtCreate;
 /**
  * Alpha is the HOME app now, whichever way this task started: a renderer crash loop must not leave
  * a blank, inescapable HOME, and root Back stays on Home. startedAsHome still routes hand-offs.
  */
 private boolean showsHome() { return BuildConfig.IS_LAUNCHER && !isAssistantSurface() && isCurrentHome(); }
 /**
  * The HOME role on API 29+. Resolving the HOME intent is not that answer there: package visibility
  * hides other launchers from Alpha, so the resolver can name Alpha while another app is HOME.
  */
 private boolean isCurrentHome() {
  Boolean held = null;
  String resolved = null;
  try {
   if (android.os.Build.VERSION.SDK_INT >= 29) {
    android.app.role.RoleManager roles = getSystemService(android.app.role.RoleManager.class);
    if (roles != null && roles.isRoleAvailable(android.app.role.RoleManager.ROLE_HOME)) held = roles.isRoleHeld(android.app.role.RoleManager.ROLE_HOME);
   } else {
    android.content.pm.ResolveInfo home = getPackageManager().resolveActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
    if (home != null && home.activityInfo != null) resolved = home.activityInfo.packageName;
   }
  } catch (RuntimeException unavailable) {
   android.util.Log.w("AlphaInstance", "HOME holder could not be read: " + unavailable.getClass().getSimpleName());
  }
  return RendererRecoveryBudget.currentHome(held, resolved, getPackageName(), startedAsHome);
 }
 /**
  * The native escape view while Alpha is HOME, after the recovery budget is used up or when the
  * System WebView cannot start. Built in code:
  * it needs no page, no bridge and no layout resource. Each Settings button opens a stock Settings
  * activity, never one of Alpha's own.
  */
 private void showRendererEscape() {
  android.widget.LinearLayout panel = new android.widget.LinearLayout(this);
  panel.setOrientation(android.widget.LinearLayout.VERTICAL);
  panel.setGravity(android.view.Gravity.CENTER);
  int pad = Math.round(24 * getResources().getDisplayMetrics().density);
  panel.setPadding(pad, pad, pad, pad);
  panel.setBackgroundColor(android.graphics.Color.BLACK);
  android.widget.TextView message = new android.widget.TextView(this);
  message.setText("Alpha Phone's screen keeps stopping.");
  message.setTextColor(android.graphics.Color.WHITE);
  message.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 18);
  message.setGravity(android.view.Gravity.CENTER);
  message.setPadding(0, 0, 0, pad);
  panel.addView(message);
  java.util.function.Predicate<String> resolves = action -> new Intent(action).resolveActivity(getPackageManager()) != null;
  addEscapeButton(panel, "Reload", this::recreate);
  String settings = RendererRecoveryBudget.settingsAction(resolves), home = RendererRecoveryBudget.homeChoiceAction(resolves);
  if (settings != null) addEscapeButton(panel, "Open Android Settings", () -> openSettings(settings));
  if (home != null) addEscapeButton(panel, "Choose Home app", () -> openSettings(home));
  setContentView(panel);
  android.util.Log.w("AlphaRenderer", "No working renderer while HOME; showing the native escape view");
 }
 private void addEscapeButton(android.widget.LinearLayout panel, String label, Runnable action) {
  android.widget.Button button = new android.widget.Button(this);
  button.setText(label);
  button.setAllCaps(false);
  button.setOnClickListener(view -> action.run());
  panel.addView(button, new android.widget.LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
 }
 private void openSettings(String action) {
  try { startActivity(new Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
  catch (RuntimeException unavailable) { android.util.Log.w("AlphaRenderer", "Settings could not be opened: " + unavailable.getClass().getSimpleName()); }
 }
 private final WebViewListener rendererRecovery = new WebViewListener() {
  @Override public void onPageLoaded(WebView view) {
   if (getBridge() != null && view == getBridge().getWebView())
    ViewCompat.requestApplyInsets(getWindow().getDecorView());
  }
  @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
   if (getBridge() == null || view != getBridge().getWebView()) return false;
   // A dead renderer leaves the HOME surface blank and, unhandled, kills the app process.
   // Detach and destroy the dead WebView, then rebuild the Activity and its bridge. A renderer lost
   // in the background is rebuilt when the activity is next started (RendererRecoveryBudget).
   boolean visible = getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED);
   android.util.Log.w("AlphaRenderer", "WebView renderer gone; crashed=" + detail.didCrash() + "; visible=" + visible);
   if (recoveringRenderer) return true;
   recoveringRenderer = true;
   if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
   view.destroy();
   RendererRecoveryBudget.Action action = recoveryBudget.onLoss(SystemClock.elapsedRealtime(), showsHome(), detail.didCrash(), visible, rendererDeathsAtCreate);
   if (action == RendererRecoveryBudget.Action.SHOW_ESCAPE) { showRendererEscape(); return true; }
   if (action == RendererRecoveryBudget.Action.REBUILD_ON_START) { pendingRebuild = true; return true; }
   getWindow().getDecorView().postDelayed(() -> { if (!isFinishing() && !isDestroyed()) recreate(); }, RendererRecoveryBudget.delay(action));
   return true;
  }
 };
 /*
  * One live MainActivity (launcher flavor).
  *
  * MainActivity is singleTask, but Android keeps home and ordinary activities apart: an intent with
  * ACTION_MAIN and CATEGORY_HOME as its only category, no data and no type, that either names no
  * component or is started by the system itself (the HOME key, the start when the role is granted,
  * boot) starts the activity with the home activity type in the display's home task, and every
  * other start (the app icon, a notification tap, the alphaphone:// sign-in return, an explicit
  * component from another app) has the standard type. A task's activity type never changes and task
  * lookup for singleTask only matches a task of a compatible type, so each kind of start finds or
  * creates its own task. Granting the HOME role to a running Alpha, or tapping an Alpha notice while
  * Alpha is the home activity, therefore created a second MainActivity with a second page, while
  * the draft, open conversation and pending approvals stayed in the first. (The second instance on
  * role grant was measured on the API 36 emulator in round 7; the activity-type rule is AOSP's
  * implementation, not a public API contract.)
  *
  * The first live instance is kept, whichever kind it is. A second instance never creates a bridge
  * or loads the page: it gives its intent to the live instance (the same onNewIntent path Android
  * uses for a reused singleTask activity), brings that instance's task to the front and finishes.
  * A standard live task is one of the app's own tasks and is moved to the front by its id
  * (ActivityManager.AppTask). A home-type live instance is reached with the implicit HOME intent,
  * the kind of start Android resolves to the home task. An explicit-component start is only the
  * fallback for a standard task Android does not list: made from the instance in the home task it
  * is matched to that home task first and comes back to the instance that asked (measured on the
  * API 36 emulator in round 8). If a front start ever produced another instance instead, it
  * finishes without starting anything, and this process stops handing starts off: the home task
  * would then be left empty, Android would start HOME again and the hand-off would repeat for as
  * long as the live instance kept not coming forward. Two instances (what round 7 measured) are
  * the stable fallback. The live instance resuming is what shows a hand-off reached it.
  *
  * The kind belongs to the task, not to whatever intent the instance holds later. Android hands a
  * relaunched activity (renderer recovery, a system font-size change) the last intent given to
  * setIntent, and AlphaConnectionPlugin keeps the Cloud sign-in return there. The kind is therefore
  * read from the intent once, for the first instance in a task, and kept for that task id; reading
  * it again after a relaunch would call a home-type instance standard, and the next notice tap or
  * sign-in return would be delivered without Alpha coming to the front.
  */
 private static java.lang.ref.WeakReference<MainActivity> liveInstance = new java.lang.ref.WeakReference<>(null);
 /** Bring-to-front starts the live instance has not yet received. It answers each within a frame or two. */
 private static int unackedFrontStarts = 0;
 private static final int MAX_UNACKED_FRONT_STARTS = 3;
 /** Each surviving task retains its kind when handoff permits multiple page owners. */
 private static final class TaskKind {
  final boolean home;
  java.lang.ref.WeakReference<MainActivity> owner;
  TaskKind(boolean home,MainActivity owner){this.home=home;this.owner=new java.lang.ref.WeakReference<>(owner);}
 }
 private static final java.util.Map<Integer,TaskKind> taskKinds = new java.util.HashMap<>();
 private boolean handedOff = false;
 private boolean startedAsHome = false;
 static boolean isHomeIntent(Intent intent) {
  return intent != null && Intent.ACTION_MAIN.equals(intent.getAction()) && intent.hasCategory(Intent.CATEGORY_HOME);
 }
 /** The intent shape AOSP gives the home activity type: HOME is the only category, with no data or type. */
 static boolean isHomeTypeStart(Intent intent) {
  return isHomeIntent(intent) && intent.getCategories() != null && intent.getCategories().size() == 1 && intent.getData() == null && intent.getType() == null;
 }
 /** Whether the page owner's task was started as the home activity. Fixed for the life of the task. */
 boolean startedAsHome() { return startedAsHome; }
 /** The instance that owns the page, or null. Main thread only. */
 static MainActivity liveInstance() {
  MainActivity live = liveInstance.get();
  return live != null && !live.isFinishing() && !live.isDestroyed() ? live : null;
 }
 /** True for an instance that gave its start to the live one and is finishing without a page. */
 boolean wasHandedOff() { return handedOff; }
 /** Marks a bring-to-front start. It carries nothing else: the real intent is delivered before it. */
 private static final String EXTRA_FRONT_START = "alpha.frontStart";
 /** The marker's value: MainActivity is exported, so only a value made in this process counts. */
 private static final String FRONT_START_TOKEN = java.util.UUID.randomUUID().toString();
 /**
  * Set once the bring-to-front start is seen not to work in this process: it made a new instance,
  * it could not be started, or the live instance did not receive three in a row.
  */
 private static boolean handOffUnreliable = false;
 private static boolean hasFrontMarker(Intent intent) {
  if (intent == null) return false;
  // MainActivity is exported: another app's extras may not unparcel here, or may carry the key with
  // another value. Either is an ordinary start.
  try { return FRONT_START_TOKEN.equals(intent.getStringExtra(EXTRA_FRONT_START)); }
  catch (RuntimeException foreign) { return false; }
 }
 @Override protected void load() { if (!handedOff) super.load(); }
 private void handOff(MainActivity live) {
  boolean home = isHomeIntent(getIntent());
  boolean sameTask = live.getTaskId() == getTaskId();
  if (hasFrontMarker(getIntent())) {
   // This instance was created by a bring-to-front start (the marker alone decides, however late it
   // arrives): Android did not resolve it to the live task on this build. Stop here; the live
   // instance already has the intent. Later starts are not handed off (see handOffUnreliable).
   handOffUnreliable = true;
   android.util.Log.w("AlphaInstance", "Front start created an instance; finishing it without another start. Later starts keep their own instance.");
  } else {
   android.util.Log.i("AlphaInstance", "Second start handed to the live instance; home=" + home + " liveHome=" + live.startedAsHome);
   if (getIntent() != null) live.onNewIntent(new Intent(getIntent()));
   if (!sameTask) {
    // A standard task is one of this app's own tasks and is moved by its id. No intent can do it
    // from here: a start made by the instance in the home task is matched to that home task first
    // (measured on API 36: the explicit-component start came back to the instance that asked).
    boolean started = !live.startedAsHome && moveLiveTaskToFront(live.getTaskId());
    if (!started) {
     Intent front = live.startedAsHome
       ? new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage(getPackageName())
       : new Intent(this, MainActivity.class);
     front.putExtra(EXTRA_FRONT_START, FRONT_START_TOKEN).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
     try { startActivity(front); started = true; }
     catch (RuntimeException failure) { android.util.Log.w("AlphaInstance", "Live instance could not be brought to the front: " + failure.getClass().getSimpleName()); }
    }
    // A start that cannot be made, or that the live instance keeps not receiving, would leave the
    // home task empty each time and Android would start HOME again without end.
    if (!started || ++unackedFrontStarts >= MAX_UNACKED_FRONT_STARTS) {
     handOffUnreliable = true;
     android.util.Log.w("AlphaInstance", "Front start is not reaching the live instance. Later starts keep their own instance.");
    }
   }
  }
  // The home task belongs to Android and keeps existing; a standard task made for this start does
  // not. A task this instance shares with the live one is never removed.
  if (home || sameTask) finish(); else finishAndRemoveTask();
  overridePendingTransition(0, 0);
 }
 /**
  * Moves one of this app's own tasks to the front by id (ActivityManager.AppTask needs no
  * permission). False when Android does not list the task, which is the case for the home task.
  */
 private boolean moveLiveTaskToFront(int taskId) {
  try {
   android.app.ActivityManager manager = getSystemService(android.app.ActivityManager.class);
   if (manager == null || taskId == -1) return false;
   for (android.app.ActivityManager.AppTask task : manager.getAppTasks()) {
    if (task.getTaskInfo().taskId != taskId) continue;
    task.moveToFront();
    return true;
   }
  } catch (RuntimeException failure) {
   android.util.Log.w("AlphaInstance", "Live task could not be moved to the front: " + failure.getClass().getSimpleName());
  }
  return false;
 }
 @Override public void onCreate(Bundle state) {
  SplashScreen.installSplashScreen(this);
  MainActivity live = BuildConfig.IS_LAUNCHER && !isAssistantSurface() ? liveInstance() : null;
  // An instance our own front start made always finishes. Any other start is handed to the live
  // instance, unless the front start has already been seen to miss it in this process.
  if (live != null && live != this && (!handOffUnreliable || hasFrontMarker(getIntent()))) {
   handedOff = true;
   // No plugins, bridge or page: BridgeActivity.onCreate calls load(), which does nothing here.
   super.onCreate(null);
   // Its layout still inflated a WebView that will never load; release it now.
   android.view.View unused = findViewById(com.getcapacitor.android.R.id.webview);
   if (unused instanceof WebView) {
    if (unused.getParent() instanceof ViewGroup) ((ViewGroup) unused.getParent()).removeView(unused);
    ((WebView) unused).destroy();
   }
   handOff(live);
   return;
  }
  if (BuildConfig.IS_LAUNCHER && !isAssistantSurface()) {
   liveInstance = new java.lang.ref.WeakReference<>(this);
   // First instance in this task: its start intent says which kind of task Android made. A relaunch
   // in the same task keeps that answer whatever intent it was handed (see "One live MainActivity").
   int task = getTaskId();
   if (task == -1) startedAsHome = isHomeTypeStart(getIntent());
   else {
    TaskKind kind = taskKinds.get(task);
    if (kind == null) { kind = new TaskKind(isHomeTypeStart(getIntent()),this); taskKinds.put(task,kind); }
    kind.owner = new java.lang.ref.WeakReference<>(this);
    startedAsHome = kind.home;
   }
  }
  registerPlugin(AlphaSystemPlugin.class);
  registerPlugin(AlphaResetPlugin.class);
  registerPlugin(AlphaDeviceAppsPlugin.class);
  registerPlugin(AlphaContactsPlugin.class);
  registerPlugin(DailyAppsPlugin.class);
  registerPlugin(AlphaMapsTransportPlugin.class);
  registerPlugin(ai.eliza.plugins.camera.CameraPlugin.class);
  registerPlugin(ai.eliza.plugins.location.LocationPlugin.class);
  registerPlugin(AlphaBrowserPlugin.class);
  registerPlugin(AlphaCalendarPlugin.class);
  registerPlugin(AlphaDeletionsPlugin.class);
  registerPlugin(AlphaPhotosPlugin.class);
  registerPlugin(AlphaPhotoLibraryPlugin.class);
  registerPlugin(AlphaFilesPlugin.class);
  registerPlugin(AlphaMailAttachmentsPlugin.class);
  registerPlugin(AlphaDevicePlugin.class);
  registerPlugin(AlphaConnectionPlugin.class);
  registerPlugin(AlphaCloudSignInPlugin.class);
  registerPlugin(AlphaLocalAgentPlugin.class);
  registerPlugin(AlphaActionJournalPlugin.class);
  registerPlugin(AlphaVoiceCloudPlugin.class);
  registerPlugin(AlphaVoiceCloudPlugin.Streaming.class);
  registerPlugin(AlphaNoteAudioPlugin.class);
  registerPlugin(AlphaNoteDocumentsPlugin.class);
  registerPlugin(AlphaNotificationsPlugin.class);
  registerPlugin(AlphaHostedResultsPlugin.class);
  registerPlugin(AlphaGmailPlugin.class);
  registerPlugin(AlphaListenerPlugin.class);
  registerPlugin(ai.eliza.plugins.system.SensePlugin.class);
  registerPlugin(ai.eliza.plugins.passwords.PasswordsPlugin.class);
  if (BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS) {
   // The optional transfer module is absent from production builds.
   try { registerPlugin(Class.forName("ai.eliza.plugins.passwords.PasswordTransferPlugin").asSubclass(com.getcapacitor.Plugin.class)); }
   catch (ClassNotFoundException ignored) { /* Optional development transfer module is not attached. */ }
  }
  // The native image gate is checked again by every telephony operation.
  // Dialer-role components follow the verified image; Android's role dialog stays the owner's choice.
  AlphaTelephonyRoles.sync(this);
  if (AlphaImageCapability.verified(this)) registerPlugin(AlphaTelephonyPlugin.class);
  AlphaCanonicalNotifications.captureTap(this,getIntent());
  rendererDeathsAtCreate = recoveryBudget.deaths();
  super.onCreate(state);
  // Capacitor displays its no-WebView fallback without creating a bridge when
  // the system provider cannot initialize. Preserve that screen and lifecycle, except while Alpha is
  // HOME: that fallback has no way out, and the native escape view needs no WebView.
  if (getBridge() == null) {
   android.util.Log.e("AlphaRenderer", "System WebView unavailable");
   if (showsHome()) showRendererEscape();
   return;
  }
  getBridge().addWebViewListener(rendererRecovery);
  WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
  getBridge().getWebView().getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  // The privileged app host never participates in third-party browser sessions.
  android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(getBridge().getWebView(),false);
  AlphaDevicePlugin.applyTextScale(this);
  // Launcher reference layouts include system-bar space. Standalone and assist
  // content must fit inside the real bars/cutout, including enforced edge-to-edge.
  WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
  getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
  getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
  if (android.os.Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
  ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (view, insets) -> {
   boolean imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
   int bottom = imeVisible
     ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0;
   // IME dismissal does not blur a WebView text field. Publish actual visibility instead of
   // requiring the renderer to infer it from a size change (floating IMEs need not resize).
   if (imeVisible) keyboardReturnPending = false;
   boolean handoff = !imeVisible && (voiceKeyboardSelected() || keyboardReturnPending);
   getBridge().getWebView().evaluateJavascript("(() => { const root = document.documentElement; if (!root) return; const visible = " + imeVisible
     + ", handoff = " + handoff + "; if (root.dataset.alphaKeyboardVisible === String(visible) && root.dataset.alphaKeyboardHandoff === String(handoff)) return; root.dataset.alphaKeyboardVisible = String(visible); root.dataset.alphaKeyboardHandoff = String(handoff); window.dispatchEvent(new CustomEvent('alpha-keyboard-visibility', { detail: { visible, handoff } })); })()", null);
   boolean fitContent = !BuildConfig.IS_LAUNCHER || isAssistantSurface();
   Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
   Insets safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
   int left = fitContent ? safe.left : 0, top = fitContent ? safe.top : 0, right = fitContent ? safe.right : 0;
   bottom = Math.max(bottom, fitContent ? safe.bottom : 0);
   // These are the remaining CSS insets. Do not reserve already padded bars twice.
   int nextInset = fitContent || bottom > 0 ? 0 : Math.round(bars.bottom / getResources().getDisplayMetrics().density);
   topInsetDp = fitContent ? 0 : Math.round(bars.top / getResources().getDisplayMetrics().density);
   getBridge().getWebView().evaluateJavascript("document.documentElement?.style.setProperty('--native-top-inset','" + topInsetDp + "px')", null);
   if (view.getPaddingLeft() != left || view.getPaddingTop() != top || view.getPaddingRight() != right || view.getPaddingBottom() != bottom)
    view.setPadding(left, top, right, bottom);
   bottomInsetDp = nextInset;
   getBridge().getWebView().evaluateJavascript("document.documentElement?.style.setProperty('--native-bottom-inset','" + bottomInsetDp + "px')", null);
   return WindowInsetsCompat.CONSUMED;
  });
  ViewCompat.requestApplyInsets(getWindow().getDecorView());
  getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
   @Override public void handleOnBackPressed() {
    if (BuildConfig.DEBUG) android.util.Log.d("AlphaNavigation", "Back dispatched");
    // Test and consume renderer navigation in one evaluation. While Alpha is HOME, root Back
    // stays on Home. Otherwise it uses normal Android task behavior; the launcher flavor moves its
    // task back instead of finishing, so the one live instance and its page survive.
    boolean home = showsHome();
    String script = "(() => { if (document.documentElement.dataset.alphaCanGoBack === 'true') { window.dispatchEvent(new Event('alpha-back')); return true; } "
     + (home ? "window.dispatchEvent(new Event('launcher-home')); return true;" : "return false;") + " })()";
    getBridge().getWebView().evaluateJavascript(script, handled -> {
     if (BuildConfig.DEBUG) android.util.Log.d("AlphaNavigation", "Back handled by renderer=" + handled);
     if (home || "true".equals(handled) || isFinishing() || isDestroyed()) return;
     if (BuildConfig.IS_LAUNCHER && !isAssistantSurface()) moveTaskToBack(true); else finish();
    });
   }
  });
 }
 @Override public void onNewIntent(Intent intent) {
  AlphaCanonicalNotifications.captureTap(this,intent);
  super.onNewIntent(intent);
  // Our own bring-to-front start (see handOff) carries nothing: the real intent was delivered first.
  if (hasFrontMarker(intent)) {
   // Reached the instance that asked instead of the live one: the live task was not raised.
   if (handedOff) android.util.Log.w("AlphaInstance", "Front start returned to the handed-off instance; the live task was not brought to the front");
   else unackedFrontStarts = 0;
   return;
  }
  if (getBridge() != null && !isAssistantSurface() && isHomeIntent(intent))
   getBridge().getWebView().evaluateJavascript("window.dispatchEvent(new Event('launcher-home'))", null);
 }
 @Override public void onStart() {
  super.onStart();
  if (pendingRebuild && !isFinishing() && !isDestroyed()) { pendingRebuild = false; recreate(); }
 }
 @Override public void onStop() {
  keyboardReturnPending = false;
  super.onStop();
 }
 @Override public void onDestroy() {
  if (liveInstance.get() == this) liveInstance = new java.lang.ref.WeakReference<>(null);
  TaskKind kind = taskKinds.get(getTaskId());
  if (isFinishing() && kind != null && kind.owner.get() == this) taskKinds.remove(getTaskId());
  super.onDestroy();
 }
 /**
  * Android's own shade, quick settings or a system dialog take this window's focus without pausing
  * the activity, and the page sees nothing: no focus, visibilitychange or appResumed (measured on
  * API 36). Tell the page when focus returns, so a system switch changed meanwhile is read again.
  */
 @Override public void onWindowFocusChanged(boolean hasFocus){
  super.onWindowFocusChanged(hasFocus);
  if(hasFocus&&getBridge()!=null&&getBridge().getWebView()!=null)
   getBridge().getWebView().evaluateJavascript("window.dispatchEvent(new Event('focus'))",null);
 }
 @Override public void onResume(){super.onResume();
  AlphaCanonicalNotifications.ensure(this);
  // The page owner is in front again: whatever brought it there (the task move or the front start) worked.
  if(liveInstance.get()==this)unackedFrontStarts=0;
  if(getBridge()!=null&&getBridge().getWebView()!=null)AlphaDevicePlugin.applyTextScale(this);}
 @Override public void onConfigurationChanged(android.content.res.Configuration configuration){super.onConfigurationChanged(configuration);if(getBridge()!=null&&getBridge().getWebView()!=null)AlphaDevicePlugin.applyTextScale(this);}
}
