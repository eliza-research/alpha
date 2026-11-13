import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {javaBinary,jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {scaledTimeout} from '../timeouts.mjs';

export const root=fileURLToPath(new URL('../../../../',import.meta.url));
export function materialize(directory,sources){
 return Object.entries(sources).map(([path,body])=>{
  const target=join(directory,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,body);return target;
 });
}
export function compileJava(sources,directory){
 if(!jsonJar)throw Error('Prepare the reviewed host org.json dependency');
 execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',directory,...sources],{timeout:scaledTimeout(120000),stdio:'pipe'});
}
export function javaJson(directory,main){
 return JSON.parse(execFileSync(javaBinary('java'),['-cp',directory+':'+jsonJar,main],{encoding:'utf8',timeout:scaledTimeout(120000)}));
}
/** Android boundary ports only. Production controller/policy methods compile unchanged. */
export function androidPorts(identity){
 if(!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(identity))throw Error('Invalid Android fixture identity');
 return {
 'android/content/Context.java':`package android.content; import android.content.pm.*; import java.util.*; public class Context {
 public final Map<Class<?>,Object> services=new HashMap<>(); public final ContentResolver resolver=new ContentResolver();
 public final PackageManager packages=new PackageManager();
 public <T>T getSystemService(Class<T> type){return type.cast(services.get(type));}
 public ContentResolver getContentResolver(){return resolver;} public PackageManager getPackageManager(){return packages;}
 }`,
 'android/content/pm/PackageManager.java':`package android.content.pm; import java.util.*; public class PackageManager {
 public static final String FEATURE_TELEPHONY="android.hardware.telephony";
 public final Set<String> features=new HashSet<>();
 public boolean hasSystemFeature(String feature){return features.contains(feature);}
 }`,
 'android/content/ContentResolver.java':`package android.content; import java.util.*; public class ContentResolver {
 public final Map<String,String> values=new HashMap<>(); public boolean writeOk=true; public int writes;
 public String get(String key){return values.get(key);} public boolean put(String key,String value){if(!writeOk)return false;values.put(key,value);writes++;return true;}
 }`,
 'android/app/Activity.java':`package android.app; import android.content.*; import android.content.res.*; import android.os.*; import android.view.*;
 public class Activity extends Context {public boolean finishing,destroyed;public View content; public int starts;
 public static final int RESULT_OK=-1,RESULT_CANCELED=0;
 public boolean isFinishing(){return finishing;}public boolean isDestroyed(){return destroyed;} public void finish(){finishing=true;}
 public java.util.concurrent.Executor getMainExecutor(){return Runnable::run;}public Resources getResources(){return new Resources();}
 public Window getWindow(){return new Window();} public String getString(int id){return "string-"+id;}
 public void setContentView(View view){content=view;}public void startActivity(Intent intent){starts++;}public void onCreate(Bundle bundle){}
 public void sendOrderedBroadcast(Intent intent,String permission,BroadcastReceiver receiver,Handler handler,int initialCode,String data,Bundle extras){
  throw new AssertionError("HOME-only setup must not dispatch a telephony preparation broadcast");
 }
 }`,
 'android/content/BroadcastReceiver.java':`package android.content; public abstract class BroadcastReceiver {
 public abstract void onReceive(Context context,Intent intent);
 public int getResultCode(){return android.app.Activity.RESULT_CANCELED;}
 }`,
 'android/content/Intent.java':`package android.content;public class Intent {
 public static final int FLAG_INCLUDE_STOPPED_PACKAGES=32;
 public final String action;public String packageName,className;public int flags;
 public Intent(String a){action=a;}public Object resolveActivity(Object pm){return pm;}
 public Intent setClassName(String pkg,String cls){packageName=pkg;className=cls;return this;}
 public Intent addFlags(int flags){this.flags|=flags;return this;}
 }`,
 'android/content/res/Resources.java':`package android.content.res;public class Resources {public static class Metrics {public float density=1;}public Metrics getDisplayMetrics(){return new Metrics();}}`,
 'android/content/res/ColorStateList.java':`package android.content.res;public class ColorStateList {public static ColorStateList valueOf(int color){return new ColorStateList();}}`,
 'android/graphics/Color.java':`package android.graphics;public class Color {public static final int WHITE=-1,BLUE=255;public static int rgb(int r,int g,int b){return r*65536+g*256+b;}}`,
 'android/os/Bundle.java':`package android.os;public class Bundle {}`,
 'android/os/UserHandle.java':`package android.os;public class UserHandle {public static final int USER_SYSTEM=0;public boolean primary=true;public boolean isSystem(){return primary;}public static int getUid(int user,int app){return user*100000+app;}public static int getAppId(int uid){return uid%100000;}}`,
 'android/os/Process.java':`package android.os;public class Process {public static UserHandle user=new UserHandle();public static UserHandle myUserHandle(){return user;}}`,
 'android/os/UserManager.java':`package android.os;public class UserManager {public boolean managed;public boolean isManagedProfile(){return managed;}}`,
 'android/os/Looper.java':`package android.os;public class Looper {public static Looper getMainLooper(){return new Looper();}}`,
 'android/os/Handler.java':`package android.os;import java.util.*;public class Handler {public static final List<Runnable> delayed=new ArrayList<>();public Handler(Looper l){}public boolean postDelayed(Runnable task,long delay){if(delay!=15000)throw new AssertionError("Timeout changed");delayed.add(task);return true;}}`,
 'android/app/admin/DevicePolicyManager.java':`package android.app.admin;public class DevicePolicyManager {public boolean managed;public Object getDeviceOwnerComponentOnCallingUser(){return managed?this:null;}public Object getDeviceOwnerComponentOnAnyUser(){return managed?this:null;}}`,
 'android/app/role/RoleManager.java':`package android.app.role;import java.util.*;import java.util.function.*;import java.util.concurrent.*;import android.os.*;public class RoleManager {
 public static final String ROLE_HOME="android.app.role.HOME",ROLE_DIALER="android.app.role.DIALER",ROLE_SMS="android.app.role.SMS";
 public boolean available=true,held;public final List<Consumer<Boolean>> callbacks=new ArrayList<>();
 private void requireHome(String role){if(!ROLE_HOME.equals(role))throw new AssertionError("Unexpected role in HOME-only setup: "+role);}
 private void requireSystemUser(UserHandle user){if(!user.isSystem())throw new AssertionError("Expected the system user");}
 public boolean isRoleAvailable(String role){requireHome(role);return available;}
 public List<String> getRoleHoldersAsUser(String role,UserHandle user){requireHome(role);requireSystemUser(user);return held?List.of(${JSON.stringify(identity)}):List.of();}
 public void addRoleHolderAsUser(String role,String name,int flags,UserHandle user,Executor executor,Consumer<Boolean> callback){
  requireHome(role);requireSystemUser(user);
  if(!${JSON.stringify(identity)}.equals(name)||flags!=0)throw new AssertionError("Unexpected HOME request identity");
  callbacks.add(accepted->executor.execute(()->callback.accept(accepted)));
 }
 }`,
 'android/provider/Settings.java':`package android.provider;import android.content.*;public class Settings {
 public static final String ACTION_WIFI_SETTINGS="wifi",ACTION_HOME_SETTINGS="home",ACTION_INPUT_METHOD_SETTINGS="ime",ACTION_SETTINGS="settings",ACTION_MANAGE_DEFAULT_APPS_SETTINGS="default-apps";
 public static class Secure {public static final String USER_SETUP_COMPLETE="complete",DEFAULT_INPUT_METHOD="selected",ENABLED_INPUT_METHODS="enabled",THEME_CUSTOMIZATION_OVERLAY_PACKAGES="palette";
 public static int getInt(ContentResolver c,String key,int fallback){String v=c.get(key);return v==null?fallback:Integer.parseInt(v);}
 public static String getString(ContentResolver c,String key){return c.get(key);}public static boolean putString(ContentResolver c,String key,String value){return c.put(key,value);}}
 }`,
 'android/view/View.java':`package android.view;import android.content.*;public class View {public static final int GONE=8,VISIBLE=0,ACCESSIBILITY_LIVE_REGION_POLITE=1;
 public interface OnClickListener {void onClick(View view);}public OnClickListener listener;public int visibility=VISIBLE;public boolean enabled=true;
 public View(Context context){}public void setOnClickListener(OnClickListener l){listener=l;}public void performClick(){if(enabled&&listener!=null)listener.onClick(this);}
 public void setVisibility(int v){visibility=v;}public void setEnabled(boolean value){enabled=value;}public void setPadding(int a,int b,int c,int d){}public void setBackgroundColor(int color){}
 }`,
 'android/view/Window.java':`package android.view;public class Window {public void setStatusBarColor(int c){}public void setNavigationBarColor(int c){}}`,
 'android/view/Gravity.java':`package android.view;public class Gravity {public static final int CENTER=1,CENTER_VERTICAL=2;}`,
 'android/widget/TextView.java':`package android.widget;import android.content.*;import android.view.*;public class TextView extends View {public Object text="";public TextView(Context c){super(c);}public void setText(String s){text=s;}public void setText(int s){text=s;}public void setTextSize(int s){}public void setTextColor(int c){}public void setFontFeatureSettings(String s){}public void setAccessibilityHeading(boolean b){}public void setAccessibilityLiveRegion(int n){}}`,
 'android/widget/Button.java':`package android.widget;import android.content.*;import android.content.res.*;public class Button extends TextView {public Button(Context c){super(c);}public void setAllCaps(boolean b){}public void setMinHeight(int h){}public void setBackgroundTintList(ColorStateList c){}}`,
 'android/widget/LinearLayout.java':`package android.widget;import java.util.*;import android.content.*;import android.view.*;public class LinearLayout extends View {public static final int VERTICAL=1;public final List<View> children=new ArrayList<>();public LinearLayout(Context c){super(c);}public void setOrientation(int o){}public void setGravity(int g){}public void addView(View v){children.add(v);}public void addView(View v,LayoutParams p){children.add(v);}public static class LayoutParams {public int bottomMargin;public LayoutParams(int w,int h){}public LayoutParams(int w,int h,int weight){}}}`,
 'android/widget/ScrollView.java':`package android.widget;import android.content.*;import android.view.*;public class ScrollView extends View {public View child;public ScrollView(Context c){super(c);}public void setFillViewport(boolean b){}public void addView(View v){child=v;}}`,
 'android/widget/ImageView.java':`package android.widget;import android.content.*;import android.view.*;public class ImageView extends View {public ImageView(Context c){super(c);}public void setImageResource(int r){}public void setContentDescription(String s){}public void setAdjustViewBounds(boolean b){}}`,
 'android/widget/Toast.java':`package android.widget;import android.content.*;public class Toast {public static final int LENGTH_SHORT=0,LENGTH_LONG=1;public static Toast makeText(Context c,int text,int duration){return new Toast();}public void show(){}}`,
 'android/app/WallpaperManager.java':`package android.app;import java.io.*;public class WallpaperManager {public static final int FLAG_SYSTEM=1,FLAG_LOCK=2;public static boolean writeOk=true;public static int writes;public static WallpaperManager getInstance(Activity a){return new WallpaperManager();}public void setResource(int resource,int flags)throws IOException{if(flags!=3)throw new AssertionError("Wallpaper flags changed");if(!writeOk)throw new IOException("Injected wallpaper failure");writes++;}}`,
 'android/content/pm/ApplicationInfo.java':`package android.content.pm;public class ApplicationInfo {public static final int FLAG_SYSTEM=1,FLAG_INSTALLED=2,FLAG_SUSPENDED=4;public int uid=10042,flags=FLAG_SYSTEM|FLAG_INSTALLED;public boolean enabled=true;public boolean isSystemApp(){return (flags&FLAG_SYSTEM)!=0;}}`,
 'android/content/pm/ServiceInfo.java':`package android.content.pm;public class ServiceInfo {public boolean enabled=true;public ApplicationInfo applicationInfo=new ApplicationInfo();}`,
 'android/view/inputmethod/InputMethodInfo.java':`package android.view.inputmethod;import android.content.pm.*;public class InputMethodInfo {public String getPackageName(){return "com.android.inputmethod.latin";}public String getServiceName(){return "com.android.inputmethod.latin.LatinIME";}public String getId(){return "com.android.inputmethod.latin/.LatinIME";}public ServiceInfo getServiceInfo(){return new ServiceInfo();}}`,
 'android/view/inputmethod/InputMethodManager.java':`package android.view.inputmethod;import java.util.*;public class InputMethodManager {public boolean available=true;public List<InputMethodInfo> getInputMethodList(){return available?List.of(new InputMethodInfo()):List.of();}}`,
};}
