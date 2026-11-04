package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.browsersurface.BrowserPageReading;
import ai.eliza.plugins.browsersurface.BrowserReadingWorld;

import android.app.AlertDialog;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import static org.junit.Assert.*;

/**
 * J05 on Android: a page excerpt taken by the native WebView becomes a reviewed question.
 *
 * The page is a synthetic article served to the real isolated child WebView from memory at
 * https://reading.invalid. No public host is involved: the first tab is opened on
 * https://reading.invalid/start, which cannot resolve (RFC 6761), and every later document comes
 * from the test's shouldInterceptRequest wrapper around the tab's own client, so the class runs on an
 * offline emulator. Covered through the real AlphaBrowser plugin,
 * its native review dialog and the rendered controls:
 *  - the excerpt is bound to the committed top-level document: another address or a stale navigation
 *    number is refused before any review opens, and frame, form and hidden content is never extracted;
 *  - a navigation between extraction and approval retires the excerpt, and an old request cannot be replayed;
 *  - what is released is the text that was reviewed, even if the page changes afterwards;
 *  - a sensitive address or sensitive page content yields no excerpt and no review;
 *  - Menu -> Ask about page -> native review -> the question editor -> the composer: until Send the
 *    excerpt reaches no native call except encrypted draft storage, and with no agent connected Send
 *    dispatches nothing and keeps the draft;
 *  - a note that carries a web source keeps it in the native encrypted store across a recreation and
 *    reopens exactly that address.
 *
 * Not covered: the agent's answer and the "Review summary note" save that follows it. Those need a
 * connected agent, which a distribution build on an emulator does not have; the last method therefore
 * stores the note in the shape that save writes instead of producing it from an answer.
 * Emulator evidence for the native boundary only; not a real page, agent or device.
 *
 *   npm run test:android:instrumentation -- --owned-emulator --avd NAME --serial emulator-NNNN --classes BrowserPageQuestion
 */
public final class BrowserPageQuestionInstrumentedTest {
 static final String BASE = "https://reading.invalid";
 static final String ARTICLE = "Synthetic orchard report: twelve raised beds are open to visitors.";
 private static final String OMITTED = "omitted-synthetic-marker";
 private final BrowserFlowInstrumentedTest child = new BrowserFlowInstrumentedTest();

 private static void gate() {
  org.junit.Assume.assumeTrue("Explicit native page question campaign", "1".equals(InstrumentationRegistry.getArguments().getString("browserPageQuestion")));
 }
 /** The native page review extracts text only in the WebView's isolated world (BrowserReading.review
  * refuses first without it). A provider without JS_INJECTION_IN_FRAME_AND_WORLD (the emulator's
  * WebView 133) cannot show it at all; BrowserReadingNavigationInstrumentedTest's
  * providerWithoutIsolatedWorldSaysReadingIsUnavailableAndInjectsNothing asserts that refusal instead. */
 static void assumeIsolatedReading() {
  org.junit.Assume.assumeTrue("This WebView provider has no isolated-world injection (JS_INJECTION_IN_FRAME_AND_WORLD), so the native page review cannot open; providerWithoutIsolatedWorldSaysReadingIsUnavailableAndInjectsNothing covers this provider", BrowserReadingWorld.supported());
 }
 private String js(String code) throws Exception { return WebViewTestDriver.evaluate(code); }
 private void waitFor(String condition) throws Exception {
  for (int i = 0; i < 300; i++) { if ("true".equals(js("Boolean(" + condition + ")"))) return; SystemClock.sleep(100); }
  fail("Page question state timed out: " + condition + "; " + child.diagnostics());
 }
 private void invoke(String code) throws Exception {
  js("window.__pageResult=null;Promise.resolve().then(()=>" + code + ").then(v=>window.__pageResult=JSON.stringify(v||{}),e=>window.__pageResult=JSON.stringify({error:true,message:String(e&&e.message||'')}))");
 }
 private boolean settled() throws Exception { return "true".equals(js("window.__pageResult!==null")); }
 private JSONObject result() throws Exception { waitFor("window.__pageResult!==null"); return new JSONObject((String) new JSONTokener(js("window.__pageResult")).nextValue()); }
 private JSONObject call(String code) throws Exception { invoke(code); return result(); }
 private static MainActivity resumedActivity() {
  for (android.app.Activity activity : androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED)) if (activity instanceof MainActivity) return (MainActivity) activity;
  throw new IllegalStateException("No resumed Alpha Activity");
 }
 private static String text(View view) {
  String out = view instanceof TextView ? ((TextView) view).getText().toString() : "";
  if (view instanceof ViewGroup) { ViewGroup group = (ViewGroup) view; for (int i = 0; i < group.getChildCount(); i++) out += "\n" + text(group.getChildAt(i)); }
  return out;
 }
 /** The plugin's own review dialog, or null when none is showing. */
 private static AlertDialog currentDialog() throws Exception {
  AtomicReference<AlertDialog> found = new AtomicReference<>();
  BoundedActivityScenario.main(() -> {
   try {
    Object plugin = resumedActivity().getBridge().getPlugin("AlphaBrowser").getInstance();
    java.lang.reflect.Field reading = ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("reading"); reading.setAccessible(true);
    java.lang.reflect.Field dialog = ai.eliza.plugins.browsersurface.BrowserReviewedReading.class.getDeclaredField("dialog"); dialog.setAccessible(true);
    AlertDialog value = (AlertDialog) dialog.get(reading.get(plugin));
    found.set(value != null && value.isShowing() ? value : null);
   } catch (Exception error) { throw new AssertionError(error); }
  });
  return found.get();
 }
 private static AlertDialog awaitDialog() throws Exception {
  for (int i = 0; i < 150; i++) { AlertDialog dialog = currentDialog(); if (dialog != null) return dialog; SystemClock.sleep(100); }
  throw new AssertionError("The native page review dialog did not open");
 }
 private static String dialogText(AlertDialog dialog) throws Exception {
  AtomicReference<String> value = new AtomicReference<>();
  BoundedActivityScenario.main(() -> value.set(text(dialog.getWindow().getDecorView())));
  return value.get();
 }
 private static void press(AlertDialog dialog, int button) throws Exception { BoundedActivityScenario.main(() -> dialog.getButton(button).performClick()); }

 /** In-memory pages for the visible tab: exact synthetic routes only; nothing is forwarded to a network. */
 static final class Pages implements AutoCloseable {
  final android.webkit.WebView web; final android.webkit.WebViewClient original;
  final Map<String, String> routes = Collections.synchronizedMap(new LinkedHashMap<>());
  final AtomicInteger requests = new AtomicInteger();
  Pages(String tabId) throws Exception {
   Object plugin = resumedActivity().getBridge().getPlugin("AlphaBrowser").getInstance();
   java.lang.reflect.Field tabs = ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("tabs"); tabs.setAccessible(true);
   Object tab = ((Map<?, ?>) tabs.get(plugin)).get(tabId); assertNotNull("The visible tab exists", tab);
   java.lang.reflect.Field field = tab.getClass().getDeclaredField("web"); field.setAccessible(true);
   web = (android.webkit.WebView) field.get(tab); original = web.getWebViewClient(); assertNotNull(original);
   web.setWebViewClient(new android.webkit.WebViewClient() {
    @Override public android.webkit.WebResourceResponse shouldInterceptRequest(android.webkit.WebView view, android.webkit.WebResourceRequest request) {
     if (request.isForMainFrame()) requests.incrementAndGet();
     String body = request.isForMainFrame() ? routes.get(request.getUrl().toString()) : null;
     return new android.webkit.WebResourceResponse("text/html", "UTF-8", body == null ? 403 : 200, body == null ? "Forbidden" : "OK", Collections.emptyMap(),
      new ByteArrayInputStream((body == null ? "Fixture route refused" : body).getBytes(StandardCharsets.UTF_8)));
    }
    @Override public void onPageStarted(android.webkit.WebView v, String url, android.graphics.Bitmap icon) { original.onPageStarted(v, url, icon); }
    @Override public void onPageCommitVisible(android.webkit.WebView v, String url) { original.onPageCommitVisible(v, url); }
    @Override public void onPageFinished(android.webkit.WebView v, String url) { original.onPageFinished(v, url); }
    @Override public void onReceivedError(android.webkit.WebView v, android.webkit.WebResourceRequest r, android.webkit.WebResourceError e) { original.onReceivedError(v, r, e); }
    @Override public void onReceivedHttpError(android.webkit.WebView v, android.webkit.WebResourceRequest r, android.webkit.WebResourceResponse e) { original.onReceivedHttpError(v, r, e); }
   });
  }
  @Override public void close() { web.setWebViewClient(original); }
 }
 private static String page(String article, String extra) {
  return "<html><head><title>Orchard report</title></head><body><article><p>" + article + "</p>" + extra + "</article></body></html>";
 }

 /** Records every native call the renderer makes, by plugin, method and serialized arguments. */
 private void recordNativeCalls() throws Exception {
  js("(()=>{if(window.__pageNative)return;window.__pageCalls=[];const note=(p,m,a)=>{let body='';try{body=JSON.stringify(a===undefined?null:a);}catch(e){body='[unserializable]';}window.__pageCalls.push({plugin:String(p),method:String(m),body});if(p==='AlphaBrowser'&&m==='present'&&a&&a.id)window.__pageTab={session:a.session,id:a.id};};"
   + "const C=window.Capacitor;window.__pageNative={nativePromise:C.nativePromise,nativeCallback:C.nativeCallback};"
   + "C.nativePromise=function(p,m,a){note(p,m,a);return window.__pageNative.nativePromise.apply(this,arguments);};"
   + "if(typeof C.nativeCallback==='function')C.nativeCallback=function(p,m,a){note(p,m,a);return window.__pageNative.nativeCallback.apply(this,arguments);};})()");
 }
 /** Native calls that carried the marker anywhere except encrypted draft storage on this device. */
 JSONArray leaks(String marker) throws Exception {
  return new JSONArray((String) new JSONTokener(js("JSON.stringify(window.__pageCalls.filter(c=>c.body.includes(" + JSONObject.quote(marker) + ")&&!(c.plugin==='AlphaConnection'&&/^secure(Read|Write|Remove|CompareExchange)$/.test(c.method))).map(c=>c.plugin+'.'+c.method))")).nextValue());
 }
 void restoreNativeCalls() throws Exception {
  js("(()=>{const C=window.Capacitor,o=window.__pageNative;if(o){C.nativePromise=o.nativePromise;if(o.nativeCallback)C.nativeCallback=o.nativeCallback;}"
   + "Promise.resolve(window.__pageListener).then(h=>h&&h.remove&&h.remove()).catch(()=>{});for(const k of ['__pageNative','__pageCalls','__pageTab','__pageState','__pageArgs','__pageResult','__pageListener'])delete window[k];})()");
 }

 static final String START = BASE + "/start";
 /** Opens the Browser view, creates its first tab on an address that cannot resolve, then serves
  * that tab from memory: the fixture's start page is committed before this returns. */
 Pages openBrowser() throws Exception {
  AppNavigation.liveMode(); js(AppNavigation.request("Browser")); waitFor(AppNavigation.selected("Browser")); waitFor("window.__alphaTestNavigation?.status==='complete'");
    // The native page is withdrawn while the modal first-run access panel is open; answer it first, as an owner does.
    AppNavigation.declineStartupAccess();
  recordNativeCalls();
  String address = "(()=>{const e=document.querySelector('input[aria-label=Address]');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e," + JSONObject.quote(START) + ");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true;})()";
  if (!"true".equals(js(address))) {
   js("[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Edit address'||b.getAttribute('aria-label')==='Search or type address')?.click()");
   waitFor("document.querySelector('input[aria-label=Address]')");
   assertEquals("true", js(address));
  }
  // The tab exists once the plugin presented it; its first load fails offline (reading.invalid never resolves).
  waitFor("window.__pageTab");
  String tabId = new JSONObject((String) new JSONTokener(js("JSON.stringify(window.__pageTab)")).nextValue()).getString("id");
  AtomicReference<Pages> pages = new AtomicReference<>();
  for (int i = 0; i < 100 && pages.get() == null; i++) {
   BoundedActivityScenario.main(() -> { try { pages.set(new Pages(tabId)); } catch (AssertionError notYet) { /* The tab's WebView is attached after present resolves. */ } catch (Exception error) { throw new AssertionError(error); } });
   if (pages.get() == null) SystemClock.sleep(100);
  }
  assertNotNull("The visible tab's WebView was created", pages.get());
  js("window.__pageState=null;window.__pageListener=Capacitor.Plugins.AlphaBrowser.addListener('stateChanged',state=>{if(state&&state.id===window.__pageTab.id)window.__pageState=state;})");
  // From here on every top-level document is the fixture's: commit the start page.
  pages.get().routes.put(START, page("Synthetic start page.", ""));
  open(START);
  waitFor("document.querySelector('[role=img][aria-label=\"Secure connection\"]')");
  return pages.get();
 }
 /** Navigates the visible tab and waits for that exact document to be committed and idle. */
 private void open(String url) throws Exception {
  js("window.__pageState=null"); // Only a state reported after this navigation counts.
  JSONObject navigation = call("Capacitor.Plugins.AlphaBrowser.navigate({...window.__pageTab,url:" + JSONObject.quote(url) + "})");
  assertTrue("Native navigation returns its state: " + navigation, navigation.get("error") instanceof String);
  assertEquals("", navigation.getString("error"));
  waitFor("window.__pageState?.url===" + JSONObject.quote(url) + "&&window.__pageState.committed&&!window.__pageState.loading&&!window.__pageState.error");
  assertEquals(url, new JSONTokener(child.child("location.href")).nextValue());
  js("window.__pageArgs={session:window.__pageState.session,id:window.__pageState.id,url:window.__pageState.url,navigation:window.__pageState.navigation}");
 }
 private static final String REVIEW = "Capacitor.Plugins.AlphaBrowser.reviewQuestion(window.__pageArgs)";
 private void assertRefusedWithoutReview(String request, String why) throws Exception {
  JSONObject refused = call(request);
  assertTrue(why + ": " + refused, refused.optBoolean("error"));
  assertFalse(why + " releases no text", refused.has("text"));
  assertNull(why + " opens no review", currentDialog());
 }

 @Test public void excerptIsBoundToTheCommittedDocumentAndNavigationRetiresIt() throws Exception {
  gate(); assumeIsolatedReading();
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   Pages pages = null; Throwable primary = null;
   try {
    pages = openBrowser();
    String garden = BASE + "/garden", orchard = BASE + "/orchard";
    // Only the visible top-level article may be extracted: not a frame, a form, or hidden text.
    pages.routes.put(garden, page(ARTICLE, "<iframe srcdoc=\"<p>frame-" + OMITTED + "</p>\"></iframe><form><p>form-" + OMITTED + "</p><input value='input-" + OMITTED + "'></form><p hidden>hidden-" + OMITTED + "</p><p style='opacity:0'>clear-" + OMITTED + "</p>"));
    pages.routes.put(orchard, page("A different synthetic page about pears.", ""));
    open(garden);

    // Bound to the committed document: another address, another origin or a stale navigation number is refused.
    assertRefusedWithoutReview("Capacitor.Plugins.AlphaBrowser.reviewQuestion({...window.__pageArgs,url:" + JSONObject.quote(orchard) + "})", "A request naming another address");
    assertRefusedWithoutReview("Capacitor.Plugins.AlphaBrowser.reviewQuestion({...window.__pageArgs,url:'https://other.invalid/'})", "A request naming another origin");
    assertRefusedWithoutReview("Capacitor.Plugins.AlphaBrowser.reviewQuestion({...window.__pageArgs,navigation:String(Number(window.__pageArgs.navigation)-1)})", "A request naming an earlier navigation");
    assertRefusedWithoutReview("Capacitor.Plugins.AlphaBrowser.reviewQuestion({...window.__pageArgs,session:'another-session'})", "A request from another browser session");

    // The review names the committed host and shows exactly what would be released. Cancel releases nothing.
    int before = pages.requests.get();
    invoke(REVIEW);
    AlertDialog cancelled = awaitDialog();
    String shown = dialogText(cancelled);
    assertTrue("Review names the committed host: " + shown, shown.contains("Source: reading.invalid"));
    assertTrue("Review shows the article", shown.contains(ARTICLE));
    assertFalse("Frame, form and hidden content is never extracted", shown.contains(OMITTED));
    assertEquals("Extraction reads the loaded document; it never fetches the page again", before, pages.requests.get());
    press(cancelled, AlertDialog.BUTTON_NEGATIVE);
    JSONObject declined = result();
    assertTrue(declined.toString(), declined.optBoolean("error")); assertFalse(declined.has("text"));

    // The released text is the reviewed text, even when the page changes after extraction.
    invoke(REVIEW);
    AlertDialog approved = awaitDialog();
    assertEquals("true", child.child("document.querySelector('article p').textContent='Changed after review';true"));
    press(approved, AlertDialog.BUTTON_POSITIVE);
    JSONObject released = result();
    assertFalse(released.toString(), released.has("error"));
    assertEquals(ARTICLE, released.getString("text"));

    // A navigation between extraction and approval retires the excerpt.
    open(garden); // Reload the unchanged fixture article as a new document.
    js("window.__pageOld=window.__pageArgs");
    invoke(REVIEW);
    AlertDialog pending = awaitDialog();
    assertFalse("Nothing is released while the review is open", settled());
    JSONObject moved = new JSONObject((String) new JSONTokener(js("JSON.stringify(window.__pageTab)")).nextValue());
    js("window.__pageMoved=null;Capacitor.Plugins.AlphaBrowser.navigate({session:" + JSONObject.quote(moved.getString("session")) + ",id:" + JSONObject.quote(moved.getString("id")) + ",url:" + JSONObject.quote(orchard) + "}).then(()=>window.__pageMoved=true,()=>window.__pageMoved=false)");
    waitFor("window.__pageMoved===true&&window.__pageState?.url===" + JSONObject.quote(orchard) + "&&window.__pageState.committed&&!window.__pageState.loading");
    // Approving the old review, if it is still on screen, must not release the old page's text.
    AlertDialog stale = currentDialog();
    if (stale != null && !settled()) press(stale, AlertDialog.BUTTON_POSITIVE);
    JSONObject retired = result();
    assertTrue("The excerpt is retired by the navigation: " + retired, retired.optBoolean("error"));
    assertFalse(retired.has("text"));
    assertNull("No review survives the navigation", currentDialog());
    // The old request cannot be replayed against the new document.
    assertRefusedWithoutReview("Capacitor.Plugins.AlphaBrowser.reviewQuestion(window.__pageOld)", "Replaying the request made before the navigation");
    // The new document is extracted under its own identity.
    js("window.__pageArgs={session:window.__pageState.session,id:window.__pageState.id,url:window.__pageState.url,navigation:window.__pageState.navigation}");
    invoke(REVIEW);
    AlertDialog current = awaitDialog();
    assertTrue(dialogText(current).contains("A different synthetic page about pears."));
    assertFalse(dialogText(current).contains(ARTICLE));
    press(current, AlertDialog.BUTTON_NEGATIVE);
    assertTrue(result().optBoolean("error"));
    assertEquals("The page text reached no native call outside this plugin", 0, leaks(ARTICLE).length());
   } catch (Exception | AssertionError failure) { primary = failure; throw failure; } finally { cleanup(pages, primary); }
  }
 }

 @Test public void sensitiveAddressOrContentYieldsNoExcerpt() throws Exception {
  gate(); assumeIsolatedReading();
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   Pages pages = null; Throwable primary = null;
   try {
    pages = openBrowser();
    // The address alone is enough to refuse, before the document is read.
    for (String url : new String[]{BASE + "/?api_key=SYNTHETIC-ONLY", BASE + "/account/recovery"}) {
     assertTrue(url, BrowserPageReading.sensitiveUrl(url));
     pages.routes.put(url, page(ARTICLE, ""));
     open(url);
     JSONObject refused = call(REVIEW);
     assertTrue(refused.toString(), refused.optBoolean("error"));
     assertEquals("Reading unavailable on a sensitive or unverified page", refused.getString("message"));
     assertFalse(refused.has("text")); assertNull("A sensitive address opens no review", currentDialog());
    }
    // An ordinary address with credential-like content anywhere in the document is refused as a whole.
    String ordinary = BASE + "/gardening";
    assertFalse(BrowserPageReading.sensitiveUrl(ordinary));
    String[] sensitive = {
     page(ARTICLE, "<p>Password: synthetic-only</p>"),
     "<html><body><aside>Recovery codes: synthetic-only</aside><article><p>" + ARTICLE + "</p></article></body></html>",
     page(ARTICLE, "<p>123456</p>"),
     "<html><body><input type='password' hidden><article><p>" + ARTICLE + "</p></article></body></html>",
     "<html><body><input autocomplete='one-time-code'><article><p>" + ARTICLE + "</p></article></body></html>",
    };
    for (String body : sensitive) {
     pages.routes.put(ordinary, body);
     open(ordinary);
     JSONObject refused = call(REVIEW);
     assertTrue(refused.toString(), refused.optBoolean("error"));
     assertFalse("No excerpt is released from a sensitive page", refused.has("text"));
     assertNull("A sensitive page opens no review", currentDialog());
    }
    // The same address with only the article is readable, so the refusals above were about content.
    pages.routes.put(ordinary, page(ARTICLE, ""));
    open(ordinary);
    invoke(REVIEW);
    AlertDialog dialog = awaitDialog();
    assertTrue(dialogText(dialog).contains(ARTICLE));
    press(dialog, AlertDialog.BUTTON_NEGATIVE);
    assertTrue(result().optBoolean("error"));
   } catch (Exception | AssertionError failure) { primary = failure; throw failure; } finally { cleanup(pages, primary); }
  }
 }

 /** A unique marker without digits: digit runs are treated as possible verification codes. */
 private static String letters(UUID value) {
  StringBuilder out = new StringBuilder();
  for (char c : value.toString().replace("-", "").toCharArray()) out.append(Character.isDigit(c) ? (char) ('g' + (c - '0')) : c);
  return out.toString();
 }
 private static String visibleButton(String label) {
  return "[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')===" + JSONObject.quote(label) + "||b.textContent.trim()===" + JSONObject.quote(label) + ")&&b.getClientRects().length&&!b.disabled)";
 }
 private void tap(String label) throws Exception { waitFor(visibleButton(label)); js("(" + visibleButton(label) + ").click()"); }
 private static final String QUESTION = "document.querySelector('dialog[aria-label=\"Ask about selected content\"]')";

 @Test public void reviewedExcerptReachesOnlyTheComposerAndNothingIsSentWithoutAnAgent() throws Exception {
  gate(); assumeIsolatedReading();
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   Pages pages = null; Throwable primary = null;
   try {
    pages = openBrowser();
    askAboutPageUpToSend(pages, BASE + "/garden");
   } catch (Exception | AssertionError failure) { primary = failure; throw failure; } finally { cleanup(pages, primary); }
  }
 }

 /** Menu -> Ask about page -> native review -> question editor -> composer -> Send while inference is
  * unavailable (decision P-43: the resident is running with no network; nothing is dispatched).
  * Shared with JourneyJ05InstrumentedTest. Returns the reviewed text that reached the composer. */
 String askAboutPageUpToSend(Pages pages, String garden) throws Exception {
    String reviewed = "Reviewed excerpt " + letters(UUID.randomUUID()) + ": twelve raised beds.";
    pages.routes.put(garden, page(ARTICLE, "<p hidden>hidden-" + OMITTED + "</p>"));
    open(garden);
    // The product's own controls: Menu, then Ask about page.
    tap("Menu"); tap("Ask about page");
    AlertDialog nativeReview = awaitDialog();
    String shown = dialogText(nativeReview);
    assertTrue(shown, shown.contains("Source: reading.invalid") && shown.contains(ARTICLE));
    assertEquals("No question editor before the native review is accepted", "false", js("!!" + QUESTION));
    press(nativeReview, AlertDialog.BUTTON_POSITIVE);
    // The question editor opens with the native excerpt and nothing else.
    waitFor(QUESTION + "&&" + QUESTION + ".querySelector('textarea[aria-label=\"Content excerpt\"]')");
    String excerpt = (String) new JSONTokener(js(QUESTION + ".querySelector('textarea[aria-label=\"Content excerpt\"]').value")).nextValue();
    assertTrue("The editor holds the native excerpt: " + excerpt, excerpt.contains(ARTICLE));
    assertFalse(excerpt.contains(OMITTED));
    assertEquals("Opening the editor shares nothing", 0, leaks(ARTICLE).length());
    // The user edits the excerpt; only the edited text continues.
    js("(()=>{const e=" + QUESTION + ".querySelector('textarea[aria-label=\"Content excerpt\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e," + JSONObject.quote(reviewed) + ");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
    String use = "[..." + QUESTION + ".querySelectorAll('button')].find(b=>b.textContent.trim()==='Use in conversation'&&!b.disabled)";
    waitFor(use); js("(" + use + ").click()");
    waitFor("!" + QUESTION + "&&(" + AppNavigation.composer() + ")?.value.includes(" + JSONObject.quote(reviewed) + ")");
    String draft = (String) new JSONTokener(js("(" + AppNavigation.composer() + ").value")).nextValue();
    assertTrue("The draft names its source: " + draft, draft.contains("Source:"));
    assertFalse("The unreviewed article text is not in the draft", draft.contains(ARTICLE));
    // Before Send: neither the page text nor the reviewed draft has reached any agent, network or other native call.
    assertEquals("Nothing reaches an agent before Send: " + leaks(reviewed), 0, leaks(reviewed).length());
    assertEquals(0, leaks(ARTICLE).length());
    // Send while inference is unavailable (the resident is running with no network): no
    // line or toast says so (owner, 2026-11-03), no chooser opens, nothing is dispatched and the draft
    // is kept. The send is seen settling in the composer's own saved copy: marked as sending, then unmarked.
    waitFor("document.querySelector('button[aria-label=Send]')&&!document.querySelector('button[aria-label=Send]').disabled");
    int before = Integer.parseInt(js("window.__pageCalls.length"));
    js("document.querySelector('button[aria-label=Send]').click()");
    waitFor("(m=>m.includes(true)&&m[m.length-1]===false)(window.__pageCalls.slice(" + before + ").filter(c=>{if(c.plugin!=='AlphaConnection'||c.method!=='secureCompareExchange')return false;try{const b=JSON.parse(c.body);return String(b.slot).startsWith('assistant-draft:v1:')&&!!b.value;}catch(e){return false;}}).map(c=>JSON.parse(JSON.parse(c.body).value).sending===true))");
    assertEquals("No refusal text at the composer", "false", js("document.body.innerText.includes('Your message is back in the composer')"));
    assertEquals("No connection chooser opens", "false", js("!!document.querySelector('.alpha-connection-scrim')"));
    assertEquals("Not mock mode", "null", js("document.documentElement.dataset.connectionMode==='mock'?'mock':null"));
    assertEquals("Send while inference is unavailable dispatches nothing: " + leaks(reviewed), 0, leaks(reviewed).length());
    assertEquals("No reply or summary card can exist without inference", "false", js("document.body.innerText.includes('Review summary note')"));
    waitFor("[...document.querySelectorAll('textarea[data-alpha-composer]')].some(e=>e.value.includes(" + JSONObject.quote(reviewed) + "))");
    return reviewed;
 }

 /** The note shape the summary save writes, stored through the real encrypted Notes bridge. */
 @Test public void noteWithAWebSourceKeepsItAcrossRecreationAndReopensThatAddress() throws Exception {
  gate();
  String id = "page-question-" + UUID.randomUUID();
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   Throwable primary = null;
   try {
    sourceNoteSurvivesRecreationAndReopens(scenario, id, BASE + "/garden");
   } catch (Exception | AssertionError failure) { primary = failure; throw failure; } finally {
    try {
     restoreNativeCalls();
     NotesSecureFixture.replaceRecords("records=>records.filter(n=>n.id!==" + JSONObject.quote(id) + ")");
    } catch (Exception | AssertionError failure) { if (primary != null) primary.addSuppressed(failure); else throw failure; }
   }
  }
 }

 /** Stores a note with this web source through the encrypted Notes bridge, recreates the Activity and
  * reopens the source from the note. Shared with JourneyJ05InstrumentedTest; the caller removes `id`. */
 void sourceNoteSurvivesRecreationAndReopens(BoundedActivityScenario<MainActivity> scenario, String id, String url) throws Exception {
    String title = "Orchard summary " + letters(UUID.randomUUID()).substring(0, 8);
    AppNavigation.liveMode(); js(AppNavigation.request("Notes")); waitFor(AppNavigation.selected("Notes")); waitFor("window.__alphaTestNavigation?.status==='complete'");
    String note = new JSONObject().put("id", id).put("kind", "text").put("title", title).put("body", "The orchard has twelve raised beds.")
     .put("webSource", new JSONObject().put("kind", "web-page").put("version", 1).put("name", "Orchard report").put("url", url))
     .put("pinned", false).put("when", "Now").put("createdAt", System.currentTimeMillis()).put("modifiedAt", System.currentTimeMillis()).toString();
    NotesSecureFixture.replaceRecords("records=>[" + note + ",...records.filter(n=>n.id!==" + JSONObject.quote(id) + ")]");
    scenario.recreate();
    AppNavigation.liveMode(); js(AppNavigation.request("Notes")); waitFor(AppNavigation.selected("Notes"));
    String open = "document.querySelector('button[aria-label=" + JSONObject.quote("Open " + title).replace("'", "\\'") + "]')";
    waitFor(open); js(open + ".click()");
    // The note still offers its source after the process rebuilt its state from encrypted storage.
    tap("Web source linked");
    String source = "document.querySelector('dialog[aria-label=\"Note web source\"]')";
    waitFor(source);
    assertEquals("The source dialog shows the exact saved address", "true", js(source + ".textContent.includes(" + JSONObject.quote(url) + ")"));
    assertEquals("true", NotesSecureFixture.evaluate("__notesEnvelope.records.find(n=>n.id===" + JSONObject.quote(id) + ")?.webSource?.url===" + JSONObject.quote(url)));
    // Open source page asks the native browser for exactly that address.
    recordNativeCalls();
    String openSource = "[..." + source + ".querySelectorAll('button')].find(b=>b.textContent.trim()==='Open source page'&&!b.disabled)";
    waitFor(openSource); js("(" + openSource + ").click()");
    waitFor(AppNavigation.selected("Browser"));AppNavigation.declineStartupAccess();
    waitFor("window.__pageCalls.some(c=>c.plugin==='AlphaBrowser'&&c.method==='navigate'&&JSON.parse(c.body).url===" + JSONObject.quote(url) + ")");
 }

 void cleanup(Pages pages, Throwable primary) throws Exception {
  try {
   js("Capacitor.Plugins.AlphaBrowser.cancelReading(window.__pageTab||{}).catch(()=>{})");
   js("(()=>{for(const e of document.querySelectorAll('textarea[data-alpha-composer]')){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));}})()");
   if (pages != null) { Pages owned = pages; BoundedActivityScenario.main(owned::close); }
   restoreNativeCalls();
   js("delete window.__pageOld;delete window.__pageMoved");
  } catch (Exception | AssertionError failure) { if (primary != null) primary.addSuppressed(failure); else throw failure; }
 }
}
