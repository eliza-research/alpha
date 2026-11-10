package ai.elizaresearch.alphaphone;

/** A live feed must remain on the exact runtime and owner enrolled at admission. */
final class VoiceEventAdmission {
 private VoiceEventAdmission() {}
 static boolean current(String admittedRoot,String enrolledRoot,String runtimeRoot,String expectedOwner,String enrolledOwner,long expiresAt,long now) {
  return admittedRoot!=null&&!admittedRoot.isEmpty()&&admittedRoot.equals(enrolledRoot)&&admittedRoot.equals(runtimeRoot)
   &&expectedOwner!=null&&!expectedOwner.isEmpty()&&expectedOwner.equals(enrolledOwner)&&expiresAt>now;
 }
}
