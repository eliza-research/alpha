package android.telecom;

public final class TelecomManager {
 public boolean active,unavailable;
 public volatile String defaultDialer="ai.alphacompute.alphaphone";
 public String getDefaultDialerPackage(){return defaultDialer;}
 public boolean isInCall(){
  if(unavailable)throw new SecurityException("Call state unavailable");
  return active;
 }
}
