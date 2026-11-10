package ai.elizaresearch.alphaphone;

import android.app.*;
import android.content.*;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import static org.junit.Assert.*;

/** Bridge, Android Settings and fixture-app steps shared by the cross-app notification tests. */
final class NotificationAccessTestDriver {
 private NotificationAccessTestDriver(){}
 static final String SELECTED="ai.alphacompute.notificationfixture.selected",EXCLUDED="ai.alphacompute.notificationfixture.excluded";
 static Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
 static UiAutomation ui(){return InstrumentationRegistry.getInstrumentation().getUiAutomation();}
 static void waitFor(java.util.concurrent.Callable<Boolean> condition,String label)throws Exception{for(int i=0;i<150;i++){if(condition.call())return;SystemClock.sleep(100);}fail(label);}
 static JSONObject bridge(String method,JSONObject data)throws Exception{
  WebViewTestDriver.evaluate("window.__crossNoticeResult=null;Capacitor.nativePromise('AlphaNotifications',"+JSONObject.quote(method)+","+data+").then(value=>window.__crossNoticeResult={ok:true,value},()=>window.__crossNoticeResult={ok:false})");
  waitFor(()->"true".equals(WebViewTestDriver.evaluate("window.__crossNoticeResult!==null")),"Notification bridge result");
  return new JSONObject(new JSONArray("["+WebViewTestDriver.evaluate("JSON.stringify(window.__crossNoticeResult)")+"]").getString(0));
 }
 static JSONObject value(String method,JSONObject data)throws Exception{JSONObject out=bridge(method,data);assertTrue(method+" accepted",out.getBoolean("ok"));return out.optJSONObject("value")==null?new JSONObject():out.getJSONObject("value");}
 static JSONObject status()throws Exception{return NotificationAccess.status(context());}
 static void policy(JSONObject change)throws Exception{change.put("expectedRevision",status().getString("revision"));value("setNotificationPolicy",change);}
 static JSONArray feed()throws Exception{return value("list",new JSONObject()).getJSONArray("items");}
 static void foreground()throws Exception{
  context().startActivity(new Intent(context(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP));
  waitFor(()->{AccessibilityNodeInfo root=ui().getRootInActiveWindow();return root!=null&&context().getPackageName().contentEquals(root.getPackageName());},"Alpha resumed");
 }
 static void witness(String pkg,String nonce,String operation)throws Exception{
  context().startActivity(new Intent().setClassName(pkg,"ai.alphacompute.notificationfixture.FixtureActivity").putExtra("nonce",nonce).putExtra("operation",operation).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP));
  waitFor(()->{AccessibilityNodeInfo root=ui().getRootInActiveWindow();return root!=null&&pkg.contentEquals(root.getPackageName())&&!root.findAccessibilityNodeInfosByText((operation.equals("cleanup")?"Cleaned ":"Posted ")+nonce).isEmpty();},"Exact synthetic companion operation");
  foreground();
 }
 static void access(boolean grant)throws Exception{
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
 static JSONObject external(JSONArray rows,String suffix)throws Exception{for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if("external".equals(row.optString("source"))&&row.optString("title").endsWith(suffix))return row;}throw new AssertionError("Exact synthetic external row missing");}
 static long foreignCount(JSONArray rows)throws Exception{long count=0;for(int i=0;i<rows.length();i++)if("external".equals(rows.getJSONObject(i).optString("source")))count++;return count;}
}
