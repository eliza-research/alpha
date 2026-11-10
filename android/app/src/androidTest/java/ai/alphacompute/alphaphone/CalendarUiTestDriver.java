package ai.alphacompute.alphaphone;

import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import static org.junit.Assert.*;

/** A real touch on a rendered Calendar event, shared by the Calendar UI classes. */
final class CalendarUiTestDriver {
 private CalendarUiTestDriver() {}
 private static String eval(String script)throws Exception{return WebViewTestDriver.evaluate(script);}
 static void until(String script)throws Exception{
  for(int i=0;i<150;i++){if("true".equals(eval("Boolean("+script+")")))return;SystemClock.sleep(100);}fail("Calendar condition missing: "+script+"; diagnostics="+eval("({view:document.documentElement.dataset.activeView,text:document.querySelector('[data-screen]')?.textContent?.slice(0,3000),buttons:[...document.querySelectorAll('button[aria-label]')].map(b=>b.getAttribute('aria-label')).slice(-40),tap:window.__calendarTapEvents})"));
 }
 static void tapVisibleEvent(String title)throws Exception {
  String node="[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.startsWith("+JSONObject.quote(title+",")+"))";
  until(node);eval("("+node+").scrollIntoView({block:'center',behavior:'instant'})");
  String check="(()=>{const e="+node+",r=e.getBoundingClientRect(),p=e.closest('.scr').getBoundingClientRect();const top=Math.max(r.top,p.top,0),bottom=Math.min(r.bottom,p.bottom,innerHeight);return bottom>top+8&&(r.height>p.height||(r.top>=p.top&&r.bottom<=p.bottom))&&e.contains(document.elementFromPoint(r.x+r.width/2,(top+bottom)/2))})()";
  until(check);
  // Tap the rendered event only after its finite ancestor entrance animation settles. The timeline's
  // scroll-driven edge fades report "running" for as long as they exist and never advance with time.
  until("(()=>{const e="+node+";return !document.getAnimations().some(a=>a.timeline===document.timeline&&a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity&&a.effect?.target?.contains(e))})()");
  until(check);
  boolean[] focused={false};String[] window={"unobserved"};long focusDeadline=SystemClock.elapsedRealtime()+15000;
  while(SystemClock.elapsedRealtime()<focusDeadline){WebViewTestDriver.withActivity(MainActivity.class,activity->{android.webkit.WebView web=activity.getBridge().getWebView();focused[0]=activity.hasWindowFocus()&&web.hasWindowFocus()&&web.isShown();window[0]="activityFocus="+activity.hasWindowFocus()+" webFocus="+web.hasWindowFocus()+" shown="+web.isShown()+" size="+web.getWidth()+"x"+web.getHeight();});if(focused[0])break;SystemClock.sleep(100);}
  assertTrue("Calendar native tap requires the foreground WebView: "+window[0],focused[0]);
  JSONObject point=new JSONObject(eval("(()=>{const e=("+node+"),r=e.getBoundingClientRect(),p=e.closest('.scr').getBoundingClientRect();return {x:r.x+r.width/2,y:(Math.max(r.top,p.top,0)+Math.min(r.bottom,p.bottom,innerHeight))/2,width:innerWidth}})()"));
  float[] xy=new float[2];
  WebViewTestDriver.withActivity(MainActivity.class,activity->{android.webkit.WebView web=activity.getBridge().getWebView();int[] location=new int[2];web.getLocationOnScreen(location);float scale=(float)(web.getWidth()/point.optDouble("width"));xy[0]=location[0]+(float)point.optDouble("x")*scale;xy[1]=location[1]+(float)point.optDouble("y")*scale;});
  eval("window.__calendarTapEvents=[];for(const name of ['pointerdown','pointerup','click'])document.addEventListener(name,e=>window.__calendarTapEvents.push({type:e.type,label:e.target.closest('button')?.getAttribute('aria-label'),x:e.clientX,y:e.clientY}),{capture:true,once:true})");
  long down=SystemClock.uptimeMillis();
  for(int action:new int[]{android.view.MotionEvent.ACTION_DOWN,android.view.MotionEvent.ACTION_UP}){
   android.view.MotionEvent event=android.view.MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,xy[0],xy[1],0);event.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);
   try{assertTrue("Android accepted calendar event touch",InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(event,true));}finally{event.recycle();}
  }
  until("window.__calendarTapEvents.some(e=>e.type==='click'&&e.label?.startsWith("+JSONObject.quote(title+",")+"))");
 }
}
