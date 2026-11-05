package android.content.pm;
public class PackageManager {
 public static final int GET_SIGNING_CERTIFICATES=0x08000000;
 public boolean installsAllowed=true,binderDown;
 public PackageInfo archive,installed=new PackageInfo();
 /** Runs while the archive is read, to destroy a bridge at that moment. */
 public Runnable archiveRead=()->{};
 public final PackageInstaller installer=new PackageInstaller();
 public PackageManager(){Signature certificate=new Signature(new byte[]{7});installed.versionCode=7;installed.signingInfo=new SigningInfo(new Signature[]{certificate},new Signature[]{certificate});}
 public boolean canRequestPackageInstalls(){return installsAllowed;}
 public PackageInstaller getPackageInstaller(){if(binderDown)throw new RuntimeException("DeadSystemException");return installer;}
 public PackageInfo getPackageArchiveInfo(String path,int flags){archiveRead.run();return archive;}
 public PackageInfo getPackageInfo(String name,int flags){return installed;}
}
