package ai.eliza.sense;

import android.content.SharedPreferences;
import java.nio.file.*;
import java.util.*;
import org.json.*;

/** Memory and disk are independent observations at the SharedPreferences boundary. */
public final class StorePorts {
 public static int boot=1,stops;public static long install=1;
 public static Preferences preferences;
 public static final class Preferences implements SharedPreferences {
  public final Path path;public final Map<String,Object> memory=new HashMap<>(),disk=new HashMap<>();
  public String outcome="success";public int attempts;
  public Preferences(Path path)throws Exception {this.path=path;if(Files.exists(path)){JSONObject input=new JSONObject(Files.readString(path));for(String key:input.keySet())disk.put(key,input.get(key));}memory.putAll(disk);}
  public void persist() {try{Files.writeString(path,new JSONObject(disk).toString());}catch(Exception failure){throw new IllegalStateException(failure);}}
  public int getInt(String key,int fallback){return memory.containsKey(key)?((Number)memory.get(key)).intValue():fallback;}
  public long getLong(String key,long fallback){return memory.containsKey(key)?((Number)memory.get(key)).longValue():fallback;}
  public boolean getBoolean(String key,boolean fallback){return memory.containsKey(key)?(boolean)memory.get(key):fallback;}
  public String getString(String key,String fallback){return memory.containsKey(key)?(String)memory.get(key):fallback;}
  public Editor edit(){return new Change();}
  final class Change implements Editor {
   final Map<String,Object> changes=new HashMap<>();final Set<String> removed=new HashSet<>();boolean clear;
   public Editor putInt(String key,int value){changes.put(key,value);return this;}
   public Editor putLong(String key,long value){changes.put(key,value);return this;}
   public Editor putBoolean(String key,boolean value){changes.put(key,value);return this;}
   public Editor putString(String key,String value){changes.put(key,value);return this;}
   public Editor remove(String key){removed.add(key);return this;}
   public Editor clear(){clear=true;return this;}
   public boolean commit(){
    attempts++;if(outcome.equals("early-throw"))throw new IllegalStateException("controlled commit admission failure");
    if(clear)memory.clear();for(String key:removed)memory.remove(key);memory.putAll(changes);
    if(!outcome.equals("memory-failure")){disk.clear();disk.putAll(memory);persist();}
    if(outcome.equals("durable-throw"))throw new IllegalStateException("controlled lost acknowledgement after persistence");
    return outcome.equals("success");
   }
  }
 }
 private StorePorts(){}
}
