package android.os;
/**
 * The device's API level, one value read by the plugin and the PackageInstaller stub alike: 29 is Android 10, Alpha's minimum, 37 is Android 17, the production target, and 38 stands for a level whose AOSP was not read.
 * CODENAME is "REL" on a release build; a build that is not one reports the level it branched from (android-17.0.0_r1 core/java/android/os/Build.java 528, build core/version_util.mk 114-121), and "unknown" when the property is missing (Build.java 1968-1969).
 */
public final class Build {public static final class VERSION {public static volatile int SDK_INT=37;public static volatile String CODENAME="REL";}}
