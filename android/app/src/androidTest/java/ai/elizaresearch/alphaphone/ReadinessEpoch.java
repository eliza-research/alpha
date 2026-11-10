package ai.elizaresearch.alphaphone;

/** Main-thread-only correlation for disposable read-only probes. Never used for effects. */
final class ReadinessEpoch {
 private long generation, sequence, pending, issuedAt;
 private boolean closed;
 void navigated(){ generation++; pending=0; }
 long generation(){ return generation; }
 long issue(long now){
  if(closed || (pending!=0 && now-issuedAt<500))return 0;
  pending=++sequence;issuedAt=now;return pending;
 }
 boolean complete(long document,long request){
  if(closed || document!=generation || request!=pending || pending==0)return false;
  pending=0;return true;
 }
 void close(){closed=true;pending=0;}
}
