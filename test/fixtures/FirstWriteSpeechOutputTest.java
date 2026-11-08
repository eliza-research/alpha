package ai.eliza.voice;

/** Host-JVM ordering check. No Android track or hardware audio is opened. */
public final class FirstWriteSpeechOutputTest {
 public static void main(String[] args) {
  StringBuilder calls=new StringBuilder();
  StreamingSpeechPlayback.Output output=new StreamingSpeechPlayback.Output() {
   public void play(){calls.append("play,");}
   public int write(float[] samples,int offset,int length){calls.append("write,");return length;}
   public long playedFrames(){return 7;}
   public long presentationNs(long frame){return frame+1;}
   public void setVolume(float volume){calls.append("volume,");}
   public void abort(){calls.append("abort,");}
   public void stop(){calls.append("stop,");}
   public void release(){calls.append("release,");}
  };
  FirstWriteSpeechOutput first=new FirstWriteSpeechOutput(output,()->calls.append("first,"));
  first.play();first.write(new float[3],0,3);first.write(new float[2],0,2);
  if(!calls.toString().equals("play,first,write,write,"))throw new AssertionError(calls);
  if(first.playedFrames()!=7||first.presentationNs(4)!=5)throw new AssertionError("clock delegation");
  first.setVolume(0);first.abort();first.stop();first.release();
  if(!calls.toString().endsWith("volume,abort,stop,release,"))throw new AssertionError(calls);
  System.out.println("PASS first write marked once before the blocking output call");
 }
}
