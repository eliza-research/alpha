package ai.elizaresearch.alphaphone;
import org.json.JSONObject;

/** Uses the real Back handler and the prototype's actual home icon buttons. */
final class AppNavigation {
 private AppNavigation() {}
 /** Decision P-43: there is no offline choice. The connection dialog's close button carries this
  * accessible name in every build. Signed out on a flag-off phone (or with a sign-in Cloud rejected)
  * the dialog has no close button once the start settles: the Eliza Cloud sign-in page is required. */
 static final String CLOSE_CONNECTION = "Close connection settings";
 static String closeConnection() { return "document.querySelector('.alpha-connection-scrim button[aria-label=\"" + CLOSE_CONNECTION + "\"]')?.click()"; }
 static void liveMode() throws Exception {
  try(StartupDocumentProbe startup=new StartupDocumentProbe()) {
   // Builds without ELIZA_DEV_ALLOW_TEST_MOCKS have no mock mode: require live directly.
   if("mock".equals(startup.awaitReady(!BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS))) {
    // One real click only. Never retry effects if their callback is lost.
    startup.expectNavigation();
    WebViewTestDriver.withActivity(MainActivity.class,a->a.getBridge().getWebView().evaluateJavascript("document.querySelector('.mock-mode-banner button')?.click()",null));
    startup.awaitReady(true);
   }
  }
 }
 static String request(String view) {
  // A caller may observe the target render before this helper's next timer runs.
  // Retire that timer before another request can navigate back through Home.
  return "(()=>{const label="+JSONObject.quote(view)+",target=label.toLowerCase();const previous=window.__alphaTestNavigation;if(previous?.timer)clearTimeout(previous.timer);const nav={target,tries:0,status:'running',timer:null,lastView:null};window.__alphaTestNavigation=nav;const again=()=>{nav.timer=setTimeout(step,100);};const step=()=>{"
   + "if(window.__alphaTestNavigation!==nav)return;nav.lastView=document.documentElement.dataset.activeView||null;if(++nav.tries>200){nav.status='failed';nav.reason='Navigation did not become ready';return;}const dialog=document.querySelector('.alpha-connection-scrim');if(dialog){const close=[...dialog.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(CLOSE_CONNECTION)+");if(close&&!close.disabled)close.click();again();return;}"
   + "if(document.querySelector('.os')?.inert){again();return;}if(nav.lastView===target){nav.status='complete';nav.timer=null;return;}"
   + "if(nav.lastView==='home'){const b=[...document.querySelectorAll('[data-screen] button')].find(e=>e.getAttribute('aria-label')===label&&e.getClientRects().length);if(b&&!b.disabled)b.click();again();return;}"
   + "window.dispatchEvent(new Event('alpha-back'));again();};step();})()";
 }
 /**
  * A fresh install without notification and microphone access opens the modal "Set up Alpha
  * access" panel, which takes every real touch and swipe. Tests that drive real gestures first
  * choose its own "Not now" (nothing is granted); JavaScript-driven tests are unaffected by it.
  * On the emulator the panel took touches only after the sign-in panel was answered, so call this once the
  * requested view is selected (AppNavigation.request answers the sign-in panel).
  */
 static void declineStartupAccess() throws Exception {
  // The panel opens only once both permission reads return, which took more than three seconds
  // on a loaded emulator; a build that already has both grants waits this out once.
  for(int i=0;i<150;i++){
   // Already completed in this app data, with its Ready card gone: the panel will not open again.
   if("true".equals(WebViewTestDriver.evaluate("(()=>{try{return JSON.parse(localStorage.getItem('alpha:startup-permission-walkthrough:v1')||'null')?.status==='completed'&&!document.querySelector('dialog.alpha-startup-permissions[open]')}catch{return false}})()")))return;
   if("true".equals(WebViewTestDriver.evaluate("(()=>{const b=[...document.querySelectorAll('dialog.alpha-startup-permissions[open] button')].find(b=>b.textContent.trim()==='Not now');if(!b)return false;b.click();return true})()")))return;
   android.os.SystemClock.sleep(100);
  }
 }
 /**
  * Decision P-43: a flag-off build signed out of Eliza Cloud opens the full-page sign-in screen by
  * itself, and it cannot be dismissed (connection-ui.tsx productionCloudSignInRequired); it covers every view
  * and withdraws the native browser page. Tests never enter credentials, so a journey that needs the
  * views runs on the test-mocks pair, or on a flag-off phone its owner already signed in. Skips with
  * that reason instead of timing out behind the dialog.
  */
 static void assumeNoRequiredSignIn(String journey) throws Exception {
  if (BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS) return;
  android.content.Context context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext();
  org.junit.Assume.assumeTrue(journey + " needs the views: this flag-off build is signed out of Eliza Cloud, so P-43's sign-in screen opens by itself and cannot be dismissed (tests never sign in). Run it on the test-mocks pair or on a flag-off phone its owner signed in.",
   new AlphaCredentialStore(context).readCredentialSlot("cloud:production") != null);
 }
 static String selected(String view) { return "document.documentElement.dataset.activeView==="+JSONObject.quote(view.toLowerCase()); }
 static String composer() { return "[...document.querySelectorAll('textarea[data-alpha-composer]')].find(e=>!e.disabled&&e.getClientRects().length&&!e.closest('[inert], [aria-hidden=\"true\"]'))"; }
 static String type() { return "document.querySelector('button[aria-label=\"Type\"]')?.click()"; }
}
