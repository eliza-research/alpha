package android.content;
/** Host stub: only the no-backup directory AlphaNoteRecorder keeps its recordings in. */
public class Context {
 private final java.io.File dir;
 public Context(java.io.File dir){this.dir=dir;}
 public Context getApplicationContext(){return this;}
 public java.io.File getNoBackupFilesDir(){return dir;}
}
