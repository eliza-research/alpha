package androidx.core.content;
public final class ContextCompat {
 public static final int RECEIVER_NOT_EXPORTED=4;
 public static void registerReceiver(android.content.Context context,android.content.BroadcastReceiver receiver,android.content.IntentFilter filter,int flags){context.receivers.add(receiver);}
}
