package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.media.SelectedDocuments;
import android.app.Activity;
import android.content.Context;
import android.net.Uri;
import com.getcapacitor.JSObject;
import java.util.Map;

/**
 * Alpha's one process-wide selected-document registry: the shared {@link SelectedDocuments} engine
 * with Alpha's installed preference name ({@code selected-documents}) and preview file prefix
 * ({@code document-}). A grant a Notes source link still names ({@link NoteSourceReferences}) is
 * kept when its selection is forgotten or evicted. DailyApps' selected-document methods delegate to
 * the shared {@code SelectedDocumentCalls} bridge contract over {@link #documents}; the remaining
 * static entry points serve native picker callbacks, Files, Photos and instrumentation.
 */
final class SelectedDocumentAccess {
 static final String PREFERENCES="selected-documents",PREVIEW_PREFIX="document-";
 private static SelectedDocuments documents;
 private SelectedDocumentAccess(){}
 static synchronized SelectedDocuments documents(Context context){
  if(documents==null){Context app=context.getApplicationContext();documents=new SelectedDocuments(app,PREFERENCES,PREVIEW_PREFIX,NoteSourceReferences.store(app)::retains);}
  return documents;
 }
 private static synchronized SelectedDocuments loaded(){return documents;}
 static void initialize(Context context){documents(context);}
 static String authorize(Context context,Uri uri,int flags){return documents(context).authorize(uri,flags);}
 /** Null until the registry is loaded: an unknown ID confers no access. */
 static Uri resolve(String id){SelectedDocuments registry=loaded();return registry==null?null:registry.resolve(id);}
 static boolean releaseUnreferenced(Context context,Uri uri){return documents(context).releaseUnreferenced(uri);}
 static void forget(String id){SelectedDocuments registry=loaded();if(registry!=null)registry.forget(id);}
 static JSObject restore(Context context){return documents(context).restore();}
 static JSObject read(Context context,String id){return documents(context).read(id);}
 /** Only native picker callbacks may use this; no renderer-supplied URI entrypoint. */
 static JSObject readTransientText(Context context,Uri uri){return documents(context).readTransientText(uri);}
 /** Callers must first validate a picker capability or an admitted media identity. */
 static JSObject shareUri(Activity activity,Uri uri){return SelectedDocuments.shareUri(activity,uri);}
 /** A copy of the loaded selections, for instrumentation. */
 static Map<String,Uri> selections(){SelectedDocuments registry=loaded();return registry==null?Map.of():registry.selections();}
}
