package ai.elizaresearch.alphaphone;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Operator-gated recovery for stranded test-owned trash, never general cleanup. */
@RunWith(AndroidJUnit4.class)
public class PhotosFixtureRecoveryInstrumentedTest {
 @Test public void inspectOrRecoverExplicitFixtureManifest()throws Exception{
  Bundle args=InstrumentationRegistry.getArguments();String mode=args.getString("alphaPhotoRecovery","");Assume.assumeTrue("Explicit recovery run only",mode.equals("inventory")||mode.equals("delete"));
  long from=Long.parseLong(args.getString("alphaPhotoRecoveryFromSeconds","0")),to=Long.parseLong(args.getString("alphaPhotoRecoveryToSeconds","0"));assertTrue("Bound a known run to at most one hour",from>0&&to>=from&&to-from<=3600);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();Bundle query=new Bundle();query.putInt(MediaStore.QUERY_ARG_MATCH_TRASHED,MediaStore.MATCH_ONLY);
  query.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,"owner_package_name=? AND relative_path=? AND mime_type=? AND is_pending=0 AND is_trashed=1 AND date_added>=? AND date_added<=?");query.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,new String[]{context.getPackageName(),"Pictures/AlphaPhone-tests/","image/jpeg",Long.toString(from),Long.toString(to)});
  JSONArray inventory=new JSONArray();try(Cursor rows=resolver.query(MediaStore.Files.getContentUri("external"),new String[]{"_id","_display_name","date_added","generation_modified"},query,null)){
   assertNotNull(rows);while(rows.moveToNext()){String name=rows.getString(1);if(!name.matches("alpha-album-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg"))continue;assertTrue("Bounded fixture inventory",inventory.length()<10);inventory.put(new JSONObject().put("id",rows.getLong(0)).put("name",name).put("date",rows.getLong(2)).put("generation",rows.getLong(3)));}
  }
  if(mode.equals("inventory")){Bundle result=new Bundle();result.putString("stream","OWNED_PHOTO_FIXTURE_INVENTORY="+inventory+"\n");InstrumentationRegistry.getInstrumentation().sendStatus(0,result);return;}
  JSONArray exact=new JSONArray(args.getString("alphaPhotoRecoveryManifest","[]"));assertTrue("An explicit reviewed inventory subset is required",exact.length()>0&&exact.length()<=10);
  java.util.Set<Long> used=new java.util.HashSet<>();for(int i=0;i<exact.length();i++){
   JSONObject target=exact.getJSONObject(i);assertTrue("No duplicate fixture",used.add(target.getLong("id")));boolean verified=false;for(int j=0;j<inventory.length();j++){JSONObject row=inventory.getJSONObject(j);if(row.getLong("id")==target.getLong("id")&&row.getString("name").equals(target.getString("name"))&&row.getLong("date")==target.getLong("date")&&row.getLong("generation")==target.getLong("generation"))verified=true;}assertTrue("Exact reviewed fixture is still owned, trashed, in-path and within run time",verified);
  }
  for(int i=0;i<exact.length();i++){JSONObject target=exact.getJSONObject(i);Bundle deletion=new Bundle(query);deletion.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,query.getString(ContentResolver.QUERY_ARG_SQL_SELECTION)+" AND _id=? AND _display_name=? AND generation_modified=?");deletion.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,new String[]{context.getPackageName(),"Pictures/AlphaPhone-tests/","image/jpeg",Long.toString(from),Long.toString(to),Long.toString(target.getLong("id")),target.getString("name"),Long.toString(target.getLong("generation"))});Uri uri=ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,target.getLong("id"));assertEquals("Delete only exact reviewed fixture",1,resolver.delete(uri,deletion));assertTrue(context.getSharedPreferences("alpha-owned-media-versions",0).edit().remove(Long.toString(target.getLong("id"))).commit());}
 }
}
