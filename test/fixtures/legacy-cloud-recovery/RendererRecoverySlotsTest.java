package ai.elizaresearch.alphaphone;
/** Actual renderer gate, not a simulated secure-store allow-list. */
public final class RendererRecoverySlotsTest {
 public static void main(String[] args){
  String ns=LegacyCloudRecovery.LEGACY_NAMESPACE;
  java.util.List<String> leaked=new java.util.ArrayList<>();
  for(String slot:new String[]{LegacyCloudRecovery.JOURNAL,ns+LegacyCloudRecovery.JOURNAL,
    ns+"local-agent-provider:v1",ns+"cloud-signin:pending:v1",ns+"cloud:production",
    "cloud-deployment:foreign-realm:cloud:production","cloud-deployment:foreign-realm:local-agent-provider:v1",
    "cloud-deployment","cloud-deployment:"}){
   try{RendererCredentialSlots.requireAllowed(slot);leaked.add(slot);}catch(SecurityException expected){}
  }
  if(!leaked.isEmpty())throw new AssertionError("Renderer admitted native/physical slots: "+leaked);
  for(String slot:new String[]{"cloud:production","cloud:staging",AlphaCredentialStore.NOTES_RECORDS,AlphaCredentialStore.NOTES_TRASH,AlphaCredentialStore.NOTES_DRAFT}){
   if(!slot.equals(RendererCredentialSlots.requireAllowed(slot)))throw new AssertionError("Logical credential/Notes route changed");
  }
  System.out.println("PASS renderer logical and physical recovery slot isolation");
 }
}
