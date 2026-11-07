package ai.elizaresearch.alphaphone;

import org.json.JSONArray;
import org.json.JSONObject;

/** The existing fixture store delegates admission to the actual source compare/exchange policy. */
public final class ResidentTraces {
 static JSONObject observe(LocalAgentProviderAdmissionTest.Store store) {
  boolean configured = LocalAgentProviderAdmission.providerStatus(store.provider, store.cloud, LocalAgentProviderAdmissionTest.NOW).optBoolean("configured");
  return Trace.fields("provider", configured ? "cloud" : "none");
 }
 public static void main(String[] args) throws Exception {
  JSONArray traces = new JSONArray();
  for (String mode : new String[]{"success", "identity-failed", "conflict", "credential-replaced", "storage-failed", "expired"}) {
   LocalAgentProviderAdmissionTest.Store store = new LocalAgentProviderAdmissionTest.Store();
   store.cloud = LocalAgentProviderAdmissionTest.cloud(LocalAgentProviderAdmissionTest.ID, LocalAgentProviderAdmissionTest.NOW + 1);
   Trace trace = new Trace("provider-" + mode, observe(store));
   trace.macro("resident binding precondition", observe(store), Trace.action("start"), Trace.action("started", 0), Trace.action("beginBinding"));
   store.identityFails = mode.equals("identity-failed"); store.conflict = mode.equals("conflict"); store.readFails = mode.equals("storage-failed");
   if (mode.equals("credential-replaced")) store.cloudAfterAdmit = LocalAgentProviderAdmissionTest.cloud(LocalAgentProviderAdmissionTest.OTHER, LocalAgentProviderAdmissionTest.NOW + 1);
   if (mode.equals("expired")) store.cloud = LocalAgentProviderAdmissionTest.cloud(LocalAgentProviderAdmissionTest.ID, LocalAgentProviderAdmissionTest.NOW);
   boolean success = false;
   try { LocalAgentProviderAdmission.bindCloudProvider(store, LocalAgentProviderAdmissionTest.ID, LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL, () -> LocalAgentProviderAdmissionTest.NOW); success = true; }
   catch (LocalAgentProviderAdmission.CloudBindingFailure expected) { }
   trace.step("bindingResult", observe(store), 0, success);
   traces.put(trace.value);
  }
  System.out.println(new JSONObject().put("ResidentRuntime", traces));
 }
}
