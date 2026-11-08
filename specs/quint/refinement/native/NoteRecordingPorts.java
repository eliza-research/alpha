package ai.elizaresearch.alphaphone;

import android.app.NotificationManager;
import android.content.Intent;
import android.media.MediaRecorder;
import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;

/** Controlled clock, recorder outcomes and Android service command transport. */
public final class NoteRecordingPorts {
 public static File root;
 public static long now=100;
 public static boolean failJournal,failOpen,failStop,failJoin,failForeground,failConstructor;
 public static int journalWrites;
 public static final ArrayList<MediaRecorder> recorders=new ArrayList<>();
 public static final ArrayList<Intent> commands=new ArrayList<>();
 public static final Map<Runnable,Long> timers=new LinkedHashMap<>();
 public static final NotificationManager notifications=new NotificationManager();
 public static void advance(long millis){now+=millis;}
 public static void runTimers(){
  ArrayList<Runnable> due=new ArrayList<>();
  for(Map.Entry<Runnable,Long> entry:timers.entrySet())if(entry.getValue()<=now)due.add(entry.getKey());
  for(Runnable task:due){timers.remove(task);task.run();}
 }
 private NoteRecordingPorts(){}
}
