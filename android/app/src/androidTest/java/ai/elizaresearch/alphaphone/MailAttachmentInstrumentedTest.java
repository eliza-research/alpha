package ai.elizaresearch.alphaphone;
import android.content.Context;
import android.net.Uri;
import androidx.core.content.FileProvider;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import org.junit.Test;
import static org.junit.Assert.*;
/** Opt-in actual installed provider boundary. Does not claim external viewer rendering. */
public final class MailAttachmentInstrumentedTest {
 @Test public void boundedAttachmentBytesUseOnlyPrivateContentUri()throws Exception{
  org.junit.Assume.assumeTrue("Explicit attachment campaign","1".equals(InstrumentationRegistry.getArguments().getString("mailAttachmentNative")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  File folder=new File(context.getCacheDir(),"mail-attachments");assertTrue(folder.isDirectory()||folder.mkdirs());File file=new File(folder,"fixture-"+UUID.randomUUID()+".pdf");File outside=new File(context.getCacheDir(),"unshared-"+UUID.randomUUID()+".txt");
  byte[] bytes=new byte[5*1024*1024];System.arraycopy("%PDF-1.7\n".getBytes(StandardCharsets.US_ASCII),0,bytes,0,9);
  try{
   AlphaMailAttachmentsPlugin.validate(file.getName(),"application/pdf",bytes);Files.write(file.toPath(),bytes);Uri uri=FileProvider.getUriForFile(context,context.getPackageName()+".mailattachments",file);assertEquals("content",uri.getScheme());assertEquals("application/pdf",context.getContentResolver().getType(uri));try(InputStream in=context.getContentResolver().openInputStream(uri)){assertNotNull(in);assertArrayEquals(bytes,in.readAllBytes());}
   try{context.getContentResolver().openFileDescriptor(uri,"rw");fail("Write accepted");}catch(FileNotFoundException expected){}
   assertTrue(file.setLastModified(System.currentTimeMillis()-16*60*1000));try{context.getContentResolver().openInputStream(uri);fail("Expired file accepted");}catch(FileNotFoundException expected){}assertFalse(file.exists());
   Files.write(outside.toPath(),"private".getBytes(StandardCharsets.UTF_8));try{FileProvider.getUriForFile(context,context.getPackageName()+".mailattachments",outside);fail("Unshared path accepted");}catch(IllegalArgumentException expected){}
   try{AlphaMailAttachmentsPlugin.validate("wrong.pdf","application/pdf","not PDF".getBytes());fail("Wrong signature accepted");}catch(IllegalArgumentException expected){}
   try{AlphaMailAttachmentsPlugin.validate("large.pdf","application/pdf",new byte[5*1024*1024+1]);fail("Oversize accepted");}catch(IllegalArgumentException expected){}
   try{AlphaMailAttachmentsPlugin.validate("../escape.pdf","application/pdf",bytes);fail("Traversal accepted");}catch(IllegalArgumentException expected){}
  }finally{assertTrue(!file.exists()||file.delete());assertTrue(!outside.exists()||outside.delete());}
 }
}
