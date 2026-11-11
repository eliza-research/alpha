package ai.alphacompute.alphaphone;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.provider.Settings;
import androidx.core.content.IntentCompat;

/** PackageInstaller can deliver the exact callback when no WebView or Alpha activity exists. */
public final class AlphaUpdateStatusReceiver extends BroadcastReceiver {
 private static final String PLATFORM_STATUS="ai.alphacompute.alphaphone.UPDATE_PLATFORM_STATUS";
 static final String RECEIPT_REQUIRED="ai.alphacompute.alphaphone.UPDATE_RECEIPT_REQUIRED";

 private static Uri callbackIdentity(String activation,int session){
  return Uri.parse("alpha-update-status:"+activation+"/"+session);
 }

 static IntentSender sender(Context context,String activation,int session){
  Intent callback=new Intent(context,AlphaUpdateStatusReceiver.class)
    .setAction(PLATFORM_STATUS).setData(callbackIdentity(activation,session));
  return PendingIntent.getBroadcast(context,session,callback,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_MUTABLE).getIntentSender();
 }

 @Override public void onReceive(Context context,Intent callback){
  if(!PLATFORM_STATUS.equals(callback.getAction()))return;
  try{
   var record=AlphaDevicePlugin.UpdatePause.store().read();
   int session=callback.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,-1);
   int status=callback.getIntExtra(PackageInstaller.EXTRA_STATUS,Integer.MIN_VALUE);
   if(record==null||!record.committing||record.session!=session||status==Integer.MIN_VALUE||
      !callbackIdentity(record.id,record.session).toString().equals(callback.getDataString())||
      record.boot!=Settings.Global.getInt(context.getContentResolver(),Settings.Global.BOOT_COUNT)||
      !record.signer.equals(AlphaDevicePlugin.appSigner(context)))return;
   Intent confirmation=null;
   if(status==PackageInstaller.STATUS_PENDING_USER_ACTION){
    var current=context.getPackageManager().getPackageInstaller().getSessionInfo(session);
    if(current==null||!current.isSealed()||!AlphaDevicePlugin.UpdatePause.binds(record,current))return;
    confirmation=IntentCompat.getParcelableExtra(callback,Intent.EXTRA_INTENT,Intent.class);
    if(confirmation!=null&&UpdateConfirmationReceipt.ACTION_CONFIRM_INSTALL.equals(confirmation.getAction())&&
       confirmation.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,-1)!=session)return;
    if(!UpdateConfirmationReceipt.capture(context,record,confirmation))return;
   }else UpdateConfirmationReceipt.retire(context,record);
   // This process may have an active bridge. It continues to own normal foreground handling.
   Intent forwarded=new Intent(AlphaDevicePlugin.UPDATE_STATUS).setPackage(context.getPackageName())
    .putExtra(PackageInstaller.EXTRA_SESSION_ID,session).putExtra(PackageInstaller.EXTRA_STATUS,status)
    .putExtra(RECEIPT_REQUIRED,true);
   if(confirmation!=null)forwarded.putExtra(Intent.EXTRA_INTENT,confirmation);
   context.sendBroadcast(forwarded);
  }catch(Exception unavailable){/* No read or journal receipt means the Android session remains fenced. */}
 }
}
