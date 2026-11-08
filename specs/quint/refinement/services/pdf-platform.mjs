import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
/** Android primitive ports. Rendering, kernel transfer and process death remain external contracts. */
export function pdfPlatform() {
  const root = mkdtempSync(join(tmpdir(), 'quint-pdf-platform-'));
  const files = {
    'android/content/Intent.java': 'package android.content; public class Intent {}',
    'android/app/Service.java': `package android.app;
import android.content.Intent;import android.os.IBinder;
public class Service {public IBinder onBind(Intent i){return null;}public boolean onUnbind(Intent i){return false;}public void onDestroy(){}public int checkSelfPermission(String name){return -1;}}`,
    'android/Manifest.java': 'package android; public class Manifest {public static class permission {public static final String INTERNET="internet";}}',
    'android/content/pm/PackageManager.java': 'package android.content.pm; public class PackageManager {public static final int PERMISSION_DENIED=-1;}',
    'android/os/IBinder.java': 'package android.os; public interface IBinder {}',
    'android/os/Looper.java': 'package android.os; public class Looper {public static Looper getMainLooper(){return new Looper();}}',
    'android/os/RemoteException.java': 'package android.os; public class RemoteException extends Exception {}',
    'android/os/Process.java': 'package android.os; public class Process {public static boolean isolated=true,killed;public static boolean isIsolated(){return isolated;}public static int myPid(){return 1;}public static int myUid(){return 99000;}public static void killProcess(int pid){killed=true;}}',
    'android/os/Debug.java': 'package android.os; public class Debug {public static int getPss(){return 0;}}',
    'android/os/Bundle.java': `package android.os;
import java.util.HashMap;
public class Bundle extends HashMap<String,Object> {
 public <T>T getParcelable(String key){return (T)get(key);}public String getString(String key){return (String)get(key);}public String getString(String key,String value){return (String)getOrDefault(key,value);}public int getInt(String key,int value){return (Integer)getOrDefault(key,value);}
 public void putString(String key,String value){put(key,value);}public void putParcelable(String key,Object value){put(key,value);}public void putInt(String key,int value){put(key,value);}public void putBoolean(String key,boolean value){put(key,value);}
}`,
    'android/os/Message.java': `package android.os;
public class Message {public int what;public Messenger replyTo;private Bundle data;
 public static Message obtain(Object ignored,int what){Message m=new Message();m.what=what;return m;}public Bundle getData(){return data;}public void setData(Bundle b){data=b;}}`,
    'android/os/Handler.java': `package android.os;
import java.util.concurrent.ConcurrentLinkedQueue;
public class Handler {public interface Callback {boolean handleMessage(Message m);}public static final ConcurrentLinkedQueue<Runnable> immediate=new ConcurrentLinkedQueue<>();private final Callback callback;
 public Handler(Looper l){callback=null;}public Handler(Looper l,Callback c){callback=c;}public boolean post(Runnable r){immediate.add(r);return true;}public boolean postDelayed(Runnable r,long delay){return true;}public void removeCallbacks(Runnable r){immediate.remove(r);}public void dispatch(Message m){callback.handleMessage(m);}public static void drain(){Runnable r;while((r=immediate.poll())!=null)r.run();}}`,
    'android/os/Messenger.java': `package android.os;
public class Messenger {private final Handler handler;public Messenger(Handler h){handler=h;}public IBinder getBinder(){return new IBinder(){};}public void send(Message m)throws RemoteException{handler.dispatch(m);}}`,
    'android/os/ParcelFileDescriptor.java': `package android.os;
public class ParcelFileDescriptor {public volatile boolean closed;public long size=100;public long getStatSize(){return size;}public void close(){closed=true;}}`,
    'android/os/SharedMemory.java': `package android.os;
import java.nio.ByteBuffer;
public class SharedMemory {public static volatile SharedMemory last;public static boolean protectionWorks=true;public volatile boolean closed,readOnly,mapped;private final int bytes;
 private SharedMemory(int n){bytes=n;}public static SharedMemory create(String label,int n){last=new SharedMemory(n);return last;}public ByteBuffer mapReadWrite(){mapped=true;return ByteBuffer.allocate(bytes);}public static void unmap(ByteBuffer b){if(last!=null)last.mapped=false;}public boolean setProtect(int protection){readOnly=protectionWorks;return readOnly;}public void close(){closed=true;}}`,
    'android/graphics/Color.java': 'package android.graphics; public class Color {public static final int WHITE=-1;}',
    'android/graphics/Matrix.java': 'package android.graphics; public class Matrix {public void setScale(float x,float y){}}',
    'android/graphics/Bitmap.java': `package android.graphics;
import java.nio.ByteBuffer;
public class Bitmap {public enum Config {ARGB_8888}public static volatile Bitmap last;public volatile boolean recycled;private int width,height;
 public static Bitmap createBitmap(int w,int h,Config c){Bitmap b=new Bitmap();b.width=w;b.height=h;last=b;return b;}public void eraseColor(int c){}public int getByteCount(){return width*height*4;}public void copyPixelsToBuffer(ByteBuffer b){}public void recycle(){recycled=true;}}`,
    'android/graphics/pdf/PdfRenderer.java': `package android.graphics.pdf;
import android.os.ParcelFileDescriptor;import android.graphics.Bitmap;import android.graphics.Matrix;
public class PdfRenderer implements AutoCloseable {public PdfRenderer(ParcelFileDescriptor fd){}public int getPageCount(){return 1;}public Page openPage(int n){return new Page();}public void close(){}
 public static class Page implements AutoCloseable {public static final int RENDER_MODE_FOR_DISPLAY=1;public int getWidth(){return 100;}public int getHeight(){return 100;}public void render(Bitmap b,Object rect,Matrix m,int mode){}public void close(){}}}`,
    'android/system/OsConstants.java': 'package android.system; public class OsConstants {public static final int PROT_READ=1;}',
    'ai/elizaresearch/alphaphone/BuildConfig.java': 'package ai.elizaresearch.alphaphone; public class BuildConfig {public static final boolean ELIZA_DEV_ALLOW_TEST_MOCKS=false;}',
  };
  const paths = [];
  for (const [name, source] of Object.entries(files)) { const path = join(root, name); mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, source); paths.push(path); }
  return {paths, close: () => rmSync(root, {recursive: true, force: true})};
}
