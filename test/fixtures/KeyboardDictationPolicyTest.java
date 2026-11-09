package ai.elizaresearch.alphaphone;
public final class KeyboardDictationPolicyTest {
 static void check(boolean result) { if (!result) throw new AssertionError(); }
 public static void main(String[] args) {
  KeyboardDictationPolicy p = new KeyboardDictationPolicy();
  p.open(); long first=p.start();check(p.stop(first));check(!p.finish(first,false,true));check(!p.finish(first,true,false));check(p.finish(first,true,true));check(!p.finish(first,true,true));
  p.open();long cancel=p.start();check(p.bindRecording(cancel,"old"));check(p.ownsRecording("old"));check(p.stop(cancel));p.close();check(!p.finish(cancel,true,true));
  p.open();long old=p.start();check(p.bindRecording(old,"new"));check(!p.ownsRecording("old"));check(p.ownsRecording("new"));check(p.stop(old));p.open();long next=p.start();check(!p.stop(old));check(p.stop(next));check(!p.finish(old,true,true));check(p.finish(next,true,true));
  check(KeyboardDictationPolicy.usesDirect("cerebras",false));check(!KeyboardDictationPolicy.usesDirect("elizacloud",false));
  for(String provider:new String[]{"unconfigured","cerebras"}) {boolean denied=false;try{KeyboardDictationPolicy.usesDirect(provider,true);}catch(IllegalStateException expected){denied=true;}check(denied);}
  for(int input:new int[]{0,0x81,0x91,0xe1,0x12})check(!KeyboardDictationPolicy.permitted(input,0));
  check(!KeyboardDictationPolicy.permitted(1,0x1000000));check(KeyboardDictationPolicy.permitted(1,0));check(KeyboardDictationPolicy.permitted(0x20001,0));
  System.out.println("PASS keyboard dictation current, duplicate, cancelled, replaced, field/account and sensitive-field cases");
 }
}
