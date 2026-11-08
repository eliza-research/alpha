package ai.elizaresearch.alphaphone;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigInteger;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.Random;
import java.util.concurrent.TimeUnit;

/**
 * Host-JVM check of the one-tap update download admission: AlphaDevicePlugin.copyVerified and hex, compiled
 * from the plugin source by test/app-update.test.mjs. Not Android, PackageInstaller or network evidence.
 */
public final class UpdateDownloadTest {
 private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 private static String sha256(byte[] bytes)throws Exception{return String.format("%064x",new BigInteger(1,MessageDigest.getInstance("SHA-256").digest(bytes)));}
 private static boolean admitted(InputStream in,byte[] expected,long size,String digest,long deadline){
  ByteArrayOutputStream out=new ByteArrayOutputStream();
  try{AlphaDevicePlugin.copyVerified(in,out,size,digest,deadline);check(Arrays.equals(out.toByteArray(),expected),"admitted bytes are copied unchanged");return true;}
  catch(IOException refused){return false;}
 }
 private static boolean admitted(InputStream in,byte[] expected,long size,String digest){return admitted(in,expected,size,digest,System.nanoTime()+TimeUnit.MINUTES.toNanos(1));}
 private static boolean admitted(byte[] body,long size,String digest){return admitted(new ByteArrayInputStream(body),body,size,digest);}
 /** A stream that never goes silent, one byte at a time, as a read timeout sees a trickle. */
 private static final class Trickle extends InputStream {
  private final byte[] body;private final long pauseMillis;int reads;
  Trickle(byte[] body,long pauseMillis){this.body=body;this.pauseMillis=pauseMillis;}
  @Override public int read(){
   if(reads==body.length)return -1;
   try{Thread.sleep(pauseMillis);}catch(InterruptedException unexpected){throw new AssertionError(unexpected);}
   return body[reads++]&255;
  }
  @Override public int read(byte[] buffer,int offset,int length){int value=read();if(value<0)return -1;buffer[offset]=(byte)value;return 1;}
 }
 public static void main(String[] args)throws Exception {
  byte[] apk=new byte[200_000];new Random(7).nextBytes(apk);String digest=sha256(apk);
  check(admitted(apk,apk.length,digest),"the declared size and digest are admitted");
  check(!admitted(apk,apk.length-1,digest),"a download longer than declared is refused");
  check(!admitted(apk,apk.length+1,digest),"a download shorter than declared is refused");
  byte[] changed=apk.clone();changed[1234]^=1;
  check(!admitted(changed,changed.length,digest),"changed bytes are refused");
  check(!admitted(apk,apk.length,digest.toUpperCase(Locale.ROOT)),"a digest is 64 lowercase hex characters");
  check(!admitted(apk,apk.length,digest.substring(1))&&!admitted(apk,apk.length,null),"a short or missing digest is refused");
  check(!admitted(new byte[0],0,sha256(new byte[0])),"an empty APK is refused");
  // Refused before any byte is read: an undeclared or oversized APK is never downloaded.
  InputStream unread=new InputStream(){@Override public int read(){throw new AssertionError("read before admission");}};
  check(!admitted(unread,new byte[0],AlphaDevicePlugin.UPDATE_MAX_BYTES+1,digest)&&!admitted(unread,new byte[0],-1,digest),"sizes outside 1..UPDATE_MAX_BYTES are refused");
  check(AlphaDevicePlugin.UPDATE_MAX_BYTES==1024L*1024*1024,"the bound is 1 GiB");
  check(AlphaDevicePlugin.UPDATE_DEADLINE_NANOS==TimeUnit.HOURS.toNanos(6),"the deadline is six hours");
  byte[] small=Arrays.copyOf(apk,400);
  Trickle late=new Trickle(small,20);
  check(!admitted(late,new byte[0],small.length,sha256(small),System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(100)),"a trickle past the deadline is refused");
  check(late.reads<small.length/2,"and reading stops there, not at the end of the download");
  check(admitted(new Trickle(small,1),small,small.length,sha256(small)),"a slow download inside the deadline is admitted");
  Thread.currentThread().interrupt();
  boolean refused=!admitted(apk,apk.length,digest);
  check(Thread.interrupted()&&refused,"a destroyed plugin's interrupted worker reads no further");
  check(admitted(apk,apk.length,digest),"and only that worker");
  check(AlphaDevicePlugin.hex(new byte[32]).equals("0".repeat(64))&&AlphaDevicePlugin.hex(MessageDigest.getInstance("SHA-256").digest(apk)).equals(digest),"hex keeps leading zeros and matches the digest");
  System.out.println("PASS update download");
 }
}
