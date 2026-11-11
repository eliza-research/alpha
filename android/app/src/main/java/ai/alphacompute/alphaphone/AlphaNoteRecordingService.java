package ai.alphacompute.alphaphone;

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
 * Stop in the notification stops it as Stop does in Notes: the recording is kept for Notes to save.
 * The chronometer shows the recording's own length, not the time since the last resume.
 */
public final class AlphaNoteRecordingService extends Service {
 static final String CHANNEL="alpha.notes.recording";
 static final int NOTIFICATION_ID=0x4e524543; // "NREC"
 static final String ACTION_START="ai.alphacompute.alphaphone.notes.recording.START";
 static final String ACTION_PAUSE="ai.alphacompute.alphaphone.notes.recording.PAUSE";
 static final String ACTION_STOP="ai.alphacompute.alphaphone.notes.recording.STOP";
 static final String ACTION_RESUME="ai.alphacompute.alphaphone.notes.recording.RESUME";
 /** Stop in the notification: the microphone is released and the recording is kept for Notes to save. */
 static final String ACTION_FINISH="ai.alphacompute.alphaphone.notes.recording.FINISH";
 /** True while this service holds the foreground with its notification. */
 private static volatile boolean foreground;
 private static volatile String foregroundRecording;
 private static volatile AlphaNoteRecordingService activeService;
 private volatile int lastStartId;
 static final String EXTRA_RECORDING="recording";

 static void start(Context context,String recordingId){
  try{context.startForegroundService(intent(context,ACTION_START,recordingId));}
  catch(RuntimeException refused){/* The recording continues while Alpha is in the foreground. */}
 }
 /** The recording is stopped, saved or discarded: leave the foreground. */
 static void recordingClosed(Context context,String recordingId){
  try{context.startService(intent(context,ACTION_STOP,recordingId));}
  catch(RuntimeException backgroundRestricted){
   AlphaNoteRecordingService service=activeService;
   if(service!=null){
    int startId=service.lastStartId;
    new android.os.Handler(android.os.Looper.getMainLooper()).post(()->service.stopClosedRecording(recordingId,startId));
   }
  }
 }
 /** The recording paused or resumed (in Alpha or from the notification): show its state. */
 static void refresh(Context context){
  if(!foreground)return;
  JSObject status=AlphaNoteRecorder.get(context).status();String state=status.optString("state");
  if(!"recording".equals(state)&&!"paused".equals(state))return;
  if(!java.util.Objects.equals(foregroundRecording,status.getString("recordingId")))return;
  context.getSystemService(NotificationManager.class).notify(NOTIFICATION_ID,notification(context,status));
 }
 private static Intent intent(Context context,String action,String recordingId){
  String identity=recordingId==null?"":recordingId;
  // Extras do not identify a PendingIntent. UPDATE_CURRENT may rewrite even an immutable
  // token held by an old notification, so give each recording its own filter identity.
  return new Intent(context,AlphaNoteRecordingService.class).setAction(action).setIdentifier(identity).putExtra(EXTRA_RECORDING,identity);
 }

 @Override public IBinder onBind(Intent intent){return null;}

 @Override public int onStartCommand(Intent intent,int flags,int startId){
  activeService=this;lastStartId=startId;
  String action=intent==null?null:intent.getAction();
  String recording=intent==null?"":intent.getStringExtra(EXTRA_RECORDING);
  AlphaNoteRecorder recorder=AlphaNoteRecorder.get(this);
  if(ACTION_PAUSE.equals(action)||ACTION_RESUME.equals(action)){
   // A retained Resume must not rearm after Stop or revive a service that lost its foreground.
   if(recording!=null&&recorder.owns(recording))try{if(ACTION_PAUSE.equals(action))recorder.pause(recording);else if(foreground&&recording.equals(foregroundRecording)&&"paused".equals(recorder.status().optString("state")))recorder.resume(recording);}catch(RuntimeException|java.io.IOException changed){/* Closed, or the microphone is unavailable: the state is shown as it is. */}
   refresh(this);
   return START_NOT_STICKY;
  }
  if(ACTION_FINISH.equals(action)){
   // The same stop as in Notes: the recording stays open, stopped, until Notes saves or discards it.
   if(recording!=null&&recorder.owns(recording))try{recorder.stop(recording);}catch(RuntimeException changed){/* Closed meanwhile: the state is shown as it is. */}
   stopClosedRecording(recording,startId);
   return START_NOT_STICKY;
  }
  if(ACTION_STOP.equals(action)){
   stopClosedRecording(recording,startId);
   return START_NOT_STICKY;
  }
  // An already foreground service keeps its owner when a retired start arrives late.
  if(foreground&&(recording==null||!recorder.owns(recording)))return START_NOT_STICKY;
  // An initial start enters the foreground first, including one later refused as stale.
  try{
   Notification shown=notification(this,recorder.status());
   if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.R)startForeground(NOTIFICATION_ID,shown,ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
   else startForeground(NOTIFICATION_ID,shown);
   foregroundRecording=recording;
   foreground=true;
  }catch(RuntimeException refused){stopSelf(startId);return START_NOT_STICKY;}
  if(recording==null||!recorder.owns(recording)){foregroundRecording=null;foreground=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf(startId);}
  return START_NOT_STICKY;
 }
 /** A failed command launch may retire only this service's current recording and start ID. */
 private void stopClosedRecording(String recording,int startId){
  if(activeService!=this)return;
  AlphaNoteRecorder recorder=AlphaNoteRecorder.get(this);
  String state=recorder.status().optString("state");
  if("recording".equals(state)||"paused".equals(state))return;
  if(recording==null||recording.isEmpty()){
   if(recorder.open())return;
  }else{
   if(foreground&&!recording.equals(foregroundRecording))return;
   if(recorder.open()&&!recorder.owns(recording))return;
  }
  if(!stopSelfResult(startId))return;
  foregroundRecording=null;foreground=false;stopForeground(STOP_FOREGROUND_REMOVE);
 }
 @Override public void onDestroy(){if(activeService==this){activeService=null;foregroundRecording=null;foreground=false;}super.onDestroy();}

 /** "Recording" with a chronometer at the recording's length and Pause, or "Paused" with Resume; Stop in both. */
 static Notification notification(Context context,JSObject status){
  NotificationManager manager=context.getSystemService(NotificationManager.class);
  // Created each time: on a phone that already has the channel this only adds its description.
  NotificationChannel channel=new NotificationChannel(CHANNEL,"Notes recording",NotificationManager.IMPORTANCE_LOW);
  channel.setDescription("Shown while Notes is recording, with Pause and Stop.");
  channel.setShowBadge(false);
  manager.createNotificationChannel(channel);
  String recording=status.optString("recordingId","");boolean paused="paused".equals(status.optString("state"));
  Intent open=new Intent(context,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
  PendingIntent content=PendingIntent.getActivity(context,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  PendingIntent toggle=PendingIntent.getService(context,paused?2:1,intent(context,paused?ACTION_RESUME:ACTION_PAUSE,recording),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  PendingIntent finish=PendingIntent.getService(context,3,intent(context,ACTION_FINISH,recording),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  Notification.Builder builder=new Notification.Builder(context,CHANNEL)
   .setSmallIcon(R.drawable.ic_note_recording)
   .setContentTitle(paused?"Paused":"Recording")
   .setContentText("Stop here, then save it in Notes.")
   .setContentIntent(content)
   .setOngoing(true)
   .setOnlyAlertOnce(true)
   .setCategory(Notification.CATEGORY_SERVICE)
   // Nothing here is private: the lock screen shows the state with Pause and Stop.
   .setVisibility(Notification.VISIBILITY_PUBLIC)
   .addAction(new Notification.Action.Builder(null,paused?"Resume":"Pause",toggle).build())
   .addAction(new Notification.Action.Builder(null,"Stop",finish).build());
  if(paused)builder.setShowWhen(false).setUsesChronometer(false);
  else builder.setUsesChronometer(true).setShowWhen(true).setWhen(System.currentTimeMillis()-Math.max(0,status.optLong("durationMs",0)));
  return builder.build();
 }
}
