import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';

/** Android primitives for actual recorder/service coordination. Audio bytes stay synthetic. */
export function noteRecordingPlatform() {
  const directory=mkdtempSync(join(tmpdir(),'quint-note-recording-'));
  const files={
    'com/getcapacitor/JSArray.java':'package com.getcapacitor;public class JSArray extends org.json.JSONArray {}',
    'androidx/annotation/Nullable.java':'package androidx.annotation; public @interface Nullable {}',
    'android/content/Context.java':`package android.content;
import java.io.File;
public class Context {
  public File getNoBackupFilesDir(){return ai.alphacompute.alphaphone.NoteRecordingPorts.root;}
  public File getCacheDir(){File cache=new File(ai.alphacompute.alphaphone.NoteRecordingPorts.root,"cache");cache.mkdirs();return cache;}
  public Context getApplicationContext(){return this;}
  public <T>T getSystemService(Class<T> type){return type.cast(ai.alphacompute.alphaphone.NoteRecordingPorts.notifications);}
  public android.content.ComponentName startForegroundService(Intent intent){ai.alphacompute.alphaphone.NoteRecordingPorts.commands.add(intent);return null;}
  public android.content.ComponentName startService(Intent intent){if(ai.alphacompute.alphaphone.NoteRecordingPorts.failServiceLaunch)throw new IllegalStateException("background restricted");ai.alphacompute.alphaphone.NoteRecordingPorts.commands.add(intent);return null;}
  public boolean stopService(Intent intent){ai.alphacompute.alphaphone.NoteRecordingPorts.stopServiceCalls++;return true;}
}`,
    'android/content/ComponentName.java':'package android.content; public class ComponentName {}',
    'android/content/Intent.java':`package android.content;
public class Intent {
  public static final int FLAG_ACTIVITY_SINGLE_TOP=1,FLAG_ACTIVITY_CLEAR_TOP=2;
  private String action;
  private final java.util.Map<String,String> extras=new java.util.HashMap<>();
  public Intent(Context context,Class<?> type){}
  public Intent setAction(String value){action=value;return this;}
  public String getAction(){return action;}
  public Intent putExtra(String key,String value){extras.put(key,value);return this;}
  public String getStringExtra(String key){return extras.get(key);}
  public Intent setFlags(int value){return this;}
}`,
    'android/os/SystemClock.java':`package android.os;
public class SystemClock {public static long elapsedRealtime(){return ai.alphacompute.alphaphone.NoteRecordingPorts.now;}}`,
    'android/os/Looper.java':'package android.os; public class Looper {public static Looper getMainLooper(){return new Looper();}}',
    'android/os/Handler.java':`package android.os;
public class Handler {
  public Handler(Looper looper){}
  public boolean post(Runnable task){ai.alphacompute.alphaphone.NoteRecordingPorts.post(task);return true;}
  public boolean postDelayed(Runnable task,long delay){ai.alphacompute.alphaphone.NoteRecordingPorts.timers.put(task,ai.alphacompute.alphaphone.NoteRecordingPorts.now+delay);return true;}
  public void removeCallbacks(Runnable task){ai.alphacompute.alphaphone.NoteRecordingPorts.timers.remove(task);}
}`,
    'android/os/Build.java':`package android.os;
public class Build {public static class VERSION {public static int SDK_INT=36;}public static class VERSION_CODES {public static final int R=30,S=31;}}`,
    'android/os/IBinder.java':'package android.os; public interface IBinder {}',
    'android/util/AtomicFile.java':`package android.util;
import java.io.*;
import java.nio.file.*;
public class AtomicFile {
  private final File file;
  public AtomicFile(File file){this.file=file;}
  public FileInputStream openRead()throws IOException{return new FileInputStream(file);}
  public FileOutputStream startWrite()throws IOException{
    if(ai.alphacompute.alphaphone.NoteRecordingPorts.failJournal){ai.alphacompute.alphaphone.NoteRecordingPorts.failJournal=false;throw new IOException("journal fixture");}
    return new FileOutputStream(new File(file.getPath()+".new"));
  }
  public void finishWrite(FileOutputStream stream)throws IOException{
    stream.getFD().sync();stream.close();
    Files.move(new File(file.getPath()+".new").toPath(),file.toPath(),StandardCopyOption.REPLACE_EXISTING);
    ai.alphacompute.alphaphone.NoteRecordingPorts.journalWrites++;
  }
  public void failWrite(FileOutputStream stream){try{stream.close();}catch(IOException ignored){}new File(file.getPath()+".new").delete();}
}`,
    'android/media/MediaRecorder.java':`package android.media;
import java.io.*;
public class MediaRecorder {
  public static final class AudioSource {public static final int MIC=1;}
  public static final class OutputFormat {public static final int MPEG_4=1;}
  public static final class AudioEncoder {public static final int AAC=1;}
  public static final int MEDIA_RECORDER_INFO_MAX_FILESIZE_APPROACHING=802,MEDIA_RECORDER_INFO_NEXT_OUTPUT_FILE_STARTED=803,MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED=801,MEDIA_RECORDER_INFO_MAX_DURATION_REACHED=800;
  public interface OnInfoListener {void onInfo(MediaRecorder source,int what,int extra);}
  public interface OnErrorListener {void onError(MediaRecorder source,int what,int extra);}
  public final int sequence;
  public boolean released,paused;
  public int maxDuration;
  private File output,next;
  private OnInfoListener info;
  private OnErrorListener error;
  public MediaRecorder(){if(ai.alphacompute.alphaphone.NoteRecordingPorts.failConstructor){ai.alphacompute.alphaphone.NoteRecordingPorts.failConstructor=false;throw new IllegalStateException("constructor fixture");}sequence=ai.alphacompute.alphaphone.NoteRecordingPorts.recorders.size()+1;ai.alphacompute.alphaphone.NoteRecordingPorts.recorders.add(this);}
  public MediaRecorder(android.content.Context context){this();}
  public void setAudioSource(int value){}
  public void setOutputFormat(int value){}
  public void setAudioEncoder(int value){}
  public void setAudioChannels(int value){}
  public void setAudioSamplingRate(int value){}
  public void setAudioEncodingBitRate(int value){}
  public void setMaxFileSize(long value){}
  public void setOutputFile(File value){output=value;}
  public void setOutputFile(String value){output=new File(value);}
  public void setMaxDuration(int value){maxDuration=value;}
  public void setNextOutputFile(File value){next=value;}
  public void setOnInfoListener(OnInfoListener value){info=value;}
  public void setOnErrorListener(OnErrorListener value){error=value;}
  public void prepare()throws IOException{}
  private void bytes()throws IOException{try(FileOutputStream stream=new FileOutputStream(output)){stream.write(new byte[]{1,2,3,4});}}
  public void start()throws IOException{
    if(ai.alphacompute.alphaphone.NoteRecordingPorts.failOpen){ai.alphacompute.alphaphone.NoteRecordingPorts.failOpen=false;throw new IOException("open fixture");}
    bytes();
  }
  public void pause(){paused=true;}
  public void resume(){paused=false;}
  public void stop(){if(ai.alphacompute.alphaphone.NoteRecordingPorts.failStop){ai.alphacompute.alphaphone.NoteRecordingPorts.failStop=false;throw new IllegalStateException("short fixture");}}
  public void release(){
    if(ai.alphacompute.alphaphone.NoteRecordingPorts.failRelease){
      ai.alphacompute.alphaphone.NoteRecordingPorts.failRelease=false;
      throw new IllegalStateException("release fixture");
    }
    released=true;
  }
  public int getMaxAmplitude(){return 8192;}
  public void emit(int what)throws IOException{
    if(what==MEDIA_RECORDER_INFO_NEXT_OUTPUT_FILE_STARTED){if(next==null)throw new IOException("no next output");output=next;next=null;bytes();}
    info.onInfo(this,what,0);
  }
  public void fail(){error.onError(this,1,0);}
}`,
    'android/media/MediaFormat.java':`package android.media;
public class MediaFormat {
  public static final String KEY_MIME="mime",KEY_SAMPLE_RATE="sample-rate";
  public String getString(String key){return "audio/mp4a-latm";}
  public boolean containsKey(String key){return true;}
  public int getInteger(String key){return 16000;}
}`,
    'android/media/MediaCodec.java':`package android.media;
public class MediaCodec {
  public static final int BUFFER_FLAG_KEY_FRAME=1;
  public static class BufferInfo {public int size;public void set(int offset,int size,long time,int flags){this.size=size;}}
}`,
    'android/media/MediaExtractor.java':`package android.media;
public class MediaExtractor {
  public static final int SAMPLE_FLAG_SYNC=1;
  private boolean consumed;
  public void setDataSource(String path)throws java.io.IOException{if(!new java.io.File(path).isFile())throw new java.io.IOException("missing segment");}
  public int getTrackCount(){return 1;}
  public MediaFormat getTrackFormat(int track){return new MediaFormat();}
  public void selectTrack(int track){}
  public int readSampleData(java.nio.ByteBuffer buffer,int offset){if(consumed)return -1;buffer.put(new byte[]{1,2,3,4});return 4;}
  public long getSampleTime(){return 0;}
  public int getSampleFlags(){return SAMPLE_FLAG_SYNC;}
  public boolean advance(){consumed=true;return false;}
  public void release(){}
}`,
    'android/media/MediaMuxer.java':`package android.media;
public class MediaMuxer {
  public static final class OutputFormat {public static final int MUXER_OUTPUT_MPEG_4=1;}
  private final java.io.FileOutputStream stream;
  public MediaMuxer(String path,int format)throws java.io.IOException{stream=new java.io.FileOutputStream(path);}
  public int addTrack(MediaFormat format){return 0;}
  public void start(){}
  public void writeSampleData(int track,java.nio.ByteBuffer buffer,MediaCodec.BufferInfo info){
    if(ai.alphacompute.alphaphone.NoteRecordingPorts.failJoin)throw new IllegalStateException("mux fixture");
    byte[] bytes=new byte[info.size];buffer.rewind();buffer.get(bytes);try{stream.write(bytes);}catch(java.io.IOException error){throw new IllegalStateException(error);}
  }
  public void stop(){}
  public void release(){try{stream.close();}catch(java.io.IOException ignored){}}
}`,
    'android/app/Service.java':`package android.app;
public class Service extends android.content.Context {
  public static final int START_NOT_STICKY=2,STOP_FOREGROUND_REMOVE=1;
  public boolean shown,stopped;
  public Notification notification;
  public android.os.IBinder onBind(android.content.Intent intent){return null;}
  public int onStartCommand(android.content.Intent intent,int flags,int startId){return START_NOT_STICKY;}
  public void onDestroy(){}
  public void startForeground(int id,Notification value){if(ai.alphacompute.alphaphone.NoteRecordingPorts.failForeground)throw new IllegalStateException("foreground fixture");shown=true;notification=value;ai.alphacompute.alphaphone.NoteRecordingPorts.notifications.last=value;}
  public void startForeground(int id,Notification value,int type){startForeground(id,value);}
  public void stopForeground(int flags){shown=false;}
  public void stopSelf(int id){stopped=true;}
  public boolean stopSelfResult(int id){if(id!=ai.alphacompute.alphaphone.NoteRecordingPorts.latestDeliveredStartId||ai.alphacompute.alphaphone.NoteRecordingPorts.newerStartPending)return false;stopped=true;return true;}
}`,
    'android/content/pm/ServiceInfo.java':'package android.content.pm;public class ServiceInfo {public static final int FOREGROUND_SERVICE_TYPE_MICROPHONE=128;}',
    'android/app/Notification.java':`package android.app;
public class Notification {
  public static final String CATEGORY_SERVICE="service";
  public String title,toggle;
  public long when;
  public boolean chronometer;
  public static final class Action {
    String title;
    public static final class Builder {
      final Action action=new Action();
      public Builder(Object icon,String title,PendingIntent intent){action.title=title;}
      public Action build(){return action;}
    }
  }
  public static final class Builder {
    final Notification value=new Notification();
    public Builder(android.content.Context context,String channel){}
    public Builder setSmallIcon(int icon){return this;}
    public Builder setContentTitle(String title){value.title=title;return this;}
    public Builder setContentIntent(PendingIntent intent){return this;}
    public Builder setOngoing(boolean enabled){return this;}
    public Builder setOnlyAlertOnce(boolean enabled){return this;}
    public Builder setCategory(String category){return this;}
    public Builder addAction(Action action){value.toggle=action.title;return this;}
    public Builder setShowWhen(boolean enabled){return this;}
    public Builder setUsesChronometer(boolean enabled){value.chronometer=enabled;return this;}
    public Builder setWhen(long when){value.when=when;return this;}
    public Notification build(){return value;}
  }
}`,
    'android/app/NotificationChannel.java':`package android.app;
public class NotificationChannel {public final String id;public NotificationChannel(String id,String title,int importance){this.id=id;}public void setShowBadge(boolean enabled){}}`,
    'android/app/NotificationManager.java':`package android.app;
public class NotificationManager {
  public static final int IMPORTANCE_LOW=2;
  private final java.util.Map<String,NotificationChannel> channels=new java.util.HashMap<>();
  public Notification last;
  public NotificationChannel getNotificationChannel(String id){return channels.get(id);}
  public void createNotificationChannel(NotificationChannel value){channels.put(value.id,value);}
  public void notify(int id,Notification value){last=value;}
}`,
    'android/app/PendingIntent.java':`package android.app;
public class PendingIntent {
  public static final int FLAG_IMMUTABLE=1,FLAG_UPDATE_CURRENT=2;
  public static PendingIntent getActivity(android.content.Context context,int request,android.content.Intent intent,int flags){return new PendingIntent();}
  public static PendingIntent getService(android.content.Context context,int request,android.content.Intent intent,int flags){return new PendingIntent();}
}`,
    'android/R.java':'package android;public class R {public static class drawable {public static final int ic_btn_speak_now=1;}}',
    'ai/alphacompute/alphaphone/MainActivity.java':'package ai.alphacompute.alphaphone;public class MainActivity {}',
  };
  for(const [name,body] of Object.entries(files)){const file=join(directory,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,body);}
  return {directory,sources:files,paths:Object.keys(files).map(name=>join(directory,name)),close:()=>rmSync(directory,{recursive:true,force:true})};
}
