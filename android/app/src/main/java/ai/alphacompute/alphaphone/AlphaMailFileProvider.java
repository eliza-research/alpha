package ai.alphacompute.alphaphone;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;
/** Dedicated temporary read-only provider, including expiry after process recreation. */
public final class AlphaMailFileProvider extends androidx.core.content.FileProvider {
 @Override public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{
  if(!"r".equals(mode)||getContext()==null||uri.getPathSegments().size()!=2||!"mail-attachments".equals(uri.getPathSegments().get(0)))throw new FileNotFoundException("Read-only reviewed attachment required");
  String name=uri.getLastPathSegment();if(name==null||name.contains("/")||name.contains("\\"))throw new FileNotFoundException();
  File file=new File(new File(getContext().getCacheDir(),"mail-attachments"),name);long age=System.currentTimeMillis()-file.lastModified();
  if(!file.isFile()||age<0||age>ReviewedCopies.GRANT_MILLIS){file.delete();throw new FileNotFoundException("Reviewed attachment expired");}
  return super.openFile(uri,mode);
 }
}
