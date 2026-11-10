package ai.elizaresearch.alphaphone;
import java.nio.charset.StandardCharsets;
import java.io.*;
import java.nio.file.Files;
import java.security.*;
import java.util.Arrays;
import org.json.*;
/** Native-only fixture data: fill the actual collection without laying out a giant editor value. */
final class NotesCapacityFixture {
 static final int RECORD_BYTES=512*1024,HEADROOM=2048,EDIT_BYTES=4096;
 static String collection(String original,String marker,int cap)throws Exception{
  JSONObject saved=new JSONObject(original),envelope=new JSONObject(saved.getString("currentRaw"));
  JSONArray records=envelope.getJSONArray("records");
  records.put(note(marker,"Capacity target "+marker,""));
  JSONObject last=null;
  // Reserve one bounded body for exact padding after JSON-envelope overhead is measured.
  for(int i=0;i<64;i++){last=note(marker+"_"+i,"Capacity fixture "+i,i<63?"F".repeat(RECORD_BYTES):"");records.put(last);}
  saved.put("currentRaw",envelope.toString());
  int padding=cap-HEADROOM-saved.toString().getBytes(StandardCharsets.UTF_8).length;
  if(padding<0||padding>RECORD_BYTES)throw new IllegalStateException("Disposable collection does not leave bounded fixture capacity");
  last.put("body","F".repeat(padding));saved.put("currentRaw",envelope.toString());
  String result=saved.toString();
  if(result.getBytes(StandardCharsets.UTF_8).length!=cap-HEADROOM)throw new IllegalStateException("Fixture byte count changed");
  return result;
 }
 /** Keep only a private file and small digest while the renderer owns the large collection. */
 static final class Snapshot implements AutoCloseable {
  private final File file;private final byte[] digest;private final long bytes;
  private Snapshot(File file,byte[] digest){this.file=file;this.digest=digest;this.bytes=file.length();}
  static Snapshot save(File directory,String value)throws Exception{
   File file=File.createTempFile("alpha-notes-capacity-",".json",directory);boolean saved=false;
   try{MessageDigest digest=MessageDigest.getInstance("SHA-256");
    try(Writer writer=new OutputStreamWriter(new DigestOutputStream(new FileOutputStream(file),digest),StandardCharsets.UTF_8)){writeBounded(writer,value);}
    Snapshot snapshot=new Snapshot(file,digest.digest());saved=true;return snapshot;
   }finally{if(!saved)Files.deleteIfExists(file.toPath());}
  }
  boolean matches(String value)throws Exception{
   if(value==null)return false;MessageDigest actual=MessageDigest.getInstance("SHA-256");
   final long[] count={0};OutputStream sink=new OutputStream(){public void write(int b){count[0]++;}public void write(byte[] b,int start,int length){count[0]+=length;}};
   try(Writer writer=new OutputStreamWriter(new DigestOutputStream(sink,actual),StandardCharsets.UTF_8)){writeBounded(writer,value);}
   return bytes==count[0]&&Arrays.equals(digest,actual.digest());
  }
  String exactValue()throws Exception{String value=new String(Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8);if(!matches(value))throw new IOException("Capacity snapshot changed");return value;}
  public void close()throws IOException{Files.deleteIfExists(file.toPath());}
 }
 private static void writeBounded(Writer writer,String value)throws IOException{
  char[] buffer=new char[4096];for(int start=0;start<value.length();){int length=Math.min(buffer.length,value.length()-start);value.getChars(start,start+length,buffer,0);writer.write(buffer,0,length);start+=length;}
 }
 private static JSONObject note(String id,String title,String body)throws Exception{
  return new JSONObject().put("id",id).put("kind","text").put("title",title).put("body",body).put("pinned",false).put("when","Saved on this device");
 }
}
