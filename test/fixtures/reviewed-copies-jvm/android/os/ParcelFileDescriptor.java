package android.os;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;

public final class ParcelFileDescriptor implements Closeable {
 private final InputStream input;
 public ParcelFileDescriptor(InputStream input){this.input=input;}
 public byte[] readAllBytes()throws IOException{return input.readAllBytes();}
 @Override public void close()throws IOException{input.close();}
}
