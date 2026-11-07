package ai.elizaresearch.alphaphone;
import java.io.File;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
public final class ProviderConditionalClearTest {
 static void check(boolean value,String reason){if(!value)throw new AssertionError(reason);}
 public static void main(String[] args)throws Exception{
  android.content.Context context=new android.content.Context(new File(args[0]));
  JsonCredentialSlots raw=new JsonCredentialSlots(new File(context.getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",name->262144);
  String slot=CloudDeployment.storageSlot("local-agent-provider:v1");
  String a="{\"provider\":\"elizacloud\",\"revision\":\"a\"}";
  String b="{\"provider\":\"elizacloud\",\"revision\":\"b\"}";
  AlphaCredentialStore store=new AlphaCredentialStore(context);
  int[] cloudChanges={0};AlphaCredentialStore.observeCloudChanges(()->cloudChanges[0]++);
  raw.write(slot,a);String guard=store.providerBindingGuard(a);
  long intent=AlphaLocalAgentPlugin.currentCredentialIntent();
  raw.write(slot,b);
  check(!store.removeProviderIfCurrent(guard),"new binding was cleared");
  check(b.equals(raw.read(slot))&&intent==AlphaLocalAgentPlugin.currentCredentialIntent(),"stale cleanup changed binding or intent");
  raw.write(slot,a);AlphaLocalAgentPlugin.reserveCredentialIntent();
  check(!store.removeProviderIfCurrent(guard),"same bytes after newer intent admitted");
  guard=store.providerBindingGuard(a);
  check(store.removeProviderIfCurrent(guard)&&raw.read(slot)==null,"matching binding did not clear");
  check(cloudChanges[0]==0,"provider-only cleanup withdrew unchanged Cloud services");
  check(!store.removeProviderIfCurrent(guard),"replayed cleanup admitted");
  raw.write(slot,a);guard=store.providerBindingGuard(a);
  AlphaLocalAgentPlugin.beforeCommit=()->{try{raw.write(slot,b);}catch(Exception e){throw new RuntimeException(e);}};
  try{check(!store.removeProviderIfCurrent(guard),"replacement during shutdown cleared");}
  finally{AlphaLocalAgentPlugin.beforeCommit=()->{};}
  check(b.equals(raw.read(slot)),"post-shutdown replacement lost");
  raw.write(slot,a);guard=store.providerBindingGuard(a);
  AlphaLocalAgentPlugin.beforeCommit=()->AlphaLocalAgentPlugin.reserveCredentialIntent();
  try{check(!store.removeProviderIfCurrent(guard),"new intent during shutdown ignored");}
  finally{AlphaLocalAgentPlugin.beforeCommit=()->{};}
  check(a.equals(raw.read(slot)),"superseded cleanup removed provider");
  System.out.println("PASS actual conditional provider cleanup: changed binding, same-byte newer intent, match, replay, post-shutdown change and superseded intent");
 }
}
