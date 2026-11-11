package ai.alphacompute.alphaphone;

import ai.eliza.plugins.agent.updater.RuntimeUpdatePause;
import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import java.io.File;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.UUID;
import org.json.JSONObject;

/** Disposable fixture. The status receiver, receipt and pause journal are the production sources. */
public final class ContinuationActivity extends Activity {
 public static final class FixtureApplication extends Application {
  @Override protected void attachBaseContext(Context base){super.attachBaseContext(base);AlphaDevicePlugin.UpdatePause.configure(base);}
 }

 @Override public void onCreate(Bundle saved){super.onCreate(saved);run(getIntent());}
 @Override public void onNewIntent(Intent intent){super.onNewIntent(intent);run(intent);}
 private void run(Intent intent){
  String phase=intent.getStringExtra("phase");
  try{
   if("install".equals(phase)){install();finishAndRemoveTask();return;}
   var record=AlphaDevicePlugin.UpdatePause.store().read();
   var session=record==null?null:getPackageManager().getPackageInstaller().getSessionInfo(record.session);
   Intent confirmation=null;
   if(record!=null&&record.committing&&record.boot==boot(this)&&AlphaDevicePlugin.UpdatePause.binds(record,session)&&
      session.isSealed()&&session.getProgress()<=0.8f&&!session.isActive()&&record.signer.equals(AlphaDevicePlugin.appSigner(this)))
    confirmation=UpdateConfirmationReceipt.readUnopened(this,record);
   JSONObject evidence=new JSONObject().put("pid",android.os.Process.myPid()).put("session",record==null?-1:record.session)
    .put("sealed",session!=null&&session.isSealed()).put("canContinue",confirmation!=null)
    .put("version",getPackageManager().getPackageInfo(getPackageName(),0).getLongVersionCode());
   if("continue".equals(phase)){
    if(confirmation==null||!UpdateConfirmationReceipt.markOpened(this,record,confirmation))throw new IllegalStateException("Continuation unavailable");
    write("continued.json",evidence.put("action",confirmation.getAction()).put("systemPackage",confirmation.getPackage()));
    startActivity(confirmation);
   }else write("readback.json",evidence);
  }catch(Exception error){try{write("error.json",new JSONObject().put("phase",phase).put("error",error.getClass().getSimpleName()).put("message",error.getMessage()));}catch(Exception ignored){}}
 }
 private void install()throws Exception{
  PackageInstaller installer=getPackageManager().getPackageInstaller();
  File apk=new File(getFilesDir(),"candidate.apk");
  String id=UUID.randomUUID().toString(),signer=AlphaDevicePlugin.appSigner(this),digest=sha(Files.readAllBytes(apk.toPath()));
  int boot=boot(this);
  var params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
  params.setAppPackageName(getPackageName());params.setSize(apk.length());
  params.setReferrerUri(Uri.parse("alpha-update://"+getPackageName()+"/2/"+digest+"/"+signer+"/"+boot+"/intent"));
  params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
  int sessionId=installer.createSession(params);
  try(var session=installer.openSession(sessionId)){
   try(var out=session.openWrite("base.apk",0,apk.length())){Files.copy(apk.toPath(),out);session.fsync(out);}
   var pause=AlphaDevicePlugin.UpdatePause.store();
   pause.acquire(new RuntimeUpdatePause.Record(id,sessionId,boot,1,sha(Files.readAllBytes(new File(getApplicationInfo().sourceDir).toPath())),2,digest,signer,false));
   pause.committing(id);
   write("attempt.json",new JSONObject().put("pid",android.os.Process.myPid()).put("session",sessionId));
   session.setStagingProgress(1f);
   session.commit(AlphaUpdateStatusReceiver.sender(this,id,sessionId));
  }
 }
 private void write(String name,JSONObject value)throws Exception{Files.write(new File(getFilesDir(),name).toPath(),value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}
 static int boot(Context context)throws Exception{return Settings.Global.getInt(context.getContentResolver(),Settings.Global.BOOT_COUNT);}
 static String sha(byte[] bytes)throws Exception{
  byte[] hash=MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder result=new StringBuilder();
  for(byte b:hash)result.append(String.format("%02x",b&255));return result.toString();
 }
}
/** The platform fixture uses the real receiver and journal and supplies the host's narrow identity port. */
final class AlphaDevicePlugin {
 static final String UPDATE_STATUS="ai.alphacompute.alphaphone.UPDATE_STATUS";
 static String appSigner(Context context)throws Exception{
  var info=context.getPackageManager().getPackageInfo(context.getPackageName(),PackageManager.GET_SIGNING_CERTIFICATES);
  return ContinuationActivity.sha(info.signingInfo.getSigningCertificateHistory()[0].toByteArray());
 }
 static final class UpdatePause {
  private static RuntimeUpdatePause journal;
  private static Context context;
  static void configure(Context base){context=base;}
  static synchronized RuntimeUpdatePause store()throws Exception{
   if(journal==null)journal=new RuntimeUpdatePause(new File(context.getNoBackupFilesDir(),"app-update-pause").toPath());return journal;
  }
  static boolean binds(RuntimeUpdatePause.Record record,PackageInstaller.SessionInfo session){
   String expected="alpha-update://"+context.getPackageName()+"/"+record.targetCode+"/"+record.targetDigest+"/"+record.signer+"/"+record.boot+"/intent";
   return session!=null&&expected.equals(String.valueOf(session.getReferrerUri()));
  }
 }
}
