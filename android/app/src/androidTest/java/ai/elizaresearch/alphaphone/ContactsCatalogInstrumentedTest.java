package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.contacts.ContactsCatalog;
import android.Manifest;
import android.content.*;
import android.net.Uri;
import android.provider.ContactsContract;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import org.junit.Test;
import static org.junit.Assert.*;

/** Owned disposable-profile provider test only; it does not admit a production image. */
public final class ContactsCatalogInstrumentedTest {
 @Test public void literalSearchIsOneSegmentAndPageBudgetIsCheckedBeforeAppend(){
  for(String query:new String[]{"A/B","A#B","A%B","A?B","A B"}){
   Uri uri=ContactsCatalog.searchUri(query);assertEquals(query,uri.getLastPathSegment());
   assertEquals(ContactsContract.Contacts.CONTENT_FILTER_URI.getPathSegments().size()+1,uri.getPathSegments().size());assertNull(uri.getQuery());assertNull(uri.getFragment());
  }
  String record="é".repeat(32768);int used=64,count=0;
  while(used+record.getBytes(java.nio.charset.StandardCharsets.UTF_8).length+1<=1024*1024){used=ContactsCatalog.admitRecordBytes(used,record);count++;}
  assertEquals(15,count);final int full=used;assertThrows(IllegalStateException.class,()->ContactsCatalog.admitRecordBytes(full,record));
 }
 @Test public void ownedContactsHaveBoundedSearchAndExactEditSelection()throws Exception{
  assertTrue("Disposable secondary user required",android.os.Process.myUid()/100000>0);
  android.app.Instrumentation inst=InstrumentationRegistry.getInstrumentation();Context context=inst.getTargetContext();
  String name="Alpha catalog fixture "+java.util.UUID.randomUUID();java.util.List<Uri> created=new java.util.ArrayList<>();
  inst.getUiAutomation().adoptShellPermissionIdentity(Manifest.permission.READ_CONTACTS,Manifest.permission.WRITE_CONTACTS);
  try{
   for(int n=0;n<2;n++){
    java.util.ArrayList<ContentProviderOperation> ops=new java.util.ArrayList<>();
    ops.add(ContentProviderOperation.newInsert(ContactsContract.RawContacts.CONTENT_URI).withValue(ContactsContract.RawContacts.ACCOUNT_TYPE,null).withValue(ContactsContract.RawContacts.ACCOUNT_NAME,null).build());
    ops.add(ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI).withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID,0).withValue(ContactsContract.Data.MIMETYPE,ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE).withValue(ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME,name+" "+n).build());
    ops.add(ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI).withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID,0).withValue(ContactsContract.Data.MIMETYPE,ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE).withValue(ContactsContract.CommonDataKinds.Phone.NUMBER,"+1555010020"+n).build());
    created.add(context.getContentResolver().applyBatch(ContactsContract.AUTHORITY,ops)[0].uri);
   }
   ContactsCatalog catalog=new ContactsCatalog(context);JSObject page=catalog.list(name,1);assertEquals(1,page.getJSONArray("contacts").length());assertTrue(page.getBoolean("more"));
   JSObject selected=JSObject.fromJSONObject(page.getJSONArray("contacts").getJSONObject(0));assertTrue(selected.getString("name").startsWith(name));assertEquals(1,selected.getJSONArray("phones").length());
   assertNotNull(catalog.reviewed(selected.getString("id"),selected.getString("lookup"),selected.getString("revision")));
   assertThrows(IllegalArgumentException.class,()->catalog.reviewed(selected.getString("id"),"changed-lookup",selected.getString("revision")));
   assertThrows(IllegalArgumentException.class,()->catalog.reviewed(selected.getString("id"),selected.getString("lookup"),"changed-revision"));
   assertThrows(IllegalArgumentException.class,()->catalog.list(name,201));assertThrows(IllegalArgumentException.class,()->catalog.list("x".repeat(129),1));
  }finally{for(Uri raw:created)context.getContentResolver().delete(raw,null,null);inst.getUiAutomation().dropShellPermissionIdentity();}
 }
}
