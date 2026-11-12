package android.media;

public final class AudioManager {
 public static final int MODE_NORMAL=0;
 public static final int MODE_RINGTONE=1;
 public static final int MODE_IN_CALL=2;
 public static final int MODE_IN_COMMUNICATION=3;

 public volatile int mode=MODE_NORMAL;
 public int getMode(){return mode;}
}
