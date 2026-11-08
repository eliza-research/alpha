package ai.elizaresearch.alphaphone;

import android.webkit.*;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.*;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import static org.junit.Assert.*;

/** P-19 on real product child WebViews. Every HTTPS response is local synthetic content;
 * this proves embedded cookie policy, not acceptance by a live identity provider. */
public final class BrowserCookiePolicyInstrumentedTest {
 private static WebView build(MainActivity activity,String id,boolean priv,String profile)throws Exception{
  Object plugin=activity.getBridge().getPlugin("AlphaBrowser").getInstance();
  java.lang.reflect.Method build=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredMethod("build",String.class,boolean.class,String.class);build.setAccessible(true);
  Object tab=build.invoke(plugin,id,priv,profile);java.lang.reflect.Field web=tab.getClass().getDeclaredField("web");web.setAccessible(true);return (WebView)web.get(tab);
 }
 /** Exercise the real product popup callback with a controlled committed opener.
  * The intercepted fixture replaces navigation callbacks, so supply only their
  * committed/selected state; the product constructs and profiles the child. */
 private static WebView popup(MainActivity activity,WebView opener)throws Exception{
  AlphaBrowserPlugin plugin=(AlphaBrowserPlugin)activity.getBridge().getPlugin("AlphaBrowser").getInstance();
  java.lang.reflect.Field tabs=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("tabs");tabs.setAccessible(true);
  Object selected=null;String id=null;
  for(Object tab:((java.util.Map<?,?>)tabs.get(plugin)).values()){
   java.lang.reflect.Field web=tab.getClass().getDeclaredField("web");web.setAccessible(true);
   if(web.get(tab)==opener){selected=tab;java.lang.reflect.Field key=tab.getClass().getDeclaredField("id");key.setAccessible(true);id=(String)key.get(tab);break;}
  }
  assertNotNull("Owned fixture opener exists",selected);
  java.lang.reflect.Field committed=selected.getClass().getDeclaredField("committed");committed.setAccessible(true);committed.setBoolean(selected,true);
  java.lang.reflect.Field presented=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("presentedId");presented.setAccessible(true);presented.set(plugin,id);
  WebView.WebViewTransport transport=opener.new WebViewTransport();
  android.os.Message message=android.os.Message.obtain(new android.os.Handler(android.os.Looper.getMainLooper()),()->{});message.obj=transport;
  assertTrue("Product popup callback accepts a reviewed user gesture",opener.getWebChromeClient().onCreateWindow(opener,false,true,message));
  assertNotNull("Product supplied the child",transport.getWebView());return transport.getWebView();
 }
 private static String evaluate(WebView web,String code)throws Exception{
  CountDownLatch done=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();
  BoundedActivityScenario.main(()->web.evaluateJavascript(code,result->{value.set(result);done.countDown();}));
  assertTrue("Synthetic frame evaluation finished",done.await(10,TimeUnit.SECONDS));return value.get();
 }
 private static void frame(WebView web,String token,boolean write)throws Exception{
  evaluate(web,"window.result=null");
  BoundedActivityScenario.main(()->{
   web.setWebViewClient(new WebViewClient(){
    @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest request){
     String body;
     if("parent.invalid".equals(request.getUrl().getHost()))body="<script>window.result=null;addEventListener('message',e=>{if(e.origin==='https://embed.invalid')window.result=e.data;});</script><iframe src='https://embed.invalid/"+token+"'></iframe>";
     else if("embed.invalid".equals(request.getUrl().getHost()))body="<script>"+(write?"document.cookie='alpha_"+token+"=present; Secure; SameSite=None; Path=/; Max-Age=3600';":"")+"parent.postMessage({cookie:document.cookie,bridge:typeof Capacitor},'https://parent.invalid');</script>";
     else body="Fixture route refused";
     return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }
   });
   web.loadUrl("https://parent.invalid/"+token+"?write="+write);
  });
  for(int i=0;i<150;i++){if("true".equals(evaluate(web,"window.result!==null&&typeof window.result==='object'")))return;android.os.SystemClock.sleep(100);}
  fail("Cross-site iframe did not report its cookie result");
 }
 @Test public void normalEmbeddedCookiesShareOnlyNormalProfileAndHostPolicyStaysUnchanged()throws Exception{exercise(false);}
 @Test public void privateEmbeddedCookiesRemainBlockedAndIsolated()throws Exception{
  org.junit.Assume.assumeTrue("Private tabs require secure scoped deletion",WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA));exercise(true);
 }
 private void exercise(boolean priv)throws Exception{
  String token=UUID.randomUUID().toString().replace("-","");AtomicReference<WebView> first=new AtomicReference<>(),second=new AtomicReference<>(),child=new AtomicReference<>();boolean[] hostPolicy=new boolean[1];
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   WebViewTestDriver.withActivity(MainActivity.class,activity->{try{
    hostPolicy[0]=CookieManager.getInstance().acceptThirdPartyCookies(activity.getBridge().getWebView());
    assertFalse("Privileged host refuses third-party cookies",hostPolicy[0]);
    String profile=priv?AlphaBrowserPlugin.PRIVATE_PREFIX+token:AlphaBrowserPlugin.PERSISTENT_PROFILE;
    first.set(build(activity,"cookies_a",priv,profile));second.set(build(activity,"cookies_b",priv,profile));
    if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION))assertEquals("Passkeys stay disabled in both profiles",WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_NONE,WebSettingsCompat.getWebAuthenticationSupport(first.get().getSettings()));
    assertEquals("Per-tab policy",!priv,WebViewCompat.getProfile(first.get()).getCookieManager().acceptThirdPartyCookies(first.get()));
    assertEquals("Second tab policy",!priv,WebViewCompat.getProfile(second.get()).getCookieManager().acceptThirdPartyCookies(second.get()));
    assertEquals(profile,WebViewCompat.getProfile(first.get()).getName());
    assertNotEquals("Browser profile is never privileged host",WebViewCompat.getProfile(activity.getBridge().getWebView()).getName(),profile);
    assertEquals("Host policy unchanged",hostPolicy[0],CookieManager.getInstance().acceptThirdPartyCookies(activity.getBridge().getWebView()));
   }catch(Exception failure){throw new AssertionError(failure);}});
   try{
   frame(first.get(),token,true);
   assertEquals("Embedded cookie write follows policy",String.valueOf(!priv),evaluate(first.get(),"window.result.cookie.includes('alpha_"+token+"=present')"));
   assertEquals("No privileged bridge in iframe","\"undefined\"",evaluate(first.get(),"window.result.bridge"));
   frame(second.get(),token,false);
   assertEquals("Second tab follows same profile policy",String.valueOf(!priv),evaluate(second.get(),"window.result.cookie.includes('alpha_"+token+"=present')"));
   WebViewTestDriver.withActivity(MainActivity.class,activity->{try{
    child.set(popup(activity,first.get()));
    assertEquals("Popup inherits opener profile",WebViewCompat.getProfile(first.get()).getName(),WebViewCompat.getProfile(child.get()).getName());
    assertEquals("Popup inherits third-party policy",!priv,WebViewCompat.getProfile(child.get()).getCookieManager().acceptThirdPartyCookies(child.get()));
   }catch(Exception failure){throw new AssertionError(failure);}});
   frame(child.get(),token,false);
   assertEquals("Popup iframe follows inherited cookie policy",String.valueOf(!priv),evaluate(child.get(),"window.result.cookie.includes('alpha_"+token+"=present')"));
   assertEquals("No privileged bridge in popup iframe","\"undefined\"",evaluate(child.get(),"window.result.bridge"));
   WebViewTestDriver.withActivity(MainActivity.class,activity->{
    assertFalse("Host remains strict after popup",CookieManager.getInstance().acceptThirdPartyCookies(activity.getBridge().getWebView()));
    String hostCookies=WebViewCompat.getProfile(activity.getBridge().getWebView()).getCookieManager().getCookie("https://embed.invalid/");
    assertFalse("No browser cookie leaked into host",hostCookies!=null&&hostCookies.contains("alpha_"+token+"="));
   });
   }finally{
   // Exact fixture cookie cleanup, never clear unrelated normal browsing data.
   CountDownLatch removed=new CountDownLatch(1);
   BoundedActivityScenario.main(()->WebViewCompat.getProfile(first.get()).getCookieManager().setCookie("https://embed.invalid/","alpha_"+token+"=; Secure; SameSite=None; Path=/; Max-Age=0",ok->removed.countDown()));
   assertTrue("Fixture cookie cleanup finished",removed.await(10,TimeUnit.SECONDS));
   }
  }
 }
}
