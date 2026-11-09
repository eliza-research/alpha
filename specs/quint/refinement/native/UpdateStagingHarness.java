package ai.alphacompute.alphaphone;

import android.content.Context;
import android.os.Build;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.net.URLConnection;
import java.net.URLStreamHandler;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.cert.Certificate;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

/** Exact updater code with synthetic HTTPS, archive readback and installer ports. */
public final class UpdateStagingHarness {
 private static final byte[] APK = {1, 2, 3, 4};
 private static final List<Response> connections = new CopyOnWriteArrayList<>();
 private static int status = 200;
 private static byte[] body = APK;
 private static Gate heldRead;

 private static final class Gate implements Runnable {
  final CountDownLatch entered = new CountDownLatch(1), released = new CountDownLatch(1);
  @Override public void run() {
   entered.countDown();
   long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
   boolean interrupted=false;
   while(released.getCount()>0 && System.nanoTime()<deadline) try {
    released.await(10,TimeUnit.MILLISECONDS);
   } catch(InterruptedException stopped) {interrupted=true;}
   if(interrupted)Thread.currentThread().interrupt();
   require(released.getCount()==0,"fixture gate was not released");
  }
  void await() throws Exception {require(entered.await(10,TimeUnit.SECONDS),"source did not reach gate");}
  void open(){released.countDown();}
 }

 private static final class Response extends HttpsURLConnection {
  final AtomicBoolean closed = new AtomicBoolean();
  final CountDownLatch disconnected = new CountDownLatch(1);
  Response(URL url){super(url);connections.add(this);}
  @Override public int getResponseCode(){return status;}
  @Override public InputStream getInputStream(){
   byte[] answer=body;
   Gate gate=heldRead;
   if(gate==null)return new ByteArrayInputStream(answer);
   return new InputStream(){
    int at;
    @Override public int read(){throw new AssertionError("updater reads whole buffers");}
    @Override public int read(byte[] buffer,int offset,int length)throws IOException{
     if(at==2){gate.run();if(closed.get())throw new IOException("controlled socket closed");}
     if(at==answer.length)return -1;
     int count=Math.min(2,answer.length-at);
     System.arraycopy(answer,at,buffer,offset,count);at+=count;return count;
    }
   };
  }
  @Override public void connect(){}
  @Override public void disconnect(){closed.set(true);disconnected.countDown();}
  @Override public boolean usingProxy(){return false;}
  @Override public String getCipherSuite(){return "";}
  @Override public Certificate[] getLocalCertificates(){return new Certificate[0];}
  @Override public Certificate[] getServerCertificates(){return new Certificate[0];}
 }

 private final Context context;
 private final Path cache, apk;
 private final JSONObject offer;
 private final Map<Integer,AlphaDevicePlugin> bridges = new TreeMap<>();
 private final Map<Integer,ByteArrayOutputStream> copies = new TreeMap<>();
 private final Gate archive = new Gate(), stage = new Gate();
 private final Trace trace;
 private final PluginCall[] calls = new PluginCall[4];
 private int owner;
 private String phase="idle", outcome="none";

 private UpdateStagingHarness(String mode, Path cache, JSONObject offer)throws Exception{
  this.cache=cache;this.offer=offer;apk=cache.resolve("alpha-update.apk");
  context=UpdateFlowTest.installing(cache.toFile());
  AlphaDevicePlugin.UpdatePause.configure(context);
  context.packages.archiveRead=archive;
  context.packages.installer.staging=stage;
  context.packages.installer.stagedOutput=id->{
   var sink=new ByteArrayOutputStream();copies.put(id,sink);return sink;
  };
  // Stop at the first actual renderer preparation event. No fixture takes an install past this boundary.
  Plugin.ready=(plugin,request)->((AlphaDevicePlugin)plugin).activateUpdate(new PluginCall(request.put("ready",false)));
  trace=new Trace(mode,observe());
 }

 private static void require(boolean value,String reason){if(!value)throw new AssertionError(reason);}
 private static Object staticField(String name)throws Exception{
  var field=AlphaDevicePlugin.class.getDeclaredField(name);field.setAccessible(true);return field.get(null);
 }
 private static String sha(byte[] bytes)throws Exception{
  return AlphaDevicePlugin.hex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
 }
 private JSONObject observe()throws Exception{
  var installer=context.packages.installer;
  require(installer.committed.isEmpty()&&AlphaLocalAgentPlugin.stops==0,"pre-activation fixture cannot commit or stop resident");
  boolean busy=((AtomicBoolean)staticField("updating")).get();
  require(busy==(owner!=0),"process guard and observed cache owner agree");
  boolean present=Files.exists(apk);
  int bytes=present?Math.toIntExact(Files.size(apk)):0;
  boolean verified=phase.equals("verified")||phase.equals("staged")||(phase.equals("retiring")&&bytes==APK.length);
  if(verified)require(sha(Files.readAllBytes(apk)).equals(offer.getString("sha256")),"verified cache bytes equal the reviewed digest");
  String file=!present?"absent":owner==0?"orphan":verified?"verified":"partial";
  String session=installer.sessions.isEmpty()?"none":owner==0?"left":"staged";
  int stagedBytes=installer.sessions.isEmpty()?0:copies.get(installer.sessions.get(0)).size();
  boolean connected=connections.stream().anyMatch(connection->!connection.closed.get());
  if(connected){
   require(owner!=0 && connections.stream().anyMatch(connection->{
    try{return !connection.closed.get()&&Trace.read(bridges.get(owner),"updateActive")==connection;}
    catch(Exception missing){throw new IllegalStateException(missing);}
   }),"only the exact owner holds the connection");
  }
  return Trace.fields("owner",owner,"target",owner==0?0:1,"phase",phase,"file",file,"bytes",bytes,
   "session",session,"stagedBytes",stagedBytes,"connected",connected,"fetches",connections.size(),
   "created",installer.internals.size(),"abandoned",installer.abandoned.size(),"outcome",outcome);
 }

 private void register(int id)throws Exception{
  bridges.put(id,UpdateFlowTest.bridge(context,Lifecycle.State.RESUMED));
 }
 private PluginCall payload(){
  return new PluginCall(new JSObject().put("apkUrl",offer.getString("apkUrl")).put("sha256",offer.getString("sha256"))
    .put("sizeBytes",offer.getLong("sizeBytes")).put("versionCode",offer.getLong("versionCode")));
 }
 private void tap(int id){calls[id]=payload();bridges.get(id).installUpdate(calls[id]);}
 private void answer(int id,boolean success)throws Exception{
  calls[id].awaitAnswer();
  require(calls[id].resolved.get()==(success?1:0)&&calls[id].rejected.get()==(success?0:1),"tap settlement");
 }
 private void start()throws Exception{start(1);}
 private void start(int bridge)throws Exception{
  int previous=connections.size();
  heldRead=new Gate();tap(bridge);heldRead.await();
  require(connections.size()==previous+1&&connections.get(previous).getURL().toString().equals(offer.getString("apkUrl")),"exact renderer URL used");
  owner=bridge;phase="copying";outcome="none";
  trace.macro("first two bytes written by the owner; next body read held",observe(),Trace.action("tap",bridge,true),Trace.action("chunk",2));
 }
 private void verified()throws Exception{
  heldRead.open();archive.await();
  phase="verified";
  trace.macro("exact byte count and digest passed before archive readback",observe(),Trace.action("chunk",2),Trace.action("verify",true,false));
 }
 private void staged()throws Exception{
  archive.open();stage.await();
  var sessions=context.packages.installer.sessions;
  require(sessions.size()==1&&Arrays.equals(copies.get(sessions.get(0)).toByteArray(),APK),"installer sink received exact verified bytes");
  phase="staged";trace.step("stage",observe(),true);
 }
 private void settled(String reason,boolean deleted,boolean abandoned)throws Exception{
  answer(owner,false);owner=0;phase="idle";outcome=reason;
  require(Files.exists(apk)!=deleted,"cache deletion outcome");
  trace.step("settle",observe(),reason,deleted,abandoned);
 }

 private JSONObject run(String mode)throws Exception{
  register(1);
  require(AlphaDevicePlugin.appSigner(context).equals(offer.getString("signer")),"renderer fixture used actual synthetic signing lineage");
  switch(mode){
   case "permission-only":
    context.packages.installsAllowed=false;
    tap(1);answer(1,true);outcome="settings";
    var activities=bridges.get(1).activity.started;
    require(activities.size()==1&&android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES.equals(activities.get(0).getAction()),
      "permission page alone opened");
    trace.step("tap",observe(),1,false);
    break;
   case "busy-peer-and-exact-staged-copy":
    start();register(2);trace.step("loadBridge",observe(),false);
    tap(2);answer(2,true);outcome="quiet";trace.step("tap",observe(),2,true);
    bridges.get(2).handleOnDestroy();trace.step("retireBridge",observe(),2);
    verified();staged();stage.open();settled("barrier",true,true);
    break;
   case "owner-destroy-during-download":
    start();bridges.get(1).handleOnDestroy();phase="retiring";
    trace.step("retireBridge",observe(),1);
    heldRead.open();settled("retired",true,true);
    register(2);trace.step("loadBridge",observe(),true);
    start(2);verified();staged();stage.open();settled("barrier",true,true);
    break;
   case "owner-destroy-during-archive-read":
    start();verified();bridges.get(1).handleOnDestroy();phase="retiring";
    trace.step("retireBridge",observe(),1);
    archive.open();settled("retired",true,true);
    break;
   case "same-size-corrupt-body":
    body=new byte[]{1,2,3,5};start();heldRead.open();
    // Both chunks were written, but a matching byte count is insufficient.
    answer(1,false);owner=0;phase="idle";outcome="download";
    trace.macro("same-size wrong SHA-256 refuses before archive",observe(),Trace.action("chunk",2),Trace.action("settle","download",true,true));
    break;
   case "wrong-archive-version":
   case "wrong-archive-package":
   case "wrong-archive-flavor":
   case "wrong-archive-signer":
    var info=context.packages.archive;
    switch(mode){
     case "wrong-archive-version":info.versionCode=9;break;
     case "wrong-archive-package":info.packageName="fixture.other";break;
     case "wrong-archive-flavor":info.requestedPermissions=new String[]{"android.permission.INTERNET"};break;
     default:
      var different=new android.content.pm.Signature(new byte[]{8});
      info.signingInfo=new android.content.pm.SigningInfo(
        new android.content.pm.Signature[]{different},new android.content.pm.Signature[]{different});
    }
    start();verified();archive.open();settled("archive",true,true);
    break;
   case "abandon-refused":
    context.packages.installer.abandonDown=true;
    start();verified();staged();stage.open();settled("barrier",true,false);
    break;
   case "stale-cache-sweep":
    Files.write(apk,APK);trace.step("findOrphan",observe(),APK.length);
    register(2);trace.step("loadBridge",observe(),true);
    break;
   case "cache-delete-refused":
    context.packages.archive.versionCode=9;start();verified();
    if(!Files.getFileStore(cache).supportsFileAttributeView("posix"))
     return new JSONObject().put("skip","POSIX cache permissions unavailable");
    Files.setPosixFilePermissions(cache,PosixFilePermissions.fromString("r-x------"));
    try{
     if(Files.isWritable(cache))return new JSONObject().put("skip","host bypasses POSIX cache deletion refusal");
     archive.open();settled("archive",false,true);
     register(2);trace.step("loadBridge",observe(),false);
    }finally{Files.setPosixFilePermissions(cache,PosixFilePermissions.fromString("rwx------"));}
    register(3);trace.step("loadBridge",observe(),true);
    break;
   default:throw new IllegalArgumentException(mode);
  }
  return new JSONObject().put("trace",trace.value);
 }

 private static JSONObject manifest(Path cache,int code,String text)throws Exception{
  Context context=UpdateFlowTest.installing(cache.toFile());
  AlphaDevicePlugin bridge=UpdateFlowTest.bridge(context,Lifecycle.State.RESUMED);
  try{
   status=code;body=text.getBytes(java.nio.charset.StandardCharsets.UTF_8);
   var call=new PluginCall(new JSObject());bridge.checkForUpdate(call);call.awaitAnswer();
   require(connections.size()==1,"native check used one synthetic URL");
   require(connections.get(0).disconnected.await(10,TimeUnit.SECONDS),"native check closes its own connection");
   require(connections.get(0).getURL().toString().equals(BuildConfig.ALPHA_UPDATE_MANIFEST_URL),"native check used configured manifest");
   return new JSONObject().put("resolved",call.resolved.get()==1)
    .put("manifest",call.result==null?JSONObject.NULL:java.util.Objects.requireNonNullElse(call.result.opt("manifest"),JSONObject.NULL));
  }finally{UpdateFlowTest.retireFixtureWorkers();erase(context.data.toPath());}
 }

 private static JSONObject deadline()throws Exception{
  boolean[] lateEof={false,true};
  var result=new JSONObject();
  for(boolean eof:lateEof){
   long limit=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(500);
   InputStream in=new InputStream(){
    int reads;
    @Override public int read(){throw new AssertionError("whole buffer expected");}
    @Override public int read(byte[] bytes,int offset,int length)throws IOException{
     if(reads++==0){System.arraycopy(APK,0,bytes,offset,eof?4:2);return eof?4:2;}
     while(System.nanoTime()<limit)java.util.concurrent.locks.LockSupport.parkNanos(1_000_000L);
     if(eof)return -1;
     System.arraycopy(APK,2,bytes,offset,2);return 2;
    }
   };
   var copied=new ByteArrayOutputStream();
   boolean verified;
   try{AlphaDevicePlugin.copyVerified(in,copied,APK.length,sha(APK),limit);verified=true;}
   catch(IOException expired){require("Update took too long".equals(expired.getMessage()),"exact expiry outcome");verified=false;}
   result.put(eof?"lateEof":"lateBody",new JSONObject().put("verified",verified).put("bytes",copied.size()));
  }
  return result;
 }

 private void close()throws Exception{
  if(heldRead!=null)heldRead.open();archive.open();stage.open();
  UpdateFlowTest.retireFixtureWorkers();erase(context.data.toPath());
 }
 private static void erase(Path path)throws Exception{
  try(var files=Files.walk(path)){
   for(Path child:files.sorted(Comparator.reverseOrder()).toArray(Path[]::new))Files.delete(child);
  }
 }
 public static void main(String[] args)throws Exception{
  if(args[0].equals("deadline")){System.out.println(deadline());return;}
  URL.setURLStreamHandlerFactory(protocol->!protocol.equals("https")?null:new URLStreamHandler(){
   @Override protected URLConnection openConnection(URL url){return new Response(url);}
  });
  Path cache=Files.createTempDirectory("quint-update-staging");
  try{
   if(args[0].equals("manifest"))System.out.println(manifest(cache,Integer.parseInt(args[1]),args[2]));
   else{
    var fixture=new UpdateStagingHarness(args[0],cache,new JSONObject(args[1]));
    try{System.out.println(fixture.run(args[0]));}finally{fixture.close();}
   }
  }finally{erase(cache);}
 }
}
