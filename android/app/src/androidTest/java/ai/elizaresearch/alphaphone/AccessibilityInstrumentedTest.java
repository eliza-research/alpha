package ai.elizaresearch.alphaphone;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.matcher.ViewMatchers.isRoot;
import static org.junit.Assert.*;

import android.graphics.Rect;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import androidx.test.espresso.accessibility.AccessibilityChecks;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Home, Settings and the composer at 200% system font scale, the page's own measure of that text
 * size, Home text overlap, and the ways into Android's own notification shade (#416, #417; Alpha
 * draws no shade, and a pull on launcher's empty Home asks Android to open its shade):
 * Accessibility Test Framework checks on the native view hierarchy (Espresso) and a
 * UiAutomator check that every actionable node TalkBack reaches has a label, is not
 * clipped off-screen and appears in reading order. Emulator evidence only.
 */
@RunWith(AndroidJUnit4.class)
public final class AccessibilityInstrumentedTest {
 /**
  * One connection for the whole test. A UiAutomation connected without this flag suspends every
  * other accessibility service for as long as it is connected, which would unbind the stand-in
  * screen reader; asking for a connection with different flags drops and reconnects it. UiDevice
  * is given the same flags through Configurator.
  */
 private static final int AUTOMATION_FLAGS=android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES;
 private static android.app.UiAutomation automation(){return InstrumentationRegistry.getInstrumentation().getUiAutomation(AUTOMATION_FLAGS);}
 private static String shell(String command)throws Exception{
  try(InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(automation().executeShellCommand(command))){return new String(in.readAllBytes(),StandardCharsets.UTF_8).trim();}
 }
 private static String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private static void until(String code)throws Exception{for(int i=0;i<200;i++){if("true".equals(js("Boolean("+code+")")))return;SystemClock.sleep(100);}fail("Accessibility flow condition: "+code);}
 private static void open(String view)throws Exception{js(AppNavigation.request(view));until(AppNavigation.selected(view));}

 /** Actionable or labelled leaf nodes in accessibility-tree (TalkBack linear) order. */
 private static void collect(UiObject2 node,List<UiObject2> out){
  List<UiObject2> children=node.getChildren();
  boolean actionable=node.isClickable()||node.isCheckable()||node.isLongClickable();
  String label=(node.getText()==null?"":node.getText())+(node.getContentDescription()==null?"":node.getContentDescription());
  if(actionable||(children.isEmpty()&&!label.trim().isEmpty()))out.add(node);
  for(UiObject2 child:children)collect(child,out);
 }
 /** Failure evidence uses raw AX rectangles as well as UiAutomator's visible bounds. The
  * pinned UiAutomator helper retains the original rectangle when intersection is empty. */
 private static android.view.accessibility.AccessibilityNodeInfo geometryNode(android.view.accessibility.AccessibilityNodeInfo node,String label,int depth){
  if(node==null||depth>60)return null;
  if(label.contentEquals(node.getText()==null?"":node.getText())||label.contentEquals(node.getContentDescription()==null?"":node.getContentDescription()))return node;
  for(int i=0;i<node.getChildCount();i++){android.view.accessibility.AccessibilityNodeInfo found=geometryNode(node.getChild(i),label,depth+1);if(found!=null)return found;}
  return null;
 }
 private static String accessibilityGeometry(String label){
  android.view.accessibility.AccessibilityNodeInfo root=automation().getRootInActiveWindow();
  android.view.accessibility.AccessibilityNodeInfo node=geometryNode(root,label,0);
  StringBuilder out=new StringBuilder(label);
  for(int depth=0;node!=null&&depth<16;depth++,node=node.getParent()){
   Rect raw=new Rect();node.getBoundsInScreen(raw);
   out.append(" < ").append(node.getClassName()).append(" raw=").append(raw.toShortString())
    .append(" scrollable=").append(node.isScrollable()).append(" visible=").append(node.isVisibleToUser());
  }
  return out.toString();
 }
 /** UiAutomator 2.3.0 keeps a nonempty rectangle when intersection with a scrollable
  * ancestor fails. Intersect explicitly so fully clipped descendants do not masquerade as
  * visible controls; partially visible nodes keep only their painted area. */
 private static Rect visibleBounds(UiObject2 node,UiDevice device){
  Rect bounds=node.getVisibleBounds();List<int[]> frames=new ArrayList<>();
  frames.add(new int[]{0,0,device.getDisplayWidth(),device.getDisplayHeight()});
  for(UiObject2 parent=node.getParent();parent!=null;parent=parent.getParent())if(parent.isScrollable()){
   Rect frame=parent.getVisibleBounds();frames.add(new int[]{frame.left,frame.top,frame.right,frame.bottom});
  }
  int[] clipped=AccessibilityBounds.clip(new int[]{bounds.left,bounds.top,bounds.right,bounds.bottom},frames);
  return new Rect(clipped[0],clipped[1],clipped[2],clipped[3]);
 }
 /** A named semantic group, not a geometry/class exception for arbitrary controls. */
 private static boolean assistantGroup(UiObject2 node){
  for(UiObject2 current=node;current!=null;current=current.getParent())
   if("Assistant controls".equals(current.getContentDescription())||"Assistant controls".equals(current.getText()))return true;
  return false;
 }
 private static int assistantGroups(UiObject2 node){
  int count="Assistant controls".equals(node.getContentDescription())||"Assistant controls".equals(node.getText())?1:0;
  for(UiObject2 child:node.getChildren())count+=assistantGroups(child);
  return count;
 }
 private static void talkBackOrder(UiDevice device,String surface)throws Exception{
  device.waitForIdle(2000);
  // The WebView publishes a layer's accessibility nodes shortly after the layer appears; read the
  // tree again until it holds a clickable control (five seconds at most). The checks below are unchanged.
  UiObject2 root=null;List<UiObject2> nodes=new ArrayList<>();
  for(int attempt=0;attempt<25;attempt++){
   root=device.findObject(By.pkg(BuildConfig.APPLICATION_ID).depth(0));nodes=new ArrayList<>();
   if(root!=null){try{collect(root,nodes);}catch(androidx.test.uiautomator.StaleObjectException changing){nodes.clear();}}
   boolean clickable=false;try{for(UiObject2 node:nodes)if(node.isClickable()&&!visibleBounds(node,device).isEmpty())clickable=true;}catch(androidx.test.uiautomator.StaleObjectException changing){clickable=false;}
   if(clickable)break;
   SystemClock.sleep(200);
  }
  assertNotNull(surface+": app window has an accessibility tree",root);
  int width=device.getDisplayWidth();
  List<String> problems=new ArrayList<>();
  UiObject2 previous=null;Rect previousBounds=null;
  int actionable=0;boolean seenAssistant=false,previousAssistant=false;
  assertTrue(surface+": at most one assistant control group",assistantGroups(root)<=1);
  for(UiObject2 node:nodes){
   Rect r=visibleBounds(node,device);
   if(r.isEmpty())continue;
   String label=((node.getText()==null?"":node.getText())+" "+(node.getContentDescription()==null?"":node.getContentDescription())).trim();
   // An empty text field has no text; Android carries its accessible name (aria-label/placeholder) as the hint, which TalkBack reads.
   if(label.isEmpty()&&"android.widget.EditText".equals(node.getClassName())&&node.getHint()!=null)label=node.getHint().trim();
   if(node.isClickable()){actionable++;if(label.isEmpty()&&node.getChildren().stream().noneMatch(c->c.getText()!=null&&!c.getText().trim().isEmpty()))problems.add("unlabelled control at "+r.toShortString());}
   if(r.left<0||r.right>width)problems.add("clipped '"+label+"' at "+r.toShortString());
   boolean assistant=assistantGroup(node);
   if(seenAssistant&&!assistant)problems.add("App content follows the assistant control group");
   seenAssistant|=assistant;
   // Main app content is read before the persistent assistant group. That group
   // floats above the bottom edge, so this semantic transition may move upward.
   // Check every node and retain geometric order checks within each region.
   if(previous!=null&&assistant==previousAssistant){
    Rect p=previousBounds;
    // The next node may start a new column to the right, otherwise it must not read upward.
    if(r.top<p.top-Math.max(p.height(),r.height())/2&&r.left<p.right){
     problems.add("reading order goes up from '"+previous.getText()+"' to '"+label+"'");
     System.out.println("ALPHA_ACCESSIBILITY_ORDER_BOUNDS previous="+p.toShortString()+" next="+r.toShortString());
     System.out.println("ALPHA_ACCESSIBILITY_PREVIOUS "+accessibilityGeometry(previous.getText()==null?String.valueOf(previous.getContentDescription()):previous.getText()));
     System.out.println("ALPHA_ACCESSIBILITY_NEXT "+accessibilityGeometry(label));
    }
   }
   previous=node;previousBounds=r;previousAssistant=assistant;
  }
  if(!problems.isEmpty())System.out.println("ALPHA_ACCESSIBILITY_HOME_GEOMETRY "+js("(()=>{const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,overflowX:s.overflowX,overflowY:s.overflowY,scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight};};const q=s=>document.querySelector(s),css=getComputedStyle(document.documentElement);return JSON.stringify({viewport:{width:innerWidth,height:innerHeight},textScale:css.getPropertyValue('--alpha-text-scale'),dockClearance:css.getPropertyValue('--alpha-dock-clearance'),dockRest:css.getPropertyValue('--alpha-dock-rest'),phoneScale:css.getPropertyValue('--phone-scale'),home:rect(q('[data-alpha-layer=home]')),allApps:rect(q('[data-alpha-home-apps] button[aria-label=\"All apps\"]')),composer:rect(q('[data-alpha-layer=composer]')),pill:rect(q('[data-alpha-layer=pill]')),inputBar:rect(q('[data-alpha-input-bar]'))});})()"));
  if(!problems.isEmpty()){
   System.out.println("ALPHA_ACCESSIBILITY_SETTINGS_GEOMETRY "+js("(()=>{const rect=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,classes:e.className,x:r.x,y:r.y,width:r.width,height:r.height,overflowX:s.overflowX,overflowY:s.overflowY,scrollTop:e.scrollTop,scrollLeft:e.scrollLeft,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,position:s.position};};const nodes=[...document.querySelectorAll('button,[role=button]')].filter(e=>!e.classList.contains('alpha-shade-handle')&&(e.getAttribute('aria-label')==='Notifications'||e.textContent.trim()==='Notifications')).slice(0,2);return JSON.stringify({activeView:document.documentElement.dataset.activeView,notifications:nodes.map(e=>{const ancestors=[];for(let p=e.parentElement;p&&ancestors.length<12;p=p.parentElement)ancestors.push(rect(p));return {control:rect(e),ancestors};})});})()"));
   // This owned-emulator diagnostic survives app uninstall so the host can pull and
   // remove its unique file. It does not change the collected assertion or UI state.
   String screenshot="/sdcard/Download/alpha-accessibility-fixture-"+java.util.UUID.randomUUID()+".png";
   try(InputStream capture=new ParcelFileDescriptor.AutoCloseInputStream(automation().executeShellCommand("screencap -p "+screenshot))){
    capture.readAllBytes();System.out.println("ALPHA_ACCESSIBILITY_SCREENSHOT "+surface+" "+screenshot);
   }catch(Exception error){System.out.println("ALPHA_ACCESSIBILITY_SCREENSHOT_ERROR "+error.getClass().getName());}
  }
  if(!"Notification shade".equals(surface))assertTrue(surface+": assistant controls form one final accessible group",seenAssistant&&assistantGroups(root)==1);
  assertTrue(surface+": TalkBack reaches actionable controls",actionable>0);
  assertTrue(surface+" at 200% font: "+problems,problems.isEmpty());
 }

 /** evaluateJavascript returns a JSON value; this unwraps a JSON string result. */
 private static String unquote(String json)throws Exception{return (String)new org.json.JSONTokener(json).nextValue();}
 /**
  * Pairs of Home text runs whose painted boxes overlap, as a JSON array (empty when none). Each
  * line box is cut by its clipping ancestors and reduced to its middle 70% in height, because line
  * boxes of adjacent lines overlap by design where the line height is below the font's content area.
  */
 private static final String HOME_TEXT_OVERLAP="(()=>{const root=document.querySelector('[data-alpha-layer=\"home\"]'),runs=[];"
  +"const clip=(b,el)=>{const r={l:b.left,r:b.right,t:b.top,b:b.bottom};for(let n=el;n&&n!==document.documentElement;n=n.parentElement){const s=getComputedStyle(n);if(s.overflowX==='visible'&&s.overflowY==='visible')continue;const f=n.getBoundingClientRect();if(s.overflowX!=='visible'){r.l=Math.max(r.l,f.left);r.r=Math.min(r.r,f.right);}if(s.overflowY!=='visible'){r.t=Math.max(r.t,f.top);r.b=Math.min(r.b,f.bottom);}}return r.r-r.l>1&&r.b-r.t>1?r:null;};"
  +"const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);for(let n=w.nextNode();n;n=w.nextNode()){const el=n.parentElement,text=(n.nodeValue||'').trim();if(!text||!el.getClientRects().length||getComputedStyle(el).visibility!=='visible'||el.closest('[aria-hidden=\"true\"]'))continue;"
  +"const range=document.createRange();range.selectNodeContents(n);for(const b of range.getClientRects()){if(b.width<=1||b.height<=1)continue;const trim=b.height*.15,box=clip({left:b.left,right:b.right,top:b.top+trim,bottom:b.bottom-trim},el);if(box)runs.push({el,text:text.slice(0,24),box});}}"
  +"const bad=[];for(let i=0;i<runs.length;i++)for(let j=i+1;j<runs.length;j++){const a=runs[i],b=runs[j];if(a.el===b.el)continue;if(Math.min(a.box.r,b.box.r)-Math.max(a.box.l,b.box.l)>2&&Math.min(a.box.b,b.box.b)-Math.max(a.box.t,b.box.t)>2)bad.push(a.text+' / '+b.text);}"
  +"return JSON.stringify([...new Set(bad)]);})()";
 /** One-word Home app labels drawn on more than one line, as a JSON array (empty when none). */
 private static final String HOME_LABELS_SPLIT="(()=>{const bad=[];for(const button of document.querySelectorAll('[data-alpha-home-apps] > button')){const label=button.lastElementChild,text=(label.textContent||'').trim();if(!text||/\\s/.test(text))continue;"
  +"const range=document.createRange();range.selectNodeContents(label);const tops=new Set([...range.getClientRects()].filter(b=>b.width>1).map(b=>Math.round(b.top)));if(tops.size>1)bad.push(text);}return JSON.stringify(bad);})()";

 @Test public void homeShadeSettingsAndComposerAtDoubleFontScale()throws Exception{
  androidx.test.uiautomator.Configurator configurator=androidx.test.uiautomator.Configurator.getInstance();
  int previousFlags=configurator.getUiAutomationFlags();
  configurator.setUiAutomationFlags(AUTOMATION_FLAGS);
  // AndroidShade shares the same connection: with its default flags each shade check reconnected
  // UiAutomation with accessibility services suppressed, which unbound the stand-in screen reader in
  // the middle of the click loop (emulator campaign of 2026-10-14: "running services: []" after 19 attempts).
  AndroidShade.useAutomationFlags(AUTOMATION_FLAGS);
  String previous=shell("settings get system font_scale");
  UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  try{
   shell("settings put system font_scale 2.0");
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();
    // Throws on any ATF error-level result for the native hierarchy (WebView host, system bars).
    AccessibilityChecks.enable().setRunChecksFromRootView(true);
    open("Home");AppNavigation.declineStartupAccess();onView(isRoot()).check(AccessibilityChecks.accessibilityAssertion());talkBackOrder(device,"Home");
    // Large text reaches the page as WebView text zoom. The page measures it (runtime/text-scale.ts)
    // and its layout rules read the result; a value near 1 here would mean those rules never engage.
    until("Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale'))>0");
    double measured=Double.parseDouble(js("Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale'))"));
    assertTrue("The page measures the 200% text it is drawn at (measured "+measured+")",Math.abs(measured-2.0)<0.2);
    // Round 7 saw the Home card title printed over the lines around it and app labels split
    // mid-word at this size. Measured from the painted line boxes inside the WebView.
    assertEquals("Home text printed over other text at 200% font","[]",unquote(js(HOME_TEXT_OVERLAP)));
    assertEquals("Home app labels split mid-word at 200% font","[]",unquote(js(HOME_LABELS_SPLIT)));

    // Gesture zones and Android's shade (#416, #417; docs/gesture-zones.md). Android's shade is the
    // one notification surface: Alpha draws none, in either flavor.
    until(AndroidShade.ALPHA_SHADE_ABSENT);
    Rect web=device.findObject(By.clazz("android.webkit.WebView")).getVisibleBounds();
    float css=web.width()/Float.parseFloat(js("window.innerWidth"));
    // 1. A swipe from the very top edge belongs to Android in both flavors and opens Android's shade.
    device.swipe(web.centerX(),2,web.centerX(),web.top+web.height()/2,20);
    assertTrue("A top-edge swipe opens Android's own shade",AndroidShade.waitOpen(5000));
    assertEquals("No Alpha panel opens behind Android's shade","true",js(AndroidShade.ALPHA_SHADE_ABSENT));
    AndroidShade.collapse();
    assertTrue("Alpha is in front again after Android's shade closes",device.wait(androidx.test.uiautomator.Until.hasObject(By.pkg(BuildConfig.APPLICATION_ID).depth(0)),5000));
    SystemClock.sleep(500);
    // Home offers no Notifications button in either flavor: Android's own swipe, above, is the way in.
    assertEquals("Home offers no Notifications button","0",js("document.querySelectorAll('[aria-label=\"Open notifications\"]').length"));
    if(BuildConfig.IS_LAUNCHER){
     // 2. On launcher Home a pull down that starts on empty Home asks for the same shade. It starts
     // mid-screen, outside the system's top-edge zone.
     device.swipe(web.centerX(),web.top+web.height()/2,web.centerX(),web.top+web.height()*5/6,20);
     assertTrue("A pull on empty Home opens Android's shade",AndroidShade.waitOpen(5000));
     assertEquals("true",js(AndroidShade.ALPHA_SHADE_ABSENT));
     AndroidShade.collapse();
    }
    open("Settings");onView(isRoot()).check(AccessibilityChecks.accessibilityAssertion());talkBackOrder(device,"Settings");
    open("Home");js(AppNavigation.type());until(AppNavigation.composer());talkBackOrder(device,"Composer");
   }
  }finally{
   shell("settings put system font_scale "+(previous.isEmpty()||"null".equals(previous)?"1.0":previous));
   configurator.setUiAutomationFlags(previousFlags);
   AndroidShade.useAutomationFlags(0);
  }
 }
}
