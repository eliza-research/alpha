package ai.elizaresearch.alphaphone;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;

/**
 * The owner's Settings switches for agent Gmail changes and Calendar edits, where the on-device
 * Google host (backend/native-google-agent-host.ts) reads them before every agent write. A missing
 * or malformed file means both are off. Capacitor-free so the host JVM tests can run it.
 */
final class GoogleAgentAccessFile {
 static final String NAME="alpha-google-agent-access.json";
 private GoogleAgentAccessFile(){}
 /** In the resident's private state directory, so Reset Alpha data removes it. */
 static File in(File filesDir){return new File(new File(filesDir,".eliza"),NAME);}
 /** Whole-file replace: the host reads either the previous switches or these, never a partial file. */
 static synchronized void write(File file,boolean gmailChanges,boolean calendarEdits) throws IOException {
  Path target=file.toPath(),directory=target.getParent();
  Files.createDirectories(directory,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
  if(Files.isSymbolicLink(directory)||Files.isSymbolicLink(target))throw new IOException("Google access file must be real");
  Path temporary=Files.createTempFile(directory,NAME,".tmp",PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
  try{
   byte[] body=("{\"version\":1,\"gmailChanges\":"+gmailChanges+",\"calendarEdits\":"+calendarEdits+"}").getBytes(StandardCharsets.UTF_8);
   try(FileChannel channel=FileChannel.open(temporary,StandardOpenOption.WRITE,StandardOpenOption.TRUNCATE_EXISTING)){
    ByteBuffer buffer=ByteBuffer.wrap(body);while(buffer.hasRemaining())channel.write(buffer);channel.force(true);
   }
   Files.move(temporary,target,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
  }finally{Files.deleteIfExists(temporary);}
 }
}
