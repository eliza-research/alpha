package ai.elizaresearch.alphaphone;
import android.content.*;
import android.os.*;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.*;
import org.junit.Test;
import static org.junit.Assert.*;

/** Real private Binder/isolated-process tests. No mail, accounts or network. */
public final class IsolatedPdfInstrumentedTest {
 private static final class Connection implements ServiceConnection,AutoCloseable{
  final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  final CountDownLatch connected=new CountDownLatch(1),died=new CountDownLatch(1);final BlockingQueue<Bundle> results=new LinkedBlockingQueue<>();
  final Messenger replies=new Messenger(new Handler(Looper.getMainLooper(),message->{results.add(message.getData());return true;}));
  IBinder binder;Messenger remote;boolean bound;
  Connection()throws Exception{bound=context.bindService(new Intent(context,IsolatedPdfService.class),this,Context.BIND_AUTO_CREATE);assertTrue(bound);assertTrue("isolated bind",connected.await(10,TimeUnit.SECONDS));assertNotNull(remote);binder.linkToDeath(died::countDown,0);}
  public void onServiceConnected(ComponentName name,IBinder value){binder=value;remote=new Messenger(value);connected.countDown();}
  public void onServiceDisconnected(ComponentName name){died.countDown();}
  public void onNullBinding(ComponentName name){connected.countDown();}
  public void onBindingDied(ComponentName name){died.countDown();}
  void request(File file,int page,boolean block)throws Exception{try(ParcelFileDescriptor fd=ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY)){Bundle data=new Bundle();data.putParcelable("descriptor",fd);data.putInt("page",page);data.putString("request",UUID.randomUUID().toString());if(block)data.putString("fixture","watchdog");Message message=Message.obtain(null,1);message.replyTo=replies;message.setData(data);remote.send(message);}}
  Bundle result()throws Exception{Bundle value=results.poll(12,TimeUnit.SECONDS);assertNotNull("isolated result",value);return value;}
  public void close(){if(bound){bound=false;context.unbindService(this);}Bundle result;while((result=results.poll())!=null){SharedMemory memory=result.getParcelable("pixels");if(memory!=null)memory.close();}}
 }
 @Test public void isolatedPixelsErrorsCancellationAndWatchdog()throws Exception{
  org.junit.Assume.assumeTrue("Explicit isolated PDF campaign","1".equals(InstrumentationRegistry.getArguments().getString("isolatedPdfNative")));org.junit.Assume.assumeTrue("Watchdog fixture requires -PELIZA_DEV_ALLOW_TEST_MOCKS=1",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();File valid=new File(context.getCacheDir(),"pdf-fixture-"+UUID.randomUUID()+".pdf"),bad=new File(context.getCacheDir(),"pdf-corrupt-"+UUID.randomUUID()+".pdf");
  try{
   try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("inbox-fixtures/synthetic.pdf")){Files.write(valid.toPath(),input.readAllBytes());}Files.write(bad.toPath(),"%PDF-broken".getBytes());
   Connection first=new Connection();try{
    first.request(valid,0,false);Bundle result=first.result();assertFalse(result.containsKey("error"));assertTrue(result.getBoolean("isolated"));assertTrue(result.getBoolean("internetDenied"));assertNotEquals(android.os.Process.myUid(),result.getInt("uid"));assertEquals(1,result.getInt("pages"));int width=result.getInt("width"),height=result.getInt("height");assertTrue(width>0&&height>0&&(long)width*height<=1500000);
    SharedMemory pixels=result.getParcelable("pixels");assertNotNull(pixels);ByteBuffer mapped=null;try{assertEquals(width*height*4,pixels.getSize());mapped=pixels.mapReadOnly();boolean dark=false;while(mapped.hasRemaining())if((mapped.get()&255)<128){dark=true;break;}assertTrue("real PDF marks rendered",dark);try{ByteBuffer writable=pixels.mapReadWrite();SharedMemory.unmap(writable);fail("Output pixels are writable");}catch(android.system.ErrnoException expected){}}finally{if(mapped!=null)SharedMemory.unmap(mapped);pixels.close();}
    first.request(bad,0,false);assertTrue(first.result().containsKey("error"));
    for(String fixture:new String[]{"password.pdf.base64","too-many-pages.pdf.base64","oversize-page.pdf.base64"}){try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("inbox-fixtures/"+fixture)){Files.write(bad.toPath(),android.util.Base64.decode(input.readAllBytes(),android.util.Base64.DEFAULT));}first.request(bad,0,false);assertTrue(fixture,first.result().containsKey("error"));}
    first.request(valid,500,false);assertTrue(first.result().containsKey("error"));
   }finally{first.close();}assertTrue("unbind terminates isolated renderer",first.died.await(5,TimeUnit.SECONDS));
   Connection watchdog=new Connection();try{watchdog.request(valid,0,true);assertTrue("independent watchdog kills blocked worker",watchdog.died.await(13,TimeUnit.SECONDS));assertTrue(watchdog.results.isEmpty());}finally{watchdog.close();}
   try(Connection recovery=new Connection()){recovery.request(valid,0,false);Bundle result=recovery.result();assertFalse(result.containsKey("error"));SharedMemory pixels=result.getParcelable("pixels");assertNotNull(pixels);pixels.close();}
  }finally{assertTrue(!valid.exists()||valid.delete());assertTrue(!bad.exists()||bad.delete());}
 }
}
