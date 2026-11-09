package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.browsersurface.BrowserSessionPolicy;
import ai.eliza.plugins.browsersurface.BrowserSitePermissionRecord;
import ai.eliza.plugins.browsersurface.BrowserSitePermissions;
import ai.eliza.plugins.browsersurface.BrowserWebOrigin;

import ai.eliza.plugins.securestore.nativeonly.KeystoreTextFrame;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;

/** Normal-tab browsing history and the restorable tab list. Private tabs never
 * reach this store. URLs can carry private query parameters, so the bounded
 * device-local record is AES-GCM encrypted with an Android Keystore key, like
 * bookmarks. It holds no page content, form data, cookies or credentials. */
final class BrowserSessionStore {
 private static final String ALIAS="alpha-browser-session-v1";
 private final SharedPreferences preferences;
 private final KeystoreTextFrame frame=new KeystoreTextFrame(ALIAS,2000000);
 BrowserSessionStore(Context context){preferences=context.getSharedPreferences("alpha-browser-session",Context.MODE_PRIVATE);}
 static boolean validUrl(String value){return BrowserSessionPolicy.validUrl(value);}
 static boolean validId(String value){return BrowserSessionPolicy.validTabId(value);}
 static String title(String value){return BrowserSessionPolicy.title(value);}
 /** Canonical restorable form. Invalid rows are dropped rather than stored. */
 static JSONObject normalize(JSONObject input)throws Exception{
  java.util.List<String> history=new java.util.ArrayList<>();
  java.util.List<BrowserSessionPolicy.Tab> tabs=new java.util.ArrayList<>();
  JSONArray rawHistory=input.optJSONArray("history"),rawTabs=input.optJSONArray("tabs");
  if(rawHistory!=null)for(int i=0;i<rawHistory.length();i++)history.add(rawHistory.optString(i,null));
  if(rawTabs!=null)for(int i=0;i<rawTabs.length();i++){
   JSONObject tab=rawTabs.optJSONObject(i);if(tab==null)continue;
   tabs.add(new BrowserSessionPolicy.Tab(tab.optString("id",null),tab.optString("url",null),tab.optString("title",""),tab.optBoolean("private",false)));
  }
  BrowserSessionPolicy.Snapshot saved=BrowserSessionPolicy.restore(tabs,history,input.optString("cur",""));
  JSONArray rows=new JSONArray();for(BrowserSessionPolicy.Tab tab:saved.tabs)rows.put(new JSONObject().put("id",tab.id).put("url",tab.url).put("title",tab.title));
  return new JSONObject().put("history",new JSONArray(saved.history)).put("tabs",rows).put("cur",saved.current);
 }
 private String seal(JSONObject value)throws Exception{return frame.seal(value.toString());}
 private JSONObject open(String packed)throws Exception{return new JSONObject(frame.open(packed));}
 synchronized JSONObject read()throws Exception{
  String packed=preferences.getString("sealed",null);
  if(packed==null)return normalize(new JSONObject());
  return normalize(open(packed));
 }
 synchronized JSONObject write(JSONObject state)throws Exception{
  JSONObject canonical=normalize(state);
  if(!preferences.edit().putString("sealed",seal(canonical)).commit())throw new IllegalStateException();
  return canonical;
 }
 synchronized void clear(){if(!preferences.edit().remove("sealed").commit())throw new IllegalStateException();}

 /* Website permission decisions for the persistent normal-tab profile only, decided by upstream
  * BrowserSitePermissions (BrowserSitePermissionRecord): {"https://host[:port]":{"camera":true,
  * "microphone":false,"location":true}}, the format earlier builds stored, oldest origin first.
  * Private tabs never read or write them. Origins reveal visited sites, so the record is sealed
  * with the same Keystore key. Bounded to MAX_PERMISSION_ORIGINS. Alpha's own rules stay in
  * AlphaBrowserPlugin.sitePermission: only the selected, shown page is prompted, and an Allow is
  * chained to Android's runtime permission. See docs/browser-storage.md. */
 static final int MAX_PERMISSION_ORIGINS=BrowserSitePermissions.MAX_ORIGINS;
 static final java.util.Set<String> PERMISSION_KINDS=BrowserSitePermissions.KINDS;
 static boolean validOrigin(String origin){return origin!=null&&origin.length()<=300&&origin.equals(BrowserWebOrigin.of(origin));}
 private BrowserSitePermissions decisions(){
  String packed=preferences.getString("permissions",null);
  if(packed==null)return BrowserSitePermissionRecord.read(null);
  // A damaged record grants nothing: every site is asked again.
  try{return BrowserSitePermissionRecord.read(frame.open(packed));}catch(Exception damaged){return BrowserSitePermissionRecord.read(null);}
 }
 /** The bounded record (at most MAX_PERMISSION_ORIGINS), sealed with the Keystore key. */
 private void save(BrowserSitePermissions decisions)throws Exception{
  String bounded=BrowserSitePermissionRecord.write(decisions);
  if(!preferences.edit().putString("permissions",frame.seal(bounded)).commit())throw new IllegalStateException();
 }
 /** Stored decision, or null when the site must be asked. */
 synchronized Boolean permission(String origin,String kind){return decisions().decision(origin,kind,false);}
 synchronized void setPermission(String origin,String kind,boolean allowed)throws Exception{
  if(!validOrigin(origin)||!PERMISSION_KINDS.contains(kind))throw new IllegalArgumentException();
  BrowserSitePermissions all=decisions();
  if(!all.record(origin,kind,allowed,false))throw new IllegalArgumentException();
  save(all);
 }
 synchronized void clearPermissions(){if(!preferences.edit().remove("permissions").commit())throw new IllegalStateException();}
 /** Remove decisions for a registrable domain and its subdomains (Clear data for this site). */
 synchronized void clearPermissionsForSite(String site)throws Exception{
  if(site==null||site.isEmpty())return;
  BrowserSitePermissions all=decisions();
  if(all.clearSite(site))save(all);
 }
}
