package androidx.core.content;

import android.content.Context;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.util.List;

public class FileProvider {
 private Context context;
 public void attachForFixture(Context context){this.context=context;}
 public Context getContext(){return context;}
 public static Uri getUriForFile(Context context,String authority,File file){
  return new Uri(authority,List.of(file.getParentFile().getName(),file.getName()));
 }
 public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{
  if(!"r".equals(mode))throw new AssertionError("write mode reached the provider port");
  File folder=new File(context.getCacheDir(),uri.getPathSegments().get(0));
  return new ParcelFileDescriptor(new FileInputStream(new File(folder,uri.getLastPathSegment())));
 }
}
