package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.content.ContextWrapper;
import androidx.test.platform.app.InstrumentationRegistry;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import org.junit.Test;
import static org.junit.Assert.*;

/** Real Android Keystore/slot format; isolated files, no account, network or activity changes. */
public final class CloudDeploymentStorageInstrumentedTest {
 @Test public void freshStoreAndResetReadUseOnlyCurrentDeployment()throws Exception {
  Context target=InstrumentationRegistry.getInstrumentation().getTargetContext();
  File directory=new File(target.getCacheDir(),"deployment-storage-test-"+UUID.randomUUID());
  assertTrue(directory.mkdirs());
  Context isolated=new ContextWrapper(target){
   @Override public Context getApplicationContext(){return this;}
   @Override public File getNoBackupFilesDir(){return directory;}
  };
  JsonCredentialSlots raw=new JsonCredentialSlots(new File(directory,"connection-credentials"),"alpha.connection.aes.v1",name->256*1024);
  String credential="cloud:production",pending="cloud-signin:v1:pending";
  String foreign="cloud-deployment:other:"+credential;
  try {
   raw.write(credential,"{\"token\":\"synthetic-legacy\"}");
   raw.write(foreign,"{\"token\":\"synthetic-other\"}");
   AlphaCredentialStore store=new AlphaCredentialStore(isolated);
   assertNull(store.readCredentialSlot(credential));
   assertNull(AlphaCredentialStore.readSlotBeforeAttach(isolated,credential));
   String current="{\"token\":\"synthetic-current\"}";
   raw.write(CloudDeployment.storageSlot(credential),current);
   String attempt="{\"state\":\"synthetic-pending\"}";
   store.writeCredentialSlot(pending,attempt);
   AlphaCredentialStore reopened=new AlphaCredentialStore(isolated);
   assertEquals(current,reopened.readCredentialSlot(credential));
   assertEquals(current,AlphaCredentialStore.readSlotBeforeAttach(isolated,credential));
   assertEquals(attempt,reopened.readCredentialSlot(pending));
   byte[] ciphertext=Files.readAllBytes(raw.slotFile(raw.slotHash(CloudDeployment.storageSlot(pending))).getBaseFile().toPath());
   assertFalse(new String(ciphertext,StandardCharsets.ISO_8859_1).contains("synthetic-pending"));
   assertFalse(reopened.compareExchangeCredentialSlot(pending,"stale",null));
   assertTrue(reopened.compareExchangeCredentialSlot(pending,attempt,null));
   assertNull(new AlphaCredentialStore(isolated).readCredentialSlot(pending));
   assertEquals("{\"token\":\"synthetic-legacy\"}",raw.read(credential));
   assertEquals("{\"token\":\"synthetic-other\"}",raw.read(foreign));
  } finally {remove(directory);}
 }
 private static void remove(File file)throws Exception {
  File[] children=file.listFiles();if(children!=null)for(File child:children)remove(child);
  if(file.exists()&&!file.delete())throw new java.io.IOException("Synthetic storage cleanup failed");
 }
}
