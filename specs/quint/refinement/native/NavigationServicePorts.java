package ai.elizaresearch.alphaphone;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Only platform admission, command delivery and bounded faults are controlled. */
public final class NavigationServicePorts {
 public static final Context context=new Context();
 public static final NotificationManager notifications=new NotificationManager();
 public static final List<Intent> commands=new ArrayList<>();
 public static boolean permission=true,declared=true,failForeground,failStart;
 public static final Map<String,Integer> authorities=new LinkedHashMap<>();
 public static final JSONArray events=new JSONArray();
 public static Runnable beforeStopRefusal,afterStartDispatch;
 public static synchronized int authority(String token){
  if(token==null)return 0;
  return authorities.computeIfAbsent(token,key->authorities.size()+1);
 }
 public static void event(int owner,String event,JSONObject value){
  if(!event.equals("navigationStopped"))throw new AssertionError(event);
  events.put(new JSONObject().put("owner",owner).put("id",value.getString("sessionId"))
   .put("reason",value.getString("reason")));
 }
 public static int fallbackStops;
 public static void start(Intent intent){
  authority(intent.getStringExtra("authority"));
  if(failStart){failStart=false;throw new IllegalStateException("foreground startup refused");}
  commands.add(intent);
  if(afterStartDispatch!=null){Runnable hook=afterStartDispatch;afterStartDispatch=null;hook.run();}
 }
 public static void command(Intent intent){
  authority(intent.getStringExtra("authority"));
  if(beforeStopRefusal!=null&&AlphaNavigationService.ACTION_STOP.equals(intent.getAction())){
   Runnable hook=beforeStopRefusal;beforeStopRefusal=null;hook.run();
   throw new IllegalStateException("background delivery refused");
  }
  commands.add(intent);
 }
 private NavigationServicePorts(){}
}
