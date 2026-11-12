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
 if(!media){const {preparePatchedNative}=await import('../scripts/prepare-patched-native.ts');media=path.join(preparePatchedNative({root}).root,'plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media');}
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
 assert.match(thumbnails,/PhotoLibraryAccess\.permitted\(id\)\s*\? permitted\.read\(id, null, true, false, 240\)\.getString\("image"\)\s*: owned\.preview\(id, 240\)/);
 const read=method(catalog,'public JSObject read(String id, String expectedRevision, boolean pixels, boolean trashed,\n      int edge)');
 assert.match(read,/volumes\.contains\(key\.volume\)/);
 assert.match(read,/result\.put\("image", thumbnail\(key, edge\)\)/);
 assert.match(read,/revision\.equals\(inspect\(key, trashed\)\.getString\("revision"\)\)/);
 assert.match(read,/current\(snapshot, volumes\)/);
 const inspect=method(catalog,'private JSObject inspect(MediaLibraryKey key, boolean includeTrash)');
 assert.match(inspect,/unlocked\(\)/);assert.match(inspect,/query\(key\.volume, key\.video, args\)/);
 assert.match(catalog,/if \(!readable\(video\)\)/);
 const js=fs.readFileSync(path.join(root,'apps/app/src/prototype/camera-adapter.ts'),'utf8');
 assert.match(js,/const visible=rows\.filter\(row=>live\.has\(row\.id\)\)\.map\(row=>live\.get\(row\.id\)!\)/);
 assert.match(js,/thumbnailPlan\(visible,from,to,LIBRARY_LIMITS\.thumbnailsKept\)/);
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
 execFileSync(javaBinary('javac'),['-proc:none','-nowarn','-implicit:none','-d',path.join(work,'out'),'-cp',classpath,...sources],{timeout:120000,stdio:'pipe'});
 assert.equal(execFileSync(javaBinary('java'),['-cp',path.join(work,'out')+path.delimiter+classpath,'ai.eliza.plugins.media.PhotoRecoveryCheck',path.join(work,'data')],{encoding:'utf8',timeout:60000}).trim(),'ok');
});

test('Photos 8: list skips thumbnail decoding when asked (thumbnails:false), owned and permitted alike',{skip:!ready&&'vendor/eliza not checked out'},async()=>{
 const plugin=await source('PhotosPlugin'),owned=await source('OwnedMediaLibrary');
 const list=method(plugin,'public void list(');
 assert.match(list,/boolean thumbnails = call\.getBoolean\("thumbnails", true\);/);
 assert.match(list,/permitted\.list\(call\.getString\("before", ""\), "", listing\[0\], thumbnails, listing\[1\],/);
 assert.match(list,/owned\.list\(call\.getString\("before", ""\), trashed, album, limit, thumbnails\)/);
 assert.match(method(owned,'public JSObject list(String before, boolean trashed, String album, int limit, boolean thumbnails)'),/if \(thumbnails\) putPreview\(item, key\(rows\), 240\);/);
});

test('retired folder grants keep their recovery identity until release is confirmed', {skip:!ready&&'vendor/eliza not checked out'}, async t => {
 const tree=await source('DocumentFolderTree');
 const forget=method(tree,'public JSObject forget()')+'\n  }';
 const adopt=method(tree,'public JSObject adopt(')+'\n  }';
 const keptMessage=method(tree,'private static String keptMessage(')+'\n  }';
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-folder-retirement-'));
 t.after(()=>fs.rmSync(work,{recursive:true,force:true}));
 // Execute the actual two methods with controlled preference and Android grant boundaries.
 const java=`import java.util.*;
import java.util.concurrent.*;
public final class FolderRetirementCheck {
 static final String KEY="root";
 static final int GRANTS=3;
 final SharedPreferences preferences=new SharedPreferences();
 final Resolver grants=new Resolver();
 final Session session=new Session();
 final Retention retention=new Retention();
 Uri tree;
 static final class Uri {
  final String value; Uri(String value){this.value=value;}
  static Uri parse(String value){return new Uri(value);}
  String getScheme(){return "content";}
  public String toString(){return value;}
  public boolean equals(Object other){return other instanceof Uri&&value.equals(((Uri)other).value);}
  public int hashCode(){return value.hashCode();}
 }
 static final class UriPermission {
  final Uri uri; UriPermission(String value){uri=Uri.parse(value);}
  Uri getUri(){return uri;} boolean isReadPermission(){return true;} boolean isWritePermission(){return true;}
 }
 static final class Intent {static final int FLAG_GRANT_READ_URI_PERMISSION=1,FLAG_GRANT_WRITE_URI_PERMISSION=2;}
 static final class DocumentsContract {static boolean isTreeUri(Uri value){return true;}}
 static final class Session {void clear(){}}
 static final class Retention {final Map<String,Integer> links=new HashMap<>();int linked(Uri uri){return links.getOrDefault(uri.value,0);}}
 static final class JSObject extends HashMap<String,String> {String getString(String key){return get(key);}}
 static JSObject result(String status,String message){JSObject value=new JSObject();value.put("status",status);value.put("message",message);return value;}
 static final class SharedPreferences {
  volatile String value="old"; boolean failCommit;
  String getString(String key,String fallback){return value==null?fallback:value;}
  Editor edit(){return new Editor();}
  final class Editor {
   String pending; Editor putString(String key,String value){pending=value;return this;}
   Editor remove(String key){pending=null;return this;}
   boolean commit(){if(failCommit)return false;value=pending;return true;}
  }
 }
 final class Resolver {
  final List<UriPermission> values=new ArrayList<>(List.of(new UriPermission("old"),new UriPermission("document")));
  boolean failRelease,ignoreRelease; Runnable duringRelease;
  List<UriPermission> getPersistedUriPermissions(){return new ArrayList<>(values);}
  void releasePersistableUriPermission(Uri uri,int flags){
   if(failRelease)throw new SecurityException("unconfirmed");
   if(!ignoreRelease)values.removeIf(value->value.uri.equals(uri));
   if(duringRelease!=null)duringRelease.run();
  }
  void takePersistableUriPermission(Uri uri,int flags){values.add(new UriPermission(uri.value));}
 }
 SharedPreferences store(){return preferences;} Resolver resolver(){return grants;}
 Object root(){return null;} JSObject list(Object value){return result("ready","");}
 void release(String value){grants.values.removeIf(item->item.uri.value.equals(value));}
 ${keptMessage}
 ${adopt}
 ${forget}
 static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
 static boolean has(FolderRetirementCheck value,String uri){return value.grants.values.stream().anyMatch(item->item.uri.value.equals(uri));}
 public static void main(String[] args)throws Exception {
  FolderRetirementCheck failed=new FolderRetirementCheck();failed.grants.failRelease=true;
  try{failed.forget();throw new AssertionError("release succeeded");}catch(SecurityException expected){}
  check("old".equals(failed.preferences.value)&&has(failed,"old"),"failed release retains recovery identity");
  failed.grants.failRelease=false;failed.grants.ignoreRelease=true;
  check("failed".equals(failed.forget().get("status"))&&"old".equals(failed.preferences.value),"readback refuses unconfirmed release");
  failed.grants.ignoreRelease=false;failed.preferences.failCommit=true;
  check("failed".equals(failed.forget().get("status"))&&!has(failed,"old")&&"old".equals(failed.preferences.value),"failed preference commit stays retryable");
  failed.preferences.failCommit=false;
  check("forgotten".equals(failed.forget().get("status"))&&failed.preferences.value==null&&has(failed,"document"),"retry clears an absent old grant and keeps selected documents");
  FolderRetirementCheck stale=new FolderRetirementCheck();stale.tree=Uri.parse("old");stale.preferences.value="new";
  check("failed".equals(stale.forget().get("status"))&&"new".equals(stale.preferences.value)&&has(stale,"old"),"stale instance preserves a newer selection");
  FolderRetirementCheck changed=new FolderRetirementCheck();changed.grants.duringRelease=()->changed.preferences.value="new";
  check("failed".equals(changed.forget().get("status"))&&"new".equals(changed.preferences.value),"owner recheck preserves an external update");
  FolderRetirementCheck concurrent=new FolderRetirementCheck();CountDownLatch started=new CountDownLatch(1);List<Throwable> errors=new ArrayList<>();
  Thread next=new Thread(()->{started.countDown();try{concurrent.adopt(Uri.parse("new"),3);}catch(Throwable error){errors.add(error);}});
  concurrent.grants.duringRelease=()->{next.start();try{check(started.await(5,TimeUnit.SECONDS),"adopt thread starts");}catch(InterruptedException e){throw new AssertionError(e);}};
  check("forgotten".equals(concurrent.forget().get("status")),"old selection retired");next.join(5000);
  check(!next.isAlive()&&errors.isEmpty()&&"new".equals(concurrent.preferences.value)&&has(concurrent,"new"),"new adoption is serialized after retirement");
  FolderRetirementCheck linked=new FolderRetirementCheck();linked.retention.links.put("old",2);
  check("forgotten".equals(linked.forget().get("status"))&&linked.preferences.value==null&&has(linked,"old")&&has(linked,"document"),"forgetting a browsed folder preserves grants still owned by linked notes");
  FolderRetirementCheck replacingLinked=new FolderRetirementCheck();replacingLinked.retention.links.put("old",2);
  JSObject kept=replacingLinked.adopt(Uri.parse("new"),3);
  check("new".equals(replacingLinked.preferences.value)&&has(replacingLinked,"old")&&has(replacingLinked,"new")&&kept.getString("message").contains("2 linked notes"),"new adoption keeps and explains a linked previous grant");
  FolderRetirementCheck replacingUnlinked=new FolderRetirementCheck();replacingUnlinked.adopt(Uri.parse("new"),3);
  check(!has(replacingUnlinked,"old")&&has(replacingUnlinked,"new")&&has(replacingUnlinked,"document"),"unlinked previous access is released without disturbing document grants");
  System.out.println("ok");
 }
}`;
 const file=path.join(work,'FolderRetirementCheck.java');fs.writeFileSync(file,java);
 execFileSync(javaBinary('javac'),['-d',work,file],{timeout:120000,stdio:'pipe'});
 assert.equal(execFileSync(javaBinary('java'),['-cp',work,'FolderRetirementCheck'],{encoding:'utf8',timeout:60000}).trim(),'ok');
});
