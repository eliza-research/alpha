package android.media;
import java.io.*;
/** Host stub: writes a few bytes to its current output file so finished segments exist on disk. */
public class MediaRecorder {
 public static MediaRecorder last;
 public static final class AudioSource { public static final int MIC=1; }
 public static final class OutputFormat { public static final int MPEG_4=2; }
 public static final class AudioEncoder { public static final int AAC=3; }
 public static final int MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED=801,MEDIA_RECORDER_INFO_MAX_FILESIZE_APPROACHING=802,MEDIA_RECORDER_INFO_NEXT_OUTPUT_FILE_STARTED=803;
 public interface OnInfoListener { void onInfo(MediaRecorder mr,int what,int extra); }
 public interface OnErrorListener { void onError(MediaRecorder mr,int what,int extra); }
 private File output,next;private OnInfoListener info;
 public MediaRecorder(){last=this;}
 public MediaRecorder(android.content.Context context){last=this;}
 public void setAudioSource(int s){} public void setOutputFormat(int f){} public void setAudioEncoder(int e){}
 public void setAudioChannels(int c){} public void setAudioSamplingRate(int r){} public void setAudioEncodingBitRate(int b){}
 public void setMaxFileSize(long b){}
 public void setOutputFile(File f){output=f;}
 public void setNextOutputFile(File f){next=f;}
 public void setOnInfoListener(OnInfoListener l){info=l;}
 public void setOnErrorListener(OnErrorListener l){}
 public void prepare()throws IOException{}
 public void start(){write(output);}
 public void stop(){write(output);}
 public void pause(){} public void resume(){} public void release(){}
 public int getMaxAmplitude(){return 0;}
 /** The size bound: the next file is accepted and the previous one is complete. */
 public void rollToNext(){info.onInfo(this,MEDIA_RECORDER_INFO_MAX_FILESIZE_APPROACHING,0);output=next;write(output);info.onInfo(this,MEDIA_RECORDER_INFO_NEXT_OUTPUT_FILE_STARTED,0);}
 private static void write(File f){if(f==null)return;try(FileOutputStream out=new FileOutputStream(f,true)){out.write(new byte[]{1,2,3});}catch(IOException e){throw new RuntimeException(e);}}
}
