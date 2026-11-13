"""Reverify a retained unsigned Cloud archive, then admit only its signed launcher.

The immutable producer verifier still inspects its original unsigned pair. This
Alpha-owned handoff verifies unchanged ZIP payloads plus the exact v3 signature,
lineage and reviewed voice receipt. It never signs or publishes an APK.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import zipfile

from app_update_producer import PRIVATE_RUNNER, apk_member_limit, input_contract

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("cloud_launcher_qualification", ROOT / "scripts/ci/qualified-app-update.py")
QUALIFIED = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(QUALIFIED)
require = QUALIFIED.require


def identical_zip_payload(unsigned, signed, unsigned_sha, signed_sha):
    """All original local ZIP bytes and directory facts survive v3 signing."""
    limit = apk_member_limit(PRIVATE_RUNNER)
    with QUALIFIED.open_bounded(unsigned, limit) as (before, _), QUALIFIED.open_bounded(signed, limit) as (after, _):
        for source, expected in ((before, unsigned_sha), (after, signed_sha)):
            require(QUALIFIED.hashlib.file_digest(source, "sha256").hexdigest() == expected, "APK payload digest differs")
            source.seek(0)
        with zipfile.ZipFile(before) as original, zipfile.ZipFile(after) as replacement:
            left, right = original.infolist(), replacement.infolist()
            names = [entry.filename for entry in left]
            require(names and len(names) == len(set(names)) and names == [entry.filename for entry in right],
                    "Signed ZIP has missing, extra, duplicate or reordered members")
            require(original.comment == replacement.comment, "Signed ZIP archive metadata differs")
            facts = ("compress_type", "flag_bits", "file_size", "compress_size", "CRC", "date_time",
                     "external_attr", "internal_attr", "create_system", "create_version", "extract_version",
                     "extra", "comment", "header_offset")
            for old, new in zip(left, right):
                relative = PurePosixPath(old.filename)
                require(not relative.is_absolute() and "\\" not in old.filename and
                        all(part not in (".", "..") for part in relative.parts) and not old.flag_bits & 1 and
                        stat.S_IFMT(old.external_attr >> 16) in (0, stat.S_IFREG, stat.S_IFDIR),
                        "Unsafe ZIP member")
                require(all(getattr(old, fact) == getattr(new, fact) for fact in facts), "Signed ZIP member metadata differs")
                # Reading both streams also checks their recorded CRCs.
                with original.open(old) as a, replacement.open(new) as b:
                    while chunk := a.read(1024 * 1024):
                        require(chunk == b.read(len(chunk)), "Signed ZIP entry bytes differ")
                    require(b.read(1) == b"", "Signed ZIP entry bytes differ")
            # apksigner's v3 block is outside the ZIP entries, immediately before
            # the central directory. Preserve every earlier byte, including
            # compressed data, local headers and alignment padding.
            prefix = original.start_dir
            require(replacement.start_dir > prefix, "Signed APK has no added signing block")
        before.seek(0)
        after.seek(0)
        remaining = prefix
        while remaining:
            chunk = before.read(min(1024 * 1024, remaining))
            require(chunk and chunk == after.read(len(chunk)), "Signed ZIP local payload bytes differ")
            remaining -= len(chunk)
        for source, expected in ((before, unsigned_sha), (after, signed_sha)):
            source.seek(0)
            require(QUALIFIED.hashlib.file_digest(source, "sha256").hexdigest() == expected, "APK changed during payload verification")
    return {"schema": "alpha-signed-zip-payload/v1", "unsignedApkSHA256": unsigned_sha,
            "signedApkSHA256": signed_sha, "members": len(names), "unchangedLocalBytes": prefix}


def unsigned_release(manifest, plan):
    require(manifest["upstream"]["commit"] == plan["sdkCommit"] and
            manifest["runtimeProfile"] == "cloud" and manifest["testMocks"] is False and
            manifest["allowUnpackagedRuntime"] is False and "localEmbeddings" not in manifest and
            manifest["updateChannel"] == plan["updateChannel"], "Unsigned verifier context differs")
    releases = [row for row in manifest["results"] if row["mode"] == "release"]
    require(len(releases) == 2 and {row["variant"] for row in releases} == {"standalone", "launcher"},
            "Unsigned verifier must inspect both original inputs")
    for row in releases:
        variant = row["variant"]
        require(row["file"] == f"artifacts/{variant}-release-unsigned.apk" and
                row["sha256"] == plan["unsignedApkSHA256"][variant] and row["signed"] is False and
                row["signerSha256"] is None and row["distributable"] is False and
                row["versionCode"] == plan["versionCode"] and row["packageName"] == "ai.elizaresearch.alphaphone" and
                row["runtimeProfile"] == "cloud" and row["updateChannel"] == plan["updateChannel"] and
                row["testMocks"] is False and row["debuggable"] is False and row["home"] is (variant == "launcher") and
                row["launcher"] is True and row["webPayload"] is True and row["runtime"] == "PACKAGED" and
                row["runtimeNotices"] is True and row["bundleAudit"] == "passed" and row["licenceBlockers"] == [] and
                row["releaseAdmission"]["failures"] == [] and row["releaseAdmission"]["blockers"] == ["unsigned release"] and
                row["voiceHost"]["packaged"] is False and row["voiceHost"]["differences"] == [],
                "Original unsigned release did not pass legacy verification")
        runtime = [entry for entry in manifest["runtimePackaging"] if entry["apk"] == row["file"]]
        require(len(runtime) == 1 and runtime[0]["runtime"] == "PACKAGED" and runtime[0]["distributable"] is True and
                runtime[0]["release"] is True and runtime[0]["runtimeProfile"] == "cloud" and
                runtime[0]["upstreamCommit"] == plan["sdkCommit"] and runtime[0]["runtimeExecution"] is False,
                "Unsigned runtime byte verification differs")
    return next(row for row in releases if row["variant"] == "launcher")


def verify_signature(record, plan, work, signed, descriptor, *, run=subprocess.run):
    rotation = descriptor["apkSigningRotation"]
    require(rotation["approval"] == "approved" and rotation["versionCode"] == plan["versionCode"] and
            rotation["unsignedApkSHA256"] == {"launcher": plan["unsignedApkSHA256"]["launcher"]},
            "Rotation must approve only this launcher output")
    raw_lineage = QUALIFIED.PRODUCER.approved_cloud_rotation(plan, descriptor)
    with QUALIFIED.signed_bundle(work / "signed.tar", record["signedBundle"], plan,
                                 QUALIFIED.read_bounded(work / "signing-plan.json", QUALIFIED.PLAN_LIMIT)) as (archive, entries, _):
        require(archive.extractfile(entries["rotation.lineage"]).read(65537) == raw_lineage and
                archive.extractfile(entries["production-signer.sha256"]).read(66) ==
                (descriptor["signerSha256"] + "\n").encode(), "Signed bundle signer or lineage differs")
    lineage = work / "qualified-rotation.lineage"
    with lineage.open("xb") as output:
        output.write(raw_lineage)
    tools = Path(os.environ["ANDROID_HOME"]) / "build-tools/36.0.0"
    signer, jar = tools / "apksigner", tools / "lib/apksigner.jar"
    require(QUALIFIED.file_sha(signer) == rotation["apksignerSha256"] and
            QUALIFIED.file_sha(jar) == rotation["verifierJarSha256"], "Rotation verifier tool differs")
    run([str(tools / "zipalign"), "-c", "-P", "16", "4", str(signed)], check=True)
    command = [str(Path(os.environ["JAVA_HOME"]) / "bin/java"), "-cp", str(jar),
               str(ROOT / "scripts/owner/VerifyApkRotation.java"), "--signed-output", str(signed), str(lineage),
               record["signedApkSHA256"]["launcher"], rotation["lineageSha256"], rotation["previousSignerSha256"],
               descriptor["signerSha256"], "ai.elizaresearch.alphaphone", "29", "37"]
    if rotation.get("preserveSignaturePermissions") is True:
        command.append("--preserve-signature-permissions")
    result = run(command, check=True, capture_output=True, timeout=120)
    proof = QUALIFIED.decode(result.stdout)
    require(isinstance(proof, dict) and proof.get("verified") is True and
            proof == {"verified": True, "minApi": 29, "maxApi": 37, "versionCode": plan["versionCode"]},
            "Signed launcher rotation admission differs")
    return proof


def verify(record, work, product, *, run=subprocess.run):
    plan, plan_bytes, voice_bytes = QUALIFIED.validate(record)
    require(input_contract(plan)["runtimeProfile"] == "cloud" and
            QUALIFIED.PRODUCER.reviewed_private_producer(plan, QUALIFIED.decode((ROOT / "android/release-signer.json").read_bytes())),
            "Exact approved retained Cloud input required")
    QUALIFIED.PRODUCER.approved_cloud_rotation(plan, QUALIFIED.decode((ROOT / "android/release-signer.json").read_bytes()))
    require(QUALIFIED.read_bounded(work / "signing-plan.json", QUALIFIED.PLAN_LIMIT) == plan_bytes,
            "Staged signing plan differs")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=product, text=True).strip()
    require(head == plan["alphaCommit"] and QUALIFIED.decode((product / "upstream.lock.json").read_bytes())["commit"] == plan["sdkCommit"],
            "Unsigned verifier source differs")
    QUALIFIED.PRODUCER.admit(work / "producer.zip", plan, source_root=product)
    output = product / "artifacts/apk-manifest.json"
    with zipfile.ZipFile(work / "producer.zip") as archive:
        original = archive.read("apk-verification.json")
    require(QUALIFIED.read_bounded(output, 4 * 1024**2) == original, "Restored producer manifest differs")
    with (work / "producer-apk-verification.json").open("xb") as evidence:
        evidence.write(original)
    output.unlink(missing_ok=True)
    # No source rewriting or variant/signature bypass: the historical command
    # runs with both original unsigned releases and both debug inputs.
    run([os.environ.get("ALPHA_BUN", "bun"), "run", "android:verify", "--", "--runtime-profile=cloud"],
        cwd=product, check=True)
    raw = QUALIFIED.read_bounded(output, 4 * 1024**2)
    manifest = QUALIFIED.decode(raw)
    launcher = unsigned_release(manifest, plan)
    with (work / "unsigned-apk-verification.json").open("xb") as evidence:
        evidence.write(raw)
    signed = work / "signed/launcher-release.apk"
    payload = identical_zip_payload(product / "artifacts/launcher-release-unsigned.apk", signed,
                                    plan["unsignedApkSHA256"]["launcher"], record["signedApkSHA256"]["launcher"])
    descriptor = QUALIFIED.decode((ROOT / "android/release-signer.json").read_bytes())
    last = descriptor["lastRelease"]["versionCode"]
    require(last is None or plan["versionCode"] > last, "Launcher must advance the released version")
    proof = verify_signature(record, plan, work, signed, descriptor, run=run)
    # validate() already required exactly this signed hash and every content-free
    # Cartesia check, with no additional fields or second APK qualification.
    voice = QUALIFIED.decode(voice_bytes)["results"][0]
    row = {**launcher, "file": "artifacts/launcher-release.apk", "signed": True,
           "sha256": record["signedApkSHA256"]["launcher"], "signerSha256": descriptor["signerSha256"],
           "signerApiLevel": 29,
           "releaseAdmission": {"failures": [], "blockers": [], "signerMatches": True}, "distributable": True,
           "cloudVoice": {"format": "alpha-cloud-voice-admission-v1", "apkSha256": voice["apkSha256"],
                          "evidenceSha256": record["cloudVoiceEvidenceSHA256"], "provider": "cartesia",
                          "outcome": "passed", "checks": voice["checks"]}}
    admission = {"schema": "alpha-retained-cloud-launcher/v1", "producerCommit": plan["alphaCommit"],
                 "sdkCommit": plan["sdkCommit"], "admissionCommit": subprocess.check_output(
                     ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                 "producerVerificationSHA256": QUALIFIED.sha(original),
                 "unsignedVerificationSHA256": QUALIFIED.sha(raw), "payload": payload, "signature": proof}
    # This is explicitly Alpha's derived admission, not another producer output.
    derived = {**manifest, "evidence": "alpha-signed-payload-admission", "results": [row],
               "signedPayloadAdmission": admission,
               "signing": {**manifest["signing"], "release": {"signed": True, "signerSha256": descriptor["signerSha256"]},
                           "apiLevel": 29, "scope": "Pinned verifier checked every Android API 29–37; device admission remains separate"},
               "mappings": {"launcher": manifest.get("mappings", {}).get("launcher")},
               "instrumentation": {key: value for key, value in manifest.get("instrumentation", {}).items() if key == "launcher"}}
    # Keep runtimePackaging attributed to the unsigned verifier in its original
    # raw evidence, rather than relabeling those input paths as signed outputs.
    derived.pop("runtimePackaging", None)
    with signed.open("rb") as content:
        QUALIFIED.restore_file(product, row["file"], content, signed.stat().st_size, row["sha256"], "Signed launcher changed")
    with (work / "signed-payload-admission.json").open("x") as evidence:
        json.dump(admission, evidence, indent=2)
        evidence.write("\n")
    output.write_text(json.dumps(derived, indent=2) + "\n")
    return admission


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("record", type=Path)
    parser.add_argument("--work", required=True, type=Path)
    parser.add_argument("--product", required=True, type=Path)
    args = parser.parse_args()
    try:
        verify(QUALIFIED.decode(QUALIFIED.read_bounded(args.record, 131072)), args.work.resolve(strict=True),
               args.product.resolve(strict=True))
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError, zipfile.BadZipFile):
        raise SystemExit("Retained Cloud launcher refused; preserve the original unsigned and signature evidence. Nothing was published.")
