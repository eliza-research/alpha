package android.content.pm;
public class SigningInfo {
 private final Signature[] signers,history;
 public SigningInfo(Signature[] signers,Signature[] history){this.signers=signers;this.history=history;}
 public boolean hasMultipleSigners(){return signers.length>1;}
 public Signature[] getSigningCertificateHistory(){return hasMultipleSigners()?null:history;}
}
