package ai.elizaresearch.alphaphone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import com.getcapacitor.JSObject;

/**
 * Keeps an open Notes recording (AlphaNoteRecorder) running with the screen off, as a
 * microphone-type foreground service with an ongoing notification. It is started from the
 * foreground when a recording starts or resumes and ends when the recording is stopped,
 * saved or discarded. It never starts the microphone on its own; Pause in the notification
 * pauses the open recording, and while it is paused the notification says so and offers Resume.
 * The chronometer shows the recording's own length, not the time since the last resume.
 */
public final class AlphaNoteRecordingService extends Service {
 static final String CHANNEL="alpha.notes.recording";
 static final int NOTIFICATION_ID=0x4e524543; // "NREC"
 static final String ACTION_START="ai.elizaresearch.alphaphone.notes.recording.START";
 static final String ACTION_PAUSE="ai.elizaresearch.alphaphone.notes.recording.PAUSE";
 static final String ACTION_STOP="ai.elizaresearch.alphaphone.notes.recording.STOP";
 static final String ACTION_RESUME="ai.elizaresearch.alphaphone.notes.recording.RESUME";
 /** True while this service holds the foreground with its notification. */
 private static volatile boolean foreground;
 static final String EXTRA_RECORDING="recording";

 static void start(Context context,String recordingId){
  try{context.startForegroundService(intent(context,ACTION_START,recordingId));}
  catch(RuntimeException refused){/* The recording continues while Alpha is in the foreground. */}
 }
 /** The recording is stopped, saved or discarded: leave the foreground. */
 static void recordingClosed(Context context,String recordingId){
  try{context.startService(intent(context,ACTION_STOP,recordingId));}
  catch(RuntimeException backgroundRestricted){context.stopService(new Intent(context,AlphaNoteRecordingService.class));}
 }
 /** The recording paused or resumed (in Alpha or from the notification): show its state. */
 static void refresh(Context context){
  if(!foreground)return;
  JSObject status=AlphaNoteRecorder.get(context).status();String state=status.optString("state");
  if(!"recording".equals(state)&&!"paused".equals(state))return;
  context.getSystemService(NotificationManager.class).notify(NOTIFICATION_ID,notification(context,status));
 }
 private static Intent intent(Context context,String action,String recordingId){
  return new Intent(context,AlphaNoteRecordingService.class).setAction(action).putExtra(EXTRA_RECORDING,recordingId==null?"":recordingId);
 }

 @Override public IBinder onBind(Intent intent){return null;}

 @Override public int onStartCommand(Intent intent,int flags,int startId){
  String action=intent==null?null:intent.getAction();
  String recording=intent==null?"":intent.getStringExtra(EXTRA_RECORDING);
  AlphaNoteRecorder recorder=AlphaNoteRecorder.get(this);
  if(ACTION_PAUSE.equals(action)||ACTION_RESUME.equals(action)){
   if(recording!=null&&recorder.owns(recording))try{if(ACTION_PAUSE.equals(action))recorder.pause(recording);else recorder.resume(recording);}catch(RuntimeException|java.io.IOException changed){/* Closed, or the microphone is unavailable: the state is shown as it is. */}
   refresh(this);
   return START_NOT_STICKY;
  }
  if(ACTION_STOP.equals(action)){
   // Commands arrive in order: a later resume starts the service again.
   foreground=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf(startId);
   return START_NOT_STICKY;
  }
  // A start command always enters the foreground first (the platform requires it).
  try{
   Notification shown=notification(this,recorder.status());
   if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.R)startForeground(NOTIFICATION_ID,shown,ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
   else startForeground(NOTIFICATION_ID,shown);
   foreground=true;
  }catch(RuntimeException refused){stopSelf(startId);return START_NOT_STICKY;}
  if(recording==null||!recorder.owns(recording)){foreground=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf(startId);}
  return START_NOT_STICKY;
 }
 @Override public void onDestroy(){foreground=false;super.onDestroy();}

 /** "Recording" with a chronometer at the recording's length and Pause, or "Paused" with Resume. */
 static Notification notification(Context context,JSObject status){
  NotificationManager manager=context.getSystemService(NotificationManager.class);
  if(manager.getNotificationChannel(CHANNEL)==null){
   NotificationChannel channel=new NotificationChannel(CHANNEL,"Notes recording",NotificationManager.IMPORTANCE_LOW);
   channel.setShowBadge(false);
   manager.createNotificationChannel(channel);
  }
  String recording=status.optString("recordingId","");boolean paused="paused".equals(status.optString("state"));
  Intent open=new Intent(context,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
  PendingIntent content=PendingIntent.getActivity(context,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  PendingIntent toggle=PendingIntent.getService(context,paused?2:1,intent(context,paused?ACTION_RESUME:ACTION_PAUSE,recording),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  Notification.Builder builder=new Notification.Builder(context,CHANNEL)
   .setSmallIcon(android.R.drawable.ic_btn_speak_now)
   .setContentTitle(paused?"Paused":"Recording")
   .setContentIntent(content)
   .setOngoing(true)
   .setOnlyAlertOnce(true)
   .setCategory(Notification.CATEGORY_SERVICE)
   .addAction(new Notification.Action.Builder(null,paused?"Resume":"Pause",toggle).build());
  if(paused)builder.setShowWhen(false).setUsesChronometer(false);
  else builder.setUsesChronometer(true).setShowWhen(true).setWhen(System.currentTimeMillis()-Math.max(0,status.optLong("durationMs",0)));
  return builder.build();
 }
}
