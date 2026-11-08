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
 /** Set, main's queue: each runOnUiThread waits here until the test runs it. Null, main runs it at once. */
 public java.util.List<Runnable> posted;
 public void runOnUiThread(Runnable work){if(posted!=null)posted.add(work);else work.run();}
}
