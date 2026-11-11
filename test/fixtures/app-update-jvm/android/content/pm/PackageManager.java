package android.content.pm;
public class PackageManager {
 public static final int PERMISSION_GRANTED=0;
 public static final int GET_SIGNING_CERTIFICATES=0x08000000;
 public static final int GET_PERMISSIONS=0x00001000;
 public static final int MATCH_SYSTEM_ONLY=0x00100000;
 public static class ResolveInfo{public final ActivityInfo activityInfo=new ActivityInfo();}
 public static class ActivityInfo{public String packageName;}
 public ResolveInfo resolveActivity(android.content.Intent intent,int flags){if(flags!=MATCH_SYSTEM_ONLY||!"android.fixture.packageinstaller".equals(intent.getPackage()))return null;ResolveInfo out=new ResolveInfo();out.activityInfo.packageName=intent.getPackage();return out;}
 public boolean installsAllowed=true,binderDown;
 public final java.util.Queue<Boolean> installConsentAnswers=new java.util.ArrayDeque<>();
 public PackageInfo archive,installed=new PackageInfo();
 /** Runs while the archive is read, to destroy a bridge at that moment. */
 public Runnable archiveRead=()->{};
 public final PackageInstaller installer=new PackageInstaller();
 public PackageManager(){Signature certificate=new Signature(new byte[]{7});installed.versionCode=7;installed.signingInfo=new SigningInfo(new Signature[]{certificate},new Signature[]{certificate});}
 public boolean canRequestPackageInstalls(){Boolean answer=installConsentAnswers.poll();return answer==null?installsAllowed:answer;}
 public PackageInstaller getPackageInstaller(){if(binderDown)throw new RuntimeException("DeadSystemException");return installer;}
 public PackageInfo getPackageArchiveInfo(String path,int flags){archiveRead.run();return archive;}
 public PackageInfo getPackageInfo(String name,int flags){return installed;}
}
