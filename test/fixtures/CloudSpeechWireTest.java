package ai.eliza.voice;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
public final class CloudSpeechWireTest {
 private static void check(boolean yes){if(!yes)throw new AssertionError();}
 private static void rejected(Runnable call){try{call.run();throw new AssertionError("invalid input accepted");}catch(IllegalArgumentException expected){}}
 public static void main(String[] args){
  byte[] name="owned-1".getBytes(StandardCharsets.US_ASCII),pcm={0,0,(byte)0xff,0x7f,0,(byte)0x80};byte[] frame=new byte[2+name.length+pcm.length];frame[0]=1;frame[1]=(byte)name.length;System.arraycopy(name,0,frame,2,name.length);System.arraycopy(pcm,0,frame,2+name.length,pcm.length);
  CloudSpeechWire.Audio audio=CloudSpeechWire.decode(frame);check(audio.id.equals("owned-1")&&Arrays.equals(audio.pcm,pcm));Arrays.fill(frame,(byte)0);check(Arrays.equals(audio.pcm,pcm));
  float[] samples=CloudSpeechWire.floats(audio.pcm);check(samples.length==3&&samples[0]==0&&samples[1]>0.999&&samples[2]==-1);
  check(CloudSpeechWire.peak(pcm,pcm.length)==1);
  for(byte[] bad:new byte[][]{new byte[0],new byte[]{1,0,0,0},new byte[]{1,1,'x',0},new byte[]{2,1,'x',0,0},new byte[]{1,1,'/',0,0},new byte[]{1,64,'x',0,0}})rejected(()->CloudSpeechWire.decode(bad));
  byte[] huge=new byte[CloudSpeechWire.MAX_DOWNLINK+5];huge[0]=1;huge[1]=1;huge[2]='x';rejected(()->CloudSpeechWire.decode(huge));
  String text="Every phrase preserves spaces and Unicode 東京. ".repeat(70);java.util.List<String> parts=CloudSpeechWire.phrases(text);check(String.join("",parts).equals(text));check(parts.stream().allMatch(part->part.length()<=1024));
  rejected(()->CloudSpeechWire.phrases("x".repeat(1025)));rejected(()->CloudSpeechWire.phrases("ok "+"x".repeat(1025)));rejected(()->CloudSpeechWire.phrases("x".repeat(4097)));
  System.out.println("PASS streaming speech PCM, ownership copies, frame bounds, phrase preservation");
 }
}
