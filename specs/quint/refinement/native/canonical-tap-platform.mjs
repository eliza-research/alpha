import assert from 'node:assert/strict';

function between(source, first, last) {
  const a = source.indexOf(first), b = source.indexOf(last, a+first.length);
  assert.ok(a >= 0 && b > a, 'canonical notification source anchors');
  return source.slice(a, b);
}
const member = (source, regex) => {
  const found = source.match(regex)?.[0];
  assert.ok(found, 'canonical notification member');
  return found;
};

export function canonicalTapPlatform(actor, bridge, host, route) {
  const field = name => member(actor, new RegExp('^ private (?:static )?(?:volatile )?[^\\n=;]+ '+name+'(?:=[^;]+)?;', 'm'));
  return {
    'ai/elizaresearch/alphaphone/AlphaCanonicalNotifications.java': `package ai.elizaresearch.alphaphone;
import android.content.Context;
import android.content.Intent;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.*;
final class AlphaCanonicalNotifications {
 private static final java.util.concurrent.Executor SERIAL=TapPorts.serial::add;
 ${['active','waitingTap','pendingTap','restoring','context','stopped','stream','session,identity','owner,fence'].map(field).join('\n')}
 ${member(actor, /^ private static final AtomicInteger restoration=[^;]+;/m)}
 ${member(actor, /^ private AlphaCanonicalNotifications\(Context context\)[^\n]+/m)}
 static void ensure(Context context){} // Owner acquisition is the controlled fixture port.
 ${between(actor, ' static void stop()', ' private void connect()')}
 ${actor.slice(actor.indexOf(' static void captureTap('), actor.lastIndexOf('}'))}
}
`,
    'ai/elizaresearch/alphaphone/AlphaNotificationsPlugin.java': `package ai.elizaresearch.alphaphone;
import com.getcapacitor.*;
import ai.eliza.plugins.notifications.ForegroundNoticeGate;
import android.content.Context;
class TapBridgeHost {
 final ForegroundNoticeGate noticeGate=new ForegroundNoticeGate(new ForegroundNoticeGate.MainThread(){
  public boolean isCurrent(){return false;}
  public boolean post(Runnable check){check.run();return true;}
  public void remove(Runnable check){}
 },TapPorts::requireForeground,TapPorts.worker::add);
 ${member(host, /^ protected interface NoticeWork [^\n]+/m)}
 ${member(host, /^ protected final void noticeWork\([^\n]+/m)}
 ${member(host, /^ protected final void requireNoticeForeground\([^\n]+/m)}
 Context getContext(){return TapPorts.context;}
 public void load(){}
 protected void handleOnDestroy(){noticeGate.destroy();}
 void notifyListeners(String name,JSObject body,boolean retained){
  if(!name.equals("canonicalNotificationTap")||body.data.length()!=0||!retained)throw new AssertionError("Expected empty retained wakeup");
  TapPorts.events++;
 }
}
final class AlphaNotificationsPlugin extends TapBridgeHost {
 ${between(bridge, ' private static java.lang.ref.WeakReference<AlphaNotificationsPlugin>', ' @Override protected String appLabel()')
   .replaceAll('@PluginMethod ', '')}
}
`,
    'ai/elizaresearch/alphaphone/NativeNotificationRoute.java': route.replace(member(route, /^package ai\.elizaos\.app;$/m), 'package ai.elizaresearch.alphaphone;'),
    'android/content/Context.java': `package android.content;
public class Context {public Context getApplicationContext(){return this;}}
`,
    'android/content/Intent.java': `package android.content;
import java.util.HashMap;
public class Intent {
 public static final String ACTION_MAIN="android.intent.action.MAIN";
 private final HashMap<String,String> extras;
 private String action,data;
 public Intent(String action,String data){this.action=action;this.data=data;extras=new HashMap<>();}
 public Intent(Intent source){action=source.action;data=source.data;extras=new HashMap<>(source.extras);}
 public Intent putExtra(String key,String value){extras.put(key,value);return this;}
 public boolean hasExtra(String key){return extras.containsKey(key);}
 public String getStringExtra(String key){return extras.get(key);}
 public Intent setData(String value){data=value;return this;}
 public Intent setAction(String value){action=value;return this;}
 public void removeExtra(String key){extras.remove(key);}
 public String getAction(){return action;}
 public String getData(){return data;}
}
`,
    'com/getcapacitor/JSObject.java': `package com.getcapacitor;
import org.json.JSONObject;
public final class JSObject {
 public final JSONObject data;
 public JSObject(){this(new JSONObject());}
 private JSObject(JSONObject data){this.data=data;}
 public static JSObject fromJSONObject(JSONObject value){return new JSObject(value);}
 public JSObject put(String key,boolean value){data.put(key,value);return this;}
}
`,
    'com/getcapacitor/PluginCall.java': `package com.getcapacitor;
public final class PluginCall {
 private final String token;
 public boolean rejected;
 public JSObject result;
 public PluginCall(String token){this.token=token;}
 public String getString(String name,String fallback){return token==null?fallback:token;}
 public void reject(String failure){if(rejected||result!=null)throw new AssertionError("Double answer");rejected=true;}
 public void resolve(JSObject value){if(rejected||result!=null)throw new AssertionError("Double answer");result=value;}
}
`,
  };
}
