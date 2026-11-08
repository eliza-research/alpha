package android.app;
public class PendingIntent {
 public static final int FLAG_UPDATE_CURRENT=1<<27,FLAG_MUTABLE=1<<25;
 public static PendingIntent getBroadcast(android.content.Context context,int code,android.content.Intent intent,int flags){context.packages.installer.phase("sender");context.packages.installer.sending.run();return new PendingIntent();}
 public android.content.IntentSender getIntentSender(){return new android.content.IntentSender();}
}
