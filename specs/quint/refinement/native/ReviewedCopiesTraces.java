package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.media.ReviewedFileHandoff;
import android.content.Context;
import android.net.Uri;
import java.io.File;
import java.io.FileNotFoundException;
import java.nio.file.Files;
import java.nio.file.attribute.FileTime;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** Actual cache and provider source with real host files and an observed URI grant port. */
public final class ReviewedCopiesTraces {
 private static final String FOLDER="mail-attachments",AUTHORITY="ai.elizaresearch.alphaphone.mailattachments";
 private static final int LIMIT=5;
 private static void check(boolean ok,String label){if(!ok)throw new AssertionError(label);}
 private static void await(CountDownLatch gate){
  try{check(gate.await(5,TimeUnit.SECONDS),"timeout waiting for file schedule");}
  catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw new AssertionError(interrupted);}
 }
 private static Thread start(FutureTask<?> task){
  Thread thread=new Thread(task,"reviewed-copy-trace");thread.setDaemon(true);thread.start();return thread;
 }
 private static void requireBlocked(Thread thread,FutureTask<?> task){
  long limit=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
  while(thread.getState()!=Thread.State.BLOCKED&&!task.isDone()&&System.nanoTime()<limit)Thread.yield();
  check(thread.getState()==Thread.State.BLOCKED,"another operation crossed the held sweep lock");
 }
 private static JSONObject collection(String kind,String key,JSONArray values){
  return new JSONObject().put("quintCollection",kind).put(key,values);
 }

 private static final class Fixture implements AutoCloseable {
  final File root,folder;
  final long now=System.currentTimeMillis();
  final ReviewedCopies main,peer;
  final ReviewedFileHandoff mainHandoff;
  final AlphaMailFileProvider provider=new AlphaMailFileProvider();
  final Map<Integer,File> files=new HashMap<>();
  final Map<Integer,Integer> revoked=new HashMap<>();
  int unreturnedFile;
  String lastWrite="none",lastOpen="none";
  final Trace trace;
  Fixture(String name)throws Exception{
   root=Files.createTempDirectory("reviewed-copy-trace").toFile();folder=new File(root,FOLDER);
   check(folder.mkdir(),"create fixture cache");
   Context mainContext=new Context(root,uri->revoked(1,uri));
   mainHandoff=new ReviewedFileHandoff(mainContext,AUTHORITY,FOLDER,FOLDER);
   ReviewedFileHandoff peerHandoff=new ReviewedFileHandoff(new Context(root,uri->revoked(2,uri)),AUTHORITY,FOLDER,FOLDER);
   main=new ReviewedCopies(mainHandoff::revoke);peer=new ReviewedCopies(peerHandoff::revoke);
   provider.attachForFixture(mainContext);trace=new Trace(name,observe());
  }
  void revoked(int owner,Uri uri){
   check(AUTHORITY.equals(uri.getAuthority())&&uri.getPathSegments().size()==2&&FOLDER.equals(uri.getPathSegments().get(0)),"exact installed URI path and authority");
   File file=new File(folder,uri.getLastPathSegment());
   Integer id=files.entrySet().stream().filter(entry->entry.getValue().equals(file)).map(Map.Entry::getKey).findFirst().orElse(null);
   if(id==null&&unreturnedFile!=0){id=unreturnedFile;files.put(id,file);}
   check(id!=null,"revocation addressed an unobserved file");
   check(revoked.put(id,owner)==null,"a revoked path was dispatched again");
  }
  @SuppressWarnings("unchecked") JSONObject observe()throws Exception{
   Map<File,Object> live=(Map<File,Object>)Trace.read(main,"live");
   JSONArray present=new JSONArray(),owners=new JSONArray(),revokes=new JSONArray(),writing=new JSONArray();
   for(int id=1;id<=LIMIT;id++){
    File file=files.get(id);
    if(file!=null&&file.isFile())present.put(id);
    Object entry=live.get(file);
    int owner=0;
    if(entry!=null){
     Object actual=Trace.read(entry,"owner");
     check(actual==main||actual==peer,"unobserved copy owner");
     owner=actual==main?1:2;
     if((boolean)Trace.read(entry,"writing"))writing.put(id);
    }
    owners.put(new JSONArray().put(id).put(owner));
    revokes.put(new JSONArray().put(id).put(revoked.getOrDefault(id,0)));
   }
   return Trace.fields("swept",Trace.read(main,"swept"),"present",collection("set","values",present),
     "owners",collection("map","entries",owners),"revokedBy",collection("map","entries",revokes),
     "lastWrite",lastWrite,"lastOpen",lastOpen).put("writing",collection("set","values",writing));
  }
  File file(int id){return files.get(id);}
  ReviewedCopies owner(int owner){return owner==1?main:peer;}
  void timestamp(int id,String age)throws Exception{
   long timestamp=switch(age){
    case "boundary" -> now-ReviewedCopies.GRANT_MILLIS;
    case "older" -> now-ReviewedCopies.GRANT_MILLIS-60_000;
    case "future" -> now+60_000;
    default -> now-1_000;
   };
   Files.setLastModifiedTime(file(id).toPath(),FileTime.fromMillis(timestamp));
   check(file(id).lastModified()==timestamp,"fixture clock must reach exact file timestamp");
  }
  void abandon(int id,String age)throws Exception{
   File file=new File(folder,"leftover-"+id+".txt");
   Files.write(file.toPath(),new byte[]{(byte)id});files.put(id,file);timestamp(id,age);
   trace.step("abandon",observe(),id,age);
  }
  void age(int id,String age)throws Exception{timestamp(id,age);trace.step("changeAge",observe(),id,age);}
  File writeFile(int owner,int id)throws Exception{return owner(owner).write(folder,"copy-"+id+".txt",new byte[]{(byte)id});}
  void recordWrite(int owner,int id,File file,JSONObject... before)throws Exception{
   check(Arrays.equals(Files.readAllBytes(file.toPath()),new byte[]{(byte)id}),"published bytes must match the reviewed input");
   check(file.getParentFile().equals(folder)&&file.getName().endsWith("-copy-"+id+".txt"),"retain installed flat file path and filename");
   files.put(id,file);timestamp(id,"fresh");lastWrite="written";
   JSONObject[] actions=Arrays.copyOf(before,before.length+2);
   actions[before.length]=Trace.action("beginWrite",owner,id);
   actions[before.length+1]=Trace.action("finishWrite",id,true);
   trace.macro("write and sync returns exact bytes with live ownership",observe(),actions);
  }
  void write(int owner,int id)throws Exception{recordWrite(owner,id,writeFile(owner,id));}
  void sweep(int owner,File target,boolean listed)throws Exception{
   owner(owner).sweep(target,now);
   trace.macro(listed?"actual directory sweep":"directory listing is unavailable",observe(),
      Trace.action("beginSweep",owner),Trace.action("finishSweep",listed));
  }
  void revoke(int owner,int id)throws Exception{owner(owner).revoke(file(id));trace.step("revoke",observe(),owner,id);}
  void clear(int owner)throws Exception{owner(owner).clear();trace.step("clear",observe(),owner);}
  void open(int id,boolean readOnly,boolean shape,boolean expected)throws Exception{
   Uri uri=shape?mainHandoff.uri(file(id)):new Uri(AUTHORITY,List.of("other-path",file(id).getName()));
   boolean opened=false;
   try(var descriptor=provider.openFile(uri,readOnly?"r":"rw")){
    check(Arrays.equals(descriptor.readAllBytes(),new byte[]{(byte)id}),"opened bytes differ");opened=true;
   }catch(FileNotFoundException unavailable){/* expected provider refusal is observed below */}
   check(opened==expected,"unexpected provider admission");lastOpen=opened?"opened":"denied";
   trace.step("providerOpen",observe(),id,readOnly,shape);
  }
  void blocked(String label,String action,Object... args)throws Exception{
   trace.steps.put(new JSONObject().put("label",label).put("expect",observe())
     .put("action",Trace.action(action,args).put("reject",true)));
  }
  @Override public void close()throws Exception{
   try(var walk=Files.walk(root.toPath())){for(var path:walk.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(path);}
  }
 }

 private static File holdList(File folder,CountDownLatch reached,CountDownLatch release,Object lock){
  return new File(folder.getPath()){
   @Override public File[] listFiles(){
    check(Thread.holdsLock(lock),"the actual registry lock must cover listing");
    reached.countDown();await(release);return super.listFiles();
   }
  };
 }

 private static void concurrent(Fixture f,boolean peerLoads)throws Exception{
  f.abandon(1,"fresh");
  Object lock=Trace.read(f.main,"LOCK");
  CountDownLatch listed=new CountDownLatch(1),continueFirst=new CountDownLatch(1);
  File held=holdList(f.folder,listed,continueFirst,lock);
  FutureTask<Void> first=new FutureTask<>(()->{f.main.sweep(held,f.now);return null;});
  start(first);
  try{
   await(listed);
   f.trace.step("beginSweep",f.observe().put("s.sweeper",1),1);
   if(peerLoads){
    CountDownLatch peerListing=new CountDownLatch(1),continuePeer=new CountDownLatch(1);
    File peerHeld=holdList(f.folder,peerListing,continuePeer,lock);
    FutureTask<Void> second=new FutureTask<>(()->{f.peer.sweep(peerHeld,f.now);return null;});
    Thread thread=start(second);
    try{
     requireBlocked(thread,second);f.blocked("second load waits for the first sweep", "beginSweep",2);
     continueFirst.countDown();first.get(5,TimeUnit.SECONDS);await(peerListing);
     f.trace.macro("first sweep finishes before the peer takes the registry",f.observe().put("s.sweeper",2),
       Trace.action("finishSweep",true),Trace.action("beginSweep",2));
    }finally{continuePeer.countDown();}
    second.get(5,TimeUnit.SECONDS);f.trace.step("finishSweep",f.observe(),true);
    f.write(2,2);
   }else{
    FutureTask<File> second=new FutureTask<>(()->f.writeFile(2,2));
    Thread thread=start(second);
    requireBlocked(thread,second);f.blocked("new file registration waits for the first sweep", "beginWrite",2,2);
    continueFirst.countDown();first.get(5,TimeUnit.SECONDS);
    f.recordWrite(2,2,second.get(5,TimeUnit.SECONDS),Trace.action("finishSweep",true));
   }
   check(!f.file(1).exists()&&f.file(2).isFile(),"first sweep purges only abandoned files");
  }finally{continueFirst.countDown();}
 }

 public static void main(String[] args)throws Exception{
  try(Fixture f=new Fixture(args[0])){
   switch(args[0]){
    case "concurrent-load" -> concurrent(f,true);
    case "concurrent-write" -> concurrent(f,false);
    case "retry-first-sweep" -> {
     f.abandon(1,"fresh");f.sweep(1,new File(f.folder,"missing"),false);f.write(2,2);f.sweep(1,f.folder,true);
     check(!f.file(1).exists()&&f.file(2).isFile(),"retry must preserve a copy admitted before the first successful list");
    }
    case "owner-cancel" -> {
     f.sweep(1,f.folder,true);f.write(1,1);f.write(2,2);f.write(1,3);
     f.revoke(1,2);f.clear(1);f.revoke(1,1);
     check(f.file(2).isFile()&&f.revoked.equals(Map.of(1,1,3,1)),"cancel and stale timer preserve a live peer copy");
     f.revoke(2,2);f.clear(2);
    }
    case "expiry" -> {
     f.sweep(1,f.folder,true);f.abandon(1,"boundary");f.abandon(2,"fresh");f.write(1,3);f.write(2,4);
     f.age(3,"boundary");f.sweep(1,f.folder,true);f.sweep(2,f.folder,true);f.revoke(1,3);
     check(!f.file(1).exists()&&f.file(2).isFile()&&!f.file(3).exists()&&f.file(4).isFile(),"only eligible aged files expire");
    }
    case "provider" -> {
     f.write(1,1);f.open(1,false,true,false);f.open(1,true,false,false);f.open(1,true,true,true);
     f.age(1,"older");f.open(1,true,true,false);f.revoke(1,1);
     f.write(2,2);f.age(2,"future");f.open(2,true,true,false);f.clear(2);
    }
    case "failed-write" -> {
     try{f.main.write(f.folder,"../escape.txt",new byte[]{1});throw new AssertionError("unsafe name was accepted");}
     catch(IllegalArgumentException expected){check(f.folder.listFiles().length==0,"invalid name left a file");}
     f.trace.stutter("invalid name is refused before reserving a path",f.observe());
     f.unreturnedFile=1;
     try{f.main.write(f.folder,"fault.txt",null);throw new AssertionError("write fault did not propagate");}
     catch(NullPointerException expected){f.lastWrite="failed";}
     f.unreturnedFile=0;
     check(!f.file(1).exists(),"failed output does not leave a cache file");
     f.trace.macro("failed byte write retires the reserved path",f.observe(),
       Trace.action("beginWrite",1,1),Trace.action("finishWrite",1,false));
     f.write(2,2);
    }
    default -> throw new AssertionError("unknown trace");
   }
   System.out.println(f.trace.value);
  }
 }
}
