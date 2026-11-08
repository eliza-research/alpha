package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.browsersurface.BrowserExternalHandoff;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

/** Product decision: normal tabs keep sign-ins, Clear browsing data removes them,
 * target=_blank opens a tab in the opener's profile, and tapped mailto/tel/
 * intent/market links go to Android without replacing the page. Real HTTPS
 * example.com documents; fixtures are added to that page by instrumentation. */
@RunWith(AndroidJUnit4.class)
public final class BrowserSigninsInstrumentedTest {
 private final BrowserFlowInstrumentedTest browser=new BrowserFlowInstrumentedTest();
 private String host(String script)throws Exception{return WebViewTestDriver.evaluate(script);}
 private void ready(String predicate)throws Exception{for(int i=0;i<200;i++){if("true".equals(host("Boolean("+predicate+")")))return;SystemClock.sleep(100);}fail("Browser control/state missing: "+predicate);}
 private String button(String label){return "[...document.querySelectorAll('[data-screen] button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";}
 private void click(String label)throws Exception{ready(button(label));host("("+button(label)+").click()");}
 private void app(String label)throws Exception{host(AppNavigation.request(label));ready(AppNavigation.selected(label));}
 private void address(String value)throws Exception{
  if("false".equals(host("!!document.querySelector('input[aria-label=Address]')")))click("Edit address");
  ready("document.querySelector('input[aria-label=Address]')");
  host("(()=>{const e=document.querySelector('input[aria-label=Address]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  ready("document.querySelector('input[aria-label=Address]').value==="+JSONObject.quote(value));
  host("document.querySelector('input[aria-label=Address]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
 }
 private void page(String url)throws Exception{
  for(int i=0;i<300;i++){if("true".equals(browser.child("location.href==="+JSONObject.quote(url)+" && document.readyState==='complete' && typeof Capacitor==='undefined'")))return;SystemClock.sleep(100);}
  fail("HTTPS document not shown: "+browser.diagnostics());
 }
 private void tabs(int count)throws Exception{ready("("+button("Tabs")+").textContent.trim()==='"+count+"'");}
 private void collect(View view,List<WebView> result,WebView hostView){if(view instanceof WebView&&view!=hostView)result.add((WebView)view);if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)collect(group.getChildAt(i),result,hostView);}}
 /** A real touch on an element of the visible child page: a user gesture. */
 private void tap(String selector)throws Exception{
  org.json.JSONArray bounds=new org.json.JSONArray(browser.child("(()=>{const r=document.querySelector("+JSONObject.quote(selector)+").getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,innerWidth]})()"));
  float[] point=new float[2];AtomicBoolean found=new AtomicBoolean();
  WebViewTestDriver.withActivity(MainActivity.class,main->{List<WebView> children=new ArrayList<>();collect(main.getWindow().getDecorView(),children,main.getBridge().getWebView());for(WebView web:children)if(web.isShown()){
   int[] location=new int[2];web.getLocationOnScreen(location);float scale=(float)(web.getWidth()/bounds.optDouble(2));point[0]=location[0]+(float)bounds.optDouble(0)*scale;point[1]=location[1]+(float)bounds.optDouble(1)*scale;found.set(true);break;
  }});assertTrue("Visible native browser page",found.get());long now=SystemClock.uptimeMillis();
  android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
  for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}){MotionEvent event=MotionEvent.obtain(now,SystemClock.uptimeMillis(),action,point[0],point[1],0);event.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);instrumentation.sendPointerSync(event);event.recycle();}
 }
 private void fixtureLink(String href,String target)throws Exception{
  browser.child("(()=>{const a=document.createElement('a');a.id='alpha-fixture-link';a.href="+JSONObject.quote(href)+";"+(target==null?"":"a.target="+JSONObject.quote(target)+";")+"a.textContent='Alpha fixture link';a.style.cssText='display:block;font-size:32px;padding:24px';document.body.prepend(a);return true;})()");
 }
 private boolean mainIn(Stage... stages)throws Exception{AtomicBoolean found=new AtomicBoolean();BoundedActivityScenario.main(()->{for(Stage stage:stages)for(Activity activity:ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage))if(activity instanceof MainActivity)found.set(true);});return found.get();}
 /** Return from the app that received a handoff. The dialer may run in its own
  * task, so Back can reach the launcher, and Back sent before it owns focus can
  * reach Alpha itself. Wait for Alpha to be fully covered, then bring its
  * existing task to the front explicitly. */
 private void returnToAlpha()throws Exception{
  for(int i=0;i<100&&!mainIn(Stage.STOPPED);i++)SystemClock.sleep(100);
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  BoundedActivityScenario.main(()->context.startActivity(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)));
  for(int i=0;i<100&&!mainIn(Stage.RESUMED);i++)SystemClock.sleep(100);
  assertTrue("Alpha returned to the foreground",mainIn(Stage.RESUMED));
 }
 private int liveTabs()throws Exception{
  int[] count=new int[1];WebViewTestDriver.withActivity(MainActivity.class,activity->{try{Object plugin=activity.getBridge().getPlugin("AlphaBrowser").getInstance();java.lang.reflect.Field tabs=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("tabs");tabs.setAccessible(true);count[0]=((java.util.Map<?,?>)tabs.get(plugin)).size();}catch(Exception failure){throw new AssertionError(failure);}});return count[0];
 }

 @Test public void externalLinkIntentsAreImplicitBrowsableAndNeverTargetAlpha() {
  String own=InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName();
  Intent mail=BrowserExternalHandoff.intentFor("mailto:alpha@example.com",own,AlphaBrowserStores.HOST_SCHEMES);
  assertEquals(Intent.ACTION_SENDTO,mail.getAction());assertEquals("mailto",mail.getData().getScheme());
  Intent tel=BrowserExternalHandoff.intentFor("tel:+15555550100",own,AlphaBrowserStores.HOST_SCHEMES);
  assertEquals("A tel link only opens the dialer",Intent.ACTION_DIAL,tel.getAction());
  Intent market=BrowserExternalHandoff.intentFor("market://details?id=com.example.app",own,AlphaBrowserStores.HOST_SCHEMES);
  assertEquals(Intent.ACTION_VIEW,market.getAction());assertTrue(market.hasCategory(Intent.CATEGORY_BROWSABLE));
  Intent parsed=BrowserExternalHandoff.intentFor("intent://scan/#Intent;scheme=zxing;package=com.example.scanner;component=com.example.scanner/.Private;launchFlags=0x10000001;S.secret=value;SEL;action=android.intent.action.MAIN;end",own,AlphaBrowserStores.HOST_SCHEMES);
  assertNotNull(parsed);
  assertNull("Page-chosen component removed",parsed.getComponent());
  assertNull("Page-chosen selector removed",parsed.getSelector());
  assertEquals("Page-chosen flags removed",0,parsed.getFlags());
  assertNull("Page extras are not forwarded",parsed.getExtras());
  assertTrue(parsed.hasCategory(Intent.CATEGORY_BROWSABLE));
  assertEquals(Intent.ACTION_VIEW,parsed.getAction());assertEquals("zxing",parsed.getData().getScheme());assertEquals("com.example.scanner",parsed.getPackage());
  assertNull("Alpha's own delegation route is refused",BrowserExternalHandoff.intentFor("intent://cloud-delegation#Intent;scheme=alphaphone;end",own,AlphaBrowserStores.HOST_SCHEMES));
  assertNull("Alpha package is refused",BrowserExternalHandoff.intentFor("intent://x#Intent;scheme=https;package="+own+";end",own,AlphaBrowserStores.HOST_SCHEMES));
  assertNull("Non-VIEW actions are refused",BrowserExternalHandoff.intentFor("intent:#Intent;action=android.intent.action.CALL;S.number=1;end",own,AlphaBrowserStores.HOST_SCHEMES));
  assertNull("File data is refused",BrowserExternalHandoff.intentFor("intent:///sdcard/x#Intent;scheme=file;end",own,AlphaBrowserStores.HOST_SCHEMES));
  assertNull("Content data is refused",BrowserExternalHandoff.intentFor("intent://media/1#Intent;scheme=content;end",own,AlphaBrowserStores.HOST_SCHEMES));
  assertNull("JavaScript is not an external link",BrowserExternalHandoff.intentFor("javascript:alert(1)",own,AlphaBrowserStores.HOST_SCHEMES));
  assertNull("Malformed intent URI is refused",BrowserExternalHandoff.intentFor("intent:#Intent;component=;end\n",own,AlphaBrowserStores.HOST_SCHEMES));
  assertEquals("https://example.com/app",BrowserExternalHandoff.fallback("intent://x#Intent;scheme=zxing;S.browser_fallback_url=https%3A%2F%2Fexample.com%2Fapp;end"));
  assertNull("Only HTTPS fallbacks are followed",BrowserExternalHandoff.fallback("intent://x#Intent;scheme=zxing;S.browser_fallback_url=javascript%3Aalert(1);end"));
  assertTrue(BrowserExternalHandoff.external("TEL:123"));assertFalse(BrowserExternalHandoff.external("https://example.com/"));
 }

 @Test public void signInSurvivesTabCloseUntilClearBrowsingData()throws Exception{
  String token=UUID.randomUUID().toString(),url="https://example.com/?alpha_signin="+token;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();app("Browser");address(url);page(url);
   browser.child("localStorage.setItem('alpha_signin',"+JSONObject.quote(token)+");document.cookie='alpha_signin="+token+"; Secure; SameSite=Lax; Path=/; Max-Age=3600';true");
   click("Tabs");click("Close tab");tabs(1);
   assertEquals("Closing the tab destroys its WebView",0,liveTabs());
   address(url);page(url);
   assertEquals("Sign-in storage survives tab close",JSONObject.quote(token),browser.child("localStorage.getItem('alpha_signin')"));
   assertEquals("Sign-in cookie survives tab close","true",browser.child("document.cookie.includes('alpha_signin="+token+"')"));
   click("Menu");click("Clear browsing data");
   ready("document.querySelector('dialog.alpha-operation-review[aria-label=\"Clear browsing data?\"]')");
   assertEquals("Native page hidden behind the confirmation","null",browser.child("true"));
   host("[...document.querySelectorAll('dialog.alpha-operation-review button')].find(b=>b.textContent==='Cancel').click()");
   ready("!document.querySelector('dialog.alpha-operation-review')");page(url);
   assertEquals("Cancel keeps site data",JSONObject.quote(token),browser.child("localStorage.getItem('alpha_signin')"));
   click("Menu");click("Clear browsing data");ready("document.querySelector('dialog.alpha-operation-review')");
   host("[...document.querySelectorAll('dialog.alpha-operation-review button')].find(b=>b.textContent==='Clear data').click()");
   ready("document.body.innerText.includes('Browsing data cleared')");
   assertEquals("Normal tabs closed",0,liveTabs());
   assertEquals("Saved tabs and history cleared",0,AlphaBrowserStores.session(InstrumentationRegistry.getInstrumentation().getTargetContext()).read().getJSONArray("history").length());
   address(url);page(url);
   assertEquals("Site storage cleared","null",browser.child("localStorage.getItem('alpha_signin')"));
   assertEquals("Cookies cleared","false",browser.child("document.cookie.includes('alpha_signin=')"));
   // Only the page visited after clearing is in history.
   click("Menu");click("Bookmarks and history");click("History");ready(button(url));
  }
 }

 @Test public void targetBlankOpensTabInOpenerProfileAndScriptPopupIsBlocked()throws Exception{
  String token=UUID.randomUUID().toString(),url="https://example.com/?alpha_opener="+token,popup="https://example.com/?alpha_popup="+token;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();app("Browser");address(url);page(url);
   browser.child("localStorage.setItem('alpha_opener',"+JSONObject.quote(token)+");true");
   // window.open without a tap is not a user gesture and is blocked.
   // Chromium refuses it before onCreateWindow (JavaScriptCanOpenWindowsAutomatically
   // is off), so window.open returns null and no tab or WebView is created.
   assertEquals("Script pop-up refused","true",browser.child("window.open("+JSONObject.quote(popup)+")===null"));
   SystemClock.sleep(1000);tabs(1);assertEquals(1,liveTabs());
   fixtureLink(popup,"_blank");tap("#alpha-fixture-link");
   tabs(2);page(popup);assertEquals(2,liveTabs());
   assertEquals("Pop-up tab shares the opener's normal profile",JSONObject.quote(token),browser.child("localStorage.getItem('alpha_opener')"));
   assertEquals("Pop-up tab has no app bridge","true",browser.child("typeof Capacitor==='undefined' && typeof androidBridge==='undefined'"));
   // A pop-up opened by the site may close itself.
   browser.child("window.close();true");tabs(1);page(url);assertEquals(1,liveTabs());
   // In a private tab the pop-up stays in that private profile.
   click("Menu");click("New private tab");address(url);page(url);
   assertEquals("Private tab isolated","null",browser.child("localStorage.getItem('alpha_opener')"));
   browser.child("localStorage.setItem('alpha_private_opener',"+JSONObject.quote(token)+");true");
   fixtureLink(popup,"_blank");tap("#alpha-fixture-link");tabs(3);page(popup);
   ready("document.querySelector('[aria-label=\"Private tab\"]')");
   assertEquals("Private pop-up shares only the private profile",JSONObject.quote(token),browser.child("localStorage.getItem('alpha_private_opener')"));
   assertEquals("Private pop-up cannot read normal storage","null",browser.child("localStorage.getItem('alpha_opener')"));
  }
 }

 @Test public void tappedTelLinkGoesToAndroidAndKeepsThePage()throws Exception{
  String url="https://example.com/?alpha_tel="+UUID.randomUUID();
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();app("Browser");address(url);page(url);
   // Script navigation to an app scheme has no gesture and is refused.
   browser.child("location.href='tel:+15555550100';true");
   ready("document.body.innerText.includes('without a tap')");page(url);
   fixtureLink("tel:+15555550100",null);tap("#alpha-fixture-link");
   boolean handedOff=false;
   for(int i=0;i<100&&!handedOff;i++){
    AtomicBoolean paused=new AtomicBoolean();
    BoundedActivityScenario.main(()->{for(Stage stage:new Stage[]{Stage.PAUSED,Stage.STOPPED})for(Activity activity:ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage))if(activity instanceof MainActivity)paused.set(true);});
    handedOff=paused.get()||"true".equals(host("document.body.innerText.includes('No app on this device can open this link.')"));
    if(!handedOff)SystemClock.sleep(100);
   }
   assertTrue("Dialer opened, or Android reported no handler",handedOff);
   if(!"true".equals(host("document.body.innerText.includes('No app on this device')")))returnToAlpha();
   app("Browser");page(url);
   assertEquals("Address type error never replaced the page","false",host("document.body.innerText.includes('address type is not supported')"));
  }
 }

 @Test public void targetBlankAppLinkHandsOffOnceAndClosesItsEmptyPopup()throws Exception{
  String url="https://example.com/?alpha_blank_tel="+UUID.randomUUID();
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();app("Browser");address(url);page(url);
   fixtureLink("tel:+15555550100","_blank");tap("#alpha-fixture-link");
   boolean handedOff=false;
   for(int i=0;i<100&&!handedOff;i++){
    AtomicBoolean paused=new AtomicBoolean();
    BoundedActivityScenario.main(()->{for(Stage stage:new Stage[]{Stage.PAUSED,Stage.STOPPED})for(Activity activity:ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage))if(activity instanceof MainActivity)paused.set(true);});
    handedOff=paused.get()||"true".equals(host("document.body.innerText.includes('No app on this device can open this link.')"));
    if(!handedOff)SystemClock.sleep(100);
   }
   assertTrue("Dialer opened from the pop-up, or Android reported no handler",handedOff);
   if(!"true".equals(host("document.body.innerText.includes('No app on this device')")))returnToAlpha();
   // The empty pop-up closes after its single handoff; the opener page stays.
   app("Browser");tabs(1);page(url);assertEquals(1,liveTabs());
  }
 }

 private java.util.HashSet<String> ephemeralProfiles()throws Exception{
  java.util.HashSet<String> names=new java.util.HashSet<>();
  WebViewTestDriver.withActivity(MainActivity.class,activity->{try{
   Object plugin=activity.getBridge().getPlugin("AlphaBrowser").getInstance();java.lang.reflect.Field tabs=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("tabs");tabs.setAccessible(true);
   for(Object tab:((java.util.Map<?,?>)tabs.get(plugin)).values()){java.lang.reflect.Field profile=tab.getClass().getDeclaredField("profile");profile.setAccessible(true);String name=(String)profile.get(tab);if(AlphaBrowserPlugin.ephemeralProfile(name))names.add(name);}
  }catch(Exception failure){throw new AssertionError(failure);}});
  return names;
 }
 /** Cold start (decision P-04). An external runner kills the process between
  * phases (scripts/test-native-restart.mjs, gate signinPhase): prepare signs in
  * a normal tab and a private tab, verify runs in a new PID and requires the
  * normal sign-in cookie and storage to survive while the private tab's do not
  * and its profile is gone; cleanup clears only this fixture's data. */
 @Test public void signinProcessRestartPhase()throws Exception{
  String phase=InstrumentationRegistry.getArguments().getString("signinPhase");org.junit.Assume.assumeTrue("Explicit process runner only",phase!=null);
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  android.content.SharedPreferences fixture=context.getSharedPreferences("browser-signin-restart-fixture",0);
  if("cleanup".equals(phase)){
   String token=fixture.getString("token",null);
   if(token!=null){
    String url="https://example.com/?alpha_signin_restart="+token;
    try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
     AppNavigation.liveMode();app("Browser");address(url);page(url);
     browser.child("localStorage.removeItem('alpha_signin_restart');document.cookie='alpha_signin_restart=; Secure; SameSite=Lax; Path=/; Max-Age=0';true");
    }
   }
   AlphaBrowserStores.session(context).clear();assertTrue(fixture.edit().clear().commit());return;
  }
  if("prepare".equals(phase)){
   assertFalse("Clean previous owned fixture first",fixture.contains("token"));
   String token=UUID.randomUUID().toString(),url="https://example.com/?alpha_signin_restart="+token;
   assertTrue(fixture.edit().putString("token",token).putInt("pid",android.os.Process.myPid()).commit());
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();app("Browser");address(url);page(url);
    browser.child("localStorage.setItem('alpha_signin_restart',"+JSONObject.quote(token)+");document.cookie='alpha_signin_restart="+token+"; Secure; SameSite=Lax; Path=/; Max-Age=3600';true");
    assertEquals("Normal sign-in cookie set","true",browser.child("document.cookie.includes('alpha_signin_restart="+token+"')"));
    boolean privateSupported=androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.DELETE_BROWSING_DATA);
    if(privateSupported){
     click("Menu");click("New private tab");address(url);page(url);ready("document.querySelector('[aria-label=\"Private tab\"]')");
     assertEquals("Private tab starts without the normal sign-in","false",browser.child("document.cookie.includes('alpha_signin_restart=')"));
     browser.child("localStorage.setItem('alpha_private_restart',"+JSONObject.quote(token)+");document.cookie='alpha_private_restart="+token+"; Secure; SameSite=Lax; Path=/; Max-Age=3600';true");
     assertEquals("Private sign-in cookie set","true",browser.child("document.cookie.includes('alpha_private_restart="+token+"')"));
    }
    java.util.HashSet<String> ephemeral=ephemeralProfiles();
    assertEquals("Private tab uses an ephemeral profile exactly when supported",privateSupported,!ephemeral.isEmpty());
    assertTrue(fixture.edit().putStringSet("profiles",ephemeral).putBoolean("privateSupported",privateSupported).commit());
    // Closing the scenario pauses the Activity, which flushes the persistent profile's cookies.
   }
   return;
  }
  assertEquals("verify",phase);
  assertTrue("Owned fixture prepared",fixture.contains("token"));
  String token=fixture.getString("token",""),url="https://example.com/?alpha_signin_restart="+token;
  assertNotEquals("Actual new process required",fixture.getInt("pid",-1),android.os.Process.myPid());
  java.util.Set<String> retired=fixture.getStringSet("profiles",java.util.Collections.emptySet());
  if(fixture.getBoolean("privateSupported",true))assertFalse("Exact prior-process private profiles recorded",retired.isEmpty());
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launchRetainingBrowserSession(MainActivity.class)){
   AppNavigation.liveMode();
   WebViewTestDriver.withActivity(MainActivity.class,activity->{
    java.util.List<String> names=androidx.webkit.ProfileStore.getInstance().getAllProfileNames();
    for(String name:retired)assertFalse("Private profile deleted after a real process restart",names.contains(name));
   });
   app("Browser");
   // Open the site fresh rather than relying on tab restoration (covered by BrowserContinuity).
   click("Tabs");click("New tab");address(url);page(url);
   assertEquals("Normal sign-in cookie survives process death","true",browser.child("document.cookie.includes('alpha_signin_restart="+token+"')"));
   assertEquals("Normal site storage survives process death",JSONObject.quote(token),browser.child("localStorage.getItem('alpha_signin_restart')"));
   assertEquals("Normal tab never sees the private sign-in","false",browser.child("document.cookie.includes('alpha_private_restart=')"));
   if(fixture.getBoolean("privateSupported",true)){
    click("Menu");click("New private tab");address(url);page(url);ready("document.querySelector('[aria-label=\"Private tab\"]')");
    assertEquals("Private sign-in cookie did not survive","false",browser.child("document.cookie.includes('alpha_private_restart=')"));
    assertEquals("Private storage did not survive","null",browser.child("localStorage.getItem('alpha_private_restart')"));
    assertEquals("A new private tab does not see the normal sign-in","false",browser.child("document.cookie.includes('alpha_signin_restart=')"));
   }
  }
 }
}
