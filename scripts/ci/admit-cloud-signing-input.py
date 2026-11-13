"""Read-only admission and signing handoff for Alpha application producer archives."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
from tempfile import TemporaryDirectory
import zipfile

from app_update_producer import (
    CANDIDATE, CANDIDATE_PACKAGE, MAX_ARCHIVE_BYTES, PRIVATE_APK_BUCKET, PRIVATE_RUNNER, REPOSITORY,
    WORKFLOW, WORKFLOW_ID, apk_member_limit, archive_pins, copy_verified, decode, download_github_archive,
    gh_json, github_candidate, github_candidate_download_pins, matches, positive_id, producer_kind,
    validate_private_storage,
)

VARIANTS = ("standalone", "launcher")
# Existing installed Cloud releases retain their Android identity during the branding migration.
PACKAGE = ".".join(("ai", "elizaresearch", "alphaphone"))
SHA = re.compile("[0-9a-f]{64}")
COMMIT = re.compile("[0-9a-f]{40}")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def single_profile(record, profile):
    return record["runtimeProfile"] == profile and "localEmbeddings" not in record


def reviewed_private_producer(plan, descriptor):
    fields = ("alphaCommit", "sdkCommit", "versionCode", "updateChannel", "archiveBytes",
              "archiveSHA256", "producerManifestSHA256", "privateProducerReceiptSHA256", "unsignedApkSHA256")
    approval = {"approval": "approved", **{key: plan.get(key) for key in fields}}
    return plan.get("producerKind") == PRIVATE_RUNNER and isinstance(plan.get("privateStorage"), dict) and \
        descriptor.get("privateProducerApproval") == approval


def checked_source_bytes(root, commit, name, *, object_id=False):
    """Read immutable Git objects, never execute the candidate checkout."""
    require(matches(COMMIT, commit), "Invalid native source commit")
    command = ["git", "--no-replace-objects", "-C", str(root),
               "rev-parse" if object_id else "show", f"{commit}:{name}"]
    try:
        result = subprocess.run(command, check=True, capture_output=True, timeout=20,
                                env={**os.environ, "GIT_NO_LAZY_FETCH": "1"})
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError("Reviewed native source object is unavailable: " + name) from error
    require(len(result.stdout) <= 4 * 1024**2, "Native source object is oversized")
    return result.stdout.decode().strip() if object_id else result.stdout


def verify_native_source(native, files, pin, source_root=None):
    root = Path(source_root or os.environ.get("ALPHA_NATIVE_SOURCE_ROOT") or Path(__file__).resolve().parents[2])
    if not source_root and not os.environ.get("ALPHA_NATIVE_SOURCE_ROOT") and (root / "qualified-producer").is_dir():
        root /= "qualified-producer"
    sdk = root / "vendor/eliza"
    product = lambda name: checked_source_bytes(root, pin["alphaCommit"], name)
    recipe = native["recipe"]
    require(json.loads(product("upstream.lock.json"))["commit"] == pin["sdkCommit"] and
            checked_source_bytes(root, pin["alphaCommit"], "vendor/eliza", object_id=True) == pin["sdkCommit"] and
            json.loads(product("app.config.json"))["appId"] == recipe["identity"],
            "Native recipe differs from the reviewed product source")
    for name, value in recipe["productInputs"].items():
        require(digest(product(name)) == value == files[name],
                "Native recipe input differs from reviewed source: " + name)
    voice = json.loads(product("android/voice-host/qualified-voice-host.json"))
    python_pin = re.search(r"export const NATIVE_PYTHON\s*=\s*['\"]([^'\"]+)['\"]", product("scripts/native-build-inputs.ts").decode())
    require(python_pin is not None and recipe["python"] == python_pin[1] and
            native["embedding"]["model"] == json.loads(product("android/embedding-host/qualified-host.json"))["model"],
            "Native Python or embedding model differs from reviewed product source")
    require(recipe["models"] == voice["models"] and recipe["asrSlot"] == voice["asrSlot"] and
            recipe["toolchain"] == json.loads(product("android/embedding-host/build-toolchain.json")),
            "Native models or toolchain differ from reviewed product source")
    expected = {**recipe["sourceTrees"], "plugins/plugin-local-inference/native/llama.cpp": recipe["engineCommit"]}
    for commit in {pin["sdkCommit"], native["producer"]["sdkCommit"]}:
        try:
            result = subprocess.run(["git", "--no-replace-objects", "-C", str(sdk), "rev-parse",
                                     *(f"{commit}:{name}" for name in expected)],
                                    check=True, capture_output=True, timeout=20,
                                    env={**os.environ, "GIT_NO_LAZY_FETCH": "1"})
        except (OSError, subprocess.SubprocessError) as error:
            raise ValueError("Reviewed native SDK source objects are unavailable") from error
        require(result.stdout.decode().splitlines() == list(expected.values()),
                "Native producer source differs from reviewed SDK")


def candidate_evidence(data, pin, apk_manifest, source_root=None):
    raw = data("app-update-candidate.json")
    require(digest(raw) == pin["candidateReceiptSHA256"], "Candidate receipt differs from the reviewed digest")
    candidate = json.loads(raw)
    expected = {
        "schema": "alpha-app-update-candidate/v1", "sourceCommit": pin["alphaCommit"],
        "sdkCommit": pin["sdkCommit"], "workflow": f"{REPOSITORY}/{WORKFLOW}@refs/heads/main",
        "workflowId": WORKFLOW_ID, "runId": pin["producerRunId"], "runAttempt": str(pin["producerRunAttempt"]),
        "runNumber": str(pin["versionCode"]), "versionCode": pin["versionCode"], "runtimeProfile": "native",
        "updateChannel": pin["updateChannel"], "sourceScope": "checkout-commit-and-frozen-build-inputs",
        "qualificationScope": "unsigned-build-and-source-freeze-only", "verificationSha256": digest(apk_manifest),
    }
    fields = {"signed", "distributionQualified", "observedFloor", "finalObservedFloor", "manifestSha256",
              "finalManifestSha256", "sourceFingerprint", "nativeInputAdmissionSha256", "apks"}
    require(set(candidate) == expected.keys() | fields and
            all(candidate[field] == value for field, value in expected.items()) and
            candidate["signed"] is False and candidate["distributionQualified"] is False,
            "Candidate receipt identity or qualification scope differs")
    for field in ("observedFloor", "finalObservedFloor"):
        require(type(candidate[field]) is int and 0 < candidate[field] < pin["versionCode"],
                "Candidate receipt did not clear the observed version floor")
    for field in ("manifestSha256", "finalManifestSha256"):
        require(candidate[field] is None or matches(SHA, candidate[field]), "Invalid candidate manifest digest")
    before = data("inputs-before.json")
    require(data("inputs-after.json") == before, "Candidate source snapshots differ")
    snapshot = json.loads(before)
    files = snapshot["files"]
    require(snapshot["schemaVersion"] == 5 and isinstance(files, dict) and "upstream.lock.json" in files and
            all(matches(SHA, value) for value in files.values()), "Invalid candidate source snapshot")
    # source-snapshot.ts hashes this ordered map using JSON.stringify.
    canonical = json.dumps(files, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    require(digest(canonical) == snapshot["digest"] == candidate["sourceFingerprint"],
            "Candidate source fingerprint differs")
    native_bytes = data("native-input-admission.json")
    require(digest(native_bytes) == candidate["nativeInputAdmissionSha256"] ==
            files.get(".eliza/native-inputs/receipt.json"),
            "Candidate native input admission differs from frozen source")
    native = json.loads(native_bytes)
    require(native["schema"] == "alpha-native-build/v1" and native["consumerSdkCommit"] == candidate["sdkCommit"],
            "Candidate native input schema or consumer source differs")
    recipe = native["recipe"]
    require(recipe["schema"] == "alpha-native-recipe/v1" and recipe["identity"] == CANDIDATE_PACKAGE and
            matches(COMMIT, recipe["engineCommit"]) and
            digest(json.dumps(recipe, ensure_ascii=False, separators=(",", ":")).encode()) == native["recipeSha256"],
            "Candidate native input recipe differs")
    require(native["qualification"] == {"deviceExecuted": False, "userAccepted": False} and
            native["voice"]["qualified"] is False,
            "Candidate native inputs cannot claim device qualification")
    producer = native["producer"]
    require(matches(COMMIT, producer["sdkCommit"]) and producer["platform"] in ("linux", "darwin") and
            producer["arch"] in ("x64", "arm64") and producer["ndk"] == recipe["toolchain"]["ndk"] and
            producer["cmake"] == recipe["toolchain"]["cmake"] and producer["python"] == recipe["python"],
            "Candidate native input producer toolchain differs")
    for component in (native["voice"], native["embedding"]):
        require(component["identity"] == CANDIDATE_PACKAGE and component["forkPin"] == recipe["engineCommit"],
                "Candidate native input component identity differs")
    expected_trees = {
        "packages/app/scripts", "plugins/plugin-native-inference/src/model-catalog", "bun.lock",
        'package.json',
        'packages/agent/package.json',
        'packages/app/package.json',
        'packages/app/platforms/android/app/src/main/elizavoice-jni/CMakeLists.txt',
        'packages/app/platforms/android/app/src/main/elizavoice-jni/elizavoice-jni.cpp',
        'packages/app/platforms/android/app/src/main/java/ai/elizaos/app/ElizaVoiceNative.java',
        'packages/app/scripts/aosp/compile-libllama-paths.ts',
        'packages/app/scripts/aosp/compile-libllama.ts',
        'packages/app/scripts/aosp/compile-shim.ts',
        'packages/app/scripts/aosp/vulkan-source-contract.ts',
        'packages/app/scripts/aosp/zig-toolchain.ts',
        'packages/app/scripts/build-helpers/arm64-simd.ts',
        'packages/app/scripts/build-helpers/elizavoice-build-flags.ts',
        'packages/app/scripts/build-helpers/omnivoice-merged.ts',
        'packages/app/scripts/build-helpers/verify-fused-symbols.ts',
        'packages/app/scripts/lib/repo-root.ts',
        'packages/app/scripts/paradee-voice/build-native.ts',
        'packages/app/scripts/stage-elizavoice-lib.ts',
        'packages/app/scripts/voice/build-phonon2-gguf.ts',
        'plugins/plugin-local-inference/native/android',
        'plugins/plugin-native-inference/src/model-catalog/voice-model-versions.json',
    }
    require(set(recipe["sourceTrees"]) == expected_trees and
            all(matches(COMMIT, value) for value in recipe["sourceTrees"].values()),
            "Candidate native source trees differ")
    expected_inputs = {"android/embedding-host/build-toolchain.json", "android/embedding-host/native-requirements.txt",
                       "android/embedding-host/bootstrap-requirements.txt",
                       "android/paradee-voice/asr-inputs.json", "scripts/native-build-inputs.ts",
                       "scripts/build-embedding-host.ts", "scripts/prepare-embedding-host.ts",
                       "scripts/embedding-native-contract.ts", "scripts/embedding-build-remap.ts",
                       "scripts/android-stage-voice-models.ts", "scripts/local-agent-source.ts"}
    require(isinstance(recipe["productInputs"], dict) and expected_inputs == recipe["productInputs"].keys() and
            all(matches(SHA, value) and value == files.get(name) for name, value in recipe["productInputs"].items()),
            "Candidate native recipe differs from frozen product inputs")
    verify_native_source(native, files, pin, source_root)
    voice, embedding = native["voice"], native["embedding"]
    require(voice["pin"] == producer["sdkCommit"] == embedding["pin"] and
            voice["models"] == recipe["models"] and voice["asrSlot"] == recipe["asrSlot"],
            "Candidate native producer source or models differ")
    abis, libraries = voice["abis"], embedding["libraries"]
    require(isinstance(abis, list) and [row["abi"] for row in abis] == ["arm64-v8a", "x86_64"] and
            embedding["abi"] == "arm64-v8a" and embedding["jniIdentityRelocated"] is True and
            isinstance(libraries, list) and sorted(row["name"] for row in libraries) ==
            ["libc++_shared.so", "libelizainference.so", "libelizavoicejni.so"],
            "Candidate native library inventory differs")
    expected_outputs = {".eliza/paradee-voice/native/build-record.json": None,
                        ".eliza/paradee-voice/native/assets/paradee-voice/v1/manifest.json": None}
    for model in voice["models"]:
        expected_outputs[".eliza/paradee-voice/native/assets/paradee-voice/v1/" + model["path"]] = model
    for abi in abis:
        require(abi["alignment16KiB"] is True and type(abi["abiVersion"]) is int and abi["abiVersion"] >= 17 and
                [row["name"] for row in abi["libraries"]] == ["libelizainference.so", "libc++_shared.so"],
                "Candidate native voice ABI differs")
        for library in abi["libraries"]:
            expected_outputs[f"android/app/src/main/jniLibs/{abi['abi']}/{library['name']}"] = library
            if library["name"] == "libelizainference.so":
                expected_outputs[f".eliza/paradee-voice/native/jniLibs/{abi['abi']}/{library['name']}"] = library
    require(all(row["alignment16KiB"] is True for row in libraries), "Candidate native JNI alignment differs")
    for library in abis[0]["libraries"]:
        same = next(row for row in libraries if row["name"] == library["name"])
        require(same["bytes"] == library["bytes"] and same["sha256"] == library["sha256"],
                "Candidate voice and embedding engines differ")
    expected_outputs["android/app/src/main/jniLibs/arm64-v8a/libelizavoicejni.so"] = next(
        row for row in libraries if row["name"] == "libelizavoicejni.so")
    outputs = native["files"]
    require(isinstance(outputs, list) and outputs and len(outputs) <= 4096, "Candidate native output inventory is empty or excessive")
    output_paths = set()
    for row in outputs:
        name = row["path"]
        require(isinstance(name, str) and name not in output_paths and
                not PurePosixPath(name).is_absolute() and "\\" not in name and
                all(part not in ("", ".", "..") for part in name.split("/")) and
                matches(SHA, row["sha256"]) and row["sha256"] == files.get(name) and
                type(row["bytes"]) is int and row["bytes"] > 0,
                "Invalid candidate native output")
        output_paths.add(name)
        require(name in expected_outputs, "Unexpected candidate native output")
        expected = expected_outputs[name]
        require(expected is None or row["sha256"] == expected["sha256"] and row["bytes"] == expected["bytes"],
                "Candidate native output differs from its component record")
    require(output_paths == expected_outputs.keys(), "Incomplete candidate native output inventory")
    require(data("producer-evidence/native-build-receipt.json") == native_bytes,
            "Native build receipt differs from retained producer evidence")
    require(isinstance(candidate["apks"], dict) and set(candidate["apks"]) == set(VARIANTS),
            "Candidate receipt must bind exactly both release variants")
    return candidate["apks"]


def check_apk_pair(kind, entries):
    # Bound each two-variant native pair independently. The compressed producer
    # archive may contain both pairs without exceeding its own transport bound.
    if kind == CANDIDATE:
        require(sum(entry.file_size for entry in entries) <= apk_member_limit(kind),
                "Native APK pair exceeds the expanded pair limit")


def debug_apk_members(archive, verified, kind):
    members = {}
    for variant in VARIANTS:
        name = f"{variant}-debug.apk"
        rows = [row for row in verified["results"] if row.get("mode") == "debug" and row.get("variant") == variant]
        require(len(rows) == 1, "Producer debug APK is required for full verification")
        entry = archive.getinfo(name)
        require(0 < entry.file_size <= apk_member_limit(kind) and
                stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG) and not entry.flag_bits & 1,
                "Invalid debug archive member")
        members[name] = (entry, rows[0]["sha256"])
    check_apk_pair(kind, (entry for entry, _ in members.values()))
    return members


def archive_members(bundle):
    names = {}
    for entry in bundle.infolist():
        require(entry.filename not in names, "Archive contains a duplicate entry")
        names[entry.filename] = entry
    return names


def regular_member(names, name, limit):
    entry = names.get(name)
    mode = stat.S_IFMT(entry.external_attr >> 16) if entry else None
    require(entry and not entry.is_dir() and mode in (0, stat.S_IFREG) and
            not (entry.flag_bits & 1) and 0 < entry.file_size <= limit,
            f"Missing, nonregular or oversized archive member: {name}")
    return entry


def read_evidence(bundle, names, name):
    return bundle.read(regular_member(names, name, 4 * 1024**2))


def producer_evidence_members(names, inventory):
    """Apply the same member and expansion limits before signing and restoring."""
    require(isinstance(inventory, dict) and len(inventory) <= 4096, "Invalid producer inventory")
    exact_paths = ("artifacts/build-config.json", "artifacts/apk-manifest.json", "native-source-manifest.json",
                   "prepared-source-stamp.json", "worker-manifest.json", "native-build-receipt.json")
    directories = ("artifacts/sbom/", "apps/app/public/licenses/", "licenses/",
                   "android/app/src/main/assets/agent/", "android/app/src/main/jniLibs/")
    total = 0
    for name, fact in inventory.items():
        relative = PurePosixPath(name)
        require((name in exact_paths or name.startswith(directories)) and not relative.is_absolute() and
                all(part not in ("..", ".git") for part in relative.parts) and
                isinstance(fact, dict) and set(fact) == {"bytes", "sha256"} and matches(SHA, fact["sha256"]) and
                type(fact["bytes"]) is int and 0 < fact["bytes"] <= 512 * 1024**2, "Unsupported producer evidence path")
        total += fact["bytes"]
        require(total <= 512 * 1024**2, "Producer evidence exceeds restore bound")
        entry = regular_member(names, "producer-evidence/" + name, fact["bytes"])
        require(entry.file_size == fact["bytes"], "Invalid evidence member length")
        yield name, entry, fact["sha256"]


def admit(archive, pin, stage=None, *, source_root=None):
    kind = producer_kind(pin)
    archive_json = decode if kind == CANDIDATE else json.loads
    profile = "native" if kind == CANDIDATE else "cloud"
    package = CANDIDATE_PACKAGE if kind == CANDIDATE else PACKAGE
    for field in ("alphaCommit", "sdkCommit"):
        require(isinstance(pin.get(field), str) and COMMIT.fullmatch(pin[field]), f"Invalid {field} pin")
    require(type(pin.get("versionCode")) is int and pin["versionCode"] > 0, "Invalid version pin")
    channel = pin.get("updateChannel")
    require(isinstance(channel, dict) and set(channel) == {"kind", "manifestUrlSha256"}
            and channel["kind"] in ("public", "private-qa")
            and isinstance(channel["manifestUrlSha256"], str)
            and SHA.fullmatch(channel["manifestUrlSha256"]), "Invalid reviewed update channel")
    require((channel["kind"] == "private-qa") == (pin.get("purpose") == "private-update-qa-baseline"),
            "Private update channel requires the explicit QA baseline purpose")
    apks = pin["unsignedApkSHA256"]
    require(set(apks) == set(VARIANTS), "Exactly two variant pins are required")
    for value in (pin["archiveSHA256"], pin["producerManifestSHA256"], *apks.values()):
        require(isinstance(value, str) and SHA.fullmatch(value), "Invalid SHA-256 pin")
    require(archive.is_file() and not archive.is_symlink() and archive.stat().st_size <= MAX_ARCHIVE_BYTES,
            "Archive must be a bounded regular file")
    if kind == CANDIDATE:
        require(archive.stat().st_size == pin["archiveBytes"], "Candidate archive size differs")
    with archive.open("rb") as stream:
        require(hashlib.file_digest(stream, "sha256").hexdigest() == pin["archiveSHA256"],
                "Archive bytes differ from the reviewed digest")
        stream.seek(0)
        with zipfile.ZipFile(stream) as bundle:
            names = archive_members(bundle)

            def data(name):
                return read_evidence(bundle, names, name)

            require(("app-update-candidate.json" in names) == (kind == CANDIDATE) and
                    ("private-producer.json" in names) == (kind == PRIVATE_RUNNER),
                    "Archive contains the wrong producer receipt")
            if kind == PRIVATE_RUNNER:
                private_bytes = data("private-producer.json")
                require(digest(private_bytes) == pin["privateProducerReceiptSHA256"],
                        "Private producer receipt differs from the reviewed digest")
                private = json.loads(private_bytes)
                require(private["schema"] == 1 and
                        private["producerKind"] == PRIVATE_RUNNER and
                        private["project"] == "alpha-aosp-lab-20261024" and
                        private["instanceId"] == "8999310923263914877" and
                        private["alphaCommit"] == pin["alphaCommit"] and
                        private["sdkCommit"] == pin["sdkCommit"] and
                        private["versionCode"] == pin["versionCode"] and
                        private["unsignedApkSHA256"] == apks and single_profile(private, profile),
                        "Private producer identity differs from the reviewed build")
                require(private.get("updateChannel") == channel, "Private producer update channel differs")
                for check in ("productSourceGuard", "sdkSourceGuard", "normalPreparation",
                              "combinedVerification", "apkArchive"):
                    require(private["checks"][check] == "passed", f"Private build did not pass {check}")

            producer_bytes = data("producer-evidence/manifest.json")
            require(digest(producer_bytes) == pin["producerManifestSHA256"], "Producer manifest digest differs")
            producer = archive_json(producer_bytes)
            require(producer["source"] == pin["alphaCommit"] and producer["versionCode"] == pin["versionCode"]
                    and single_profile(producer, profile),
                    "Producer source, version or runtime profile differs")
            require(producer.get("updateChannel") == channel, "Producer update channel differs")
            apk_manifest = data("apk-verification.json")
            require(apk_manifest == data("producer-evidence/artifacts/apk-manifest.json"),
                    "Producer and archive APK verification records differ")
            build = data("producer-evidence/artifacts/build-config.json")
            for name, value in (("artifacts/apk-manifest.json", apk_manifest), ("artifacts/build-config.json", build)):
                require(producer["files"][name] == {"bytes": len(value), "sha256": digest(value)},
                        f"Producer evidence does not bind {name}")
            candidate_apks = candidate_evidence(data, pin, apk_manifest, source_root) if kind == CANDIDATE else None
            verified = archive_json(apk_manifest)
            require(verified.get("updateChannel") == channel, "Verified update channel differs")
            require(verified["upstream"]["commit"] == pin["sdkCommit"], "Verified SDK commit differs")
            require(single_profile(verified, profile) and verified["testMocks"] is False
                    and verified.get("allowUnpackagedRuntime") is False,
                    "APK verification is outside the reviewed distribution profile")
            config = json.loads(build)
            require(config.get("updateChannel") == channel, "Build update channel differs")
            require(single_profile(config, profile) and config["testMocks"] is False and config["signingRequested"] is False
                    and config["versionOverride"]["code"] == str(pin["versionCode"]),
                    "Build flags or version differ from the reviewed unsigned distribution build")
            name_map = json.loads(data("apk-manifest.json"))
            rows = [row for row in verified["results"] if row["mode"] == "release"]
            require(len(rows) == 2 and {row["variant"] for row in rows} == set(VARIANTS),
                    "APK verification must contain exactly one release row per variant")
            release_members = {}
            for row in rows:
                variant = row["variant"]
                require(row.get("updateChannel") == channel, "APK update channel differs")
                name = f"{variant}-release-unsigned.apk"
                require(row["file"] == f"artifacts/{name}" and row["packageName"] == package
                        and row["versionCode"] == pin["versionCode"] and row["signed"] is False
                        and row["signerSha256"] is None and row["testMocks"] is False
                        and row["debuggable"] is False and row["home"] is (variant == "launcher")
                        and row["launcher"] is True and row["webPayload"] is True
                        and row["runtime"] == "PACKAGED" and row["runtimeNotices"] is True
                        and row["bundleAudit"] == "passed" and row["licenceBlockers"] == []
                        and row["releaseAdmission"]["failures"] == []
                        and row["releaseAdmission"]["blockers"] == ["unsigned release"],
                        f"{variant} is not the reviewed unsigned release")
                require(row["sha256"] == name_map[name] == apks[variant], f"{variant} APK digests disagree")
                apk_member = regular_member(names, name, apk_member_limit(kind))
                if candidate_apks is not None:
                    require(candidate_apks[variant] == {"file": name, "bytes": apk_member.file_size, "sha256": apks[variant]},
                            f"{variant} candidate receipt differs from the exact APK")
                    voice = row["voiceHost"]
                    require(row.get("distributable") is False and voice["packaged"] is True and
                            voice["asr"] is True and voice["differences"] == [],
                            f"{variant} candidate requires admitted on-device voice with ASR")
                release_members[variant] = apk_member
            check_apk_pair(kind, release_members.values())
            if kind == CANDIDATE:
                # Refuse archives that publication cannot restore before signing.
                for entry, expected in debug_apk_members(bundle, verified, kind).values():
                    with bundle.open(entry) as apk:
                        copy_verified(apk, entry.file_size, expected, "Producer debug APK bytes differ")
                for _, entry, expected in producer_evidence_members(names, producer["files"]):
                    with bundle.open(entry) as evidence:
                        copy_verified(evidence, entry.file_size, expected, "Producer evidence bytes differ")
            for variant, apk_member in release_members.items():
                with bundle.open(apk_member) as apk:
                    copy_verified(apk, apk_member.file_size, apks[variant], f"{variant} APK bytes differ")
            if stage is not None:
                stage.mkdir(mode=0o700)
                for variant in VARIANTS:
                    apk_member = release_members[variant]
                    output = stage / apk_member.filename
                    with bundle.open(apk_member) as source, output.open("xb") as target:
                        shutil.copyfileobj(source, target)
                    with output.open("rb") as target:
                        copy_verified(target, apk_member.file_size, apks[variant], f"Staged {variant} APK bytes differ")
    return {"source": pin["alphaCommit"], "sdk": pin["sdkCommit"], "versionCode": pin["versionCode"],
            "updateChannel": channel, "unsignedApkSHA256": apks, "inputVerified": True, "signed": False}


def prepare_candidate(archive, artifact_id, *, input_generation=None, delivery_id=None, api=gh_json):
    require(positive_id(artifact_id), "Exact candidate artifact ID required")
    require((input_generation is None) == (delivery_id is None),
            "Supply both the mirror generation and the delivery ID")
    if input_generation is not None:
        require(matches(re.compile(r"[1-9][0-9]{0,24}"), input_generation), "Exact input generation required")
        require(matches(re.compile(r"[0-9a-f]{32}"), delivery_id), "A 32-hex exclusive delivery ID is required")
    metadata = api(f"repos/{REPOSITORY}/actions/artifacts/{artifact_id}")
    require(isinstance(metadata, dict) and metadata.get("id") == int(artifact_id) and metadata.get("expired") is False,
            "Candidate artifact identity or expiry differs")
    remote_digest = metadata.get("digest")
    require(isinstance(remote_digest, str) and remote_digest.startswith("sha256:"),
            "Candidate artifact has no SHA-256")
    archive_hash = remote_digest.removeprefix("sha256:")
    pin = {"archiveBytes": metadata["size_in_bytes"], "archiveSHA256": archive_hash}
    archive_pins(pin)
    require(archive.is_file() and not archive.is_symlink(), "Candidate archive must be a regular file")
    with archive.open("rb") as stream:
        require(archive.stat().st_size == pin["archiveBytes"] and
                hashlib.file_digest(stream, "sha256").hexdigest() == archive_hash,
                "Original candidate ZIP differs from official artifact size or digest")
        stream.seek(0)
        with zipfile.ZipFile(stream) as bundle:
            members = archive_members(bundle)
            candidate_bytes = read_evidence(bundle, members, "app-update-candidate.json")
            producer_bytes = read_evidence(bundle, members, "producer-evidence/manifest.json")
    candidate = json.loads(candidate_bytes)
    attempt = candidate["runAttempt"]
    require(positive_id(attempt), "Candidate receipt lacks an exact run attempt")
    input_object = f"unsigned/{archive_hash}.zip"
    storage = {"bucket": PRIVATE_APK_BUCKET, "inputObject": input_object}
    pin.update(producerKind=CANDIDATE, producerRunId=candidate["runId"], producerRunAttempt=int(attempt),
               artifactId=artifact_id, alphaCommit=candidate["sourceCommit"], sdkCommit=candidate["sdkCommit"],
               versionCode=candidate["versionCode"], updateChannel=candidate["updateChannel"],
               candidateReceiptSHA256=digest(candidate_bytes), producerManifestSHA256=digest(producer_bytes),
               unsignedApkSHA256={variant: candidate["apks"][variant]["sha256"] for variant in VARIANTS},
               privateStorage=storage)
    if input_generation is not None:
        storage.update(inputGeneration=input_generation,
                       outputObject=f"signed/{archive_hash}/{delivery_id}/signed-apks.tar")
        validate_private_storage(pin)
    github_candidate(pin, api)
    admit(archive, pin)
    if input_generation is not None:
        return pin
    return {"schema": "alpha-candidate-mirror-request/v1", "artifactId": artifact_id,
            "mirror": {"bucket": PRIVATE_APK_BUCKET, "object": input_object, "bytes": pin["archiveBytes"],
                       "sha256": archive_hash}}


def fetch_candidate(archive, artifact_id, *, api=gh_json, download=download_github_archive):
    require(not os.path.lexists(archive), "Candidate archive destination already exists")
    pins = github_candidate_download_pins(artifact_id, api)
    with TemporaryDirectory(prefix=".alpha-candidate-", dir=archive.parent) as temporary:
        downloaded = Path(temporary) / "candidate.zip"
        download(pins, downloaded)
        request = prepare_candidate(downloaded, artifact_id, api=api)
        require(request["mirror"]["bytes"] == pins["archiveBytes"] and
                request["mirror"]["sha256"] == pins["archiveSHA256"],
                "Candidate artifact changed during download")
        os.link(downloaded, archive)
    return request


def candidate_cli(command, argv):
    parser = argparse.ArgumentParser(prog=f"{Path(sys.argv[0]).name} {command}",
                                     description="Prepare an Alpha native candidate signing handoff")
    parser.add_argument("archive", type=Path)
    parser.add_argument("artifact_id")
    if command == "prepare-candidate":
        parser.add_argument("--input-generation")
        parser.add_argument("--delivery-id")
    args = parser.parse_args(argv)
    try:
        if command == "fetch-candidate":
            plan = fetch_candidate(args.archive, args.artifact_id)
        else:
            plan = prepare_candidate(args.archive, args.artifact_id, input_generation=args.input_generation,
                                     delivery_id=args.delivery_id)
        print(json.dumps(plan, indent=2))
    except (KeyError, TypeError, ValueError, OSError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Refused candidate signing handoff: {error}\n")
    except subprocess.SubprocessError:
        parser.exit(1, "Refused candidate signing handoff: GitHub metadata or download failed.\n")


if __name__ == "__main__":
    if sys.argv[1:2] in (["fetch-candidate"], ["prepare-candidate"]):
        candidate_cli(sys.argv[1], sys.argv[2:])
        sys.exit(0)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("reviewed_pins", type=Path)
    parser.add_argument("--stage", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(admit(args.archive, json.loads(args.reviewed_pins.read_text()), args.stage), indent=2))
    except (KeyError, TypeError, ValueError, OSError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Refused Cloud signing input: {error}\n")
