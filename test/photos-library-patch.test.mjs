// patches/eliza/photos-library.patch on the patched source (Photos review findings). The Android paths
// themselves are device-checked by the Photos instrumented tests; this pins the rules in the patched code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
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
  java.util.List<String> v=new java.util.ArrayList<>();
  check(PermittedMediaCatalog.after(0,5000,2,1,v).equals(" AND "+PermittedMediaCatalog.SHOT+"<?")&&v.equals(java.util.List.of("5000")),"an earlier source continues below the time");
  v.clear();check(PermittedMediaCatalog.after(3,5000,2,1,v).equals(" AND "+PermittedMediaCatalog.SHOT+"<=?")&&v.equals(java.util.List.of("5000")),"a later source keeps rows at the same time");
  v.clear();check(PermittedMediaCatalog.after(2,5000,2,1,v).equals(" AND ("+PermittedMediaCatalog.SHOT+"<? OR ("+PermittedMediaCatalog.SHOT+"=? AND _id<?))")&&v.equals(java.util.List.of("5000","5000","1")),"the same source continues below the _id");
  check(PermittedMediaCatalog.SHOT.equals("ifnull(nullif(datetaken,0),date_added*1000)"),"capture time, else date added");
  System.out.println("ok");
 }}`);
 const sources=path.dirname(path.join(media,'x'));const javaRoot=path.resolve(sources,'../../../..');
 execFileSync('javac',['-proc:none','-nowarn','-implicit:class','-d',path.join(work,'out'),'-cp',androidJar,'-sourcepath',javaRoot+path.delimiter+path.join(work,'stub'),path.join(work,'stub/ai/eliza/plugins/media/CatalogOrderCheck.java'),path.join(media,'PermittedMediaCatalog.java')],{timeout:120000,stdio:'pipe'});
 assert.equal(execFileSync('java',['-cp',path.join(work,'out')+path.delimiter+androidJar,'ai.eliza.plugins.media.CatalogOrderCheck'],{encoding:'utf8',timeout:60000}).trim(),'ok');
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
