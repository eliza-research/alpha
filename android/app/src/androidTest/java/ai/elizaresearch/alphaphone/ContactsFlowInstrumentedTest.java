package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.ContactsContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Disposable ContactsProvider records exercised through the actual prototype UI. */
// MVP-DEFERRED: restore this provider-mutating campaign only when Contacts is back in scope.
@org.junit.Ignore("MVP-DEFERRED: Contacts provider is not packaged in the MVP")
@RunWith(AndroidJUnit4.class)
public class ContactsFlowInstrumentedTest {
 private String eval(String script)throws Exception{return WebViewTestDriver.evaluate(script);}
 private void until(String script)throws Exception{
  for(int i=0;i<150;i++){if("true".equals(eval("Boolean("+script+")")))return;SystemClock.sleep(100);}fail("Contacts condition missing: "+script);
 }
 private void click(String label)throws Exception{
  String q="[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";until(q);eval("("+q+").click()");
 }
 private void fill(String label,String value)throws Exception{
  String q="document.querySelector('input[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";until(q);
  eval("(()=>{const e="+q+";Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");until(q+".value==="+JSONObject.quote(value));
 }
 private List<Long> rawIds(ContentResolver resolver,String name){
  List<Long> ids=new ArrayList<>();
  try(Cursor c=resolver.query(ContactsContract.Data.CONTENT_URI,new String[]{ContactsContract.Data.RAW_CONTACT_ID},ContactsContract.Data.MIMETYPE+"=? AND "+ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME+"=?",new String[]{ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE,name},null)){if(c!=null)while(c.moveToNext())ids.add(c.getLong(0));}return ids;
 }
 private boolean has(ContentResolver resolver,long id,String mime,String value){
  try(Cursor c=resolver.query(ContactsContract.Data.CONTENT_URI,new String[]{ContactsContract.Data._ID},ContactsContract.Data.RAW_CONTACT_ID+"=? AND "+ContactsContract.Data.MIMETYPE+"=? AND "+ContactsContract.Data.DATA1+"=?",new String[]{Long.toString(id),mime,value},null)){return c!=null&&c.moveToFirst();}
 }
 @Test public void providerContactDisplaysAndExplicitFormWritesVerifiedContact()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();
  for(String permission:new String[]{Manifest.permission.READ_CONTACTS,Manifest.permission.WRITE_CONTACTS})InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),permission);
  String token=UUID.randomUUID().toString(),seed="AlphaFixture "+token,created="AlphaCreated "+token;
  String phone="+12025550193",email="alpha-"+token+"@example.test";
  Uri seededRaw=null;
  try {
   ContentValues raw=new ContentValues();raw.putNull(ContactsContract.RawContacts.ACCOUNT_TYPE);raw.putNull(ContactsContract.RawContacts.ACCOUNT_NAME);
   seededRaw=resolver.insert(ContactsContract.RawContacts.CONTENT_URI,raw);assertNotNull(seededRaw);
   ContentValues name=new ContentValues();name.put(ContactsContract.Data.RAW_CONTACT_ID,ContentUris.parseId(seededRaw));name.put(ContactsContract.Data.MIMETYPE,ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE);name.put(ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME,seed);assertNotNull(resolver.insert(ContactsContract.Data.CONTENT_URI,name));
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    until("document.documentElement.dataset.activeView");eval(AppNavigation.request("Contacts"));until(AppNavigation.selected("Contacts"));
    String row="[...document.querySelectorAll('[data-screen] button')].find(b=>[...b.querySelectorAll('span')].some(s=>s.textContent==="+JSONObject.quote(seed)+"))";
    until(row);eval("("+row+").click()");until("!!document.querySelector('button[aria-label=\"Edit contact\"]') && document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(seed)+")");
    click("Back to contacts");click("New contact");fill("First name","AlphaCreated");fill("Last name",token);fill("Phone",phone);fill("Email",email);
    assertTrue("Typing alone must not create a provider contact",rawIds(resolver,created).isEmpty());
    click("Save");until("!!document.querySelector('button[aria-label=\"Edit contact\"]') && document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(created)+")");
    List<Long> ids=rawIds(resolver,created);assertEquals("Exactly one explicit contact insertion",1,ids.size());long id=ids.get(0);
    assertTrue("Provider phone matches entered value",has(resolver,id,ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE,phone));
    assertTrue("Provider email matches entered value",has(resolver,id,ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE,email));
    scenario.recreate();until("document.documentElement.dataset.activeView==='home'");eval(AppNavigation.request("Contacts"));until(AppNavigation.selected("Contacts"));until("document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(created)+")");
   }
  } finally {
   if(seededRaw!=null)resolver.delete(seededRaw,null,null);
   for(long id:rawIds(resolver,created))resolver.delete(ContentUris.withAppendedId(ContactsContract.RawContacts.CONTENT_URI,id),null,null);
  }
 }
}
