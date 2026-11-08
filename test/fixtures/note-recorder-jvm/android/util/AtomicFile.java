package android.util;
import java.io.*;
/** Host filesystem adapter only; Android AtomicFile durability is tested on device. */
public final class AtomicFile {
 private final File file;
 public AtomicFile(File file){this.file=file;}
 public FileInputStream openRead()throws IOException{return new FileInputStream(file);}
 public FileOutputStream startWrite()throws IOException{return new FileOutputStream(file);}
 public void finishWrite(FileOutputStream out)throws IOException{out.close();}
 public void failWrite(FileOutputStream out)throws IOException{out.close();}
}
