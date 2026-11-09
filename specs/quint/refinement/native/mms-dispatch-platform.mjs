import assert from 'node:assert/strict';
import {smsMembers, smsPlatform} from './sms-dispatch-platform.mjs';

function slice(source, first, last) {
  const start=source.indexOf(first), end=source.indexOf(last,start+first.length);
  assert.ok(start>=0&&end>start,`MMS fixture anchors ${first}, ${last}`);
  return source.slice(start,end);
}

function replace(source, first, replacement) {
  assert.equal(source.split(first).length,2,`MMS fixture anchor ${first}`);
  return source.replace(first,()=>replacement);
}

export function mmsPlatform(plugin, store, provider) {
  const files={...smsPlatform,...smsMembers(plugin,store,provider)};
  const pkg='ai/eliza/plugins/messages/';
  const product='ai/elizaresearch/alphaphone/';
  function edit(path, from, to) {files[path]=replace(files[path],from,to);}
  const telephony=pkg+'TelephonyPlugin.java';
  edit(telephony,'import android.content.Intent;','import android.content.Intent;\nimport org.json.JSONObject;');
  const destroy=' @Override protected void handleOnDestroy()';
  edit(telephony,destroy,slice(plugin,' // ---- Reviewed native MMS',destroy)+destroy);

  const mmsStore=pkg+'MmsStore.java';
  edit(mmsStore,'import java.io.File;',`import java.io.*;
import java.util.LinkedHashSet;
import java.util.UUID;`);
  const stubStart=' static String newFileName()';
  const stubs=files[mmsStore].slice(files[mmsStore].indexOf(stubStart),files[mmsStore].lastIndexOf('}'));
  assert.ok(stubs.startsWith(stubStart));
  edit(mmsStore,stubs,slice(store,' static final int ADDRESS_FROM',' public static boolean isDefaultSmsApp')
    +slice(store,' public static long persistOutgoingMms',' // ---- Notices')
    .replace(/^ static Uri fileUri\(SmsRoleConfiguration[^\n]+\n/m,''));

  files[pkg+'SmsFixtureSupport.java']=`package ai.eliza.plugins.messages;
final class System {static long currentTimeMillis(){return MmsDispatchTraces.NOW;}}`;
  edit(product+'SmsFixtureSupport.java','SmsDispatchTraces.write','MmsDispatchTraces.write');
  edit('com/getcapacitor/Plugin.java','!event.equals("smsSendUpdated")','!event.equals("mmsSendUpdated")');
  edit('android/content/Context.java',' public File getNoBackupFilesDir()',` public File getCacheDir(){return noBackup;}
 public File getNoBackupFilesDir()`);
  edit('android/content/Intent.java',' public byte[] getByteArrayExtra',` public Intent putExtra(String key,byte[] value){extras.put(key,value);return this;}
 public byte[] getByteArrayExtra`);
  edit('android/net/Uri.java',' public String toString()',` public String getLastPathSegment(){return text.substring(text.lastIndexOf('/')+1);}
 public static final class Builder{
  private String scheme,authority,path;
  public Builder scheme(String value){scheme=value;return this;}
  public Builder authority(String value){authority=value;return this;}
  public Builder appendPath(String value){path=value;return this;}
  public Uri build(){return Uri.parse(scheme+"://"+authority+"/"+path);}
 }
 public String toString()`);
  edit('android/app/Activity.java',' public boolean isFinishing()',` public static final class Metrics {public float density=1;}
 public static final class Resources {public Metrics getDisplayMetrics(){return new Metrics();}}
 public Resources getResources(){return new Resources();}
 public boolean isFinishing()`);
  edit('android/app/AlertDialog.java',' public String title,message;',` public android.widget.LinearLayout preview;
 public String title,message;`);
  edit('android/app/AlertDialog.java','  public AlertDialog create()',`  public Builder setView(android.widget.LinearLayout value){dialog.preview=value;return this;}
  public AlertDialog create()`);
  files['android/widget/LinearLayout.java']=`package android.widget;
public final class LinearLayout {
 public static final int HORIZONTAL=0;
 public final java.util.List<ImageView> images=new java.util.ArrayList<>();
 public LinearLayout(android.app.Activity activity){}
 public void setOrientation(int value){}
 public void addView(ImageView view,LayoutParams params){images.add(view);}
 public int getChildCount(){return images.size();}
 public static final class LayoutParams {
  public LayoutParams(int x,int y){}
  public void setMargins(int l,int t,int r,int b){}
 }
}`;
  files['android/widget/ImageView.java']=`package android.widget;
public final class ImageView {
 public enum ScaleType {CENTER_CROP}
 public String description;
 public android.graphics.Bitmap image;
 public ImageView(android.app.Activity activity){}
 public void setImageBitmap(android.graphics.Bitmap image){this.image=image;}
 public void setScaleType(ScaleType type){}
 public void setContentDescription(String value){description=value;}
}`;
  files['android/graphics/Bitmap.java']=`package android.graphics;
public record Bitmap(byte[] bytes){}`;
  files['android/graphics/BitmapFactory.java']=`package android.graphics;
public final class BitmapFactory {
 public static final class Options {public boolean inJustDecodeBounds;public int outWidth,outHeight,inSampleSize;}
 public static Bitmap decodeByteArray(byte[] bytes,int start,int length,Options options){
  if(options.inJustDecodeBounds){options.outWidth=144;options.outHeight=144;return null;}
  return new Bitmap(java.util.Arrays.copyOfRange(bytes,start,start+length));
 }
}`;
  files['android/os/Bundle.java']=`package android.os;
public final class Bundle {
 private final java.util.Map<String,Object> values=new java.util.HashMap<>();
 public void put(String name,Object value){values.put(name,value);}
 public boolean getBoolean(String name,boolean fallback){return (boolean)values.getOrDefault(name,fallback);}
 public int getInt(String name,int fallback){return (int)values.getOrDefault(name,fallback);}
}`;
  edit('android/telephony/SmsManager.java',' public static final String EXTRA_MMS_DATA="mms-data";',` public static final String EXTRA_MMS_DATA="mms-data",MMS_CONFIG_MMS_ENABLED="enabled",MMS_CONFIG_MAX_MESSAGE_SIZE="max";
 public record Multimedia(Uri uri,PendingIntent callback,int sim){}
 public boolean carrierEnabled=true;
 public int carrierLimit=300*1024,mmsAttempts;
 public final List<Multimedia> multimedia=new ArrayList<>();
 public java.util.function.Consumer<Multimedia> beforeMms=unused->{};
 public android.os.Bundle getCarrierConfigValues(){
  android.os.Bundle carrier=new android.os.Bundle();
  carrier.put(MMS_CONFIG_MMS_ENABLED,carrierEnabled);carrier.put(MMS_CONFIG_MAX_MESSAGE_SIZE,carrierLimit);
  return carrier;
 }`);
  edit('android/telephony/SmsManager.java','public void sendMultimediaMessage(Context c,Uri uri,String location,Object options,PendingIntent sent){throw new AssertionError("MMS outside SMS fixture");}',`public void sendMultimediaMessage(Context c,Uri uri,String location,Object options,PendingIntent sent){
  Multimedia call=new Multimedia(uri,sent,sim);
  beforeMms.accept(call);mmsAttempts++;
  if(mode.equals("throw-before"))throw new IllegalStateException("Synthetic MMS refusal before handoff");
  multimedia.add(call);
  if(mode.equals("throw-after"))throw new IllegalStateException("Synthetic MMS refusal after handoff");
 }`);
  const providerPath='android/provider/Telephony.java';
  edit(providerPath,'\n}}',`
 }
 public static final class Threads {
  public static long getOrCreateThreadId(android.content.Context c,java.util.Set<String> recipients){
   c.provider.members=java.util.Set.copyOf(recipients);return 9;
  }
 }
 public static final class Mms {
  public static final Uri CONTENT_URI=Uri.parse("content://mms");
  public static final String THREAD_ID="thread",DATE="date",DATE_SENT="sent",MESSAGE_BOX="box",READ="read",SEEN="seen",
   MESSAGE_TYPE="type",MMS_VERSION="version",TRANSACTION_ID="transaction",CONTENT_TYPE="ctype",MESSAGE_CLASS="class",
   TEXT_ONLY="text",SUBSCRIPTION_ID="sub";
  public static final int MESSAGE_BOX_OUTBOX=4,MESSAGE_BOX_SENT=2,MESSAGE_BOX_FAILED=5;
  public static final class Outbox {public static final Uri CONTENT_URI=Uri.parse("content://mms/outbox");}
  public static final class Addr {public static final String ADDRESS="address",TYPE="type",CHARSET="charset",MSG_ID="message";}
  public static final class Part {
   public static final String MSG_ID="message",CONTENT_TYPE="type",CONTENT_ID="cid",CONTENT_LOCATION="location",
    NAME="name",FILENAME="filename",CHARSET="charset",TEXT="text";
  }
 }
}`);
  const resolver='android/content/ContentResolver.java';
  edit(resolver,'import android.provider.Telephony.Sms;',`import android.provider.Telephony.Sms;
import android.provider.Telephony.Mms;
import java.io.*;`);
  edit(resolver,' public boolean refuseInsert;',` public boolean refuseInsert,refuseMmsPart;
 public Set<String> members=Set.of();
 public final Map<Long,ContentValues> mms=new LinkedHashMap<>();
 public final Map<Uri,ContentValues> children=new LinkedHashMap<>();
 public final Map<Uri,ByteArrayOutputStream> bytes=new LinkedHashMap<>();
 public int deletedMms;
 public OutputStream openOutputStream(Uri row){
  if(!children.containsKey(row))throw new AssertionError("MMS part must be created");
  ByteArrayOutputStream out=new ByteArrayOutputStream();bytes.put(row,out);return out;
 }
 public int delete(Uri uri,String where,String[] args){
  long id=ContentUris.parseId(uri);
  if(mms.remove(id)==null)return 0;
  String prefix=uri+"/";
  children.keySet().removeIf(key->key.toString().startsWith(prefix));
  bytes.keySet().removeIf(key->key.toString().startsWith(prefix));
  deletedMms++;
  return 1;
 }`);
  edit(resolver,'  if(refuseInsert)return null;',`  if(refuseInsert)return null;
  if(uri.toString().startsWith("content://mms/")){
   if(!context.role)throw new AssertionError("Only default role can persist MMS");
   if(uri.equals(Mms.Outbox.CONTENT_URI)){
    long id=++sequence;mms.put(id,value);return ContentUris.withAppendedId(Mms.CONTENT_URI,id);
   }
   String[] pieces=uri.toString().split("/");
   if(pieces.length!=5||!mms.containsKey(Long.parseLong(pieces[3]))||!Set.of("addr","part").contains(pieces[4]))
    throw new AssertionError("Exact MMS children belong to the outbox row");
   if(refuseMmsPart&&pieces[4].equals("part")&&value.get(Mms.Part.CONTENT_TYPE).equals("image/png"))return null;
   Uri child=ContentUris.withAppendedId(uri,++sequence);children.put(child,value);return child;
  }`);
  edit(resolver,'  if(!where.equals(Sms.TYPE',`  if(uri.toString().startsWith("content://mms/")){
   if(!context.role||!where.equals(Mms.MESSAGE_BOX+" = ?")||!Arrays.equals(args,new String[]{"4"}))
    throw new AssertionError("Only exact MMS outbox can settle");
   ContentValues row=mms.get(ContentUris.parseId(uri));
   if(row==null||!Objects.equals(row.get(Mms.MESSAGE_BOX),4))return 0;
   row.putAll(value);return 1;
  }
  if(!where.equals(Sms.TYPE`);
  return files;
}
