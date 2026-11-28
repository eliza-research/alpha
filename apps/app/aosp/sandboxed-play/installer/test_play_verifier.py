from pathlib import Path
import base64
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

INSTALLER_ROOT = Path(__file__).resolve().parent
ROOT = INSTALLER_ROOT.parent
BRANDING_SYSTEM_ENTRY = ROOT.parent / 'branding' / 'system-entry'
sys.path.insert(0, str(BRANDING_SYSTEM_ENTRY))

from portable_tools import android_api_jar, java_binary

API = android_api_jar(36)
FORBIDDEN_BINARY_SUFFIXES = {'.apk', '.apex', '.jar', '.dex', '.so', '.vdex', '.odex'}


class SandboxedPlayVerifierTest(unittest.TestCase):
    def test_zero_proprietary_binaries_and_strict_aosp_metadata(self):
        for candidate in ROOT.rglob('*'):
            if candidate.is_file():
                self.assertNotIn(
                    candidate.suffix.lower(),
                    FORBIDDEN_BINARY_SUFFIXES,
                    f'Proprietary/binary artifact forbidden in Git: {candidate}',
                )

        mk = (ROOT / 'sandboxed-play.mk').read_text()
        for pkg in [
            'GmsCompat',
            'GmsCompatLib',
            'GmsCompatConfig',
            'AlphaPlayInstaller',
            'AlphaPlayInstallerPrivappPermissions',
            'AlphaWebViewConfigOverlay',
        ]:
            self.assertIn(pkg, mk)

        bp = (ROOT / 'Android.bp').read_text()
        self.assertIn('name: "AlphaWebViewConfigOverlay"', bp)
        self.assertIn('name: "AlphaPlayInstallerPrivappPermissions"', bp)
        self.assertIn('name: "AlphaPlayInstaller"', bp)
        self.assertIn('product_specific: true', bp)

        privapp = ET.fromstring((ROOT / 'privapp-permissions-alpha-play.xml').read_text())
        blocks = privapp.findall('privapp-permissions')
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0].attrib['package'], 'ai.alphacompute.playinstaller')
        self.assertNotIn('com.google.android', (ROOT / 'privapp-permissions-alpha-play.xml').read_text())
        self.assertNotIn('com.android.vending', (ROOT / 'privapp-permissions-alpha-play.xml').read_text())
        granted = {node.attrib['name'] for node in blocks[0].findall('permission')}
        self.assertEqual(granted, {
            'android.permission.INSTALL_PACKAGES',
            'android.permission.DELETE_PACKAGES',
            'android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION',
        })

        pin = json.loads((ROOT / 'gmscompat-pin.json').read_text())
        self.assertEqual(pin['schemaVersion'], 1)
        self.assertEqual(pin['androidRelease'], '17')
        self.assertTrue(pin['failClosed'])
        self.assertFalse(pin['proprietaryBinariesInRepo'])
        self.assertTrue(pin['verificationPolicy']['failClosed'])
        self.assertFalse(pin['verificationPolicy']['allowUnverifiedFallback'])
        self.assertTrue(pin['verificationPolicy']['requireZeroPrivAppGrantsForGoogle'])
        self.assertEqual(pin['verificationPolicy']['targetPartitionForGoogleApps'], '/data/app')
        self.assertEqual(
            pin['installOrder'],
            ['com.google.android.gsf', 'com.google.android.gms', 'com.android.vending'],
        )
        for repo_name in ['GmsCompat', 'GmsCompatConfig', 'frameworksBaseGmsCompat']:
            repo = pin['repositories'][repo_name]
            self.assertTrue(repo['url'].startswith('https://github.com/GrapheneOS/'))
            self.assertRegex(repo['commit'], r'^[0-9a-f]{40}$')
            self.assertGreater(len(repo['verifiedFiles']), 0)
            for item in repo['verifiedFiles']:
                self.assertRegex(item['sha256'], r'^[0-9a-f]{64}$')

        webview_xml = ET.fromstring(
            (ROOT / 'overlay/frameworks/base/core/res/res/xml/config_webview_packages.xml').read_text()
        )
        providers = webview_xml.findall('webviewprovider')
        self.assertEqual(providers[0].attrib['packageName'], 'app.vanadium.webview')
        self.assertEqual(providers[0].attrib['availableByDefault'], 'true')
        google_providers = [p for p in providers if p.attrib['packageName'] == 'com.google.android.webview']
        self.assertEqual(len(google_providers), 1)
        sig_node = google_providers[0].find('signature')
        self.assertIsNotNone(sig_node)
        der_bytes = base64.b64decode(sig_node.text.strip())
        self.assertEqual(
            hashlib.sha256(der_bytes).hexdigest(),
            pin['googleWebViewCertificateSha256'],
        )

        for java_file in (INSTALLER_ROOT / 'src').rglob('*.java'):
            self.assertNotIn('//', java_file.read_text(), f'Inline comment in {java_file}')

    def test_java_compile_and_play_verifier_unit_suite(self):
        self.assertTrue(API.exists(), 'Android API 36 android.jar required')
        with tempfile.TemporaryDirectory(prefix='alpha-play-verifier-') as directory:
            tmp = Path(directory)
            classes_dir = tmp / 'classes'
            classes_dir.mkdir()

            harness = tmp / 'PlayVerifierUnitTest.java'
            harness.write_text('''
package ai.alphacompute.playinstaller;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.util.List;
import java.util.Set;

public final class PlayVerifierUnitTest {
    private static void check(boolean condition, String label) {
        if (!condition) {
            throw new AssertionError("Failed: " + label);
        }
    }

    public static void main(String[] args) throws Exception {
        Path staging = Files.createTempDirectory("alpha-play-apks-");
        Path gsfApk = staging.resolve("gsf-36.apk");
        Path gmsApk = staging.resolve("gms-2510.apk");
        Path vendingApk = staging.resolve("vending-4500.apk");
        byte[] gsfBytes = "official-gsf-apk-payload".getBytes(StandardCharsets.UTF_8);
        byte[] gmsBytes = "official-gms-apk-payload".getBytes(StandardCharsets.UTF_8);
        byte[] vendingBytes = "official-vending-apk-payload".getBytes(StandardCharsets.UTF_8);
        Files.write(gsfApk, gsfBytes);
        Files.write(gmsApk, gmsBytes);
        Files.write(vendingApk, vendingBytes);

        String googleCert = PlayPackageVerifier.OFFICIAL_GOOGLE_SIGNER_SHA256;
        String attackerCert = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

        var gsfEntry = new PlayPackageVerifier.PlayPackageEntry(
                PlayPackageVerifier.PACKAGE_GSF, 36L, "gsf-36.apk",
                PlayPackageVerifier.sha256File(gsfApk), googleCert, gsfBytes.length);
        var gmsEntry = new PlayPackageVerifier.PlayPackageEntry(
                PlayPackageVerifier.PACKAGE_GMS, 2510L, "gms-2510.apk",
                PlayPackageVerifier.sha256File(gmsApk), googleCert, gmsBytes.length);
        var vendingEntry = new PlayPackageVerifier.PlayPackageEntry(
                PlayPackageVerifier.PACKAGE_VENDING, 4500L, "vending-4500.apk",
                PlayPackageVerifier.sha256File(vendingApk), googleCert, vendingBytes.length);

        var validManifest = new PlayPackageVerifier.PlayReleaseManifest(
                1, "stable", 1790000000L, List.of(gsfEntry, gmsEntry, vendingEntry));
        check(PlayPackageVerifier.verifyManifest(validManifest).ok(), "valid manifest passes");

        KeyPairGenerator keyGen = KeyPairGenerator.getInstance("Ed25519");
        KeyPair keyPair = keyGen.generateKeyPair();
        byte[] manifestPayload = "canonical-sandboxed-play-manifest-v1".getBytes(StandardCharsets.UTF_8);
        Signature signer = Signature.getInstance("Ed25519");
        signer.initSign(keyPair.getPrivate());
        signer.update(manifestPayload);
        byte[] validSig = signer.sign();
        check(PlayPackageVerifier.verifyManifestSignature(manifestPayload, validSig, keyPair.getPublic()).ok(),
                "valid Ed25519 signature passes");

        byte[] badSig = validSig.clone();
        badSig[0] ^= 0x01;
        check(!PlayPackageVerifier.verifyManifestSignature(manifestPayload, badSig, keyPair.getPublic()).ok(),
                "tampered Ed25519 signature rejected");

        var validGsfFacts = new PlayPackageVerifier.ApkArchiveFacts(
                PlayPackageVerifier.PACKAGE_GSF, 36L, false, List.of(googleCert));
        check(PlayPackageVerifier.verifyApk(gsfEntry, gsfApk, validGsfFacts).ok(),
                "valid GSF APK passes");

        var attackerFacts = new PlayPackageVerifier.ApkArchiveFacts(
                PlayPackageVerifier.PACKAGE_GSF, 36L, false, List.of(attackerCert));
        var certMismatch = PlayPackageVerifier.verifyApk(gsfEntry, gsfApk, attackerFacts);
        check(!certMismatch.ok() && "SIGNING_CERT_MISMATCH".equals(certMismatch.failureCode()),
                "non-Google signing cert rejected");

        var multiSignerFacts = new PlayPackageVerifier.ApkArchiveFacts(
                PlayPackageVerifier.PACKAGE_GSF, 36L, true, List.of(googleCert, attackerCert));
        var multiSigner = PlayPackageVerifier.verifyApk(gsfEntry, gsfApk, multiSignerFacts);
        check(!multiSigner.ok() && "MULTIPLE_SIGNERS_REFUSED".equals(multiSigner.failureCode()),
                "multi-signer APK rejected");

        var swappedPkgFacts = new PlayPackageVerifier.ApkArchiveFacts(
                "com.evil.spoof", 36L, false, List.of(googleCert));
        var pkgSwap = PlayPackageVerifier.verifyApk(gsfEntry, gsfApk, swappedPkgFacts);
        check(!pkgSwap.ok() && "PACKAGE_NAME_MISMATCH".equals(pkgSwap.failureCode()),
                "package swap rejected");

        var downgradeFacts = new PlayPackageVerifier.ApkArchiveFacts(
                PlayPackageVerifier.PACKAGE_GSF, 35L, false, List.of(googleCert));
        var downgrade = PlayPackageVerifier.verifyApk(gsfEntry, gsfApk, downgradeFacts);
        check(!downgrade.ok() && "VERSION_DOWNGRADE".equals(downgrade.failureCode()),
                "version downgrade rejected");

        byte[] tamperedBytes = gsfBytes.clone();
        tamperedBytes[0] ^= 0x01;
        Files.write(gsfApk, tamperedBytes);
        var tamperedResult = PlayPackageVerifier.verifyApk(gsfEntry, gsfApk, validGsfFacts);
        check(!tamperedResult.ok() && "APK_DIGEST_MISMATCH".equals(tamperedResult.failureCode()),
                "tampered APK bytes rejected");

        var wrongOrderManifest = new PlayPackageVerifier.PlayReleaseManifest(
                1, "stable", 1790000000L, List.of(gmsEntry, gsfEntry, vendingEntry));
        var wrongOrder = PlayPackageVerifier.verifyManifest(wrongOrderManifest);
        check(!wrongOrder.ok() && "INVALID_INSTALL_ORDER".equals(wrongOrder.failureCode()),
                "GMS before GSF rejected");

        var vendingFirst = PlayPackageVerifier.validateInstallOrder(
                List.of(PlayPackageVerifier.PACKAGE_VENDING, PlayPackageVerifier.PACKAGE_GSF, PlayPackageVerifier.PACKAGE_GMS));
        check(!vendingFirst.ok(), "Play Store first rejected");

        var traversalEntry = new PlayPackageVerifier.PlayPackageEntry(
                PlayPackageVerifier.PACKAGE_GSF, 36L, "../evil.apk",
                gsfEntry.apkSha256(), googleCert, gsfBytes.length);
        var traversalManifest = new PlayPackageVerifier.PlayReleaseManifest(
                1, "stable", 1790000000L, List.of(traversalEntry, gmsEntry, vendingEntry));
        check(!PlayPackageVerifier.verifyManifest(traversalManifest).ok(),
                "path traversal filename rejected");

        var untrustedManifestEntry = new PlayPackageVerifier.PlayPackageEntry(
                PlayPackageVerifier.PACKAGE_GSF, 36L, "gsf-36.apk",
                gsfEntry.apkSha256(), attackerCert, gsfBytes.length);
        var untrustedManifest = new PlayPackageVerifier.PlayReleaseManifest(
                1, "stable", 1790000000L, List.of(untrustedManifestEntry, gmsEntry, vendingEntry));
        check(!PlayPackageVerifier.verifyManifest(untrustedManifest).ok(),
                "non-Google signer in manifest rejected");

        check(PlayPackageVerifier.PACKAGE_GSF.equals(PlayPackageVerifier.nextRequiredPackage(Set.of())),
                "first required package is GSF");
        check(PlayPackageVerifier.PACKAGE_GMS.equals(
                PlayPackageVerifier.nextRequiredPackage(Set.of(PlayPackageVerifier.PACKAGE_GSF))),
                "second required package is GMS");
        check(PlayPackageVerifier.PACKAGE_VENDING.equals(
                PlayPackageVerifier.nextRequiredPackage(Set.of(
                        PlayPackageVerifier.PACKAGE_GSF, PlayPackageVerifier.PACKAGE_GMS))),
                "third required package is Vending");
        check(PlayPackageVerifier.nextRequiredPackage(Set.of(
                PlayPackageVerifier.PACKAGE_GSF,
                PlayPackageVerifier.PACKAGE_GMS,
                PlayPackageVerifier.PACKAGE_VENDING)) == null,
                "complete install returns null");

        System.out.println("PASS sandboxed-play compile and verifier unit suite");
    }
}
''')

            compile_files = [
                str(INSTALLER_ROOT / 'src/ai/alphacompute/playinstaller/PlayPackageVerifier.java'),
                str(INSTALLER_ROOT / 'src/ai/alphacompute/playinstaller/AlphaPlayInstallerService.java'),
                str(harness),
            ]
            compiled = subprocess.run(
                [
                    java_binary('javac'),
                    '--release', '17',
                    '-Xlint:all',
                    '-classpath', str(API),
                    '-d', str(classes_dir),
                    *compile_files,
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            output = subprocess.check_output(
                [
                    java_binary('java'),
                    '-cp', f'{classes_dir}:{API}',
                    'ai.alphacompute.playinstaller.PlayVerifierUnitTest',
                ],
                text=True,
            )
            self.assertIn('PASS sandboxed-play compile and verifier unit suite', output)


if __name__ == '__main__':
    unittest.main(verbosity=2)
