package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.browsersurface.BrowserExternalPage;
import ai.eliza.plugins.browsersurface.BrowserExternalHandoff;

import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.view.View;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import org.junit.Test;
import static org.junit.Assert.*;

/** Actual plugin, child WebView and Activity dispatch. Resolver data is synthetic and
 * the chooser is intercepted, so no remote page, account or external app is opened. */
public final class BrowserExternalHandoffInstrumentedTest {
 private static final String URL="https://accounts.example/signin?step=2#passkey";
 /** The named field of the object's class or, for the plugin, of the shared tab host it extends. */
 private static Field declared(Object object,String name)throws Exception{for(Class<?> type=object.getClass();type!=null;type=type.getSuperclass())try{Field field=type.getDeclaredField(name);field.setAccessible(true);return field;}catch(NoSuchFieldException next){}throw new NoSuchFieldException(name);}
 private static void set(Object object,String name,Object value)throws Exception{declared(object,name).set(object,value);}
 private static Object get(Object object,String name)throws Exception{return declared(object,name).get(object);}
 private static final class Call extends PluginCall {
  final CountDownLatch done=new CountDownLatch(1);volatile String error;int settlements;
  Call(String session,boolean confirmed){super(null,"AlphaBrowser",UUID.randomUUID().toString(),"openExternalBrowser",new JSObject().put("session",session).put("id","handoff").put("url",URL).put("navigation","7").put("privateConfirmed",confirmed));}
  @Override public void resolve(){settlements++;done.countDown();}
  @Override public void reject(String message){error=message;settlements++;done.countDown();}
  void await()throws Exception{assertTrue("Native handoff settles",done.await(10,TimeUnit.SECONDS));assertEquals(1,settlements);}
 }
 @Test public void publicResolvedFiltersExcludeAppLinksAndConstrainedHandlers()throws Exception{
  assertFalse(BrowserExternalHandoff.genericHttps(null));
  IntentFilter generic=browser("fixture.browser",true).filter;assertTrue(BrowserExternalHandoff.genericHttps(generic));
  assertFalse(BrowserExternalHandoff.genericHttps(browser("fixture.link",false).filter));
  IntentFilter path=new IntentFilter(generic);path.addDataPath("/account",android.os.PatternMatcher.PATTERN_PREFIX);assertFalse(BrowserExternalHandoff.genericHttps(path));
  IntentFilter ssp=new IntentFilter(generic);ssp.addDataSchemeSpecificPart("//accounts.example",android.os.PatternMatcher.PATTERN_PREFIX);assertFalse(BrowserExternalHandoff.genericHttps(ssp));
  IntentFilter mime=new IntentFilter(generic);mime.addDataType("text/html");assertFalse(BrowserExternalHandoff.genericHttps(mime));
  IntentFilter missing=new IntentFilter(Intent.ACTION_VIEW);missing.addDataScheme("https");assertFalse(BrowserExternalHandoff.genericHttps(missing));
 }
 private static ResolveInfo browser(String pkg,boolean browser){ResolveInfo info=new ResolveInfo();info.filter=new IntentFilter(Intent.ACTION_VIEW);info.filter.addCategory(Intent.CATEGORY_DEFAULT);info.filter.addCategory(Intent.CATEGORY_BROWSABLE);info.filter.addDataScheme("https");if(!browser)info.filter.addDataAuthority("accounts.example",null);info.activityInfo=new ActivityInfo();info.activityInfo.packageName=pkg;info.activityInfo.name=pkg+".Main";info.activityInfo.enabled=true;info.activityInfo.exported=true;info.activityInfo.applicationInfo=new ApplicationInfo();info.activityInfo.applicationInfo.enabled=true;return info;}
 @Test public void normalHandoffUsesOnlyExactPageAndRefusesStaleOrUnresolvableTargets()throws Exception{exercise(false);}
 @Test public void privateHandoffRequiresExplicitReviewAndTransfersNoProfileData()throws Exception{
  org.junit.Assume.assumeTrue("Private tabs need secure scoped deletion",WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA));exercise(true);
 }
 private void exercise(boolean priv)throws Exception{
  String session=UUID.randomUUID().toString();AtomicReference<AlphaBrowserPlugin> plugin=new AtomicReference<>();AtomicReference<WebView> web=new AtomicReference<>();AtomicReference<Object> tab=new AtomicReference<>();AtomicReference<Intent> outgoing=new AtomicReference<>();
  Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();CountDownLatch loaded=new CountDownLatch(1);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   WebViewTestDriver.withActivity(MainActivity.class,activity->{try{
    AlphaBrowserPlugin p=(AlphaBrowserPlugin)activity.getBridge().getPlugin("AlphaBrowser").getInstance();plugin.set(p);
    Method build=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredMethod("build",String.class,boolean.class,String.class);build.setAccessible(true);
    Object t=build.invoke(p,"handoff",priv,priv?AlphaBrowserPlugin.PRIVATE_PREFIX+session.replace("-",""):AlphaBrowserPlugin.PERSISTENT_PROFILE);tab.set(t);
    web.set((WebView)get(t,"web"));WebViewClient original=web.get().getWebViewClient();
    web.get().setWebViewClient(new WebViewClient(){
     // loadDataWithBaseURL(..., null) can keep about:blank as the visible URL.
     // Navigate a real HTTPS identity while intercepting every response locally.
     @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view,android.webkit.WebResourceRequest request){
      return new android.webkit.WebResourceResponse("text/html","UTF-8",new java.io.ByteArrayInputStream("<title>Local handoff fixture</title><p>No network or sign-in</p>".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
     }
     @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){original.onPageStarted(view,url,icon);}
     @Override public void onPageCommitVisible(WebView view,String url){original.onPageCommitVisible(view,url);}
     @Override public void onPageFinished(WebView view,String url){original.onPageFinished(view,url);if(URL.equals(url))loaded.countDown();}
    });web.get().loadUrl(URL);
   }catch(Exception failure){throw new AssertionError(failure);}});
   // The fixture owns native navigation identity; page callbacks themselves are covered elsewhere.
   assertTrue("Synthetic HTTPS document completed",loaded.await(10,TimeUnit.SECONDS));
   BoundedActivityScenario.main(()->{try{
    AlphaBrowserPlugin p=plugin.get();Object t=tab.get();
    set(p,"session",session);set(p,"presentedId","handoff");set(t,"url",URL);set(t,"navigation",7L);set(t,"committed",true);set(t,"loading",false);set(t,"error","");
    FrameLayout frame=(FrameLayout)get(t,"frame");frame.setLayoutParams(new FrameLayout.LayoutParams(400,400));frame.setVisibility(View.VISIBLE);web.get().setVisibility(View.VISIBLE);
    set(p,"externalBrowserResolver",(Function<Intent,List<ResolveInfo>>)intent->{assertEquals(Intent.ACTION_VIEW,intent.getAction());assertEquals("https://browser-handoff.invalid/",intent.getDataString());assertTrue(intent.hasCategory(Intent.CATEGORY_DEFAULT));assertTrue(intent.hasCategory(Intent.CATEGORY_BROWSABLE));return Arrays.asList(browser(instrumentation.getTargetContext().getPackageName(),true),browser("fixture.deep.link",false),browser("fixture.browser",true),browser("fixture.browser",true));});
   }catch(Exception failure){throw new AssertionError(failure);}});
   instrumentation.waitForIdleSync();
   Instrumentation.ActivityMonitor monitor=new Instrumentation.ActivityMonitor(){@Override public Instrumentation.ActivityResult onStartActivity(Intent intent){outgoing.set(new Intent(intent));return new Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null);}};
   instrumentation.addMonitor(monitor);
   try{
    if(priv){Call unconfirmed=new Call(session,false);plugin.get().openExternalBrowser(unconfirmed);unconfirmed.await();assertNotNull(unconfirmed.error);assertNull(outgoing.get());}
    for(String field:new String[]{"session","navigation","url"}){
     Call stale=new Call(session,true);stale.getData().put(field,field.equals("url")?URL+"changed":"stale");plugin.get().openExternalBrowser(stale);stale.await();assertNotNull("Stale "+field+" refused",stale.error);assertNull(outgoing.get());
    }
    // Diagnose fixture readiness on the same UI turn as the single dispatch.
    // Never relax production visibility or exact committed-page admission.
    Call accepted=new Call(session,priv);
    BoundedActivityScenario.main(()->{try{
     AlphaBrowserPlugin p=plugin.get();Object t=tab.get();
     assertEquals("Fixture session still current",session,get(p,"session"));
     assertEquals("Fixture remains presented","handoff",get(p,"presentedId"));
     assertFalse("Activity must be resumed",(Boolean)get(p,"paused"));
     assertFalse("Plugin must be alive",(Boolean)get(p,"destroyed"));
     assertTrue("Child WebView attached and visible",web.get().isShown());
     assertEquals("Synthetic native page URL",URL,web.get().getUrl());
     assertEquals("Committed tab URL",URL,get(t,"url"));
     assertEquals("Navigation identity",7L,get(t,"navigation"));
     assertEquals("Committed",true,get(t,"committed"));
     assertEquals("Finished",false,get(t,"loading"));
     assertEquals("No page failure","",get(t,"error"));
     assertTrue("HTTPS page is external to privileged host",BrowserExternalPage.allowed(URL,p.getBridge().getWebView().getUrl()));
     p.openExternalBrowser(accepted);
    }catch(Exception failure){throw new AssertionError(failure);}});
    accepted.await();assertNull(accepted.error);
    Intent chooser=outgoing.getAndSet(null);assertNotNull("Actual chooser dispatch intercepted",chooser);assertEquals(Intent.ACTION_CHOOSER,chooser.getAction());
    Intent target=chooser.getParcelableExtra(Intent.EXTRA_INTENT);assertNotNull(target);assertEquals(Intent.ACTION_VIEW,target.getAction());assertEquals(URL,target.getDataString());assertEquals("fixture.browser",target.getComponent().getPackageName());assertEquals(Collections.singleton(Intent.CATEGORY_BROWSABLE),target.getCategories());assertNull("No cookies, form or page contents",target.getExtras());assertNull(target.getClipData());assertNull(target.getSelector());assertEquals(0,target.getFlags());assertEquals("Duplicate and own/deep-link targets excluded",0,chooser.getParcelableArrayExtra(Intent.EXTRA_INITIAL_INTENTS).length);
    BoundedActivityScenario.main(()->{try{set(plugin.get(),"externalBrowserResolver",(Function<Intent,List<ResolveInfo>>)intent->Collections.emptyList());}catch(Exception failure){throw new AssertionError(failure);}});
    Call absent=new Call(session,priv);plugin.get().openExternalBrowser(absent);absent.await();assertNotNull(absent.error);assertTrue(absent.error,absent.error.contains("No other installed browser"));assertNull(outgoing.get());
    BoundedActivityScenario.main(()->{try{((FrameLayout)get(tab.get(),"frame")).setVisibility(View.GONE);}catch(Exception failure){throw new AssertionError(failure);}});
    Call hidden=new Call(session,priv);plugin.get().openExternalBrowser(hidden);hidden.await();assertNotNull(hidden.error);assertNull(outgoing.get());
   }finally{instrumentation.removeMonitor(monitor);}
  }
 }
}
