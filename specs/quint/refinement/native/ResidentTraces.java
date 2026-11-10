package ai.eliza.plugins.agent.runtime;
import ai.alphacompute.alphaphone.Trace;

import org.json.JSONArray;
import org.json.JSONObject;

/** The existing fixture store delegates admission to the actual source compare/exchange policy. */
public final class ResidentTraces {
 static JSONObject observe(NativeProviderAdmissionTest.Store store) {
  boolean configured = NativeProviderAdmission.providerStatus(store.provider, store.cloud, NativeProviderAdmissionTest.NOW).optBoolean("configured");
  return Trace.fields("provider", configured ? "cloud" : "none");
 }
 public static void main(String[] args) throws Exception {
  JSONArray traces = new JSONArray();
  for (String mode : new String[]{"success", "identity-failed", "conflict", "credential-replaced", "storage-failed", "expired"}) {
   NativeProviderAdmissionTest.Store store = new NativeProviderAdmissionTest.Store();
   store.cloud = NativeProviderAdmissionTest.cloud(NativeProviderAdmissionTest.ID, NativeProviderAdmissionTest.NOW + 1);
   Trace trace = new Trace("provider-" + mode, observe(store));
   trace.macro("resident binding precondition", observe(store), Trace.action("start"), Trace.action("started", 0), Trace.action("beginBinding"));
   store.identityFails = mode.equals("identity-failed"); store.conflict = mode.equals("conflict"); store.readFails = mode.equals("storage-failed");
   if (mode.equals("credential-replaced")) store.cloudAfterAdmit = NativeProviderAdmissionTest.cloud(NativeProviderAdmissionTest.OTHER, NativeProviderAdmissionTest.NOW + 1);
   if (mode.equals("expired")) store.cloud = NativeProviderAdmissionTest.cloud(NativeProviderAdmissionTest.ID, NativeProviderAdmissionTest.NOW);
   boolean success = false;
   try { NativeProviderAdmission.bindCloudProvider(store, NativeProviderAdmissionTest.ID, NativeProviderAdmission.CLOUD_PROVIDER_MODEL, () -> NativeProviderAdmissionTest.NOW); success = true; }
   catch (NativeProviderAdmission.CloudBindingFailure expected) { }
   trace.step("bindingResult", observe(store), 0, success);
   traces.put(trace.value);
  }
  System.out.println(new JSONObject().put("ResidentRuntime", traces));
 }
}
