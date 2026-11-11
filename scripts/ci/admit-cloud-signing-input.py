"""Read-only admission of a reviewed Alpha Cloud producer archive before signing."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import zipfile

from app_update_producer import (
    CANDIDATE, CANDIDATE_PACKAGE, MAX_ARCHIVE_BYTES, PRIVATE_RUNNER, REPOSITORY, WORKFLOW, WORKFLOW_ID,
    matches, producer_kind,
)

VARIANTS = ("standalone", "launcher")
# The approved pre-migration Cloud producer keeps its installed Android identity.
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


def candidate_evidence(data, pin, apk_manifest):
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
            files.get("test-results/resident-ci-native-inputs/admission.json"),
            "Candidate native input admission differs from frozen source")
    native = json.loads(native_bytes)
    require(native["schema"] == "alpha-hosted-native-input-admission/v1" and
            native["source"] == pin["alphaCommit"] and native["sdkCommit"] == pin["sdkCommit"] and
            native["packageName"] == CANDIDATE_PACKAGE and native["runId"] == pin["producerRunId"] and
            native["attempt"] == str(pin["producerRunAttempt"]), "Candidate native input identity differs")
    for field, path in (("manifestSha256", "android/hosted-native-inputs.json"),
                        ("voiceRecordSha256", "android/voice-host/qualified-voice-host.json"),
                        ("embeddingRecordSha256", "android/embedding-host/qualified-host.json")):
        require(matches(SHA, native[field]) and native[field] == files.get(path),
                f"Candidate native input record differs from {path}")
    require(isinstance(candidate["apks"], dict) and set(candidate["apks"]) == set(VARIANTS),
            "Candidate receipt must bind exactly both release variants")
    return candidate["apks"]


def admit(archive, pin, stage=None):
    kind = producer_kind(pin)
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
            names = {}
            for entry in bundle.infolist():
                require(entry.filename not in names, "Archive contains a duplicate entry")
                names[entry.filename] = entry

            def member(name, limit):
                entry = names.get(name)
                mode = stat.S_IFMT(entry.external_attr >> 16) if entry else None
                require(entry and not entry.is_dir() and mode in (0, stat.S_IFREG) and
                        not (entry.flag_bits & 1) and 0 < entry.file_size <= limit,
                        f"Missing, nonregular or oversized archive member: {name}")
                return entry

            def data(name):
                return bundle.read(member(name, 4 * 1024**2))

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
            producer = json.loads(producer_bytes)
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
            candidate_apks = candidate_evidence(data, pin, apk_manifest) if kind == CANDIDATE else None
            verified = json.loads(apk_manifest)
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
            admitted = {}
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
                apk_member = member(name, 400_000_000)
                if candidate_apks is not None:
                    require(candidate_apks[variant] == {"file": name, "bytes": apk_member.file_size, "sha256": apks[variant]},
                            f"{variant} candidate receipt differs from the exact APK")
                    voice = row["voiceHost"]
                    require(row.get("distributable") is False and voice["packaged"] is True and
                            voice["asr"] is True and voice["differences"] == [],
                            f"{variant} candidate requires admitted on-device voice with ASR")
                with bundle.open(apk_member) as apk:
                    actual = hashlib.file_digest(apk, "sha256").hexdigest()
                require(actual == apks[variant], f"{variant} APK bytes differ")
                admitted[variant] = actual
            if stage is not None:
                stage.mkdir(mode=0o700)
                for variant in VARIANTS:
                    name = f"{variant}-release-unsigned.apk"
                    output = stage / name
                    with bundle.open(member(name, 400_000_000)) as source, output.open("xb") as target:
                        shutil.copyfileobj(source, target)
                    with output.open("rb") as target:
                        require(hashlib.file_digest(target, "sha256").hexdigest() == admitted[variant],
                                f"Staged {variant} APK bytes differ")
    return {"source": pin["alphaCommit"], "sdk": pin["sdkCommit"], "versionCode": pin["versionCode"],
            "updateChannel": channel, "unsignedApkSHA256": admitted, "inputVerified": True, "signed": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("reviewed_pins", type=Path)
    parser.add_argument("--stage", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(admit(args.archive, json.loads(args.reviewed_pins.read_text()), args.stage), indent=2))
    except (KeyError, TypeError, ValueError, OSError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Refused Cloud signing input: {error}\n")
