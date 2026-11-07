// patches/eliza/photos-library.patch on the patched source (Photos review findings). The Android paths
// themselves are device-checked by the Photos instrumented tests; this pins the rules in the patched code.
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
 if(!media){const {preparePatchedNative}=await import('../scripts/prepare-patched-native.mjs');media=path.join(preparePatchedNative({root}).root,'plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media');}
 return fs.readFileSync(path.join(media,name+'.java'),'utf8');
}
const method=(text,signature)=>{const a=text.indexOf(signature);assert.ok(a>=0,signature);return text.slice(a,text.indexOf('\n  }\n',a));};
test('FixNoCap: a permitted favorite/trash/restore is one reviewed request of up to 500; permanent removal stays at 20',{skip:!ready&&'vendor/eliza not checked out'},async()=>{
 const access=await source('PhotoLibraryAccess'),plugin=await source('PhotosPlugin'),review=await source('PermittedMediaReview');
 assert.match(access,/public static final int REVIEWED = 20;/);assert.match(access,/public static final int REVIEWED_BATCH = 500;/);
 assert.match(method(plugin,'public void changeMany('),/reviewed\(items, PhotoLibraryAccess\.REVIEWED_BATCH\)/);
 assert.match(method(plugin,'public void deletePermittedTrash('),/PhotoLibraryAccess\.REVIEWED\)/);
 const request=method(review,'private void request(PluginCall call, List<String> ids');
 assert.match(request,/int max = batch && !permanent \? PhotoLibraryAccess\.REVIEWED_BATCH : PhotoLibraryAccess\.REVIEWED;/);
 assert.match(request,/ids\.size\(\) > max/);
 const js=fs.readFileSync(path.join(root,'apps/app/src/prototype/camera-adapter.ts'),'utf8');
 assert.match(js,/const PERMITTED_BATCH=500;/,'The adapter sends permitted items at the native bound');
});

// Compiles the patched PermittedMediaCatalog against android.jar (with tiny stubs for the Capacitor
// call and androidx helpers it references) and runs its pure ordering rules on the JVM.
const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||path.join(os.homedir(),'Android/Sdk');
const androidJar=(()=>{try{const dir=path.join(sdk,'platforms');const v=fs.readdirSync(dir).filter(n=>/^android-\d+$/.test(n)).sort((a,b)=>+b.slice(8)-+a.slice(8))[0];return v&&path.join(dir,v,'android.jar');}catch{return undefined;}})();
const capacitor=path.join(root,'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor');
test('NewestNeverDropped: the permitted catalog pages every volume and type by capture time, then source, then _id',{skip:(!ready&&'vendor/eliza not checked out')||(!androidJar&&'no Android SDK platform')||(!fs.existsSync(capacitor)&&'no Capacitor sources')},async t=>{
 const catalog=await source('PermittedMediaCatalog');
 const list=method(catalog,'public JSObject list(String cursor, String search, String kind, boolean thumbnails, String filter,\n      long from');
 assert.match(list,/QUERY_ARG_SQL_SORT_ORDER, SHOT \+ " DESC, _id DESC"/);assert.doesNotMatch(list,/QUERY_ARG_SORT_COLUMNS/);
 assert.match(list,/merged\.sort\(CATALOG_ORDER\)/);assert.doesNotMatch(list,/outer:/,'No volume-by-volume paging');
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-catalog-order-'));t.after(()=>fs.rmSync(work,{recursive:true,force:true}));
 const stub=(rel,text)=>{fs.mkdirSync(path.dirname(path.join(work,'stub',rel)),{recursive:true});fs.writeFileSync(path.join(work,'stub',rel),text);};
 stub('androidx/annotation/Nullable.java','package androidx.annotation; public @interface Nullable {}');
 stub('androidx/core/content/ContextCompat.java','package androidx.core.content; public class ContextCompat { public static final int RECEIVER_NOT_EXPORTED=4; public static android.content.Intent registerReceiver(android.content.Context c,android.content.BroadcastReceiver r,android.content.IntentFilter f,int flags){return null;} }');
 stub('com/getcapacitor/PluginCall.java','package com.getcapacitor; public class PluginCall { public void resolve(JSObject o){} public void reject(String m){} public void reject(String m,String c){} }');
 for(const name of ['JSObject','JSArray'])stub('com/getcapacitor/'+name+'.java',fs.readFileSync(path.join(capacitor,name+'.java'),'utf8'));
 stub('ai/eliza/plugins/media/CatalogOrderCheck.java',`package ai.eliza.plugins.media;
public class CatalogOrderCheck{static void check(boolean ok,String what){if(!ok)throw new AssertionError(what);}
 public static void main(String[] a){
  java.util.List<Object[]> rows=new java.util.ArrayList<>(java.util.List.of(
   new Object[]{1000L,0,9L,"old-high-id"},new Object[]{5000L,2,1L,"sd-card-today"},new Object[]{5000L,0,3L,"internal-today"},new Object[]{5000L,0,4L,"internal-today-later-id"},new Object[]{3000L,1,2L,"video"}));
  rows.sort(PermittedMediaCatalog.CATALOG_ORDER);
  StringBuilder order=new StringBuilder();for(Object[] r:rows)order.append(r[3]).append(',');
  check(order.toString().equals("internal-today-later-id,internal-today,sd-card-today,video,old-high-id,"),"order "+order);
  check(PermittedMediaCatalog.SHOT.equals("ifnull(nullif(datetaken,0),date_added*1000)"),"capture time, else date added");
  // One page key per line for the SQLite run below: the WHERE suffix, then each arg, tab-separated.
  for(int[] k:new int[][]{{0,2},{3,2},{2,2}}){java.util.List<String> bound=new java.util.ArrayList<>();String where=PermittedMediaCatalog.after(k[0],5000,k[1],3,bound);
   System.out.println(where+"\\t"+String.join("\\t",bound));}
 }}`);
 const sources=path.dirname(path.join(media,'x'));const javaRoot=path.resolve(sources,'../../../..');
 execFileSync('javac',['-proc:none','-nowarn','-implicit:class','-d',path.join(work,'out'),'-cp',androidJar,'-sourcepath',javaRoot+path.delimiter+path.join(work,'stub'),path.join(work,'stub/ai/eliza/plugins/media/CatalogOrderCheck.java'),path.join(media,'PermittedMediaCatalog.java')],{timeout:120000,stdio:'pipe'});
 const keys=execFileSync('java',['-cp',path.join(work,'out')+path.delimiter+androidJar,'ai.eliza.plugins.media.CatalogOrderCheck'],{encoding:'utf8',timeout:60000}).trimEnd().split('\n').map(line=>{const [where,...args]=line.split('\t');return {where,args};});
 // Android binds every selection arg as TEXT. Run each page key on a real SQLite table with the
 // args bound as strings: SHOT has no column affinity, so an uncast "?" would match every row.
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE files(_id INTEGER PRIMARY KEY, datetaken INTEGER, date_added INTEGER)');
 // shot 6000, 5000 (_id 2, 3, 4), 4000 via date_added, 1000.
 db.exec('INSERT INTO files VALUES (1,6000,0),(2,5000,0),(3,5000,0),(4,5000,0),(5,0,4),(6,1000,0)');
 const page=key=>db.prepare('SELECT _id FROM files WHERE 1=1'+key.where+' ORDER BY _id').all(...key.args).map(row=>row._id);
 assert.deepEqual(keys.map(key=>key.args.every(arg=>typeof arg==='string')),[true,true,true]);
 assert.deepEqual(page(keys[0]),[5,6],'an earlier source continues below the time');
 assert.deepEqual(page(keys[1]),[2,3,4,5,6],'a later source keeps rows at the same time');
 assert.deepEqual(page(keys[2]),[2,5,6],'the same source continues below the _id');
});

test('Photos grid thumbnails can be read again by id, so off-screen rows drop theirs',{skip:!ready&&'vendor/eliza not checked out'},async()=>{
 const plugin=await source('PhotosPlugin'),catalog=await source('PermittedMediaCatalog');
 const thumbnails=method(plugin,'public void thumbnails(PluginCall call)');
 assert.match(plugin,/@PluginMethod\n  public void thumbnails\(PluginCall call\)/);
 assert.match(thumbnails,/ids\.length\(\) > OwnedMediaLibrary\.PAGE/);
 assert.match(thumbnails,/PhotoLibraryAccess\.permitted\(id\) \? permitted\.thumbnailOf\(id, 240\)\s*: owned\.preview\(id, 240\)/);
 const of=method(catalog,'public String thumbnailOf(String id, int size)');
 assert.match(of,/readable\(key\.video\)/);assert.match(of,/volumes\(\)\.contains\(key\.volume\)/);
 const js=fs.readFileSync(path.join(root,'apps/app/src/prototype/camera-adapter.ts'),'utf8');
 assert.match(js,/thumbnailPlan\(rows\.map\(row=>live\.get\(row\.id\)\?\?row\),from,to,LIBRARY_LIMITS\.thumbnailsKept\)/);
});

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
   target=new File(directory,"published-photo"); Files.write(target.toPath(),current);
   File backups=new File(directory,"photo-replace-backups"); check(backups.mkdir(),"create backups");
   original=new File(backups,TOKEN+".original"); Files.write(original.toPath(),ORIGINAL);
   edited=new File(backups,TOKEN+".edited");
   if(retainEdit) Files.write(edited.toPath(),EDITED);
   record=new JSONObject().put("replace",true).put("status","writing").put("id","1")
    .put("backup",original.getName()).put("original",hash(ORIGINAL)).put("edited",hash(EDITED));
   if(retainEdit) record.put("editBackup",edited.getName());
   context=new Context(directory,target);
   saveRecord();
   OwnedMediaConfig config=OwnedMediaConfig.builder("fixture").edits("Pictures/Fixture/","edit_").captures("DCIM/Fixture/","capture_").build();
   recovery=new OwnedPhotoEdits(context,config,new OwnedPhotoEdits.SourceAccess() {
    public boolean accepts(String id) { return id.equals("1"); }
    public Uri source(String id) { return Uri.parse("content://fixture/1"); }
    public String revision(String id) { return "fixture-revision"; }
   });
  }
  void saveRecord() { context.preferences.values.put(TOKEN,record.toString()); }
  void expect(String status,byte[] expected,int writes,boolean keepBackups) throws Exception {
   String actualStatus=recovery.result(TOKEN).getString("status");
   check(Arrays.equals(expected,Files.readAllBytes(target.toPath())),directory.getName()+" preserved bytes");
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
  new Case(root,"external",external,true).expect("unknown",external,0,true);
  new Case(root,"complete",EDITED,true).expect("saved",EDITED,0,false);
  new Case(root,"unchanged",ORIGINAL,true).expect("failed",ORIGINAL,0,false);
  new Case(root,"prefix",Arrays.copyOf(EDITED,9),true).expect("failed",ORIGINAL,1,false);
  new Case(root,"restore-retry",Arrays.copyOf(ORIGINAL,8),true).expect("failed",ORIGINAL,1,false);
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
 execFileSync(javaBinary('javac'),['-proc:none','-nowarn','-implicit:none','-d',path.join(work,'out'),'-cp',classpath,...sources],{timeout:120000,stdio:'pipe'});
 assert.equal(execFileSync(javaBinary('java'),['-cp',path.join(work,'out')+path.delimiter+classpath,'ai.eliza.plugins.media.PhotoRecoveryCheck',path.join(work,'data')],{encoding:'utf8',timeout:60000}).trim(),'ok');
});
