package ai.alphacompute.alphaphone;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import ai.eliza.plugins.agent.updater.RuntimeUpdatePause;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.AccessDeniedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.util.Comparator;
import java.util.concurrent.atomic.AtomicReference;

public final class RuntimeUpdatePauseTraces {
 private static final String OWNER="00000000-0000-4000-8000-000000000001";
 private static final String FOREIGN="00000000-0000-4000-8000-000000000002";
 private static final int SESSION=41;
 private static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
 private static JSONObject defaults(){
  return new JSONObject().put("session","absent").put("zero",true).put("boot",1).put("sdk",37)
   .put("releaseBuild",true).put("installedCode",7).put("installedDigest","base")
   .put("signer","trusted").put("confirmed",true);
 }
 private static JSONObject successor(){
  return defaults().put("session","sealed").put("installedCode",8).put("installedDigest","target");
 }
 private static String signer(int certificate)throws Exception{
  return AlphaDevicePlugin.hex(MessageDigest.getInstance("SHA-256").digest(new byte[]{(byte)certificate}));
 }
 private static final class PortContext extends Context {
  private final Path directory;
  private Path installed;
  PortContext(Path root){super(root.toFile());directory=root;}
  @Override public File getNoBackupFilesDir(){return directory.toFile();}
  @Override public ApplicationInfo getApplicationInfo(){var result=new ApplicationInfo();result.sourceDir=installed.toString();return result;}
 }
 private static void erase(Path directory)throws IOException{
  try(var walk=Files.walk(directory)){
   for(Path path:(Iterable<Path>)walk.sorted(Comparator.reverseOrder())::iterator)Files.deleteIfExists(path);
  }
 }

 private static final class Fixture implements AutoCloseable {
  final Path root,journal;
  final PortContext context;
  final PackageInstaller installer;
  final String expectedSigner,otherSigner,baseDigest,targetDigest,otherDigest;
  final int generation;
  JSONObject inputs;
  String outcome="configured";
  boolean syncDenied;
  Trace trace;

  Fixture(Path root,int generation,int code,String executing,JSONObject observation)throws Exception{
   this.root=root;this.generation=generation;
   Files.createDirectories(root);
   for(String label:new String[]{"base","target","other"}){
    Path file=root.resolve(label+".apk");
    if(!Files.exists(file))Files.writeString(file,"Synthetic APK "+label,StandardOpenOption.CREATE_NEW);
   }
   baseDigest=AlphaDevicePlugin.UpdatePause.digest(root.resolve("base.apk").toString());
   targetDigest=AlphaDevicePlugin.UpdatePause.digest(root.resolve("target.apk").toString());
   otherDigest=AlphaDevicePlugin.UpdatePause.digest(root.resolve("other.apk").toString());
   expectedSigner=signer(7);otherSigner=signer(8);
   context=new PortContext(root);installer=context.packages.installer;
   journal=root.resolve("app-update-pause");
   check(installer.createSession(new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL))==SESSION,
    "fixture knows its synthetic session ID");
   BuildConfig.VERSION_CODE=code;
   setEvidence(observation);
   context.installed=root.resolve(executing+".apk");
   AlphaDevicePlugin.UpdatePause.configure(context);
   // The fixture holds distinct installed and executing paths in one old process.
   context.installed=root.resolve(observation.getString("installedDigest")+".apk");
  }
  void begin(String name)throws Exception{trace=new Trace(name,state());}
  private String digest(String hash){
   if(baseDigest.equals(hash))return "base";
   if(targetDigest.equals(hash))return "target";
   if(otherDigest.equals(hash))return "other";
   throw new AssertionError("Unknown synthetic APK digest");
  }
  private String signing(String hash){
   if(expectedSigner.equals(hash))return "trusted";
   if(otherSigner.equals(hash))return "other";
   throw new AssertionError("Unknown synthetic signer");
  }
  private String binding(){
   return "alpha-update://"+context.getPackageName()+"/8/"+targetDigest+"/"+expectedSigner+"/1/intent";
  }
  private void setEvidence(JSONObject evidence){
   inputs=evidence;
   Build.VERSION.SDK_INT=evidence.getInt("sdk");
   Build.VERSION.CODENAME=evidence.getBoolean("releaseBuild")?"REL":"TEST";
   Settings.Global.bootCount=evidence.getInt("boot");
   context.packages.installed.versionCode=evidence.getInt("installedCode");
   context.installed=root.resolve(evidence.getString("installedDigest")+".apk");
   Signature signature=new Signature(new byte[]{(byte)("trusted".equals(evidence.getString("signer"))?7:8)});
   context.packages.installed.signingInfo=new SigningInfo(new Signature[]{signature},new Signature[]{signature});
   AlphaLocalAgentPlugin.confirmed=evidence.getBoolean("confirmed");
   String session=evidence.getString("session");
   installer.sessions.clear();
   if(!"absent".equals(session))installer.sessions.add(SESSION);
   installer.infoDown="unavailable".equals(session);
   var info=installer.internals.get(SESSION);
   info.referrer=Uri.parse("foreign".equals(session)?"alpha-update://other/invalid":binding());
   info.sealed="sealed".equals(session);
   info.progress=evidence.getBoolean("zero")?0f:0.8f;
  }
  private JSONObject evidence()throws Exception{
   String session;boolean zero=inputs.getBoolean("zero");
   try{
    var info=installer.getSessionInfo(SESSION);
    session=info==null?"absent":info.isSealed()?"sealed":binding().equals(String.valueOf(info.getReferrerUri()))?"bound":"foreign";
    if(info!=null)zero=info.getProgress()==0f;
   }catch(RuntimeException unavailable){session="unavailable";}
   return new JSONObject().put("session",session).put("zero",zero).put("boot",Settings.Global.bootCount)
    .put("sdk",Build.VERSION.SDK_INT).put("releaseBuild","REL".equals(Build.VERSION.CODENAME))
    .put("installedCode",context.packages.installed.getLongVersionCode())
    .put("installedDigest",digest(AlphaDevicePlugin.UpdatePause.digest(context.getApplicationInfo().sourceDir)))
    .put("signer",signing(AlphaDevicePlugin.appSigner(context))).put("confirmed",AlphaLocalAgentPlugin.confirmed);
  }
  private int owner(String value){
   if(value==null)return 0;
   if(OWNER.equals(value))return 1;
   if(FOREIGN.equals(value))return 2;
   throw new AssertionError("Unknown fixture update owner");
  }
  private JSONObject row(RuntimeUpdatePause.Record value){
   if(value==null)return new JSONObject().put("id",0).put("session",0).put("boot",0)
    .put("baselineCode",0).put("baselineDigest","none").put("targetCode",0).put("targetDigest","none")
    .put("signer","none").put("committing",false);
   return new JSONObject().put("id",owner(value.id)).put("session",value.session).put("boot",value.boot)
    .put("baselineCode",value.baselineCode).put("baselineDigest",digest(value.baselineDigest))
    .put("targetCode",value.targetCode).put("targetDigest",digest(value.targetDigest))
    .put("signer",signing(value.signer)).put("committing",value.committing);
  }
  private JSONObject state()throws Exception{
   RuntimeUpdatePause.Record value=null;
   String file;
   try{
    value=AlphaDevicePlugin.UpdatePause.store().read();
    file=value!=null?"record":Files.exists(journal.resolve("pause"),LinkOption.NOFOLLOW_LINKS)?"empty":"missing";
   }catch(IOException unreadable){file="corrupt";}
   boolean start=true;
   try{RuntimeUpdatePause.beforeStart();}catch(IllegalStateException blocked){start=false;}
   boolean lease=AlphaDevicePlugin.UpdatePause.shutdownRequest>=0;
   return Trace.fields("file",file,"record",row(value),"staged",Files.exists(journal.resolve("pause.next"),LinkOption.NOFOLLOW_LINKS),
    "syncDenied",syncDenied,"generation",generation,"executingCode",BuildConfig.VERSION_CODE,
    "executingDigest",digest(AlphaDevicePlugin.UpdatePause.digest(AlphaDevicePlugin.UpdatePause.executingApk)),
    "liveOwner",owner(AlphaDevicePlugin.UpdatePause.liveOwner),"shutdown",lease,
    "stops",AlphaLocalAgentPlugin.stops,"releases",AlphaLocalAgentPlugin.releases,"evidence",evidence(),"outcome",outcome)
    .put("StartAllowed",start).put("LeaseRetained",lease);
  }
  void observe(JSONObject value)throws Exception{setEvidence(value);trace.step("observe",state(),value);}
  void acquire()throws Exception{
   try{
    AlphaDevicePlugin.UpdatePause.acquire(OWNER,SESSION,8,targetDigest,Settings.Global.bootCount);
    outcome="acquired";
   }catch(AccessDeniedException denied){check(syncDenied,"expected controlled sync refusal");outcome="sync-error";}
   trace.step("acquire",state(),1);
  }
  void committing()throws Exception{
   try{AlphaDevicePlugin.UpdatePause.committing(OWNER);outcome="committing";}
   catch(AccessDeniedException denied){check(syncDenied,"expected controlled sync refusal");outcome="sync-error";}
   trace.step("committing",state(),1);
  }
  void wrongCommit()throws Exception{
   try{AlphaDevicePlugin.UpdatePause.committing(FOREIGN);throw new AssertionError("foreign commit");}
   catch(IOException refused){check(refused.getMessage().contains("owner changed"),"wrong owner is refused");}
   trace.steps.put(new JSONObject().put("label","durable owner differs")
    .put("action",Trace.action("committing",2).put("reject",true)).put("expect",state()));
  }
  void wrongReconcile()throws Exception{
   check(!AlphaDevicePlugin.UpdatePause.store().reconcile(FOREIGN,7,baseDigest,7,baseDigest,RuntimeUpdatePause.Session.ABSENT,false),
    "foreign owner cannot release the real journal");
   outcome="held";trace.step("rejectForeignOwner",state(),2);
  }
  void retire()throws Exception{
   // Outer install-worker finally retires this field before readback.
   check(OWNER.equals(AlphaDevicePlugin.UpdatePause.liveOwner),"actual live owner");
   AlphaDevicePlugin.UpdatePause.liveOwner=null;trace.step("retireOwner",state());
  }
  void stop()throws Exception{
   if(AlphaLocalAgentPlugin.confirmed){AlphaDevicePlugin.UpdatePause.stop();outcome="stopped";}
   else{
    AtomicReference<Throwable> result=new AtomicReference<>();
    Thread waiting=new Thread(()->{try{AlphaDevicePlugin.UpdatePause.stop();}catch(Throwable stopped){result.set(stopped);}});
    waiting.start();
    long deadline=System.nanoTime()+5_000_000_000L;
    while(AlphaDevicePlugin.UpdatePause.shutdownRequest<0&&System.nanoTime()<deadline)Thread.sleep(1);
    waiting.interrupt();waiting.join(5000);
    check(!waiting.isAlive()&&result.get() instanceof InterruptedException,"source stop has an unconfirmed request");
    outcome="stop-interrupted";
   }
   trace.step("requestStop",state());
  }
  void reconcile()throws Exception{
   try{outcome=AlphaDevicePlugin.UpdatePause.reconcile()==null?"held":"released";}
   catch(AccessDeniedException denied){check(syncDenied,"expected controlled sync refusal");outcome="sync-error";}
   catch(IOException|RuntimeException|Settings.SettingNotFoundException unknown){outcome="read-error";}
   trace.step("reconcile",state());
  }
  void interruptStage()throws Exception{
   Files.writeString(journal.resolve("pause.next"),"Interrupted old staging bytes",StandardOpenOption.CREATE_NEW);
   trace.step("interruptStage",state());
  }
  void corrupt(String mode)throws Exception{
   Path file=journal.resolve("pause");
   if("symlink".equals(mode)){Files.deleteIfExists(file);Files.createSymbolicLink(file,root.resolve("base.apk"));}
   else if("trailing".equals(mode))Files.write(file,new byte[]{7},StandardOpenOption.APPEND);
   else if("oversize".equals(mode))Files.write(file,new byte[1025]);
   else Files.writeString(file,"corrupt");
   trace.step("unreadable",state());
  }
  boolean denySync()throws Exception{
   if(!Files.getFileStore(journal).supportsFileAttributeView("posix"))return false;
   Files.setPosixFilePermissions(journal,PosixFilePermissions.fromString("-wx------"));
   try(var channel=FileChannel.open(journal,StandardOpenOption.READ)){
    restoreSync();
    return false; // The host can bypass mode bits.
   }catch(AccessDeniedException expected){syncDenied=true;trace.step("denySync",state(),true);return true;}
  }
  void restoreSync()throws Exception{
   Files.setPosixFilePermissions(journal,PosixFilePermissions.fromString("rwx------"));
   if(syncDenied){syncDenied=false;trace.step("denySync",state(),false);}
  }
  public void close()throws IOException{erase(context.data.toPath());}
 }

 public static void main(String[] args)throws Exception{
  String mode=args[0];Path root=Path.of(args[1]);
  boolean next=mode.startsWith("new-");
  JSONObject startup="new-target".equals(mode)?successor():
   "new-baseline".equals(mode)?defaults().put("session","sealed"):defaults();
  try(Fixture f=new Fixture(root,next?2:1,"new-target".equals(mode)?8:7,
   "new-target".equals(mode)?"target":"base",startup)){
   f.begin(mode);
   switch(mode){
    case "baseline-release":
     f.interruptStage();f.acquire();f.wrongCommit();f.wrongReconcile();
     f.observe(defaults().put("confirmed",false));f.stop();f.retire();f.reconcile();
     f.observe(defaults());f.reconcile();f.reconcile();break;
    case "package-evidence":
     f.acquire();f.committing();f.retire();
     for(JSONObject input:new JSONObject[]{defaults().put("session","foreign"),
       defaults().put("session","sealed"),defaults().put("session","bound").put("sdk",31),
       defaults().put("session","bound").put("sdk",32),defaults().put("session","bound").put("sdk",38),
       defaults().put("session","bound").put("sdk",30).put("releaseBuild",false),
       defaults().put("session","bound").put("zero",false),
       defaults().put("session","bound").put("boot",-1),defaults().put("session","unavailable"),
       defaults().put("installedDigest","other"),defaults().put("signer","other"),
       defaults().put("session","bound").put("sdk",33)}){
      f.observe(input);f.reconcile();
     }
     break;
    case "precommit-binding":
     f.acquire();f.retire();f.observe(defaults().put("session","bound").put("zero",false).put("sdk",31));f.reconcile();break;
    case "different-boot":
     f.acquire();f.committing();f.retire();
     f.observe(defaults().put("session","bound").put("zero",false).put("sdk",31).put("boot",2));f.reconcile();break;
    case "old-target":
     f.acquire();f.committing();f.retire();f.observe(successor());f.reconcile();
     f.observe(defaults().put("installedCode",8).put("installedDigest","target"));f.reconcile();break;
    case "old-baseline":
     f.acquire();f.committing();f.retire();f.observe(defaults().put("session","sealed"));f.reconcile();break;
    case "new-target": f.reconcile();break;
    case "new-baseline": f.reconcile();f.observe(defaults());f.reconcile();break;
    case "trailing":case "oversize":case "symlink":case "bad":
     f.acquire();f.retire();f.corrupt(mode);f.reconcile();break;
    case "ambiguous-release":
     f.acquire();f.stop();f.retire();
     if(!f.denySync()){System.out.println(new JSONObject().put("skip","POSIX directory-read refusal unavailable"));return;}
     try{f.reconcile();}finally{f.restoreSync();}
     f.reconcile();break;
    case "ambiguous-publication":
     if(!f.denySync()){System.out.println(new JSONObject().put("skip","POSIX directory-read refusal unavailable"));return;}
     try{f.acquire();f.committing();}finally{f.restoreSync();}
     f.retire();f.reconcile();break;
    default:throw new IllegalArgumentException(mode);
   }
   System.out.println(new JSONObject().put("trace",f.trace.value).put("pid",ProcessHandle.current().pid()));
  }
 }
}
