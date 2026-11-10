package ai.elizaresearch.alphaphone;
import java.io.File;
import org.json.JSONObject;
public final class ProviderOwnKeysTest {
 static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
 public static void main(String[] args)throws Exception{
  AlphaCredentialStore store=new AlphaCredentialStore(new android.content.Context(new File(args[0])));
  store.writeCredentialSlot("cloud:production",LegacyCloudRecoveryTest.SAVED);
  AlphaLocalAgentPlugin.bindCloudProvider(store,LegacyCloudRecoveryTest.ID,LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL);
  String account=store.providerAdmissionSnapshot().getString("accountRef");
  check(AlphaLocalAgentPlugin.saveVerifiedProvider(store,"synthetic-direct-key",LocalAgentProviderAdmission.CEREBRAS_PROVIDER_MODEL,(key,model)->null)==null,"direct key saved");
  String own=store.readCredentialSlot("local-agent-provider:v1");
  check("cerebras".equals(new JSONObject(own).getString("provider")),"own provider selected");
  check(account.equals(store.providerAdmissionSnapshot().getString("accountRef")),"local account identity retained");
  check(LegacyCloudRecoveryTest.SAVED.equals(store.readCredentialSlot("cloud:production")),"Cloud sign-in retained");
  store.removeCredentialSlot("cloud:production");
  check(own.equals(store.readCredentialSlot("local-agent-provider:v1")),"Cloud sign-out preserves direct admission");
  check(account.equals(store.providerAdmissionSnapshot().getString("accountRef")),"local owner survives Cloud sign-out");
  store.writeCredentialSlot("cloud:production",LegacyCloudRecoveryTest.SAVED);
  AlphaLocalAgentPlugin.bindCloudProvider(store,LegacyCloudRecoveryTest.ID,LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL);
  String updated=store.readCredentialSlot("local-agent-provider:v1");
  check("cerebras".equals(new JSONObject(updated).getString("provider")),"Cloud reauthorization never selects another AI provider");
  check("synthetic-direct-key".equals(new JSONObject(updated).getString("key")),"direct credential retained natively");
  JSONObject binding=LocalAgentProviderAdmission.managedGoogleBinding(updated,LegacyCloudRecoveryTest.SAVED,System.currentTimeMillis());
  check(binding==null||account.equals(binding.getString("accountRef")),"Google retains own verified account");
  check(account.equals(store.providerAdmissionSnapshot().getString("accountRef")),"reauthorized local owner retained");
  // Exercise the actual encrypted store, admission CAS and independent key manager.
  ai.eliza.plugins.agent.runtime.NativeProviderSlot.Store managed=AlphaLocalAgentPlugin.providerSlot(store);
  String revision=ai.eliza.plugins.agent.runtime.NativeProviderSlot.managementRevision(updated,managed.authorityEpoch());
  check(ai.eliza.plugins.agent.runtime.NativeProviderSlot.editKeys(managed,revision,null,"synthetic-voice-key",(key,model)->{throw new AssertionError("Voice edit must not validate Text");})==null,"Voice-only edit saved");
  String both=store.readCredentialSlot("local-agent-provider:v1");
  check(new JSONObject(both).getString("key").equals("synthetic-direct-key"),"Voice edit preserves Text");
  revision=ai.eliza.plugins.agent.runtime.NativeProviderSlot.managementRevision(both,managed.authorityEpoch());
  check(ai.eliza.plugins.agent.runtime.NativeProviderSlot.editKeys(managed,revision,"synthetic-updated-text",null,(key,model)->null)==null,"Text-only edit saved");
  both=store.readCredentialSlot("local-agent-provider:v1");
  check(new JSONObject(both).getString("cartesiaKey").equals("synthetic-voice-key"),"Text edit preserves Voice");
  AlphaLocalAgentPlugin.bindCloudProvider(store,LegacyCloudRecoveryTest.ID,LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL,true,both);
  String cloudMode=store.readCredentialSlot("local-agent-provider:v1");
  check(new JSONObject(cloudMode).getString("provider").equals("elizacloud"),"explicit selection chooses Cloud");
  check(new JSONObject(cloudMode).getString("key").equals("synthetic-updated-text")&&new JSONObject(cloudMode).getString("cartesiaKey").equals("synthetic-voice-key"),"Cloud retains both encrypted Own keys");
  JSONObject status=ai.eliza.plugins.agent.runtime.NativeProviderSlot.managementStatus(cloudMode,LegacyCloudRecoveryTest.SAVED,System.currentTimeMillis(),managed.authorityEpoch());
  check(status.getString("mode").equals("cloud")&&!status.getBoolean("voiceConfigured")&&status.getJSONObject("keys").getJSONObject("voice").getBoolean("configured"),"saved Voice is dormant in Cloud");
  check(!status.toString().contains("synthetic-"),"status contains no secret");
  java.util.Map<String,String> env=new java.util.HashMap<>();env.put("CARTESIA_API_KEY","inherited");
  LocalAgentProviderAdmission.applyProviderEnvironment(new JSONObject(cloudMode),LegacyCloudRecoveryTest.SAVED,env,System.currentTimeMillis());
  check(!env.containsKey("CARTESIA_API_KEY")&&!env.containsKey("CEREBRAS_API_KEY"),"Cloud uses neither dormant Own key");
  ai.eliza.plugins.agent.runtime.NativeProviderSlot.selectOwn(managed,status.getString("revision"));
  String selectedOwn=store.readCredentialSlot("local-agent-provider:v1");
  check(!new JSONObject(selectedOwn).getJSONObject("cloudServices").has("key")&&!new JSONObject(selectedOwn).getJSONObject("cloudServices").has("cartesiaKey"),"Cloud services have no duplicate Own secrets");
  revision=ai.eliza.plugins.agent.runtime.NativeProviderSlot.managementRevision(selectedOwn,managed.authorityEpoch());
  ai.eliza.plugins.agent.runtime.NativeProviderSlot.removeKey(managed,revision,"text");
  String voiceOnly=store.readCredentialSlot("local-agent-provider:v1");
  status=ai.eliza.plugins.agent.runtime.NativeProviderSlot.managementStatus(voiceOnly,LegacyCloudRecoveryTest.SAVED,System.currentTimeMillis(),managed.authorityEpoch());
  check(status.getString("mode").equals("own")&&!status.getBoolean("configured")&&status.getBoolean("voiceConfigured"),"Remove Text retains selected Own and available Voice");
  LocalAgentProviderAdmission.applyProviderEnvironment(new JSONObject(voiceOnly),LegacyCloudRecoveryTest.SAVED,env,System.currentTimeMillis());
  check(!env.containsKey("CEREBRAS_API_KEY")&&!env.containsKey("ELIZAOS_CLOUD_API_KEY")&&"synthetic-voice-key".equals(env.get("CARTESIA_API_KEY")),"Voice-only has no text or Cloud fallback");
  revision=status.getString("revision");
  ai.eliza.plugins.agent.runtime.NativeProviderSlot.editKeys(managed,revision,"synthetic-updated-text",null,(key,model)->null);
  both=store.readCredentialSlot("local-agent-provider:v1");
  String oldRevision=ai.eliza.plugins.agent.runtime.NativeProviderSlot.managementRevision(both,managed.authorityEpoch());
  store.removeCredentialSlot("cloud:production");
  check(both.equals(store.readCredentialSlot("local-agent-provider:v1")),"Cloud sign-out does not erase or select Own keys");
  try{ai.eliza.plugins.agent.runtime.NativeProviderSlot.removeKey(managed,oldRevision,"voice");throw new AssertionError("stale account snapshot removed Voice");}catch(IllegalStateException expected){}
  try{ai.eliza.plugins.agent.runtime.NativeProviderSlot.revealKey(managed,oldRevision,"voice");throw new AssertionError("stale account snapshot revealed Voice");}catch(IllegalStateException expected){}
  String currentRevision=ai.eliza.plugins.agent.runtime.NativeProviderSlot.managementRevision(both,managed.authorityEpoch());
  check(ai.eliza.plugins.agent.runtime.NativeProviderSlot.revealKey(managed,currentRevision,"voice").equals("synthetic-voice-key"),"current owner-only native reveal reads its fixture key");
  String guard=store.providerBindingGuard(both);check(store.removeProviderIfCurrent(guard),"current cleanup completes");
  String kept=store.readCredentialSlot("local-agent-provider:v1");
  check(new JSONObject(kept).getBoolean("unbound")&&new JSONObject(kept).getString("provider").equals("cerebras")&&new JSONObject(kept).getString("cartesiaKey").equals("synthetic-voice-key"),"cleanup preserves keys and mode but unbinds routing");
  check(LocalAgentProviderAdmission.currentGeneration(kept,null)==null,"cleanup cannot admit dormant keys");
  try{LocalAgentProviderAdmission.applyProviderEnvironment(new JSONObject(kept),null,env,System.currentTimeMillis());throw new AssertionError("cleanup still routes");}catch(SecurityException expected){}
  AlphaCredentialStore reopened=new AlphaCredentialStore(new android.content.Context(new File(args[0])));
  check(kept.equals(reopened.readCredentialSlot("local-agent-provider:v1")),"keys survive encrypted store reopen");
  try(java.util.stream.Stream<java.nio.file.Path> files=java.nio.file.Files.walk(new File(args[0],"connection-credentials").toPath())){
   for(java.nio.file.Path file:(Iterable<java.nio.file.Path>)files.filter(java.nio.file.Files::isRegularFile)::iterator){
    String ciphertext=new String(java.nio.file.Files.readAllBytes(file),java.nio.charset.StandardCharsets.ISO_8859_1);
    check(!ciphertext.contains("synthetic-updated-text")&&!ciphertext.contains("synthetic-voice-key"),"keys never persist as plaintext");
   }
  }
  System.out.println("PASS native own keys: encrypted independent edit, mode switch, removal, cleanup, stale authority and local owner continuity");
 }
}
