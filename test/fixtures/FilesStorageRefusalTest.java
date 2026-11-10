package fixture.identity;

import java.io.File;
import java.util.*;
import java.util.concurrent.*;

/** Executes AlphaFilesPlugin's actual storage/denial methods with deterministic bridge and worker
 * ports. This covers refusal routing and metadata, not Android permission or observer acceptance. */
public final class FilesStorageRefusalTest {
 private final Executor storageWorker;
 private static final String STORAGE_TRASH_FOLDER=".Trash-alpha";
 private FilesStorageRefusalTest(Executor worker){storageWorker=worker;}
 private Object getContext(){return this;}
 private static JSObject result(String status,String message){JSObject out=new JSObject();out.put("status",status);out.put("message",message);return out;}
 private @interface PluginMethod {}
 private static final class JSObject extends HashMap<String,Object> {boolean has(String key){return containsKey(key);}}
 private static final class JSArray extends ArrayList<Object> {void put(Object value){add(value);}}
 private static final class PluginCall {
  final List<String> events=new ArrayList<>();JSObject answer;int answers;
  String getString(String key,String fallback){return fallback;}
  void resolve(JSObject value){events.add("answer");answer=value;answers++;}
 }
 private static final class StorageBrowser {StorageBrowser(File root,String trash){}}
 private static final class StorageCatalog {
  static String access="granted";static boolean legacy=false,mounted=true;
  static String access(Object context){return access;}
  static boolean legacy(){return legacy;}
  static final class Volume {File directory=new File(".");}
  static Volume volume(Object context,String id){return mounted?new Volume():null;}
  static List<Volume> volumes(Object context){return Collections.emptyList();}
  static JSObject describe(Volume volume){return new JSObject();}
 }

 // STORAGE_METHODS
 // STATE_METHOD

 private static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
 private static void answer(PluginCall call,String status,boolean failed){
  check(call.answers==1,"one answer for "+status);
  check(status.equals(call.answer.get("status")),"answer status "+status);
  check(call.events.equals(failed?Arrays.asList("cleanup","answer"):Arrays.asList("answer")),"cleanup precedes answer: "+call.events);
 }
 private static void reset(){StorageCatalog.access="granted";StorageCatalog.legacy=false;StorageCatalog.mounted=true;}
 public static void main(String[] args){
  FilesStorageRefusalTest plugin=new FilesStorageRefusalTest(Runnable::run);
  reset();StorageCatalog.access="denied";StorageCatalog.legacy=true;
  PluginCall denied=new PluginCall();plugin.storage(denied,b->{throw new AssertionError("denied task ran");},()->denied.events.add("cleanup"));
  answer(denied,"denied",true);check(Boolean.TRUE.equals(denied.answer.get("legacy")),"denial reports Android 10 storage access");
  reset();StorageCatalog.mounted=false;
  PluginCall missingVolume=new PluginCall();plugin.storage(missingVolume,b->{throw new AssertionError("unmounted task ran");},()->missingVolume.events.add("cleanup"));
  answer(missingVolume,"unavailable",true);

  Exception[] errors={new IllegalArgumentException(),new IllegalStateException(),new java.io.FileNotFoundException(),new SecurityException(),new Exception()};
  String[] statuses={"invalid","exists","missing","denied","failed"};
  for(int i=0;i<errors.length;i++){
   reset();Exception error=errors[i];PluginCall call=new PluginCall();
   plugin.storage(call,b->{throw error;},()->call.events.add("cleanup"));answer(call,statuses[i],true);
  }
  reset();PluginCall rejected=new PluginCall();
  new FilesStorageRefusalTest(work->{throw new RejectedExecutionException();}).storage(rejected,b->{throw new AssertionError("closed worker task ran");},()->rejected.events.add("cleanup"));
  answer(rejected,"unavailable",true);
  PluginCall cleanupError=new PluginCall();StorageCatalog.access="denied";
  plugin.storage(cleanupError,b->new JSObject(),()->{cleanupError.events.add("cleanup");throw new IllegalStateException("observer was already removed");});
  answer(cleanupError,"denied",true);

  reset();PluginCall ready=new PluginCall();plugin.storage(ready,b->new JSObject(),()->{throw new AssertionError("successful task retired its watch");});answer(ready,"ready",false);
  PluginCall ordinary=new PluginCall();plugin.storage(ordinary,b->{throw new IllegalArgumentException();});answer(ordinary,"invalid",false);
  for(boolean legacy:new boolean[]{false,true})for(String access:new String[]{"granted","denied"}){
   reset();StorageCatalog.legacy=legacy;StorageCatalog.access=access;PluginCall state=new PluginCall();plugin.storageState(state);answer(state,"ready",false);
   check(Boolean.valueOf(legacy).equals(state.answer.get("legacy")),"storageState reports exact access kind");
   check(access.equals(state.answer.get("access")),"storageState preserves permission state");
  }
  System.out.println("PASS files storage refusals");
 }
}
