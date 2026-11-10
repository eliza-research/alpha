package ai.alphacompute.alphaphone;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.CalendarContract;
import ai.eliza.auth.cloud.CloudKeyRevocation;
import ai.eliza.plugins.calendar.CalendarConfiguration;
import ai.eliza.plugins.system.reset.DataReset;
import org.json.JSONObject;

/**
 * Alpha's work before the reset's package-scoped clear (AlphaDataReset): deleting its own "On this
 * phone" calendar, which lives in the system Calendar provider and so survives the clear, then the
 * shared ai.eliza.auth.cloud.CloudKeyRevocation reset step over this build's registration and slots,
 * and over a retained pre-namespace production key.
 */
final class ResetBeforeDispatch {
 static final DataReset.BeforeDispatch STEP=create(CloudKeyRevocation::revoke);
 /** The calendar delete is local; it never takes more of the budget than this. */
 static final long CALENDAR_BUDGET_MS=2000;

 /**
  * Best effort and within the coordinator's budget, run only while a confirmed reset is pending:
  * Alpha's own calendar, then this phone's Eliza Cloud key(s) (each step capped at 8 s on an
  * interrupted daemon worker), then a retained pre-namespace production key with what time is left.
  * The transport is injectable for host tests.
  */
 static DataReset.BeforeDispatch create(CloudKeyRevocation.Transport transport){
  CloudKeyRevocation.ResetStep<Context> cloud=CloudKeyRevocation.resetStep(()->AlphaCloudSignInPlugin.REGISTRATION,AlphaCredentialStore::readSlotBeforeAttach,transport);
  CloudKeyRevocation.ResetStep<Context> legacy=CloudKeyRevocation.resetStep(()->AlphaCloudSignInPlugin.REGISTRATION,ResetBeforeDispatch::readLegacyCloudSlot,transport);
  return (context,timeoutMs)->{
   long deadline=System.nanoTime()+timeoutMs*1_000_000L;
   deleteLocalCalendar(context,Math.min(CALENDAR_BUDGET_MS,timeoutMs));
   cloud.run(context,remaining(deadline));
   legacy.run(context,remaining(deadline));
  };
 }
 private static long remaining(long deadline){return Math.max(0,(deadline-System.nanoTime())/1_000_000L);}

 /** The raw pre-namespace production slot (LegacyCloudRecovery), only when it holds another key and
  * this build still targets the deployment that issued it: a key is never sent to another Cloud. */
 static String readLegacyCloudSlot(Context base,String slot)throws Exception{
  if(!"cloud:production".equals(slot)||!LegacyCloudRecovery.LEGACY_NAMESPACE.equals(CloudDeployment.STORAGE_NAMESPACE))return null;
  return distinctCredential(AlphaCredentialStore.readLegacySlotBeforeAttach(base,slot),AlphaCredentialStore.readSlotBeforeAttach(base,slot));
 }
 /** The legacy record unless it is the same credential as the current one (already revoked). */
 static String distinctCredential(String legacy,String current){
  if(legacy==null||current==null)return legacy;
  try{
   JSONObject before=new JSONObject(legacy),now=new JSONObject(current);
   String id=before.optString("credentialId","");
   if(!id.isEmpty()&&id.equals(now.optString("credentialId","")))return null;
   String token=before.optString("token","");
   return !token.isEmpty()&&token.equals(now.optString("token",""))?null:legacy;
  }catch(Exception damaged){return legacy;}
 }

 /** Deletes Alpha's LOCAL calendar row (account, type and name; its events go with it) as its sync
  * adapter. Skipped without WRITE_CALENDAR; never throws and never waits past timeoutMs. */
 static void deleteLocalCalendar(Context context,long timeoutMs){
  if(timeoutMs<=0)return;
  Thread worker=new Thread(()->{
   try{
    if(context.checkSelfPermission(Manifest.permission.WRITE_CALENDAR)!=PackageManager.PERMISSION_GRANTED)return;
    CalendarConfiguration calendar=AlphaCalendarPlugin.CONFIGURATION;
    Uri uri=CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,calendar.accountName).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build();
    context.getContentResolver().delete(uri,CalendarContract.Calendars.ACCOUNT_NAME+"=? AND "+CalendarContract.Calendars.ACCOUNT_TYPE+"=? AND "+CalendarContract.Calendars.NAME+"=?",new String[]{calendar.accountName,CalendarContract.ACCOUNT_TYPE_LOCAL,calendar.localCalendarName});
   }catch(Exception unavailable){/* The local reset must still proceed. */}
  },"alpha-reset-calendar");
  worker.setDaemon(true);
  worker.start();
  try{worker.join(timeoutMs);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();}
 }
 private ResetBeforeDispatch(){}
}
