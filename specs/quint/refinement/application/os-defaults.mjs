import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {javaBinary,jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {compileKotlin,kotlinJars} from '../../../../test/fixtures/kotlin-tools.mjs';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {androidPorts,compileJava,javaJson,materialize,root} from './os-host-support.mjs';
import {scaledTimeout} from '../timeouts.mjs';

const driver=fileURLToPath(import.meta.url),folder='android/aosp/branding/core-launcher/';
const tilePath='packages/SystemUI/src/com/android/systemui/qs/pipeline/data/repository/UserTileSpecRepository.kt';
const baseline='specs/quint/refinement/application/os-defaults-user-tiles.before.kt';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function method(source,anchor){
 const start=source.indexOf(anchor);assert.ok(start>=0,'Source method anchor: '+anchor);assert.equal(source.indexOf(anchor,start+1),-1,'Unique source method');
 let end=source.indexOf('{',start),depth=1;while(depth&&++end<source.length){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}
 assert.equal(depth,0);return source.slice(start,end+1);
}
const kotlinProbe=(load,store,defaults)=>`
import kotlin.coroutines.*
annotation class UserIdInt
open class TileSpec(val spec:String) {
 class Invalid:TileSpec("")
 companion object {fun create(spec:String)=TileSpec(spec)}
}
object TilesUpgradePath {class ReadFromSettings(val tiles:Set<TileSpec>);object DefaultSet}
class Events {suspend fun send(value:Any){}}
suspend fun<T> withContext(dispatcher:Any,body:suspend()->T):T=body()
object AlphaQsDefaultsPolicy {
 private val source=Class.forName("com.android.systemui.qs.pipeline.data.repository.AlphaQsDefaultsPolicy")
 val ALPHA=source.getField("ALPHA").get(null) as String
 val VERSION=source.getField("VERSION").getInt(null)
 val VERSION_SETTING=source.getField("VERSION_SETTING").get(null) as String
 @Suppress("UNCHECKED_CAST")
 fun migrate(saved:List<String>,defaults:List<String>,version:Int):List<String> =
  source.getMethod("migrate",List::class.java,List::class.java,Int::class.javaPrimitiveType).invoke(null,saved,defaults,version) as List<String>
}
val stock="internet,bt,dnd,cast,flashlight,airplane,rotation,wallet,alarm,controls,screenrecord,battery"
val defaultLayouts=listOf(${defaults.map(value=>JSON.stringify(value)).join(',')})
fun layout(value:String)=when(value){
 stock->"stock"
 defaultLayouts[0],defaultLayouts[1]->"alpha"
 else->"custom"
}
fun quote(s:String)="\\\""+s.replace("\\\\","\\\\\\\\").replace("\\\"","\\\\\\\"")+"\\\""
fun json(v:Any?):String=when(v){null->"null";is String->quote(v);is Map<*,*>->v.entries.joinToString(",","{","}"){quote(it.key.toString())+":"+json(it.value)};is Iterable<*>->v.joinToString(",","[","]"){json(it)};else->v.toString()}
fun action(name:String,vararg args:Any)=mapOf("name" to name,"args" to args.toList())
fun<T> sync(body:suspend()->T):T {var result:Result<T>?=null;body.startCoroutine(object:Continuation<T>{override val context=EmptyCoroutineContext;override fun resumeWith(value:Result<T>){result=value}});return result!!.getOrThrow()}
class Secure {
 var saved=stock;var version=0;var defaults=defaultLayouts.first();var layoutOk=true;var versionOk=true;var versionCalls=0;var written=false
 fun getIntForUser(key:String,fallback:Int,user:Int)=version
 fun putStringForUser(key:String,value:String,tag:Any?,makeDefault:Boolean,user:Int,overrideable:Boolean):Boolean {
  if(layoutOk){saved=value;written=true};Probe.mark("Actual layout write result",action("storeLayout",layoutOk));return layoutOk
 }
 fun putIntForUser(key:String,value:Int,user:Int):Boolean {versionCalls++;if(versionOk)version=value;return versionOk}
}
class Repository(val secureSettings:Secure) {
 val backgroundDispatcher=Any();val SETTING="sysui_qs_tiles";val DELIMITER=",";val defaultTiles=secureSettings.defaults.split(",").map(::TileSpec)
 val _tilesUpgradePath=Events();var alphaDefaultsMigrationPending=false;var selected=secureSettings.saved.split(",").map(::TileSpec)
 suspend fun loadTilesFromSettings(user:Int)=secureSettings.saved.split(",").map(::TileSpec)
 fun parseTileSpecs(tiles:List<TileSpec>,user:Int)=tiles
 ${load}
 ${store}
 fun load(){secureSettings.written=false;selected=sync{loadTilesFromSettingsAndParse(0)}}
 fun store(){sync{storeTiles(0,selected)}}
}
object Probe {
 val traces=mutableListOf<Any>();lateinit var repo:Repository;lateinit var secure:Secure;lateinit var steps:MutableList<Any>
 fun selected()=repo.selected.joinToString(","){it.spec}
 fun state()=mapOf("s.saved" to layout(secure.saved),"s.selected" to layout(selected()),"s.version" to secure.version,"s.pending" to repo.alphaDefaultsMigrationPending,"s.written" to secure.written)
 fun mark(label:String,action:Any?){steps.add(mapOf("label" to label,"action" to action,"expect" to state()))}
 fun setup(name:String,version:Int=0,saved:String=stock,defaults:String=defaultLayouts.first()){
  secure=Secure();secure.version=version;secure.saved=saved;secure.defaults=defaults
  repo=Repository(secure);steps=mutableListOf()
  val initial=if(version==0)action("init")else action("initReviewed",layout(saved),version)
  traces.add(mapOf("name" to name,"init" to initial,"expect" to state(),"steps" to steps))
 }
 fun load(){repo.load();mark("Actual patched settings load",action("load"))}
 fun store(layout:Boolean,version:Boolean){secure.layoutOk=layout;secure.versionOk=version;val before=secure.versionCalls;repo.store();if(secure.versionCalls>before)mark("Actual version commit after layout",action("storeVersion",version))}
 fun restart(){secure.written=false;repo=Repository(secure);mark("New repository over retained settings",action("restart"))}
 fun owner(value:String){secure.saved=if(value=="stock")stock else "wifi,flashlight";repo.selected=secure.saved.split(",").map(::TileSpec);secure.written=false;mark("External owner layout before serialized collection",action("ownerLayout",value))}
 fun run(){
  setup("layout-write-failure");load();store(false,true);check(secure.version==0&&secure.versionCalls==0)
  check(AlphaQsDefaultsPolicy.VERSION==3)
  setup("version-retry-and-later-owner-stock");load();store(true,false);check(secure.version==0&&secure.saved==secure.defaults);restart();load();store(true,true);check(secure.version==3);owner("stock");restart();load();check(selected()==stock)
  setup("custom-layout-retained");owner("custom");load();store(true,true);check(layout(secure.saved)=="custom"&&secure.version==3)
  for((index,defaults) in defaultLayouts.withIndex()){
   setup("reviewed-v2-stock-choice-is-not-reset-"+index,2,stock,defaults);load()
   check(defaults!=stock&&selected()==stock&&selected()!=defaults)
   store(true,true);check(secure.saved==stock&&secure.version==3)
  }
  setup("reviewed-v2-unrelated-custom-retained",2,"wifi,flashlight");load();check(selected()=="wifi,flashlight")
  store(true,true);check(secure.saved=="wifi,flashlight"&&secure.version==3)
  setup("reviewed-v3-custom-untouched",3,"wifi,flashlight");load();check(selected()=="wifi,flashlight")
  store(true,true);check(secure.saved=="wifi,flashlight"&&secure.version==3&&secure.versionCalls==0)
  println(json(traces))
 }
}
fun main(){Probe.run()}
`;

const appopProbe=(grant,identity)=>`package com.android.server.pm.permission;
import android.content.*;import android.content.pm.*;import android.app.*;import android.app.admin.*;import android.os.*;import android.Manifest;import android.util.Log;import org.json.*;import java.util.*;
public class AppopProbe {
 final Context mContext=new Context();static final String TAG="probe";final AppOpsManager ops=new AppOpsManager();final DevicePolicyManager policy=new DevicePolicyManager();
 static final class PackageManagerWrapper {PackageInfo pkg=new PackageInfo();PackageInfo getSystemPackageInfo(String name){return pkg;}}
 ${grant}
 static JSONObject action(String name,Object...args){return new JSONObject().put("name",name).put("args",new JSONArray(Arrays.asList(args)));}
 JSONObject state(){return new JSONObject().put("s.appop",ops.mode==AppOpsManager.MODE_DEFAULT?"unset":ops.mode==AppOpsManager.MODE_ALLOWED?"allow":"deny").put("s.eligible",!policy.managed).put("s.writeAuthorized",ops.authorized);}
 public static void main(String[] args){JSONArray traces=new JSONArray();
  for(String kind:List.of("fresh","denied","allowed","managed")){
   AppopProbe p=new AppopProbe();p.mContext.services.put(DevicePolicyManager.class,p.policy);p.mContext.services.put(AppOpsManager.class,p.ops);p.ops.policy=p.policy;
   JSONObject trace=new JSONObject().put("name","shared-storage-"+kind).put("init",action("init")).put("expect",p.state()).put("steps",new JSONArray());traces.put(trace);JSONArray steps=trace.getJSONArray("steps");
   if(kind.equals("managed")){p.policy.managed=true;steps.put(new JSONObject().put("label","Managed authority").put("action",action("context",false)).put("expect",p.state()));}
   if(kind.equals("allowed")||kind.equals("denied")){p.ops.mode=kind.equals("allowed")?AppOpsManager.MODE_ALLOWED:AppOpsManager.MODE_IGNORED;steps.put(new JSONObject().put("label","Explicit owner mode").put("action",action("ownerAppop",kind.equals("allowed")?"allow":"deny")).put("expect",p.state()));}
   p.grantAlphaSharedStorageDefault(new PackageManagerWrapper(),0);steps.put(new JSONObject().put("label","Actual patched grant method").put("action",action("defaultAppop")).put("expect",p.state()));
   if(p.ops.writes!=(kind.equals("fresh")?1:0))throw new AssertionError("Grant escaped policy: "+kind);
  }
  for(int mask=0;mask<16;mask++)for(String name:List.of(${JSON.stringify(identity)},"other")){
   boolean active=(mask&1)!=0,system=(mask&2)!=0,home=(mask&4)!=0;
   boolean actual=com.android.systemui.qs.AlphaCoreLauncherPolicy.protects(name,active,system,home);
   if(actual!=(name.equals(${JSON.stringify(identity)})&&active&&system&&home))throw new AssertionError("Core launcher scope");
  }
  for(int mask=0;mask<32;mask++)for(int user:List.of(0,10)){
   boolean active=(mask&1)!=0,system=(mask&2)!=0,requested=(mask&4)!=0,unset=(mask&8)!=0,rightName=(mask&16)!=0;
   if(AlphaSharedStoragePolicy.shouldGrant(user,rightName?AlphaSharedStoragePolicy.PACKAGE:"other",active,system,requested,unset)!=(user==0&&rightName&&active&&system&&requested&&unset))throw new AssertionError("Storage predicate scope");
  }
  System.out.println(traces);
 }
}`;

export async function checkOSDefaults(extraSources=[]){
 const jars=kotlinJars(),sources=[driver,baseline,'app.config.json','specs/quint/refinement/application/os-host-support.mjs','test/fixtures/jvm-tools.mjs','test/fixtures/kotlin-tools.mjs',
  'android/gradle/verification-metadata.xml',jsonJar,...jars,...['manifest.json','alpha-core-launcher.patch','AlphaCoreLauncherPolicy.java','AlphaQsDefaultsPolicy.java','AlphaSharedStoragePolicy.java'].map(name=>folder+name),...extraSources];
 sources.push('test/fixtures/jvm-tools.mjs','scripts/prepare-patched-native.ts','scripts/upstream-native-source.ts','specs/quint/refinement/application/index.mjs','test/quint-application-refinement.test.mjs');
 const before=captureInputs(sources),temporary=mkdtempSync(join(tmpdir(),'alpha-os-defaults-'));
 try{
  const identity=JSON.parse(readFileSync(resolve(root,'app.config.json'),'utf8')).appId;
  const manifest=JSON.parse(readFileSync(resolve(root,folder+'manifest.json'))),row=manifest.files.find(row=>row.path===tilePath);
  for(const name of ['AlphaCoreLauncherPolicy.java','AlphaQsDefaultsPolicy.java','AlphaSharedStoragePolicy.java'])assert.equal(hash(readFileSync(resolve(root,folder+name))),manifest.files.find(row=>row.path.endsWith('/'+name)).afterSha256);
  assert.equal(hash(readFileSync(resolve(root,baseline))),row.beforeSha256);assert.equal(hash(readFileSync(resolve(root,folder+manifest.patch))),manifest.patchSha256);
  const original=materialize(temporary,{[tilePath]:readFileSync(resolve(root,baseline),'utf8')})[0];
  execFileSync('git',['apply','--include='+tilePath,resolve(root,folder+manifest.patch)],{cwd:temporary,stdio:'pipe'});
  assert.equal(hash(readFileSync(original)),row.afterSha256);const tileSource=readFileSync(original,'utf8');
  const patch=readFileSync(resolve(root,folder+manifest.patch),'utf8').split('\n').filter(line=>line.startsWith(' ')||(line.startsWith('+')&&!line.startsWith('+++'))).map(line=>line.slice(1)).join('\n');
  const defaults=[...patch.matchAll(/<string name="quick_settings_tiles_default(?:_split)?"[^>]*>\s*([^<]+)<\/string>/g)].map(match=>match[1].trim());
  assert.equal(defaults.length,2,'Both reviewed Quick Settings resource defaults');
  const grant=method(patch,'    private void grantAlphaSharedStorageDefault(');
  const generated=materialize(temporary,{...androidPorts(identity),
   'Probe.kt':kotlinProbe(method(tileSource,'    private suspend fun loadTilesFromSettingsAndParse('),method(tileSource,'    private suspend fun storeTiles('),defaults),
   'com/android/server/pm/permission/AppopProbe.java':appopProbe(grant,identity),
   'android/Manifest.java':`package android;public class Manifest {public static class permission {public static final String MANAGE_EXTERNAL_STORAGE="storage";}}`,
   'android/util/Log.java':`package android.util;public class Log {public static void w(String tag,String message,Throwable error){}}`,
   'com/android/internal/util/ArrayUtils.java':`package com.android.internal.util;public class ArrayUtils {public static boolean contains(String[] values,String value){return java.util.Arrays.asList(values).contains(value);}}`,
   'android/content/pm/PackageInfo.java':`package android.content.pm;public class PackageInfo {public String packageName=${JSON.stringify(identity)};public String[] requestedPermissions={"storage"};public ApplicationInfo applicationInfo=new ApplicationInfo();}`,
   'android/app/AppOpsManager.java':`package android.app;import android.app.admin.*;public class AppOpsManager {public static final String OPSTR_MANAGE_EXTERNAL_STORAGE="storage";public static final int MODE_DEFAULT=3,MODE_ALLOWED=0,MODE_IGNORED=1;public int mode=MODE_DEFAULT,writes;public boolean authorized=true;public DevicePolicyManager policy;public int unsafeCheckOpRawNoThrow(String op,int uid,String name){return mode;}public void setUidMode(String op,int uid,int value){authorized&=uid<100000&&!policy.managed;writes++;mode=value;}}`,
  });
  // The reconstructed source is retained too: its exact after-image is the manifest-bound input.
  generated.push(original);const driverHashes={...before,...captureInputs(generated)};
  const classes=join(temporary,'classes');mkdirSync(classes);
  compileJava([...generated.filter(path=>path.endsWith('.java')),...['AlphaCoreLauncherPolicy.java','AlphaQsDefaultsPolicy.java','AlphaSharedStoragePolicy.java'].map(name=>resolve(root,folder+name))],classes);
  const runtime=compileKotlin([join(temporary,'Probe.kt')],join(temporary,'kotlin-classes'));
  const traces=JSON.parse(execFileSync(javaBinary('java'),['-cp',classes+':'+runtime,'ProbeKt'],{encoding:'utf8',timeout:scaledTimeout(120000)}));
  traces.push(...javaJson(classes,'com.android.server.pm.permission.AppopProbe'));assert.equal(traces.length,11);
  return await checkTraces({model:'OSDefaults',sources:[...sources,...generated],driverHashes,generatedSources:generated,traces,scope:'bounded-orchestration',assumptions:[
   'The pinned AOSP Kotlin source is reconstructed by the actual reviewed patch and checked against both manifest hashes. Exact load/store methods execute with the actual Java migration policy. The exact patched shared-storage grant method and both Java identity policies execute on the host JVM.',
   'The settings collector is serialized and supplies finite stock/custom/Alpha tile lists; both factory defaults are read from the authenticated patch. Version-2 owner-selected stock and custom layouts remain retained; both factory lists explicitly fail a reset-to-default check for a version-2 stock choice. Coroutine context, parser, upgrade-event and Android service ports are synthetic; this proves the selected methods and write ordering, not coroutine/observer races, arbitrary tile parsing, Android service enforcement, multi-user process death or AOSP image boot.',
   'Owner layout changes are observed at a serialized collector boundary with its selected input supplied by that owner. The written field records successful layout writes since load/restart/owner change; core-launcher and shared-storage predicate matrices are direct source assertions in addition to state traces.',
  ]});
 }finally{rmSync(temporary,{recursive:true,force:true});}
}
