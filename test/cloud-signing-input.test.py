"""Synthetic archive fixtures. No real APK, signing key or provider is accessed."""

import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/ci"))
import app_update_producer as PRODUCER

SPEC = importlib.util.spec_from_file_location(
    "cloud_signing_input", ROOT / "scripts/ci/admit-cloud-signing-input.py"
)
ADMISSION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ADMISSION)

NATIVE_SOURCE_PATHS = ('packages/app/scripts', 'plugins/plugin-native-inference/src/model-catalog', 'bun.lock', 'package.json', 'packages/agent/package.json', 'packages/app/package.json', 'packages/app/platforms/android/app/src/main/elizavoice-jni/CMakeLists.txt', 'packages/app/platforms/android/app/src/main/elizavoice-jni/elizavoice-jni.cpp', 'packages/app/platforms/android/app/src/main/java/ai/elizaos/app/ElizaVoiceNative.java', 'packages/app/scripts/aosp/compile-libllama-paths.ts', 'packages/app/scripts/aosp/compile-libllama.ts', 'packages/app/scripts/aosp/compile-shim.ts', 'packages/app/scripts/aosp/vulkan-source-contract.ts', 'packages/app/scripts/aosp/zig-toolchain.ts', 'packages/app/scripts/build-helpers/arm64-simd.ts', 'packages/app/scripts/build-helpers/elizavoice-build-flags.ts', 'packages/app/scripts/build-helpers/omnivoice-merged.ts', 'packages/app/scripts/build-helpers/verify-fused-symbols.ts', 'packages/app/scripts/lib/repo-root.ts', 'packages/app/scripts/paradee-voice/build-native.ts', 'packages/app/scripts/stage-elizavoice-lib.ts', 'packages/app/scripts/voice/build-phonon2-gguf.ts', 'plugins/plugin-local-inference/native/android', 'plugins/plugin-native-inference/src/model-catalog/voice-model-versions.json')
NATIVE_PRODUCT_PATHS = ('android/embedding-host/build-toolchain.json', 'android/embedding-host/native-requirements.txt', 'android/embedding-host/bootstrap-requirements.txt', 'android/paradee-voice/asr-inputs.json', 'scripts/build-embedding-host.ts', 'scripts/prepare-embedding-host.ts', 'scripts/embedding-native-contract.ts', 'scripts/embedding-build-remap.ts', 'scripts/native-build-inputs.ts', 'scripts/android-stage-voice-models.ts', 'scripts/local-agent-source.ts', 'scripts/voice-host.ts', 'scripts/paradee-runtime.ts', 'scripts/android-abis.ts', 'scripts/copy-file-clone.ts', 'scripts/stage-embedding-host.ts')

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
                "packageName": ADMISSION.PACKAGE,
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

    def write_archive(self, entries_update=None, duplicate=None, special=None, compression=zipfile.ZIP_STORED):
        verification = json.dumps(self.verification).encode()
        build = json.dumps(self.build).encode()
        files = {"artifacts/apk-manifest.json": verification, "artifacts/build-config.json": build}
        if entries_update and "producer-evidence/native-build-receipt.json" in entries_update:
            files["native-build-receipt.json"] = entries_update["producer-evidence/native-build-receipt.json"]
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
        with zipfile.ZipFile(self.archive, "w", compression=compression) as bundle:
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

    def prepare_native_source(self):
        if hasattr(self, "native_source"):
            return
        self.source_directory = tempfile.TemporaryDirectory(prefix="alpha-reviewed-native-source-")
        self.addCleanup(self.source_directory.cleanup)
        root = Path(self.source_directory.name)
        sdk = root / "vendor/eliza"
        sdk.mkdir(parents=True)
        def put(base, name, value):
            target = base / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(value)
        def git(base, *args):
            return subprocess.check_output(["git", "-C", str(base), *args], stderr=subprocess.PIPE).decode().strip()
        def commit(base):
            git(base, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Synthetic reviewed source")
            return git(base, "rev-parse", "HEAD")
        git(sdk, "init", "-q")
        directories = {"packages/app/scripts", "plugins/plugin-native-inference/src/model-catalog"}
        for name in NATIVE_SOURCE_PATHS:
            if name not in directories:
                put(sdk, name + "/CMakeLists.txt" if name.endswith("/android") else name, b"synthetic upstream source")
        git(sdk, "add", ".")
        git(sdk, "update-index", "--add", "--cacheinfo", "160000," + "e" * 40 + ",plugins/plugin-local-inference/native/llama.cpp")
        sdk_commit = commit(sdk)
        toolchain = {"ndk": "28.2.13676358", "cmake": "4.0.3"}
        for name in NATIVE_PRODUCT_PATHS:
            put(root, name, b"synthetic producer input")
        put(root, "android/embedding-host/build-toolchain.json", json.dumps(toolchain).encode())
        put(root, "scripts/native-build-inputs.ts", b"export const NATIVE_PYTHON = '3.12.11';")
        put(root, "android/embedding-host/qualified-host.json", b'{"model":{"id":"synthetic-embedding-model"}}')
        put(root, "android/voice-host/qualified-voice-host.json", b'{"models":[],"asrSlot":{}}')
        put(root, "upstream.lock.json", json.dumps({"commit": sdk_commit}).encode())
        put(root, "app.config.json", json.dumps({"appId": PRODUCER.CANDIDATE_PACKAGE}).encode())
        git(root, "init", "-q")
        git(root, "add", "android", "scripts", "upstream.lock.json", "app.config.json")
        git(root, "update-index", "--add", "--cacheinfo", "160000," + sdk_commit + ",vendor/eliza")
        source = commit(root)
        self.native_source = (source, sdk_commit)
        self.native_recipe = {
            "schema": "alpha-native-recipe/v1", "identity": PRODUCER.CANDIDATE_PACKAGE,
            "engineCommit": "e" * 40,
            "sourceTrees": dict(zip(NATIVE_SOURCE_PATHS, git(sdk, "rev-parse", *(sdk_commit + ":" + name for name in NATIVE_SOURCE_PATHS)).splitlines())),
            "productInputs": {name: ADMISSION.digest((root / name).read_bytes()) for name in NATIVE_PRODUCT_PATHS},
            "models": [], "asrSlot": {}, "toolchain": toolchain, "python": "3.12.11",
        }
        source_env = patch.dict(os.environ, {"ALPHA_NATIVE_SOURCE_ROOT": str(root)})
        source_env.start()
        self.addCleanup(source_env.stop)

    def write_candidate(self, extra=None, change_receipt=None, change_native=None):
        self.prepare_native_source()
        self.pin.update(alphaCommit=self.native_source[0], sdkCommit=self.native_source[1])
        self.producer["source"] = self.pin["alphaCommit"]
        self.verification["upstream"]["commit"] = self.pin["sdkCommit"]
        self.pin.pop("privateProducerReceiptSHA256", None)
        self.pin.update(producerKind=PRODUCER.CANDIDATE, producerRunId="171", producerRunAttempt=2, artifactId="202")
        for record in (self.verification, self.build, self.producer):
            record["runtimeProfile"] = "native"
        for row in self.verification["results"]:
            if row["mode"] == "release":
                row["packageName"] = PRODUCER.CANDIDATE_PACKAGE
                row["distributable"] = False
                row.setdefault("voiceHost", {"packaged": True, "asr": True, "differences": []})
        debug = {}
        self.verification["results"] = [row for row in self.verification["results"] if row["mode"] != "debug"]
        for variant in ADMISSION.VARIANTS:
            name = f"{variant}-debug.apk"
            debug[name] = (extra or {}).get(name, f"{variant} debug fixture".encode())
            self.verification["results"].append({"variant": variant, "mode": "debug", "sha256": ADMISSION.digest(debug[name])})
        source, sdk = self.pin["alphaCommit"], self.pin["sdkCommit"]
        recipe = copy.deepcopy(self.native_recipe)
        native = {
            "schema": "alpha-native-build/v1", "consumerSdkCommit": sdk, "recipe": recipe,
            "recipeSha256": ADMISSION.digest(json.dumps(recipe, separators=(",", ":")).encode()),
            "producer": {"sdkCommit": sdk, "platform": "linux", "arch": "x64", "ndk": "28.2.13676358",
                         "cmake": "4.0.3", "python": "3.12.11"},
            "voice": {"identity": PRODUCER.CANDIDATE_PACKAGE, "pin": sdk, "forkPin": recipe["engineCommit"], "qualified": False,
                      "models": [], "asrSlot": {}, "abis": [{"abi": abi, "abiVersion": 17, "alignment16KiB": True,
                        "libraries": [{"name": name, "bytes": 100, "sha256": "a" * 64} for name in
                                      ("libelizainference.so", "libc++_shared.so")]} for abi in ("arm64-v8a", "x86_64")]},
            "embedding": {"identity": PRODUCER.CANDIDATE_PACKAGE, "pin": sdk, "forkPin": recipe["engineCommit"],
                          "abi": "arm64-v8a", "jniIdentityRelocated": True, "model": {"id": "synthetic-embedding-model"},
                          "libraries": [{"name": name, "bytes": 100, "sha256": "a" * 64, "alignment16KiB": True}
                                        for name in ("libelizainference.so", "libc++_shared.so", "libelizavoicejni.so")]},
            "qualification": {"deviceExecuted": False, "userAccepted": False},
            "files": [{"path": "android/app/src/main/jniLibs/arm64-v8a/libelizavoicejni.so", "bytes": 100, "sha256": "a" * 64}],
        }
        native["embedding"]["additionalAbis"] = [{"abi": "x86_64", "libraries": copy.deepcopy(native["embedding"]["libraries"])}]
        native["files"] = [{"path": name, "bytes": 100, "sha256": "a" * 64} for name in [
            ".eliza/paradee-voice/native/build-record.json",
            ".eliza/paradee-voice/native/assets/paradee-voice/v1/manifest.json",
            ".eliza/paradee-voice/native/jniLibs/arm64-v8a/libelizainference.so",
            ".eliza/paradee-voice/native/jniLibs/x86_64/libelizainference.so",
            "android/app/src/main/jniLibs/arm64-v8a/libelizainference.so",
            "android/app/src/main/jniLibs/arm64-v8a/libc++_shared.so",
            "android/app/src/main/jniLibs/arm64-v8a/libelizavoicejni.so",
            "android/app/src/main/jniLibs/x86_64/libelizainference.so",
            "android/app/src/main/jniLibs/x86_64/libc++_shared.so",
            "android/app/src/main/jniLibs/x86_64/libelizavoicejni.so"]]
        if change_native:
            change_native(native)
        native_bytes = json.dumps(native).encode()
        files = {**recipe["productInputs"], "upstream.lock.json": "d" * 64,
                 ".eliza/native-inputs/receipt.json": ADMISSION.digest(native_bytes),
                 **{row["path"]: row["sha256"] for row in native["files"]}}
        fingerprint = ADMISSION.digest(json.dumps(files, separators=(",", ":")).encode())
        snapshot = json.dumps({"schemaVersion": 5, "digest": fingerprint, "files": files}).encode()
        apks = {}
        for variant in ADMISSION.VARIANTS:
            name = f"{variant}-release-unsigned.apk"
            apks[variant] = {"file": name, "bytes": len(self.apk_bytes[name]),
                             "sha256": self.pin["unsignedApkSHA256"][variant]}
        receipt = {
            "schema": "alpha-app-update-candidate/v1", "sourceCommit": source, "sdkCommit": sdk,
            "workflow": f"{PRODUCER.REPOSITORY}/{PRODUCER.WORKFLOW}@refs/heads/main",
            "workflowId": PRODUCER.WORKFLOW_ID, "runId": "171", "runNumber": "44", "runAttempt": "2",
            "versionCode": 44, "observedFloor": 40, "manifestSha256": None,
            "finalObservedFloor": 43, "finalManifestSha256": "e" * 64,
            "runtimeProfile": "native", "updateChannel": self.pin["updateChannel"],
            "sourceScope": "checkout-commit-and-frozen-build-inputs", "sourceFingerprint": fingerprint,
            "nativeInputAdmissionSha256": ADMISSION.digest(native_bytes),
            "verificationSha256": ADMISSION.digest(json.dumps(self.verification).encode()), "apks": apks,
            "signed": False, "distributionQualified": False,
            "qualificationScope": "unsigned-build-and-source-freeze-only",
        }
        if change_receipt:
            change_receipt(receipt)
        raw = json.dumps(receipt).encode()
        self.pin["candidateReceiptSHA256"] = ADMISSION.digest(raw)
        self.write_archive({"app-update-candidate.json": raw, "native-input-admission.json": native_bytes,
                            "producer-evidence/native-build-receipt.json": native_bytes,
                            "inputs-before.json": snapshot, "inputs-after.json": snapshot, **debug, **(extra or {})},
                           compression=zipfile.ZIP_DEFLATED)
        digest = self.pin["archiveSHA256"]
        self.pin["archiveBytes"] = self.archive.stat().st_size
        self.pin["privateStorage"] = {
            "bucket": "alpha-aosp-lab-20261024-private-apks", "inputGeneration": "123",
            "inputObject": f"unsigned/{digest}.zip",
            "outputObject": f"signed/{digest}/{'d' * 32}/signed-apks.tar",
        }

    def candidate_api_responses(self):
        source = self.pin["alphaCommit"]
        repository = {"id": PRODUCER.REPOSITORY_ID, "full_name": PRODUCER.REPOSITORY}
        run = {"id": 171, "run_attempt": 2, "run_number": 44, "event": "push", "head_branch": "main",
               "head_sha": source, "workflow_id": PRODUCER.WORKFLOW_ID, "path": PRODUCER.WORKFLOW,
               "status": "completed", "conclusion": "success",
               "repository": repository, "head_repository": copy.deepcopy(repository)}
        artifact = {"id": 202, "expired": False, "expires_at": "2099-01-01T00:00:00Z",
                    "name": f"app-native-candidate-44-{source}-171-2", "size_in_bytes": self.pin["archiveBytes"],
                    "digest": "sha256:" + self.pin["archiveSHA256"],
                    "workflow_run": {"id": 171, "head_sha": source, "head_branch": "main",
                                     "repository_id": PRODUCER.REPOSITORY_ID,
                                     "head_repository_id": PRODUCER.REPOSITORY_ID}}
        return {f"repos/{PRODUCER.REPOSITORY}/actions/runs/171/attempts/2": run,
                f"repos/{PRODUCER.REPOSITORY}/actions/artifacts/202": artifact}

    def test_candidate_preparation_yields_mirror_request_then_exact_signing_plan(self):
        self.write_candidate()
        api = self.candidate_api_responses().__getitem__
        original = self.archive.read_bytes()
        mirror = ADMISSION.prepare_candidate(self.archive, "202", api=api)
        self.assertEqual(mirror["schema"], "alpha-candidate-mirror-request/v1")
        self.assertEqual(mirror["artifactId"], "202")
        self.assertEqual(mirror["mirror"], {
            "bucket": self.pin["privateStorage"]["bucket"], "object": self.pin["privateStorage"]["inputObject"],
            "bytes": len(original), "sha256": self.pin["archiveSHA256"],
        })
        self.assertNotIn("privateStorage", mirror)
        with self.assertRaises((KeyError, ValueError)):
            PRODUCER.validate_private_storage(mirror)

        plan = ADMISSION.prepare_candidate(self.archive, "202", input_generation="123",
                                           delivery_id="d" * 32, api=api)
        self.assertEqual(plan, self.pin)
        self.assertEqual(PRODUCER.validate_private_storage(plan), self.pin["privateStorage"])
        self.assertIs(ADMISSION.admit(self.archive, plan)["signed"], False)
        self.assertEqual(self.archive.read_bytes(), original)
        self.assertEqual(set(self.archive.parent.iterdir()), {self.archive})

    def test_candidate_preparation_refuses_wrong_official_artifact_or_attempt(self):
        self.write_candidate()
        for endpoint, field, value in (
            ("artifacts/202", "digest", "sha256:" + "0" * 64),
            ("artifacts/202", "size_in_bytes", self.pin["archiveBytes"] + 1),
            ("artifacts/202", "expired", True),
            ("artifacts/202", "name", f"app-native-candidate-44-{self.pin['alphaCommit']}-171-1"),
            ("runs/171/attempts/2", "id", 172),
            ("runs/171/attempts/2", "run_attempt", 1),
            ("runs/171/attempts/2", "event", "workflow_dispatch"),
            ("runs/171/attempts/2", "conclusion", "failure"),
        ):
            with self.subTest(endpoint=endpoint, field=field):
                responses = self.candidate_api_responses()
                responses[f"repos/{PRODUCER.REPOSITORY}/actions/{endpoint}"][field] = value
                with self.assertRaises(ValueError):
                    ADMISSION.prepare_candidate(self.archive, "202", api=responses.__getitem__)

    def test_candidate_fetch_checks_metadata_before_transfer_and_publishes_verified_bytes(self):
        self.write_candidate()
        responses = self.candidate_api_responses()
        destination = self.archive.with_name("downloaded.zip")
        calls = []

        def api(endpoint):
            calls.append(endpoint)
            return responses[endpoint]

        def download(pins, target):
            self.assertEqual(calls, [f"repos/{PRODUCER.REPOSITORY}/actions/artifacts/202",
                                     f"repos/{PRODUCER.REPOSITORY}/actions/runs/171/attempts/2"])
            self.assertEqual(pins["archiveBytes"], self.pin["archiveBytes"])
            self.assertEqual(pins["archiveSHA256"], self.pin["archiveSHA256"])
            self.assertFalse(destination.exists())
            shutil.copyfile(self.archive, target)

        request = ADMISSION.fetch_candidate(destination, "202", api=api, download=download)
        self.assertEqual(request, ADMISSION.prepare_candidate(self.archive, "202", api=responses.__getitem__))
        self.assertEqual(destination.read_bytes(), self.archive.read_bytes())
        self.assertEqual(set(self.archive.parent.iterdir()), {self.archive, destination})

    def test_candidate_fetch_refuses_unbounded_or_untrusted_metadata_before_transfer(self):
        self.write_candidate()
        destination = self.archive.with_name("downloaded.zip")
        for endpoint, field, value in (
            ("artifacts/202", "size_in_bytes", PRODUCER.MAX_ARCHIVE_BYTES + 1),
            ("artifacts/202", "name", "developer-apks"),
            ("artifacts/202", "expired", True),
            ("runs/171/attempts/2", "conclusion", "failure"),
            ("runs/171/attempts/2", "event", "workflow_dispatch"),
        ):
            with self.subTest(field=field):
                responses = self.candidate_api_responses()
                responses[f"repos/{PRODUCER.REPOSITORY}/actions/{endpoint}"][field] = value
                with self.assertRaises(ValueError):
                    ADMISSION.fetch_candidate(destination, "202", api=responses.__getitem__,
                                              download=lambda *_: self.fail("Unadmitted download"))
                self.assertEqual(set(self.archive.parent.iterdir()), {self.archive})

    def test_candidate_fetch_preserves_destination_on_bad_bytes_expiry_or_publication_race(self):
        self.write_candidate()
        responses = self.candidate_api_responses()
        api = responses.__getitem__
        destination = self.archive.with_name("downloaded.zip")
        with self.assertRaisesRegex(ValueError, "ZIP differs"):
            ADMISSION.fetch_candidate(destination, "202", api=api,
                                      download=lambda _, target: target.write_bytes(b"partial transfer"))
        self.assertEqual(set(self.archive.parent.iterdir()), {self.archive})

        def expire(_, target):
            shutil.copyfile(self.archive, target)
            responses[f"repos/{PRODUCER.REPOSITORY}/actions/artifacts/202"]["expired"] = True

        with self.assertRaisesRegex(ValueError, "expiry differs"):
            ADMISSION.fetch_candidate(destination, "202", api=api, download=expire)
        self.assertEqual(set(self.archive.parent.iterdir()), {self.archive})
        responses = self.candidate_api_responses()
        api = responses.__getitem__

        def download(_, target):
            shutil.copyfile(self.archive, target)
            destination.write_bytes(b"existing destination")

        with self.assertRaises(FileExistsError):
            ADMISSION.fetch_candidate(destination, "202", api=api, download=download)
        self.assertEqual(destination.read_bytes(), b"existing destination")
        self.assertEqual(set(self.archive.parent.iterdir()), {self.archive, destination})

    def test_candidate_preparation_checks_archive_evidence_and_unsigned_bytes(self):
        for extra in (
            {"inputs-after.json": b"{}"},
            {"launcher-release-unsigned.apk": self.apk_bytes["launcher-release-unsigned.apk"].upper()},
        ):
            with self.subTest(member=next(iter(extra))):
                self.write_candidate(extra)
                with self.assertRaises(ValueError):
                    ADMISSION.prepare_candidate(self.archive, "202", api=self.candidate_api_responses().__getitem__)

    def test_native_handoff_requires_publication_debug_and_indexed_evidence(self):
        manifest_name = "producer-evidence/manifest.json"
        evidence_name = "artifacts/sbom/alpha.cdx.json"
        evidence = b'{"verified":true}'
        for case, refusal in (
            ("valid", None),
            ("changed-debug", "Producer debug APK bytes differ"),
            ("missing-evidence", "Missing, nonregular or oversized archive member"),
            ("changed-evidence", "Producer evidence bytes differ"),
        ):
            with self.subTest(case=case):
                self.write_candidate()
                with zipfile.ZipFile(self.archive) as source:
                    entries = {entry.filename: source.read(entry) for entry in source.infolist()}
                manifest = json.loads(entries[manifest_name])
                manifest["files"][evidence_name] = {"bytes": len(evidence), "sha256": ADMISSION.digest(evidence)}
                entries[manifest_name] = json.dumps(manifest).encode()
                if case != "missing-evidence":
                    entries["producer-evidence/" + evidence_name] = evidence.upper() if case == "changed-evidence" else evidence
                if case == "changed-debug":
                    entries["standalone-debug.apk"] = entries["standalone-debug.apk"].upper()
                with zipfile.ZipFile(self.archive, "w", compression=zipfile.ZIP_DEFLATED) as target:
                    for name, data in entries.items():
                        target.writestr(name, data)
                archive_bytes = self.archive.read_bytes()
                digest = ADMISSION.digest(archive_bytes)
                self.pin.update(archiveBytes=len(archive_bytes), archiveSHA256=digest,
                                producerManifestSHA256=ADMISSION.digest(entries[manifest_name]))
                self.pin["privateStorage"].update(inputObject=f"unsigned/{digest}.zip",
                                                  outputObject=f"signed/{digest}/{'d' * 32}/signed-apks.tar")
                PRODUCER.validate_private_storage(self.pin)
                api = self.candidate_api_responses().__getitem__
                delivery = {"input_generation": "123", "delivery_id": "d" * 32}
                if refusal:
                    for options in ({}, delivery):
                        with self.assertRaisesRegex(ValueError, refusal):
                            ADMISSION.prepare_candidate(self.archive, "202", api=api, **options)
                    stage = self.archive.with_name("protected-stage")
                    with self.assertRaisesRegex(ValueError, refusal):
                        ADMISSION.admit(self.archive, self.pin, stage)
                    self.assertFalse(stage.exists())
                else:
                    self.assertEqual(ADMISSION.prepare_candidate(self.archive, "202", api=api, **delivery), self.pin)
                    self.assertTrue(ADMISSION.admit(self.archive, self.pin)["inputVerified"])
                self.assertEqual(self.archive.read_bytes(), archive_bytes)

    def test_candidate_preparation_refuses_invalid_or_unpaired_delivery_fields(self):
        self.write_candidate()
        api = self.candidate_api_responses().__getitem__
        for generation, delivery_id in ((None, "d" * 32), ("123", None), ("0", "d" * 32),
                                        ("01", "d" * 32), ("123", "d" * 31), ("123", "D" * 32)):
            with self.subTest(generation=generation, delivery_id=delivery_id), self.assertRaises(ValueError):
                ADMISSION.prepare_candidate(self.archive, "202", input_generation=generation,
                                            delivery_id=delivery_id, api=api)

    def test_candidate_admits_only_exact_native_receipts_and_frozen_inputs(self):
        self.write_candidate()
        stage = self.archive.parent / "candidate-staged"
        self.assertIs(ADMISSION.admit(self.archive, self.pin, stage)["signed"], False)
        self.assertEqual({path.name: path.read_bytes() for path in stage.iterdir()}, self.apk_bytes)
        for field, value in (("runAttempt", "1"), ("versionCode", 45), ("signed", True),
                             ("finalObservedFloor", 44), ("sourceFingerprint", "0" * 64),
                             ("nativeInputAdmissionSha256", "0" * 64)):
            with self.subTest(field=field):
                self.write_candidate(change_receipt=lambda receipt: receipt.update({field: value}))
                with self.assertRaises(ValueError):
                    ADMISSION.admit(self.archive, self.pin)
        changes = [
            lambda value: value.update(consumerSdkCommit="0" * 40),
            lambda value: value["producer"].update(sdkCommit="invalid"),
            lambda value: value["producer"].update(ndk="old"),
            lambda value: value["recipe"].update(identity="ai.example.other"),
            lambda value: value["qualification"].update(deviceExecuted=True),
            lambda value: value["voice"].update(qualified=True),
            lambda value: value["files"][0].update(path="../escape"),
            lambda value: value["files"][0].update(sha256="invalid"),
            lambda value: value.update(recipeSha256="0" * 64),
            lambda value: value["files"].pop(),
            lambda value: value["files"].append({"path": "unexpected", "bytes": 1, "sha256": "a" * 64}),
            lambda value: value["embedding"]["libraries"][0].update(sha256="b" * 64),
            lambda value: value["embedding"].pop("additionalAbis"),
            lambda value: value["embedding"]["additionalAbis"][0].update(abi="arm64-v8a"),
            lambda value: value["embedding"]["additionalAbis"][0]["libraries"].pop(),
            lambda value: value["embedding"]["additionalAbis"][0]["libraries"][0].update(sha256="b" * 64),
            lambda value: value["files"].__setitem__(slice(None), [row for row in value["files"] if row["path"] != "android/app/src/main/jniLibs/x86_64/libelizavoicejni.so"]),
        ]
        for change in changes:
            self.write_candidate(change_native=change)
            with self.assertRaises(ValueError):
                ADMISSION.admit(self.archive, self.pin)
        for extra in ({"inputs-after.json": b"{}"}, {"private-producer.json": b"{}"},
                      {"launcher-release-unsigned.apk": self.apk_bytes["launcher-release-unsigned.apk"].upper()}):
            self.write_candidate(extra)
            with self.assertRaises(ValueError):
                ADMISSION.admit(self.archive, self.pin)
        self.verification["results"][0]["voiceHost"]["asr"] = False
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "on-device voice with ASR"):
            ADMISSION.admit(self.archive, self.pin)

    def test_native_recipe_cannot_forge_self_consistent_source_or_model_pins(self):
        def rehash(value):
            value["recipeSha256"] = ADMISSION.digest(json.dumps(value["recipe"], separators=(",", ":")).encode())
        def change_tree(value):
            value["recipe"]["sourceTrees"][NATIVE_SOURCE_PATHS[0]] = "f" * 40
            rehash(value)
        def change_input(value):
            value["recipe"]["productInputs"][NATIVE_PRODUCT_PATHS[0]] = "f" * 64
            rehash(value)
        def change_models(value):
            model = {"path": "forged-model.bin", "bytes": 100, "sha256": "a" * 64}
            value["recipe"]["models"] = value["voice"]["models"] = [model]
            value["files"].append({**model, "path": ".eliza/paradee-voice/native/assets/paradee-voice/v1/forged-model.bin"})
            rehash(value)
        def change_python(value):
            value["recipe"]["python"] = value["producer"]["python"] = "0.0.0"
            rehash(value)
        def change_embedding_model(value):
            value["embedding"]["model"] = {"id": "forged-model"}
        for change in (change_tree, change_input, change_models, change_python, change_embedding_model):
            with self.subTest(change=change.__name__):
                self.write_candidate(change_native=change)
                with self.assertRaisesRegex(ValueError, "reviewed"):
                    ADMISSION.admit(self.archive, self.pin)

    def test_candidate_cannot_claim_other_producer_or_delivery_routes(self):
        self.write_candidate()
        for drift in ({"privateProducerReceiptSHA256": "0" * 64}, {"producerKind": PRODUCER.PRIVATE_RUNNER},
                      {"producerRunAttempt": "2"}, {"privateStorage": None}, {"encryptedArtifactApproved": True},
                      {"purpose": "private-update-qa-baseline"}):
            with self.assertRaises(ValueError):
                ADMISSION.admit(self.archive, {**self.pin, **drift})

    def unsigned_pair(self, size):
        for row in self.verification["results"]:
            if row["mode"] == "release":
                variant = row["variant"]
                payload = bytes([1 if variant == "launcher" else 2]) * size
                self.apk_bytes[f"{variant}-release-unsigned.apk"] = payload
                row["sha256"] = self.pin["unsignedApkSHA256"][variant] = ADMISSION.digest(payload)

    def test_native_unsigned_members_can_exceed_the_cloud_limit(self):
        self.unsigned_pair(4097)
        self.write_archive()
        with patch.object(PRODUCER, "LEGACY_APK_MEMBER_BYTES", 4096):
            with self.assertRaisesRegex(ValueError, "oversized archive member"):
                ADMISSION.admit(self.archive, self.pin)
            self.write_candidate()
            stage = self.archive.parent / "large-native"
            ADMISSION.admit(self.archive, self.pin, stage)
            self.assertEqual({path.name: path.read_bytes() for path in stage.iterdir()}, self.apk_bytes)

    def test_native_expanded_apk_pairs_are_bounded_independently(self):
        ceiling = 12_000
        debug = {f"{variant}-debug.apk": bytes(4_000) for variant in ADMISSION.VARIANTS}
        with patch.object(PRODUCER, "MAX_ARCHIVE_BYTES", ceiling):
            self.unsigned_pair(4_000)
            self.write_candidate(debug)
            self.assertLess(self.archive.stat().st_size, ceiling)
            ADMISSION.admit(self.archive, self.pin)
            self.unsigned_pair(6_001)
            self.write_candidate(debug)
            with self.assertRaisesRegex(ValueError, "expanded pair limit"):
                ADMISSION.admit(self.archive, self.pin)
            self.unsigned_pair(4_000)
            self.write_candidate({name: bytes(6_001) for name in debug})
            with self.assertRaisesRegex(ValueError, "expanded pair limit"):
                ADMISSION.admit(self.archive, self.pin)

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


class PrivateProducerSourceReviewTest(unittest.TestCase):
    def test_isolated_source_requires_exact_committed_approval(self):
        self.assertEqual(ADMISSION.PACKAGE.split("."), ["ai", "elizaresearch", "alphaphone"])
        self.assertEqual(PRODUCER.REPOSITORY, "eliza-research/alpha")
        with tempfile.TemporaryDirectory(prefix="alpha-source-review-") as directory:
            root = Path(directory)
            (root / "scripts/ci").mkdir(parents=True)
            (root / "android").mkdir()
            (root / "bin").mkdir()
            for name in ("verify-cloud-signing-input.sh", "private-apk-storage.py",
                         "admit-cloud-signing-input.py", "app_update_producer.py"):
                shutil.copyfile(ROOT / "scripts/ci" / name, root / "scripts/ci" / name)
            plan = {
                "alphaCommit": "a" * 40, "sdkCommit": "b" * 40, "versionCode": 50,
                "updateChannel": {"kind": "public", "manifestUrlSha256": "c" * 64},
                "archiveBytes": 100, "archiveSHA256": "d" * 64,
                "producerManifestSHA256": "e" * 64,
                "privateProducerReceiptSHA256": "f" * 64,
                "unsignedApkSHA256": {"standalone": "1" * 64, "launcher": "2" * 64},
                "producerKind": "root-reviewed-private-runner",
                "privateStorage": {
                    "bucket": "alpha-aosp-lab-20261024-private-apks",
                    "inputObject": "unsigned/" + "d" * 64 + ".zip",
                    "inputGeneration": "123", "outputObject": "signed/" + "d" * 64 + "/" + "3" * 32 + "/signed-apks.tar",
                },
            }
            fields = ("alphaCommit", "sdkCommit", "versionCode", "updateChannel", "archiveBytes",
                      "archiveSHA256", "producerManifestSHA256", "privateProducerReceiptSHA256", "unsignedApkSHA256")
            approval = {"approval": "approved", **{key: plan[key] for key in fields}}
            comparison = {"status": "diverged", "merge_base_commit": {"sha": "4" * 40}}
            for name, body in {
                "git": '#!/bin/sh\nprintf "%s\\n" "$GITHUB_SHA"\n',
                "gh": '#!/bin/sh\nprintf "%s\\n" "$TEST_COMPARISON"\n',
            }.items():
                path = root / "bin" / name
                path.write_text(body)
                path.chmod(0o700)
            env = {**os.environ, "PATH": str(root / "bin") + os.pathsep + os.environ["PATH"],
                   "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": "5" * 40,
                   "GITHUB_REPOSITORY": PRODUCER.REPOSITORY, "GITHUB_REPOSITORY_ID": str(PRODUCER.REPOSITORY_ID),
                   "RUNNER_TEMP": directory,
                   "GITHUB_OUTPUT": str(root / "output"), "SIGNING_PLAN": json.dumps(plan),
                   "TEST_COMPARISON": json.dumps(comparison)}
            for field in (None, "approval", *fields):
                with self.subTest(changed_field=field):
                    candidate = copy.deepcopy(approval)
                    if field is not None:
                        candidate[field] = "unreviewed"
                    (root / "android/release-signer.json").write_text(json.dumps({"privateProducerApproval": candidate}))
                    result = subprocess.run(["bash", "scripts/ci/verify-cloud-signing-input.sh"],
                                            cwd=root, env=env, capture_output=True, text=True)
                    self.assertEqual(result.returncode == 0, field is None, result.stderr)


if __name__ == "__main__":
    unittest.main()
