package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.media.DocumentBytes;
import ai.eliza.plugins.media.DocumentDestinations;
import ai.eliza.plugins.media.DocumentExport;
import ai.eliza.plugins.media.MediaLibraryKey;
import ai.eliza.plugins.media.PermittedMediaCatalog;
import ai.eliza.plugins.media.ReviewedFileHandoff;
import ai.eliza.plugins.media.SelectedPhotoCopy;
import ai.eliza.plugins.media.SourceReferenceStore;
import ai.eliza.plugins.media.SourceReferences;
import android.content.*;
import android.app.Activity;
import androidx.activity.result.ActivityResult;
import android.net.Uri;
import android.os.*;
import android.provider.OpenableColumns;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicBoolean;
/** Explicit selected-file import and temporary read-only attachment handoff. No network. Exact-byte
 * rules, selected photo copies, source-link reference counting, the temporary viewer copy and the
 * verified Save to Files write are the shared native media module's (DocumentBytes,
 * SelectedPhotoCopy, SourceReferenceStore, ReviewedFileHandoff, DocumentDestinations). Alpha keeps
 * its installed provider authority and cache folder. */
@CapacitorPlugin(name="AlphaMailAttachments")
public final class AlphaMailAttachmentsPlugin extends Plugin {
 static final int MAX_BYTES=DocumentBytes.MAX_BYTES;
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private final AtomicInteger generation=new AtomicInteger();
 private final AtomicInteger photoGeneration=new AtomicInteger();
 private final Set<InputStream> photoStreams=ConcurrentHashMap.newKeySet();
 private final Handler main=new Handler(Looper.getMainLooper());
 private final AtomicBoolean saving=new AtomicBoolean();
 private final Map<PluginCall,Integer> exports=new ConcurrentHashMap<>();
 /**
  * Runs attachment work off the bridge thread. Capacitor can deliver a call the page made just
  * before the activity was destroyed after handleOnDestroy has stopped the worker; the executor
  * then throws on the bridge thread, which ends the process. Such a call is rejected instead.
  */
 private void work(PluginCall call,Runnable task){
  PluginWorkers.submit(worker,task,()->call.reject("Attachment service closed."));
 }
 /** Installed names: authority {@code <package>.mailattachments} (AlphaMailFileProvider), cache folder and provider path {@code mail-attachments}. */
 static ReviewedFileHandoff handoff(Context context){return new ReviewedFileHandoff(context,context.getPackageName()+".mailattachments","mail-attachments","mail-attachments");}
 private ReviewedFileHandoff handoff(){return handoff(getContext());}
 private static String hash(byte[] bytes)throws Exception{return DocumentBytes.sha256(bytes);}
 static void validate(String name,String mime,byte[] data)throws Exception{DocumentBytes.validate(name,mime,data);}
 /** Opaque byte copy (any type) for Save to Files only: the name is checked, the bytes are never
  * interpreted, previewed or handed to a viewer. */
 static void validateOpaque(String name,byte[] data){DocumentBytes.validateOpaque(name,data);}
 static String opaqueMime(String mime){return DocumentBytes.opaqueMime(mime);}
 private static byte[] read(InputStream in)throws IOException{return DocumentBytes.read(in);}
 @PluginMethod public void readSelected(PluginCall call){int token=generation.get();work(call,()->{try{Uri uri=SelectedDocumentAccess.resolve(call.getString("selectionId"));if(uri==null)throw new SecurityException();String name;try(android.database.Cursor row=getContext().getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(row==null||!row.moveToFirst())throw new IOException();name=row.getString(0);}String mime=getContext().getContentResolver().getType(uri);byte[] data;try(InputStream in=getContext().getContentResolver().openInputStream(uri)){if(in==null)throw new IOException();data=read(in);}validate(name,mime,data);if(token!=generation.get())throw new CancellationException();JSObject result=new JSObject();result.put("name",name);result.put("mimeType",mime);result.put("size",data.length);result.put("sourceReferenceVersion",1);result.put("sha256",hash(data));result.put("dataBase64",android.util.Base64.encodeToString(data,android.util.Base64.NO_WRAP));call.resolve(result);}catch(Exception error){call.reject("Select a valid PDF, PNG, JPEG, WebP or UTF-8 TXT file up to 5 MiB. Selection cancelled or unavailable.");}});}
 /** Explicit Photos action: the selected catalog revision must survive the entire byte copy. */
 @PluginMethod public void readPhotoSelected(PluginCall call){int token=generation.get(),photoToken=photoGeneration.get();work(call,()->{
  try(PermittedMediaCatalog catalog=new PermittedMediaCatalog(getContext(),false,()->{})){
   String id=call.getString("id"),revision=call.getString("revision");MediaLibraryKey key=MediaLibraryKey.parse(id);
   if(key.video||revision==null||revision.isEmpty())throw new SecurityException();
   Uri uri=catalog.uri(key);PermittedMediaCatalog.Fence fence=catalog.fence();
   SelectedPhotoCopy.Guard guard=()->{if(token!=generation.get()||photoToken!=photoGeneration.get()||getActivity()==null||getActivity().isFinishing()||getActivity().isDestroyed()||!getActivity().hasWindowFocus())throw new CancellationException();};
   SelectedPhotoCopy.Copy copy=SelectedPhotoCopy.read(new SelectedPhotoCopy.Source(){
    public SelectedPhotoCopy.Metadata inspect()throws Exception{
     catalog.requireCurrent(fence);JSObject row=catalog.read(id,revision,false);catalog.requireCurrent(fence);
     return new SelectedPhotoCopy.Metadata(row.getString("name"),getContext().getContentResolver().getType(uri),row.getLong("size"),row.getString("revision"),row.getString("identity"));
    }
    public InputStream open()throws Exception{
     InputStream input=getContext().getContentResolver().openInputStream(uri);if(input==null)throw new IOException();
     Runnable timeout=()->{try{input.close();}catch(IOException ignored){}};main.postDelayed(timeout,5000);
     InputStream tracked=new FilterInputStream(input){@Override public void close()throws IOException{main.removeCallbacks(timeout);photoStreams.remove(this);super.close();}};
     photoStreams.add(tracked);try{guard.check();return tracked;}catch(Exception changed){tracked.close();throw changed;}
    }
   },guard);
   validate(copy.metadata.name,copy.metadata.mime,copy.bytes);guard.check();catalog.requireCurrent(fence);
   JSObject result=new JSObject();result.put("name",copy.metadata.name);result.put("mimeType",copy.metadata.mime);result.put("size",copy.bytes.length);result.put("sha256",copy.sha256);result.put("dataBase64",android.util.Base64.encodeToString(copy.bytes,android.util.Base64.NO_WRAP));
   // Serialize publication with Activity pause/destruction. Recheck access and row revision
   // after waiting for the UI thread; the worker's successful copy is not delivery authority.
   main.post(()->SelectedPhotoCopy.publish(()->{
    guard.check();try(PermittedMediaCatalog delivery=new PermittedMediaCatalog(getContext(),false,()->{})){
     delivery.read(id,revision,false);guard.check();
    }
   },()->call.resolve(result),()->call.reject("Selected photo changed or is unavailable. Review it again.")));
  }catch(Exception unavailable){call.reject("Selected photo changed or is unavailable. Choose a permitted PNG, JPEG or WebP source up to 5 MiB and review it again.");}
 });}
 @PluginMethod public void cancelPhotoSelected(PluginCall call){cancelPhotoReads();call.resolve();}
 private void cancelPhotoReads(){photoGeneration.incrementAndGet();for(InputStream stream:photoStreams){try{stream.close();}catch(IOException ignored){}}photoStreams.clear();}
 @Override protected void handleOnPause(){cancelPhotoReads();super.handleOnPause();}
 private void revoke(File file){handoff().revoke(file);}
 private void cleanup(){handoff().cleanup();}
 @PluginMethod public void cancel(PluginCall call){generation.incrementAndGet();cancelPhotoReads();cleanup();call.resolve();}
 @PluginMethod public void openReviewed(PluginCall call){openReviewedAt(call,generation.get());}
 private void openReviewedAt(PluginCall call,int token){work(call,()->{File file=null;try{String encoded=call.getString("dataBase64");if(encoded==null||encoded.length()>7*1024*1024||!Boolean.TRUE.equals(call.getBoolean("reviewed")))throw new IllegalArgumentException();byte[] data=android.util.Base64.decode(encoded,android.util.Base64.NO_WRAP);String name=call.getString("name"),mime=call.getString("mimeType");validate(name,mime,data);if(!hash(data).equals(call.getString("sha256")))throw new SecurityException();if(token!=generation.get())throw new CancellationException();file=handoff().write(name,data);File ready=file;main.post(()->{try{if(token!=generation.get()||getActivity()==null||!getActivity().hasWindowFocus())throw new CancellationException();Uri uri=handoff().uri(ready);Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);intent.setClipData(ClipData.newRawUri("Reviewed attachment",uri));try{getActivity().startActivity(intent);}catch(ActivityNotFoundException missing){if(!"application/pdf".equals(mime))throw missing;Intent fallback=new Intent(getActivity(),AlphaMailPdfActivity.class).setData(uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);getActivity().startActivity(fallback);}main.postDelayed(()->revoke(ready),15*60*1000);JSObject result=new JSObject();result.put("status","opened");result.put("message","Sent a temporary read-only copy to the viewer. Viewing is not confirmed.");call.resolve(result);}catch(Exception error){revoke(ready);call.reject("No viewer available, or the review was cancelled. No completed viewing is claimed.");}});}catch(Exception error){if(file!=null)revoke(file);call.reject("Attachment bytes, review or file type invalid.");}});}
 private byte[] sourceBytes(Uri uri)throws Exception{try(InputStream in=getContext().getContentResolver().openInputStream(uri)){if(in==null)throw new IOException();return read(in);}}
 @PluginMethod public void retainSourceReference(PluginCall call){int token=generation.get();work(call,()->{try{
  Uri uri=SelectedDocumentAccess.resolve(call.getString("selectionId"));if(uri==null)throw new SecurityException();byte[] bytes=sourceBytes(uri);if(!hash(bytes).equals(call.getString("sha256"))||token!=generation.get())throw new SecurityException();JSObject result=new JSObject();
  // Kept only while Android holds the document's persisted read grant; each retain restarts its stored grace period.
  String reference=NoteSourceReferences.store(getContext()).retain(uri,System.currentTimeMillis());if(reference!=null)result.put("reference",reference);
  call.resolve(result);
 }catch(Exception error){call.reject("Source changed or reference storage is unavailable. Select the source again.");}});}
 @PluginMethod public void openSourceReference(PluginCall call){int token=generation.get();work(call,()->{try{
  Uri uri=NoteSourceReferences.store(getContext()).resolve(call.getString("reference"));
  String name;try(android.database.Cursor row=getContext().getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(row==null||!row.moveToFirst())throw new IOException();name=row.getString(0);}String mime=getContext().getContentResolver().getType(uri);byte[] bytes=sourceBytes(uri);validate(name,mime,bytes);
  if(token!=generation.get()||!hash(bytes).equals(call.getString("sha256"))||bytes.length!=call.getInt("size",-1)||!mime.equals(call.getString("mimeType")))throw new SecurityException();
  call.getData().put("name",name);call.getData().put("dataBase64",android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP));call.getData().put("reviewed",true);openReviewedAt(call,token);
 }catch(Exception error){call.reject("Linked source changed or access is unavailable. Choose the matching source again.");}});}
 /**
  * Notes reconcile their source links: keep lists every a1: reference a saved or restorable (Trash)
  * note still names. Other references are removed, and the persisted grant of a document that no
  * reference and no picker selection names any more is released (NoteSourceReferences).
  */
 @PluginMethod public void releaseSourceReferences(PluginCall call){
  final Set<String> keep=new HashSet<>();
  try{org.json.JSONArray values=call.getArray("keep");if(values==null||values.length()>20000)throw new IllegalArgumentException();for(int i=0;i<values.length();i++){String value=values.getString(i);if(!SourceReferences.valid(value))throw new IllegalArgumentException();keep.add(value);}}
  catch(Exception invalid){call.reject("Note source references could not be reconciled.");return;}
  PluginWorkers.submit(worker,()->{try{
   SourceReferenceStore.Reconciled pass=NoteSourceReferences.store(getContext()).reconcile(keep,System.currentTimeMillis(),uri->SelectedDocumentAccess.releaseUnreferenced(getContext(),uri));
   JSObject result=new JSObject();result.put("removed",pass.removed);result.put("released",pass.released);result.put("remaining",pass.remaining);call.resolve(result);
  }catch(Exception error){call.reject("Note source references could not be reconciled.");}},()->call.reject("Attachment service closed."));
 }
 private JSObject saveResult(String status,String message){JSObject result=new JSObject();result.put("status",status);result.put("message",message);return result;}
 private byte[] reviewedBytes(PluginCall call)throws Exception{
  String encoded=call.getString("dataBase64");if(encoded==null||encoded.length()>7*1024*1024||!Boolean.TRUE.equals(call.getBoolean("reviewed")))throw new IllegalArgumentException();
  byte[] bytes=android.util.Base64.decode(encoded,android.util.Base64.NO_WRAP);if(Boolean.TRUE.equals(call.getBoolean("opaque")))validateOpaque(call.getString("name"),bytes);else validate(call.getString("name"),call.getString("mimeType"),bytes);if(!hash(bytes).equals(call.getString("sha256")))throw new SecurityException();return bytes;
 }
 @PluginMethod public void saveReviewed(PluginCall call){
  if(!saving.compareAndSet(false,true)){call.reject("An attachment save is already pending.");return;}int token=generation.get();
  PluginWorkers.submit(worker,()->{try{reviewedBytes(call);main.post(()->{
   try{if(token!=generation.get()||getActivity()==null||!getActivity().hasWindowFocus())throw new CancellationException();exports.put(call,token);
    Intent intent=DocumentDestinations.create(Boolean.TRUE.equals(call.getBoolean("opaque"))?opaqueMime(call.getString("mimeType")):call.getString("mimeType"),call.getString("name"));
    startActivityForResult(call,intent,"savedReviewed");
   }catch(Exception error){exports.remove(call);saving.set(false);call.resolve(saveResult("cancelled","Save destination unavailable or review closed."));}
  });}catch(Exception error){saving.set(false);call.reject("Review valid attachment bytes before saving.");}},()->{saving.set(false);call.reject("Attachment service closed.");});
 }
 @ActivityCallback private void savedReviewed(PluginCall call,ActivityResult response){
  if(call==null){exports.clear();saving.set(false);return;}Integer token=exports.remove(call);
  if(response.getResultCode()!=Activity.RESULT_OK||response.getData()==null){saving.set(false);call.resolve(saveResult("cancelled","Save cancelled."));return;}
  Uri uri=response.getData().getData();
  if(token==null||token!=generation.get()||uri==null||!"content".equals(uri.getScheme())){saving.set(false);call.resolve(saveResult("unverified","Review closed or destination unavailable. Inspect the chosen destination before retrying."));return;}
  PluginWorkers.submit(worker,()->{try{
   byte[] bytes=reviewedBytes(call);if(token!=generation.get())throw new CancellationException();
   DocumentExport.Outcome outcome=DocumentDestinations.write(getContext().getContentResolver(),uri,bytes,()->{if(token!=generation.get())throw new CancellationException();});
   if(outcome==DocumentExport.Outcome.EXPORTED)call.resolve(saveResult("saved","Saved to the chosen destination. Exact bytes verified."));
   else call.resolve(saveResult("unverified",outcome==DocumentExport.Outcome.UNVERIFIED?"The destination may contain some or all bytes. Inspect it before retrying.":"Save not confirmed. Inspect the chosen destination before retrying."));
  }catch(Exception error){call.resolve(saveResult("unverified","Save not confirmed. Inspect the chosen destination before retrying."));}finally{saving.set(false);}},()->{saving.set(false);call.resolve(saveResult("unverified","Attachment service closed. Inspect the chosen destination."));});
 }
 @Override public void load(){cleanup();}
 @Override protected void handleOnDestroy(){generation.incrementAndGet();cancelPhotoReads();main.removeCallbacksAndMessages(null);try{cleanup();}catch(RuntimeException unavailable){/* load() removes leftovers on the next start. */}worker.shutdown();super.handleOnDestroy();}
}
