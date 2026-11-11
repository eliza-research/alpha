import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {app, root} from './java.mjs';

/** Android/Capacitor primitives. MainActivity owns all product recovery and hand-off decisions. */
export function mainActivityPlatform() {
  const directory = mkdtempSync(join(tmpdir(), 'quint-main-activity-'));
  const sources = {
    'androidx/lifecycle/Lifecycle.java': `package androidx.lifecycle;
public class Lifecycle {public enum State {STARTED;public boolean isAtLeast(State value){return true;}}public State getCurrentState(){return State.STARTED;}}`,
    'android/app/role/RoleManager.java': `package android.app.role;
public class RoleManager {public static final String ROLE_HOME="home";public boolean isRoleAvailable(String role){return false;}public boolean isRoleHeld(String role){return false;}}`,
    'android/content/pm/ResolveInfo.java': `package android.content.pm;
public class ResolveInfo {public ActivityInfo activityInfo;public static class ActivityInfo {public String packageName;}}`,
    'android/os/Bundle.java': `package android.os;
public class Bundle {}`,
    'android/os/SystemClock.java': `package android.os;
public class SystemClock {
  public static long elapsedRealtime() {
    return ai.elizaresearch.alphaphone.MainActivityPorts.time;
  }
}`,
    'android/os/Build.java': `package android.os;
public class Build {
  public static class VERSION {
    public static int SDK_INT = 36;
  }
}`,
    'android/content/ComponentName.java': `package android.content;
public final class ComponentName {
  private final String pkg, name;
  public ComponentName(){this("", "");}
  public ComponentName(String pkg,String name){this.pkg=pkg;this.name=name;}
  public ComponentName(com.getcapacitor.BridgeActivity context,Class<?> type){this(context.getPackageName(),type.getName());}
  public String getPackageName(){return pkg;}
  public String getClassName(){return name;}
  public static ComponentName unflattenFromString(String value){
    int split=value.indexOf('/');
    if(split<0||split+1>=value.length())return null;
    String pkg=value.substring(0,split),name=value.substring(split+1);
    return new ComponentName(pkg,name.startsWith(".")?pkg+name:name);
  }
  @Override public boolean equals(Object other){return other instanceof ComponentName value&&pkg.equals(value.pkg)&&name.equals(value.name);}
  @Override public int hashCode(){return java.util.Objects.hash(pkg,name);}
}`,
    'android/content/ContentResolver.java': `package android.content;
public final class ContentResolver {}`,
    'android/provider/Settings.java': `package android.provider;
public final class Settings {
  public static final class Secure {
    public static final String DEFAULT_INPUT_METHOD="default_input_method";
    // These recovery campaigns do not select the auxiliary keyboard or claim IME acceptance.
    public static String getString(android.content.ContentResolver resolver,String key){
      if(!DEFAULT_INPUT_METHOD.equals(key))throw new AssertionError(key);
      return null;
    }
  }
}`,
    'android/content/Intent.java': `package android.content;
public class Intent {
  public static final String ACTION_MAIN = "android.intent.action.MAIN",
                             CATEGORY_HOME = "android.intent.category.HOME";
  public static final int FLAG_ACTIVITY_NEW_TASK = 1, FLAG_ACTIVITY_NO_ANIMATION = 2;
  private String action, type, packageName;
  private Object data;
  private final java.util.Set<String> categories = new java.util.LinkedHashSet<>();
  private final java.util.Map<String, Object> extras = new java.util.HashMap<>();
  public boolean brokenExtras;
  public Intent() {}
  public Intent(String action) {
    this.action = action;
  }
  public Intent(Object context, Class<?> target) {
    action = "explicit:" + target.getName();
  }
  public Intent(Intent other) {
    action = other.action;
    type = other.type;
    data = other.data;
    packageName = other.packageName;
    categories.addAll(other.categories);
    extras.putAll(other.extras);
    brokenExtras = other.brokenExtras;
  }
  public String getAction() {
    return action;
  }
  public String getType() {
    return type;
  }
  public Object getData() {
    return data;
  }
  public Intent setData(Object value) {
    data = value;
    return this;
  }
  public Intent setType(String value) {
    type = value;
    return this;
  }
  public Intent addCategory(String value) {
    categories.add(value);
    return this;
  }
  public boolean hasCategory(String value) {
    return categories.contains(value);
  }
  public java.util.Set<String> getCategories() {
    return categories.isEmpty() ? null : categories;
  }
  public Intent setPackage(String value) {
    packageName = value;
    return this;
  }
  public String getPackage() {
    return packageName;
  }
  public Intent putExtra(String key, boolean value) {
    extras.put(key, value);
    return this;
  }
  public Intent putExtra(String key,String value){extras.put(key,value);return this;}
  public String getStringExtra(String key){if(brokenExtras)throw new IllegalStateException("Unreadable parcel");return (String)extras.get(key);}
  public boolean getBooleanExtra(String key, boolean fallback) {
    if (brokenExtras)
      throw new IllegalStateException("Unreadable parcel");
    Object value=extras.get(key);return value==null?fallback:(Boolean)value;
  }
  public Intent addFlags(int flags) {
    return this;
  }
  public ComponentName resolveActivity(android.content.pm.PackageManager manager) {
    return manager.resolves(action) ? new ComponentName() : null;
  }
}`,
    'android/content/pm/PackageManager.java': `package android.content.pm;
public class PackageManager {
  public static final int MATCH_DEFAULT_ONLY=1;
  public ResolveInfo resolveActivity(android.content.Intent intent,int flags){return null;}
  public boolean resolves(String action) {
    return ai.elizaresearch.alphaphone.MainActivityPorts.settings.contains(action);
  }
}`,
    'android/content/res/Configuration.java': `package android.content.res;
public class Configuration {}`,
    'android/content/res/Resources.java': `package android.content.res;
public class Resources {
  public android.util.DisplayMetrics getDisplayMetrics() {
    return new android.util.DisplayMetrics();
  }
}`,
    'android/util/DisplayMetrics.java': `package android.util;
public class DisplayMetrics {
  public float density = 1;
}`,
    'android/util/TypedValue.java': `package android.util;
public class TypedValue {
  public static final int COMPLEX_UNIT_SP = 2;
}`,
    'android/util/Log.java': `package android.util;
public class Log {
  public static int w(String tag, String text) {
    return 0;
  }
  public static int e(String tag, String text) {
    return 0;
  }
  public static int i(String tag, String text) {
    return 0;
  }
  public static int d(String tag, String text) {
    return 0;
  }
}`,
    'android/graphics/Color.java': `package android.graphics;
public class Color {
  public static final int BLACK = 0, WHITE = 1, TRANSPARENT = 2;
}`,
    'android/view/Gravity.java': `package android.view;
public class Gravity {
  public static final int CENTER = 1;
}`,
    'android/view/View.java': `package android.view;
public class View {
  public interface OnClickListener {
    void onClick(View view);
  }
  public ViewGroup parent;
  public int left, top, right, bottom;
  public OnClickListener click;
  public View() {}
  public View(Object context) {}
  public Object getParent() {
    return parent;
  }
  public void setPadding(int l, int t, int r, int b) {
    left = l;
    top = t;
    right = r;
    bottom = b;
  }
  public int getPaddingLeft() {
    return left;
  }
  public int getPaddingTop() {
    return top;
  }
  public int getPaddingRight() {
    return right;
  }
  public int getPaddingBottom() {
    return bottom;
  }
  public boolean postDelayed(Runnable task, long delay) {
    ai.elizaresearch.alphaphone.MainActivityPorts.post(this, task, delay);
    return true;
  }
  public void setOnClickListener(OnClickListener value) {
    click = value;
  }
  public void performClick() {
    if (click != null)
      click.onClick(this);
  }
}`,
    'android/view/ViewGroup.java': `package android.view;
public class ViewGroup extends View {
  public static class LayoutParams {
    public static final int MATCH_PARENT = -1, WRAP_CONTENT = -2;
    public LayoutParams(int w, int h) {}
  }
  public final java.util.List<View> children = new java.util.ArrayList<>();
  public ViewGroup() {}
  public ViewGroup(Object context) {
    super(context);
  }
  public void addView(View view) {
    children.add(view);
    view.parent = this;
  }
  public void addView(View view, LayoutParams params) {
    addView(view);
  }
  public void removeView(View view) {
    children.remove(view);
    view.parent = null;
  }
}`,
    'android/view/Window.java': `package android.view;
public class Window {
  private final View decor = new View();
  public View getDecorView() {
    return decor;
  }
  public void setStatusBarColor(int value) {}
  public void setNavigationBarColor(int value) {}
  public void setNavigationBarContrastEnforced(boolean value) {}
}`,
    'android/widget/TextView.java': `package android.widget;
public class TextView extends android.view.View {
  public String text = "";
  public TextView(Object context) {
    super(context);
  }
  public void setText(String value) {
    text = value;
  }
  public void setTextColor(int value) {}
  public void setTextSize(int unit, int value) {}
  public void setGravity(int value) {}
}`,
    'android/widget/Button.java': `package android.widget;
public class Button extends TextView {
  public Button(Object context) {
    super(context);
  }
  public void setAllCaps(boolean value) {}
}`,
    'android/widget/LinearLayout.java': `package android.widget;
public class LinearLayout extends android.view.ViewGroup {
  public static final int VERTICAL = 1;
  public LinearLayout(Object context) {
    super(context);
  }
  public void setOrientation(int value) {}
  public void setGravity(int value) {}
  public void setBackgroundColor(int value) {}
}`,
    'android/webkit/ValueCallback.java': `package android.webkit;
public interface ValueCallback<T> {
  void onReceiveValue(T value);
}`,
    'android/webkit/WebSettings.java': `package android.webkit;
public class WebSettings {
  public static final int MIXED_CONTENT_NEVER_ALLOW = 0;
  public void setMixedContentMode(int value) {}
}`,
    'android/webkit/WebView.java': `package android.webkit;
public class WebView extends android.view.View {
  public boolean destroyed;
  public final java.util.List<String> scripts = new java.util.ArrayList<>();
  public final WebSettings settings = new WebSettings();
  public WebSettings getSettings() {
    return settings;
  }
  public static void setWebContentsDebuggingEnabled(boolean value) {}
  public void destroy() {
    destroyed = true;
  }
  public void evaluateJavascript(String script, ValueCallback<String> callback) {
    scripts.add(script);
    if (callback != null)
      callback.onReceiveValue("false");
  }
}`,
    'android/webkit/RenderProcessGoneDetail.java': `package android.webkit;
public class RenderProcessGoneDetail {
  public boolean didCrash() {
    return true;
  }
}`,
    'android/webkit/CookieManager.java': `package android.webkit;
public class CookieManager {
  public static CookieManager getInstance() {
    return new CookieManager();
  }
  public void setAcceptThirdPartyCookies(WebView view, boolean value) {}
}`,
    'android/app/ActivityManager.java': `package android.app;
public class ActivityManager {
  public static class RecentTaskInfo {
    public int taskId;
  }
  public static class AppTask {
    private final RecentTaskInfo info = new RecentTaskInfo();
    public AppTask(int task) {
      info.taskId = task;
    }
    public RecentTaskInfo getTaskInfo() {
      return info;
    }
    public void moveToFront() {
      ai.elizaresearch.alphaphone.MainActivityPorts.moveTask(info.taskId);
    }
  }
  public java.util.List<AppTask> getAppTasks() {
    return ai.elizaresearch.alphaphone.MainActivityPorts.tasks;
  }
}`,
    'androidx/activity/OnBackPressedCallback.java': `package androidx.activity;
public abstract class OnBackPressedCallback {
  public OnBackPressedCallback(boolean enabled) {}
  public abstract void handleOnBackPressed();
}`,
    'androidx/activity/OnBackPressedDispatcher.java': `package androidx.activity;
public class OnBackPressedDispatcher {
  public OnBackPressedCallback callback;
  public void addCallback(Object owner, OnBackPressedCallback value) {
    callback = value;
  }
}`,
    'androidx/core/splashscreen/SplashScreen.java': `package androidx.core.splashscreen;
public class SplashScreen {
  public static void installSplashScreen(Object activity) {}
}`,
    'androidx/core/graphics/Insets.java': `package androidx.core.graphics;
public class Insets {
  public int left, top, right, bottom;
}`,
    'androidx/core/view/WindowInsetsCompat.java': `package androidx.core.view;
public class WindowInsetsCompat {
  public static final WindowInsetsCompat CONSUMED = new WindowInsetsCompat();
  public static class Type {
    public static int ime() {
      return 1;
    }
    public static int systemBars() {
      return 2;
    }
    public static int displayCutout() {
      return 4;
    }
  }
  public boolean isVisible(int type) {
    return false;
  }
  public androidx.core.graphics.Insets getInsets(int type) {
    return new androidx.core.graphics.Insets();
  }
}`,
    'androidx/core/view/ViewCompat.java': `package androidx.core.view;
public class ViewCompat {
  public interface InsetsListener {
    WindowInsetsCompat apply(android.view.View view, WindowInsetsCompat insets);
  }
  public static int insetsRequests;
  public static void requestApplyInsets(android.view.View view) {
    insetsRequests++;
  }
  public static void setOnApplyWindowInsetsListener(android.view.View view, InsetsListener listener) {}
}`,
    'androidx/core/view/WindowCompat.java': `package androidx.core.view;
public class WindowCompat {
  public static void setDecorFitsSystemWindows(android.view.Window window, boolean value) {}
}`,
    'com/getcapacitor/Plugin.java': `package com.getcapacitor;
public class Plugin {}`,
    'com/getcapacitor/WebViewListener.java': `package com.getcapacitor;
public class WebViewListener {
  public void onPageLoaded(android.webkit.WebView view) {}
  public boolean onRenderProcessGone(
      android.webkit.WebView view, android.webkit.RenderProcessGoneDetail detail) {
    return false;
  }
}`,
    'com/getcapacitor/Bridge.java': `package com.getcapacitor;
public class Bridge {
  public final android.webkit.WebView view;
  public final java.util.List<WebViewListener> listeners = new java.util.ArrayList<>();
  public Bridge(android.webkit.WebView value) {
    view = value;
  }
  public android.webkit.WebView getWebView() {
    return view;
  }
  public void addWebViewListener(WebViewListener listener) {
    listeners.add(listener);
  }
}`,
    'com/getcapacitor/android/R.java': `package com.getcapacitor.android;
public class R {
  public static class id {
    public static final int webview = 1;
  }
}`,
    'com/getcapacitor/BridgeActivity.java': `package com.getcapacitor;
public class BridgeActivity {
  protected Bridge bridge;
  public boolean finishing, destroyed, removedTask;
  public int recreates, loads;
  public int taskId;
  public android.view.View content;
  public android.webkit.WebView inflated;
  private android.content.Intent intent = new android.content.Intent();
  private final android.view.Window window = new android.view.Window();
  private final androidx.activity.OnBackPressedDispatcher back =
      new androidx.activity.OnBackPressedDispatcher();
  public void onCreate(android.os.Bundle state) {
    inflated = new android.webkit.WebView();
    android.view.ViewGroup frame = new android.view.ViewGroup();
    frame.addView(inflated);
    content = frame;
    if (ai.elizaresearch.alphaphone.MainActivityPorts.bridgeAvailable)
      load();
    else
      content = new android.widget.TextView(this);
  }
  protected void load() {
    loads++;
    bridge = new Bridge(inflated);
    onNewIntent(getIntent());
  }
  public void registerPlugin(Class<? extends Plugin> plugin) {}
  public Bridge getBridge() {
    return bridge;
  }
  public android.content.Intent getIntent() {
    return intent;
  }
  public void setIntent(android.content.Intent value) {
    intent = value;
  }
  public int getTaskId() {
    return taskId;
  }
  public boolean isFinishing() {
    return finishing;
  }
  public boolean isDestroyed() {
    return destroyed;
  }
  public boolean moveTaskToBack(boolean nonRoot){throw new AssertionError("Unexercised task backgrounding");}
  public void finish() {
    finishing = true;
  }
  public void finishAndRemoveTask() {
    finishing = true;
    removedTask = true;
  }
  public void recreate() {
    recreates++;
  }
  public void onDestroy() {
    destroyed = true;
    if (bridge != null)
      bridge.view.destroy();
  }
  public androidx.lifecycle.Lifecycle getLifecycle(){return new androidx.lifecycle.Lifecycle();}
  public void onStart() {}
  public void onResume() {}
  public void onStop() {}
  public android.content.ContentResolver getContentResolver(){return new android.content.ContentResolver();}
  public void onConfigurationChanged(android.content.res.Configuration value) {}
  public void onNewIntent(android.content.Intent value) {}
  public void onWindowFocusChanged(boolean value) {}
  public void overridePendingTransition(int a, int b) {}
  public android.view.Window getWindow() {
    return window;
  }
  public android.view.View findViewById(int id) {
    return inflated;
  }
  public void setContentView(android.view.View value) {
    content = value;
  }
  public android.content.res.Resources getResources() {
    return new android.content.res.Resources();
  }
  public android.content.pm.PackageManager getPackageManager() {
    return new android.content.pm.PackageManager();
  }
  public String getPackageName() {
    return "ai.elizaresearch.alphaphone";
  }
  public void startActivity(android.content.Intent value) {
    ai.elizaresearch.alphaphone.MainActivityPorts.launch(value);
  }
  public <T> T getSystemService(Class<T> kind) {
    return kind.cast(new android.app.ActivityManager());
  }
  public androidx.activity.OnBackPressedDispatcher getOnBackPressedDispatcher() {
    return back;
  }
}`,
    'ai/elizaresearch/alphaphone/BuildConfig.java': `package ai.elizaresearch.alphaphone;
public class BuildConfig {
  public static boolean IS_LAUNCHER = true, DEBUG = false, ELIZA_DEV_ALLOW_TEST_MOCKS = false;
}`,
    'ai/elizaresearch/alphaphone/AlphaImageCapability.java': `package ai.elizaresearch.alphaphone;
public class AlphaImageCapability {
  public static boolean verified(Object context) {
    return false;
  }
}`,
    'ai/elizaresearch/alphaphone/AlphaDevicePlugin.java': `package ai.elizaresearch.alphaphone;
public class AlphaDevicePlugin extends com.getcapacitor.Plugin {
  public static int textScales;
  public static void applyTextScale(Object activity) {
    textScales++;
  }
}`,
  };
  sources['ai/elizaresearch/alphaphone/AlphaKeyboardDictationService.java'] = 'package ai.elizaresearch.alphaphone; public final class AlphaKeyboardDictationService {}';
  const activity = readFileSync(join(root, app, 'MainActivity.java'), 'utf8');
  sources['ai/elizaresearch/alphaphone/AlphaVoiceCloudPlugin.java'] = 'package ai.elizaresearch.alphaphone; public class AlphaVoiceCloudPlugin extends com.getcapacitor.Plugin {public static class Streaming extends com.getcapacitor.Plugin {}}';
  sources['ai/elizaresearch/alphaphone/AlphaTelephonyRoles.java'] = 'package ai.elizaresearch.alphaphone; public class AlphaTelephonyRoles {public static void sync(Object host){}}';
  sources['ai/elizaresearch/alphaphone/AlphaCanonicalNotifications.java'] = 'package ai.elizaresearch.alphaphone; public class AlphaCanonicalNotifications {public static void captureTap(Object host,android.content.Intent intent){}public static void ensure(Object host){}}';
  for (const [, name] of activity.matchAll(/registerPlugin\(([\w.]+)\.class\)/g)) {
    if (name === 'AlphaVoiceCloudPlugin.Streaming') continue;
    const qualified = name.includes('.') ? name : `ai.elizaresearch.alphaphone.${name}`;
    const path = qualified.replaceAll('.', '/') + '.java';
    if (sources[path]) continue;
    const lastDot = qualified.lastIndexOf('.');
    sources[path] = `package ${qualified.slice(0, lastDot)}; public class ${qualified.slice(lastDot + 1)} extends com.getcapacitor.Plugin {}`;
  }
  const paths = Object.entries(sources).map(([name, source]) => {
    const path = join(directory, name);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, source);
    return path;
  });
  return {directory, sources, paths, close: () => rmSync(directory, {recursive: true, force: true})};
}
