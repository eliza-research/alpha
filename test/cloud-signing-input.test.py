"""Synthetic archive fixtures. No real APK, signing key or provider is accessed."""

import copy
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "cloud_signing_input", ROOT / "scripts/ci/admit-cloud-signing-input.py"
)
ADMISSION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ADMISSION)


class CloudSigningInputTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="alpha-cloud-signing-test-")
        self.addCleanup(self.temporary.cleanup)
        self.archive = Path(self.temporary.name) / "producer.zip"
        self.pin = {
            "alphaCommit": "a" * 40,
            "sdkCommit": "b" * 40,
            "versionCode": 44,
            "unsignedApkSHA256": {},
            "updateChannel": {"kind": "public", "manifestUrlSha256": "c" * 64},
        }
        self.apk_bytes = {}
        rows = []
        for variant in ADMISSION.VARIANTS:
            payload = f"synthetic {variant} APK bytes".encode()
            self.apk_bytes[f"{variant}-release-unsigned.apk"] = payload
            self.pin["unsignedApkSHA256"][variant] = ADMISSION.digest(payload)
            rows.append({
                "variant": variant,
                "mode": "release",
                "file": f"artifacts/{variant}-release-unsigned.apk",
                "packageName": "ai.elizaresearch.alphaphone",
                "versionCode": 44,
                "sha256": ADMISSION.digest(payload),
                "signed": False,
                "signerSha256": None,
                "testMocks": False,
                "debuggable": False,
                "home": variant == "launcher",
                "launcher": True,
                "webPayload": True,
                "runtime": "PACKAGED",
                "runtimeNotices": True,
                "bundleAudit": "passed",
                "licenceBlockers": [],
                "releaseAdmission": {"failures": [], "blockers": ["unsigned release"]},
            })
        self.verification = {
            "upstream": {"commit": self.pin["sdkCommit"]},
            "runtimeProfile": "cloud",
            "testMocks": False,
            "allowUnpackagedRuntime": False,
            "results": rows,
        }
        self.build = {
            "runtimeProfile": "cloud",
            "testMocks": False,
            "signingRequested": False,
            "versionOverride": {"code": "44"},
        }
        self.producer = {"source": self.pin["alphaCommit"], "versionCode": 44, "runtimeProfile": "cloud"}
        for record in [self.verification, self.build, self.producer, *rows]:
            record["updateChannel"] = copy.deepcopy(self.pin["updateChannel"])

    def write_archive(self, entries_update=None, duplicate=None, special=None):
        verification = json.dumps(self.verification).encode()
        build = json.dumps(self.build).encode()
        files = {"artifacts/apk-manifest.json": verification, "artifacts/build-config.json": build}
        self.producer["files"] = {
            name: {"bytes": len(payload), "sha256": ADMISSION.digest(payload)}
            for name, payload in files.items()
        }
        producer = json.dumps(self.producer).encode()
        entries = {
            **self.apk_bytes,
            "producer-evidence/manifest.json": producer,
            "apk-verification.json": verification,
            **{f"producer-evidence/{name}": payload for name, payload in files.items()},
            "apk-manifest.json": json.dumps({
                name: ADMISSION.digest(payload) for name, payload in self.apk_bytes.items()
            }).encode(),
        }
        entries.update(entries_update or {})
        with zipfile.ZipFile(self.archive, "w") as bundle:
            for name, payload in entries.items():
                if name == special:
                    entry = zipfile.ZipInfo(name)
                    entry.create_system = 3
                    entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                    bundle.writestr(entry, payload)
                else:
                    bundle.writestr(name, payload)
            if duplicate:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    bundle.writestr(duplicate, entries[duplicate])
        self.pin["archiveSHA256"] = ADMISSION.digest(self.archive.read_bytes())
        self.pin["producerManifestSHA256"] = ADMISSION.digest(producer)

    def test_admits_both_exact_unsigned_cloud_variants(self):
        self.write_archive()
        self.assertEqual(ADMISSION.admit(self.archive, self.pin), {
            "source": "a" * 40,
            "sdk": "b" * 40,
            "versionCode": 44,
            "updateChannel": self.pin["updateChannel"],
            "unsignedApkSHA256": self.pin["unsignedApkSHA256"],
            "inputVerified": True,
            "signed": False,
        })

    def test_channel_substitution_is_refused_at_each_evidence_boundary(self):
        for boundary in [self.verification, self.build, self.producer, *self.verification["results"]]:
            original = boundary["updateChannel"]
            boundary["updateChannel"] = {"kind": "private-qa", "manifestUrlSha256": "d" * 64}
            self.write_archive()
            with self.assertRaises(ValueError):
                ADMISSION.admit(self.archive, self.pin)
            boundary["updateChannel"] = original

    def test_private_channel_needs_its_reviewed_baseline_purpose(self):
        channel = {"kind": "private-qa", "manifestUrlSha256": "d" * 64}
        for record in [self.pin, self.verification, self.build, self.producer, *self.verification["results"]]:
            record["updateChannel"] = copy.deepcopy(channel)
        self.write_archive()
        with self.assertRaises(ValueError):
            ADMISSION.admit(self.archive, self.pin)
        self.pin["purpose"] = "private-update-qa-baseline"
        self.assertEqual(ADMISSION.admit(self.archive, self.pin)["updateChannel"], channel)

    def test_rejects_changed_archive_or_reviewed_pins(self):
        self.write_archive()
        for field, value in (
            ("archiveSHA256", "0" * 64),
            ("producerManifestSHA256", "0" * 64),
            ("alphaCommit", "c" * 40),
            ("sdkCommit", "c" * 40),
            ("versionCode", 45),
            ("versionCode", True),
            ("unsignedApkSHA256", {"standalone": "0" * 64}),
        ):
            with self.subTest(field=field, value=value):
                pin = {**self.pin, field: value}
                with self.assertRaises(ValueError):
                    ADMISSION.admit(self.archive, pin)

    def test_rejects_changed_apk_bytes_even_with_updated_archive_digest(self):
        self.write_archive({"launcher-release-unsigned.apk": b"replaced APK"})
        with self.assertRaisesRegex(ValueError, "launcher APK bytes differ"):
            ADMISSION.admit(self.archive, self.pin)

    def test_rejects_a_divergent_producer_verification_record(self):
        self.write_archive({"apk-verification.json": b"{}"})
        with self.assertRaisesRegex(ValueError, "verification records differ"):
            ADMISSION.admit(self.archive, self.pin)

    def test_rejects_unbound_build_configuration(self):
        self.write_archive({"producer-evidence/artifacts/build-config.json": b"{}"})
        with self.assertRaisesRegex(ValueError, "does not bind artifacts/build-config.json"):
            ADMISSION.admit(self.archive, self.pin)

    def test_rejects_non_cloud_profiles_and_local_embedding_records(self):
        # This Cloud release requires its own profile and excludes local embedding projection flags.
        for record_name in ("producer", "verification", "build"):
            record = getattr(self, record_name)
            for field, value in (("runtimeProfile", "native"), ("runtimeProfile", "unknown"), ("localEmbeddings", True), ("localEmbeddings", False)):
                with self.subTest(record=record_name, field=field):
                    old = copy.deepcopy(record)
                    record[field] = value
                    self.write_archive()
                    with self.assertRaises(ValueError):
                        ADMISSION.admit(self.archive, self.pin)
                    record.clear()
                    record.update(old)

    def test_rejects_unreviewed_build_flags(self):
        for record, field in ((self.build, "testMocks"), (self.build, "signingRequested"),
                              (self.verification, "testMocks"), (self.verification, "allowUnpackagedRuntime")):
            with self.subTest(field=field):
                record[field] = True
                self.write_archive()
                with self.assertRaises(ValueError):
                    ADMISSION.admit(self.archive, self.pin)
                record[field] = False

    def test_rejects_release_rows_outside_the_unsigned_distribution_contract(self):
        row = self.verification["results"][0]
        baseline = copy.deepcopy(row)
        for field, value in (
            ("signed", True), ("signerSha256", "c" * 64), ("debuggable", True),
            ("testMocks", True), ("home", True), ("launcher", False),
            ("webPayload", False), ("runtime", "NOT_PACKAGED"), ("runtimeNotices", False),
            ("bundleAudit", "failed"), ("packageName", "another.product"),
            ("licenceBlockers", ["unreviewed"]),
            ("releaseAdmission", {"failures": [], "blockers": []}),
        ):
            with self.subTest(field=field):
                row[field] = value
                self.write_archive()
                with self.assertRaises(ValueError):
                    ADMISSION.admit(self.archive, self.pin)
                row.clear()
                row.update(copy.deepcopy(baseline))

    def test_rejects_duplicate_or_missing_release_variants(self):
        rows = self.verification["results"]
        self.verification["results"] = [rows[0], copy.deepcopy(rows[0])]
        self.write_archive()
        with self.assertRaisesRegex(ValueError, "one release row per variant"):
            ADMISSION.admit(self.archive, self.pin)

    def test_rejects_duplicate_and_nonregular_archive_members(self):
        for option in ("duplicate", "special"):
            with self.subTest(option=option):
                self.write_archive(**{option: "launcher-release-unsigned.apk"})
                with self.assertRaises(ValueError):
                    ADMISSION.admit(self.archive, self.pin)

    def test_rejects_a_symlink_archive(self):
        self.write_archive()
        alias = self.archive.with_name("alias.zip")
        alias.symlink_to(self.archive)
        with self.assertRaisesRegex(ValueError, "bounded regular file"):
            ADMISSION.admit(alias, self.pin)


if __name__ == "__main__":
    unittest.main()
