import com.android.apksig.ApkVerifier;
import com.android.apksig.SigningCertificateLineage;
import com.android.apksig.apk.ApkUtils;
import com.android.apksig.util.DataSource;
import com.android.apksig.util.DataSources;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HexFormat;

/** Read-only verification of one reviewed, two-certificate APK migration. */
public final class VerifyApkRotation {
  private static void require(boolean result, String message) {
    if (!result) throw new IllegalArgumentException(message);
  }

  private static MessageDigest sha256() throws Exception {
    return MessageDigest.getInstance("SHA-256");
  }

  private static String hex(byte[] bytes) {
    return HexFormat.of().formatHex(bytes);
  }

  private static String digest(FileChannel channel) throws Exception {
    var hash = sha256();
    var buffer = ByteBuffer.allocate(64 * 1024);
    channel.position(0);
    while (channel.read(buffer) >= 0) {
      buffer.flip();
      hash.update(buffer);
      buffer.clear();
    }
    return hex(hash.digest());
  }

  private record VerifiedApk(String certificate, long version, ApkVerifier.Result signature) {}

  private static VerifiedApk verify(FileChannel channel, String apkSha, String expectedPackage, int api)
      throws Exception {
    require(digest(channel).equals(apkSha), "APK digest differs from the reviewed input");
    DataSource bytes = DataSources.asDataSource(channel);
    var result = new ApkVerifier.Builder(bytes)
        .setMinCheckedPlatformVersion(api).setMaxCheckedPlatformVersion(api).build().verify();
    require(result.isVerified() && result.getSignerCertificates().size() == 1,
        "Expected exactly one verified APK signer at the selected Android API");
    var manifest = ApkUtils.getAndroidManifest(bytes);
    require(expectedPackage.equals(ApkUtils.getPackageNameFromBinaryAndroidManifest(manifest.duplicate())),
        "APK package differs from the reviewed migration package");
    require(ApkUtils.getMinSdkVersionFromBinaryAndroidManifest(manifest.duplicate()) <= api,
        "APK minSdk exceeds the selected Android API");
    require(!ApkUtils.getDebuggableFromBinaryAndroidManifest(manifest.duplicate()),
        "Migration refuses a debuggable APK");
    require(digest(channel).equals(apkSha), "APK bytes changed during verification");
    var cert = result.getSignerCertificates().getFirst();
    return new VerifiedApk(hex(sha256().digest(cert.getEncoded())),
        ApkUtils.getLongVersionCodeFromBinaryAndroidManifest(manifest.duplicate()), result);
  }

  private static SigningCertificateLineage reviewedLineage(
      Path lineagePath, String lineageSha, String oldSigner, String newSigner, boolean preservePermissions) throws Exception {
    require(Files.isRegularFile(lineagePath, LinkOption.NOFOLLOW_LINKS), "Lineage must be a regular file");
    byte[] lineageBytes;
    try (var lineageFile = Files.newInputStream(lineagePath, LinkOption.NOFOLLOW_LINKS)) {
      lineageBytes = lineageFile.readNBytes(65_537);
    }
    require(lineageBytes.length <= 65_536, "Lineage exceeds the reviewed two-certificate input limit");
    require(hex(sha256().digest(lineageBytes)).equals(lineageSha), "Lineage differs from the reviewed digest");
    var approved = SigningCertificateLineage.readFromBytes(lineageBytes);
    var certs = approved.getCertificatesInLineage();
    require(certs.size() == 2, "Migration requires exactly two lineage certificates");
    require(hex(sha256().digest(certs.get(0).getEncoded())).equals(oldSigner)
        && hex(sha256().digest(certs.get(1).getEncoded())).equals(newSigner),
        "Lineage differs from the reviewed signer order");
    for (var certificate : certs) {
      var capabilities = approved.getSignerCapabilities(certificate);
      require(capabilities.hasInstalledData() && !capabilities.hasRollback()
          && !capabilities.hasSharedUid() && !capabilities.hasAuth()
          && capabilities.hasPermission() == (preservePermissions && certificate.equals(certs.getFirst())),
          "Migration capabilities differ from the reviewed data and permission continuity policy");
    }
    return approved;
  }

  private static void requireSignedRotation(VerifiedApk replacement, SigningCertificateLineage approved) {
    var signature = replacement.signature();
    require(signature.isVerifiedUsingV3Scheme() && !signature.isVerifiedUsingV31Scheme()
        && !signature.isVerifiedUsingV1Scheme() && !signature.isVerifiedUsingV2Scheme()
        && !signature.isVerifiedUsingV4Scheme(), "Migration replacement must verify using v3 only");
    var embedded = signature.getSigningCertificateLineage();
    require(embedded != null && Arrays.equals(approved.encodeSigningCertificateLineage(),
        embedded.encodeSigningCertificateLineage()), "Replacement APK does not carry the reviewed lineage");
  }

  private static void verifySigningOutput(String[] args, boolean preservePermissions) throws Exception {
    require(args.length == 10, "Expected output APK, lineage, their digests, old signer, new signer, package and API bounds");
    for (int i = 3; i <= 6; i++) require(args[i].matches("[0-9a-f]{64}"), "Invalid SHA-256 pin");
    require(!args[5].equals(args[6]), "Migration needs distinct signer pins");
    int minApi = Integer.parseInt(args[8]), maxApi = Integer.parseInt(args[9]);
    require(minApi == 29 && maxApi == 37, "Signing output must be verified for Android API 29 through 37");
    var approved = reviewedLineage(Path.of(args[2]), args[4], args[5], args[6], preservePermissions);
    Path signed = Path.of(args[1]);
    require(Files.isRegularFile(signed, LinkOption.NOFOLLOW_LINKS), "APK must be a regular file");
    long version = 0;
    try (var file = FileChannel.open(signed, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
      for (int api = minApi; api <= maxApi; api++) {
        var replacement = verify(file, args[3], args[7], api);
        require(replacement.certificate().equals(args[6]), "Active signer differs from the reviewed successor");
        requireSignedRotation(replacement, approved);
        version = replacement.version();
      }
    }
    System.out.printf("{\"verified\":true,\"minApi\":%d,\"maxApi\":%d,\"versionCode\":%d}%n",
        minApi, maxApi, version);
  }

  public static void main(String[] args) throws Exception {
    boolean preservePermissions = args.length > 0 && args[args.length - 1].equals("--preserve-signature-permissions");
    if (preservePermissions) args = Arrays.copyOf(args, args.length - 1);
    if (args.length > 0 && args[0].equals("--reviewed-lineage")) {
      require(args.length == 5, "Expected lineage file, lineage digest and old/new signer digests");
      for (int i = 2; i <= 4; i++) require(args[i].matches("[0-9a-f]{64}"), "Invalid SHA-256 pin");
      require(!args[3].equals(args[4]), "Migration needs distinct signer pins");
      reviewedLineage(Path.of(args[1]), args[2], args[3], args[4], preservePermissions);
      return;
    }
    if (args.length > 0 && args[0].equals("--signed-output")) {
      verifySigningOutput(args, preservePermissions);
      return;
    }
    require(args.length == 10,
        "Expected installed APK, replacement APK, lineage, their three digests, old signer, new signer, package and API");
    for (int i = 3; i <= 7; i++) require(args[i].matches("[0-9a-f]{64}"), "Invalid SHA-256 pin");
    require(!args[6].equals(args[7]), "Migration needs distinct signer pins");
    int api = Integer.parseInt(args[9]);
    require(api >= 29 && api <= 37, "Migration is outside the verified Android API range");
    var approved = reviewedLineage(Path.of(args[2]), args[5], args[6], args[7], preservePermissions);
    Path oldApk = Path.of(args[0]), newApk = Path.of(args[1]);
    require(Files.isRegularFile(oldApk, LinkOption.NOFOLLOW_LINKS)
        && Files.isRegularFile(newApk, LinkOption.NOFOLLOW_LINKS), "APKs must be regular files");
    try (var oldFile = FileChannel.open(oldApk, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS);
        var newFile = FileChannel.open(newApk, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
      var installed = verify(oldFile, args[3], args[8], api);
      var replacement = verify(newFile, args[4], args[8], api);
      require(installed.certificate().equals(args[6]) && replacement.certificate().equals(args[7]),
          "Active APK signers differ from the reviewed migration");
      require(replacement.version() > installed.version(), "Replacement versionCode must increase");
      requireSignedRotation(replacement, approved);
      System.out.printf("{\"verified\":true,\"api\":%d,\"installedVersionCode\":%d,\"replacementVersionCode\":%d}%n",
          api, installed.version(), replacement.version());
    }
  }
}
