package ai.elizaresearch.alphaphone;

import android.app.*;
import android.content.*;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;

/** Real, separately signed/UID synthetic apps only. Never selects a user's app. */
public final class CrossAppNotificationsRestartInstrumentedTest {
 private static final String SELECTED="ai.elizaresearch.notificationfixture.selected",EXCLUDED="ai.elizaresearch.notificationfixture.excluded";
 private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
 private UiAutomation ui(){return InstrumentationRegistry.getInstrumentation().getUiAutomation();}
 private void waitFor(java.util.concurrent.Callable<Boolean> condition,String label)throws Exception{for(int i=0;i<150;i++){if(condition.call())return;SystemClock.sleep(100);}fail(label);}
 private JSONObject bridge(String method,JSONObject data)throws Exception{
  WebViewTestDriver.evaluate("window.__crossNoticeResult=null;Capacitor.nativePromise('AlphaNotifications',"+JSONObject.quote(method)+","+data+").then(value=>window.__crossNoticeResult={ok:true,value},()=>window.__crossNoticeResult={ok:false})");
  waitFor(()->"true".equals(WebViewTestDriver.evaluate("window.__crossNoticeResult!==null")),"Notification bridge result");
  return new JSONObject(new JSONArray("["+WebViewTestDriver.evaluate("JSON.stringify(window.__crossNoticeResult)")+"]").getString(0));
 }
 private JSONObject value(String method,JSONObject data)throws Exception{JSONObject out=bridge(method,data);assertTrue(method+" accepted",out.getBoolean("ok"));return out.optJSONObject("value")==null?new JSONObject():out.getJSONObject("value");}
 private JSONObject status()throws Exception{return NotificationAccess.status(context());}
 private void policy(JSONObject change)throws Exception{change.put("expectedRevision",status().getString("revision"));value("setNotificationPolicy",change);}
 private JSONArray feed()throws Exception{return value("list",new JSONObject()).getJSONArray("items");}
 private void foreground()throws Exception{
  context().startActivity(new Intent(context(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP));
  waitFor(()->{AccessibilityNodeInfo root=ui().getRootInActiveWindow();return root!=null&&context().getPackageName().contentEquals(root.getPackageName());},"Alpha resumed");
 }
 private void witness(String pkg,String nonce,String operation)throws Exception{
  context().startActivity(new Intent().setClassName(pkg,"ai.elizaresearch.notificationfixture.FixtureActivity").putExtra("nonce",nonce).putExtra("operation",operation).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP));
  waitFor(()->{AccessibilityNodeInfo root=ui().getRootInActiveWindow();return root!=null&&pkg.contentEquals(root.getPackageName())&&!root.findAccessibilityNodeInfosByText((operation.equals("cleanup")?"Cleaned ":"Posted ")+nonce).isEmpty();},"Exact synthetic companion operation");
  foreground();
 }
 private void access(boolean grant)throws Exception{
  value("openNotificationAccess",new JSONObject());
  waitFor(()->{AccessibilityNodeInfo root=ui().getRootInActiveWindow();return root!=null&&"com.android.settings".contentEquals(root.getPackageName());},"Android notification access detail");
  boolean clicked=false;
  for(int attempt=0;attempt<100&&!clicked;attempt++){
   AccessibilityNodeInfo root=ui().getRootInActiveWindow();if(root!=null&&"com.android.settings".contentEquals(root.getPackageName())){
    java.util.ArrayDeque<AccessibilityNodeInfo> queue=new java.util.ArrayDeque<>();java.util.List<AccessibilityNodeInfo> switches=new java.util.ArrayList<>();queue.add(root);
    while(!queue.isEmpty()){AccessibilityNodeInfo node=queue.remove();if(node.isCheckable()&&node.isEnabled()&&String.valueOf(node.getClassName()).contains("Switch"))switches.add(node);for(int j=0;j<node.getChildCount();j++){AccessibilityNodeInfo child=node.getChild(j);if(child!=null)queue.add(child);}}
    // This explicit component detail must have one access switch. Refuse a list of other apps.
    if(switches.size()==1){AccessibilityNodeInfo node=switches.get(0);if(node.isChecked()==grant){clicked=true;break;}for(int depth=0;depth<3&&node!=null;depth++,node=node.getParent())if(node.isEnabled()&&node.isClickable()&&!node.equals(root)&&node.getChildCount()<8){clicked=node.performAction(AccessibilityNodeInfo.ACTION_CLICK);if(clicked)break;}}
   }if(!clicked)SystemClock.sleep(100);
  }
  assertTrue("Exact listener access switch",clicked);
  for(int attempt=0;attempt<100&&NotificationAccess.granted(context())!=grant;attempt++){
   AccessibilityNodeInfo root=ui().getRootInActiveWindow();if(root!=null&&"com.android.settings".contentEquals(root.getPackageName()))for(String label:grant?new String[]{"Allow"}:new String[]{"Turn off","Disallow"})for(AccessibilityNodeInfo node:root.findAccessibilityNodeInfosByText(label))if(label.contentEquals(node.getText())&&node.isClickable())node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
   SystemClock.sleep(100);
  }
  assertEquals("Actual Android listener grant readback",grant,NotificationAccess.granted(context()));foreground();
 }
 private JSONObject external(JSONArray rows,String suffix)throws Exception{for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if("external".equals(row.optString("source"))&&row.optString("title").endsWith(suffix))return row;}throw new AssertionError("Exact synthetic external row missing");}
 private long foreignCount(JSONArray rows)throws Exception{long count=0;for(int i=0;i<rows.length();i++)if("external".equals(rows.getJSONObject(i).optString("source")))count++;return count;}
 private java.io.File checkpointFile(){return new java.io.File(context().getNoBackupFilesDir(),"notification-restart-checkpoint.json");}
 private void save(JSONObject state)throws Exception{
  android.util.AtomicFile file=new android.util.AtomicFile(checkpointFile());java.io.FileOutputStream out=null;
  try{out=file.startWrite();out.write(state.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));out.getFD().sync();file.finishWrite(out);}catch(Exception failure){if(out!=null)file.failWrite(out);throw failure;}
 }
 private JSONObject load(String runId)throws Exception{
  JSONObject state=new JSONObject(new String(new android.util.AtomicFile(checkpointFile()).readFully(),java.nio.charset.StandardCharsets.UTF_8));
  assertEquals("Exact checkpoint owner",runId,state.getString("runId"));assertEquals(1,state.getInt("format"));return state;
 }
 private void stage(JSONObject state,String stage)throws Exception{state.put("stage",stage).put("previousPid",android.os.Process.myPid());save(state);}
 private java.util.Set<String> ids(JSONArray rows)throws Exception{java.util.Set<String> ids=new java.util.TreeSet<>();for(int i=0;i<rows.length();i++)assertTrue("Unique metadata IDs",ids.add(rows.getJSONObject(i).getString("id")));return ids;}
 private java.util.Set<String> stringSet(JSONArray values)throws Exception{java.util.Set<String> result=new java.util.TreeSet<>();for(int i=0;i<values.length();i++)result.add(values.getString(i));return result;}
 private String jsString(String expression)throws Exception{return new JSONArray("["+WebViewTestDriver.evaluate(expression)+"]").getString(0);}
 private void live()throws Exception{AppNavigation.liveMode();foreground();WebViewTestDriver.evaluate(AppNavigation.request("Home"));waitFor(()->"true".equals(WebViewTestDriver.evaluate("window.__alphaTestNavigation?.status==='complete'")),"Actual live Home mounted");}
 private void settings()throws Exception{WebViewTestDriver.evaluate(AppNavigation.request("Settings"));waitFor(()->"true".equals(WebViewTestDriver.evaluate("window.__alphaTestNavigation?.status==='complete'")),"Settings mounted");}
 private void click(String label)throws Exception{String expression="[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&!b.disabled&&b.textContent.trim()==="+JSONObject.quote(label)+")";waitFor(()->"true".equals(WebViewTestDriver.evaluate("Boolean("+expression+")")),"Expected product control: "+label);WebViewTestDriver.evaluate("("+expression+").click()");}
 private void confirmResume()throws Exception{
  waitFor(()->{AccessibilityNodeInfo root=ui().getRootInActiveWindow();if(root==null||!context().getPackageName().contentEquals(root.getPackageName())||root.findAccessibilityNodeInfosByText("Resume collection of notifications from your selected apps?").isEmpty())return false;for(AccessibilityNodeInfo button:root.findAccessibilityNodeInfosByViewId("android:id/button1"))if(button.isClickable()&&"OK".contentEquals(button.getText()))return button.performAction(AccessibilityNodeInfo.ACTION_CLICK);return false;},"Exact native Resume confirmation");
 }
 private void fixtureIdentity()throws Exception{
  for(String pkg:new String[]{SELECTED,EXCLUDED}){assertNotEquals(context().getApplicationInfo().uid,context().getPackageManager().getApplicationInfo(pkg,0).uid);assertNotEquals(NotificationAccess.signature(context(),context().getPackageName()),NotificationAccess.signature(context(),pkg));}
 }
 private void verifyNoRetainedForeignData()throws Exception{
  assertEquals(0,foreignCount(feed()));assertEquals(0,value("notificationHistory",new JSONObject()).getJSONArray("items").length());
  assertFalse("Retained history absent",new java.io.File(context().getNoBackupFilesDir(),"notification-history.enc").exists());
 }
 @Test public void processPhase()throws Exception{
  org.junit.Assume.assumeTrue("Mock mode exists only in -PELIZA_DEV_ALLOW_TEST_MOCKS=1 builds",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  org.junit.Assume.assumeTrue("Explicit distinct-process runner only","1".equals(InstrumentationRegistry.getArguments().getString("crossNotificationsRestart")));
  String phase=InstrumentationRegistry.getArguments().getString("notificationPhase"),runId=InstrumentationRegistry.getArguments().getString("notificationRunId");
  assertEquals(java.util.UUID.fromString(runId).toString(),runId);assertTrue(java.util.Set.of("prepare","restore","pause","restorePaused","resumeAndRevoke","verifyRevoked","cleanup").contains(phase));
  android.os.Bundle diagnostic=new android.os.Bundle();diagnostic.putString("notificationRestartPid",Integer.toString(android.os.Process.myPid()));diagnostic.putString("notificationRestartPhase",phase);InstrumentationRegistry.getInstrumentation().sendStatus(2,diagnostic);
  assertTrue(BuildConfig.DEBUG);fixtureIdentity();
  if("cleanup".equals(phase)&&!checkpointFile().exists())return;
  JSONObject state;
  if("prepare".equals(phase)){
   assertFalse("Refuse unfinished checkpoint",checkpointFile().exists());assertFalse(NotificationAccess.granted(context()));JSONObject before=status();assertFalse(before.getBoolean("enabled"));assertFalse(before.getBoolean("history"));assertEquals(0,before.getJSONArray("apps").length());
   state=new JSONObject().put("format",1).put("runId",runId).put("nonce",java.util.UUID.randomUUID().toString()).put("other",java.util.UUID.randomUUID().toString()).put("previousPrefs",new JSONObject(NotificationAccess.prefs(context()).getAll())).put("stage","starting").put("previousPid",android.os.Process.myPid());save(state);
  }else{state=load(runId);assertNotEquals("Distinct actual process PID",state.getInt("previousPid"),android.os.Process.myPid());}
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   if("prepare".equals(phase)){
    waitFor(()->"true".equals(WebViewTestDriver.evaluate("Boolean(document.querySelector('.os'))")),"Initial shell mounted");
    state.put("previousSelection",jsString("localStorage.getItem('alpha.connection.selection.v1')||''"));save(state);live();
    ui().grantRuntimePermission(SELECTED,android.Manifest.permission.POST_NOTIFICATIONS);ui().grantRuntimePermission(EXCLUDED,android.Manifest.permission.POST_NOTIFICATIONS);
    access(true);policy(new JSONObject().put("enabled",true).put("history",true).put("apps",new JSONArray().put(new JSONObject().put("packageName",SELECTED).put("preview",true))));value("resumeCrossApp",new JSONObject().put("expectedRevision",status().getString("revision")));waitFor(()->status().getBoolean("connected"),"Listener connected");
    witness(SELECTED,state.getString("nonce"),"post");witness(EXCLUDED,state.getString("other"),"post");waitFor(()->foreignCount(feed())==5,"Actual selected notices");waitFor(()->value("notificationHistory",new JSONObject()).getJSONArray("items").length()==5,"Exact five initial metadata events");
    JSONArray history=value("notificationHistory",new JSONObject()).getJSONArray("items");JSONObject first=external(feed()," 1");assertFalse(history.toString().contains(state.getString("nonce")));assertFalse(history.toString().contains(state.getString("other")));assertFalse(history.toString().contains("Canary"));
    byte[] sealed=java.nio.file.Files.readAllBytes(new java.io.File(context().getNoBackupFilesDir(),"notification-history.enc").toPath());assertFalse(new String(sealed,java.nio.charset.StandardCharsets.ISO_8859_1).contains(state.getString("nonce")));
    state.put("eventIds",new JSONArray(ids(history))).put("policy",NotificationAccess.prefs(context()).getString("policy",null)).put("capability",new JSONObject().put("id",first.getString("id")).put("revision",first.getString("revision")).put("source","external"));stage(state,"prepared");return;
   }
   if("cleanup".equals(phase)){
    live();if(NotificationAccess.granted(context()))access(false);
    NotificationAccess.update(context(),new com.getcapacitor.JSObject(new JSONObject().put("expectedRevision",status().getString("revision")).put("enabled",false).put("history",false).put("apps",new JSONArray()).toString()));
    witness(SELECTED,state.getString("nonce"),"cleanup");witness(EXCLUDED,state.getString("other"),"cleanup");
    android.content.SharedPreferences.Editor editor=NotificationAccess.prefs(context()).edit().clear();JSONObject previous=state.getJSONObject("previousPrefs");for(java.util.Iterator<String> keys=previous.keys();keys.hasNext();){String key=keys.next();Object value=previous.get(key);if(value instanceof Boolean)editor.putBoolean(key,(Boolean)value);else if(value instanceof String)editor.putString(key,(String)value);else throw new AssertionError("Unexpected prior policy type");}assertTrue(editor.commit());assertEquals(previous.length(),NotificationAccess.prefs(context()).getAll().size());for(java.util.Iterator<String> keys=previous.keys();keys.hasNext();){String key=keys.next();assertEquals(previous.get(key),NotificationAccess.prefs(context()).getAll().get(key));}
    String previousSelection=state.optString("previousSelection","");WebViewTestDriver.evaluateSensitive(previousSelection.isEmpty()?"localStorage.removeItem('alpha.connection.selection.v1')":"localStorage.setItem('alpha.connection.selection.v1',"+JSONObject.quote(previousSelection)+")");
    assertEquals(previousSelection,jsString("localStorage.getItem('alpha.connection.selection.v1')||''"));
    assertFalse(NotificationAccess.granted(context()));assertFalse(new java.io.File(context().getNoBackupFilesDir(),"notification-history.enc").exists());assertTrue(checkpointFile().delete());return;
   }
   if("restorePaused".equals(phase)){
    assertEquals("paused",state.getString("stage"));waitFor(()->"true".equals(WebViewTestDriver.evaluate("document.documentElement.dataset.connectionMode==='mock'&&Boolean(document.querySelector('.mock-mode-banner'))")),"Cold start restored actual mock renderer");
    assertTrue(status().getBoolean("paused"));assertTrue(NotificationAccess.granted(context()));assertEquals(state.getString("policy"),NotificationAccess.prefs(context()).getString("policy",null));verifyNoRetainedForeignData();
    witness(SELECTED,state.getString("nonce"),"replace");assertTrue(status().getBoolean("paused"));verifyNoRetainedForeignData();stage(state,"pausedRestored");return;
   }
   if("verifyRevoked".equals(phase)){
    assertEquals("revoked",state.getString("stage"));live();assertFalse(NotificationAccess.granted(context()));verifyNoRetainedForeignData();assertFalse(bridge("open",state.getJSONObject("capability")).getBoolean("ok"));stage(state,"revokedRestored");return;
   }
   live();
   if("restore".equals(phase)){
    assertEquals("prepared",state.getString("stage"));assertTrue(NotificationAccess.granted(context()));assertEquals(state.getString("policy"),NotificationAccess.prefs(context()).getString("policy",null));waitFor(()->status().getBoolean("connected"),"Retained grant reconnected listener");
    assertEquals("Exact persisted metadata IDs",stringSet(state.getJSONArray("eventIds")),ids(value("notificationHistory",new JSONObject()).getJSONArray("items")));assertFalse("Previous-process action capability rejected",bridge("open",state.getJSONObject("capability")).getBoolean("ok"));
    assertEquals(5,foreignCount(feed()));assertNotEquals(state.getJSONObject("capability").getString("id"),external(feed()," 1").getString("id"));stage(state,"restored");return;
   }
   if("pause".equals(phase)){
    assertEquals("restored",state.getString("stage"));settings();click("Try mock mode");waitFor(()->"true".equals(WebViewTestDriver.evaluate("document.documentElement.dataset.connectionMode==='mock'&&Boolean(document.querySelector('.mock-mode-banner'))")),"Actual mock entry completed");assertTrue(status().getBoolean("paused"));verifyNoRetainedForeignData();stage(state,"paused");return;
   }
   assertEquals("resumeAndRevoke",phase);assertEquals("pausedRestored",state.getString("stage"));assertTrue("Leaving mock did not resume collection",status().getBoolean("paused"));verifyNoRetainedForeignData();settings();
   String notificationRow="[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.trim().startsWith('Notifications'))";waitFor(()->"true".equals(WebViewTestDriver.evaluate("Boolean("+notificationRow+")")),"Notification settings row");WebViewTestDriver.evaluate("("+notificationRow+").click()");click("Resume selected-app collection");confirmResume();waitFor(()->!status().getBoolean("paused")&&status().getBoolean("connected"),"Explicit resume only");
   witness(SELECTED,state.getString("nonce"),"replace");waitFor(()->value("notificationHistory",new JSONObject()).getJSONArray("items").length()>0,"New actual event after explicit resume");access(false);verifyNoRetainedForeignData();stage(state,"revoked");
  }
 }
}
