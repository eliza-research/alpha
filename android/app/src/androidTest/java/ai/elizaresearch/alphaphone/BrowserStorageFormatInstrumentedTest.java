package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.browsersurface.BrowserSessionStore;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Installed storage-format contract, using real Android Keystore and product stores.
 * Requires a fresh disposable app user; never opens an Activity or contacts a website. */
@RunWith(AndroidJUnit4.class)
public final class BrowserStorageFormatInstrumentedTest {
 private static final String BOOKMARKS="alpha-browser-bookmarks",SESSION="alpha-browser-session";
 // Independent implementation of the deployed format, intentionally not the shared codec.
 private static String encode(SecretKey key,String text)throws Exception{
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);
  return Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(text.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
 }
 private static String decode(SecretKey key,String packed)throws Exception{
  String[] parts=packed.split(":",-1);assertEquals(2,parts.length);
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
  return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
 }
 private static SecretKey create(String alias)throws Exception{
  KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
  generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
  return generator.generateKey();
 }
 @Test public void installedBrowserRecordsKeepTheirFormat()throws Exception{
  assertEquals("Fresh disposable user required","1",InstrumentationRegistry.getArguments().getString("disposableBrowserStorageFixture"));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  SharedPreferences bookmarks=context.getSharedPreferences(BOOKMARKS,0),session=context.getSharedPreferences(SESSION,0);
  KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);
  assertTrue("Existing bookmarks must not be replaced",bookmarks.getAll().isEmpty());
  assertTrue("Existing session must not be replaced",session.getAll().isEmpty());
  assertFalse(keys.containsAlias(BOOKMARKS+"-v1"));assertFalse(keys.containsAlias(SESSION+"-v1"));
  String first="https://example.com/?fixture=first",second="https://example.com/?fixture=second",origin="https://example.com";
  try{
   SecretKey bookmarkKey=create(BOOKMARKS+"-v1"),sessionKey=create(SESSION+"-v1");
   assertTrue(bookmarks.edit().putString("sealed",encode(bookmarkKey,new JSONArray().put(first).toString())).commit());
   assertEquals(java.util.List.of(first),AlphaBrowserStores.bookmarks(context).read());
   AlphaBrowserStores.bookmarks(context).change(second,true);
   JSONArray savedBookmarks=new JSONArray(decode(bookmarkKey,bookmarks.getString("sealed",null)));
   assertEquals(second,savedBookmarks.getString(0));assertEquals(first,savedBookmarks.getString(1));
   JSONObject state=new JSONObject().put("history",new JSONArray().put(first)).put("tabs",new JSONArray().put(new JSONObject().put("id","tab-one").put("url",first).put("title","Fixture"))).put("cur","tab-one");
   assertTrue(session.edit().putString("sealed",encode(sessionKey,state.toString())).putString("permissions",encode(sessionKey,new JSONObject().put(origin,new JSONObject().put("camera",true)).toString())).commit());
   BrowserSessionStore store=AlphaBrowserStores.session(context);
   assertEquals(first,store.read().getJSONArray("history").getString(0));
   assertEquals("tab-one",store.read().getString("cur"));assertEquals(Boolean.TRUE,store.permission(origin,"camera"));
   state.put("history",new JSONArray().put(second));store.write(state);store.setPermission(origin,"microphone",false);
   assertEquals(second,new JSONObject(decode(sessionKey,session.getString("sealed",null))).getJSONArray("history").getString(0));
   JSONObject permissions=new JSONObject(decode(sessionKey,session.getString("permissions",null))).getJSONObject(origin);
   assertTrue(permissions.getBoolean("camera"));assertFalse(permissions.getBoolean("microphone"));
   assertEquals(second,AlphaBrowserStores.session(context).read().getJSONArray("history").getString(0));
   assertEquals(java.util.List.of(second,first),AlphaBrowserStores.bookmarks(context).read());
  }finally{
   assertTrue(bookmarks.edit().clear().commit());assertTrue(session.edit().clear().commit());
   keys.deleteEntry(BOOKMARKS+"-v1");keys.deleteEntry(SESSION+"-v1");
  }
 }
}
