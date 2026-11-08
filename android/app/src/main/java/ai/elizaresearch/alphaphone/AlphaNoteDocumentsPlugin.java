package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.media.DocumentBytes;
import ai.eliza.plugins.media.DocumentDestinations;
import ai.eliza.plugins.media.DocumentExport;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
/** Explicit, transient SAF text import/export. No broad file permission or network. Text and title
 * rules, the document pickers and the verified write are the shared native media module's
 * (DocumentExport, DocumentDestinations); Alpha keeps its plugin name and product messages. */
@CapacitorPlugin(name="AlphaNoteDocuments")
public final class AlphaNoteDocumentsPlugin extends Plugin {
 private final AtomicBoolean busy=new AtomicBoolean();private final ExecutorService worker=Executors.newSingleThreadExecutor();private volatile boolean closed;
 private JSObject result(String status,String message){JSObject r=new JSObject();r.put("status",status);r.put("message",message);return r;}
 private void choose(PluginCall call,Intent intent,String callback){
  if(closed||!busy.compareAndSet(false,true)){call.resolve(result("unavailable","A document operation is already open."));return;}
  try{startActivityForResult(call,intent,callback);}catch(RuntimeException error){busy.set(false);call.resolve(result("unavailable","Android document selection is unavailable."));}
 }
 @PluginMethod public void importText(PluginCall call){if(!BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS){call.resolve(result("unsupported","Notes import is unavailable."));return;}choose(call,DocumentDestinations.open("text/*"),"imported");}
 @PluginMethod public void exportText(PluginCall call){
  if(!AlphaDevicePlugin.shareForeground(getActivity())){call.resolve(result("unavailable","Open and unlock the selected note before saving."));return;}
  try{DocumentExport.utf8(call.getString("text"));choose(call,DocumentDestinations.create("text/plain",DocumentExport.title(call.getString("title","Note"),"Note")+".txt"),"exported");}
  catch(Exception error){call.resolve(result("too-large","Export requires valid UTF-8 text of at most 64 KiB."));}
 }
 private byte[] pdfBytes(PluginCall call){return DocumentBytes.pdf(call.getString("dataBase64"));}
 @PluginMethod public void exportPdf(PluginCall call){
  try{pdfBytes(call);choose(call,DocumentDestinations.create("application/pdf",DocumentExport.title(call.getString("title","Alpha scan"),"Alpha scan")+".pdf"),"exportedPdf");}
  catch(Exception error){call.resolve(result("failed","PDF export requires valid PDF bytes of at most 8 MB."));}
 }
 /** Writes once to the chosen document and reads it back; product messages per shared outcome. */
 private void write(PluginCall call,Uri uri,byte[] content,String exported,String unverified){
  DocumentExport.Outcome outcome=DocumentDestinations.write(getContext().getContentResolver(),uri,content);
  if(outcome==DocumentExport.Outcome.EXPORTED){JSObject value=result(outcome.status,exported);value.put("bytes",content.length);call.resolve(value);}
  else call.resolve(result(outcome.status,outcome==DocumentExport.Outcome.UNVERIFIED?unverified:"The selected destination could not be written."));
 }
 @ActivityCallback private void exportedPdf(PluginCall call,ActivityResult response){Uri uri=chosen(call,response);if(uri==null)return;run(call,()->{
  byte[] content;try{content=pdfBytes(call);}catch(RuntimeException invalid){call.resolve(result("failed","The selected destination could not be written."));return;}
  write(call,uri,content,"PDF saved and exact bytes verified.","The provider may have saved some or all PDF bytes. Inspect the destination before retrying.");
 });}
 private Uri chosen(PluginCall call,ActivityResult response){
  if(call==null){busy.set(false);return null;}
  if(response.getResultCode()!=Activity.RESULT_OK||response.getData()==null){busy.set(false);call.resolve(result("cancelled","Document selection cancelled. Nothing imported or exported."));return null;}
  Uri uri=response.getData().getData();if(!DocumentDestinations.admits(uri)){busy.set(false);call.resolve(result("unavailable","The document provider returned no accessible document."));return null;}return uri;
 }
 private void run(PluginCall call,Runnable operation){PluginWorkers.submit(worker,()->{try{if(closed)call.resolve(result("cancelled","Document operation closed."));else operation.run();}finally{busy.set(false);}},()->{busy.set(false);call.resolve(result("cancelled","Document operation closed."));});}
 @ActivityCallback private void imported(PluginCall call,ActivityResult response){Uri uri=chosen(call,response);if(uri==null)return;run(call,()->{
  try{
   JSObject value=SelectedDocumentAccess.readTransientText(getContext(),uri);
   String name="Imported note";try(android.database.Cursor row=getContext().getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(row!=null&&row.moveToFirst()&&!row.isNull(0))name=row.getString(0);}
   value.put("name",name);call.resolve(value);
  }catch(RuntimeException error){call.resolve(result("failed","The selected document could not be read."));}
 });}
 @ActivityCallback private void exported(PluginCall call,ActivityResult response){Uri uri=chosen(call,response);if(uri==null)return;run(call,()->{
  byte[] content;try{content=DocumentExport.utf8(call.getString("text"));}catch(Exception invalid){call.resolve(result("failed","The selected destination could not be written."));return;}
  write(call,uri,content,"Export saved and exact bytes verified.","The provider may have saved some or all text, but exact bytes could not be verified. Inspect the destination before retrying.");
 });}
 @Override protected void handleOnDestroy(){closed=true;worker.shutdown();super.handleOnDestroy();}
}
