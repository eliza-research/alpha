package ai.alphacompute.alphaphone;

import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Actual host WebView text layout and persisted preference; child browser excluded. */
@RunWith(AndroidJUnit4.class)
public final class TextScaleInstrumentedTest {
 private String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private void until(String code)throws Exception{for(int i=0;i<200;i++){if("true".equals(js("Boolean("+code+")")))return;SystemClock.sleep(100);}fail("Text size flow condition: "+code);}
 private void open(String name)throws Exception{
  js(AppNavigation.request(name));
  until(AppNavigation.selected(name)+"&&window.__alphaTestNavigation?.status==='complete'");
 }
 private String button(String page,String label){
  return "(()=>{const p=Array.from(document.querySelectorAll('[data-settings-page]')).at(-1);"
   +"return p?.getAttribute('data-settings-page')==="+JSONObject.quote(page)
   +"&&Array.from(p.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==="+JSONObject.quote(label)
   +"&&!b.disabled&&b.getClientRects().length&&!b.closest('[inert],[aria-hidden=true]'));})()";
 }
 private void click(String control)throws Exception{until(control);js("("+control+").click()");}
 private void chooseSize(String name,int percent,float systemScale)throws Exception{
  open("Settings");
  click(button("Settings","General"));
  click(button("General","Display"));
  String label="Text size: "+name,selected=button("Display",label+", selected");
  click(button("Display",label)+"||"+selected);
  until(selected+"?.getAttribute('aria-pressed')==='true'");
  zoom(percent,systemScale);
 }
 private static float systemScale(android.content.Context context){
  float value=android.provider.Settings.System.getFloat(context.getContentResolver(),android.provider.Settings.System.FONT_SCALE,1.0f);
  assertTrue("The device font scale is valid",Float.isFinite(value)&&value>0);
  return value;
 }
 private void zoom(int percent,float systemScale)throws Exception{
  java.util.concurrent.atomic.AtomicBoolean good=new java.util.concurrent.atomic.AtomicBoolean();
  java.util.concurrent.atomic.AtomicReference<String> observed=new java.util.concurrent.atomic.AtomicReference<>();
  int expected=Math.max(1,Math.round(percent*systemScale));
  for(int i=0;i<100;i++){
   WebViewTestDriver.withActivity(MainActivity.class,a->{
    float configured=a.getResources().getConfiguration().fontScale;
    int saved=AlphaDevicePlugin.textScalePercent(a), actual=a.getBridge().getWebView().getSettings().getTextZoom();
    observed.set("system="+configured+", saved="+saved+", zoom="+actual);
    good.set(configured==systemScale&&saved==percent&&actual==expected);
   });
   if(good.get())return;
   SystemClock.sleep(100);
  }
  fail("Expected system="+systemScale+", saved="+percent+", zoom="+expected+"; observed "+observed.get());
 }
 private double headingHeight()throws Exception{
  until("document.fonts.status==='loaded' && document.querySelector('h1')?.textContent==='Notes'");
  return Double.parseDouble(js("(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('h1'));return r.getBoundingClientRect().height})()"));
 }
 private void restore(int percent,float systemScale)throws Exception{js("window.Capacitor.Plugins.AlphaDevice.setTextScale({percent:"+percent+"})");zoom(percent,systemScale);}
 @Test public void textSizeChangesRealNotesAndSurvivesActivityRecreation()throws Exception{
  AppNavigation.assumeNoRequiredSignIn("Display and Notes text size");
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();int previous=AlphaDevicePlugin.textScalePercent(context);float systemScale=systemScale(context);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   try{AppNavigation.liveMode();chooseSize("Default",100,systemScale);open("Notes");double initial=headingHeight();assertTrue(initial>0);
    chooseSize("Largest",150,systemScale);open("Notes");assertTrue("Actual text glyph bounds enlarged",headingHeight()>initial*1.2);
    scenario.recreate();AppNavigation.liveMode();zoom(150,systemScale);open("Notes");assertTrue("Restored rendered text still enlarged",headingHeight()>initial*1.2);
   }finally{restore(previous,systemScale);}
  }
 }
 @Test public void textScaleProcessRestartPhase()throws Exception{
  String phase=InstrumentationRegistry.getArguments().getString("textScalePhase");org.junit.Assume.assumeTrue("Explicit separate-process runner",phase!=null);
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();File fixture=new File(context.getFilesDir(),"text-scale-fixture.json");
  if(!"cleanup".equals(phase))AppNavigation.assumeNoRequiredSignIn("Text size across a process restart");
  float systemScale=systemScale(context);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   if("prepare".equals(phase)){
    assertFalse("Never overwrite an existing recovery fixture",fixture.exists());JSONObject record=new JSONObject().put("previous",AlphaDevicePlugin.textScalePercent(context)).put("pid",android.os.Process.myPid());Files.write(fixture.toPath(),record.toString().getBytes(StandardCharsets.UTF_8));
    chooseSize("Default",100,systemScale);open("Notes");record.put("baseline",headingHeight()).put("systemScale",systemScale);Files.write(fixture.toPath(),record.toString().getBytes(StandardCharsets.UTF_8));chooseSize("Largest",150,systemScale);
   }else if("verify".equals(phase)){
    JSONObject record=new JSONObject(new String(Files.readAllBytes(fixture.toPath()),StandardCharsets.UTF_8));assertNotEquals("Verification runs in a different app process",record.getInt("pid"),android.os.Process.myPid());assertEquals("System font scale stayed fixed",record.getDouble("systemScale"),systemScale,0.0);zoom(150,systemScale);open("Notes");assertTrue("New-process text layout uses persisted scale",headingHeight()>record.getDouble("baseline")*1.2);
   }else if("cleanup".equals(phase)){
    if(fixture.exists()){JSONObject record=new JSONObject(new String(Files.readAllBytes(fixture.toPath()),StandardCharsets.UTF_8));restore(record.getInt("previous"),systemScale);assertTrue(fixture.delete());}
   }else fail("Unknown text scale phase");
  }
 }
}
