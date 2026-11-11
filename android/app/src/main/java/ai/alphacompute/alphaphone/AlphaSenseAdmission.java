package ai.alphacompute.alphaphone;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;

/** Native entry admission for the production image that stages the reviewed Sense companion. */
final class AlphaSenseAdmission {
 private static final String FEATURE = BuildConfig.APPLICATION_ID + ".feature.SENSE";
 private static final String COMPANION = BuildConfig.APPLICATION_ID + ".sense";
 private static final String COMPANION_APK = "/system_ext/priv-app/AlphaSense/AlphaSense.apk";
 private static final String SYSTEM_UI = "com.android.systemui";

 private AlphaSenseAdmission() {}

 static boolean available(Context context) { return trustedCompanion(context) != null; }

 static boolean listenerCaller(Context context, String caller, int uid) {
  if (!COMPANION.equals(caller) || uid < 0) return false;
  ApplicationInfo companion = trustedCompanion(context);
  return companion != null && companion.uid == uid;
 }

 static boolean protectedPowerCaller(Context context, String caller, int uid) {
  if (!SYSTEM_UI.equals(caller) || uid < 0 || !available(context)) return false;
  try {
   PackageManager packages = context.getPackageManager();
   ApplicationInfo systemUi = systemApp(packages, SYSTEM_UI);
   return systemUi != null && systemUi.uid == uid && sameCurrentSigner(packages, "android", SYSTEM_UI);
  } catch (PackageManager.NameNotFoundException | RuntimeException unavailable) { return false; }
 }

 private static ApplicationInfo trustedCompanion(Context context) {
  if (!AlphaImageCapabilities.aospImage(context)) return null;
  try {
   PackageManager packages = context.getPackageManager();
   if (!packages.hasSystemFeature(FEATURE)) return null;
   ApplicationInfo companion = systemApp(packages, COMPANION);
   if (companion == null || !COMPANION_APK.equals(companion.sourceDir)
     || !sameCurrentSigner(packages, BuildConfig.APPLICATION_ID, COMPANION)
     || packages.checkPermission("android.permission.CAPTURE_AUDIO_HOTWORD", COMPANION) != PackageManager.PERMISSION_GRANTED
     || context.checkSelfPermission(COMPANION + ".permission.LISTENER_CONTROL") != PackageManager.PERMISSION_GRANTED) return null;
   return companion;
  } catch (PackageManager.NameNotFoundException | RuntimeException unavailable) { return null; }
 }

 private static ApplicationInfo systemApp(PackageManager packages, String name) throws PackageManager.NameNotFoundException {
  ApplicationInfo app = packages.getApplicationInfo(name, 0);
  return app != null && name.equals(app.packageName) && app.enabled && (app.flags & ApplicationInfo.FLAG_SYSTEM) != 0 ? app : null;
 }

 private static boolean sameCurrentSigner(PackageManager packages, String expected, String candidate) throws PackageManager.NameNotFoundException {
  Signature signer = currentSigner(packages, expected);
  return signer != null && signer.equals(currentSigner(packages, candidate));
 }

 private static Signature currentSigner(PackageManager packages, String name) throws PackageManager.NameNotFoundException {
  SigningInfo signing = packages.getPackageInfo(name, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo;
  Signature[] signers = signing == null ? null : signing.getApkContentsSigners();
  return signers != null && signers.length == 1 ? signers[0] : null;
 }
}
