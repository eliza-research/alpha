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
import java.util.concurrent.atomic.AtomicBoolean;

/** Files browser over shared storage with all-files access (storage* methods,
 * design/view-refresh-2026-11/PLAN.md section 4, decision F1). Storage paths are volume-relative
 * and checked by StorageBrowser.resolve; the renderer never names an absolute path or a provider
 * URI. The earlier user-selected SAF tree stays available through the shared folder-tree engine
 * (elizaOS plugin-native-media DocumentFolderTree) with Alpha's installed preference name and its
 * selected-document capabilities. */
@CapacitorPlugin(name="AlphaFiles")
public class AlphaFilesPlugin extends Plugin {
 /** Installed name of the preference that records the chosen tree. */
 static final String PREF="alpha-files-tree";
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private final AtomicBoolean picking=new AtomicBoolean();
 private DocumentFolderTree tree;
 @Override public void load(){tree=new DocumentFolderTree(getContext(),PREF,uri->SelectedDocumentAccess.authorize(getContext(),uri,0));}
 private void run(PluginCall call,DocumentFolderTree.Work task){PluginWorkers.submit(worker,()->call.resolve(tree.guarded(task)),()->call.resolve(DocumentFolderTree.result("unavailable","Files closed. Reopen Files to continue.")));}
 @PluginMethod public void choose(PluginCall call){
  if(!picking.compareAndSet(false,true)){call.resolve(DocumentFolderTree.result("busy","A folder picker is already open."));return;}
  Intent intent=DocumentFolderTree.pickerIntent();
  try{startActivityForResult(call,intent,"chosen");}catch(RuntimeException error){picking.set(false);call.resolve(DocumentFolderTree.result("unavailable","Android folder selection is unavailable."));}
 }
 @ActivityCallback private void chosen(PluginCall call,ActivityResult response){
  picking.set(false);if(call==null)return;Intent data=response.getData();
  if(response.getResultCode()!=Activity.RESULT_OK||data==null||data.getData()==null){call.resolve(DocumentFolderTree.result("cancelled","Folder selection cancelled."));return;}
  android.net.Uri uri=data.getData();int flags=data.getFlags();
  run(call,()->tree.adopt(uri,flags));
 }
 @PluginMethod public void list(PluginCall call){run(call,()->tree.list(call.getString("id"),call.getString("cursor")));}
 /** Android grants folders in place; nothing is copied. Import opens the same tree picker. */
 @PluginMethod public void importFolder(PluginCall call){choose(call);}
 /** Per-item move or delete, each checked against its listed revision; every outcome is named. */
 @PluginMethod public void changeMany(PluginCall call){run(call,()->tree.changeMany(call.getArray("items"),call.getString("action",""),Boolean.TRUE.equals(call.getBoolean("confirmPermanent")),call.getString("destinationId")));}
 /** One share sheet for several files. Folders are skipped, and nothing is sent until the user picks an app. */
 @PluginMethod public void shareMany(PluginCall call){run(call,()->tree.shareMany(getActivity(),call.getArray("items")));}
 @PluginMethod public void createFolder(PluginCall call){run(call,()->tree.createFolder(call.getString("id"),call.getString("name","")));}
 @PluginMethod public void rename(PluginCall call){run(call,()->tree.rename(call.getString("id"),call.getString("name",""),call.getString("expectedRevision")));}
 @PluginMethod public void delete(PluginCall call){run(call,()->tree.delete(call.getString("id"),Boolean.TRUE.equals(call.getBoolean("confirmPermanent")),call.getString("expectedRevision")));}
 @PluginMethod public void move(PluginCall call){run(call,()->tree.move(call.getString("id"),call.getString("destinationId"),call.getString("expectedRevision")));}
 @PluginMethod public void select(PluginCall call){run(call,()->tree.select(call.getString("id")));}
 @PluginMethod public void forget(PluginCall call){run(call,()->tree.forget());}
 private static JSObject result(String status,String message){return DocumentFolderTree.result(status,message);}
 private ContentResolver resolver(){return getContext().getContentResolver();}
 // ---- Storage browser (all-files access) ----
 private final ExecutorService storageWorker=Executors.newSingleThreadExecutor();
 private FileObserver observer;private android.database.ContentObserver mediaObserver;
 private final android.os.Handler main=new android.os.Handler(android.os.Looper.getMainLooper());
 private final Runnable changed=()->notifyListeners("storageChanged",new JSObject());
 private interface StorageWork {JSObject run(StorageBrowser browser)throws Exception;}
 private JSObject denied(){JSObject out=result("denied","Allow all-files access to browse storage.");out.put("access",StorageCatalog.access());return out;}
 private void storage(PluginCall call,StorageWork task){PluginWorkers.submit(storageWorker,()->{
  try{
   if(!"granted".equals(StorageCatalog.access())){call.resolve(denied());return;}
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
  JSObject out=new JSObject();out.put("status","ready");String access=StorageCatalog.access();out.put("access",access);JSArray volumes=new JSArray();
  if("granted".equals(access))for(StorageCatalog.Volume v:StorageCatalog.volumes(getContext()))volumes.put(StorageCatalog.describe(v));
  out.put("volumes",volumes);call.resolve(out);
 },()->call.resolve(result("unavailable","Files closed.")));}
 /** Opens Android's "All files access" page for this app and reads access back on return. */
 @PluginMethod public void storageRequestAccess(PluginCall call){
  if("unsupported".equals(StorageCatalog.access())){JSObject out=new JSObject();out.put("status","ready");out.put("access","unsupported");call.resolve(out);return;}
  Intent intent=new Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,Uri.parse("package:"+getContext().getPackageName()));
  try{startActivityForResult(call,intent,"storageAccessReturned");}
  catch(RuntimeException e){
   try{startActivityForResult(call,new Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION),"storageAccessReturned");}
   catch(RuntimeException again){call.resolve(result("unavailable","Android's file access settings are unavailable."));}
  }
 }
 @ActivityCallback private void storageAccessReturned(PluginCall call,ActivityResult response){
  if(call==null)return;JSObject out=new JSObject();out.put("status","ready");out.put("access",StorageCatalog.access());call.resolve(out);
 }
 @PluginMethod public void storageList(PluginCall call){storage(call,b->{
  List<StorageBrowser.Row> rows=b.list(call.getString("path",""));JSArray entries=new JSArray();int n=0;
  for(StorageBrowser.Row r:rows){if(n++>=StorageBrowser.LIST_MAX)break;entries.put(row(r));}
  JSObject out=new JSObject();out.put("entries",entries);out.put("truncated",rows.size()>StorageBrowser.LIST_MAX);return out;
 });}
 @PluginMethod public void storageCategory(PluginCall call){storage(call,b->StorageCatalog.category(resolver(),primaryBrowser(),call.getString("category","")));}
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
 @PluginMethod public void storageTransfer(PluginCall call){storage(call,b->{
  List<String> paths=strings(call,"paths",StorageBrowser.BATCH_MAX);boolean copy=Boolean.TRUE.equals(call.getBoolean("copy",false));
  List<StorageBrowser.Outcome> done=b.transfer(paths,call.getString("dest",""),copy);
  List<String> touched=new ArrayList<>();for(StorageBrowser.Outcome o:done){if(o.to!=null)touched.add(o.to);if(!copy&&"moved".equals(o.status))touched.add(o.path);}scan(b,touched);
  JSObject out=new JSObject();out.put("outcomes",outcomes(done));return out;
 });}
 @PluginMethod public void storageRename(PluginCall call){storage(call,b->{
  String from=call.getString("path",""),to=b.rename(from,call.getString("name",""));scan(b,Arrays.asList(from,to));JSObject out=new JSObject();out.put("path",to);return out;
 });}
 @PluginMethod public void storageCreateFolder(PluginCall call){storage(call,b->{JSObject out=new JSObject();out.put("path",b.createFolder(call.getString("parent",""),call.getString("name","")));return out;});}
 @PluginMethod public void storageTrash(PluginCall call){storage(call,b->{
  List<String> paths=strings(call,"paths",StorageBrowser.BATCH_MAX);List<StorageBrowser.Outcome> done=b.trash(paths,System.currentTimeMillis());
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
 @PluginMethod public void storageWatch(PluginCall call){storage(call,b->{
  stopWatching();String path=call.getString("path");String category=call.getString("category");
  java.io.File folder=path!=null?b.resolve(path,true):"downloads".equals(category)?new java.io.File(primaryBrowser().root,StorageCatalog.DOWNLOAD_FOLDER):null;
  if(folder!=null&&folder.isDirectory()){
   observer=new FileObserver(folder,FileObserver.CREATE|FileObserver.DELETE|FileObserver.MOVED_FROM|FileObserver.MOVED_TO|FileObserver.CLOSE_WRITE|FileObserver.DELETE_SELF|FileObserver.MOVE_SELF){@Override public void onEvent(int event,String name){burst();}};observer.startWatching();}
  mediaObserver=new android.database.ContentObserver(main){@Override public void onChange(boolean self){burst();}};resolver().registerContentObserver(android.provider.MediaStore.Files.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL),true,mediaObserver);
  return new JSObject();
 });}
 @PluginMethod public void storageUnwatch(PluginCall call){stopWatching();call.resolve(new JSObject());}
 private void burst(){main.removeCallbacks(changed);main.postDelayed(changed,400);}
 private synchronized void stopWatching(){if(observer!=null){observer.stopWatching();observer=null;}if(mediaObserver!=null){resolver().unregisterContentObserver(mediaObserver);mediaObserver=null;}main.removeCallbacks(changed);}
 @Override protected void handleOnDestroy(){stopWatching();storageWorker.shutdownNow();worker.shutdownNow();}
}
