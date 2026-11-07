package android.webkit;
/** Host-JVM stand-in for the Android class (StorageBrowserTest only). */
public final class MimeTypeMap {
 private static final MimeTypeMap ONE=new MimeTypeMap();
 public static MimeTypeMap getSingleton(){return ONE;}
 public String getMimeTypeFromExtension(String ext){
  switch(ext){case "pdf":return "application/pdf";case "jpg":return "image/jpeg";case "txt":return "text/plain";default:return null;}
 }
}
