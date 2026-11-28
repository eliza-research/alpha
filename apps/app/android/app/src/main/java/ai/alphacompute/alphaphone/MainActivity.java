// spec/app/platform/index.md, "Story: Reach the phone's native capabilities"; spec/app/shell/index.md, "Phone and Messages exist only on an Alpha image, and Contacts only where that image admits it"
package ai.alphacompute.alphaphone;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.role.RoleManager;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.CapConfig;
import com.getcapacitor.WebViewListener;
import java.lang.ref.WeakReference;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

public class MainActivity extends BridgeActivity {
 private static final String BACK = "window.dispatchEvent(new Event('alpha-back'))";
 private static final String HOME = "window.dispatchEvent(new Event('launcher-home'))";
 private static final String TAG = "AlphaLauncher";
 private static final String HOME_TASK = "alpha.homeTask";
 private static final String FRONT_START = "alpha.frontStart";
 private static final String FRONT_TOKEN = UUID.randomUUID().toString();
 private static final int MAX_UNANSWERED_FRONT_STARTS = 3;
 private static final String TEXT_ASK = "ai.alphacompute.alphaphone.TEXT_ASK";
 private static final String TEXT_ASK_NONCE = "alpha.textAsk";
 private static int nextTextAsk;
 private static OfferedAsk offeringAsk;
 private static WeakReference<MainActivity> livePage = new WeakReference<>(null);
 private static final NavigationOpenRequest navigationOpen = new NavigationOpenRequest();
 private static boolean handoffUnavailable;
 private static int unansweredFrontStarts;
 private boolean homeTask;
 private boolean handingOff;
 private boolean telephonyAdmitted;
 private volatile boolean resumed;
 private volatile boolean windowFocused;
 private volatile boolean tornDown;
 private final AtomicLong composerVisit = new AtomicLong();
 private InsetsState insets;
 private volatile TextAsk textAsk;
 private int closedTextAsk;

 private record TextAsk(int ticket, boolean returnExternally) {}
 private record OfferedAsk(String nonce, TextAsk visit) {}

 static boolean isLive() {
  MainActivity live = livePage.get();
  return live != null && !live.isFinishing() && !live.isDestroyed();
 }

 static void notifyBillingReturn() {
  MainActivity live = livePage.get();
  if (live == null || live.isFinishing() || live.isDestroyed()) return;
  live.runOnUiThread(() -> {
   if (live.getBridge() == null) return;
   WebView billingView = live.getBridge().getWebView();
   if (billingView != null) {
    billingView.evaluateJavascript("window.dispatchEvent(new Event('alpha-billing-return'))", null);
   }
  });
 }

 static void openTextAsk(Activity source) {
  MainActivity live = livePage.get();
  boolean alreadyVisible = live != null && !live.isFinishing() && !live.isDestroyed()
    && live.getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED);
  int ticket = ++nextTextAsk;
  if (ticket <= 0) return;
  OfferedAsk offer = new OfferedAsk(UUID.randomUUID().toString(), new TextAsk(ticket, !alreadyVisible));
  offeringAsk = offer;
  Intent target = new Intent(source, MainActivity.class).setAction(TEXT_ASK)
    .putExtra(TEXT_ASK_NONCE, offer.nonce()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
  try { source.startActivity(target); }
  catch (RuntimeException unavailable) { if (offeringAsk == offer) offeringAsk = null; }
 }

 private boolean receiveTextAsk(Intent intent) {
  if (intent == null || !TEXT_ASK.equals(intent.getAction())) return false;
  OfferedAsk offered = offeringAsk;
  if (offered == null) return true;
  try {
   if (!offered.nonce().equals(intent.getStringExtra(TEXT_ASK_NONCE))) return true;
   offeringAsk = null;
   if (AlphaAssistActivity.unlocked(this) && textAsk == null) {
    composerVisit.incrementAndGet();
    textAsk = offered.visit();
   }
   if (textAsk != null && getBridge() != null) getBridge().triggerWindowJSEvent("alpha-text-ask");
  } catch (RuntimeException foreignExtras) { return true; }
  return true;
 }

 int textAskTicket() {
  return AlphaAssistActivity.unlocked(this) && hasWindowFocus() && !isFinishing() && !isDestroyed()
    ? assistantVisit() : 0;
 }

 boolean closeTextAsk(int ticket) {
  if (ticket <= 0) return false;
  if (textAsk == null) return ticket == closedTextAsk;
  if (ticket != textAskTicket()) return false;
  composerVisit.incrementAndGet();
  if (textAsk.returnExternally() && !moveTaskToBack(true)) return false;
  closedTextAsk = ticket;
  textAsk = null;
  wakeSmsDraft();
  return true;
 }

 private boolean receiveSmsDraft(Intent intent) {
  if (intent == null || !SmsDraftOpenRequest.ACTION.equals(intent.getAction())) return false;
  if (AlphaImageCapability.verified(this) && AlphaAssistActivity.unlocked(this)) {
   try {
    if (SmsDraftOpenRequest.bind(this, intent.getStringExtra(SmsDraftOpenRequest.TOKEN))) wakeSmsDraft();
   } catch (RuntimeException foreignExtras) { return true; }
  }
  return true;
 }

 private void wakeSmsDraft() {
  if (getBridge() == null || !AlphaDevicePlugin.shareForeground(this) || isAssistantSurface()) return;
  var handle = getBridge().getPlugin("ElizaTelephony");
  if (handle != null && handle.getInstance() instanceof AlphaTelephonyPlugin telephony) telephony.wakeSmsDraft();
 }

 private record InsetsState(int top, int bottom, boolean keyboard) {
  void publish(WebView page) {
   page.evaluateJavascript("(() => { const root = document.documentElement; if (!root) return;"
     + " const detail = { top:" + top + ", bottom:" + bottom + ", keyboard:" + keyboard + " };"
     + " root.style.setProperty('--alpha-native-inset-top', detail.top + 'px');"
     + " root.style.setProperty('--alpha-native-inset-bottom', detail.bottom + 'px');"
     + " root.dataset.alphaNativeKeyboard = String(detail.keyboard);"
     + " window.dispatchEvent(new CustomEvent('alpha-insets', { detail })); })()", null);
  }
 }

 @Override public void onCreate(Bundle state) {
  SplashScreen.installSplashScreen(this);
  Intent incoming = getIntent();
  ai.alphacompute.alphaphone.messaging.MessagingNotices.opened(this, incoming);
  BillingReturn.capture(incoming);
  if (incoming == null || !TEXT_ASK.equals(incoming.getAction())) HostedDigestDelivery.get().capture(incoming);
  InboxNoticeDelivery.get(this).capture(incoming);
  MainActivity live = livePage.get();
  boolean frontStart = isFrontStart(getIntent());
  if (live != null && live != this && !live.isFinishing() && !live.isDestroyed()
      && (!handoffUnavailable || frontStart)) {
   handingOff = true;
   super.onCreate(null);
   discardUnusedWebView();
   handoffTo(live, frontStart);
   return;
  }
  if (receiveTextAsk(incoming) || receiveSmsDraft(incoming)) setIntent(new Intent(this, MainActivity.class));
  homeTask = state == null ? isHomeTaskStart(getIntent()) : state.getBoolean(HOME_TASK, isHomeTaskStart(getIntent()));
  if (isHome(getIntent())) SmsNoticeOpenRequest.clear();
  captureNavigationOpen(getIntent());
  registerPlugin(ai.eliza.os.agent.AgentPlugin.class);
  registerPlugin(ai.eliza.plugins.signin.ElizaSignInPlugin.class);
  registerPlugin(ai.eliza.plugins.signin.ElizaCloudPlugin.class);
  registerPlugin(ai.eliza.plugins.securestore.SecureStorePlugin.class);
  registerPlugin(AlphaSystemPlugin.class);
  registerPlugin(ai.alphacompute.alphaphone.clock.AlphaClockAlertsPlugin.class);
  registerPlugin(ai.alphacompute.alphaphone.messaging.AlphaMessagingNoticesPlugin.class);
  registerPlugin(ai.alphacompute.alphaphone.slack.AlphaSlackOAuthPlugin.class);
  registerPlugin(AlphaFilesPlugin.class);
  registerPlugin(AlphaSelectedDocumentsPlugin.class);
  registerPlugin(AlphaInboxAttachmentsPlugin.class);
  registerPlugin(AlphaInboxNoticesPlugin.class);
  registerPlugin(AlphaNotesPlugin.class);
  registerPlugin(AlphaAssistantDraftPlugin.class);
  registerPlugin(AlphaNoteDocumentsPlugin.class);
  AlphaNoteRecordingService.offerFromIntent(this, getIntent());
  registerPlugin(ai.eliza.plugins.camera.CameraPlugin.class);
  registerPlugin(AlphaPhotosPlugin.class);
  registerPlugin(AlphaPhotoLibraryPlugin.class);
  registerPlugin(AlphaMediaEnrollmentPlugin.class);
  registerPlugin(AlphaScanPlugin.class);
  registerPlugin(ai.eliza.plugins.location.LocationPlugin.class);
  registerPlugin(AlphaNetworkLocationPlugin.class);
  registerPlugin(AlphaMapsTransportPlugin.class);
  registerPlugin(ai.eliza.plugins.wifi.WiFiPlugin.class);
  registerPlugin(ai.eliza.plugins.passwords.PasswordsPlugin.class);
  registerPlugin(AlphaBrowserPlugin.class);
  registerPlugin(AlphaCalendarPlugin.class);
  registerPlugin(AlphaNotificationsPlugin.class);
  registerPlugin(AlphaHostedDigestDeliveryPlugin.class);
  registerPlugin(AlphaPhotosPermissionsPlugin.class);
  registerPlugin(AlphaResetPlugin.class);
  registerPlugin(AlphaActionJournalPlugin.class);
  registerPlugin(AlphaDevicePlugin.class);
  registerPlugin(AlphaCarrierSetupPlugin.class);
  registerPlugin(AlphaCallStatePlugin.class);
  registerPlugin(AlphaLocalSpeechPlugin.class);
  registerPlugin(AlphaCloudSpeechPlugin.class);
  registerPlugin(ai.alphacompute.localllm.AlphaLocalLlmPlugin.class);
  registerPlugin(ai.alphacompute.alphaphone.overlay.AlphaOverlayHostPlugin.class);
  boolean image = AlphaImageCapability.verified(this);
  telephonyAdmitted = image;
  if (image) {
   registerPlugin(AlphaTelephonyPlugin.class);
   registerPlugin(AlphaContactsPlugin.class);
   if (AlphaSenseAdmission.available(this)) registerPlugin(ai.eliza.plugins.system.SensePlugin.class);
  }
  AlphaLauncher.register(this, image);
  super.onCreate(state);
  if (getBridge() == null) return;
  WebView page = getBridge().getWebView();
  if (page == null) return;
  livePage = new WeakReference<>(this);
  WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
  page.setFilterTouchesWhenObscured(true);
  page.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(page, false);
  page.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
   @Override public Bitmap getDefaultVideoPoster() {
    return Bitmap.createBitmap(new int[] { Color.BLACK }, 1, 1, Bitmap.Config.ARGB_8888);
   }
  });
  AlphaDevicePlugin.applyTextScale(this);
  followWindowInsets();
  getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
   @Override public void handleOnBackPressed() {
    var bridge = getBridge();
    WebView view = bridge == null ? null : bridge.getWebView();
    if (view == null) return;
    boolean staysHome = holdsHomeRole();
    String script = "(() => { if (document.documentElement?.dataset.alphaCanGoBack === 'true') { "
      + BACK + "; return true; } " + (staysHome ? HOME + "; return true;" : "return false;") + " })()";
    view.evaluateJavascript(script, handled -> {
     if (!staysHome && !"true".equals(handled) && !isFinishing() && !isDestroyed()) moveTaskToBack(true);
    });
   }
  });
 }

 private void followWindowInsets() {
  var bridge = getBridge();
  if (bridge == null) return;
  bridge.addWebViewListener(new WebViewListener() {
   @Override public void onPageStarted(WebView page) { composerVisit.incrementAndGet(); }

   @Override public void onPageLoaded(WebView page) {
    if (insets != null) insets.publish(page);
    signalNavigationOpen();
   }
  });
  var decor = getWindow().getDecorView();
  ViewCompat.setOnApplyWindowInsetsListener(decor, (view, incoming) -> {
   var bars = incoming.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
   float density = getResources().getDisplayMetrics().density;
   var measured = new InsetsState(Math.round(bars.top / density), Math.round(bars.bottom / density),
     incoming.isVisible(WindowInsetsCompat.Type.ime()));
   if (!measured.equals(insets)) {
    insets = measured;
    var currentBridge = getBridge();
    WebView webView = currentBridge == null ? null : currentBridge.getWebView();
    if (webView != null) measured.publish(webView);
   }
   return ViewCompat.onApplyWindowInsets(view, incoming);
  });
  ViewCompat.requestApplyInsets(decor);
 }

 @Override protected void load() {
  if (handingOff) return;
  WebView page = findViewById(com.getcapacitor.android.R.id.webview);
  if (page != null) page.setFilterTouchesWhenObscured(true);
  if (telephonyAdmitted) {
   if (config == null) config = CapConfig.loadDefault(this);
   if (page != null && config.getServerUrl() == null) {
    AlphaMessagesComposerPort.install(this, page);
   }
  }
  super.load();
 }

 @Override public void onSaveInstanceState(Bundle state) {
  super.onSaveInstanceState(state);
  state.putBoolean(HOME_TASK, homeTask);
 }

 @Override public void onResume() {
  composerVisit.incrementAndGet();
  super.onResume();
  resumed = true;
  windowFocused = hasWindowFocus();
  HostedDigestDelivery.get().refreshNotices();
  InboxNoticeDelivery.get(this).changed();
  if (livePage.get() == this) unansweredFrontStarts = 0;
 }

 @Override public void onPause() {
  resumed = false;
  composerVisit.incrementAndGet();
  super.onPause();
 }

 @Override public void onDestroy() {
  resumed = false;
  windowFocused = false;
  tornDown = true;
  composerVisit.incrementAndGet();
  SmsDraftOpenRequest.retire(this);
  if (livePage.get() == this) livePage.clear();
  super.onDestroy();
 }

 @Override public void onWindowFocusChanged(boolean focused) {
  windowFocused = focused;
  composerVisit.incrementAndGet();
  super.onWindowFocusChanged(focused);
  var bridge = getBridge();
  WebView view = bridge == null ? null : bridge.getWebView();
  if (focused && bridge != null) {
   InboxNoticeDelivery.get(this).changed();
   wakeSmsDraft();
   if (view != null) view.evaluateJavascript("window.dispatchEvent(new Event('focus'))", null);
  }
 }

 boolean isForegroundFocused() {
  return resumed && windowFocused && !tornDown && !isFinishing() && !isDestroyed();
 }

 boolean isResumedActive() {
  return resumed && !tornDown && !isFinishing() && !isDestroyed();
 }

 private boolean volumeShutter;

 int assistantVisit() {
  TextAsk current = textAsk;
  return current == null ? 0 : current.ticket();
 }

 boolean isAssistantSurface() { return assistantVisit() != 0; }
 long composerVisit() { return composerVisit.get(); }

 void setVolumeShutter(boolean enabled) { volumeShutter = enabled; }

 @Override public void onStop() {
  volumeShutter = false;
  SmsDraftOpenRequest.retire(this);
  super.onStop();
 }

 @Override public boolean dispatchKeyEvent(android.view.KeyEvent event) {
  int key = event.getKeyCode();
  var bridge = getBridge();
  WebView view = bridge == null ? null : bridge.getWebView();
  if (volumeShutter && (key == android.view.KeyEvent.KEYCODE_VOLUME_UP || key == android.view.KeyEvent.KEYCODE_VOLUME_DOWN) && view != null) {
   if (event.getAction() == android.view.KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0)
    view.evaluateJavascript("window.dispatchEvent(new Event('alpha:volume-shutter'))", null);
   return true;
  }
  return super.dispatchKeyEvent(event);
 }

 @Override protected void onNewIntent(Intent intent) {
  ai.alphacompute.alphaphone.messaging.MessagingNotices.opened(this, intent);
  if (receiveTextAsk(intent) || receiveSmsDraft(intent)) return;
  if (BillingReturn.capture(intent) && getBridge() != null) {
   WebView billingView = getBridge().getWebView();
   if (billingView != null) billingView.evaluateJavascript("window.dispatchEvent(new Event('alpha-billing-return'))", null);
  }
  HostedDigestDelivery.get().capture(intent);
  InboxNoticeDelivery.get(this).capture(intent);
  if (isFrontStart(intent)) {
   if (!handingOff) unansweredFrontStarts = 0;
   return;
  }
  boolean home = isHome(intent);
  if (home) {
   composerVisit.incrementAndGet();
   textAsk = null;
   SmsDraftOpenRequest.retire(this);
   SmsNoticeOpenRequest.clear();
  }
  boolean openMaps = captureNavigationOpen(intent);
  super.onNewIntent(intent);
  if (openMaps) signalNavigationOpen();
  var bridge = getBridge();
  WebView view = bridge == null ? null : bridge.getWebView();
  if (view != null && home) view.evaluateJavascript(HOME, null);
 }

 private static boolean isHome(Intent intent) {
  return intent != null && Intent.ACTION_MAIN.equals(intent.getAction()) && intent.hasCategory(Intent.CATEGORY_HOME);
 }

 private boolean captureNavigationOpen(Intent intent) {
  if (isAssistantSurface() || intent == null || isFrontStart(intent)) return false;
  if (AlphaNavigationService.ACTION_SHOW_MAPS.equals(intent.getAction())) {
   navigationOpen.offer(SystemClock.elapsedRealtime());
   intent.setAction(Intent.ACTION_MAIN);
   return true;
  }
  if (isHome(intent)) navigationOpen.clear();
  return false;
 }

 boolean consumeNavigationOpen() { return !isAssistantSurface() && navigationOpen.consume(SystemClock.elapsedRealtime()); }
 void clearNavigationOpen() { if (!isAssistantSurface()) navigationOpen.clear(); }

 private void signalNavigationOpen() {
  if (getBridge() != null && getBridge().getWebView() != null && !isAssistantSurface()) {
   getBridge().getWebView().evaluateJavascript("window.dispatchEvent(new Event('alpha:maps-open'))", null);
  }
 }

 private static boolean isHomeTaskStart(Intent intent) {
  return isHome(intent) && intent.getCategories().size() == 1 && intent.getData() == null && intent.getType() == null;
 }

 private boolean holdsHomeRole() {
  try {
   RoleManager roles = getSystemService(RoleManager.class);
   return roles != null && roles.isRoleAvailable(RoleManager.ROLE_HOME) ? roles.isRoleHeld(RoleManager.ROLE_HOME) : homeTask;
  } catch (RuntimeException unavailable) {
   Log.w(TAG, "HOME role unavailable", unavailable);
   return homeTask;
  }
 }

 private static boolean isFrontStart(Intent intent) {
  if (intent == null) return false;
  try {
   return FRONT_TOKEN.equals(intent.getStringExtra(FRONT_START));
  } catch (RuntimeException foreignExtras) {
   return false;
  }
 }

 private void discardUnusedWebView() {
  WebView unused = findViewById(com.getcapacitor.android.R.id.webview);
  if (unused == null) return;
  if (unused.getParent() instanceof ViewGroup parent) parent.removeView(unused);
  unused.destroy();
 }

 private void handoffTo(MainActivity live, boolean frontStart) {
  Intent request = getIntent();
  boolean sameTask = getTaskId() == live.getTaskId();
  if (frontStart) {
   handoffUnavailable = true;
  } else {
   if (request != null) live.onNewIntent(new Intent(request));
   if (!sameTask && (!bringToFront(live) || ++unansweredFrontStarts >= MAX_UNANSWERED_FRONT_STARTS)) {
    handoffUnavailable = true;
   }
  }
  if (sameTask || isHome(request)) finish();
  else finishAndRemoveTask();
  overridePendingTransition(0, 0);
 }

 private boolean bringToFront(MainActivity live) {
  if (!live.homeTask && moveOwnTaskToFront(live.getTaskId())) return true;
  Intent front = live.homeTask
    ? new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage(getPackageName())
    : new Intent(this, MainActivity.class);
  front.putExtra(FRONT_START, FRONT_TOKEN).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
  try {
   startActivity(front);
   return true;
  } catch (RuntimeException unavailable) {
   Log.w(TAG, "Live launcher task could not be started", unavailable);
   return false;
  }
 }

 private boolean moveOwnTaskToFront(int taskId) {
  try {
   ActivityManager manager = getSystemService(ActivityManager.class);
   if (manager == null || taskId == -1) return false;
   for (ActivityManager.AppTask task : manager.getAppTasks()) {
    if (task.getTaskInfo().taskId != taskId) continue;
    task.moveToFront();
    return true;
   }
  } catch (RuntimeException unavailable) {
   Log.w(TAG, "Live launcher task could not be raised", unavailable);
  }
  return false;
 }
}
