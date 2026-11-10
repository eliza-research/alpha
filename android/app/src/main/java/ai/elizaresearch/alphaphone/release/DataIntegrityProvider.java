package ai.elizaresearch.alphaphone.release;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Release-build data integrity export for pilot updates (scripts/pilot-update.mjs). A release build
 * is not debuggable, so run-as cannot read its data; this provider lists every app-data file as
 * (domain, HMAC-SHA-256 of its relative path, HMAC-SHA-256 of its bytes), keyed by a nonce the caller
 * supplies, so a before/after comparison under one nonce shows any lost, changed or new file.
 * It returns no file name or content, writes nothing, and runs in its own process so reading never
 * starts the main process (which schedules work and opens stores). Access needs
 * android.permission.DUMP, a platform signature permission that adb's shell holds and ordinary apps
 * do not; this is not a debug or test-mocks surface.
 */
public final class DataIntegrityProvider extends ContentProvider {
 public static final String PATH = "domains";
 public static final String END = "#end";
 static final String[] COLUMNS = {"domain", "key", "digest"};
 private static final Pattern NONCE = Pattern.compile("[0-9a-f]{32,128}");
 // Android may clear these at any time; they are not app data.
 private static final List<String> SKIPPED = List.of("cache", "code_cache");

 @Override public boolean onCreate(){return true;}

 @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder){
  if(!PATH.equals(uri.getLastPathSegment()))throw new IllegalArgumentException("Unknown integrity export path");
  String nonce=uri.getQueryParameter("nonce");
  if(nonce==null||!NONCE.matcher(nonce).matches())throw new IllegalArgumentException("A hex nonce of 32 to 128 characters is required");
  try{return export(getContext().getDataDir(),nonce.getBytes(StandardCharsets.US_ASCII));}
  catch(IOException|GeneralSecurityException failure){throw new IllegalStateException("Integrity export failed: "+failure.getClass().getSimpleName());}
 }

 /** Every regular file under {@code root} except caches, then one end row carrying the file count. */
 static MatrixCursor export(File root, byte[] nonce)throws IOException, GeneralSecurityException {
  List<String> files=new ArrayList<>();
  collect(root, "", files);
  Collections.sort(files);
  MatrixCursor cursor=new MatrixCursor(COLUMNS, files.size()+1);
  for(String relative:files){
   int slash=relative.indexOf('/');
   String domain=slash<0?".":relative.substring(0, slash);
   cursor.addRow(new Object[]{domain, hmac(nonce, ("path:"+relative).getBytes(StandardCharsets.UTF_8)), digest(nonce, new File(root, relative))});
  }
  cursor.addRow(new Object[]{END, Integer.toString(files.size()), hmac(nonce, ("count:"+files.size()).getBytes(StandardCharsets.UTF_8))});
  return cursor;
 }

 private static void collect(File directory, String prefix, List<String> out)throws IOException {
  File[] children=directory.listFiles();
  if(children==null)throw new IOException("Unreadable directory");
  for(File child:children){
   String relative=prefix+child.getName();
   if(prefix.isEmpty()&&SKIPPED.contains(child.getName()))continue;
   // Links are never followed: the export covers this app's own storage only.
   if(Files.isSymbolicLink(child.toPath()))continue;
   if(Files.isDirectory(child.toPath(), LinkOption.NOFOLLOW_LINKS))collect(child, relative+"/", out);
   else if(Files.isRegularFile(child.toPath(), LinkOption.NOFOLLOW_LINKS))out.add(relative);
  }
 }

 private static Mac mac(byte[] nonce)throws GeneralSecurityException {Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(nonce, "HmacSHA256"));return mac;}
 private static String hmac(byte[] nonce, byte[] value)throws GeneralSecurityException {return hex(mac(nonce).doFinal(value));}
 private static String digest(byte[] nonce, File file)throws IOException, GeneralSecurityException {
  Mac mac=mac(nonce);byte[] buffer=new byte[64*1024];
  try(InputStream in=new FileInputStream(file)){for(int read;(read=in.read(buffer))>0;)mac.update(buffer, 0, read);}
  return hex(mac.doFinal());
 }
 private static String hex(byte[] bytes){StringBuilder out=new StringBuilder(bytes.length*2);for(byte b:bytes)out.append(Character.forDigit((b>>4)&15, 16)).append(Character.forDigit(b&15, 16));return out.toString();}

 @Override public String getType(Uri uri){return null;}
 @Override public Uri insert(Uri uri, ContentValues values){throw new UnsupportedOperationException("Read-only integrity export");}
 @Override public int delete(Uri uri, String selection, String[] selectionArgs){throw new UnsupportedOperationException("Read-only integrity export");}
 @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs){throw new UnsupportedOperationException("Read-only integrity export");}
}
