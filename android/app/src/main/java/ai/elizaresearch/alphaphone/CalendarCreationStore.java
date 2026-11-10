package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.content.ContentValues;
import com.getcapacitor.JSObject;

/** Compatibility entrypoint for installed-state acceptance tests; shared journal identity is unchanged. */
final class CalendarCreationStore {
 private static final ai.eliza.plugins.calendar.CalendarCreationStore STORE=new ai.eliza.plugins.calendar.CalendarCreationStore(AlphaCalendarPlugin.CONFIGURATION);
 static JSObject create(Context context,String id,ContentValues values,boolean separate)throws Exception{return STORE.create(context,id,values,separate);}
 static JSObject pendingCreations(Context context)throws Exception{return STORE.pendingCreations(context);}
 static void acknowledge(Context context,String id)throws Exception{STORE.acknowledge(context,id);}
}
