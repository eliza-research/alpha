package ai.elizaresearch.alphaphone;

/** A native audio stream cannot move to another enrollment, even for the same owner. */
final class NativeVoiceBinding {
 private final long epoch;private final String root,token,owner;
 NativeVoiceBinding(long epoch,String root,String token,String owner){this.epoch=epoch;this.root=root;this.token=token;this.owner=owner;}
 boolean current(long epoch,String root,String token,String owner,String runtimeRoot,long expiry,long now,boolean accepting){
  return accepting&&this.epoch==epoch&&this.token!=null&&this.token.equals(token)
   &&VoiceEventAdmission.current(this.root,root,runtimeRoot,this.owner,owner,expiry,now);
 }
}
