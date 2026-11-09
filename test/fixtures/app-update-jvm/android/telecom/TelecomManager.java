package android.telecom;
public final class TelecomManager {public boolean active,unavailable;public boolean isInCall(){if(unavailable)throw new SecurityException("Call state unavailable");return active;}}
