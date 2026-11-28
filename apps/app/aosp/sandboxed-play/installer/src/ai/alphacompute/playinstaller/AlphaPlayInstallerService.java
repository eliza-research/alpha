package ai.alphacompute.playinstaller;

import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Binder;
import android.os.IBinder;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Privileged installer service that stages user-requested Sandboxed Google Play
 * packages strictly in GSF -> GMS -> Play Store order as unprivileged /data/app
 * user applications via PackageInstaller.Session after cryptographic verification.
 */
public final class AlphaPlayInstallerService extends Service {
    /** Broadcast action delivered back to this package upon PackageInstaller commit. */
    public static final String ACTION_INSTALL_COMMIT_RESULT =
            "ai.alphacompute.playinstaller.ACTION_INSTALL_COMMIT_RESULT";

    /** Sole authorized requester package name. */
    public static final String ALPHA_PACKAGE = "ai.alphacompute.alphaphone";

    /** SHA-256 certificate digest of Alpha's canonical release signer. */
    static final byte[] ALPHA_SIGNER_SHA256 = new byte[] {
        (byte) 0xed, (byte) 0xbf, (byte) 0xca, (byte) 0xcb,
        (byte) 0x1d, (byte) 0xa6, (byte) 0x89, (byte) 0x00,
        (byte) 0x8b, (byte) 0xf4, (byte) 0xe7, (byte) 0xd6,
        (byte) 0x75, (byte) 0x17, (byte) 0x6c, (byte) 0x30,
        (byte) 0x2d, (byte) 0xec, (byte) 0xf8, (byte) 0x31,
        (byte) 0x61, (byte) 0xa8, (byte) 0x77, (byte) 0xeb,
        (byte) 0x8b, (byte) 0x1d, (byte) 0xe4, (byte) 0xff,
        (byte) 0xae, (byte) 0x04, (byte) 0x45, (byte) 0xed,
    };

    private static final int COPY_BUFFER_BYTES = 64 * 1024;

    private final LocalBinder localBinder = new LocalBinder();

    /** Local service handle for verified callers. */
    public final class LocalBinder extends Binder {
        /** Returns the hosting installer service after verifying caller identity. */
        public AlphaPlayInstallerService getVerifiedService() {
            enforceAlphaCaller();
            return AlphaPlayInstallerService.this;
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return localBinder;
    }

    /**
     * Verifies every staged APK against {@code manifest} and commits each package in
     * strict GSF -> GMS -> Play Store order into {@code /data/app} as an unprivileged user app.
     */
    public PlayPackageVerifier.VerificationResult installSandboxedPlaySuite(
            PlayPackageVerifier.PlayReleaseManifest manifest, Path stagingDirectory) {
        enforceAlphaCaller();
        final PlayPackageVerifier.VerificationResult manifestResult =
                PlayPackageVerifier.verifyManifest(manifest);
        if (!manifestResult.ok()) {
            return manifestResult;
        }
        if (stagingDirectory == null
                || !Files.isDirectory(stagingDirectory)
                || Files.isSymbolicLink(stagingDirectory)) {
            return PlayPackageVerifier.VerificationResult.fail(
                    "INVALID_STAGING_DIR", "Staging directory is missing or unsafe");
        }
        final Map<String, Path> verifiedPaths = new HashMap<>();
        final List<String> executionOrder = new ArrayList<>();
        for (PlayPackageVerifier.PlayPackageEntry entry : manifest.entries()) {
            final Path candidate = stagingDirectory.resolve(entry.apkFileName()).normalize();
            if (!candidate.startsWith(stagingDirectory.normalize())) {
                return PlayPackageVerifier.VerificationResult.fail(
                        "PATH_ESCAPE", "APK escapes staging directory: " + entry.apkFileName());
            }
            final PlayPackageVerifier.ApkArchiveFacts facts = readArchiveFacts(candidate);
            final PlayPackageVerifier.VerificationResult apkResult =
                    PlayPackageVerifier.verifyApk(entry, candidate, facts);
            if (!apkResult.ok()) {
                return apkResult;
            }
            verifiedPaths.put(entry.packageName(), candidate);
            executionOrder.add(entry.packageName());
        }
        final PlayPackageVerifier.VerificationResult orderResult =
                PlayPackageVerifier.validateInstallOrder(executionOrder);
        if (!orderResult.ok()) {
            return orderResult;
        }
        final Set<String> stagedPackages = new HashSet<>();
        for (PlayPackageVerifier.PlayPackageEntry entry : manifest.entries()) {
            final String expectedNext = PlayPackageVerifier.nextRequiredPackage(stagedPackages);
            if (!entry.packageName().equals(expectedNext)) {
                return PlayPackageVerifier.VerificationResult.fail(
                        "ORDER_INVARIANT_BROKEN",
                        "Expected next install " + expectedNext + ", got " + entry.packageName());
            }
            final PlayPackageVerifier.VerificationResult commitResult =
                    commitUnprivilegedSession(entry, verifiedPaths.get(entry.packageName()));
            if (!commitResult.ok()) {
                return commitResult;
            }
            stagedPackages.add(entry.packageName());
        }
        return PlayPackageVerifier.VerificationResult.pass();
    }

    /** Extracts archive package identity, version code, and SHA-256 signing certificate digests. */
    private PlayPackageVerifier.ApkArchiveFacts readArchiveFacts(Path apkPath) {
        final PackageManager pm = getPackageManager();
        final PackageInfo archive = pm.getPackageArchiveInfo(
                apkPath.toAbsolutePath().toString(),
                PackageManager.GET_SIGNING_CERTIFICATES);
        if (archive == null) {
            return null;
        }
        final SigningInfo signingInfo = archive.signingInfo;
        if (signingInfo == null) {
            return new PlayPackageVerifier.ApkArchiveFacts(
                    archive.packageName,
                    archive.getLongVersionCode(),
                    false,
                    Collections.emptyList());
        }
        final Signature[] signatures = signingInfo.getApkContentsSigners();
        final List<String> digests = new ArrayList<>();
        if (signatures != null) {
            for (Signature signature : signatures) {
                digests.add(PlayPackageVerifier.sha256Bytes(signature.toByteArray()));
            }
        }
        return new PlayPackageVerifier.ApkArchiveFacts(
                archive.packageName,
                archive.getLongVersionCode(),
                signingInfo.hasMultipleSigners(),
                digests);
    }

    /** Commits a single verified APK via PackageInstaller.Session into /data/app. */
    private PlayPackageVerifier.VerificationResult commitUnprivilegedSession(
            PlayPackageVerifier.PlayPackageEntry entry, Path apkPath) {
        final PackageInstaller installer = getPackageManager().getPackageInstaller();
        final PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(entry.packageName());
        params.setInstallLocation(PackageInfo.INSTALL_LOCATION_INTERNAL_ONLY);
        params.setSize(entry.sizeBytes());
        params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);

        int sessionId = -1;
        PackageInstaller.Session session = null;
        try {
            sessionId = installer.createSession(params);
            session = installer.openSession(sessionId);
            try (InputStream input = Files.newInputStream(apkPath);
                    OutputStream output = session.openWrite(
                            entry.packageName() + ".apk", 0L, entry.sizeBytes())) {
                final byte[] buffer = new byte[COPY_BUFFER_BYTES];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                }
                session.fsync(output);
            }
            final Intent callbackIntent = new Intent(ACTION_INSTALL_COMMIT_RESULT)
                    .setPackage(getPackageName());
            final PendingIntent statusReceiver = PendingIntent.getBroadcast(
                    this,
                    sessionId,
                    callbackIntent,
                    PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            session.commit(statusReceiver.getIntentSender());
            return PlayPackageVerifier.VerificationResult.pass();
        } catch (IOException | RuntimeException error) {
            if (session != null) {
                session.abandon();
            } else if (sessionId >= 0) {
                installer.abandonSession(sessionId);
            }
            return PlayPackageVerifier.VerificationResult.fail(
                    "INSTALL_SESSION_FAILED",
                    "Failed staging " + entry.packageName() + ": " + error.getMessage());
        } finally {
            if (session != null) {
                session.close();
            }
        }
    }

    /** Enforces that only the verified preinstalled Alpha system package invokes installation. */
    private void enforceAlphaCaller() {
        final int callingUid = Binder.getCallingUid();
        if (callingUid <= 0) {
            throw new SecurityException("Invalid calling UID");
        }
        final PackageManager pm = getPackageManager();
        final String[] packages = pm.getPackagesForUid(callingUid);
        if (packages == null || packages.length != 1 || !ALPHA_PACKAGE.equals(packages[0])) {
            throw new SecurityException("Caller UID does not belong exclusively to Alpha");
        }
        final PackageInfo info;
        try {
            info = pm.getPackageInfo(
                    ALPHA_PACKAGE,
                    PackageManager.MATCH_SYSTEM_ONLY | PackageManager.GET_SIGNING_CERTIFICATES);
        } catch (PackageManager.NameNotFoundException missing) {
            throw new SecurityException("Preinstalled Alpha package not found", missing);
        }
        if (info == null || info.applicationInfo == null
                || info.applicationInfo.uid != callingUid
                || !info.applicationInfo.enabled) {
            throw new SecurityException("Alpha package UID or enabled state mismatch");
        }
        final int flags = info.applicationInfo.flags;
        final boolean isSystem =
                (flags & (ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP))
                        != 0;
        if (!isSystem || (flags & ApplicationInfo.FLAG_SUSPENDED) != 0) {
            throw new SecurityException("Alpha package must be an active system app");
        }
        if (info.signingInfo == null
                || info.signingInfo.hasMultipleSigners()
                || !pm.hasSigningCertificate(
                        ALPHA_PACKAGE, ALPHA_SIGNER_SHA256, PackageManager.CERT_INPUT_SHA256)) {
            throw new SecurityException("Alpha signing certificate verification failed");
        }
    }
}
