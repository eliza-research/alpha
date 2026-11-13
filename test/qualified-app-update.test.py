"""Controlled receipts, archives and transports; no keys, accounts or publication."""
import base64
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import unittest
import warnings
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/ci"))


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BRIDGE = load("qualified_update", "scripts/ci/qualified-app-update.py")
LAUNCHER = load("qualified_cloud_launcher", "scripts/ci/verify-qualified-cloud-launcher.py")
FIXTURES = load("qualified_producer_fixtures", "test/cloud-signing-input.test.py")


def encoded(record, name, value):
    raw = json.dumps(value).encode()
    record[name + "Base64"] = base64.b64encode(raw).decode()
    record[name + "SHA256"] = BRIDGE.sha(raw)
    return raw


class QualifiedUpdateTest(unittest.TestCase):
    def setUp(self):
        self.producer = FIXTURES.CloudSigningInputTest(methodName="test_admits_both_exact_unsigned_cloud_variants")
        self.producer.setUp()
        self.addCleanup(self.producer.doCleanups)
        self.directory = Path(self.producer.temporary.name)
        self.plan = self.producer.pin
        self.plan.update(producerKind="root-reviewed-private-runner")
        private = {"schema": 1, "producerKind": self.plan["producerKind"],
                   "project": "alpha-aosp-lab-20261024", "instanceId": "8999310923263914877",
                   "alphaCommit": self.plan["alphaCommit"], "sdkCommit": self.plan["sdkCommit"],
                   "versionCode": self.plan["versionCode"], "unsignedApkSHA256": self.plan["unsignedApkSHA256"],
                   "runtimeProfile": "native", "updateChannel": self.plan["updateChannel"],
                   "checks": {name: "passed" for name in ("productSourceGuard", "sdkSourceGuard", "normalPreparation",
                                                         "combinedVerification", "apkArchive")}}
        private_bytes = json.dumps(private).encode()
        self.plan["privateProducerReceiptSHA256"] = BRIDGE.sha(private_bytes)
        extra = {"private-producer.json": private_bytes}
        for variant in BRIDGE.VARIANTS:
            value = (variant + " debug fixture").encode()
            extra[variant + "-debug.apk"] = value
            self.producer.verification["results"].append({"variant": variant, "mode": "debug", "sha256": BRIDGE.sha(value)})
        self.producer.write_archive(extra)
        self.plan["archiveBytes"] = self.producer.archive.stat().st_size
        self.plan["privateStorage"] = {"bucket": BRIDGE.STORAGE.BUCKET,
                                       "inputObject": f"unsigned/{self.plan['archiveSHA256']}.zip", "inputGeneration": "123",
                                       "outputObject": f"signed/{self.plan['archiveSHA256']}/{'d' * 32}/signed-apks.tar"}
        self.signed_apks = {variant: (variant + " signed fixture").encode() for variant in BRIDGE.VARIANTS}
        self.record = {"schema": "alpha-qualified-app-update/v1", "signingWorkflowCommit": "e" * 40,
                       "signingRunId": "100", "signingRunAttempt": 1, "deliveryArtifactId": "200",
                       "signedApkSHA256": {v: BRIDGE.sha(data) for v, data in self.signed_apks.items()}}
        plan_bytes = encoded(self.record, "signingPlan", self.plan)
        voice = {"format": "alpha-cloud-voice-qualification-v1", "results": [
            {"apkSha256": digest, "provider": "cartesia", "outcome": "passed", "checks": {name: True for name in BRIDGE.CHECKS}}
            for digest in self.record["signedApkSHA256"].values()]}
        encoded(self.record, "cloudVoiceEvidence", voice)
        self.signed_entries = {v + "-release.apk": data for v, data in self.signed_apks.items()}
        self.signed_entries.update({"signing-plan.json": plan_bytes, "production-signer.sha256": b"f" * 64 + b"\n",
                                    "signed.sha256": "".join(f"{self.record['signedApkSHA256'][v]}  {v}-release.apk\n" for v in BRIDGE.VARIANTS).encode()})
        self.signed_tar = self.directory / "signed-original.tar"
        self.write_signed()
        self.receipt_zip = self.directory / "delivery-original.zip"
        self.write_delivery_receipt()

    def write_delivery_receipt(self):
        with zipfile.ZipFile(self.receipt_zip, "w") as archive:
            archive.writestr("private-storage-receipt.json", json.dumps(self.record["signedBundle"]))
        self.record["deliveryArtifactBytes"] = self.receipt_zip.stat().st_size
        self.record["deliveryArtifactSHA256"] = BRIDGE.file_sha(self.receipt_zip)

    def use_main_candidate(self, debug=None):
        self.producer.write_candidate(debug)
        self.signed_entries["signing-plan.json"] = encoded(self.record, "signingPlan", self.plan)
        self.write_signed()
        self.write_delivery_receipt()

    def write_signed(self, extra=None):
        entries = {**self.signed_entries, **(extra or {})}
        with tarfile.open(self.signed_tar, "w") as archive:
            for name, content in entries.items():
                item = tarfile.TarInfo(name)
                item.size = len(content)
                archive.addfile(item, io.BytesIO(content))
        self.record["signedBundle"] = {"bucket": BRIDGE.STORAGE.BUCKET,
                                       "object": self.plan["privateStorage"]["outputObject"], "generation": "456",
                                       "bytes": self.signed_tar.stat().st_size, "sha256": BRIDGE.file_sha(self.signed_tar), "public": False}

    def set_signed_launcher(self, payload):
        self.signed_apks["launcher"] = self.signed_entries["launcher-release.apk"] = payload
        self.record["signedApkSHA256"]["launcher"] = BRIDGE.sha(payload)
        self.signed_entries["signed.sha256"] = "".join(
            f"{digest}  {variant}-release.apk\n" for variant, digest in self.record["signedApkSHA256"].items()).encode()
        voice = BRIDGE.decode(base64.b64decode(self.record["cloudVoiceEvidenceBase64"]))
        for row, digest in zip(voice["results"], self.record["signedApkSHA256"].values()):
            row["apkSha256"] = digest
        encoded(self.record, "cloudVoiceEvidence", voice)
        self.write_signed()
        self.write_delivery_receipt()

    def stage_fixture(self, product):
        product.mkdir()
        work = self.directory / "size-stage"
        plan = BRIDGE.preflight(self.record, "f" * 40, work, self.api, self.download)
        BRIDGE.stage(self.record, plan, work, product,
                     lambda _plan, target: shutil.copyfile(self.producer.archive, target),
                     lambda _plan, _receipt, target: shutil.copyfile(self.signed_tar, target),
                     source_root=os.environ.get("ALPHA_NATIVE_SOURCE_ROOT"))

    def use_private_cloud_pair(self):
        payload = b"retained unsigned standalone fixture"
        self.producer.apk_bytes["standalone-release-unsigned.apk"] = payload
        self.plan["unsignedApkSHA256"]["standalone"] = BRIDGE.sha(payload)
        release = copy.deepcopy(next(row for row in self.producer.verification["results"] if row["mode"] == "release"))
        release.update(variant="standalone", file="artifacts/standalone-release-unsigned.apk", home=False, sha256=BRIDGE.sha(payload))
        self.producer.verification["results"].append(release)
        for row in self.producer.verification["results"]:
            if row["mode"] == "release":
                row["packageName"] = "ai.elizaresearch.alphaphone"
        for record in (self.producer.verification, self.producer.build, self.producer.producer):
            record["runtimeProfile"] = "cloud"
        debug = {variant + "-debug.apk": (variant + " debug fixture").encode() for variant in ("standalone", "launcher")}
        self.producer.verification["results"] = [row for row in self.producer.verification["results"] if row["mode"] != "debug"]
        self.producer.verification["results"].extend({"variant": variant, "mode": "debug", "sha256": BRIDGE.sha(debug[variant + "-debug.apk"])}
                                                    for variant in ("standalone", "launcher"))
        private = {"schema": 1, "producerKind": self.plan["producerKind"], "project": "alpha-aosp-lab-20261024",
                   "instanceId": "8999310923263914877", "alphaCommit": self.plan["alphaCommit"],
                   "sdkCommit": self.plan["sdkCommit"], "versionCode": self.plan["versionCode"],
                   "unsignedApkSHA256": self.plan["unsignedApkSHA256"], "runtimeProfile": "cloud",
                   "updateChannel": self.plan["updateChannel"], "checks": {name: "passed" for name in
                   ("productSourceGuard", "sdkSourceGuard", "normalPreparation", "combinedVerification", "apkArchive")}}
        raw = json.dumps(private).encode()
        self.plan["privateProducerReceiptSHA256"] = BRIDGE.sha(raw)
        self.producer.write_archive({**debug, "private-producer.json": raw})
        self.plan["archiveBytes"] = self.producer.archive.stat().st_size
        self.plan["privateStorage"].update(inputObject=f"unsigned/{self.plan['archiveSHA256']}.zip",
                                          outputObject=f"signed/{self.plan['archiveSHA256']}/{'d' * 32}/signed-apks.tar")
        self.signed_entries["signing-plan.json"] = encoded(self.record, "signingPlan", self.plan)
        self.write_signed()
        self.write_delivery_receipt()

    def test_cloud_pair_is_unsigned_verifier_input_but_only_launcher_is_signed_output(self):
        self.use_private_cloud_pair()
        product = self.directory / "retained-cloud"
        self.stage_fixture(product)
        self.assertEqual({file.name for file in (product / "artifacts").glob("*.apk")},
                         {"standalone-release-unsigned.apk", "launcher-release-unsigned.apk", "standalone-debug.apk", "launcher-debug.apk"})
        self.assertEqual((self.directory / "size-stage/signed/launcher-release.apk").read_bytes(), self.signed_apks["launcher"])
        self.assertFalse((self.directory / "size-stage/signed/standalone-release.apk").exists())
        with BRIDGE.signed_bundle(self.signed_tar, self.record["signedBundle"], self.plan,
                                 base64.b64decode(self.record["signingPlanBase64"])) as (_, _, signed):
            self.assertEqual(set(signed), {"launcher"})
        self.record["signedApkSHA256"]["standalone"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "release contract"):
            BRIDGE.validate(self.record)

    def test_cloud_pair_refuses_an_extra_signed_standalone_tar_member(self):
        self.use_private_cloud_pair()
        self.write_signed({"standalone-release.apk": b"must not be a release output"})
        with self.assertRaisesRegex(ValueError, "Unexpected signed bundle members"):
            with BRIDGE.signed_bundle(self.signed_tar, self.record["signedBundle"], self.plan,
                                     base64.b64decode(self.record["signingPlanBase64"])):
                self.fail("retired release output admitted")

    def test_cloud_handoff_retains_raw_inputs_and_derives_only_a_signed_launcher(self):
        payload = SignedLauncherPayloadTest(methodName="test_v3_layout_preserves_every_compressed_entry_and_local_byte")
        payload.setUp()
        self.addCleanup(payload.doCleanups)
        original = payload.unsigned.read_bytes()
        self.producer.apk_bytes["launcher-release-unsigned.apk"] = original
        self.plan["unsignedApkSHA256"]["launcher"] = BRIDGE.sha(original)
        next(row for row in self.producer.verification["results"] if row["mode"] == "release")["sha256"] = BRIDGE.sha(original)
        self.set_signed_launcher(payload.signed.read_bytes())
        lineage = b"synthetic public lineage fixture"
        self.plan["rotation"] = {"lineageBase64": base64.b64encode(lineage).decode(), "lineageSHA256": BRIDGE.sha(lineage)}
        self.signed_entries["rotation.lineage"] = lineage
        self.use_private_cloud_pair()
        product = self.directory / "handoff-product"
        self.stage_fixture(product)
        (product / "upstream.lock.json").write_text(json.dumps({"commit": self.plan["sdkCommit"]}))
        source = self.directory / "admission-source"
        (source / "android").mkdir(parents=True)
        fields = ("alphaCommit", "sdkCommit", "versionCode", "updateChannel", "archiveBytes", "archiveSHA256",
                  "producerManifestSHA256", "privateProducerReceiptSHA256", "unsignedApkSHA256")
        descriptor = {"schema": 1, "signerSha256": "f" * 64, "lastRelease": {"versionCode": None},
                      "apkSigningRotation": {"schema": 1, "approval": "approved", "versionCode": self.plan["versionCode"],
                                             "unsignedApkSHA256": {"launcher": self.plan["unsignedApkSHA256"]["launcher"]},
                                             "lineageSha256": BRIDGE.sha(lineage)},
                      "privateProducerApproval": {"approval": "approved", **{key: self.plan[key] for key in fields}}}
        (source / "android/release-signer.json").write_text(json.dumps(descriptor))
        checked = copy.deepcopy(self.producer.verification)
        checked["signing"] = {"release": {"signed": False}}
        checked["runtimePackaging"] = []
        for row in checked["results"]:
            if row["mode"] == "release":
                row.update(distributable=False, runtimeProfile="cloud", voiceHost={"packaged": False, "differences": []})
                checked["runtimePackaging"].append({"apk": row["file"], "runtime": "PACKAGED", "distributable": True,
                                                   "release": True, "runtimeProfile": "cloud", "runtimeExecution": False,
                                                   "upstreamCommit": self.plan["sdkCommit"]})
        changed = copy.deepcopy(checked)
        changed["runtimePackaging"][0]["distributable"] = False
        with self.assertRaisesRegex(ValueError, "runtime byte verification differs"):
            LAUNCHER.unsigned_release(changed, self.plan)
        calls = []
        def verifier(command, **options):
            calls.append(command)
            self.assertEqual(command[1:], ["run", "android:verify", "--", "--runtime-profile=cloud"])
            self.assertEqual(options["cwd"], product)
            self.assertFalse((product / "artifacts/launcher-release.apk").exists())
            self.assertFalse((product / "artifacts/standalone-release.apk").exists())
            (product / "artifacts/apk-manifest.json").write_text(json.dumps(checked))
        work = self.directory / "size-stage"
        proof = {"verified": True, "minApi": 29, "maxApi": 37, "versionCode": 44}
        # Only the old verifier process and crypto result are closed ports;
        # archive admission, restored files, all ZIP comparisons and voice
        # admission below execute their actual implementations.
        with patch.object(LAUNCHER, "ROOT", source), \
             patch.object(LAUNCHER.subprocess, "check_output", side_effect=lambda command, **options:
                          self.plan["alphaCommit"] if options["cwd"] == product else "e" * 40), \
             patch.object(LAUNCHER, "verify_signature", return_value=proof):
            admission = LAUNCHER.verify(self.record, work, product, run=verifier)
        final = json.loads((product / "artifacts/apk-manifest.json").read_text())
        self.assertEqual(len(calls), 1)
        self.assertEqual([(row["variant"], row["mode"], row["signed"]) for row in final["results"]], [("launcher", "release", True)])
        self.assertEqual(final["evidence"], "alpha-signed-payload-admission")
        self.assertEqual(final["signedPayloadAdmission"]["admissionCommit"], "e" * 40)
        self.assertEqual(admission["producerCommit"], self.plan["alphaCommit"])
        self.assertEqual(admission["sdkCommit"], self.plan["sdkCommit"])
        self.assertEqual(admission["producerVerificationSHA256"], BRIDGE.sha((work / "producer-apk-verification.json").read_bytes()))
        self.assertEqual((work / "producer-apk-verification.json").read_bytes(),
                         json.dumps(self.producer.verification).encode())
        raw = json.loads((work / "unsigned-apk-verification.json").read_text())
        self.assertEqual({row["variant"] for row in raw["results"] if row["mode"] == "release"}, {"standalone", "launcher"})
        self.assertTrue(all(row["signed"] is False for row in raw["results"] if row["mode"] == "release"))
        self.assertEqual((product / "artifacts/launcher-release.apk").read_bytes(), payload.signed.read_bytes())
        self.assertFalse((product / "artifacts/standalone-release.apk").exists())

    def test_cloud_rotation_cannot_reenroll_standalone_as_output(self):
        self.use_private_cloud_pair()
        descriptor = {"apkSigningRotation": {"approval": "approved", "versionCode": 44,
                                             "unsignedApkSHA256": self.plan["unsignedApkSHA256"]}}
        with self.assertRaisesRegex(ValueError, "only this launcher"):
            LAUNCHER.verify_signature(self.record, self.plan, self.directory, self.signed_tar, descriptor)

    def test_cloud_signature_handoff_pins_tools_lineage_signer_and_all_android_apis(self):
        self.use_private_cloud_pair()
        lineage = b"synthetic public lineage fixture"
        self.plan["rotation"] = {"lineageBase64": base64.b64encode(lineage).decode(), "lineageSHA256": BRIDGE.sha(lineage)}
        self.signed_entries["rotation.lineage"] = lineage
        self.signed_entries["signing-plan.json"] = encoded(self.record, "signingPlan", self.plan)
        self.write_signed()
        sdk = self.directory / "sdk"
        tools = sdk / "build-tools/36.0.0"
        (tools / "lib").mkdir(parents=True)
        (tools / "apksigner").write_bytes(b"pinned controlled apksigner")
        jar = tools / "lib/apksigner.jar"
        jar.write_bytes(b"pinned controlled verification jar")
        fields = ("alphaCommit", "sdkCommit", "versionCode", "updateChannel", "archiveBytes", "archiveSHA256",
                  "producerManifestSHA256", "privateProducerReceiptSHA256", "unsignedApkSHA256")
        descriptor = {"signerSha256": "f" * 64,
                      "privateProducerApproval": {"approval": "approved", **{key: self.plan[key] for key in fields}},
                      "apkSigningRotation": {"schema": 1, "approval": "approved", "versionCode": 44,
                        "unsignedApkSHA256": {"launcher": self.plan["unsignedApkSHA256"]["launcher"]},
                        "lineageSha256": BRIDGE.sha(lineage), "previousSignerSha256": "e" * 64,
                        "apksignerSha256": BRIDGE.file_sha(tools / "apksigner"), "verifierJarSha256": BRIDGE.file_sha(jar),
                        "preserveSignaturePermissions": True}}
        proof = {"verified": True, "minApi": 29, "maxApi": 37, "versionCode": 44}
        calls = []
        def port(command, **options):
            calls.append(command)
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps(proof).encode())
        def invoke(label):
            work = self.directory / label
            work.mkdir()
            shutil.copyfile(self.signed_tar, work / "signed.tar")
            (work / "signing-plan.json").write_bytes(base64.b64decode(self.record["signingPlanBase64"]))
            with patch.dict(os.environ, {"ANDROID_HOME": str(sdk), "JAVA_HOME": str(self.directory / "jdk")}):
                return LAUNCHER.verify_signature(self.record, self.plan, work, self.signed_tar, descriptor, run=port)
        self.assertEqual(invoke("signature-positive"), proof)
        self.assertEqual(calls[0], [str(tools / "zipalign"), "-c", "-P", "16", "4", str(self.signed_tar)])
        self.assertEqual(calls[1][1:4], ["-cp", str(jar), str(ROOT / "scripts/owner/VerifyApkRotation.java")])
        self.assertIn("--signed-output", calls[1])
        self.assertEqual(calls[1][-4:], ["ai.elizaresearch.alphaphone", "29", "37", "--preserve-signature-permissions"])
        self.assertIn(self.record["signedApkSHA256"]["launcher"], calls[1])
        self.assertIn(descriptor["signerSha256"], calls[1])
        calls.clear()
        original_jar = jar.read_bytes()
        jar.write_bytes(b"substituted verifier")
        with self.assertRaisesRegex(ValueError, "verifier tool differs"):
            invoke("signature-wrong-tool")
        self.assertEqual(calls, [])
        jar.write_bytes(original_jar)
        proof["versionCode"] = 43
        with self.assertRaisesRegex(ValueError, "admission differs"):
            invoke("signature-wrong-version")
        proof["versionCode"] = 44
        self.signed_entries["rotation.lineage"] = b"substituted public lineage"
        self.write_signed()
        calls.clear()
        with self.assertRaisesRegex(ValueError, "signer or lineage differs"):
            invoke("signature-wrong-lineage")
        self.assertEqual(calls, [])

    def test_native_exact_debug_and_signed_members_can_exceed_the_cloud_limit(self):
        payload = bytes(4097)
        self.use_main_candidate({"launcher-debug.apk": payload})
        self.set_signed_launcher(payload)
        product = self.directory / "native-large"
        with patch.object(FIXTURES.PRODUCER, "LEGACY_APK_MEMBER_BYTES", 4096):
            with zipfile.ZipFile(self.producer.archive) as archive:
                with self.assertRaisesRegex(ValueError, "Invalid debug archive member"):
                    BRIDGE.PRODUCER.debug_apk_members(archive, self.producer.verification, FIXTURES.PRODUCER.PRIVATE_RUNNER)
            self.stage_fixture(product)
        for mode in ("debug", "release"):
            self.assertEqual((product / f"artifacts/launcher-{mode}.apk").read_bytes(), payload)

    def test_native_stage_restores_the_exact_generated_native_receipt(self):
        self.use_main_candidate()
        product = self.directory / "native-receipt-stage"
        self.stage_fixture(product)
        with zipfile.ZipFile(self.producer.archive) as archive:
            expected = archive.read("native-input-admission.json")
        self.assertEqual((product / ".eliza/native-inputs/receipt.json").read_bytes(), expected)
        self.assertFalse(json.loads(expected)["qualification"]["deviceExecuted"])

    def test_legacy_cloud_signed_member_keeps_its_ceiling(self):
        self.set_signed_launcher(bytes(4097))
        with patch.object(FIXTURES.PRODUCER, "LEGACY_APK_MEMBER_BYTES", 4096):
            with self.assertRaisesRegex(ValueError, "Unexpected signed bundle members"):
                self.stage_fixture(self.directory / "cloud-large")

    def api(self, endpoint):
        if endpoint == f"repos/{BRIDGE.REPOSITORY}/git/ref/heads/main":
            return {"ref": "refs/heads/main", "object": {"type": "commit", "sha": "f" * 40}}
        if "/compare/" in endpoint:
            source = endpoint.split("/compare/")[1].split("...")[0]
            return {"status": "ahead", "merge_base_commit": {"sha": source}}
        if endpoint == f"repos/{BRIDGE.REPOSITORY}/actions/workflows/release.yml":
            return {"id": 500, "path": BRIDGE.SIGNING_WORKFLOW}
        if endpoint.endswith("/actions/runs/100/attempts/1"):
            repository = {"id": BRIDGE.REPOSITORY_ID, "full_name": BRIDGE.REPOSITORY}
            return {"id": 100, "workflow_id": 500, "status": "completed",
                    "display_title": f"Release sign on {self.record['signingWorkflowCommit']}",
                    "conclusion": "success", "event": "workflow_dispatch",
                    "head_sha": self.record["signingWorkflowCommit"], "head_branch": "main", "run_attempt": 1,
                    "repository": repository, "head_repository": repository,
                    "path": BRIDGE.SIGNING_WORKFLOW}
        if endpoint.endswith("/actions/artifacts/200"):
            return {"id": 200, "expired": False, "workflow_run": {
                        "id": 100, "head_sha": self.record["signingWorkflowCommit"], "head_branch": "main",
                        "repository_id": BRIDGE.REPOSITORY_ID, "head_repository_id": BRIDGE.REPOSITORY_ID},
                    "name": "private-cloud-apk-delivery-100-1", "size_in_bytes": self.record["deliveryArtifactBytes"],
                    "digest": "sha256:" + self.record["deliveryArtifactSHA256"]}
        self.fail("Unexpected endpoint")

    def download(self, endpoint, destination, size, digest):
        self.assertTrue(endpoint.endswith("/actions/artifacts/200/zip"))
        self.assertEqual(size, self.receipt_zip.stat().st_size)
        self.assertEqual(digest, BRIDGE.file_sha(self.receipt_zip))
        shutil.copyfile(self.receipt_zip, destination)

    def prepare_fixture(self, *, api=None, workflow_commit="f" * 40, voice_bytes=None):
        plan = self.directory / "reviewed-plan.json"
        voice = self.directory / "reviewed-voice.json"
        plan.write_bytes(base64.b64decode(self.record["signingPlanBase64"]))
        voice.write_bytes(voice_bytes if voice_bytes is not None else
                          base64.b64decode(self.record["cloudVoiceEvidenceBase64"]))
        before = set(self.directory.iterdir())
        result = BRIDGE.prepare_qualification(plan, voice, self.signed_tar, self.receipt_zip, "200",
                                              workflow_commit, api=api if api is not None else self.api)
        self.assertEqual(set(self.directory.iterdir()), before)
        return result

    def test_prepare_qualification_reuses_native_admission_and_preserves_reviewed_bytes(self):
        self.use_main_candidate()
        # Retain formatting from the submitted plan and from the owner's receipt.
        plan_bytes = (json.dumps(self.plan, indent=2) + "\n").encode()
        self.signed_entries["signing-plan.json"] = plan_bytes
        self.record["signingPlanBase64"] = base64.b64encode(plan_bytes).decode("ascii")
        self.record["signingPlanSHA256"] = BRIDGE.sha(plan_bytes)
        voice = BRIDGE.decode(base64.b64decode(self.record["cloudVoiceEvidenceBase64"]))
        voice_bytes = (json.dumps(voice, indent=2) + "\n").encode()
        self.write_signed()
        self.write_delivery_receipt()
        with patch.object(BRIDGE.STORAGE, "connection", side_effect=AssertionError("private API accessed")):
            actual = self.prepare_fixture(voice_bytes=voice_bytes)
        plan, reviewed_plan, reviewed_voice = BRIDGE.validate(actual)
        self.assertEqual((plan, reviewed_plan, reviewed_voice), (self.plan, plan_bytes, voice_bytes))
        self.assertEqual(actual["signedApkSHA256"], self.record["signedApkSHA256"])
        self.assertEqual(actual["signedBundle"], self.record["signedBundle"])
        self.assertEqual(BRIDGE.preflight(actual, "f" * 40, self.directory / "prepared", self.api, self.download),
                         self.plan)

    def test_prepare_qualification_cli_emits_only_the_reviewable_record(self):
        self.use_main_candidate()
        expected = self.prepare_fixture()
        commit = "f" * 40
        endpoints = (
            "git/ref/heads/main", "actions/artifacts/200", "actions/workflows/release.yml", "actions/runs/100/attempts/1",
            f"compare/{self.plan['alphaCommit']}...{commit}",
            f"compare/{self.record['signingWorkflowCommit']}...{commit}",
        )
        responses = {f"repos/{BRIDGE.REPOSITORY}/{path}": self.api(f"repos/{BRIDGE.REPOSITORY}/{path}")
                     for path in endpoints}
        cli = self.directory / "gh"
        cli.write_text("#!/usr/bin/env python3\nimport json, sys\n"
                       f"responses = {responses!r}\n"
                       "assert sys.argv[1] == 'api'\nprint(json.dumps(responses[sys.argv[2]]))\n")
        cli.chmod(0o700)
        env = {**os.environ, "PATH": str(self.directory) + os.pathsep + os.environ["PATH"]}
        result = subprocess.run([
            sys.executable, "-B", str(ROOT / "scripts/ci/qualified-app-update.py"), "prepare-qualification",
            "--signing-plan", str(self.directory / "reviewed-plan.json"),
            "--voice-evidence", str(self.directory / "reviewed-voice.json"),
            "--signed-tar", str(self.signed_tar), "--delivery-zip", str(self.receipt_zip),
            "--delivery-artifact-id", "200", "--workflow-commit", commit,
        ], env=env, capture_output=True, timeout=15, check=True)
        self.assertEqual(BRIDGE.decode(result.stdout), expected)
        self.assertEqual(result.stderr, b"")

    def test_prepared_qualification_must_fit_workflow_dispatch(self):
        self.use_main_candidate()
        plan_bytes = base64.b64decode(self.record["signingPlanBase64"]).ljust(BRIDGE.PLAN_LIMIT)
        voice_bytes = base64.b64decode(self.record["cloudVoiceEvidenceBase64"]).ljust(BRIDGE.VOICE_LIMIT)
        self.record["signingPlanBase64"] = base64.b64encode(plan_bytes).decode("ascii")
        self.signed_entries["signing-plan.json"] = plan_bytes
        self.write_signed()
        self.write_delivery_receipt()
        record = self.prepare_fixture(voice_bytes=voice_bytes)
        with self.assertRaisesRegex(ValueError, "exceeds GitHub Actions input size"):
            BRIDGE.qualification_input(record, "f" * 40)

    def test_prepare_qualification_refuses_stale_main_or_wrong_signing_origin(self):
        self.use_main_candidate()
        with self.assertRaisesRegex(ValueError, "not current Alpha main"):
            self.prepare_fixture(workflow_commit="0" * 40)
        for endpoint_suffix, changes in (
            ("/actions/artifacts/200", {"expired": True}),
            ("/actions/artifacts/200", {"name": "private-cloud-apk-delivery-101-1"}),
            ("/actions/runs/100/attempts/1", {"run_attempt": 2}),
            ("/actions/runs/100/attempts/1", {"conclusion": "failure"}),
        ):
            def wrong(endpoint):
                record = self.api(endpoint)
                if endpoint.endswith(endpoint_suffix):
                    record.update(changes)
                return record
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.prepare_fixture(api=wrong)

    def test_prepare_qualification_refuses_substituted_zip_tar_apk_plan_or_voice(self):
        self.use_main_candidate()
        original_zip = self.receipt_zip.read_bytes()
        self.receipt_zip.write_bytes(original_zip[:-1] + bytes([original_zip[-1] ^ 1]))
        with self.assertRaisesRegex(ValueError, "Delivery ZIP differs"):
            self.prepare_fixture()
        self.receipt_zip.write_bytes(original_zip)

        original_tar = self.signed_tar.read_bytes()
        self.signed_tar.write_bytes(original_tar[:-1] + bytes([original_tar[-1] ^ 1]))
        with self.assertRaisesRegex(ValueError, "Signed bundle bytes differ"):
            self.prepare_fixture()

        for change, error in (
            ({"signing-plan.json": b"{}"}, "Signed bundle plan differs"),
            ({"launcher-release.apk": b"changed"}, "Signed APK bytes differ"),
        ):
            self.write_signed(change)
            self.write_delivery_receipt()
            with self.assertRaisesRegex(ValueError, error):
                self.prepare_fixture()

        self.write_signed()
        self.write_delivery_receipt()
        voice = BRIDGE.decode(base64.b64decode(self.record["cloudVoiceEvidenceBase64"]))
        voice["results"][0]["checks"]["mute"] = False
        with self.assertRaisesRegex(ValueError, "Voice qualification incomplete"):
            self.prepare_fixture(voice_bytes=json.dumps(voice).encode())
        voice["results"][0]["checks"]["mute"] = True
        voice["results"][0]["apkSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "does not name exact signed APKs"):
            self.prepare_fixture(voice_bytes=json.dumps(voice).encode())

    def test_exact_reviewed_record_restores_inputs_and_signed_bytes(self):
        work, product = self.directory / "admitted", self.directory / "product"
        product.mkdir()
        plan = BRIDGE.preflight(self.record, "f" * 40, work, self.api, self.download)
        BRIDGE.stage(self.record, plan, work, product,
                     lambda pin, target: shutil.copyfile(self.producer.archive, target),
                     lambda pin, receipt, target: shutil.copyfile(self.signed_tar, target))
        for variant in BRIDGE.VARIANTS:
            self.assertEqual((product / f"artifacts/{variant}-release.apk").read_bytes(), self.signed_apks[variant])
            self.assertTrue((product / f"artifacts/{variant}-debug.apk").exists())
        self.assertEqual(json.loads((product / "artifacts/build-config.json").read_text())["runtimeProfile"], "native")
        self.assertEqual(BRIDGE.sha((work / "cloud-voice.json").read_bytes()), self.record["cloudVoiceEvidenceSHA256"])

    def test_voice_receipt_cannot_be_substituted_failed_duplicated_or_carry_content(self):
        original = BRIDGE.decode(base64.b64decode(self.record["cloudVoiceEvidenceBase64"]))
        cases = []
        for change in ("transcript", "failed", "duplicate", "wrong-apk", "missing-check"):
            voice = copy.deepcopy(original)
            if change == "transcript":
                voice["results"][0]["transcript"] = "must never be accepted"
            elif change == "failed":
                voice["results"][0]["checks"]["mute"] = False
            elif change == "duplicate":
                voice["results"].append(copy.deepcopy(voice["results"][0]))
            elif change == "wrong-apk":
                voice["results"][0]["apkSha256"] = "0" * 64
            else:
                del voice["results"][0]["checks"]["consent"]
            record = copy.deepcopy(self.record)
            encoded(record, "cloudVoiceEvidence", voice)
            cases.append(record)
        bad_digest = copy.deepcopy(self.record)
        bad_digest["cloudVoiceEvidenceSHA256"] = "0" * 64
        for record in [*cases, bad_digest]:
            with self.assertRaises(ValueError):
                BRIDGE.validate(record)

    def test_cms_non_public_channel_and_wrong_output_generation_are_not_publication_inputs(self):
        for change in ("cms", "channel", "object", "generation", "extra"):
            record = copy.deepcopy(self.record)
            if change in ("cms", "channel"):
                plan = copy.deepcopy(self.plan)
                if change == "cms":
                    del plan["privateStorage"]
                else:
                    plan["updateChannel"]["kind"] = "other"
                encoded(record, "signingPlan", plan)
            elif change == "object":
                record["signedBundle"]["object"] += "-different"
            elif change == "generation":
                record["signedBundle"]["generation"] = "latest"
            else:
                record["token"] = "must not be accepted"
            with self.assertRaises(ValueError):
                BRIDGE.validate(record)

    def test_wrong_workflow_fork_attempt_artifact_and_main_history_fail_before_private_access(self):
        mutations = [lambda value: value.update(path=".github/workflows/other.yml"),
                     lambda value: value.update(workflow_id=501),
                     lambda value: value.update(display_title=f"Release publish on {self.record['signingWorkflowCommit']}"),
                     lambda value: value.update(run_attempt=2), lambda value: value.update(event="pull_request"),
                     lambda value: value.update(head_branch="feature"),
                     lambda value: value.update(head_repository={**value["head_repository"], "id": 42})]
        for index, mutate in enumerate(mutations):
            def api(endpoint):
                value = self.api(endpoint)
                if endpoint.endswith("/actions/runs/100/attempts/1"):
                    mutate(value)
                return value
            with self.assertRaises(ValueError):
                BRIDGE.preflight(self.record, "f" * 40, self.directory / f"wrong-{index}", api, self.download)
        def moved_workflow(endpoint):
            value = self.api(endpoint)
            if endpoint.endswith("/actions/workflows/release.yml"):
                value["path"] = ".github/workflows/other.yml"
            return value
        with self.assertRaisesRegex(ValueError, "Release workflow identity differs"):
            BRIDGE.preflight(self.record, "f" * 40, self.directory / "moved-workflow", moved_workflow, self.download)
        def wrong_artifact(endpoint):
            value = self.api(endpoint)
            if endpoint.endswith("/actions/artifacts/200"):
                value["digest"] = "sha256:" + "0" * 64
            return value
        with self.assertRaises(ValueError):
            BRIDGE.preflight(self.record, "f" * 40, self.directory / "wrong-artifact", wrong_artifact, self.download)
        for index, comparison in enumerate(({"status": "diverged", "merge_base_commit": {"sha": self.plan["alphaCommit"]}},
                                             {"status": "ahead", "merge_base_commit": {"sha": "0" * 40}})):
            with self.assertRaises(ValueError):
                BRIDGE.preflight(self.record, "f" * 40, self.directory / f"wrong-history-{index}",
                                 lambda endpoint: comparison if "/compare/" in endpoint else self.api(endpoint), self.download)

    def test_isolated_source_requires_exact_approval_and_main_signing_workflow(self):
        fields = ("alphaCommit", "sdkCommit", "versionCode", "updateChannel", "archiveBytes",
                  "archiveSHA256", "producerManifestSHA256", "privateProducerReceiptSHA256", "unsignedApkSHA256")
        approval = {"approval": "approved", **{key: self.plan[key] for key in fields}}
        (self.directory / "android").mkdir()
        descriptor = self.directory / "android/release-signer.json"

        def isolated_source(endpoint):
            if f'/compare/{self.plan["alphaCommit"]}...' in endpoint:
                return {"status": "diverged", "merge_base_commit": {"sha": "0" * 40}}
            return self.api(endpoint)

        with patch.object(BRIDGE, "ROOT", self.directory):
            for index, field in enumerate((None, "approval", *fields)):
                candidate = copy.deepcopy(approval)
                if field is not None:
                    candidate[field] = "unreviewed"
                descriptor.write_text(json.dumps({"privateProducerApproval": candidate}))
                work = self.directory / f"source-review-{index}"
                if field is None:
                    self.assertEqual(BRIDGE.preflight(self.record, "f" * 40, work,
                                                     isolated_source, self.download), self.plan)
                else:
                    with self.assertRaises(ValueError):
                        BRIDGE.preflight(self.record, "f" * 40, work, isolated_source, self.download)
            descriptor.write_text(json.dumps({"privateProducerApproval": approval}))
            with self.assertRaises(ValueError):
                BRIDGE.preflight(self.record, "f" * 40, self.directory / "unreviewed-signer",
                                 lambda endpoint: {"status": "diverged"} if "/compare/" in endpoint else self.api(endpoint),
                                 self.download)

    def test_duplicate_json_and_symlink_restore_paths_are_refused(self):
        with self.assertRaises(ValueError):
            BRIDGE.decode(b'{"schema":1,"schema":2}')
        product = self.directory / "symlink-product"
        product.mkdir()
        (product / "artifacts").symlink_to(self.directory, target_is_directory=True)
        with self.assertRaises(ValueError):
            BRIDGE.restore_file(product, "artifacts/outside.json", io.BytesIO(b"must not escape"),
                                15, BRIDGE.sha(b"must not escape"), "mismatch")
        self.assertFalse((self.directory / "outside.json").exists())

    def test_restore_streams_chunks_and_preserves_prior_target_on_refusal(self):
        class BoundedSource(io.BytesIO):
            def read(self, size):
                self.maximum = max(getattr(self, "maximum", 0), size)
                if not 0 < size <= 1024 * 1024:
                    raise AssertionError("Unbounded read")
                return super().read(size)

        product = self.directory / "streamed-product"
        product.mkdir()
        target = product / "large.apk"
        value = b"x" * (3 * 1024 * 1024 + 13)
        source = BoundedSource(value)
        BRIDGE.restore_file(product, target.name, source, len(value), BRIDGE.sha(value), "mismatch")
        self.assertEqual(source.maximum, 1024 * 1024)
        self.assertEqual(BRIDGE.file_sha(target), BRIDGE.sha(value))
        for replacement, size, digest in ((b"ab", 1, BRIDGE.sha(b"a")),
                                           (b"a", 2, BRIDGE.sha(b"ab")),
                                           (b"b", 1, BRIDGE.sha(b"a"))):
            with self.assertRaisesRegex(ValueError, "mismatch"):
                BRIDGE.restore_file(product, target.name, BoundedSource(replacement), size, digest, "mismatch")
            self.assertEqual(BRIDGE.file_sha(target), BRIDGE.sha(value))
            self.assertEqual(list(product.iterdir()), [target])

    def test_signed_plan_apk_and_tar_path_substitution_are_rejected(self):
        for index, change in enumerate(({"signing-plan.json": b"{}"}, {"launcher-release.apk": b"changed"}, {"../outside": b"bad"})):
            self.write_signed(change)
            work, product = self.directory / f"stage-{index}", self.directory / f"product-{index}"
            work.mkdir()
            product.mkdir()
            (work / "signing-plan.json").write_bytes(base64.b64decode(self.record["signingPlanBase64"]))
            with self.assertRaises(ValueError):
                BRIDGE.stage(self.record, self.plan, work, product,
                             lambda pin, target: shutil.copyfile(self.producer.archive, target),
                             lambda pin, receipt, target: shutil.copyfile(self.signed_tar, target))
            self.assertFalse((self.directory / "outside").exists())

    def test_signed_transport_requires_exact_generation_status_size_and_digest(self):
        receipt = self.record["signedBundle"]
        content = self.signed_tar.read_bytes()
        class Response:
            status = 200
            def __init__(self): self.stream = io.BytesIO(content)
            def read(self, size): return self.stream.read(size)
        class Connection:
            def __init__(self): self.requests = []; self.response = Response()
            def request(self, method, route, **kwargs): self.requests.append((method, route))
            def getresponse(self): return self.response
            def close(self): pass
        metadata = {"bucket": receipt["bucket"], "name": receipt["object"], "generation": receipt["generation"], "size": str(receipt["bytes"])}
        conn = Connection()
        with patch.object(BRIDGE.STORAGE, "connection", return_value=(conn, {})), patch.object(BRIDGE.STORAGE, "read_json", return_value=metadata):
            BRIDGE.signed_download(self.plan, receipt, self.directory / "readback.tar")
        self.assertEqual(conn.requests, [("GET", conn.requests[0][1])])
        self.assertIn("generation=456", conn.requests[0][1])
        for index, (metadata_change, status, extra) in enumerate([({"generation": "999"}, 200, b""), ({}, 302, b""), ({}, 200, b"extra")]):
            conn = Connection()
            conn.response.status = status
            conn.response.stream = io.BytesIO(content + extra)
            with patch.object(BRIDGE.STORAGE, "connection", return_value=(conn, {})), patch.object(BRIDGE.STORAGE, "read_json", return_value={**metadata, **metadata_change}):
                with self.assertRaises(ValueError):
                    BRIDGE.signed_download(self.plan, receipt, self.directory / f"refused-{index}.tar")


class SignedLauncherPayloadTest(unittest.TestCase):
    """Real ZIP reads; the inserted block is not a cryptographic signature."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="alpha-signed-payload-")
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.unsigned = self.directory / "unsigned.apk"
        self.signed = self.directory / "signed.apk"
        self.entries = [("AndroidManifest.xml", b"manifest fixture"),
                        ("assets/agent/agent-bundle.js", b"unchanged runtime fixture" * 200)]
        self.write_unsigned()

    def write_unsigned(self, *, entries=None, compression=zipfile.ZIP_DEFLATED, metadata=None):
        with zipfile.ZipFile(self.unsigned, "w", compression=compression) as archive:
            for name, payload in entries or self.entries:
                if metadata:
                    info = zipfile.ZipInfo(name)
                    info.compress_type = compression
                    metadata(info)
                    archive.writestr(info, payload)
                else:
                    archive.writestr(name, payload)
        self.add_block(self.unsigned.read_bytes())

    def add_block(self, raw):
        # Model the ZIP layout change only. Production additionally requires the
        # pinned Android verifier to authenticate a genuine v3-only signature.
        end = raw.rindex(b"PK\x05\x06")
        offset = struct.unpack_from("<I", raw, end + 16)[0]
        block = b"synthetic outside-ZIP signature block"
        result = bytearray(raw[:offset] + block + raw[offset:])
        struct.pack_into("<I", result, end + len(block) + 16, offset + len(block))
        self.signed.write_bytes(result)

    def check(self):
        return LAUNCHER.identical_zip_payload(self.unsigned, self.signed,
                                             BRIDGE.file_sha(self.unsigned), BRIDGE.file_sha(self.signed))

    def test_v3_layout_preserves_every_compressed_entry_and_local_byte(self):
        proof = self.check()
        self.assertEqual(proof["members"], len(self.entries))
        self.assertGreater(proof["unchangedLocalBytes"], 0)
        self.assertEqual(proof["unsignedApkSHA256"], BRIDGE.file_sha(self.unsigned))
        self.assertEqual(proof["signedApkSHA256"], BRIDGE.file_sha(self.signed))

    def test_digest_substitution_or_no_signature_block_is_refused(self):
        with self.assertRaisesRegex(ValueError, "digest differs"):
            LAUNCHER.identical_zip_payload(self.unsigned, self.signed, "0" * 64, BRIDGE.file_sha(self.signed))
        self.signed.write_bytes(self.unsigned.read_bytes())
        with self.assertRaisesRegex(ValueError, "no added signing block"):
            self.check()

    def test_missing_extra_duplicate_reordered_and_changed_zip_entries_are_refused(self):
        original = self.unsigned.read_bytes()
        variants = [self.entries[:1], self.entries + [("extra", b"no")], self.entries + [self.entries[0]],
                    list(reversed(self.entries)), [(self.entries[0][0], b"changed") , self.entries[1]]]
        for entries in variants:
            with self.subTest(entries=[name for name, _ in entries]):
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    self.write_unsigned(entries=entries)
                self.unsigned.write_bytes(original)
                with self.assertRaises((ValueError, zipfile.BadZipFile)):
                    self.check()

    def test_compression_and_entry_metadata_changes_are_refused(self):
        original = self.unsigned.read_bytes()
        for options in ({"compression": zipfile.ZIP_STORED}, {"metadata": lambda info: setattr(info, "comment", b"changed")},
                        {"metadata": lambda info: setattr(info, "external_attr", (stat.S_IFLNK | 0o777) << 16)}):
            with self.subTest(options=list(options)):
                self.write_unsigned(**options)
                self.unsigned.write_bytes(original)
                with self.assertRaisesRegex(ValueError, "metadata differs"):
                    self.check()

    def test_different_compressed_local_bytes_fail_even_with_matching_plaintext_and_crc(self):
        raw = bytearray(self.signed.read_bytes())
        # The local timestamp is independent of the central-directory facts.
        raw[10] ^= 1
        self.signed.write_bytes(raw)
        with self.assertRaisesRegex(ValueError, "local payload bytes differ"):
            self.check()


if __name__ == "__main__":
    unittest.main()
