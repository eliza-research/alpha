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
  System.out.println("PASS native own keys: Cloud sign-in, sign-out, reauthorization and local owner continuity");
 }
}
