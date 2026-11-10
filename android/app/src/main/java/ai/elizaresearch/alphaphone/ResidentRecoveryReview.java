package ai.elizaresearch.alphaphone;

/** Instance-local, single-use review authority. All access holds the plugin lifecycle lock. */
final class ResidentRecoveryReview {
 private String token;
 private long lifecycle,intent;
 void clear(){token=null;}
 void bind(String token,long lifecycle,long intent){this.token=token;this.lifecycle=lifecycle;this.intent=intent;}
 boolean consume(String token,long lifecycle,long intent){
  boolean current=this.token!=null&&this.token.equals(token)&&this.lifecycle==lifecycle&&this.intent==intent;
  clear();return current;
 }
}
