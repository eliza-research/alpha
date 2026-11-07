import ai.eliza.voice.CartesiaSpeech;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
public final class OwnSpeechTest {
 static void check(boolean value){if(!value)throw new AssertionError();}
 static final class Connection extends HttpURLConnection {
  final byte[] response;final ByteArrayOutputStream sent=new ByteArrayOutputStream();boolean closed;Runnable beforeRead=()->{};
  Connection(URL url,int status,byte[] response){super(url);responseCode=status;this.response=response;}
  String url(){return getURL().toString();}
  public void connect(){}public boolean usingProxy(){return false;}public void disconnect(){closed=true;}
  public OutputStream getOutputStream(){return sent;}
  public InputStream getInputStream(){beforeRead.run();return new ByteArrayInputStream(response);}
  public int getResponseCode(){return responseCode;}
 }
 static final class Guard implements CartesiaSpeech.Guard {
  boolean cancelled;int checks;HttpURLConnection connection;
  public void check()throws Exception{checks++;if(cancelled)throw new IOException("cancelled");}
  public void opened(HttpURLConnection c){connection=c;}
 }
 static byte[] wav(){byte[] wav=new byte[44];System.arraycopy("RIFF".getBytes(),0,wav,0,4);System.arraycopy("WAVE".getBytes(),0,wav,8,4);return wav;}
 public static void main(String[] args)throws Exception {
  String key="synthetic-cartesia-key";Guard guard=new Guard();Connection[] held=new Connection[1];
  String text=CartesiaSpeech.transcribe(key,wav(),guard,url->{held[0]=new Connection(url,200,"{\"text\":\"hello\"}".getBytes());return held[0];});
  check(text.equals("hello"));check(held[0].url().equals("https://api.cartesia.ai/stt"));
  check(held[0].closed&&!held[0].getInstanceFollowRedirects()&&!held[0].getUseCaches());check(held[0].sent.toString().contains("name=\"file\""));check(held[0].sent.toString().contains("ink-whisper"));
  CartesiaSpeech.synthesize(key,"hello",new Guard(),url->{held[0]=new Connection(url,200,wav());return held[0];});
  check(held[0].url().equals("https://api.cartesia.ai/tts/bytes"));JSONObject body=new JSONObject(held[0].sent.toString());check(body.getString("transcript").equals("hello"));
  // Official versioned contract: https://docs.cartesia.ai/2026-03-01/api-reference/tts/bytes
  check("2026-03-01".equals(held[0].getRequestProperty("Cartesia-Version")));
  check("application/json".equals(held[0].getRequestProperty("Content-Type")));
  check(("Bearer "+key).equals(held[0].getRequestProperty("Authorization")));
  check(body.length()==4&&"sonic-3.5".equals(body.getString("model_id")));
  JSONObject voice=body.getJSONObject("voice");check(voice.length()==2&&"id".equals(voice.getString("mode"))&&CartesiaSpeech.VOICE.equals(voice.getString("id")));
  JSONObject format=body.getJSONObject("output_format");check(format.length()==3&&"wav".equals(format.getString("container"))&&"pcm_s16le".equals(format.getString("encoding"))&&format.getInt("sample_rate")==24000);check(!body.toString().contains(key));
  for(int status:new int[]{302,401,429,503}){try{CartesiaSpeech.synthesize(key,"hello",new Guard(),url->{held[0]=new Connection(url,status,key.getBytes());return held[0];});throw new AssertionError();}catch(CartesiaSpeech.HttpFailure expected){check(expected.status==status);check(!expected.toString().contains(key));check(held[0].closed);}}
  Guard before=new Guard();before.cancelled=true;try{CartesiaSpeech.transcribe(key,wav(),before,url->{throw new AssertionError("must not open after cancellation");});throw new AssertionError();}catch(IOException expected){}
  Guard switched=new Guard();try{CartesiaSpeech.synthesize(key,"hello",switched,url->{held[0]=new Connection(url,200,wav());held[0].beforeRead=()->switched.cancelled=true;return held[0];});throw new AssertionError();}catch(IOException expected){check(held[0].closed);}
  try{CartesiaSpeech.transcribe(key,wav(),new Guard(),url->new Connection(url,200,new byte[262145]));throw new AssertionError();}catch(IOException expected){}
  System.out.println("PASS own speech fixed endpoints, request bodies, errors, abort and switch retirement");
 }
}
