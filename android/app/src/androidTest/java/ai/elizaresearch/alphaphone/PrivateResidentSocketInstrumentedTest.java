package ai.elizaresearch.alphaphone;

import android.content.*;
import android.net.*;
import android.os.*;
import android.os.Process;
import android.system.*;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.file.Files;
import java.util.concurrent.*;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

/** Actual ordinary cross-UID denial at the production filesystem endpoint. No real runtime/provider. */
public final class PrivateResidentSocketInstrumentedTest {
 private static void mode(String path,int bits,boolean socket)throws Exception{
  StructStat st=Os.lstat(path);assertEquals(Process.myUid(),st.st_uid);assertEquals(bits,st.st_mode&0777);
  assertTrue(socket?OsConstants.S_ISSOCK(st.st_mode):OsConstants.S_ISDIR(st.st_mode));
 }
 static boolean denied(int socketErrno,int rootErrno){
  return socketErrno==OsConstants.EACCES||socketErrno==OsConstants.EPERM
   ||(socketErrno==OsConstants.ENOENT&&rootErrno==OsConstants.ENOENT);
 }
 private static void positive(LocalServerSocket server,String path)throws Exception{
  try(LocalSocket client=new LocalSocket()){
   // API 35 connect(address, timeout) is unsupported. SO_TIMEOUT sets send and receive deadlines.
   client.getInputStream(); // Supported API initializes the lazily created descriptor; no read occurs.
   client.setSoTimeout(2000);
   client.connect(new LocalSocketAddress(path,LocalSocketAddress.Namespace.FILESYSTEM));
   try(LocalSocket accepted=server.accept()){
    assertEquals(Process.myUid(),accepted.getPeerCredentials().getUid());
    assertEquals(Process.myUid(),client.getPeerCredentials().getUid());
    client.getOutputStream().write(73);client.getOutputStream().flush();accepted.setSoTimeout(2000);
    assertEquals("Live same-UID control byte",73,accepted.getInputStream().read());
   }
  }
 }
 @Test public void ordinaryOtherUidCannotReachPrivateEndpoint()throws Exception{
  org.junit.Assume.assumeTrue("Dedicated owned-user supervisor only",InstrumentationRegistry.getArguments().getString("privatePeerFixture")!=null);
  assertEquals("Explicit supervisor required","1",InstrumentationRegistry.getArguments().getString("privatePeerFixture"));
  assertTrue("Peer fixture visibility requires a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);assertTrue(Process.myUid()/100000>0);
  String runId=InstrumentationRegistry.getArguments().getString("privatePeerRunId","");assertTrue(runId.matches("[0-9a-f-]{36}"));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  JSONObject boot=ElizaAgentService.getLocalAgentBootState(context);assertFalse(boot.getBoolean("serviceActive"));assertFalse(boot.getBoolean("socketListening"));
  File home=context.getFilesDir().getCanonicalFile();File directory=new File(home,"ipc");
  assertEquals(directory.getPath(),directory.getCanonicalPath());mode(directory.getPath(),0700,false);
  String path=new File(directory,"a.sock").getPath();
  java.lang.reflect.Method endpoint=ElizaAgentService.class.getDeclaredMethod("localSocketPath");endpoint.setAccessible(true);assertEquals(path,endpoint.invoke(null));
  try{Os.lstat(path);fail("Preserve existing endpoint");}catch(ErrnoException missing){assertEquals(OsConstants.ENOENT,missing.errno);}
  LocalSocket bound=new LocalSocket();LocalServerSocket server=null;long inode=-1;
  CountDownLatch ready=new CountDownLatch(1);IBinder[] peer=new IBinder[1];boolean binding=false;
  ServiceConnection connection=new ServiceConnection(){public void onServiceConnected(ComponentName name,IBinder binder){peer[0]=binder;ready.countDown();}public void onServiceDisconnected(ComponentName name){peer[0]=null;}};
  Throwable primary=null;
  int peerErrno=0,peerConnected=-1,peerRootErrno=0;
  try{
   bound.bind(new LocalSocketAddress(path,LocalSocketAddress.Namespace.FILESYSTEM));Os.chmod(path,0600);mode(path,0600,true);inode=Os.lstat(path).st_ino;
   server=new LocalServerSocket(bound.getFileDescriptor());positive(server,path);
   Intent intent=new Intent().setClassName("ai.elizaresearch.alphaphone.peerfixture","ai.elizaresearch.alphaphone.peerfixture.PrivateSocketProbeService").putExtra("privatePeerFixture",true).putExtra("runId",runId);
   binding=context.bindService(intent,connection,Context.BIND_AUTO_CREATE);assertTrue(binding);assertTrue(ready.await(10,TimeUnit.SECONDS));assertNotNull(peer[0]);
   Parcel in=Parcel.obtain(),out=Parcel.obtain();
   try{
    in.writeString(runId);assertTrue(peer[0].transact(IBinder.FIRST_CALL_TRANSACTION,in,out,0));
    int uid=out.readInt();assertNotEquals(Process.myUid(),uid);assertEquals(Process.myUid()/100000,uid/100000);
    assertEquals(context.getPackageManager().getPackageUid("ai.elizaresearch.alphaphone.peerfixture",0),uid);
    assertEquals(runId,out.readString());assertEquals(path,out.readString());peerErrno=out.readInt();peerConnected=out.readInt();
    assertEquals(context.getApplicationInfo().dataDir,out.readString());peerRootErrno=out.readInt();
    assertEquals(context.getPackageManager().getApplicationInfo("ai.elizaresearch.alphaphone.peerfixture",0).dataDir,out.readString());
    assertEquals("Peer can stat its own app data root",uid,out.readInt());
    assertTrue("Peer own app data root is a directory",OsConstants.S_ISDIR(out.readInt()));
   }finally{in.recycle();out.recycle();}
   StructPollfd poll=new StructPollfd();poll.fd=server.getFileDescriptor();poll.events=(short)OsConstants.POLLIN;
   assertEquals("No hostile connection queued after synchronous probe returned",0,Os.poll(new StructPollfd[]{poll},100));
   mode(directory.getPath(),0700,false);mode(path,0600,true);assertEquals(inode,Os.lstat(path).st_ino);
   positive(server,path);
   // Classify only after the exact inode, modes, and live byte control survive the probe.
   // Android app-data isolation hides unrelated roots with ENOENT, unlike DAC rejection.
   assertEquals("Cross-UID socket connect must fail",0,peerConnected);
   assertTrue("Expected permission denial or hidden app-data root; socket="+peerErrno+", root="+peerRootErrno,
    denied(peerErrno,peerRootErrno));
  }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{
   java.util.List<Throwable> failures=new java.util.ArrayList<>();
   try{if(binding)context.unbindService(connection);}catch(Throwable error){failures.add(error);}
   try{if(server!=null)server.close();}catch(Throwable error){failures.add(error);}
   try{bound.close();}catch(Throwable error){failures.add(error);}
   try{if(inode!=-1){mode(path,0600,true);assertEquals("Only owned socket removed",inode,Os.lstat(path).st_ino);Files.delete(new File(path).toPath());}}catch(Throwable error){failures.add(error);}
   if(!failures.isEmpty()){
    if(primary!=null){for(Throwable error:failures)primary.addSuppressed(error);}
    else{AssertionError cleanup=new AssertionError("Owned fixture cleanup failed");for(Throwable error:failures)cleanup.addSuppressed(error);throw cleanup;}
   }
  }
 }
}
