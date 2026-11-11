"""Controlled receipts, archives and transports; no keys, accounts or publication."""
import base64
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BRIDGE = load("qualified_update", "scripts/ci/qualified-app-update.py")
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
        with zipfile.ZipFile(self.receipt_zip, "w") as archive:
            archive.writestr("private-storage-receipt.json", json.dumps(self.record["signedBundle"]))
        self.record["deliveryArtifactBytes"] = self.receipt_zip.stat().st_size
        self.record["deliveryArtifactSHA256"] = BRIDGE.file_sha(self.receipt_zip)

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

    def api(self, endpoint):
        if "/compare/" in endpoint:
            source = endpoint.split("/compare/")[1].split("...")[0]
            return {"status": "ahead", "merge_base_commit": {"sha": source}}
        if endpoint.endswith("/actions/runs/100"):
            return {"status": "completed", "conclusion": "success", "event": "workflow_dispatch",
                    "head_sha": self.record["signingWorkflowCommit"], "head_branch": "main", "run_attempt": 1,
                    "head_repository": {"full_name": BRIDGE.REPOSITORY}, "path": ".github/workflows/release-cloud-app-signing.yml"}
        if endpoint.endswith("/actions/artifacts/200"):
            return {"expired": False, "workflow_run": {"id": 100, "head_sha": self.record["signingWorkflowCommit"]},
                    "name": "private-cloud-apk-delivery-100-1", "size_in_bytes": self.record["deliveryArtifactBytes"],
                    "digest": "sha256:" + self.record["deliveryArtifactSHA256"]}
        self.fail("Unexpected endpoint")

    def download(self, endpoint, destination, size, digest):
        self.assertTrue(endpoint.endswith("/actions/artifacts/200/zip"))
        self.assertEqual(size, self.receipt_zip.stat().st_size)
        self.assertEqual(digest, BRIDGE.file_sha(self.receipt_zip))
        shutil.copyfile(self.receipt_zip, destination)

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
                voice["results"][1] = voice["results"][0]
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

    def test_cms_private_qa_and_wrong_output_generation_are_not_publication_inputs(self):
        for change in ("cms", "private", "object", "generation", "extra"):
            record = copy.deepcopy(self.record)
            if change in ("cms", "private"):
                plan = copy.deepcopy(self.plan)
                if change == "cms":
                    del plan["privateStorage"]
                else:
                    plan["updateChannel"]["kind"] = "private-qa"
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
                     lambda value: value.update(run_attempt=2), lambda value: value.update(event="pull_request"),
                     lambda value: value.update(head_branch="feature"),
                     lambda value: value.update(head_repository={"full_name": "other/repository"})]
        for index, mutate in enumerate(mutations):
            def api(endpoint):
                value = self.api(endpoint)
                if endpoint.endswith("/actions/runs/100"):
                    mutate(value)
                return value
            with self.assertRaises(ValueError):
                BRIDGE.preflight(self.record, "f" * 40, self.directory / f"wrong-{index}", api, self.download)
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

    def test_duplicate_json_and_symlink_restore_paths_are_refused(self):
        with self.assertRaises(ValueError):
            BRIDGE.decode(b'{"schema":1,"schema":2}')
        product = self.directory / "symlink-product"
        product.mkdir()
        (product / "artifacts").symlink_to(self.directory, target_is_directory=True)
        with self.assertRaises(ValueError):
            BRIDGE.write_file(product, "artifacts/outside.json", b"must not escape")
        self.assertFalse((self.directory / "outside.json").exists())

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


if __name__ == "__main__":
    unittest.main()
