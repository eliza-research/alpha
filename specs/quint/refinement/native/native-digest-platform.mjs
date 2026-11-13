import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {app,root} from './java.mjs';

export const digestBoundary=app+'HostedDelivery.java';
export const digestProduct=['NativeDigestHost','NativeDigestSources','HostedResultNotices'].map(name=>app+name+'.java');
export const noticeOwner='plugins/plugin-native-notifications/android/src/main/java/ai/eliza/plugins/notifications/NoticeOwner.java';

export function nativeDigestPlatform() {
  const directory=mkdtempSync(join(tmpdir(),'quint-native-digest-'));
  const close=()=>rmSync(directory,{recursive:true,force:true});
  try {
    const source=readFileSync(join(root,digestBoundary),'utf8');
    const start=source.indexOf(' interface NativeSourceWork');
    const end=source.indexOf(' private JSONObject active()',start);
    assert.ok(start>=0&&end>start&&source.slice(start,end).includes('t.verify();'));
    const files={
      'android/Manifest.java':'package android; public final class Manifest { public static final class permission { public static final String READ_CALENDAR="synthetic-calendar"; } }',
      'android/content/Context.java':`package android.content;
public final class Context {
 public Context getApplicationContext(){return this;}
 public ContentResolver getContentResolver(){return new ContentResolver();}
}`,
      'android/content/ContentResolver.java':'package android.content; public final class ContentResolver {}',
      'android/content/pm/PackageManager.java':'package android.content.pm; public final class PackageManager {public static final int PERMISSION_GRANTED=0;}',
      'androidx/core/content/ContextCompat.java':`package androidx.core.content;
import android.content.Context;
import ai.alphacompute.alphaphone.NativeDigestTraces;
public final class ContextCompat {
 public static int checkSelfPermission(Context context,String permission){
  if(!android.Manifest.permission.READ_CALENDAR.equals(permission))throw new AssertionError("Unexpected permission");
  return NativeDigestTraces.calendarPermission()?0:-1;
 }
}`,
      'ai/eliza/plugins/calendar/read/SelectedCalendarReader.java':`package ai.eliza.plugins.calendar.read;
import android.content.ContentResolver;
import org.json.JSONArray;
import ai.alphacompute.alphaphone.NativeDigestTraces;
public final class SelectedCalendarReader {
 public static void assertSourceIdentities(ContentResolver resolver,JSONArray ids)throws Exception {
  NativeDigestTraces.calendarIdentities(ids);
 }
 public static JSONArray readOwnerDay(ContentResolver resolver,JSONArray ids,String start,String end,
  int maximum,String startDate,String endDate)throws Exception {
  return NativeDigestTraces.calendarRows(ids,start,end,maximum,startDate,endDate);
 }
}`,
      'ai/alphacompute/alphaphone/DigestPorts.java':`package ai.alphacompute.alphaphone;
import android.content.Context;
import org.json.*;
final class AlphaCredentialStore {
 AlphaCredentialStore(Context context){}
 String readCredentialSlot(String key)throws Exception{return NativeDigestTraces.readSlot(key);}
 void writeCredentialSlot(String key,String value)throws Exception{NativeDigestTraces.writeSlot(key,value);}
}
final class AlphaReminders {
 static AlphaReminders engine(Context context){return new AlphaReminders();}
 JSONArray list()throws Exception{return NativeDigestTraces.reminderRows();}
}
final class System {
 static long currentTimeMillis(){return NativeDigestTraces.wallTime();}
}
final class HostedInbox {
 interface DeliveryTransport extends AutoCloseable {
  void verify()throws Exception;
  void check()throws Exception;
  void close();
 }
 interface Store {String read(String key)throws Exception;}
}
final class HostedDelivery {
 private static final HostedDelivery INSTANCE=new HostedDelivery();
 static HostedDelivery get(Context context){return INSTANCE;}
 final Object gate=new Object();
 final HostedInbox.Store store=NativeDigestTraces::readSlot;
 JSONObject active(){return NativeDigestTraces.activeBinding();}
 void check(String generation){NativeDigestTraces.checkGeneration(generation);}
 HostedInbox.DeliveryTransport openTransport(JSONObject binding,NativeDigestSources.Guard guard){
  return new HostedInbox.DeliveryTransport(){
   public void verify()throws Exception{check();}
   public void check()throws Exception{guard.check();NativeDigestTraces.checkTransport();}
   public void close(){}
  };
 }
${source.slice(start,end)}
}`,
    };
    const paths=Object.entries(files).map(([name,content])=>{
      const path=join(directory,name);
      mkdirSync(dirname(path),{recursive:true});
      writeFileSync(path,content);
      return path;
    });
    return {paths,close};
  }catch(error){close();throw error;}
}
