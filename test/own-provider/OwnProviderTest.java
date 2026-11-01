import ai.eliza.plugins.agent.runtime.NativeProviderAdmission;
import ai.eliza.plugins.agent.runtime.NativeProviderSlot;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

public final class OwnProviderTest {
 static void check(boolean value){if(!value)throw new AssertionError();}
 static final class Store implements NativeProviderSlot.Store {
  String value; boolean conflict; int writes;
  public String readProvider(){return value;}
  public void assertCurrent(){}
  public String compareExchangeProvider(String previous,String selection){if(conflict)return null;check(java.util.Objects.equals(previous,value));writes++;value=selection;return value;}
  public void removeProvider(boolean onlyIfPresent){value=null;}
 }
 public static void main(String[] args)throws Exception{
  Store store=new Store();
  check(NativeProviderSlot.directProviderAllowed(false));
  check(NativeProviderSlot.saveVerifiedProvider(store,"synthetic-ai-key","qwen-3.8-27b",null,(key,model)->null,"Alpha")==null);
  check(store.writes==1);
  JSONObject selected=new JSONObject(store.value);
  Map<String,String> env=new HashMap<>();env.put("CARTESIA_API_KEY","stale");env.put("CARTESIA_API_KEY_FILE","stale");env.put("ELIZAOS_CLOUD_API_KEY","stale");
  NativeProviderAdmission.applyProviderEnvironment(selected,null,env,System.currentTimeMillis());
  check(!env.containsKey("CARTESIA_API_KEY")&&!env.containsKey("CARTESIA_API_KEY_FILE"));
  check(!env.containsKey("ELIZAOS_CLOUD_API_KEY"));check("cerebras".equals(env.get("ELIZA_PROVIDER")));
  check(NativeProviderSlot.saveVerifiedProvider(store,"synthetic-ai-key","qwen-3.8-27b","synthetic-voice-key",(key,model)->null,"Alpha")==null);
  selected=new JSONObject(store.value);
  NativeProviderAdmission.applyProviderEnvironment(selected,null,env,System.currentTimeMillis());
  check("synthetic-voice-key".equals(env.get("CARTESIA_API_KEY")));check("1".equals(env.get("ELIZA_SELF_HOSTED_VOICE_ENABLED")));
  JSONObject status=NativeProviderAdmission.providerIdentity(store.value);
  check(status.getBoolean("voiceConfigured"));check(!status.toString().contains("synthetic-"));
  String before=store.value;
  check(NativeProviderSlot.saveVerifiedProvider(store,"synthetic-ai-key","qwen-3.8-27b","bad\nkey",(key,model)->{throw new AssertionError("must not contact provider");},"Alpha")!=null);
  check(store.value.equals(before));
  check(NativeProviderSlot.saveVerifiedProvider(store,"synthetic-ai-key","qwen-3.8-27b",null,(key,model)->"refused","Alpha").equals("refused"));check(store.value.equals(before));
  store.conflict=true;try{NativeProviderSlot.saveVerifiedProvider(store,"synthetic-ai-key","qwen-3.8-27b",null,(key,model)->null,"Alpha");throw new AssertionError();}catch(IllegalStateException expected){}check(store.value.equals(before));
  NativeProviderSlot.applyUnboundEnvironment(env);check(!env.containsKey("CARTESIA_API_KEY")&&!env.containsKey("CEREBRAS_API_KEY")&&!env.containsKey("ELIZA_SELF_HOSTED_VOICE_ENABLED"));
  store.conflict=false;
  String id="11111111-1111-4111-8111-111111111111";
  String cloud=new JSONObject().put("credentialId",id).put("token","synthetic-cloud-secret").toString();
  JSONObject identity=new JSONObject().put("userId",id).put("organizationId","22222222-2222-4222-8222-222222222222");
  store.value=NativeProviderAdmission.admit(null,new JSONObject().put("provider","elizacloud").put("credentialId",id).put("model",NativeProviderAdmission.CLOUD_PROVIDER_MODEL).toString(),cloud,identity);
  String account=NativeProviderAdmission.cloudAccountRef(new JSONObject(store.value));
  check(NativeProviderSlot.saveVerifiedProvider(store,"synthetic-ai-key","qwen-3.8-27b",null,(key,model)->null,"Alpha")==null);
  store.value=NativeProviderAdmission.admit(null,store.value,null,null);
  JSONObject binding=NativeProviderAdmission.managedGoogleBinding(store.value,cloud,System.currentTimeMillis());
  check(account.equals(binding.getString("accountRef")));check(NativeProviderAdmission.currentGeneration(store.value,null).equals(binding.getString("sessionGeneration")));
  try{NativeProviderAdmission.managedGoogleBinding(store.value,new JSONObject(cloud).put("token","changed-cloud-secret").toString(),System.currentTimeMillis());throw new AssertionError();}catch(SecurityException expected){}
  System.out.println("PASS own provider optional voice, isolation, refusal and write conflict");
 }
}
