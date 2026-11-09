package android.content;

import android.net.Uri;
import java.io.File;
import java.util.function.Consumer;

public final class Context {
 private final File cache;
 private final Consumer<Uri> revoked;
 public Context(File cache,Consumer<Uri> revoked){this.cache=cache;this.revoked=revoked;}
 public Context getApplicationContext(){return this;}
 public File getCacheDir(){return cache;}
 public void revokeUriPermission(Uri uri,int mode){
  if(mode!=Intent.FLAG_GRANT_READ_URI_PERMISSION)throw new AssertionError("unexpected permission mode");
  revoked.accept(uri);
 }
}
