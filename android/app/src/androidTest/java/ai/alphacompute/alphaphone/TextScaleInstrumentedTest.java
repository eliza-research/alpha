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
 private void open(String name)throws Exception{js(AppNavigation.request(name));until(AppNavigation.selected(name));}
 private void setSlider(int value)throws Exception{
  // Text size is a slider on the Settings top level.
  open("Settings");
  String slider="document.querySelector('input[aria-label=\"Text size\"]')";until(slider);
  js("(()=>{const e="+slider+";Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'"+value+"');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
 }
 private void zoom(int percent)throws Exception{
  java.util.concurrent.atomic.AtomicBoolean good=new java.util.concurrent.atomic.AtomicBoolean();
  for(int i=0;i<100;i++){WebViewTestDriver.withActivity(MainActivity.class,a->good.set(AlphaDevicePlugin.textScalePercent(a)==percent&&a.getBridge().getWebView().getSettings().getTextZoom()==AlphaDevicePlugin.effectiveTextZoom(a,percent)));if(good.get())return;SystemClock.sleep(100);}fail("Native persisted/effective text zoom mismatch");
 }
 private double headingHeight()throws Exception{
  until("document.fonts.status==='loaded' && document.querySelector('h1')?.textContent==='Notes'");
  return Double.parseDouble(js("(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('h1'));return r.getBoundingClientRect().height})()"));
 }
 private void restore(int percent)throws Exception{js("window.Capacitor.Plugins.AlphaDevice.setTextScale({percent:"+percent+"})");zoom(percent);}
 @Test public void textSizeChangesRealNotesAndSurvivesActivityRecreation()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();int previous=AlphaDevicePlugin.textScalePercent(context);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   try{AppNavigation.liveMode();setSlider(50);zoom(100);open("Notes");double initial=headingHeight();assertTrue(initial>0);
    setSlider(100);zoom(150);open("Notes");assertTrue("Actual text glyph bounds enlarged",headingHeight()>initial*1.2);
    scenario.recreate();AppNavigation.liveMode();zoom(150);open("Notes");assertTrue("Restored rendered text still enlarged",headingHeight()>initial*1.2);
   }finally{restore(previous);}
  }
 }
 @Test public void textScaleProcessRestartPhase()throws Exception{
  String phase=InstrumentationRegistry.getArguments().getString("textScalePhase");org.junit.Assume.assumeTrue("Explicit separate-process runner",phase!=null);
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();File fixture=new File(context.getFilesDir(),"text-scale-fixture.json");
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   if("prepare".equals(phase)){
    assertFalse("Never overwrite an existing recovery fixture",fixture.exists());JSONObject record=new JSONObject().put("previous",AlphaDevicePlugin.textScalePercent(context)).put("pid",android.os.Process.myPid());Files.write(fixture.toPath(),record.toString().getBytes(StandardCharsets.UTF_8));
    setSlider(50);zoom(100);open("Notes");record.put("baseline",headingHeight());Files.write(fixture.toPath(),record.toString().getBytes(StandardCharsets.UTF_8));setSlider(100);zoom(150);
   }else if("verify".equals(phase)){
    JSONObject record=new JSONObject(new String(Files.readAllBytes(fixture.toPath()),StandardCharsets.UTF_8));assertNotEquals("Verification runs in a different app process",record.getInt("pid"),android.os.Process.myPid());zoom(150);open("Notes");assertTrue("New-process text layout uses persisted scale",headingHeight()>record.getDouble("baseline")*1.2);
   }else if("cleanup".equals(phase)){
    if(fixture.exists()){JSONObject record=new JSONObject(new String(Files.readAllBytes(fixture.toPath()),StandardCharsets.UTF_8));restore(record.getInt("previous"));assertTrue(fixture.delete());}
   }else fail("Unknown text scale phase");
  }
 }
}
