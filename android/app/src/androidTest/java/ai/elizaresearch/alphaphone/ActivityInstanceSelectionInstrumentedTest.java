package ai.elizaresearch.alphaphone;
import android.app.Activity;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleCallback;
import androidx.test.runner.lifecycle.Stage;
import java.lang.reflect.*;
import org.junit.Test;
import static org.junit.Assert.*;
/** Deterministic observer ordering regression; real lifecycle acceptance is separate. */
public final class ActivityInstanceSelectionInstrumentedTest {
 /** Construct identities on Android's main Looper without attaching or starting them. */
 private Activity identity(){
  Activity[] result=new Activity[1];
  InstrumentationRegistry.getInstrumentation().runOnMainSync(()->result[0]=new MainActivity());
  return result[0];
 }
 private Object scenario()throws Exception{Constructor<?> c=BoundedActivityScenario.class.getDeclaredConstructor(Class.class);c.setAccessible(true);return c.newInstance(MainActivity.class);}
 private Object field(Object s,String name)throws Exception{Field f=BoundedActivityScenario.class.getDeclaredField(name);f.setAccessible(true);return f.get(s);}
 private void set(Object s,String name,Object value)throws Exception{Field f=BoundedActivityScenario.class.getDeclaredField(name);f.setAccessible(true);f.set(s,value);}
 @Test public void staleTeardownCannotCaptureNewLaunch()throws Exception{
  Object s=scenario();Activity old=identity(),fresh=identity();ActivityLifecycleCallback observer=(ActivityLifecycleCallback)field(s,"observer");
  for(Stage event:new Stage[]{Stage.PAUSED,Stage.STOPPED,Stage.DESTROYED})observer.onActivityLifecycleChanged(old,event);
  assertNull(field(s,"activity"));observer.onActivityLifecycleChanged(fresh,Stage.CREATED);observer.onActivityLifecycleChanged(fresh,Stage.STARTED);observer.onActivityLifecycleChanged(fresh,Stage.RESUMED);
  assertSame(fresh,field(s,"activity"));assertEquals(Stage.RESUMED,field(s,"stage"));observer.onActivityLifecycleChanged(old,Stage.DESTROYED);assertEquals(Stage.RESUMED,field(s,"stage"));
  set(s,"recreating",fresh);Activity replacement=identity();observer.onActivityLifecycleChanged(replacement,Stage.CREATED);observer.onActivityLifecycleChanged(fresh,Stage.DESTROYED);observer.onActivityLifecycleChanged(replacement,Stage.RESUMED);assertSame(replacement,field(s,"activity"));assertEquals(Stage.RESUMED,field(s,"stage"));
 }
 @Test public void resumedSingleTaskReuseCanBeAdopted()throws Exception{Object s=scenario();Activity reused=identity();ActivityLifecycleCallback observer=(ActivityLifecycleCallback)field(s,"observer");observer.onActivityLifecycleChanged(reused,Stage.RESUMED);assertSame(reused,field(s,"activity"));assertEquals(Stage.RESUMED,field(s,"stage"));}
}
