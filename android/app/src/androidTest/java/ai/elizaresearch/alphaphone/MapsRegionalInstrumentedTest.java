package ai.elizaresearch.alphaphone;

import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Requires the explicitly configured real regional gateway; never uploads GPS. */
@RunWith(AndroidJUnit4.class)
public final class MapsRegionalInstrumentedTest {
 private String js(String script)throws Exception{return WebViewTestDriver.evaluate(script);}
 private void waitFor(String predicate)throws Exception{for(int i=0;i<300;i++){if("true".equals(js("Boolean("+predicate+")")))return;SystemClock.sleep(100);}fail("Regional Maps state missing: "+predicate+"; diagnostics="+js("JSON.stringify({view:document.documentElement.dataset.activeView,plane:!!document.querySelector('[data-alpha-map-plane]'),ready:document.querySelector('[data-alpha-map-plane]')?.dataset.mapReady,features:document.querySelector('[data-alpha-map-plane]')?.dataset.mapFeatureCount,error:document.querySelector('[data-alpha-map-plane]')?.dataset.mapError,capabilities:document.querySelector('[data-alpha-maps-root]')?.dataset.mapDiagnostics,status:document.querySelector('[data-alpha-maps-status]')?.textContent.slice(0,220)})"));}
 private void click(String label)throws Exception{String q="[...document.querySelectorAll('[data-alpha-maps-root] button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";waitFor(q);js("("+q+").click()");}
 private void input(String label,String value)throws Exception{
  String q="document.querySelector('input[aria-label="+JSONObject.quote(label)+"]')";waitFor(q);
  js("(()=>{const e="+q+";Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  waitFor(q+".value==="+JSONObject.quote(value));js(q+".dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
 }
 private void capture(String file)throws Exception{
  android.graphics.Bitmap screenshot=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();assertNotNull("Actual screen screenshot",screenshot);
  try(java.io.FileOutputStream output=new java.io.FileOutputStream(new java.io.File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),file))){assertTrue("Screenshot saved",screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output));}finally{screenshot.recycle();}
 }
 @Test public void nativeRegionalTransportCapabilitiesAndTile()throws Exception{
  org.junit.Assume.assumeTrue("Configured regional backend only", "1".equals(InstrumentationRegistry.getArguments().getString("mapsRegional")));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   js("(()=>{window.__regionalProbe={done:false};const p=window.Capacitor.Plugins.AlphaMapsTransport;p.request({path:'/capabilities',requestId:'probe_capabilities'}).then(r=>{const m=JSON.parse(atob(r.data));return p.request({path:'/tiles/14/8530/5974.pbf',requestId:'probe_tile'}).then(t=>{window.__regionalProbe={done:true,status:r.status,provider:m.providerId,tileStatus:t.status,tileBytes:atob(t.data).length,gzip:atob(t.data).startsWith(String.fromCharCode(31,139))};});}).catch(e=>{window.__regionalProbe={done:true,error:String(e.message).slice(0,160)};});return true;})()");
   waitFor("window.__regionalProbe?.done");String result=js("JSON.stringify(window.__regionalProbe)");
   assertEquals("Actual native transport proof: "+result,"true",js("window.__regionalProbe.status===200 && window.__regionalProbe.provider==='alpha-osm-monaco' && window.__regionalProbe.tileStatus===200 && window.__regionalProbe.tileBytes>0 && window.__regionalProbe.gzip===false"));
   js("delete window.__regionalProbe");
  }
 }
 @Test public void realRegionalTilesSearchRoutesAndOutsideCoverage()throws Exception{
  org.junit.Assume.assumeTrue("Configured regional backend only", "1".equals(InstrumentationRegistry.getArguments().getString("mapsRegional")));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();js(AppNavigation.request("Maps"));waitFor(AppNavigation.selected("Maps"));
   waitFor("document.querySelector('[data-alpha-map-plane]')?.dataset.mapReady==='true'");
   waitFor("Number(document.querySelector('[data-alpha-map-plane]')?.dataset.mapFeatureCount)>0");
   waitFor("document.querySelector('[data-alpha-maps-root]').textContent.includes('Monaco')");
   capture("maps-regional-map.png");
   input("Search places","Casino de Monte Carlo");
   String result="[...document.querySelectorAll('[data-alpha-maps-root] button')].find(e=>e.textContent.trim().startsWith('Casino de Monte Carlo'))";waitFor(result);js("("+result+").click()");
   click("Directions");input("Route origin coordinates","43.7384, 7.4246");
   waitFor("document.querySelector('[data-alpha-maps-root]').textContent.includes('no live traffic')");
   for(String mode:new String[]{"Walk","Bike","Drive"}){click(mode);waitFor("document.querySelector('[data-alpha-maps-root]').textContent.includes('no live traffic')");}
   waitFor("Number(document.querySelector('[data-alpha-map-plane]')?.dataset.mapFeatureCount)>0");
   capture("maps-regional-route.png");
   input("Route origin coordinates","37, -122");waitFor("document.querySelector('[data-alpha-maps-root]').textContent.includes('Both endpoints must be inside the Monaco region.')");
   assertEquals("Stale route removed","false",js("document.querySelector('[data-alpha-maps-root]').textContent.includes('no live traffic')"));
   input("Route origin coordinates","43.7384, 7.4246");waitFor("document.querySelector('[data-alpha-maps-root]').textContent.includes('no live traffic')");
   js(AppNavigation.request("Notes"));waitFor(AppNavigation.selected("Notes"));assertEquals("Map canvas disposed when leaving","false",js("!!document.querySelector('[data-alpha-map-plane] canvas')"));
   js(AppNavigation.request("Maps"));waitFor(AppNavigation.selected("Maps"));waitFor("document.querySelector('[data-alpha-map-plane]')?.dataset.mapReady==='true'");
   assertEquals("Routes never resume automatically","false",js("document.querySelector('[data-alpha-maps-root]').textContent.includes('no live traffic')"));
  }
 }
 private void navigationPhase(String phase)throws Exception{
  java.io.File file=new java.io.File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"maps-navigation-phase.txt");
  try(java.io.FileOutputStream output=new java.io.FileOutputStream(file)){output.write(phase.getBytes(java.nio.charset.StandardCharsets.UTF_8));}
  java.io.File ack=new java.io.File(file.getParentFile(),"maps-navigation-ack.txt");
  for(int i=0;i<150;i++){if(ack.isFile()){try(java.io.BufferedReader reader=new java.io.BufferedReader(new java.io.FileReader(ack))){if(phase.equals(reader.readLine()))return;}}SystemClock.sleep(100);}
  fail("GPS runner did not acknowledge phase "+phase);
 }
 private void watches(int expected)throws Exception{
  java.util.concurrent.atomic.AtomicInteger count=new java.util.concurrent.atomic.AtomicInteger(-1);
  for(int i=0;i<100;i++){
   WebViewTestDriver.withActivity(MainActivity.class,activity->{try{Object plugin=activity.getBridge().getPlugin("ElizaLocation").getInstance();java.lang.reflect.Field field=plugin.getClass().getDeclaredField("watches");field.setAccessible(true);count.set(((java.util.Map<?,?>)field.get(plugin)).size());}catch(Exception error){throw new AssertionError(error);}});
   if(count.get()==expected)return;SystemClock.sleep(100);
  }
  assertEquals("Actual native watch count",expected,count.get());
 }
 private void startNavigation()throws Exception{
  String start="[...document.querySelectorAll('[data-alpha-maps-root] button')].find(e=>e.textContent.trim()==='Start')";
  waitFor(start);js("("+start+").click()");
 }
 @Test public void foregroundNavigationUsesRealGpsAndReleasesNativeWatches()throws Exception{
  org.junit.Assume.assumeTrue("Explicit simulator GPS runner only", "1".equals(InstrumentationRegistry.getArguments().getString("mapsNavigation")));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();js(AppNavigation.request("Maps"));waitFor(AppNavigation.selected("Maps"));
   waitFor("document.querySelector('[data-alpha-map-plane]')?.dataset.mapReady==='true'");
   input("Search places","Casino de Monte Carlo");
   String result="[...document.querySelectorAll('[data-alpha-maps-root] button')].find(e=>e.textContent.trim().startsWith('Casino de Monte Carlo'))";waitFor(result);js("("+result+").click()");
   click("Directions");input("Route origin coordinates","43.7384, 7.4246");
   waitFor("document.querySelector('[data-alpha-maps-root]').textContent.includes('no live traffic')");
   navigationPhase("origin");startNavigation();watches(1);
   waitFor("document.querySelector('[data-alpha-maps-status]')?.textContent.includes('Foreground guidance · location accuracy')");
   navigationPhase("off-route");waitFor("document.querySelector('[data-alpha-maps-status]')?.textContent.includes('Off route. Stop and calculate a new route.')");
   navigationPhase("arrival");waitFor("document.querySelector('[data-alpha-maps-status]')?.textContent.includes('Destination reached.')");watches(0);
   click("End navigation");watches(0);
   navigationPhase("origin-again");startNavigation();watches(1);
   waitFor("document.querySelector('[data-alpha-maps-status]')?.textContent.includes('Foreground guidance · location accuracy')");
   click("End navigation");watches(0);
   startNavigation();watches(1);js(AppNavigation.request("Notes"));waitFor(AppNavigation.selected("Notes"));watches(0);
   js(AppNavigation.request("Maps"));waitFor(AppNavigation.selected("Maps"));
   waitFor("document.querySelector('[data-alpha-map-plane]')?.dataset.mapReady==='true'");watches(0);
   assertEquals("Navigation does not resume", "false",js("!!document.querySelector('[aria-label=\"End navigation\"]')"));
   
  }finally{new java.io.File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"maps-navigation-phase.txt").delete();new java.io.File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"maps-navigation-ack.txt").delete();}
 }

 private void permissionButton(String suffix)throws Exception{
  for(int attempt=0;attempt<150;attempt++){
   android.view.accessibility.AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
   java.util.ArrayDeque<android.view.accessibility.AccessibilityNodeInfo> queue=new java.util.ArrayDeque<>();if(root!=null)queue.add(root);
   while(!queue.isEmpty()){
    android.view.accessibility.AccessibilityNodeInfo node=queue.remove();String id=node.getViewIdResourceName();
    if(node.isVisibleToUser()&&id!=null&&id.endsWith(suffix)&&node.isClickable()){assertTrue(node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK));return;}
    for(int i=0;i<node.getChildCount();i++){android.view.accessibility.AccessibilityNodeInfo child=node.getChild(i);if(child!=null)queue.add(child);}
   }SystemClock.sleep(100);
  }fail("Actual Android permission button unavailable: "+suffix);
 }
 @Test public void deniedLocationAllowsManualOriginAndExplicitPermissionRetry()throws Exception{
  org.junit.Assume.assumeTrue("Explicit permission fixture only", "1".equals(InstrumentationRegistry.getArguments().getString("mapsPermission")));
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertEquals(android.content.pm.PackageManager.PERMISSION_DENIED,context.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();js(AppNavigation.request("Maps"));waitFor(AppNavigation.selected("Maps"));
   click("Recenter");permissionButton(":id/permission_deny_button");
   waitFor("document.querySelector('[data-alpha-maps-status]')?.textContent.includes('Location permission was not granted')");watches(0);
   input("Search places","43.7384, 7.4246");waitFor("document.querySelector('[aria-label=\"Rename place\"]')?.textContent==='Dropped pin'");watches(0);
   click("Close place");navigationPhase("permission-gps");click("Recenter");permissionButton(":id/permission_allow_foreground_only_button");
   waitFor("document.querySelector('[aria-label=\"Rename place\"]')?.textContent==='Current location'");
   waitFor("document.querySelector('[data-alpha-maps-root]').textContent.includes('43.73840, 7.42460')");watches(0);
   js(AppNavigation.request("Notes"));waitFor(AppNavigation.selected("Notes"));watches(0);
  }
 }
 @Test public void configuredGatewayFailureRecoversOnlyAfterExplicitRetry()throws Exception{
  org.junit.Assume.assumeTrue("Owned gateway interruption fixture only", "1".equals(InstrumentationRegistry.getArguments().getString("mapsOutage")));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();navigationPhase("capabilities-stop");js(AppNavigation.request("Maps"));waitFor(AppNavigation.selected("Maps"));
   waitFor("document.querySelector('[data-alpha-maps-status]')?.textContent.includes('Submit a search to retry')");
   assertEquals("No invented map while provider is unreachable","false",js("!!document.querySelector('[data-alpha-map-plane] canvas')"));
   navigationPhase("capabilities-restore");input("Search places","Casino de Monte Carlo");
   String result="[...document.querySelectorAll('[data-alpha-maps-root] button')].find(e=>e.textContent.trim().startsWith('Casino de Monte Carlo'))";waitFor(result);js("("+result+").click()");
   click("Directions");input("Route origin coordinates","43.7384, 7.4246");waitFor("document.querySelector('[data-alpha-maps-root]').textContent.includes('no live traffic')");
   navigationPhase("route-stop");
   long failureStarted=SystemClock.elapsedRealtime();
   js("(()=>{window.__regionalOutageProbe={settled:0,rejected:0};const p=window.Capacitor.Plugins.AlphaMapsTransport;for(let i=0;i<6;i++)p.request({path:'/tiles/14/8530/5974.pbf',requestId:'outage_'+crypto.randomUUID()}).then(()=>{window.__regionalOutageProbe.settled++;},()=>{window.__regionalOutageProbe.settled++;window.__regionalOutageProbe.rejected++;});})()");
   input("Route origin coordinates","43.7385, 7.4246");
   waitFor("document.querySelector('[data-alpha-maps-status]')?.textContent.includes('Regional Maps is unavailable')");
   waitFor("window.__regionalOutageProbe?.settled===6 && window.__regionalOutageProbe.rejected===6");
   assertTrue("Native deadlines include queue time and settle within20seconds",SystemClock.elapsedRealtime()-failureStarted<20000);
   js("delete window.__regionalOutageProbe");
   assertEquals("Failed request removes stale route","false",js("document.querySelector('[data-alpha-maps-root]').textContent.includes('no live traffic')"));
   navigationPhase("route-restore");input("Route origin coordinates","43.7384, 7.4246");
   waitFor("document.querySelector('[data-alpha-maps-root]').textContent.includes('no live traffic')");
   js(AppNavigation.request("Notes"));waitFor(AppNavigation.selected("Notes"));watches(0);
  }
 }

}
