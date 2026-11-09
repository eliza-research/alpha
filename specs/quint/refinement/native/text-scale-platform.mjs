import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {app, root} from './java.mjs';
import {mainActivityPlatform} from './main-activity-platform.mjs';

export const deviceSource=app+'AlphaDevicePlugin.java';
export const bridgeCallSource='node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/PluginCall.java';

function between(text, first, last) {
  const start=text.indexOf(first), end=text.indexOf(last,start+first.length);
  assert.ok(start>=0&&end>start,`source anchors ${first}, ${last}`);
  return text.slice(start,end);
}

export function textScalePlatform() {
  const fixture=mainActivityPlatform();
  try {
    const sources=fixture.sources;
    function put(path, text) {
      if(!Object.hasOwn(sources,path))fixture.paths.push(join(fixture.directory,path));
      sources[path]=text;
      const target=join(fixture.directory,path);
      mkdirSync(dirname(target),{recursive:true});
      writeFileSync(target,text);
    }
    function extend(path, from, to) {
      assert.equal(sources[path].split(from).length,2,`unique fixture anchor ${from}`);
      put(path,sources[path].replace(from,()=>to));
    }

    const device=readFileSync(join(root,deviceSource),'utf8');
    put('ai/elizaresearch/alphaphone/AlphaDevicePlugin.java',`package ai.elizaresearch.alphaphone;
import android.content.Context;
import android.os.Build;
import com.getcapacitor.*;
public final class AlphaDevicePlugin extends Plugin {
${between(device,' static int textScalePercent(', ' @PluginMethod public void snapshot(')}
}`);

    const calls=readFileSync(join(root,bridgeCallSource),'utf8');
    put('com/getcapacitor/PluginCall.java',`package com.getcapacitor;
public final class PluginCall {
 private final JSObject data;
 public boolean answered;
 public String error;
 public JSObject result;
 public PluginCall(JSObject data){this.data=data;}
 ${between(calls,'    public Integer getInt(String name)', '    @Nullable\n    public Long getLong')
    .replaceAll('    @Nullable\n','').replace('@Nullable Integer defaultValue','Integer defaultValue')}
 public void resolve(JSObject value){answer();result=value;}
 public void reject(String reason){answer();error=reason;}
 private void answer(){if(answered)throw new AssertionError("Duplicate plugin answer");answered=true;}
}`);
    put('com/getcapacitor/PluginMethod.java','package com.getcapacitor; public @interface PluginMethod {}');
    put('com/getcapacitor/JSObject.java','package com.getcapacitor; public final class JSObject extends org.json.JSONObject {}');
    put('com/getcapacitor/Plugin.java',`package com.getcapacitor;
public class Plugin {
 private BridgeActivity activity;
 public void attach(BridgeActivity owner){activity=owner;}
 public BridgeActivity getActivity(){return activity;}
 public android.content.Context getContext(){return activity;}
 public Bridge getBridge(){return activity.getBridge();}
}`);
    put('android/content/SharedPreferences.java',`package android.content;
public final class SharedPreferences {
 public int visible, durable, commits;
 public String mode="saved";
 public int getInt(String key,int fallback){verify(key);return visible==0?fallback:visible;}
 private static void verify(String key){if(!key.equals("text-scale-percent"))throw new AssertionError("Installed text-scale key");}
 public Editor edit(){return new Editor();}
 public final class Editor {
  private int value;
  public Editor putInt(String key,int number){verify(key);value=number;return this;}
  public boolean commit(){
   commits++;
   if(mode.equals("before"))return false;
   visible=value;
   if(mode.equals("visible"))return false;
   durable=value;
   return true;
  }
 }
}`);
    put('android/content/Context.java',`package android.content;
public class Context {
 public static final int MODE_PRIVATE=0;
 public static final SharedPreferences appearance=new SharedPreferences();
 public static android.view.accessibility.AccessibilityManager accessibility;
 private final android.content.res.Resources resources=new android.content.res.Resources();
 public android.content.res.Resources getResources(){return resources;}
 public SharedPreferences getSharedPreferences(String name,int mode){
  if(mode!=MODE_PRIVATE||!name.equals("alpha-appearance"))throw new AssertionError("Installed text-scale preference slot");
  return appearance;
 }
 public <T> T getSystemService(Class<T> type){
  return type==android.view.accessibility.AccessibilityManager.class?type.cast(accessibility):null;
 }
}`);
    put('android/view/accessibility/AccessibilityManager.java',`package android.view.accessibility;
public final class AccessibilityManager {
 public static final int FLAG_CONTENT_TEXT=2,FLAG_CONTENT_CONTROLS=4;
 public int recommendation,queries;
 public int getRecommendedTimeoutMillis(int base,int flags){
  if(flags!=(FLAG_CONTENT_TEXT|FLAG_CONTENT_CONTROLS)||base<1||base>600000)throw new AssertionError("Exact timeout input and content mask");
  queries++;
  return recommendation;
 }
}`);
    extend('android/os/Build.java','  public static class VERSION {','  public static class VERSION_CODES {public static final int Q=29;}\n  public static class VERSION {');
    extend('android/content/res/Configuration.java','public class Configuration {}','public class Configuration {public float fontScale=1f;}');
    extend('android/content/res/Resources.java','public class Resources {',`public class Resources {
  public Configuration configuration=new Configuration();
  public Configuration getConfiguration(){return configuration;}`);
    extend('android/webkit/WebSettings.java','  public void setMixedContentMode(int value) {}',`  public int zoom=100,zoomWrites;
  public int getTextZoom(){return zoom;}
  public void setTextZoom(int value){zoom=value;zoomWrites++;}
  public void setMixedContentMode(int value) {}`);
    const activity='com/getcapacitor/BridgeActivity.java';
    extend(activity,'public class BridgeActivity {',`public class BridgeActivity extends android.content.Context {
  public record UiTask(BridgeActivity owner,Runnable run){}
  public static final java.util.Deque<UiTask> uiTasks=new java.util.ArrayDeque<>();
  public void runOnUiThread(Runnable task){uiTasks.add(new UiTask(this,task));}`);
    extend(activity,'  public void onConfigurationChanged(android.content.res.Configuration value) {}',
      '  public void onConfigurationChanged(android.content.res.Configuration value){getResources().configuration=value;}');
    extend(activity,`  public android.content.res.Resources getResources() {
    return new android.content.res.Resources();
  }
`,'');
    extend(activity,'    return kind.cast(new android.app.ActivityManager());',
      '    return kind==android.app.ActivityManager.class?kind.cast(new android.app.ActivityManager()):super.getSystemService(kind);');
    return fixture;
  } catch(error) {
    fixture.close();
    throw error;
  }
}
