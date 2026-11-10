package ai.alphacompute.alphaphone;

import android.content.Context;
import android.media.AudioManager;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginCall;
import java.util.ArrayList;
import org.json.JSONArray;

/** External lifecycle, permission and UI queue inputs for the product note bridge. */
public final class NoteBridgePorts {
 public static final Context context=new Context();
 public static final AudioManager audio=new AudioManager();
 public static PermissionState permission=PermissionState.GRANTED;
 public static PluginCall permissionCall;
 public static String permissionCallback;
 public static final JSONArray events=new JSONArray();
 public static boolean hold;
 public static int starts;
 public static final ArrayList<Runnable> queue=new ArrayList<>();
 public static void post(Runnable task){if(hold)queue.add(task);else task.run();}
 public static void flush(){while(!queue.isEmpty())queue.remove(0).run();}
 private NoteBridgePorts(){}
}
