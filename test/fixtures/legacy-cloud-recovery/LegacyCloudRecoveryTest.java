package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import java.io.File;
import org.json.JSONObject;
public final class LegacyCloudRecoveryTest {
 static int passed,sequence;static JsonCredentialSlots slots;static LegacyCloudRecovery recovery;static boolean owner;
 static final String NS=LegacyCloudRecovery.LEGACY_NAMESPACE;
 static final String ID="11111111-1111-4111-8111-111111111111";
 static final String SAVED=new JSONObject().put("credentialId",ID).put("token","synthetic-test-token").put("expiresAt",System.currentTimeMillis()+3600000).toString();
 static File root;
 static void fresh()throws Exception{owner=true;slots=new JsonCredentialSlots(new File(root,"case"+(sequence++)),"fixture",name->262144);recovery=new LegacyCloudRecovery(slots,NS,()->{if(!owner)throw new IllegalStateException();});slots.write("cloud:production",SAVED);}
 static void check(boolean value,String why){if(!value)throw new AssertionError(why);passed++;}
 interface IdentityCheck {void verify(String token)throws Exception;}
 static boolean restore(IdentityCheck verify)throws Exception{LegacyCloudRecovery.Snapshot held=recovery.snapshot();if(held==null)return false;verify.verify(held.token());return recovery.commit(held);}
 static void fails(IdentityCheck verify)throws Exception{try{restore(verify);throw new AssertionError("Expected refusal");}catch(IllegalStateException|IllegalArgumentException expected){passed++;}}
 public static void main(String[] args)throws Exception{
  root=new File(args[0]);fresh();check(recovery.eligible(),"legacy eligible without importing");check(slots.read(NS+"cloud:production")==null,"ordinary scoped read stays absent");
  check(restore(token->{check(token.equals("synthetic-test-token"),"actual current token validator");}),"explicit recovery");
  check(SAVED.equals(slots.read(NS+"cloud:production"))&&SAVED.equals(slots.read("cloud:production")),"exact bytes copied old kept");check(!recovery.eligible()&&!restore(token->{throw new AssertionError();}),"idempotent");check(slots.read(NS+"local-agent-provider:v1")==null,"no provider proof imported");
  for(String value:new String[]{"{}","\"invalid-but-established\"",SAVED}){fresh();slots.write(NS+"cloud:production",value);check(!recovery.eligible()&&!restore(token->{throw new AssertionError();}),"all current targets win");check(value.equals(slots.read(NS+"cloud:production")),"target unchanged");}
  fresh();slots.write(NS+"local-agent-provider:v1","{}");check(!recovery.eligible(),"current provider wins");
  for(String ns:new String[]{"cloud-deployment:other:","",NS+"other:"}){fresh();check(!new LegacyCloudRecovery(slots,ns,()->{}).eligible(),"authority mismatch");}
  fresh();recovery.block();check(!recovery.eligible(),"signout tombstone");slots.remove(NS+"cloud:production");check(!recovery.eligible(),"no key means no resurrection");
  fresh();fails(token->{throw new IllegalStateException("offline");});check(recovery.eligible()&&slots.read(NS+"cloud:production")==null,"transport failure recoverable");
  fresh();slots.write("cloud:production",new JSONObject(SAVED).put("expiresAt",1).toString());fails(token->{throw new AssertionError("expired key reached network");});
  fresh();check(!restore(token->recovery.block()),"signout during verification wins");
  fresh();check(!restore(token->slots.write(NS+"cloud:production","{}")),"new target during verification wins");
  fresh();check(!restore(token->slots.write(NS+"local-agent-provider:v1","{}")),"provider during verification wins");
  fresh();check(!restore(token->slots.write("cloud:production",new JSONObject(SAVED).put("token","different-synthetic-token").toString())),"legacy replacement during verification wins");
  fresh();fails(token->owner=false);owner=true;check(recovery.eligible(),"cancel preserves recovery");
  fresh();slots.write(NS+LegacyCloudRecovery.JOURNAL,"{\"status\":\"pending\"}");check(restore(token->{}),"pending write retry");
  fresh();slots.write(NS+LegacyCloudRecovery.JOURNAL,"{\"status\":\"unknown\"}");check(!recovery.eligible(),"unknown journal closed");
  fresh();slots.write("cloud-signin:pending:production","{\"secret\":\"synthetic\"}");slots.write("local-agent-provider:v1","{\"admissionGeneration\":\"old\"}");check(restore(token->{}),"legacy provider does not authorize or block explicit account restore");check(slots.read(NS+"cloud-signin:pending:production")==null&&slots.read(NS+"local-agent-provider:v1")==null,"no pending attempt or proof migration");
  for(int checkpoint=0;checkpoint<3;checkpoint++){
   fresh();android.util.AtomicFile.failAfterStarts=checkpoint;
   try{restore(token->{});throw new AssertionError("write failure ignored");}catch(java.io.IOException expected){passed++;}
   check(SAVED.equals(slots.read("cloud:production")),"failed write preserves legacy");
   if(checkpoint<2){check(recovery.eligible(),"pre-target failure explicitly retryable");check(restore(token->{}),"retry succeeds");}
   else{check(SAVED.equals(slots.read(NS+"cloud:production"))&&!recovery.eligible(),"uncertain final marker never overwrites committed target");}
  }
  fresh();slots.write(NS+LegacyCloudRecovery.JOURNAL,"{\"status\":\"complete\"}");check(!recovery.eligible(),"completed marker no reimport even absent target");
  System.out.println("PASS "+passed+" real encrypted-slot recovery assertions");
  StoreIntegrationTest.main(new String[]{new File(root,"integration").getPath()});
  RendererRecoverySlotsTest.main(new String[0]);
  ProviderConditionalClearTest.main(new String[]{new File(root,"conditional").getPath()});
 }
}
