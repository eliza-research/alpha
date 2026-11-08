package android.content;
public class Intent {
 public static final String EXTRA_INTENT="android.intent.extra.INTENT";
 public final String action;
 private final java.util.Map<String,Object> extras=new java.util.HashMap<>();
 public Intent(String action){this.action=action;}
 public Intent(String action,android.net.Uri data){this(action);}
 public String getAction(){return action;}
 public Intent setPackage(String name){return this;}
 public Intent putExtra(String key,int value){extras.put(key,value);return this;}
 public Intent putExtra(String key,Intent value){extras.put(key,value);return this;}
 public int getIntExtra(String key,int fallback){Object value=extras.get(key);return value instanceof Integer?(Integer)value:fallback;}
 public Object extra(String key){return extras.get(key);}
}
