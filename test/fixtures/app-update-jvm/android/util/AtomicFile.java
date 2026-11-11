package android.util;
import java.io.*;
import java.nio.file.*;
public final class AtomicFile {
 public static boolean refuseRename;
 private final File file,next;
 public AtomicFile(File file){this.file=file;next=new File(file.getPath()+".new");}
 public FileInputStream openRead()throws FileNotFoundException{return new FileInputStream(file);}
 public FileOutputStream startWrite()throws IOException{return new FileOutputStream(next);}
 public void finishWrite(FileOutputStream stream){try{stream.close();if(refuseRename){Files.delete(next.toPath());return;}Files.move(next.toPath(),file.toPath(),StandardCopyOption.REPLACE_EXISTING);}catch(IOException error){throw new UncheckedIOException(error);}}
 public void failWrite(FileOutputStream stream){try{stream.close();}catch(IOException ignored){}next.delete();}
 public void delete(){next.delete();file.delete();}
}
