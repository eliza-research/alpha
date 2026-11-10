"""Disposable OpenSSL fixtures for the release custody proof."""

import base64
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    "release_custody_proof", Path(__file__).with_name("release-custody-proof.py")
)
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)


def tar_gz(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for name, data in files.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            archive.addfile(entry, io.BytesIO(data))
    return output.getvalue()


class ReleaseCustodyProof(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        scratch = tempfile.TemporaryDirectory(prefix="alpha-custody-test-")
        cls.addClassCleanup(scratch.cleanup)
        cls.root = Path(scratch.name)
        cls.tmpfs = cls.root / "ephemeral"
        cls.tmpfs.mkdir()
        cls.os_password = "disposable-os-fixture"
        cls.app_password = "disposable-app-fixture"
        cls.files = {}
        keys = []
        digests = {}
        for name in (*proof.OS_CERTS, *proof.AVB_KEYS, "alphaphone_app"):
            private = proof.openssl("genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048")
            if name in proof.AVB_KEYS:
                public = proof.openssl("pkey", "-pubout", data=private)
                public_der = proof.openssl("pkey", "-pubin", "-outform", "DER", data=public)
                metadata = proof.avb_metadata(public_der, 2048)
                cls.files[f"{name}.pub.pem"] = public
                cls.files[f"{name}.avbpubkey"] = metadata
                cls.files[f"{name}.pem.enc"] = cls.encrypt(private, "PEM")
                kind, digest_type, digest = "avb-rsa", "avbPublicKeySha256", proof.sha256(metadata)
                if name == "avb":
                    cls.files["avb_pkmd.bin"] = metadata
            else:
                # No real key paths are opened. This scratch key was just generated.
                temp_private = cls.root / "disposable.pem"
                temp_private.write_bytes(private)
                certificate = proof.openssl(
                    "req", "-new", "-x509", "-key", str(temp_private), "-subj", f"/CN=Fixture {name}", "-days", "1",
                )
                kind, digest_type = "x509-pk8", "certificateSha256"
                _, digest = proof.certificate_identity(certificate)
                if name == "alphaphone_app":
                    cls.app_store = proof.openssl(
                        "pkcs12", "-export", "-name", proof.KEYSTORE_ALIAS,
                        "-inkey", str(temp_private), "-passout", "env:ALPHA_PROOF_PASSWORD",
                        data=certificate, password=cls.app_password,
                    )
                else:
                    cls.files[f"{name}.x509.pem"] = certificate
                    cls.files[f"{name}.pk8.enc"] = cls.encrypt(private, "DER")
            keys.append({"name": name, "kind": kind, digest_type: digest})
            digests[name] = digest
        # Actual split layout carries the OS ceremony plus the separately uploaded app key.
        cls.files["fingerprints.json"] = json.dumps({
            "schemaVersion": 1, "testKeys": False, "keys": keys[:-1],
        }).encode()
        cls.write("android/signing/os-custody-expected.json", {
            "schemaVersion": 1,
            "osCertificateSha256": {key: digests[key] for key in proof.OS_CERTS},
            "avbPublicKeySha256": digests["avb"],
            "appSignerSha256": digests["alphaphone_app"],
        })
        cls.write("android/release-signer.json", {"signerSha256": digests["alphaphone_app"]})
        cls.write("android/signing/alpha-key-manifest.json", {
            "keys": [{"name": key["name"], "bits": 2048} for key in keys],
        })

    @classmethod
    def encrypt(cls, private, encoding):
        return proof.openssl(
            "pkcs8", "-topk8", "-scrypt", "-outform", encoding,
            "-passout", "env:ALPHA_PROOF_PASSWORD", data=private, password=cls.os_password,
        )

    @classmethod
    def write(cls, name, value):
        file = cls.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(json.dumps(value))

    def verify(self, files, app_password=None):
        compressed = tar_gz(files)
        split = len(compressed) // 2
        values = (
            base64.b64encode(compressed[:split]).decode(),
            base64.b64encode(compressed[split:]).decode(),
            self.os_password,
            base64.b64encode(self.app_store).decode(),
            app_password or self.app_password,
        )
        try:
            return proof.verify(self.root, self.tmpfs, dict(zip(proof.SECRET_NAMES, values)))
        finally:
            self.assertEqual(list(self.tmpfs.iterdir()), [])

    def test_all_disposable_key_pairs(self):
        result = self.verify(self.files)
        self.assertEqual(result["keyPairsVerified"], 12)
        self.assertFalse(result["signedImageProduced"])
        self.assertFalse(result["deviceQualified"])
        expected = {entry["name"]: entry for entry in json.loads(self.files["fingerprints.json"])["keys"]}
        self.assertEqual(result["apexPayloadAvbPublicKeySha256"], expected["apex_payload"]["avbPublicKeySha256"])
        self.assertEqual(set(result), {"schemaVersion", "sourceCommit", "osCertificateSha256", "avbPublicKeySha256", "apexPayloadAvbPublicKeySha256", "appSignerSha256", "keyPairsVerified", "signedImageProduced", "deviceQualified"})

    def test_wrong_os_pair_fails(self):
        swapped = {**self.files, "releasekey.pk8.enc": self.files["platform.pk8.enc"]}
        with self.assertRaises(ValueError):
            self.verify(swapped)

    def test_wrong_app_password_fails(self):
        with self.assertRaises(proof.subprocess.CalledProcessError):
            self.verify(self.files, app_password="unrelated-fixture-password")

    def test_tar_extra_duplicate_and_link_fail(self):
        with self.assertRaises(ValueError):
            self.verify({**self.files, "../outside": b"unexpected"})
        for duplicate in (True, False):
            output = io.BytesIO()
            with tarfile.open(fileobj=output, mode="w:gz") as archive:
                entry = tarfile.TarInfo("fingerprints.json")
                if duplicate:
                    entry.size = 1
                    archive.addfile(entry, io.BytesIO(b"x"))
                    archive.addfile(entry, io.BytesIO(b"x"))
                else:
                    entry.type = tarfile.SYMTYPE
                    entry.linkname = "../outside"
                    archive.addfile(entry)
            with self.assertRaises(ValueError):
                proof.archive_entries(output.getvalue())


if __name__ == "__main__":
    unittest.main()
