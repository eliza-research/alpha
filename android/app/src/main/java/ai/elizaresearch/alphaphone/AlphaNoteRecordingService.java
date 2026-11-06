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

/**
 * Keeps an open Notes recording (AlphaNoteRecorder) running with the screen off, as a
 * microphone-type foreground service with an ongoing notification. It is started from the
 * foreground when a recording starts or resumes and ends when the recording is stopped,
 * saved or discarded. It never starts the microphone on its own; Pause in the notification
 * pauses the open recording.
 */
public final class AlphaNoteRecordingService extends Service {
 static final String CHANNEL="alpha.notes.recording";
 static final int NOTIFICATION_ID=0x4e524543; // "NREC"
 static final String ACTION_START="ai.elizaresearch.alphaphone.notes.recording.START";
 static final String ACTION_PAUSE="ai.elizaresearch.alphaphone.notes.recording.PAUSE";
 static final String ACTION_STOP="ai.elizaresearch.alphaphone.notes.recording.STOP";
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
 private static Intent intent(Context context,String action,String recordingId){
  return new Intent(context,AlphaNoteRecordingService.class).setAction(action).putExtra(EXTRA_RECORDING,recordingId==null?"":recordingId);
 }

 @Override public IBinder onBind(Intent intent){return null;}

 @Override public int onStartCommand(Intent intent,int flags,int startId){
  String action=intent==null?null:intent.getAction();
  String recording=intent==null?"":intent.getStringExtra(EXTRA_RECORDING);
  AlphaNoteRecorder recorder=AlphaNoteRecorder.get(this);
  if(ACTION_PAUSE.equals(action)){
   if(recording!=null&&recorder.owns(recording))try{recorder.pause(recording);}catch(RuntimeException changed){/* Already closed. */}
   return START_NOT_STICKY;
  }
  if(ACTION_STOP.equals(action)){
   // Commands arrive in order: a later resume starts the service again.
   stopForeground(STOP_FOREGROUND_REMOVE);stopSelf(startId);
   return START_NOT_STICKY;
  }
  // A start command always enters the foreground first (the platform requires it).
  try{
   if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.R)startForeground(NOTIFICATION_ID,notification(recording),ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
   else startForeground(NOTIFICATION_ID,notification(recording));
  }catch(RuntimeException refused){stopSelf(startId);return START_NOT_STICKY;}
  if(recording==null||!recorder.owns(recording)){stopForeground(STOP_FOREGROUND_REMOVE);stopSelf(startId);}
  return START_NOT_STICKY;
 }

 private Notification notification(String recording){
  NotificationManager manager=getSystemService(NotificationManager.class);
  if(manager.getNotificationChannel(CHANNEL)==null){
   NotificationChannel channel=new NotificationChannel(CHANNEL,"Notes recording",NotificationManager.IMPORTANCE_LOW);
   channel.setShowBadge(false);
   manager.createNotificationChannel(channel);
  }
  Intent open=new Intent(this,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
  PendingIntent content=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  PendingIntent pause=PendingIntent.getService(this,1,intent(this,ACTION_PAUSE,recording),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  return new Notification.Builder(this,CHANNEL)
   .setSmallIcon(android.R.drawable.ic_btn_speak_now)
   .setContentTitle("Recording")
   .setContentIntent(content)
   .setOngoing(true)
   .setOnlyAlertOnce(true)
   .setUsesChronometer(true)
   .setCategory(Notification.CATEGORY_SERVICE)
   .addAction(new Notification.Action.Builder(null,"Pause",pause).build())
   .build();
 }
}
