package android.content;
public class Intent {
 public static final String EXTRA_INTENT="android.intent.extra.INTENT";
 public static final int FLAG_ACTIVITY_NEW_TASK=0x10000000,URI_INTENT_SCHEME=1;
 public String action,packageName;
 private Class<?> component;
 private android.net.Uri data;
 private int flags;
 private final java.util.Map<String,Object> extras=new java.util.HashMap<>();
 public Intent(String action){this.action=action;}
 public Intent(String action,android.net.Uri data){this(action);this.data=data;}
 public Intent(Context context,Class<?> component){this((String)null);this.component=component;this.packageName=context.getPackageName();}
 public Intent(Intent other){this.action=other.action;this.component=other.component;this.data=other.data;this.flags=other.flags;this.packageName=other.packageName;extras.putAll(other.extras);}
 public String getAction(){return action;}
 public Intent setAction(String value){this.action=value;return this;}
 public Intent setPackage(String name){this.packageName=name;return this;}
 public String getPackage(){return packageName;}
 public Object getComponent(){return component;}
 public Intent setData(android.net.Uri value){data=value;return this;}
 public android.net.Uri getData(){return data;}
 public String getDataString(){return data==null?null:data.toString();}
 public Object getSelector(){return null;}
 public Object getClipData(){return null;}
 public Object getSourceBounds(){return null;}
 public Object getType(){return null;}
 public Object getIdentifier(){return null;}
 public Object getCategories(){return null;}
 public int getFlags(){return flags;}
 public Intent addFlags(int value){flags|=value;return this;}
 public Intent putExtra(String key,int value){extras.put(key,value);return this;}
 public Intent putExtra(String key,boolean value){extras.put(key,value);return this;}
 public Intent putExtra(String key,Intent value){extras.put(key,value);return this;}
 public int getIntExtra(String key,int fallback){Object value=extras.get(key);return value instanceof Integer?(Integer)value:fallback;}
 public boolean getBooleanExtra(String key,boolean fallback){Object value=extras.get(key);return value instanceof Boolean?(Boolean)value:fallback;}
 public Object extra(String key){return extras.get(key);}
 public java.util.Map<String,Object> getExtras(){return extras.isEmpty()?null:extras;}
 public boolean filterEquals(Intent other){return java.util.Objects.equals(action,other.action)&&java.util.Objects.equals(packageName,other.packageName)&&java.util.Objects.equals(component,other.component)&&java.util.Objects.equals(getDataString(),other.getDataString());}
 // Only the ordinary confirmation shape is used by the receipt test.
 public String toUri(int mode){return "intent:#Intent;action="+action+";package="+packageName+";i."+android.content.pm.PackageInstaller.EXTRA_SESSION_ID+"="+getIntExtra(android.content.pm.PackageInstaller.EXTRA_SESSION_ID,-1)+";end";}
 public static Intent parseUri(String uri,int mode){String[] parts=uri.split(";");if(parts.length!=5)throw new IllegalArgumentException();return new Intent(parts[1].substring(7)).setPackage(parts[2].substring(8)).putExtra(android.content.pm.PackageInstaller.EXTRA_SESSION_ID,Integer.parseInt(parts[3].substring(parts[3].indexOf('=')+1)));}
}
