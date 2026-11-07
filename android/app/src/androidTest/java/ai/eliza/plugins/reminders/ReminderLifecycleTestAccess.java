package ai.eliza.plugins.reminders;

import android.content.Context;
import ai.elizaresearch.alphaphone.AlphaReminders;
import org.json.JSONException;
import org.json.JSONObject;

/** Instrumentation-only access to the upstream reminder lifecycle internals (refusals, boot re-post, due channel, to-dos). */
public final class ReminderLifecycleTestAccess {
 private ReminderLifecycleTestAccess() {}
 private static ReminderStore store(Context c){return AlphaReminders.engine(c).store;}
 /** A separate store whose preferences the caller has already isolated in a ContextWrapper. */
 public static final class Isolated {
  private final ReminderStore store;
  public Isolated(Context c){store=new ReminderStore(AlphaReminders.CONFIGURATION,AlphaReminders.STORAGE.create(c));}
  public JSONObject schedule(Context c,String id,String title,long at)throws JSONException{return store.schedule(c,id,title,"",at);}
  public JSONObject saveTodo(Context c,String id,String title)throws JSONException{return store.saveTodo(c,id,title,"");}
  public JSONObject read(Context c,String id)throws JSONException{return store.read(c,id);}
  public boolean cancel(Context c,String id)throws JSONException{return store.cancel(c,id);}
 }
 public static boolean storageFull(Throwable error){return error instanceof ReminderStore.StorageFull;}
 public static String dueChannel(){return AlphaReminders.CONFIGURATION.dueChannelId();}
 public static String bootId(Context c){return ReminderStore.bootId(c);}
 public static void restore(Context c,String boot){store(c).restore(c,boot);}
 /** Leave the device marker at the real boot so the next app start does not re-post fixtures. */
 public static void markBoot(Context c,String boot){if(!c.getSharedPreferences(AlphaReminders.CONFIGURATION.envelopeName+"_restored_boot",Context.MODE_PRIVATE).edit().putString("boot",boot).commit())throw new IllegalStateException("Boot marker not saved");}
 public static JSONObject saveTodo(Context c,String id,String title,String body)throws JSONException{return store(c).saveTodo(c,id,title,body);}
 public static JSONObject todoDecision(Context c,JSONObject target,String action)throws JSONException{return store(c).todoDecision(c,target,action);}
}
