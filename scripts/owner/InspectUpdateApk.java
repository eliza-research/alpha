import com.android.apksig.ApkVerifier;
import com.android.apksig.apk.ApkUtils;
import com.android.apksig.util.DataSources;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.HexFormat;

/** Read-only APK identity and lineage inspection. A signer is never inferred
 * from an unverified proof-of-rotation attribute or a caller's manifest row. */
public final class InspectUpdateApk {
  private static void require(boolean value, String message) {
    if (!value) throw new IllegalArgumentException(message);
  }
  private static String sha(byte[] bytes) throws Exception {
    return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
  }
  private static String digest(FileChannel file) throws Exception {
    var hash = MessageDigest.getInstance("SHA-256");
    var buffer = ByteBuffer.allocate(65536);
    file.position(0);
    while (file.read(buffer) >= 0) {
      buffer.flip(); hash.update(buffer); buffer.clear();
    }
    return HexFormat.of().formatHex(hash.digest());
  }

  public static void main(String[] args) throws Exception {
    require(args.length == 3, "Expected APK, SHA-256 and package");
    require(args[1].matches("[0-9a-f]{64}"), "Invalid APK SHA-256");
    require(args[2].matches("[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)+"), "Invalid package");
    Path input = Path.of(args[0]);
    require(Files.isRegularFile(input, LinkOption.NOFOLLOW_LINKS), "APK must be a regular file");
    require(Files.size(input) > 0 && Files.size(input) <= (1L << 31), "APK size is outside update limits");
    try (var file = FileChannel.open(input, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
      require(digest(file).equals(args[1]), "APK differs from its admitted SHA-256");
      var bytes = DataSources.asDataSource(file);
      var manifest = ApkUtils.getAndroidManifest(bytes);
      require(args[2].equals(ApkUtils.getPackageNameFromBinaryAndroidManifest(manifest.duplicate())), "Wrong update package");
      long version = ApkUtils.getLongVersionCodeFromBinaryAndroidManifest(manifest.duplicate());
      require(version > 0, "Update versionCode must be positive");
      // PackageInstaller's no-user-action target floor advances with Android.
      // API 37 requires the candidate to target at least API 35; a correctly
      // signed older target would otherwise interrupt unattended activation.
      int targetSdk = ApkUtils.getTargetSdkVersionFromBinaryAndroidManifest(manifest.duplicate());
      require(targetSdk >= 35, "Update targetSdkVersion must be at least 35 for Android API 37 self-updates");
      require(!ApkUtils.getDebuggableFromBinaryAndroidManifest(manifest.duplicate()), "Update APK is debuggable");
      String active = null, root = null, lineageHash = null;
      int lineageSize = 0;
      // Every supported Android version must select the same active authority
      // and original family. A platform-dependent signing transition needs its
      // own reviewed admission policy rather than an arbitrary verifier default.
      for (int api = 29; api <= 37; api++) {
        require(ApkUtils.getMinSdkVersionFromBinaryAndroidManifest(manifest.duplicate()) <= api, "Update minSdk exceeds a supported Android API");
        var result = new ApkVerifier.Builder(bytes).setMinCheckedPlatformVersion(api)
            .setMaxCheckedPlatformVersion(api).build().verify();
        require(result.isVerified() && result.getSignerCertificates().size() == 1,
            "Update must have one verified signer at every supported Android API");
        var certificate = result.getSignerCertificates().getFirst();
        var lineage = result.getSigningCertificateLineage();
        String observedActive = sha(certificate.getEncoded());
        String observedRoot = observedActive, observedLineageHash = null;
        int observedSize = 0;
        if (lineage != null) {
          var certificates = lineage.getCertificatesInLineage();
          require(!certificates.isEmpty() && certificates.getLast().equals(certificate), "Verified lineage does not end at the active signer");
          observedRoot = sha(certificates.getFirst().getEncoded());
          observedLineageHash = sha(lineage.getBytes());
          observedSize = certificates.size();
        }
        if (active == null) {
          active = observedActive; root = observedRoot; lineageHash = observedLineageHash; lineageSize = observedSize;
        } else require(active.equals(observedActive) && root.equals(observedRoot)
            && java.util.Objects.equals(lineageHash, observedLineageHash) && lineageSize == observedSize,
            "Update signing identity differs across supported Android APIs");
      }
      require(digest(file).equals(args[1]), "APK changed during identity verification");
      System.out.printf("{\"verified\":true,\"packageName\":\"%s\",\"versionCode\":%d,\"targetSdkVersion\":%d,\"activeSignerSha256\":\"%s\",\"signerRootSha256\":\"%s\",\"lineageSize\":%d,\"lineageSha256\":%s}%n",
          args[2], version, targetSdk, active, root, lineageSize, lineageHash == null ? "null" : "\"" + lineageHash + "\"");
    }
  }
}
