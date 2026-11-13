// patches/eliza/photos-library.patch on the patched source (Photos review findings). The Android paths
// themselves are device-checked by the Photos instrumented tests; this pins the rules in the patched code.
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {javaBinary,jsonJar,jsonJarSkip} from './fixtures/jvm-tools.mjs';
const root=path.resolve(import.meta.dirname,'..');
const ready=fs.existsSync(path.join(root,'vendor/eliza/plugins/plugin-native-media'));
let media;
async function source(name){
 if(!media){const {preparePatchedNative}=await import('../scripts/prepare-patched-native.ts');media=path.join(preparePatchedNative({root}).root,'plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media');}
 return fs.readFileSync(path.join(media,name+'.java'),'utf8');
}

// Compiles the patched PermittedMediaCatalog against android.jar (with tiny stubs for the Capacitor
// call and androidx helpers it references) and runs its pure ordering rules on the JVM.
const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||path.join(os.homedir(),'Android/Sdk');
const androidJar=(()=>{try{const dir=path.join(sdk,'platforms');const v=fs.readdirSync(dir).filter(n=>/^android-\d+$/.test(n)).sort((a,b)=>+b.slice(8)-+a.slice(8))[0];return v&&path.join(dir,v,'android.jar');}catch{return undefined;}})();
const capacitor=path.join(root,'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor');

// Exercise the real receipt/recovery entry point with private files and a file-backed resolver.
// Graphics and Android storage consent are outside this host-JVM test's scope.
test('Replace recovery restores its interrupted prefix and preserves later external edits',{
 skip:(!ready&&'vendor/eliza not checked out')||(!androidJar&&'no Android SDK platform')||jsonJarSkip||(!fs.existsSync(capacitor)&&'no Capacitor sources'),
},async t=>{
 await source('OwnedPhotoEdits');
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-photo-recovery-'));
 t.after(()=>fs.rmSync(work,{recursive:true,force:true}));
 const stubRoot=path.join(work,'stub');
 const stub=(relative,text)=>{
  const filename=path.join(stubRoot,relative);
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  fs.writeFileSync(filename,text);
  return filename;
 };
 const sources=[
  stub('androidx/annotation/Nullable.java','package androidx.annotation; public @interface Nullable {}'),
  stub('android/net/Uri.java',`package android.net;
public final class Uri {
 private final String value;
 private Uri(String value) { this.value=value; }
 public static Uri parse(String value) { return new Uri(value); }
 public String toString() { return value; }
 public boolean equals(Object other) { return other instanceof Uri && value.equals(((Uri)other).value); }
 public int hashCode() { return value.hashCode(); }
}`),
  stub('android/content/SharedPreferences.java',`package android.content;
public interface SharedPreferences {
 String getString(String key,String fallback);
 Editor edit();
 interface Editor { Editor putString(String key,String value); boolean commit(); }
}`),
  stub('android/content/ContentResolver.java',`package android.content;
import android.database.Cursor;
import android.net.Uri;
import java.io.*;
public final class ContentResolver {
 private final File target;
 public int writes;
 ContentResolver(File target) { this.target=target; }
 public InputStream openInputStream(Uri uri) throws IOException { return new FileInputStream(target); }
 public OutputStream openOutputStream(Uri uri,String mode) throws IOException {
  writes++;
  return new FileOutputStream(target);
 }
 public Cursor query(Uri uri,String[] columns,String where,String[] args,String order) { throw new AssertionError("Unexpected query"); }
 public Uri insert(Uri uri,ContentValues values) { throw new AssertionError("Unexpected insert"); }
 public int update(Uri uri,ContentValues values,String where,String[] args) { throw new AssertionError("Unexpected update"); }
 public int delete(Uri uri,String where,String[] args) { throw new AssertionError("Unexpected delete"); }
}`),
  stub('android/content/Context.java',`package android.content;
import java.io.File;
import java.util.HashMap;
import java.util.Map;
public final class Context {
 private final File directory;
 private final ContentResolver resolver;
 public final MemoryPreferences preferences=new MemoryPreferences();
 public Context(File directory,File target) { this.directory=directory; resolver=new ContentResolver(target); }
 public File getFilesDir() { return directory; }
 public File getCacheDir() { return directory; }
 public String getPackageName() { return "fixture.photos"; }
 public ContentResolver getContentResolver() { return resolver; }
 public SharedPreferences getSharedPreferences(String name,int mode) { return preferences; }
 public static final class MemoryPreferences implements SharedPreferences {
  public final Map<String,String> values=new HashMap<>();
  public String getString(String key,String fallback) { return values.getOrDefault(key,fallback); }
  public Editor edit() { return new Editor() {
   private final Map<String,String> pending=new HashMap<>();
   public Editor putString(String key,String value) { pending.put(key,value); return this; }
   public boolean commit() { values.putAll(pending); return true; }
  }; }
 }
}`),
  stub('ai/eliza/plugins/media/PhotoFilter.java',`package ai.eliza.plugins.media;
import android.graphics.Bitmap;
public final class PhotoFilter {
 public static void validate(String filter) { throw new AssertionError("Unexpected image edit"); }
 public static Bitmap apply(Bitmap source,String filter,java.util.function.BooleanSupplier cancelled) { throw new AssertionError("Unexpected image edit"); }
}`),
  stub('com/getcapacitor/JSObject.java',fs.readFileSync(path.join(capacitor,'JSObject.java'),'utf8')),
  path.join(media,'OwnedMediaConfig.java'),
  path.join(media,'PhotoCrop.java'),
  path.join(media,'OwnedPhotoEdits.java'),
  stub('ai/eliza/plugins/media/PhotoRecoveryCheck.java',`package ai.eliza.plugins.media;
import android.content.Context;
import android.net.Uri;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;
import org.json.JSONObject;
public final class PhotoRecoveryCheck {
 private static final String TOKEN="11111111-2222-4333-8444-555555555555";
 private static final byte[] ORIGINAL=bytes("original-photo-bytes");
 private static final byte[] EDITED=bytes("encoded-edited-photo-bytes");
 private static byte[] bytes(String value) { return value.getBytes(StandardCharsets.UTF_8); }
 private static void check(boolean value,String reason) { if(!value) throw new AssertionError(reason); }
 private static String hash(byte[] bytes) throws Exception {
  StringBuilder text=new StringBuilder();
  for(byte value:MessageDigest.getInstance("SHA-256").digest(bytes)) text.append(String.format("%02x",value&255));
  return text.toString();
 }
 private static final class Case {
  final File directory,target,original,edited;
  final boolean retainedEdit;
  final Context context;
  final OwnedPhotoEdits recovery;
  final JSONObject record;
  Case(File root,String name,byte[] current,boolean retainEdit) throws Exception {
   retainedEdit=retainEdit;
   directory=new File(root,name); check(directory.mkdirs(),"create case");
   target=new File(directory,"published-photo"); if(current!=null) Files.write(target.toPath(),current);
   File backups=new File(directory,"photo-replace-backups"); check(backups.mkdir(),"create backups");
   original=new File(backups,TOKEN+".original"); Files.write(original.toPath(),ORIGINAL);
   edited=new File(backups,TOKEN+".edited");
   if(retainEdit) Files.write(edited.toPath(),EDITED);
   record=new JSONObject().put("replace",true).put("status","writing").put("id","1")
    .put("backup",original.getName()).put("target","content://fixture/1").put("original",hash(ORIGINAL)).put("edited",hash(EDITED));
   if(retainEdit) record.put("editBackup",edited.getName());
   context=new Context(directory,target);
   saveRecord();
   for(String[] orphan:ORPHANS){
    File file=new File(backups,orphan[0]); Files.write(file.toPath(),ORIGINAL);
    if(!orphan[1].isEmpty()) context.preferences.values.put(orphan[0].substring(0,orphan[0].lastIndexOf('.')),new JSONObject().put("replace",true).put("status",orphan[1]).put("original",orphan[2].equals("verified")?hash(ORIGINAL):hash(EDITED)).put("edited",hash(ORIGINAL)).toString());
   }
   OwnedMediaConfig config=OwnedMediaConfig.builder("fixture").edits("Pictures/Fixture/","edit_").captures("DCIM/Fixture/","capture_").build();
   recovery=new OwnedPhotoEdits(context,config,new OwnedPhotoEdits.SourceAccess() {
    public boolean accepts(String id) { return id.equals("1"); }
    public Uri source(String id) { return Uri.parse("content://fixture/1"); }
    public String revision(String id) { return "fixture-revision"; }
   });
  }
  void saveRecord() { context.preferences.values.put(TOKEN,record.toString()); }
  static final String[][] ORPHANS={{"aaaaaaaa-0000-4000-8000-000000000001.original","incomplete","verified"},{"aaaaaaaa-0000-4000-8000-000000000002.original","saved","verified"},{"aaaaaaaa-0000-4000-8000-000000000003.edited","failed","verified"},{"aaaaaaaa-0000-4000-8000-000000000004.original","writing","verified"},{"aaaaaaaa-0000-4000-8000-000000000005.original","","verified"},{"aaaaaaaa-0000-4000-8000-000000000006.original","saved","tampered"}};
  void expectSwept() {
   File backups=new File(directory,"photo-replace-backups");
   for(String[] orphan:ORPHANS){boolean terminal=orphan[1].equals("saved")||orphan[1].equals("failed");check(new File(backups,orphan[0]).exists()!= (terminal&&orphan[2].equals("verified")),directory.getName()+" sweep "+orphan[0]);}
  }
  void expect(String status,byte[] expected,int writes,boolean keepBackups) throws Exception {
   String actualStatus=recovery.result(TOKEN).getString("status");
   check(expected==null?!target.exists():Arrays.equals(expected,Files.readAllBytes(target.toPath())),directory.getName()+" preserved bytes");
   check(status.equals(actualStatus),directory.getName()+" result");
   check(context.getContentResolver().writes==writes,directory.getName()+" write count");
   check(original.exists()==keepBackups,directory.getName()+" original backup");
   check(edited.exists()==(keepBackups&&retainedEdit),directory.getName()+" edited backup");
   String journalStatus=new JSONObject(context.preferences.getString(TOKEN,"{}")).getString("status");
   check(journalStatus.equals(status.equals("unknown")?"writing":status),directory.getName()+" durable receipt");
   check(status.equals(recovery.result(TOKEN).getString("status")),directory.getName()+" repeat result");
   check(context.getContentResolver().writes==writes,directory.getName()+" repeat write count");
  }
 }
 public static void main(String[] args) throws Exception {
  File root=new File(args[0]); check(root.mkdir(),"create data directory");
  byte[] external=bytes("a later external photo edit");
  Case externalCase=new Case(root,"external",external,true);externalCase.expectSwept();externalCase.expect("unknown",external,0,true);
  new Case(root,"unreadable-or-absent",null,true).expect("unknown",null,0,true);
  new Case(root,"complete",EDITED,true).expect("saved",EDITED,0,false);
  new Case(root,"unchanged",ORIGINAL,true).expect("failed",ORIGINAL,0,false);
  new Case(root,"prefix",Arrays.copyOf(EDITED,9),true).expect("failed",ORIGINAL,1,false);
  Case restoreRetry=new Case(root,"restore-retry",Arrays.copyOf(ORIGINAL,8),true);
  restoreRetry.record.put("restoring",true); restoreRetry.saveRecord();
  restoreRetry.expect("failed",ORIGINAL,1,false);
  new Case(root,"original-prefix-without-phase",Arrays.copyOf(ORIGINAL,8),true).expect("unknown",Arrays.copyOf(ORIGINAL,8),0,true);
  Case missingTarget=new Case(root,"missing-target",Arrays.copyOf(EDITED,9),true);
  missingTarget.record.remove("target"); missingTarget.saveRecord();
  missingTarget.expect("unknown",Arrays.copyOf(EDITED,9),0,true);
  Case differentTarget=new Case(root,"different-target",Arrays.copyOf(EDITED,9),true);
  differentTarget.record.put("target","content://fixture/2"); differentTarget.saveRecord();
  differentTarget.expect("unknown",Arrays.copyOf(EDITED,9),0,true);
  new Case(root,"empty",new byte[0],true).expect("failed",ORIGINAL,1,false);
  new Case(root,"legacy",Arrays.copyOf(EDITED,9),false).expect("unknown",Arrays.copyOf(EDITED,9),0,true);
  Case badEdit=new Case(root,"corrupt-edit",Arrays.copyOf(EDITED,9),true);
  Files.write(badEdit.edited.toPath(),bytes("corrupted encoded backup"));
  badEdit.expect("unknown",Arrays.copyOf(EDITED,9),0,true);
  Case badOriginal=new Case(root,"corrupt-original",Arrays.copyOf(EDITED,9),true);
  Files.write(badOriginal.original.toPath(),bytes("corrupted original backup"));
  badOriginal.expect("unknown",Arrays.copyOf(EDITED,9),0,true);
  Case wrongName=new Case(root,"wrong-name",Arrays.copyOf(EDITED,9),true);
  wrongName.record.put("editBackup","another-operation.edited"); wrongName.saveRecord();
  wrongName.expect("unknown",Arrays.copyOf(EDITED,9),0,true);
  byte[] longer=Arrays.copyOf(EDITED,EDITED.length+1); longer[longer.length-1]=1;
  new Case(root,"longer",longer,true).expect("unknown",longer,0,true);
  System.out.println("ok");
 }
}`),
 ];
 const classpath=jsonJar+path.delimiter+androidJar;
 execFileSync(javaBinary('javac'),['-proc:none','-nowarn','-implicit:none','-d',path.join(work,'out'),'-cp',classpath,...sources],{timeout:scaledTimeout(120000),stdio:'pipe'});
 assert.equal(execFileSync(javaBinary('java'),['-cp',path.join(work,'out')+path.delimiter+classpath,'ai.eliza.plugins.media.PhotoRecoveryCheck',path.join(work,'data')],{encoding:'utf8',timeout:scaledTimeout(60000)}).trim(),'ok');
});
