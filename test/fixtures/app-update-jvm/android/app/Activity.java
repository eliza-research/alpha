package android.app;
public class Activity {
 public final java.util.List<android.content.Intent> started=new java.util.ArrayList<>();
 public androidx.lifecycle.Lifecycle.State state=androidx.lifecycle.Lifecycle.State.RESUMED;
 /** Thrown by the next startActivity, as Android does when it cannot start the activity. */
 public RuntimeException refuseStart;
 public androidx.lifecycle.Lifecycle getLifecycle(){return new androidx.lifecycle.Lifecycle(state);}
 public void startActivity(android.content.Intent intent){
  RuntimeException refused=refuseStart;refuseStart=null;
  if(refused!=null)throw refused;
  started.add(intent);
 }
 public void runOnUiThread(Runnable work){work.run();}
}
