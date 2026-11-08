import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
// Real consumer request/callback methods against a JVM model of Capacitor's plugin-ID queues.
// This reproduces callback ownership; it does not establish real Android permission acceptance.
function method(source,signature){const start=source.indexOf(signature);assert.notEqual(start,-1,signature);let end=source.indexOf('{',start),depth=1;for(end++;depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}return source.slice(start,end);}
test('photo permission facade receives its own callback after full, selected and denied grants',()=>{
 // AlphaPhotos and AlphaPhotoLibrary are registrations of plugin-native-media's PhotosPlugin and
 // DeviceLibraryPlugin: the request and callback methods exercised here are the shared ones.
 const alphaFacade=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaPhotoLibraryPlugin.java','utf8');
 const alphaPhotos=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaPhotosPlugin.java','utf8');
 const media='vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/';
 const facade=readFileSync(media+'DeviceLibraryPlugin.java','utf8');
 const access=readFileSync(media+'PhotoLibraryAccess.java','utf8');
 assert.match(alphaFacade,/extends DeviceLibraryPlugin \{/);assert.match(alphaPhotos,/extends PhotosPlugin \{/);
 assert.match(alphaFacade,/protected String photosPluginName\(\)\{return "AlphaPhotos";\}/);
 const constants=[...access.matchAll(/public static final int (SELECTED_SDK|MEDIA_PERMISSIONS_SDK) = \d+;/g)].map(row=>row[0]).join('\n');
 assert.equal(constants.split('\n').length,2);
 const capacitor=readFileSync('node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Plugin.java','utf8');
 const bridge=readFileSync('node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Bridge.java','utf8');
 assert.match(capacitor,/PluginCall savedCall = bridge\.getPermissionCall\(handle\.getId\(\)\)/);
 assert.match(bridge,/savedPermissionCallIds\.get\(call\.getPluginId\(\)\)\.add\(call\.getCallbackId\(\)\)/);
 const permissionRows=source=>[...source.matchAll(/@Permission\(alias="([^"]+)",strings=\{"([^"]+)"\}\)/g)].map(row=>row.slice(1));
 assert.deepEqual(permissionRows(alphaFacade),permissionRows(alphaPhotos),'both entrypoints declare the same real Android grants');
 assert.deepEqual(permissionRows(alphaFacade).map(row=>row[0]),['libraryLegacy','libraryImages','libraryVideos','librarySelected']);
 const body=`
import java.util.*;
@interface PluginMethod {} @interface PermissionCallback {}
class Build {static class VERSION {static int SDK_INT;}}
class PluginCall {final String pluginId;int resolves,rejects;Map<String,String> result;PluginCall(String id){pluginId=id;}void resolve(Map<String,String> value){resolves++;result=value;}void reject(String error){rejects++;}}
class Activity {boolean focused=true;boolean hasWindowFocus(){return focused;}}
class Catalog {String scope="denied";int invalidations,reads;void invalidate(){invalidations++;}}
class Bridge {
 final Map<String,ArrayDeque<PluginCall>> queues=new HashMap<>();String[] requested;
 void savePermissionCall(PluginCall call){queues.computeIfAbsent(call.pluginId,key->new ArrayDeque<>()).add(call);}
 void complete(Plugin plugin)throws Exception {ArrayDeque<PluginCall> q=queues.get(plugin.id);PluginCall call=q==null?null:q.poll();if(call==null)return;var callback=plugin.getClass().getDeclaredMethod("libraryPermissionResult",PluginCall.class);callback.setAccessible(true);callback.invoke(plugin,call);}
}
class Plugin {final String id;final Bridge bridge;final Activity activity=new Activity();Plugin(String id,Bridge bridge){this.id=id;this.bridge=bridge;}Activity getActivity(){return activity;}void requestPermissionForAliases(String[] aliases,PluginCall call,String callback){bridge.requested=aliases;bridge.savePermissionCall(call);}public void requestPermissions(PluginCall call){throw new AssertionError("Do not request all API-level aliases");}}
class PhotoLibraryAccess {
 ${constants}
 ${method(access,'public static String[] permissionAliases(int sdk)')}
}
class PhotosPlugin extends Plugin {
 PhotosPlugin(Bridge bridge){super("AlphaPhotos",bridge);}
 static String[] libraryPermissionAliases(){return PhotoLibraryAccess.permissionAliases(Build.VERSION.SDK_INT);}
 void requestLibraryAccess(PluginCall call){requestPermissionForAliases(libraryPermissionAliases(),call,"libraryPermissionResult");}
 private void libraryPermissionResult(PluginCall call){call.resolve(Map.of("scope","full"));}
}
class AlphaPhotoLibraryPlugin extends Plugin {
 boolean destroyed;final Catalog catalog=new Catalog();AlphaPhotoLibraryPlugin(Bridge bridge){super("AlphaPhotoLibrary",bridge);}
 Map<String,String> scopeResult(){return Map.of("scope",catalog.scope);}
 String closedMessage(){return "closed";}
 ${method(facade,'public void requestAccess(PluginCall call)')}
 ${method(facade,'private void libraryPermissionResult(PluginCall call)')}
 ${method(facade,'public void requestPermissions(PluginCall call)')}
}
public class PermissionOwnerHarness {
 static void check(boolean value){if(!value)throw new AssertionError();}
 public static void main(String[] args)throws Exception {
  Bridge old=new Bridge();PluginCall lost=new PluginCall("AlphaPhotoLibrary");PhotosPlugin delegate=new PhotosPlugin(old);delegate.requestLibraryAccess(lost);old.complete(delegate);check(lost.resolves==0&&old.queues.get("AlphaPhotoLibrary").size()==1);
  for(int sdk:new int[]{32,33,34,36})for(String scope:new String[]{"full","selected","denied"})for(boolean inherited:new boolean[]{false,true}){
   Build.VERSION.SDK_INT=sdk;Bridge bridge=new Bridge();AlphaPhotoLibraryPlugin library=new AlphaPhotoLibraryPlugin(bridge);PluginCall call=new PluginCall("AlphaPhotoLibrary");
   if(inherited)library.requestPermissions(call);else library.requestAccess(call);check(call.resolves==0&&call.rejects==0);
   String[] expected=sdk>=34?new String[]{"libraryImages","libraryVideos","librarySelected"}:sdk>=33?new String[]{"libraryImages","libraryVideos"}:new String[]{"libraryLegacy"};check(Arrays.equals(bridge.requested,expected));
   library.catalog.scope=scope;bridge.complete(library);check(call.resolves==1&&call.rejects==0&&call.result.get("scope").equals(scope)&&library.catalog.invalidations==1&&library.catalog.reads==0);check(bridge.queues.get("AlphaPhotoLibrary").isEmpty());
  }
  Bridge bridge=new Bridge();AlphaPhotoLibraryPlugin library=new AlphaPhotoLibraryPlugin(bridge);library.activity.focused=false;PluginCall late=new PluginCall("AlphaPhotoLibrary");library.requestAccess(late);check(late.rejects==1&&bridge.requested==null);
  library.activity.focused=true;library.destroyed=true;PluginCall closed=new PluginCall("AlphaPhotoLibrary");library.requestAccess(closed);check(closed.rejects==1&&bridge.requested==null);
  library.destroyed=false;PluginCall interrupted=new PluginCall("AlphaPhotoLibrary");library.requestAccess(interrupted);library.destroyed=true;bridge.complete(library);check(interrupted.rejects==1&&interrupted.resolves==0&&library.catalog.invalidations==0);
  System.out.println("PASS permission owner, OS aliases, scope readback, no data read and foreground guards");
 }
}`;
 const dir=mkdtempSync(join(tmpdir(),'alpha-photo-permission-owner-'));
 try{const file=join(dir,'PermissionOwnerHarness.java');writeFileSync(file,body);const bin=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;execFileSync(bin('javac'),['--release','11','-d',dir,file],{stdio:'pipe'});assert.match(execFileSync(bin('java'),['-cp',dir,'PermissionOwnerHarness'],{encoding:'utf8'}),/PASS permission owner/);}finally{rmSync(dir,{recursive:true,force:true});}
});
