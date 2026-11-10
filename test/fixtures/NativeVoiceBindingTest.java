package ai.elizaresearch.alphaphone;

public final class NativeVoiceBindingTest {
 static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
 public static void main(String[] args){
  NativeVoiceBinding binding=new NativeVoiceBinding(1,"root","token","owner");
  check(binding.current(1,"root","token","owner","root",200,100,true),"binding admitted");
  check(!binding.current(1,"root","new-token","owner","root",200,100,true),"same-owner re-enrollment rejected");
  check(!binding.current(2,"root","token","owner","root",200,100,true),"epoch changed rejected");
  check(!binding.current(1,"root","token","other","root",200,100,true),"owner changed rejected");
  check(!binding.current(1,"root","token","owner","new-root",200,100,true),"runtime changed rejected");
  check(!binding.current(1,"root","token","owner","root",100,100,true),"expiry rejected");
  check(!binding.current(1,"root","token","owner","root",200,100,false),"stopping resident rejected");
  System.out.println("PASS native voice binding: re-enrollment, epoch, owner, runtime, expiry, stopping");
 }
}
