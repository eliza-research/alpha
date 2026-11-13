package ai.alphacompute.alphaphone;

import static org.junit.Assert.*;

import android.content.res.Configuration;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Rotate on Home and with a composer draft: the active view and the draft survive and
 * the visible primary actions stay inside the viewport. The launcher is portrait only, so the
 * same steps assert it stays put.
 * A flag-off build signed out of Eliza Cloud rotates its required sign-in page instead (P-43);
 * AccessibilityLifecycleInstrumentedTest rotates every retained view at 200% font.
 * Emulator evidence only.
 */
@RunWith(AndroidJUnit4.class)
public final class RotationInstrumentedTest {
 private static final String DRAFT="Rotation draft "+System.nanoTime();
 private static String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private static void until(String code)throws Exception{for(int i=0;i<200;i++){if("true".equals(js("Boolean("+code+")")))return;SystemClock.sleep(100);}fail("Rotation flow condition: "+code);}
 static int orientation()throws Exception{AtomicInteger value=new AtomicInteger();WebViewTestDriver.withActivity(MainActivity.class,a->value.set(a.getResources().getConfiguration().orientation));return value.get();}
 static void awaitOrientation(int expected)throws Exception{for(int i=0;i<100;i++){if(orientation()==expected)return;SystemClock.sleep(100);}fail("Activity did not reach orientation "+expected+" (landscape layout required)");}
 /**
  * Visible enabled controls of the active view that are really clipped. Home scrolls (its card row
  * sideways with mandatory snap points, its app grid down in landscape), so each control is first
  * scrolled to, trying every alignment because a "nearest" request snaps back on the card row.
  * After the best alignment the control's whole box (1px tolerance) must lie inside the viewport
  * and inside every ancestor that clips. A part may stay outside only along an axis in which a
  * scrolling ancestor is smaller than the control itself, where it is reachable piece by piece.
  * The check waits for layout between scrolls, so it runs asynchronously and is polled.
  */
 static final String CLIPPED="window.__rotationClipped=null;(async()=>{const frame=()=>new Promise(r=>requestAnimationFrame(()=>r())); const cut=e=>{const r=e.getBoundingClientRect(),why=[];if(!r.width||!r.height)return why; const check=(name,left,top,right,bottom,sx,sy)=>{if(Math.max(left-r.left,r.right-right)>1&&!(sx&&r.width>right-left))why.push(name+' x');if(Math.max(top-r.top,r.bottom-bottom)>1&&!(sy&&r.height>bottom-top))why.push(name+' y');}; let fixed=getComputedStyle(e).position==='fixed'; for(let p=e.parentElement;p&&!fixed;p=p.parentElement){const s=getComputedStyle(p),cx=s.overflowX!=='visible',cy=s.overflowY!=='visible';if(cx||cy){const b=p.getBoundingClientRect(),scrolls=v=>v==='auto'||v==='scroll';check((p.getAttribute('aria-label')||p.className||p.tagName).toString().slice(0,30),cx?b.left:-1e9,cy?b.top:-1e9,cx?b.right:1e9,cy?b.bottom:1e9,scrolls(s.overflowX)&&p.scrollWidth>p.clientWidth,scrolls(s.overflowY)&&p.scrollHeight>p.clientHeight);}if(s.position==='fixed')fixed=true;} check('viewport',0,0,innerWidth,innerHeight,false,false);return why;}; const out=[]; for(const e of [...document.querySelectorAll('button,[role=button]')].filter(e=>!e.disabled&&e.getClientRects().length&&!e.closest('[inert],[aria-hidden=\"true\"]'))){ let why=[]; for(const align of ['nearest','center','start','end']){e.scrollIntoView({block:align,inline:align,behavior:'instant'});await frame();await frame();why=cut(e);if(!why.length)break;} if(why.length){const rect=n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {tag:n.tagName,classes:String(n.className).slice(0,100),x:r.x,y:r.y,width:r.width,height:r.height,scrollLeft:n.scrollLeft,scrollTop:n.scrollTop,scrollWidth:n.scrollWidth,scrollHeight:n.scrollHeight,overflowX:s.overflowX,overflowY:s.overflowY,position:s.position,transform:s.transform};};const ancestors=[];for(let p=e.parentElement;p&&ancestors.length<12;p=p.parentElement)ancestors.push(rect(p));out.push({label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,100),reasons:why,control:rect(e),ancestors,viewport:{width:innerWidth,height:innerHeight,x:scrollX,y:scrollY,visualWidth:visualViewport?.width,visualHeight:visualViewport?.height},phoneScale:getComputedStyle(document.documentElement).getPropertyValue('--phone-scale')});}} return out;})().then(v=>window.__rotationClipped=JSON.stringify(v),e=>window.__rotationClipped=JSON.stringify(['check failed: '+e]))";
 /** Package-private: AccessibilityLifecycleInstrumentedTest rotates every view with the same check. */
 static String clipped()throws Exception{
  js(CLIPPED);
  for(int i=0;i<200;i++){String value=js("window.__rotationClipped");if(!"null".equals(value))return (String)new org.json.JSONTokener(value).nextValue();SystemClock.sleep(100);}
  fail("Clipping check did not finish");return null;
 }

 private static void rotateAndCheck(UiDevice device,String view,String extra)throws Exception{
  device.setOrientationLeft();SystemClock.sleep(1500);
  assertEquals("The launcher stays portrait",Configuration.ORIENTATION_PORTRAIT,orientation());
  device.setOrientationNatural();until(AppNavigation.selected(view));if(extra!=null)until(extra);
 }

 @Test public void homeAndComposerDraftSurviveRotation()throws Exception{
  // P-43: a flag-off build signed out of Eliza Cloud shows only the sign-in page (requiredSignInSurvivesRotation).
  AppNavigation.assumeNoRequiredSignIn("Rotation on Home with a composer draft");
  UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   js(AppNavigation.request("Home"));until(AppNavigation.selected("Home"));AppNavigation.declineStartupAccess();
   rotateAndCheck(device,"Home",null);
   js(AppNavigation.type());until(AppNavigation.composer());
   js("(()=>{const e="+AppNavigation.composer()+";Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,"+JSONObject.quote(DRAFT)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
   String kept="("+AppNavigation.composer()+")?.value==="+JSONObject.quote(DRAFT);
   until(kept);
   rotateAndCheck(device,"Home",kept);
  }finally{
   device.setOrientationNatural();device.unfreezeRotation();
  }
 }
 /**
  * The first screen of a signed-out production phone (P-43) on its side and back: the page stays,
  * every control on it is on screen (CLIPPED) and nothing was typed or sent. Skipped wherever the
  * page does not open (the test-mocks pair, a phone its owner signed in).
  */
 @Test public void requiredSignInSurvivesRotation()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  org.junit.Assume.assumeTrue("Only a flag-off build signed out of Eliza Cloud opens the required sign-in page (P-43)",new AlphaCredentialStore(context).readCredentialSlot("cloud:production")==null);
  UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  String page="document.querySelector('.alpha-auth-page #cloud-sign-in-title')?.textContent==='Welcome to Alpha.'";
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   until(page);
   for(int turn=0;turn<2;turn++){
    device.setOrientationLeft();
    SystemClock.sleep(1500);assertEquals("The launcher stays portrait",Configuration.ORIENTATION_PORTRAIT,orientation());until(page);
    device.setOrientationNatural();awaitOrientation(Configuration.ORIENTATION_PORTRAIT);until(page);
    assertEquals("Sign-in controls clipped after returning to portrait","[]",clipped());
   }
  }finally{
   device.setOrientationNatural();device.unfreezeRotation();
  }
 }
}
