package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.media.DocumentFolderTree;
import android.app.Activity;
import android.content.*;
import android.net.Uri;
import android.os.FileObserver;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.util.*;
import java.util.concurrent.*;

/** Files browser over shared storage with all-files access (storage* methods,
 * design/view-refresh-2026-11/PLAN.md section 4, decision F1). Storage paths are volume-relative
 * and checked by StorageBrowser.resolve; the renderer never names an absolute path or a provider
 * URI. The earlier user-selected SAF tree is gone: a tree an earlier version recorded under
 * {@link #PREF} has its persisted grant released once, on load. */
@CapacitorPlugin(name="AlphaFiles", permissions={@Permission(alias="legacyStorage",strings={android.Manifest.permission.READ_EXTERNAL_STORAGE,android.Manifest.permission.WRITE_EXTERNAL_STORAGE})})
public class AlphaFilesPlugin extends Plugin {
 /** Installed name of the preference where earlier versions recorded the chosen SAF tree. */
 static final String PREF="alpha-files-tree";
 /** Plugin.requestPermissions launches for a plugin that declares permissions (legacyStorage);
  * a late call is answered like every other Alpha plugin (LateLaunch). */
 @Override @PluginMethod public void requestPermissions(PluginCall call){LateLaunch.ask(call,()->super.requestPermissions(call));}
 @Override public void load(){PluginWorkers.submit(storageWorker,this::releaseRetiredTree,()->{});}
 /** Releases the grant of a tree an earlier version recorded; selected documents keep theirs. */
 private void releaseRetiredTree(){
  if(getContext().getSharedPreferences(PREF,Context.MODE_PRIVATE).getAll().isEmpty())return;
  try{new DocumentFolderTree(getContext(),PREF,uri->null).forget();}catch(Exception ignored){/* Retried on the next load. */}
 }
 private static JSObject result(String status,String message){return DocumentFolderTree.result(status,message);}
 private ContentResolver resolver(){return getContext().getContentResolver();}
 // ---- Storage browser (all-files access) ----
 private final ExecutorService storageWorker=Executors.newSingleThreadExecutor();
 private final StorageWatchSlot watch=new StorageWatchSlot();
 private final android.os.Handler main=new android.os.Handler(android.os.Looper.getMainLooper());
 private final Runnable changed=()->notifyListeners("storageChanged",new JSObject());
 private interface StorageWork {JSObject run(StorageBrowser browser)throws Exception;}
 private JSObject denied(){JSObject out=result("denied","Allow all-files access to browse storage.");out.put("access",StorageCatalog.access(getContext()));return out;}
 private void storage(PluginCall call,StorageWork task){PluginWorkers.submit(storageWorker,()->{
  try{
   if(!"granted".equals(StorageCatalog.access(getContext()))){call.resolve(denied());return;}
   StorageCatalog.Volume volume=StorageCatalog.volume(getContext(),call.getString("volume","primary"));
   if(volume==null){call.resolve(result("unavailable","This storage is not mounted."));return;}
   JSObject out=task.run(new StorageBrowser(volume.directory));if(!out.has("status"))out.put("status","ready");call.resolve(out);
  }catch(IllegalArgumentException e){call.resolve(result("invalid","Invalid name or path."));}
  catch(IllegalStateException e){call.resolve(result("exists","That name is already used here."));}
  catch(java.io.FileNotFoundException e){call.resolve(result("missing","This item is no longer there."));}
  catch(SecurityException e){call.resolve(denied());}
  catch(Exception e){call.resolve(result("failed","The operation could not be confirmed."));}
 },()->call.resolve(result("unavailable","Files closed.")));}
 private static List<String> strings(PluginCall call,String key,int max){
  JSArray array=call.getArray(key);if(array==null||array.length()<1||array.length()>max)throw new IllegalArgumentException();
  List<String> out=new ArrayList<>();Set<String> seen=new HashSet<>();
  for(int i=0;i<array.length();i++){String value=array.optString(i,null);if(value==null||!seen.add(value))throw new IllegalArgumentException();out.add(value);}
  return out;
 }
 private static JSObject row(StorageBrowser.Row r){JSObject o=new JSObject();o.put("path",r.path);o.put("name",r.name);o.put("directory",r.directory);o.put("mimeType",r.mime);o.put("size",r.size);o.put("modified",r.modified);if(r.directory)o.put("children",r.children);return o;}
 private static JSArray outcomes(List<StorageBrowser.Outcome> list){JSArray out=new JSArray();for(StorageBrowser.Outcome o:list){JSObject v=new JSObject();v.put("path",o.path);v.put("status",o.status);if(o.to!=null)v.put("to",o.to);out.put(v);}return out;}
 /** MediaStore follows moves, copies and trash so the categories stay queries over what is there. */
 private void scan(StorageBrowser browser,List<String> paths){
  List<String> files=new ArrayList<>();for(String p:paths)if(p!=null)files.add(new java.io.File(browser.root,p).getAbsolutePath());
  if(!files.isEmpty())android.media.MediaScannerConnection.scanFile(getContext(),files.toArray(new String[0]),null,null);
 }
 @PluginMethod public void storageState(PluginCall call){PluginWorkers.submit(storageWorker,()->{
  JSObject out=new JSObject();out.put("status","ready");String access=StorageCatalog.access(getContext());out.put("access",access);JSArray volumes=new JSArray();
  if("granted".equals(access))for(StorageCatalog.Volume v:StorageCatalog.volumes(getContext()))volumes.put(StorageCatalog.describe(v));
  out.put("volumes",volumes);call.resolve(out);
 },()->call.resolve(result("unavailable","Files closed.")));}
 /** Opens Android's "All files access" page for this app and reads access back on return. On API 29
  * it asks for the legacy storage permissions instead, or with {@code settings} (and once they are
  * granted) opens this app's details page, where they can be changed. */
 @PluginMethod public void storageRequestAccess(PluginCall call){
  if("unsupported".equals(StorageCatalog.access(getContext()))){JSObject out=new JSObject();out.put("status","ready");out.put("access","unsupported");call.resolve(out);return;}
  if(StorageCatalog.legacy()){
   if(!Boolean.TRUE.equals(call.getBoolean("settings"))&&!"granted".equals(StorageCatalog.access(getContext()))){LateLaunch.ask(call,()->requestPermissionForAlias("legacyStorage",call,"legacyStorageReturned"));return;}
   try{startActivityForResult(call,new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getContext().getPackageName())),"storageAccessReturned");}
   catch(RuntimeException e){call.resolve(result("unavailable","Android's app settings are unavailable."));}
   return;
  }
  Intent intent=new Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,Uri.parse("package:"+getContext().getPackageName()));
  try{startActivityForResult(call,intent,"storageAccessReturned");}
  catch(RuntimeException e){
   try{startActivityForResult(call,new Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION),"storageAccessReturned");}
   catch(RuntimeException again){call.resolve(result("unavailable","Android's file access settings are unavailable."));}
  }
 }
 @PermissionCallback private void legacyStorageReturned(PluginCall call){
  JSObject out=new JSObject();out.put("status","ready");out.put("access",StorageCatalog.access(getContext()));call.resolve(out);
 }
 @ActivityCallback private void storageAccessReturned(PluginCall call,ActivityResult response){
  if(call==null)return;JSObject out=new JSObject();out.put("status","ready");out.put("access",StorageCatalog.access(getContext()));call.resolve(out);
 }
 @PluginMethod public void storageList(PluginCall call){storage(call,b->{
  List<StorageBrowser.Row> rows=b.list(call.getString("path",""));JSArray entries=new JSArray();int n=0;
  for(StorageBrowser.Row r:rows){if(n++>=StorageBrowser.LIST_MAX)break;entries.put(row(r));}
  JSObject out=new JSObject();out.put("entries",entries);out.put("truncated",rows.size()>StorageBrowser.LIST_MAX);return out;
 });}
 @PluginMethod public void storageCategory(PluginCall call){storage(call,b->Boolean.TRUE.equals(call.getBoolean("countOnly",false))
  ?StorageCatalog.count(resolver(),primaryBrowser(),call.getString("category",""))
  :StorageCatalog.category(resolver(),primaryBrowser(),call.getString("category","")));}
 /** Categories are on the primary volume whichever volume the call named. */
 private StorageBrowser primaryBrowser(){StorageCatalog.Volume v=StorageCatalog.volume(getContext(),"primary");return new StorageBrowser(v==null?android.os.Environment.getExternalStorageDirectory():v.directory);}
 /** Candidates for the agent's read-only filter; the renderer applies the exact rules. */
 @PluginMethod public void storageQuery(PluginCall call){storage(call,b->{
  Double from=call.getDouble("from"),to=call.getDouble("to");long since=from==null?0:from.longValue(),until=to==null?0:to.longValue();
  JSObject out=new JSObject();
  // MediaStore has no folder rows to query, so the folder kind walks the tree.
  if(Boolean.TRUE.equals(call.getBoolean("folders",false))){JSArray rows=new JSArray();for(StorageBrowser.Row r:primaryBrowser().folders(call.getString("folder",""),call.getString("text"),since,until,StorageCatalog.QUERY_MAX,StorageBrowser.WALK_MAX))rows.put(row(r));out.put("entries",rows);return out;}
  out.put("entries",StorageCatalog.query(resolver(),call.getString("text"),call.getString("mimePrefix"),Boolean.TRUE.equals(call.getBoolean("documents",false)),call.getString("folder"),since,until));return out;
 });}
 /** The identities an agent review bound ({@code expect}: [{size, modified}] per path), or null. */
 private static List<StorageBrowser.Identity> expected(PluginCall call,int count)throws org.json.JSONException{
  JSArray array=call.getArray("expect");if(array==null)return null;if(array.length()!=count)throw new IllegalArgumentException();
  List<StorageBrowser.Identity> out=new ArrayList<>();
  for(int i=0;i<array.length();i++){org.json.JSONObject o=array.optJSONObject(i);if(o==null||!o.has("size")||!o.has("modified"))throw new IllegalArgumentException();long size=o.getLong("size"),modified=o.getLong("modified");if(size<0||modified<0)throw new IllegalArgumentException();out.add(new StorageBrowser.Identity(size,modified));}
  return out;
 }
 /** Each path's identity (size, modified) for an agent review card; {@code missing} where it is not there. */
 @PluginMethod public void storageIdentity(PluginCall call){storage(call,b->{
  JSArray rows=new JSArray();for(StorageBrowser.Identity identity:b.identities(strings(call,"paths",StorageBrowser.BATCH_MAX))){JSObject o=new JSObject();if(identity==null){o.put("missing",true);o.put("size",0);o.put("modified",0);}else{o.put("size",identity.size);o.put("modified",identity.modified);}rows.put(o);}
  JSObject out=new JSObject();out.put("identities",rows);return out;
 });}
 @PluginMethod public void storageTransfer(PluginCall call){storage(call,b->{
  List<String> paths=strings(call,"paths",StorageBrowser.BATCH_MAX);boolean copy=Boolean.TRUE.equals(call.getBoolean("copy",false));
  List<StorageBrowser.Outcome> done=b.transfer(paths,call.getString("dest",""),copy,expected(call,paths.size()));
  List<String> touched=new ArrayList<>();for(StorageBrowser.Outcome o:done){if(o.to!=null)touched.add(o.to);if(!copy&&"moved".equals(o.status))touched.add(o.path);}scan(b,touched);
  JSObject out=new JSObject();out.put("outcomes",outcomes(done));return out;
 });}
 @PluginMethod public void storageRename(PluginCall call){storage(call,b->{
  String from=call.getString("path",""),to=b.rename(from,call.getString("name",""));scan(b,Arrays.asList(from,to));JSObject out=new JSObject();out.put("path",to);return out;
 });}
 @PluginMethod public void storageCreateFolder(PluginCall call){storage(call,b->{JSObject out=new JSObject();out.put("path",b.createFolder(call.getString("parent",""),call.getString("name","")));return out;});}
 @PluginMethod public void storageTrash(PluginCall call){storage(call,b->{
  List<String> paths=strings(call,"paths",StorageBrowser.BATCH_MAX);List<StorageBrowser.Outcome> done=b.trash(paths,System.currentTimeMillis(),expected(call,paths.size()));
  List<String> gone=new ArrayList<>();for(StorageBrowser.Outcome o:done)if("trashed".equals(o.status))gone.add(o.path);scan(b,gone);
  JSObject out=new JSObject();out.put("outcomes",outcomes(done));return out;
 });}
 @PluginMethod public void storageTrashList(PluginCall call){storage(call,b->{
  JSArray items=new JSArray();for(StorageBrowser.TrashRow r:b.trashList(System.currentTimeMillis())){JSObject o=new JSObject();o.put("id",r.id);o.put("name",r.name);o.put("origin",r.origin);o.put("directory",r.directory);o.put("mimeType",r.mime);o.put("size",r.size);o.put("deletedAt",r.deletedAt);items.put(o);}
  JSObject out=new JSObject();out.put("items",items);return out;
 });}
 @PluginMethod public void storageRestore(PluginCall call){storage(call,b->{
  List<StorageBrowser.Outcome> done=b.restore(strings(call,"ids",StorageBrowser.BATCH_MAX));
  List<String> back=new ArrayList<>();for(StorageBrowser.Outcome o:done)if(o.to!=null)back.add(o.to);scan(b,back);
  JSObject out=new JSObject();out.put("outcomes",outcomes(done));return out;
 });}
 /** Permanent deletion. The renderer sends confirmed only after the owner confirmed it. */
 @PluginMethod public void storageEmptyTrash(PluginCall call){storage(call,b->{
  if(!Boolean.TRUE.equals(call.getBoolean("confirmed",false)))return result("confirmation-required","Confirm before deleting permanently.");
  // Only the ids the owner confirmed: an item trashed after the confirmation is never deleted.
  JSObject out=new JSObject();out.put("count",b.emptyTrash(strings(call,"ids",StorageBrowser.BATCH_MAX)));return out;
 });}
 private Uri contentUri(java.io.File file){return androidx.core.content.FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".storage",file);}
 /** One share sheet for the listed files. Nothing is sent until the owner picks an app. */
 @PluginMethod public void storageShare(PluginCall call){storage(call,b->{
  ArrayList<Uri> uris=new ArrayList<>();Set<String> types=new HashSet<>();
  for(String path:strings(call,"paths",100)){java.io.File f=b.resolve(path,false);if(!f.isFile())continue;uris.add(contentUri(f));types.add(StorageBrowser.mime(f.getName()));}
  if(uris.isEmpty())return result("unsupported","Select files to share.");
  Intent send=new Intent(uris.size()==1?Intent.ACTION_SEND:Intent.ACTION_SEND_MULTIPLE).setType(types.size()==1?types.iterator().next():"*/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
  if(uris.size()==1)send.putExtra(Intent.EXTRA_STREAM,uris.get(0));else send.putParcelableArrayListExtra(Intent.EXTRA_STREAM,uris);
  ClipData clip=ClipData.newRawUri("Files",uris.get(0));for(int i=1;i<uris.size();i++)clip.addItem(new ClipData.Item(uris.get(i)));send.setClipData(clip);
  if(!startOnUi(Intent.createChooser(send,null)))return result("failed","Sharing could not open.");
  JSObject out=result("opened","");out.put("count",uris.size());return out;
 });}
 /** Opens a file in this app's document preview (a selection like a picked document). */
 @PluginMethod public void storageSelect(PluginCall call){storage(call,b->{
  java.io.File f=b.resolve(call.getString("path",""),false);if(!f.isFile())throw new java.io.FileNotFoundException();
  String id=SelectedDocumentAccess.authorize(getContext(),contentUri(f),0);
  JSObject out=result("selected","");out.put("action","files");out.put("selectionId",id);out.put("name",f.getName());out.put("mimeType",StorageBrowser.mime(f.getName()));out.put("canRename",false);return out;
 });}
 /** Opens a file in the Android app that handles its type. */
 @PluginMethod public void storageOpen(PluginCall call){storage(call,b->{
  java.io.File f=b.resolve(call.getString("path",""),false);if(!f.isFile())throw new java.io.FileNotFoundException();
  Intent view=new Intent(Intent.ACTION_VIEW).setDataAndType(contentUri(f),StorageBrowser.mime(f.getName())).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
  if(!startOnUi(Intent.createChooser(view,null)))return result("unsupported","No app can open this file.");
  return result("opened","");
 });}
 private boolean startOnUi(Intent intent)throws InterruptedException{
  Activity activity=getActivity();if(activity==null)return false;CountDownLatch started=new CountDownLatch(1);boolean[] opened={false};
  activity.runOnUiThread(()->{try{activity.startActivity(intent);opened[0]=true;}catch(RuntimeException e){opened[0]=false;}finally{started.countDown();}});
  return started.await(5,TimeUnit.SECONDS)&&opened[0];
 }
 /** Watches what is on screen; a change emits storageChanged once per burst. A folder (and the
  * Downloads category, which is the Download folder) is watched with inotify and MediaStore:
  * MediaProvider and DownloadProvider write on the lower filesystem, which may raise no inotify
  * event on the FUSE path. */
 @PluginMethod public void storageWatch(PluginCall call){long ticket=watch.request();storage(call,b->{
  String path=call.getString("path");String category=call.getString("category");
  java.io.File folder=path!=null?b.resolve(path,true):"downloads".equals(category)?new java.io.File(primaryBrowser().root,StorageCatalog.DOWNLOAD_FOLDER):null;
  watch.install(ticket,()->{
   FileObserver files=folder!=null&&folder.isDirectory()?new FileObserver(folder,FileObserver.CREATE|FileObserver.DELETE|FileObserver.MOVED_FROM|FileObserver.MOVED_TO|FileObserver.CLOSE_WRITE|FileObserver.DELETE_SELF|FileObserver.MOVE_SELF){@Override public void onEvent(int event,String name){burst();}}:null;
   if(files!=null)files.startWatching();
   android.database.ContentObserver media=new android.database.ContentObserver(main){@Override public void onChange(boolean self){burst();}};resolver().registerContentObserver(android.provider.MediaStore.Files.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL),true,media);
   return ()->{if(files!=null)files.stopWatching();resolver().unregisterContentObserver(media);main.removeCallbacks(changed);};
  });
  return new JSObject();
 });}
 @PluginMethod public void storageUnwatch(PluginCall call){stopWatching();call.resolve(new JSObject());}
 private void burst(){main.removeCallbacks(changed);main.postDelayed(changed,400);}
 private void stopWatching(){watch.clear();}
 @Override protected void handleOnDestroy(){stopWatching();storageWorker.shutdownNow();}
}
