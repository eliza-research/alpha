package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.util.concurrent.*;
import org.json.JSONObject;

final class HostedNoticePoster implements HostedResultNotices.Poster {
 private final Context context;
 private static final String CHANNEL=AlphaHostedResultsPlugin.CHANNEL,ACTION=AlphaHostedResultsPlugin.ACTION,PREFIX=AlphaHostedResultsPlugin.PREFIX;
 HostedNoticePoster(Context context){this.context=context.getApplicationContext();channel();}
 public boolean active(String key){for(android.service.notification.StatusBarNotification item:manager().getActiveNotifications())if(key.equals(item.getTag()))return true;return false;}
 public void cancel(String key){manager().cancel(key,0);Intent open=new Intent(context,MainActivity.class).setAction(ACTION).setData(Uri.parse(PREFIX+key)).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);PendingIntent tap=PendingIntent.getActivity(context,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_NO_CREATE);if(tap!=null)tap.cancel();Intent ask=new Intent(open).setAction(AlphaHostedResultsPlugin.ASK_ACTION);PendingIntent question=PendingIntent.getActivity(context,0,ask,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_NO_CREATE);if(question!=null)question.cancel();}
 private NotificationManager manager(){return context.getSystemService(NotificationManager.class);}
 void channel(){NotificationChannel c=new NotificationChannel(CHANNEL,"Scheduled digest results",NotificationManager.IMPORTANCE_DEFAULT);c.setDescription("Private hosted results. Open Alpha Phone to review with the matching account.");c.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);manager().createNotificationChannel(c);}
 public boolean allowed(){if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return false;NotificationChannel c=manager().getNotificationChannel(CHANNEL);return manager().areNotificationsEnabled()&&c!=null&&c.getImportance()!=NotificationManager.IMPORTANCE_NONE;}
 public void post(String key){
  Intent open=new Intent(context,MainActivity.class).setAction(ACTION).setData(Uri.parse(PREFIX+key)).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
  PendingIntent tap=PendingIntent.getActivity(context,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  Notification redacted=new Notification.Builder(context,CHANNEL).setSmallIcon(R.drawable.notification_icon).setContentTitle("Alpha Phone result").setContentText("Open Alpha Phone to review.").build();
  PendingIntent ask=PendingIntent.getActivity(context,0,new Intent(open).setAction(AlphaHostedResultsPlugin.ASK_ACTION),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  manager().notify(key,0,result(tap,redacted,ask).build());
 }
 /** Visible for builder tests. Superseded by the next daily brief; withdrawn after a day or when opened. */
 Notification.Builder result(PendingIntent tap,Notification redacted){return result(tap,redacted,null);}
 Notification.Builder result(PendingIntent tap,Notification redacted,PendingIntent ask){Notification.Builder builder=new Notification.Builder(context,CHANNEL).setSmallIcon(R.drawable.notification_icon).setContentTitle("Scheduled result ready").setContentText("Open Alpha Phone to review with the matching account.").setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(redacted).setContentIntent(tap).setOnlyAlertOnce(true).setAutoCancel(true).setTimeoutAfter(HostedResultNotices.SUPERSEDE_AFTER_MS).setCategory(Notification.CATEGORY_STATUS);if(ask!=null){Notification.Action.Builder action=new Notification.Action.Builder(null,"Ask Alpha",ask);if(Build.VERSION.SDK_INT>=31)action.setAuthenticationRequired(true);builder.addAction(action.build());}return builder;}
 static final String ASK_RENEW_ACTION="ai.elizaresearch.alphaphone.ASK_HOSTED_SOURCE_RENEWAL";
 static final String RENEW_ACTION="ai.elizaresearch.alphaphone.RENEW_HOSTED_SOURCE",RENEW_PREFIX="alpha-hosted-renew:";
 static String renewalTag(String sourceId){return "alpha-source-renewal-"+HostedResultNotices.sourceId(sourceId);}
 /** Redacted: no source label, calendar or reminder content. Renew only opens the review; it never renews by itself. */
 Notification.Builder renewal(String sourceId,long expiresAt,long now){
  Intent open=new Intent(context,MainActivity.class).setAction(RENEW_ACTION).setData(Uri.parse(RENEW_PREFIX+HostedResultNotices.sourceId(sourceId))).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
  PendingIntent tap=PendingIntent.getActivity(context,sourceId.hashCode(),open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  Notification redacted=new Notification.Builder(context,CHANNEL).setSmallIcon(R.drawable.notification_icon).setContentTitle("Alpha Phone").setContentText("Open Alpha Phone to review.").build();
  PendingIntent ask=PendingIntent.getActivity(context,sourceId.hashCode(),new Intent(open).setAction(ASK_RENEW_ACTION),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);Notification.Action.Builder question=new Notification.Action.Builder(null,"Ask Alpha",ask);if(Build.VERSION.SDK_INT>=31)question.setAuthenticationRequired(true);
  return new Notification.Builder(context,CHANNEL).setSmallIcon(R.drawable.notification_icon).setContentTitle("Scheduled brief source expires soon").setContentText("Renew it in Alpha Phone to keep your brief reading it.").setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(redacted).setContentIntent(tap).addAction(new Notification.Action.Builder(null,"Renew",tap).build()).addAction(question.build()).setOnlyAlertOnce(true).setAutoCancel(true).setTimeoutAfter(HostedResultNotices.renewalTimeout(expiresAt,now)).setCategory(Notification.CATEGORY_REMINDER);
 }
 /** True when the notify call returned. A pre-dispatch refusal keeps the journal retryable. */
 boolean postRenewal(String sourceId,long expiresAt,long now){
  if(!allowed()||expiresAt<=now)return false;
  manager().notify(renewalTag(sourceId),0,renewal(sourceId,expiresAt,now).build());
  return true;
 }
 void cancelRenewal(String sourceId){manager().cancel(renewalTag(sourceId),0);for(String action:new String[]{RENEW_ACTION,ASK_RENEW_ACTION}){Intent intent=new Intent(context,MainActivity.class).setAction(action).setData(Uri.parse(RENEW_PREFIX+sourceId));PendingIntent tap=PendingIntent.getActivity(context,sourceId.hashCode(),intent,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_NO_CREATE);if(tap!=null)tap.cancel();}}
}
