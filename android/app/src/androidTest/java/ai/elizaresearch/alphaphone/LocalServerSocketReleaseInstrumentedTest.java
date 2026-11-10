package ai.elizaresearch.alphaphone;

import android.net.LocalServerSocket;
import android.system.Os;
import android.system.OsConstants;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.IOException;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** close() alone leaves accept() blocked and the address bound; shutdown() first frees it for a same-process restart. */
@RunWith(AndroidJUnit4.class)
public class LocalServerSocketReleaseInstrumentedTest {
 private static Thread accepting(LocalServerSocket server){
  Thread thread=new Thread(()->{try{server.accept();}catch(IOException closed){/* Expected on release. */}});
  thread.setDaemon(true);thread.start();return thread;
 }
 private static boolean rebinds(String name){
  try{new LocalServerSocket(name).close();return true;}catch(IOException inUse){return false;}
 }
 @Test public void shutdownBeforeCloseFreesTheAddress()throws Exception{
  String name="alpha.socket.release.shutdown."+System.nanoTime();
  LocalServerSocket server=new LocalServerSocket(name);Thread thread=accepting(server);Thread.sleep(200);
  Os.shutdown(server.getFileDescriptor(),OsConstants.SHUT_RDWR);server.close();thread.join(2000);
  assertFalse("accept() must wake",thread.isAlive());
  assertTrue("the address must be free",rebinds(name));
 }
}
