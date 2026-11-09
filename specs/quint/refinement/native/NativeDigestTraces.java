package ai.elizaresearch.alphaphone;

import android.content.Context;
import java.io.IOException;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

public final class NativeDigestTraces {
 private static final long START=Instant.parse("2026-03-08T15:00:00Z").toEpochMilli();
 private static final long WEEK=604800000L;
 private static final String DEVICE="fixture-device-slot";
 private static final String REV="a".repeat(64);
 private static final Context context=new Context();
 private static final Map<String,String> slots=new HashMap<>();
 private static final Map<String,Integer> revisionScopes=new HashMap<>();
 private static NativeDigestHost host=new NativeDigestHost(context);
 private static Trace trace;
 private static long now;
 private static int owner=1,generation=1,calendarRevision=1,writes,calendarReads,reminderReads,restarts,identityReads,heldIdentityReads;
 private static boolean foreground=true,transport=true,calendarPermission=true;
 private static String fault="none",profile="normal",reply="none",requestKind="none";
 private static JSONObject returned;
 private static volatile Hold held;
 private static FutureTask<JSONObject> pending;
 private static int readOwner,readSource,readGeneration,readScope;
 private static String readKind="none",readProfile="none";
 private record Hold(String port,CountDownLatch reached,CountDownLatch released) {
  Hold(String port){this(port,new CountDownLatch(1),new CountDownLatch(1));}
  void await()throws Exception {
   if(!reached.await(8,TimeUnit.SECONDS))throw new AssertionError("Digest read did not reach held "+port);
  }
  void check(String position)throws Exception {
   if(!position.equals(port))return;
   reached.countDown();
   if(!released.await(12,TimeUnit.SECONDS))throw new IOException("Synthetic "+port+" read timed out");
  }
 }

 public static long wallTime(){return START+now;}
 public static boolean calendarPermission(){return calendarPermission;}
 public static void checkGeneration(String value){if(owner==0||!value.equals("generation-"+generation))throw new SecurityException("Synthetic binding retired");}
 public static void checkTransport(){if(!transport)throw new SecurityException("Synthetic transport retired");}
 public static JSONObject activeBinding(){
  return owner==0?new JSONObject():new JSONObject().put("mode","resident").put("enabled",true)
   .put("sessionId","session-"+owner).put("generation","generation-"+generation)
   .put("ownerId","owner-"+owner).put("agentId","agent-"+owner).put("deviceSlot",DEVICE);
 }

 private static JSONObject binding(int identity){
  return new JSONObject().put("ownerId","owner-"+identity).put("agentId","agent-"+identity)
   .put("installationId","installation-"+identity).put("enrollmentId","enrollment-"+identity);
 }
 private static String source(int id){return "source-"+id;}
 private static String slot(int identity,int id)throws Exception {
  JSONObject b=binding(identity);
  return "native-digest-source:v1:"+HostedResultNotices.hash(new JSONArray().put(b.getString("ownerId"))
   .put(b.getString("agentId")).put(b.getString("installationId")).put(b.getString("enrollmentId"))
   .put(source(id)).toString());
 }
 static String readSlot(String key){
  if(key.equals(DEVICE))return binding(owner).toString();
  if(!key.startsWith("native-digest-source:v1:"))throw new AssertionError("Unexpected storage read");
  return slots.get(key);
 }
 static void writeSlot(String key,String value)throws Exception {
  if(!key.startsWith("native-digest-source:v1:"))throw new AssertionError("Unexpected storage write");
  writes++;
  if(fault.equals("before"))throw new IOException("Synthetic write refused before commit");
  slots.put(key,value);
  JSONObject grant=new JSONObject(value);
  revisionScopes.putIfAbsent(grant.getString("revision"),scopeClass(grant.getJSONObject("scope")));
  if(fault.equals("after"))throw new IOException("Synthetic acknowledgement lost");
  if(fault.equals("foreground-after"))foreground=false;
 }
 private static void foregroundCheck(){if(!foreground)throw new SecurityException("Synthetic review retired");}

 private static JSONObject scope(String kind){
  JSONArray ids=new JSONArray();
  if(!kind.equals("reminders")&&!kind.equals("no-source"))
   ids.put(new JSONObject().put("id","1").put("revision",REV));
  if(kind.equals("duplicate"))ids.put(ids.getJSONObject(0));
  return new JSONObject().put("calendars",ids).put("reminders",!kind.equals("calendar")&&!kind.equals("no-source"))
   .put("timeZone",kind.equals("bad-zone")?"Bad/Zone":"America/Los_Angeles")
   .put("window","owner_day_and_overdue_reminders").put("modelEgress",!kind.equals("no-egress"))
   .put("maximumItems",kind.equals("small")?2:kind.equals("too-large")?201:12);
 }
 private static int scopeClass(JSONObject selected){
  if(selected.getJSONArray("calendars").isEmpty())return 1;
  if(!selected.getBoolean("reminders"))return 2;
  return selected.getInt("maximumItems")==2?3:4;
 }
 public static void calendarIdentities(JSONArray ids)throws Exception {
  if(ids.isEmpty())return;
  identityReads++;
  if(ids.length()!=1||!"1".equals(ids.getJSONObject(0).getString("id"))||!REV.equals(ids.getJSONObject(0).getString("revision")))
   throw new AssertionError("Calendar source identity changed at port boundary");
  Hold snapshot=held;if(snapshot!=null)snapshot.check("identity");
  if(calendarRevision!=1)throw new SecurityException("Synthetic Calendar source changed");
 }
 public static JSONArray calendarRows(JSONArray ids,String start,String end,int maximum,String startDate,String endDate)throws Exception {
  calendarReads++;
  if(ids.length()!=1||!"1".equals(ids.getJSONObject(0).getString("id"))
      ||!(maximum==2||maximum==12))throw new AssertionError("Calendar selected query differs");
  if(!startDate.equals("2026-03-08")||!endDate.equals("2026-03-09")
      ||!Instant.parse(start).equals(Instant.parse("2026-03-08T08:00:00Z"))
      ||!Instant.parse(end).equals(Instant.parse("2026-03-09T07:00:00Z")))
   throw new AssertionError("Calendar query did not retain exact 23-hour owner day");
  Hold snapshot=held;if(snapshot!=null)snapshot.check("calendar");
  if(profile.equals("calendar-many")){
   JSONArray rows=new JSONArray();
   for(int i=0;i<=maximum;i++)rows.put(new JSONObject().put("calendarId","1").put("title","synthetic"));
   return rows;
  }
  return new JSONArray().put(new JSONObject().put("calendarId","1")
   .put("title",profile.equals("bytes")?"x".repeat(66000):"Synthetic event"));
 }
 public static JSONArray reminderRows()throws Exception {
  reminderReads++;
  Hold snapshot=held;if(snapshot!=null)snapshot.check("reminders");
  long overdue=START-36*3600000L,done=START-3600000L,next=START+86400000L;
  return new JSONArray().put(reminder("overdue","scheduled",overdue))
   .put(reminder("today","scheduled",START))
   .put(reminder("done","completed",done).put("completedAt",done))
   .put(reminder("recurring","scheduled",next).put("history",new JSONArray()
    .put(new JSONObject().put("completedAt",done).put("dueAt",overdue))))
   .put(reminder("future","scheduled",next))
   .put(reminder("removed","cancelled",START))
   .put(reminder("undo","scheduled",START).put("pendingDeletion","synthetic-undo"))
   .put(reminder("undated","todo",START).put("undated",true));
 }
 private static JSONObject reminder(String id,String phase,long due){
  return new JSONObject().put("id",id).put("title","Synthetic "+id).put("body","Private synthetic body")
   .put("status",phase).put("dueAt",due).put("at",due-100);
 }

 private static JSONObject row(int identity,int id)throws Exception {
  String raw=slots.get(slot(identity,id));
  if(raw==null)return new JSONObject().put("present",false).put("revoked",false).put("integrity",true)
   .put("scope",0).put("reviewed",0).put("expiry",0);
  JSONObject stored=new JSONObject(raw);
  for(String field:binding(identity).keySet())if(!binding(identity).getString(field).equals(stored.getString(field)))
   throw new AssertionError("Grant has wrong identity in selected slot");
  JSONObject original=new JSONObject(raw);original.remove("revision");original.remove("revoked");
  boolean integrity=HostedResultNotices.hash(original.toString()).equals(stored.getString("revision"));
  return new JSONObject().put("present",true).put("revoked",stored.getBoolean("revoked")).put("integrity",integrity)
   .put("scope",scopeClass(stored.getJSONObject("scope"))).put("reviewed",revisionScopes.get(stored.getString("revision")))
   .put("expiry",Instant.parse(stored.getString("expiresAt")).toEpochMilli()-START);
 }
 private static JSONObject observe()throws Exception {
  JSONObject rows=new JSONObject();
  for(int identity=1;identity<=2;identity++)for(int id=1;id<=2;id++)rows.put(Integer.toString(identity*10+id),row(identity,id));
  JSONArray projected=new JSONArray();
  int events=0;
  JSONObject grant=new JSONObject().put("scope",0).put("expiry",0).put("revoked",false);
  if(returned!=null&&returned.has("scope")){
   if(returned.getInt("version")!=1||!"native".equals(returned.getString("provider"))
       ||!returned.getString("revision").matches("[a-f0-9]{64}"))throw new AssertionError("Unexpected grant result");
   grant.put("scope",scopeClass(returned.getJSONObject("scope")))
    .put("expiry",Instant.parse(returned.getString("expiresAt")).toEpochMilli()-START)
    .put("revoked",returned.getBoolean("revoked"));
  }
  if(returned!=null&&returned.has("events")){
   events=returned.getJSONArray("events").length();
   JSONArray reminders=returned.getJSONArray("reminders");
   for(int i=0;i<reminders.length();i++){
    JSONObject r=reminders.getJSONObject(i);
    if(!r.keySet().equals(Set.of("id","title","dueAt","status")))throw new AssertionError("Reminder projection exposed a private field");
    projected.put(r.getString("id"));
   }
   if(returned.toString().contains("Private synthetic body"))throw new AssertionError("Private body egress");
  }
  return Trace.fields("rows",rows,"owner",owner,"generation",generation,"now",now,"foreground",foreground,
   "transport",transport,"calendarRevision",calendarRevision,"calendarPermission",calendarPermission,
   "writes",writes,"calendarReads",calendarReads,"reminderReads",reminderReads,"restarts",restarts,
   "reply",reply,"requestKind",requestKind,"grantReply",grant,"events",events,"reminders",projected,
   "readOwner",readOwner,"readSource",readSource,"readGeneration",readGeneration,"readKind",readKind,"readProfile",readProfile,"readScope",readScope);
 }
 private static void consent(int id,String kind,long expiry,String faultMode,String address,boolean revoke)throws Exception {
  fault=faultMode;
  int expected=owner==0?1:owner;
  JSONObject who=binding(expected);
  String session="session-"+expected;
  if(address.equals("session"))session="stale-session";
  if(Set.of("owner","agent","install","enroll").contains(address))who.put(switch(address){
   case "owner" -> "ownerId";case "agent" -> "agentId";case "install" -> "installationId";default -> "enrollmentId";
  },"different");
  try {
   returned=host.consent(session,source(id),scope(kind),START+expiry,revoke,who,NativeDigestTraces::foregroundCheck);
   reply=revoke?"revoked":"approved";
  }catch(Exception denied){returned=null;reply="refused";}
  finally {fault="none";}
  requestKind=revoke?"revoke":"approve";
  trace.step("consent",observe(),id,kind,expiry,faultMode,address,revoke);
 }
 private static void approve(int id,String kind,long expiry)throws Exception {consent(id,kind,expiry,"none","exact",false);}
 private static void revoke(int id)throws Exception {consent(id,"both",0,"none","exact",true);}
 private static JSONObject request(int id,String kind,String address,long occurrence)throws Exception {
  int identity=owner==0?1:owner;
  String raw=slots.get(slot(identity,id));
  String revision=raw==null?REV:new JSONObject(raw).getString("revision");
  JSONObject value=binding(identity).put("provider","native").put("sourceId",source(id))
   .put("revision",revision).put("action",kind.equals("describe")?"describe":"read");
  if(!kind.equals("describe"))value.put("occurrence",Instant.ofEpochMilli(START+occurrence).toString());
  if(kind.equals("evening"))value.put("template","evening");
  if(kind.equals("explicit-morning"))value.put("template","morning");
  switch(address){
   case "owner" -> value.put("ownerId","other");
   case "agent" -> value.put("agentId","other");
   case "install" -> value.put("installationId","other");
   case "enroll" -> value.put("enrollmentId","other");
   case "revision" -> value.put("revision","b".repeat(64));
   case "extra" -> value.put("unknownField",true);
   case "provider" -> value.put("provider","cloud");
   default -> {}
  }
  return value;
 }
 private static void read(int id,String kind,String address,long occurrence,String portProfile)throws Exception {
  profile=portProfile;requestKind=kind;
  try {returned=host.read(request(id,kind,address,occurrence));reply=kind.equals("describe")?"described":"read";}
  catch(Exception denied){returned=null;reply=denied instanceof NativeDigestSources.SourceChanged?"changed":"refused";}
  trace.step("read",observe(),id,kind,address,occurrence,portProfile);
 }
 private static void holdRead(int id,String kind,String port)throws Exception {
  JSONObject exact=request(id,kind,"exact",now);
  held=new Hold(port);profile="normal";readOwner=owner;readSource=id;readGeneration=generation;readKind=kind;readProfile=port;
  readScope=row(owner,id).getInt("scope");
  pending=new FutureTask<>(()->host.read(exact));
  new Thread(pending).start();held.await();heldIdentityReads=identityReads;
  trace.step("holdRead",observe(),id,kind,port);
 }
 private static void finishRead()throws Exception {
  held.released.countDown();
  try {returned=pending.get(8,TimeUnit.SECONDS);reply=readKind.equals("describe")?"described":"read";}
  catch(ExecutionException failure){returned=null;reply=failure.getCause() instanceof NativeDigestSources.SourceChanged?"changed":"refused";}
  if(readKind.equals("describe")&&identityReads!=heldIdentityReads)throw new AssertionError("Describe re-queried Calendar");
  requestKind=readKind;held=null;pending=null;readOwner=0;readSource=0;readGeneration=0;readKind="none";readProfile="none";readScope=0;
  trace.step("finishRead",observe());
 }
 private static void environment(boolean front,boolean link,boolean permission,int revision)throws Exception {
  foreground=front;transport=link;calendarPermission=permission;calendarRevision=revision;
  trace.step("environment",observe(),front,link,permission,revision);
 }
 private static void connect(int next)throws Exception {owner=next;generation++;trace.step("connect",observe(),next);}
 private static void clock(long time)throws Exception {now=time;trace.step("clock",observe(),time);}
 private static void restart()throws Exception {host=new NativeDigestHost(context);restarts++;trace.step("restart",observe());}
 private static void corrupt(int id)throws Exception {
  String key=slot(owner,id);
  JSONObject row=new JSONObject(slots.get(key));
  row.getJSONObject("scope").put("maximumItems",2);
  slots.put(key,row.toString());
  trace.step("corrupt",observe(),id);
 }

 public static void main(String[] args)throws Exception {
  trace=new Trace(args[0],observe());
  try {
   switch(args[0]) {
    case "describe-revoked-held" -> {approve(1,"both",WEEK);holdRead(1,"describe","identity");revoke(1);finishRead();}
    case "describe-expired-held" -> {approve(1,"both",100);holdRead(1,"describe","identity");clock(100);finishRead();}
    case "consent" -> {
     approve(1,"both",WEEK);approve(1,"both",WEEK);approve(1,"reminders",WEEK);
     restart();read(1,"describe","exact",0,"normal");revoke(1);approve(1,"both",WEEK);
     read(1,"describe","exact",0,"normal");revoke(2);approve(2,"reminders",100);
    }
    case "scope-refusal" -> {
     for(String kind:List.of("no-source","no-egress","bad-zone","duplicate","too-large"))approve(1,kind,WEEK);
     approve(1,"both",0);approve(1,"both",WEEK+1);
     for(String address:List.of("owner","agent","install","enroll","session"))
      consent(1,"both",WEEK,"none",address,false);
     environment(false,true,true,1);approve(1,"both",WEEK);environment(true,false,true,1);approve(1,"both",WEEK);
     environment(true,true,true,2);approve(1,"both",WEEK);
     environment(true,true,true,1);approve(1,"both",WEEK);
    }
    case "storage" -> {
     consent(1,"both",WEEK,"before","exact",false);read(1,"describe","exact",0,"normal");
     consent(1,"both",WEEK,"after","exact",false);restart();read(1,"describe","exact",0,"normal");
     consent(2,"reminders",WEEK,"foreground-after","exact",false);
     read(2,"morning","exact",0,"normal");
     environment(true,true,true,1);
     consent(1,"both",0,"before","exact",true);read(1,"describe","exact",0,"normal");
     consent(1,"both",0,"after","exact",true);read(1,"describe","exact",0,"normal");
    }
    case "exact-owner" -> {
     approve(1,"both",WEEK);
     for(String address:List.of("owner","agent","install","enroll","revision","extra","provider"))
      read(1,"morning",address,0,"normal");
     connect(2);read(1,"describe","exact",0,"normal");approve(1,"reminders",WEEK);
     read(1,"morning","exact",0,"normal");connect(1);read(1,"morning","exact",0,"normal");
     corrupt(1);read(1,"describe","exact",0,"normal");
    }
    case "projection" -> {
     approve(1,"both",WEEK);read(1,"morning","exact",0,"normal");read(1,"evening","exact",0,"normal");
     read(1,"explicit-morning","exact",0,"normal");read(1,"morning","exact",-2100000,"normal");
     read(1,"morning","exact",-2100001,"normal");read(1,"morning","exact",120000,"normal");
     read(1,"morning","exact",120001,"normal");
     environment(false,true,false,1);read(1,"morning","exact",0,"normal");
    }
    case "bounds" -> {
     approve(1,"both",WEEK);approve(2,"small",WEEK);read(1,"morning","exact",0,"calendar-many");
     read(1,"morning","exact",0,"bytes");read(2,"morning","exact",0,"normal");
    }
    case "reminders-only" -> {
     environment(true,true,false,2);approve(1,"reminders",WEEK);
     read(1,"morning","exact",0,"normal");read(1,"evening","exact",0,"normal");
     holdRead(1,"morning","reminders");revoke(1);finishRead();
    }
    case "calendar-only" -> {
     approve(1,"calendar",WEEK);read(1,"morning","exact",0,"normal");
     holdRead(1,"morning","calendar");environment(true,true,false,1);finishRead();
    }
    case "read-revoked" -> {approve(1,"both",WEEK);holdRead(1,"morning","calendar");revoke(1);finishRead();}
    case "read-expired" -> {approve(1,"both",100);holdRead(1,"morning","calendar");clock(100);finishRead();}
    case "read-calendar-changed" -> {approve(1,"both",WEEK);holdRead(1,"morning","calendar");environment(true,true,true,2);finishRead();}
    case "read-owner-retired" -> {approve(1,"both",WEEK);holdRead(1,"morning","calendar");connect(2);finishRead();}
    case "read-transport-retired" -> {approve(1,"both",WEEK);holdRead(1,"evening","calendar");environment(true,false,true,1);finishRead();}
    default -> throw new AssertionError(args[0]);
   }
   java.lang.System.out.println(trace.value);
  } finally {if(held!=null)held.released.countDown();}
 }
}
