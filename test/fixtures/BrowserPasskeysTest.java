package ai.elizaresearch.alphaphone;
public final class BrowserPasskeysTest {
 public static void main(String[] args){
  java.util.concurrent.atomic.AtomicInteger mode=new java.util.concurrent.atomic.AtomicInteger(2);
  BrowserPasskeys.disable(()->mode.set(0),mode::get,0);
  BrowserPasskeys.disable(()->{throw new UnsupportedOperationException();},mode::get,0);
  mode.set(2);
  try{BrowserPasskeys.disable(()->{throw new UnsupportedOperationException();},mode::get,0);throw new AssertionError("broken provider enabled passkeys");}catch(UnsupportedOperationException expected){}
  try{BrowserPasskeys.disable(()->{},mode::get,0);throw new AssertionError("ignored setting enabled passkeys");}catch(IllegalStateException expected){}
 }
}
