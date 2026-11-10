package ai.elizaresearch.alphaphone.peerfixture;

import android.app.Service;
import android.content.Intent;
import android.net.LocalSocket;
import android.net.LocalSocketAddress;
import android.os.Binder;
import android.os.IBinder;
import android.os.Parcel;
import android.os.Process;
import android.system.ErrnoException;
import android.system.Os;
import android.system.StructStat;
import java.io.File;
import java.io.IOException;

/** Ordinary separate UID, debug-only. No protocol writes or arbitrary path input. */
public final class PrivateSocketProbeService extends Service {
 private static final String ALPHA="ai.elizaresearch.alphaphone";
 private String runId;
 private boolean attempted;
 private final Binder binder=new Binder(){
  @Override protected synchronized boolean onTransact(int code,Parcel in,Parcel out,int flags){
   if(code!=IBinder.FIRST_CALL_TRANSACTION)return false;
   enforceCallingPermission(ALPHA+".peerfixture.permission.CONTROL","Signature controller required");
   try{
    int owner=getPackageManager().getPackageUid(ALPHA,0);
    if(Binder.getCallingUid()!=owner||owner==Process.myUid()||owner/100000!=Process.myUid()/100000)throw new SecurityException("Wrong controller UID");
    if(!runId.equals(in.readString())||attempted)throw new SecurityException("Run mismatch or duplicate probe");
    attempted=true;
    String targetRoot=getPackageManager().getApplicationInfo(ALPHA,0).dataDir;
    String ownRoot=getApplicationInfo().dataDir;
    StructStat own=Os.lstat(ownRoot);
    int rootErrno=0;
    try{Os.lstat(targetRoot);}catch(ErrnoException hidden){rootErrno=hidden.errno;}
    String path=new File(targetRoot,"files/ipc/a.sock").getPath();
    int statErrno=0;
    try{Os.lstat(path);}catch(ErrnoException denied){statErrno=denied.errno;}
    boolean connected=false;
    try(LocalSocket socket=new LocalSocket()){
     // API 35 SO_TIMEOUT sets SO_SNDTIMEO, bounding the supported filesystem connect.
     socket.getInputStream(); // Supported API initializes the lazily created descriptor; no read occurs.
     socket.setSoTimeout(2000);
     try{socket.connect(new LocalSocketAddress(path,LocalSocketAddress.Namespace.FILESYSTEM));connected=true;}catch(IOException denied){}
    }
    // No write API is invoked, including when the unexpected connection succeeds.
    out.writeInt(Process.myUid());out.writeString(runId);out.writeString(path);out.writeInt(statErrno);out.writeInt(connected?1:0);
    out.writeString(targetRoot);out.writeInt(rootErrno);out.writeString(ownRoot);out.writeInt(own.st_uid);out.writeInt(own.st_mode);
    return true;
   }catch(android.content.pm.PackageManager.NameNotFoundException missing){throw new SecurityException("Alpha missing",missing);}
   catch(ErrnoException invalidOwnRoot){throw new IllegalStateException("Peer own data root unavailable",invalidOwnRoot);}
   catch(IOException cleanup){throw new IllegalStateException("Probe cleanup failed",cleanup);}
  }
 };
 @Override public IBinder onBind(Intent intent){
  if(!BuildConfig.DEBUG||Process.myUid()/100000<=0||intent==null||!intent.getBooleanExtra("privatePeerFixture",false))throw new SecurityException("Disposable debug fixture only");
  String id=intent.getStringExtra("runId");
  if(id==null||!id.matches("[0-9a-f-]{36}")||runId!=null)throw new SecurityException("Fresh UUID required");
  runId=id;return binder;
 }
}
