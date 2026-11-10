package ai.alphacompute.alphaphone.otafixture;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.security.MessageDigest;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Disposable platform fixture. It is neither the Alpha APK nor its native/renderer integration. */
public final class OtaActivity extends Activity {
 private static final String ALIAS="alpha-ota-platform-fixture";
 private static final byte[] VALUE="synthetic retained value".getBytes(StandardCharsets.UTF_8);
 private final android.os.Handler finishHandler=new android.os.Handler(android.os.Looper.getMainLooper());
 private final Runnable finishReadback=this::finish;
 static void save(Context context,String name,JSONObject result)throws Exception{
  try(FileOutputStream out=context.openFileOutput(name,Context.MODE_PRIVATE)){out.write(result.toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
 }
 static String digest(byte[] bytes)throws Exception{return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
 private JSONObject snapshot()throws Exception{
  var info=getPackageManager().getPackageInfo(getPackageName(),PackageManager.GET_SIGNING_CERTIFICATES);
  JSONObject result=new JSONObject().put("versionCode",info.getLongVersionCode()).put("uid",android.os.Process.myUid()).put("pid",android.os.Process.myPid())
   .put("firstInstallTime",info.firstInstallTime).put("lastUpdateTime",info.lastUpdateTime)
   .put("signerSha256",digest(info.signingInfo.getSigningCertificateHistory()[0].toByteArray()))
   .put("automaticCapability",SourcePolicy.automaticUpdateStatus(this)).put("sessionCount",getPackageManager().getPackageInstaller().getMySessions().size());
  SharedPreferences state=getSharedPreferences("retained",MODE_PRIVATE);
  result.put("preference",state.getString("sentinel","missing"));
  KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
  if(store.containsAlias(ALIAS)){
   byte[] frame=Files.readAllBytes(new File(getFilesDir(),"retained.bin").toPath());
   Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,store.getKey(ALIAS,null),new GCMParameterSpec(128,frame,0,12));
   result.put("keystoreValueRetained",MessageDigest.isEqual(VALUE,cipher.doFinal(frame,12,frame.length-12)));
   result.put("ciphertextSha256",digest(frame));
  }
  return result;
 }
 private void prepare()throws Exception{
  // Activity recreation must not replace the committed baseline or its Keystore key/ciphertext.
  if(new File(getFilesDir(),"baseline.json").isFile())return;
  if(!getSharedPreferences("retained",MODE_PRIVATE).edit().putString("sentinel","retain-through-self-update").commit())throw new IllegalStateException();
  KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
  generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
  SecretKey key=generator.generateKey();Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);
  byte[] encrypted=cipher.doFinal(VALUE),iv=cipher.getIV(),frame=new byte[iv.length+encrypted.length];System.arraycopy(iv,0,frame,0,iv.length);System.arraycopy(encrypted,0,frame,iv.length,encrypted.length);
  Files.write(new File(getFilesDir(),"retained.bin").toPath(),frame);save(this,"baseline.json",snapshot());
 }
 private void install()throws Exception{
  String admitted=SourcePolicy.automaticUpdateStatus(this);
  if(!"supported".equals(admitted)){save(this,"attempt.json",new JSONObject().put("status",admitted));return;}
  File apk=new File(getFilesDir(),"candidate.apk");
  if(!getIntent().getStringExtra("sha256").equals(digest(Files.readAllBytes(apk.toPath()))))throw new IllegalArgumentException();
  var archive=getPackageManager().getPackageArchiveInfo(apk.getPath(),PackageManager.GET_SIGNING_CERTIFICATES);
  if(archive==null||!getPackageName().equals(archive.packageName)||archive.getLongVersionCode()!=2)throw new IllegalArgumentException();
  if(!snapshot().getString("signerSha256").equals(digest(archive.signingInfo.getSigningCertificateHistory()[0].toByteArray())))throw new IllegalArgumentException();
  PackageInstaller installer=getPackageManager().getPackageInstaller();
  PackageInstaller.SessionParams params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
  params.setAppPackageName(getPackageName());params.setSize(apk.length());SourcePolicy.configure(params,true);
  int id=installer.createSession(params);
  try(PackageInstaller.Session session=installer.openSession(id)){
   try(var in=new FileInputStream(apk);var out=session.openWrite("base.apk",0,apk.length())){in.transferTo(out);session.fsync(out);}
   save(this,"attempt.json",new JSONObject().put("status","committing").put("session",id).put("pid",android.os.Process.myPid()));
   session.commit(PendingIntent.getBroadcast(this,id,new Intent(this,ResultReceiver.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_MUTABLE).getIntentSender());
  }
 }
 @Override public void onCreate(Bundle saved){
  super.onCreate(saved);
  handlePhase();
 }
 @Override protected void onNewIntent(Intent intent){
  super.onNewIntent(intent);setIntent(intent);handlePhase();
 }
 private void handlePhase(){
  finishHandler.removeCallbacks(finishReadback);
  boolean readback=false;
  try{
   String phase=getIntent().getStringExtra("phase");
   if("prepare".equals(phase))prepare();else if("install".equals(phase))install();else{save(this,"readback.json",snapshot());readback=true;}
  }catch(Exception failed){try{save(this,"error.json",new JSONObject().put("errorClass",failed.getClass().getSimpleName()));}catch(Exception ignored){}}
  // Give Android's deferred terminal broadcast a foreground successor, as resuming a real app does.
  if(readback)finishHandler.postDelayed(finishReadback,1500);else finish();
 }
 public static final class ResultReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context context,Intent intent){
   try{save(context,"status.json",new JSONObject().put("status",intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE)).put("session",intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,-1)).put("pid",android.os.Process.myPid()));}catch(Exception ignored){}
   // Deliberately never launch optional confirmation: this campaign asserts that none was needed.
  }
 }
}
