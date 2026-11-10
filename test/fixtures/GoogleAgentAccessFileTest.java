package ai.alphacompute.alphaphone;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.attribute.PosixFilePermissions;

/** Host-JVM write of the owner's Google switches file as AlphaLocalAgentPlugin.setGoogleAgentAccess does.
 * Arguments: files directory, gmailChanges, calendarEdits. Not Android or Settings evidence. */
public final class GoogleAgentAccessFileTest {
 private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 public static void main(String[] args)throws Exception {
  File file=GoogleAgentAccessFile.in(new File(args[0]));
  GoogleAgentAccessFile.write(file,Boolean.parseBoolean(args[1]),Boolean.parseBoolean(args[2]));
  check("rw-------".equals(PosixFilePermissions.toString(Files.getPosixFilePermissions(file.toPath()))),"owner-only file");
  String[] left=file.getParentFile().list();
  check(left!=null&&left.length==1&&GoogleAgentAccessFile.NAME.equals(left[0]),"no temporary file is left behind");
  System.out.println("PASS google access file "+file.getAbsolutePath());
 }
}
