package ai.alphacompute.alphaphone;

import java.io.File;
import java.io.IOException;

/** Executes the real writer against the private directory of a disposable host fixture. */
public final class NativeGoogleAccessFileTraces {
 public static void main(String[] args) {
  if (args.length != 3) throw new IllegalArgumentException("Expected directory and two switches");
  File file = GoogleAgentAccessFile.in(new File(args[0]));
  try {
   GoogleAgentAccessFile.write(file, Boolean.parseBoolean(args[1]), Boolean.parseBoolean(args[2]));
   System.out.println("applied");
  } catch (IOException refused) {
   System.out.println("refused");
  }
 }
}
