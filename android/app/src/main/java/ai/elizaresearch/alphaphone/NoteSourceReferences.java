package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.media.SourceReferenceStore;
import android.content.Context;

/**
 * Alpha's installed names for Notes' linked source documents (J03, option a). A Notes 'a1:' link
 * names an entry in {@link #PREFERENCES}; its last retain time lives in
 * {@link #RETAINED_PREFERENCES}. The reference rules, three-day unsaved grace and grant release
 * are the shared native media module's {@code SourceReferences} and {@code SourceReferenceStore}.
 */
final class NoteSourceReferences {
 static final String PREFERENCES="note-source-references";
 static final String RETAINED_PREFERENCES="note-source-reference-times";
 private static SourceReferenceStore store;
 private NoteSourceReferences(){}
 static synchronized SourceReferenceStore store(Context context){
  if(store==null)store=new SourceReferenceStore(context.getApplicationContext(),PREFERENCES,RETAINED_PREFERENCES);
  return store;
 }
}
