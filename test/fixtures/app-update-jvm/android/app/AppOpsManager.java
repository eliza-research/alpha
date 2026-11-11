package android.app;

public final class AppOpsManager {
 public static final String OPSTR_READ_PHONE_STATE="android:read_phone_state";
 public static final int MODE_ALLOWED=0;
 public static final int MODE_IGNORED=1;
 public static final int MODE_DEFAULT=3;

 public int phoneStateMode=MODE_ALLOWED;
 public int noteOpNoThrow(String operation,int uid,String packageName){
  if(!OPSTR_READ_PHONE_STATE.equals(operation)||uid!=10000||!"ai.alphacompute.alphaphone".equals(packageName))
   throw new AssertionError("Expected only the caller's phone-state app-op");
  return phoneStateMode;
 }
}
