package android.os;
/** Host stub: delayed work is recorded, never run (the test drives rollovers itself). */
public class Handler {
 public Handler(Looper looper){}
 public boolean postDelayed(Runnable r,long delay){return true;}
 public void removeCallbacks(Runnable r){}
}
