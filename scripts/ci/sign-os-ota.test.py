"""Real ZIP admission fixtures. These do not sign or qualify an OS image."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("os_signer", Path(__file__).with_name("sign-os-ota.py"))
ota = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ota)


class OSAdmission(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="alpha-os-admission-")
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        previous = ota.ROOT
        ota.ROOT = self.root
        self.addCleanup(setattr, ota, "ROOT", previous)
        self.signers = {"Settings.apk": {"certificate": "security/platform.x509.pem", "private_key": "security/platform.pk8"}}
        self.avb = {"avb_vbmeta_key_path": "security/avb.pem", "avb_vbmeta_algorithm": "SHA256_RSA4096"}
        canonical = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        self.pin = {"schema": 1, "qualified": True, "sha256": "a" * 64, "sdkCommit": "b" * 40,
                    "allowedProducerCommits": ["c" * 40], "apkSignerMappingsSha256": canonical(self.signers),
                    "avbKeyConfigurationSha256": canonical(self.avb)}
        directory = self.root / "android/signing"
        directory.mkdir(parents=True)
        def obj(prefix, sha):
            return {"bucket": ota.STORAGE.BUCKET, "object": f"unsigned/{prefix}/{sha}.zip", "generation": "123", "bytes": 100, "sha256": sha}
        self.plan = {"schema": "alpha-preserving-os-ota-signing/v1", "purpose": "pilot-no-platform-key-rotation",
                     "sourceCommit": "c" * 40, "sdkCommit": "b" * 40, "targetFiles": obj("os", "d" * 64),
                     "otaTools": obj("os-tools", "a" * 64), "outputObject": "signed/os-ota/" + "d" * 64 + "/" + "e" * 32 + "/ota.zip",
                     "product": "alpha_stallion_phone", "device": "stallion",
                     "targetFingerprint": "Alpha/alpha_stallion_phone/stallion:17/CP2A/pilot:userdebug/test-keys", "buildTimestamp": 1000}
        self.reviewed_target = self.target("reviewed-target.zip")
        self.bind_target(self.plan, self.reviewed_target)
        self.pin["reviewedTargets"] = [{"targetFilesSha256": self.plan["targetFiles"]["sha256"],
                                       **{field: self.plan[field] for field in
                                          ("sourceCommit", "sdkCommit", "targetFingerprint", "buildTimestamp")}}]
        (directory / "ota-tools.json").write_text(json.dumps(self.pin))

    def bind_target(self, plan, file):
        sha = ota.digest(file)
        plan["targetFiles"].update(sha256=sha, bytes=file.stat().st_size, object=f"unsigned/os/{sha}.zip")
        plan["outputObject"] = f"signed/os-ota/{sha}/" + "e" * 32 + "/ota.zip"

    def target(self, name, changes=None):
        entries = {"META/misc_info.txt": "ab_update=true\navb_vbmeta_key_path=security/avb.pem\navb_vbmeta_algorithm=SHA256_RSA4096\n",
                   "META/ab_partitions.txt": "boot\nsystem\n",
                   "META/apkcerts.txt": 'name="Settings.apk" certificate="security/platform.x509.pem" private_key="security/platform.pk8"\n',
                   "META/apexkeys.txt": 'name="com.android.runtime.apex" public_key="security/apex.avbpubkey" private_key="security/apex.pem"\n',
                   "security/platform.x509.pem": "Synthetic fixture certificate bytes, not a real certificate",
                   "IMAGES/vbmeta.img": "Synthetic fixture AVB bytes, not an image",
                   "SYSTEM/build.prop": "ro.system.build.fingerprint=Android/generic_system/generic:17/fixture\nro.system.build.date.utc=1000\n",
                   "PRODUCT/etc/build.prop": "ro.product.build.fingerprint=" + self.plan["targetFingerprint"] + "\nro.product.build.date.utc=1000\n"}
        entries.update(changes or {})
        file = self.root / name
        with zipfile.ZipFile(file, "w") as archive:
            for member, data in entries.items(): archive.writestr(member, data)
        return file

    def test_bound_plan_and_preserved_signer_target(self):
        ota.validate(self.plan)
        ota.inspect_target(self.reviewed_target, self.plan, self.pin)

    def test_foreign_or_unbounded_plans_are_refused(self):
        for field, value in [("purpose", "production"), ("sourceCommit", "f" * 40), ("device", "other"),
                             ("buildTimestamp", True), ("outputObject", "signed/other.zip")]:
            plan = {**self.plan, field: value}
            with self.subTest(field=field), self.assertRaises(ValueError): ota.validate(plan)
        for field, value in [("bucket", "foreign"), ("object", "unsigned/os/other.zip"), ("generation", ""),
                             ("bytes", True), ("bytes", 13 * 1024**3)]:
            plan = copy.deepcopy(self.plan);plan["targetFiles"][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): ota.validate(plan)

    def test_unconfigured_target_admission_is_closed(self):
        pin_file = self.root / "android/signing/ota-tools.json"
        for reviewed in (None, []):
            pin = copy.deepcopy(self.pin)
            if reviewed is None: pin.pop("reviewedTargets")
            else: pin["reviewedTargets"] = reviewed
            pin_file.write_text(json.dumps(pin))
            with self.subTest(reviewed=reviewed), self.assertRaisesRegex(ValueError, "No reviewed target-files"):
                ota.validate(self.plan)

    def test_exact_target_is_bound_to_source_sdk_fingerprint_and_timestamp(self):
        pin_file = self.root / "android/signing/ota-tools.json"
        for field, value in [("sourceCommit", "f" * 40), ("sdkCommit", "f" * 40),
                             ("targetFingerprint", self.plan["targetFingerprint"] + "-other"),
                             ("buildTimestamp", self.plan["buildTimestamp"] + 1)]:
            pin = copy.deepcopy(self.pin)
            pin["reviewedTargets"][0][field] = value
            pin_file.write_text(json.dumps(pin))
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "lineage"):
                ota.validate(self.plan)

    def test_changed_apex_certificate_or_vbmeta_cannot_copy_reviewed_metadata(self):
        for i, change in enumerate([
            {"META/apexkeys.txt": 'name="com.android.runtime.apex" public_key="foreign.avbpubkey" private_key="foreign.pem"\n'},
            {"security/platform.x509.pem": "Foreign synthetic certificate bytes"},
            {"IMAGES/vbmeta.img": "Foreign synthetic boot trust bytes"},
        ]):
            file = self.target(f"metadata-copy-{i}.zip", change)
            plan = copy.deepcopy(self.plan)
            self.bind_target(plan, file)
            # These metadata-only checks intentionally cannot prove image identity.
            ota.inspect_target(file, plan, self.pin)
            with self.subTest(case=i), self.assertRaisesRegex(ValueError, "lineage"):
                ota.validate(plan)

    def test_data_partitions_hooks_signer_changes_and_wrong_build_are_refused(self):
        changes = [{"META/ab_partitions.txt": "boot\nuserdata\n"}, {"META/releasetools.py": "raise RuntimeError('fixture hook')"},
                   {"META/apkcerts.txt": 'name="Settings.apk" certificate="foreign.x509.pem" private_key="foreign.pk8"\n'},
                   {"PRODUCT/etc/build.prop": "ro.product.build.fingerprint=foreign\nro.product.build.date.utc=1000\n"}]
        for i, change in enumerate(changes):
            with self.subTest(case=i), self.assertRaises(ValueError):
                ota.inspect_target(self.target(f"refused-{i}.zip", change), self.plan, self.pin)

    def test_tool_traversal_is_refused_without_writing_outside_workspace(self):
        archive = self.root / "tools.zip"
        with zipfile.ZipFile(archive, "w") as z: z.writestr("../outside", "untrusted fixture")
        with self.assertRaises(ValueError): ota.extract_tools(archive, self.root / "tools")
        self.assertFalse((self.root / "outside").exists())


if __name__ == "__main__": unittest.main()
