package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.system.crash.CrashLog;
import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;
import android.os.Looper;
import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONArray;
import org.json.JSONObject;

public final class CrashJournalTraces implements AutoCloseable {
 static final long BASE=1_760_000_000_000L, MAX_SAFE=9_007_199_254_740_991L;
 static final String MARKER="synthetic extra field, never a real crash message";
 public static volatile long clock=BASE+10;
 final Path directory=Files.createTempDirectory("quint-crash-journal-");
 final Lane[] lanes=new Lane[3];
 final Trace trace;
 final List<ApplicationExitInfo> history=new ArrayList<>();
 int held,delegated;
 CountDownLatch finishSnapshot;
 JSONObject reply=emptyReply(0,"none");

 record Request(String op,String kind,String cls,PluginCall call) {
  JSONObject abstractValue(){return new JSONObject().put("op",op).put("kind",kind).put("cls",cls);}
 }
 static final class Lane {
  final Context context;
  final ActivityManager manager=new ActivityManager();
  final AlphaDevicePlugin plugin=new AlphaDevicePlugin();
  final ExecutorService worker;
  CountDownLatch run;
  Request pending;
  Lane(Path directory)throws Exception{
   context=new Context(directory.toFile());context.manager=manager;plugin.attach(context);
   worker=(ExecutorService)Trace.read(plugin,"diagnosticsWorker");
  }
  void gate()throws Exception{
   CountDownLatch entered=new CountDownLatch(1);run=new CountDownLatch(1);
   worker.execute(()->{entered.countDown();await(run);});await(entered);
  }
 }
 CrashJournalTraces(String name,String seed)throws Exception{
  lanes[1]=new Lane(directory);lanes[2]=new Lane(directory);
  Looper.getMainLooper();
  if(seed.equals("unsafe"))clock=MAX_SAFE;
  initialize(seed);
  trace=new Trace(name,observe());trace.value.put("init",Trace.action("initWith",seed));
 }
 static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
 static void await(CountDownLatch gate){
  try{check(gate.await(30,TimeUnit.SECONDS),"Synthetic callback gate timed out");}
  catch(InterruptedException stop){Thread.currentThread().interrupt();throw new AssertionError(stop);}
 }
 static void answered(PluginCall call)throws Exception{
  if(!call.answerReady.await(20,TimeUnit.SECONDS)){
   Thread.getAllStackTraces().forEach((thread,frames)->{if(thread.getName().startsWith("pool-"))java.lang.System.err.println(thread+" "+Arrays.toString(frames));});
   throw new AssertionError("Diagnostics worker did not answer");
  }
 }
 Path path(){return CrashLog.file(lanes[1].context).toPath();}
 static JSONObject row(long offset,String kind,String type){
  return new JSONObject().put("at",BASE+offset).put("source","renderer").put("kind",kind).put("errorClass",type).put("process","main");
 }
 void initialize(String seed)throws Exception{
  if(seed.equals("empty"))return;
  Files.createDirectories(path().getParent());
  if(seed.equals("corrupt")){Files.writeString(path(),"{bad");return;}
  if(seed.equals("oversize")){Files.write(path(),new byte[CrashLog.MAX_FILE_BYTES+1]);return;}
  JSONArray entries=new JSONArray();
  if(seed.equals("capacity"))for(int i=0;i<CrashLog.MAX_ENTRIES;i++)entries.put(row(1,"render","CapacityFiller"));
  if(seed.equals("legacy")){
   entries.put(row(1,"startup","TypeError").put("message",MARKER));
   entries.put(row(2,"render","RangeError"));
   entries.put(row(3,"startup","StringTime").put("at",Long.toString(BASE+3)));
   entries.put(row(4,"startup","FractionTime").put("at",BASE+4.5));
  }
  if(seed.equals("unsafe")){
   entries.put(row(MAX_SAFE-BASE,"startup","LastSafeTime"));
   entries.put(row(MAX_SAFE+1-BASE,"startup","UnsafeTime"));
  }
  if(seed.equals("ages")){
   entries.put(row(10-CrashLog.RETENTION_MS,"startup","ExpiredBoundary"));
   entries.put(row(11-CrashLog.RETENTION_MS,"startup","RetainedBoundary"));
   entries.put(row(10+CrashLog.RETENTION_MS,"startup","FutureBoundary"));
   entries.put(row(11+CrashLog.RETENTION_MS,"startup","TooFarFuture"));
  }
  Files.writeString(path(),new JSONObject().put("version",1).put("lastExitAt",0).put("entries",entries).toString());
 }

 static JSONObject emptyReply(int owner,String outcome){
  return new JSONObject().put("owner",owner).put("outcome",outcome).put("fillers",0).put("rows",new JSONArray()).put("exitHistory",false);
 }
 static JSONObject rows(JSONArray raw){
  int fillers=0;JSONArray rows=new JSONArray();
  for(int i=0;i<raw.length();i++){
   JSONObject row=raw.getJSONObject(i);
   String source=row.getString("source"), detail=row.optString("errorClass",row.optString("reason",""));
   if(detail.equals("CapacityFiller")){fillers++;continue;}
   Set<String> allowed=switch(source){
    case "renderer" -> Set.of("at","source","kind","errorClass","process","message");
    case "exit" -> Set.of("at","source","reason","process");
    case "uncaught" -> Set.of("at","source","errorClass","rootClass","thread","process");
    default -> throw new AssertionError("Unknown fixture source "+source);
   };
   check(allowed.containsAll(row.keySet()),"Observed record field allowlist");
   if(row.has("message"))check(MARKER.equals(row.getString("message")),"Only seeded fixture marker may appear");
   if(source.equals("uncaught"))check(row.getString("rootClass").equals(IOException.class.getName())&&row.getString("thread").equals("main"),
    "Exact synthetic root cause class and thread class");
   Object timestamp=row.get("at");
   String stamp=timestamp instanceof String?"text":timestamp.toString().equals(Long.toString(MAX_SAFE+1))?"unsafe":
    timestamp.toString().equals(Double.toString(BASE+4.5))||timestamp.toString().equals("1760000000004.5")?"fraction":"safe";
   rows.put(new JSONObject().put("at",row.getLong("at")-BASE).put("stamp",stamp).put("source",source).put("kind",row.optString("kind",""))
    .put("detail",detail).put("process",row.getString("process")).put("extra",row.has("message")));
  }
  return new JSONObject().put("fillers",fillers).put("rows",rows);
 }
 JSONObject disk()throws Exception{
  JSONObject result=rows(new JSONArray());
  if(!Files.exists(path()))return result.put("format","missing").put("watermark",0);
  if(Files.size(path())>CrashLog.MAX_FILE_BYTES)return result.put("format","oversize").put("watermark",0);
  JSONObject raw;
  try{raw=new JSONObject(Files.readString(path()));}
  catch(org.json.JSONException malformed){return result.put("format","corrupt").put("watermark",0);}
  check(raw.optInt("version")==1&&raw.keySet().equals(Set.of("version","entries","lastExitAt")),"Exact installed journal envelope");
  long watermark=raw.optLong("lastExitAt",0);
  return rows(raw.getJSONArray("entries")).put("format","valid").put("watermark",watermark==0?0:watermark-BASE);
 }

 JSONObject observe()throws Exception{
  JSONArray exits=exitIds(lanes[1].manager.exits);
  JSONArray captured=held==0?new JSONArray():exitIds(lanes[held].manager.captured);
  String mode=Build.VERSION.SDK_INT<30?"old":lanes[1].context.manager==null?"absent":lanes[1].manager.fail?"refused":"available";
  return Trace.fields("now",clock-BASE,"a",pending(1),"b",pending(2),"closedA",lanes[1].worker.isShutdown(),
   "closedB",lanes[2].worker.isShutdown(),"disk",disk(),"history",exits,"historyMode",mode,
   "held",held,"captured",captured,"reply",reply,"delegated",delegated);
 }
 JSONObject pending(int actor){
  Request req=lanes[actor].pending;
  return req==null?new JSONObject().put("op","none").put("kind","").put("cls",""):req.abstractValue();
 }
 static JSONArray exitIds(List<ApplicationExitInfo> values){
  JSONArray ids=new JSONArray();
  for(ApplicationExitInfo value:values)ids.put(value.timestamp()-BASE);
  return ids;
 }
 void point(String name,Object... args)throws Exception{trace.step(name,observe(),args);}

 void enqueue(int actor,String op,String kind,String cls)throws Exception{
  Lane lane=lanes[actor];
  if(!lane.worker.isShutdown())lane.gate();
  JSObject data=new JSObject();
  if(op.equals("record"))data.put("kind",kind).put("errorClass",cls.equals("dirty")?MARKER:cls);
  PluginCall call=new PluginCall(data);
  switch(op){
   case "record" -> lane.plugin.recordRendererFailure(call);
   case "read" -> lane.plugin.crashLog(call);
   case "clear" -> lane.plugin.clearCrashLog(call);
   default -> throw new AssertionError(op);
  }
  if(lane.worker.isShutdown()){
   check(call.answered&&"Problem log is unavailable".equals(call.error),"Late work answers refusal");
   reply=emptyReply(actor,"closed");
  }else{
   check(!call.answered&&lane.pending==null,"Actual worker owns one queued call");
   lane.pending=new Request(op,kind,cls,call);reply=emptyReply(actor,"pending");
  }
  point("enqueue",actor,op,kind,cls);
 }
 void complete(int actor,String fault,boolean fromSnapshot)throws Exception{
  Lane lane=lanes[actor];
  AtomicFile.fault=fault;
  if(fromSnapshot)finishSnapshot.countDown();else lane.run.countDown();
  answered(lane.pending.call());
  AtomicFile.fault="none";
  Request request=lane.pending;lane.pending=null;
  PluginCall call=request.call();
  if(call.error!=null)reply=emptyReply(actor,"rejected");
  else if(request.op().equals("read")){
   check(call.result.keySet().equals(Set.of("entries","exitHistory")),"Bridge exposes only the intended top-level read fields");
   JSONObject value=rows(call.result.getJSONArray("entries"));
   reply=emptyReply(actor,"read").put("rows",value.getJSONArray("rows")).put("fillers",value.getInt("fillers"))
    .put("exitHistory",call.result.getBoolean("exitHistory"));
  }else{
   check(call.result.isEmpty(),"No details in append/clear acknowledgement");
   reply=emptyReply(actor,"ok");
  }
  check(!Files.exists(path().resolveSibling("v1.json.new")),"Atomic temporary file retired");
  if(fromSnapshot){held=0;lane.manager.onSnapshot=()->{};}
  point(fromSnapshot?"finishHeld":"settle",fromSnapshot?new Object[]{fault}:new Object[]{actor,fault});
 }
 void settle(int actor,String fault)throws Exception{complete(actor,fault,false);}
 void heldRead(int actor)throws Exception{
  Lane lane=lanes[actor];
  CountDownLatch captured=new CountDownLatch(1);finishSnapshot=new CountDownLatch(1);
  lane.manager.onSnapshot=()->{captured.countDown();await(finishSnapshot);};
  lane.run.countDown();await(captured);
  held=actor;point("beginHeld",actor);
 }
 void destroy(int actor)throws Exception{lanes[actor].plugin.handleOnDestroy();point("destroy",actor);}
 void ordinary(int actor,String op,String kind,String cls)throws Exception{enqueue(actor,op,kind,cls);settle(actor,"none");}
 void record(int actor,String kind,String cls)throws Exception{ordinary(actor,"record",kind,cls);}
 void read(int actor)throws Exception{ordinary(actor,"read","","");}
 void clear(int actor)throws Exception{ordinary(actor,"clear","","");}
 void historyMode(String mode)throws Exception{
  Build.VERSION.SDK_INT=mode.equals("old")?29:36;
  for(int actor=1;actor<=2;actor++){
   Lane lane=lanes[actor];
   lane.context.manager=mode.equals("absent")?null:lane.manager;lane.manager.fail=mode.equals("refused");
  }
  point("historyMode",mode);
 }
 void exit(int id)throws Exception{
  int reason=switch(id){case 1,4 -> ApplicationExitInfo.REASON_CRASH;case 2 -> ApplicationExitInfo.REASON_USER_REQUESTED;
   case 3 -> ApplicationExitInfo.REASON_ANR;default -> throw new AssertionError(id);};
  String process=switch(id){case 1,2 -> "fixture.example";case 3 -> "fixture.example:isolated_pdf";default -> MARKER;};
  history.add(new ApplicationExitInfo(BASE+id,reason,0,process));
  history.sort(Comparator.comparingLong(ApplicationExitInfo::timestamp).reversed());
  lanes[1].manager.exits=List.copyOf(history);lanes[2].manager.exits=List.copyOf(history);
  point("exit",id);
 }
 void time(long offset)throws Exception{clock=BASE+offset;point("time",offset);}
 void uncaught()throws Exception{
  Thread.UncaughtExceptionHandler actual=CrashLog.handler(lanes[1].context,(thread,error)->delegated++);
  actual.uncaughtException(Thread.currentThread(),new IllegalStateException(MARKER,new IOException(MARKER)));
  check(!Files.readString(path()).contains(MARKER),"Native throwable messages never enter the file");
  point("uncaught");
 }

 @Override public void close()throws Exception{
  if(finishSnapshot!=null)finishSnapshot.countDown();
  for(int actor=1;actor<=2;actor++){
   Lane lane=lanes[actor];if(lane.run!=null)lane.run.countDown();
   if(!lane.worker.isShutdown())lane.plugin.handleOnDestroy();
   check(lane.worker.awaitTermination(8,TimeUnit.SECONDS),"Diagnostics worker did not stop");
  }
  try(var entries=Files.walk(directory)){
   for(Path entry:entries.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(entry);
  }
 }

 public static void main(String[] args)throws Exception{
  String name=args[0],seed=switch(name){
   case "capacity" -> "capacity";case "retention" -> "ages";case "legacy-bridge" -> "legacy";
   case "corrupt" -> "corrupt";case "oversize" -> "oversize";case "unsafe-time" -> "unsafe";default -> "empty";
  };
  try(var f=new CrashJournalTraces(name,seed)){
   switch(name){
    case "workers" -> {
     f.enqueue(1,"record","render","TypeError");f.enqueue(2,"record","startup","dirty");
     f.settle(2,"none");f.destroy(1);f.settle(1,"none");f.enqueue(1,"read","","");
     f.read(2);f.clear(2);f.read(2);
    }
    case "capacity" -> {f.record(1,"render","TypeError");f.record(2,"uncaught","RangeError");f.read(1);}
    case "retention" -> {f.read(1);f.time(20);f.read(2);f.record(1,"startup","TypeError");f.read(2);}
    case "legacy-bridge" -> {
     f.read(1);
     JSONArray rows=f.reply.getJSONArray("rows");
     check(Files.readString(f.path()).contains(MARKER),"Synthetic legacy marker remains on disk after a bridge read");
     check(!rows.getJSONObject(0).getBoolean("extra"),"Raw native bridge exposed the synthetic extra field");
     check(rows.length()==2&&rows.getJSONObject(0).getString("detail").equals("TypeError")&&
      rows.getJSONObject(1).getString("detail").equals("RangeError"),"Numeric string and fractional timestamps are refused; valid rows remain");
     f.clear(2);f.read(1);
    }
    case "unsafe-time" -> {
     f.read(1);
     JSONArray rows=f.reply.getJSONArray("rows");
     check(rows.length()==1&&rows.getJSONObject(0).getString("detail").equals("LastSafeTime"),"Only the last JavaScript-safe integer timestamp is published");
     check(f.disk().getJSONArray("rows").length()==2,"Read leaves both raw disk rows unchanged");
    }
    case "corrupt", "oversize" -> {f.read(1);f.record(2,"startup","TypeError");f.read(1);}
    case "write-faults" -> {
     f.enqueue(1,"record","bad-kind","TypeError");f.settle(1,"none");
     f.enqueue(1,"record","render","TypeError");f.settle(1,"before");f.read(2);
     f.record(1,"render","TypeError");f.enqueue(2,"clear","","");f.settle(2,"staged");f.read(1);
     f.enqueue(2,"clear","","");f.settle(2,"after");f.read(1);
    }
    case "history-and-watermark" -> {
     f.exit(1);f.exit(2);f.read(1);f.clear(2);f.read(1);
     f.exit(3);f.exit(4);f.read(2);f.read(1);
    }
    case "history-refused" -> {
     f.record(1,"render","TypeError");f.exit(1);f.historyMode("old");f.read(1);
     f.historyMode("absent");f.read(1);f.historyMode("refused");f.read(2);
     f.historyMode("available");f.enqueue(1,"read","","");f.settle(1,"after");f.read(2);
    }
    case "held-read-and-clear" -> {
     f.exit(1);f.read(1);f.exit(3);f.enqueue(1,"read","","");f.heldRead(1);
     f.exit(4);f.clear(2);f.complete(1,"none",true);
     check(f.reply.getJSONArray("rows").length()==1&&f.reply.getJSONArray("rows").getJSONObject(0).getInt("at")==3,
      "A held pre-clear snapshot imports its unseen historical exit and excludes a later provider addition");
     f.clear(2);f.read(1);
    }
    case "native-handler" -> {f.enqueue(1,"record","startup","TypeError");f.uncaught();f.settle(1,"none");f.read(2);}
    default -> throw new AssertionError(name);
   }
   System.out.println(f.trace.value);
  }
 }
}
