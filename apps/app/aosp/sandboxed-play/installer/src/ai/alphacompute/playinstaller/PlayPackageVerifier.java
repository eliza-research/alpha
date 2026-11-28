package ai.alphacompute.playinstaller;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.PublicKey;
import java.security.Signature;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Verifies Sandboxed Google Play release manifests, Ed25519 metadata signatures,
 * APK SHA-256 digests, official Google signing certificate pinning, and strict
 * GSF -> GMS -> Play Store installation order before any PackageInstaller session
 * is created.
 */
public final class PlayPackageVerifier {
    /** Official Google LLC APK signing certificate SHA-256 for GSF, GMS, and Play Store. */
    public static final String OFFICIAL_GOOGLE_SIGNER_SHA256 =
            "f0fd6c5b410f25cb25c3b53346c8972fae30f8ee7411df910480ad6b2d60db83";

    /** Package ID for Google Services Framework. */
    public static final String PACKAGE_GSF = "com.google.android.gsf";

    /** Package ID for Google Play Services. */
    public static final String PACKAGE_GMS = "com.google.android.gms";

    /** Package ID for Google Play Store. */
    public static final String PACKAGE_VENDING = "com.android.vending";

    /** Strict dependency-ordered installation sequence for Sandboxed Google Play. */
    public static final List<String> REQUIRED_INSTALL_ORDER = List.of(
            PACKAGE_GSF,
            PACKAGE_GMS,
            PACKAGE_VENDING);

    /** Supported release manifest schema version. */
    public static final int SUPPORTED_SCHEMA_VERSION = 1;

    private static final Pattern HEX_SHA256 = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern SAFE_APK_FILENAME = Pattern.compile("^[A-Za-z0-9._-]+\\.apk$");
    private static final int STREAM_BUFFER_BYTES = 64 * 1024;
    private static final long MAX_SINGLE_APK_BYTES = 512L * 1024L * 1024L;

    private PlayPackageVerifier() {}

    /** Single package descriptor inside a signed Sandboxed Google Play manifest. */
    public record PlayPackageEntry(
            String packageName,
            long versionCode,
            String apkFileName,
            String apkSha256,
            String signerSha256,
            long sizeBytes) {}

    /** Verified release manifest describing the three official Google Play packages. */
    public record PlayReleaseManifest(
            int schemaVersion,
            String channel,
            long releaseTimestampEpochSec,
            List<PlayPackageEntry> entries) {}

    /** Extracted archive facts supplied by Android PackageManager or a JVM test harness. */
    public record ApkArchiveFacts(
            String archivePackageName,
            long archiveVersionCode,
            boolean hasMultipleSigners,
            List<String> signerCertificateSha256s) {}

    /** Structured outcome of a verification check. */
    public record VerificationResult(boolean ok, String failureCode, String message) {
        /** Returns a passing verification result. */
        public static VerificationResult pass() {
            return new VerificationResult(true, "", "ok");
        }

        /** Returns a failing verification result with a stable machine-readable code. */
        public static VerificationResult fail(String failureCode, String message) {
            return new VerificationResult(false, failureCode, message);
        }
    }

    /** Verifies an Ed25519 signature over raw manifest bytes against a pinned public key. */
    public static VerificationResult verifyManifestSignature(
            byte[] manifestBytes, byte[] signatureBytes, PublicKey trustedPublicKey) {
        if (manifestBytes == null || manifestBytes.length == 0) {
            return VerificationResult.fail("EMPTY_MANIFEST", "Manifest payload is empty");
        }
        if (signatureBytes == null || signatureBytes.length != 64) {
            return VerificationResult.fail(
                    "INVALID_SIGNATURE_LENGTH", "Ed25519 signature must be 64 bytes");
        }
        if (trustedPublicKey == null) {
            return VerificationResult.fail("MISSING_PUBLIC_KEY", "Trusted public key is required");
        }
        try {
            final Signature verifier = Signature.getInstance("Ed25519");
            verifier.initVerify(trustedPublicKey);
            verifier.update(manifestBytes);
            if (!verifier.verify(signatureBytes)) {
                return VerificationResult.fail(
                        "MANIFEST_SIGNATURE_INVALID", "Manifest Ed25519 signature check failed");
            }
            return VerificationResult.pass();
        } catch (GeneralSecurityException error) {
            return VerificationResult.fail(
                    "MANIFEST_SIGNATURE_ERROR", "Signature verification failed: " + error.getMessage());
        }
    }

    /**
     * Validates a release manifest's schema, exact package set, strict install order,
     * safe filenames, size bounds, and pinned Google signing certificate digest.
     */
    public static VerificationResult verifyManifest(PlayReleaseManifest manifest) {
        if (manifest == null) {
            return VerificationResult.fail("NULL_MANIFEST", "Manifest is null");
        }
        if (manifest.schemaVersion() != SUPPORTED_SCHEMA_VERSION) {
            return VerificationResult.fail(
                    "UNSUPPORTED_SCHEMA",
                    "Expected schemaVersion " + SUPPORTED_SCHEMA_VERSION);
        }
        if (manifest.channel() == null || manifest.channel().isBlank()) {
            return VerificationResult.fail("INVALID_CHANNEL", "Release channel must be non-empty");
        }
        if (manifest.releaseTimestampEpochSec() <= 0L) {
            return VerificationResult.fail(
                    "INVALID_TIMESTAMP", "Release timestamp must be positive");
        }
        final List<PlayPackageEntry> entries = manifest.entries();
        if (entries == null || entries.size() != REQUIRED_INSTALL_ORDER.size()) {
            return VerificationResult.fail(
                    "INVALID_ENTRY_COUNT",
                    "Manifest must contain exactly GSF, GMS, and Play Store entries");
        }
        final List<String> declaredOrder = new ArrayList<>(entries.size());
        final Set<String> seenPackages = new HashSet<>();
        for (PlayPackageEntry entry : entries) {
            if (entry == null || entry.packageName() == null) {
                return VerificationResult.fail("NULL_ENTRY", "Manifest contains a null entry");
            }
            if (!seenPackages.add(entry.packageName())) {
                return VerificationResult.fail(
                        "DUPLICATE_PACKAGE", "Duplicate package entry: " + entry.packageName());
            }
            declaredOrder.add(entry.packageName());
            final VerificationResult entryCheck = validateEntryMetadata(entry);
            if (!entryCheck.ok()) {
                return entryCheck;
            }
        }
        return validateInstallOrder(declaredOrder);
    }

    /** Enforces exact GSF -> GMS -> Play Store installation order. */
    public static VerificationResult validateInstallOrder(List<String> requestedOrder) {
        if (requestedOrder == null || !REQUIRED_INSTALL_ORDER.equals(requestedOrder)) {
            return VerificationResult.fail(
                    "INVALID_INSTALL_ORDER",
                    "Install order must be strictly " + REQUIRED_INSTALL_ORDER);
        }
        return VerificationResult.pass();
    }

    /**
     * Returns the next package required in GSF -> GMS -> Play Store order given the
     * set of packages already verified as installed, or {@code null} when complete.
     */
    public static String nextRequiredPackage(Set<String> alreadyInstalled) {
        final Set<String> installed = alreadyInstalled == null
                ? Collections.emptySet()
                : alreadyInstalled;
        for (String required : REQUIRED_INSTALL_ORDER) {
            if (!installed.contains(required)) {
                return required;
            }
        }
        return null;
    }

    /**
     * Verifies a staged APK file on disk against its manifest entry and extracted
     * package archive facts before installation into {@code /data/app}.
     */
    public static VerificationResult verifyApk(
            PlayPackageEntry entry, Path apkPath, ApkArchiveFacts archiveFacts) {
        final VerificationResult metadataCheck = validateEntryMetadata(entry);
        if (!metadataCheck.ok()) {
            return metadataCheck;
        }
        if (apkPath == null || !Files.isRegularFile(apkPath) || Files.isSymbolicLink(apkPath)) {
            return VerificationResult.fail("APK_UNREADABLE", "APK must be a regular non-symlink file");
        }
        final Path fileName = apkPath.getFileName();
        if (fileName == null || !entry.apkFileName().equals(fileName.toString())) {
            return VerificationResult.fail(
                    "APK_FILENAME_MISMATCH",
                    "Staged APK filename does not match manifest entry " + entry.apkFileName());
        }
        final long actualSize;
        final String actualSha256;
        try {
            actualSize = Files.size(apkPath);
            if (actualSize != entry.sizeBytes()) {
                return VerificationResult.fail(
                        "APK_SIZE_MISMATCH",
                        "Expected " + entry.sizeBytes() + " bytes, observed " + actualSize);
            }
            actualSha256 = sha256File(apkPath);
        } catch (IOException ioError) {
            return VerificationResult.fail("APK_IO_ERROR", "Failed reading APK: " + ioError.getMessage());
        }
        if (!constantTimeHexEquals(entry.apkSha256(), actualSha256)) {
            return VerificationResult.fail(
                    "APK_DIGEST_MISMATCH",
                    "Tampered or corrupted APK digest for " + entry.packageName());
        }
        return verifyArchiveFacts(entry, archiveFacts);
    }

    /** Verifies extracted APK package identity, version floor, and official Google signer cert. */
    public static VerificationResult verifyArchiveFacts(
            PlayPackageEntry entry, ApkArchiveFacts archiveFacts) {
        if (archiveFacts == null) {
            return VerificationResult.fail("MISSING_ARCHIVE_FACTS", "APK archive metadata unavailable");
        }
        if (!Objects.equals(entry.packageName(), archiveFacts.archivePackageName())) {
            return VerificationResult.fail(
                    "PACKAGE_NAME_MISMATCH",
                    "APK declares " + archiveFacts.archivePackageName()
                            + ", expected " + entry.packageName());
        }
        if (archiveFacts.archiveVersionCode() < entry.versionCode()) {
            return VerificationResult.fail(
                    "VERSION_DOWNGRADE",
                    "APK versionCode " + archiveFacts.archiveVersionCode()
                            + " is below manifest floor " + entry.versionCode());
        }
        if (archiveFacts.hasMultipleSigners()) {
            return VerificationResult.fail(
                    "MULTIPLE_SIGNERS_REFUSED",
                    "APK must be signed solely by official Google signing certificate");
        }
        final List<String> certs = archiveFacts.signerCertificateSha256s();
        if (certs == null || certs.size() != 1) {
            return VerificationResult.fail(
                    "INVALID_SIGNER_COUNT", "APK must expose exactly one signing certificate");
        }
        final String observedCert = normalizeHex(certs.get(0));
        if (!HEX_SHA256.matcher(observedCert).matches()
                || !constantTimeHexEquals(OFFICIAL_GOOGLE_SIGNER_SHA256, observedCert)) {
            return VerificationResult.fail(
                    "SIGNING_CERT_MISMATCH",
                    "APK signer does not match pinned official Google certificate");
        }
        return VerificationResult.pass();
    }

    /** Computes the lowercase hex SHA-256 digest of a regular file. */
    public static String sha256File(Path path) throws IOException {
        final MessageDigest digest = sha256Digest();
        final byte[] buffer = new byte[STREAM_BUFFER_BYTES];
        try (InputStream input = Files.newInputStream(path)) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        return toHex(digest.digest());
    }

    /** Computes the lowercase hex SHA-256 digest of raw bytes such as DER certificate bytes. */
    public static String sha256Bytes(byte[] bytes) {
        final MessageDigest digest = sha256Digest();
        return toHex(digest.digest(bytes));
    }

    private static VerificationResult validateEntryMetadata(PlayPackageEntry entry) {
        if (!REQUIRED_INSTALL_ORDER.contains(entry.packageName())) {
            return VerificationResult.fail(
                    "UNKNOWN_PACKAGE", "Package is not part of Sandboxed Google Play: " + entry.packageName());
        }
        if (entry.versionCode() <= 0L) {
            return VerificationResult.fail("INVALID_VERSION", "versionCode must be positive");
        }
        if (entry.apkFileName() == null
                || entry.apkFileName().contains("..")
                || !SAFE_APK_FILENAME.matcher(entry.apkFileName()).matches()) {
            return VerificationResult.fail(
                    "UNSAFE_FILENAME", "Unsafe APK filename: " + entry.apkFileName());
        }
        if (entry.sizeBytes() <= 0L || entry.sizeBytes() > MAX_SINGLE_APK_BYTES) {
            return VerificationResult.fail("INVALID_SIZE", "APK size outside permitted bounds");
        }
        final String expectedApkHash = normalizeHex(entry.apkSha256());
        if (!HEX_SHA256.matcher(expectedApkHash).matches()) {
            return VerificationResult.fail("INVALID_APK_SHA256", "Malformed APK SHA-256 digest");
        }
        final String expectedSigner = normalizeHex(entry.signerSha256());
        if (!HEX_SHA256.matcher(expectedSigner).matches()
                || !constantTimeHexEquals(OFFICIAL_GOOGLE_SIGNER_SHA256, expectedSigner)) {
            return VerificationResult.fail(
                    "UNTRUSTED_MANIFEST_SIGNER",
                    "Manifest entry signer must match pinned official Google certificate");
        }
        return VerificationResult.pass();
    }

    private static MessageDigest sha256Digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    private static String normalizeHex(String raw) {
        return raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
    }

    private static boolean constantTimeHexEquals(String expectedHex, String actualHex) {
        final byte[] expected = hexToBytes(normalizeHex(expectedHex));
        final byte[] actual = hexToBytes(normalizeHex(actualHex));
        if (expected == null || actual == null) {
            return false;
        }
        return MessageDigest.isEqual(expected, actual);
    }

    private static byte[] hexToBytes(String hex) {
        if (hex == null || (hex.length() & 1) != 0) {
            return null;
        }
        final int length = hex.length() / 2;
        final byte[] out = new byte[length];
        for (int index = 0; index < length; index++) {
            final int high = Character.digit(hex.charAt(index * 2), 16);
            final int low = Character.digit(hex.charAt(index * 2 + 1), 16);
            if (high < 0 || low < 0) {
                return null;
            }
            out[index] = (byte) ((high << 4) | low);
        }
        return out;
    }

    private static String toHex(byte[] bytes) {
        final StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            builder.append(Character.forDigit((value >> 4) & 0xf, 16));
            builder.append(Character.forDigit(value & 0xf, 16));
        }
        return builder.toString();
    }
}
