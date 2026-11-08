package ai.eliza.sense;

import android.media.*;
import android.content.ContentResolver;
import java.util.*;
import java.util.concurrent.*;

/** Framework observations and fault controls; no listener policy is reproduced here. */
public final class ServicePorts {
 public static boolean permission=true,indicator=true,unlocked=true,userForeground=true,locked,foregroundFails,stopFails,releaseFails;
 public static int starts,invocations;public static long now=10000;public static String status="none";
 public static final AudioManager audio=new AudioManager();public static final ContentResolver resolver=new ContentResolver();
 public static final Queue<Runnable> queued=new ConcurrentLinkedQueue<>();public static final Map<Runnable,Long> timers=new ConcurrentHashMap<>();
 public static boolean holdLoad;public static final CountDownLatch loadEntered=new CountDownLatch(1),allowLoad=new CountDownLatch(1);
 public static final List<AudioRecord> records=new CopyOnWriteArrayList<>();
 public static AudioRecord record;public static ai.eliza.voice.NativeAsr engine;
 private ServicePorts(){}
}
