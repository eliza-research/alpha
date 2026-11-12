package android.telecom;

public final class TelecomManager {
 public boolean active,unavailable,readDenied;
 public int reads;
 public Runnable afterRead=()->{};
 public volatile String defaultDialer="ai.alphacompute.alphaphone";
 public String getDefaultDialerPackage(){return defaultDialer;}
 public boolean isInCall(){
  reads++;
  if(unavailable)throw new SecurityException("Call state unavailable");
  boolean inCall=active&&!readDenied;
  afterRead.run();
  return inCall;
 }
}
