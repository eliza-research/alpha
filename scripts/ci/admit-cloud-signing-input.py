"""Read-only admission of a reviewed Alpha Cloud producer archive before signing."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import zipfile

VARIANTS = ("standalone", "launcher")
PACKAGE = "ai.alphacompute.alphaphone"
SHA = re.compile("[0-9a-f]{64}")
COMMIT = re.compile("[0-9a-f]{40}")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def single_profile(record):
    """Admit the packaged Cloud profile used by this release workflow."""
    return record["runtimeProfile"] == "cloud" and "localEmbeddings" not in record


def reviewed_private_producer(plan, descriptor):
    fields = ("alphaCommit", "sdkCommit", "versionCode", "updateChannel", "archiveBytes",
              "archiveSHA256", "producerManifestSHA256", "privateProducerReceiptSHA256", "unsignedApkSHA256")
    approval = {"approval": "approved", **{key: plan.get(key) for key in fields}}
    return isinstance(plan.get("privateStorage"), dict) and descriptor.get("privateProducerApproval") == approval


def admit(archive, pin, stage=None):
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
    require(archive.is_file() and not archive.is_symlink() and archive.stat().st_size <= 1_500_000_000,
            "Archive must be a bounded regular file")
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

            if pin.get("privateStorage") is not None:
                private_bytes = data("private-producer.json")
                require(digest(private_bytes) == pin["privateProducerReceiptSHA256"],
                        "Private producer receipt differs from the reviewed digest")
                private = json.loads(private_bytes)
                require(private["schema"] == 1 and
                        private["producerKind"] == "root-reviewed-private-runner" and
                        private["project"] == "alpha-aosp-lab-20261024" and
                        private["instanceId"] == "8999310923263914877" and
                        private["alphaCommit"] == pin["alphaCommit"] and
                        private["sdkCommit"] == pin["sdkCommit"] and
                        private["versionCode"] == pin["versionCode"] and
                        private["unsignedApkSHA256"] == apks and single_profile(private),
                        "Private producer identity differs from the reviewed build")
                require(private.get("updateChannel") == channel, "Private producer update channel differs")
                for check in ("productSourceGuard", "sdkSourceGuard", "normalPreparation",
                              "combinedVerification", "apkArchive"):
                    require(private["checks"][check] == "passed", f"Private build did not pass {check}")

            producer_bytes = data("producer-evidence/manifest.json")
            require(digest(producer_bytes) == pin["producerManifestSHA256"], "Producer manifest digest differs")
            producer = json.loads(producer_bytes)
            require(producer["source"] == pin["alphaCommit"] and producer["versionCode"] == pin["versionCode"]
                    and single_profile(producer),
                    "Producer source, version or runtime profile differs")
            require(producer.get("updateChannel") == channel, "Producer update channel differs")
            apk_manifest = data("apk-verification.json")
            require(apk_manifest == data("producer-evidence/artifacts/apk-manifest.json"),
                    "Producer and archive APK verification records differ")
            build = data("producer-evidence/artifacts/build-config.json")
            for name, value in (("artifacts/apk-manifest.json", apk_manifest), ("artifacts/build-config.json", build)):
                require(producer["files"][name] == {"bytes": len(value), "sha256": digest(value)},
                        f"Producer evidence does not bind {name}")
            verified = json.loads(apk_manifest)
            require(verified.get("updateChannel") == channel, "Verified update channel differs")
            require(verified["upstream"]["commit"] == pin["sdkCommit"], "Verified SDK commit differs")
            require(single_profile(verified) and verified["testMocks"] is False
                    and verified.get("allowUnpackagedRuntime") is False,
                    "APK verification is outside the reviewed distribution profile")
            config = json.loads(build)
            require(config.get("updateChannel") == channel, "Build update channel differs")
            require(single_profile(config) and config["testMocks"] is False and config["signingRequested"] is False
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
                require(row["file"] == f"artifacts/{name}" and row["packageName"] == PACKAGE
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
                with bundle.open(member(name, 400_000_000)) as apk:
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
