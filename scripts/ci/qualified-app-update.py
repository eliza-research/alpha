"""Admit a reviewed post-signing qualification and stage exact private output.

This composes the existing private producer admission. It never signs, publishes,
decrypts CMS or accepts credentials in a qualification record. The embedded voice
receipt is an explicit human-reviewed assertion, not authenticated acoustic QA.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tarfile
import tempfile
from urllib.parse import quote, urlencode
import zipfile

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = "eliza-research/alphaphone"
HEX = re.compile(r"[0-9a-f]{64}")
COMMIT = re.compile(r"[0-9a-f]{40}")
NUMBER = re.compile(r"[1-9][0-9]{0,15}")
VARIANTS = ("standalone", "launcher")
CHECKS = {"consent", "session", "acousticInput", "blueBar", "transcript",
          "audibleSpeakerReply", "mute", "unmute", "stopReleased"}
FIELDS = {"schema", "signingWorkflowCommit", "signingRunId", "signingRunAttempt",
          "deliveryArtifactId", "deliveryArtifactSHA256", "deliveryArtifactBytes",
          "signingPlanBase64", "signingPlanSHA256", "signedBundle", "signedApkSHA256",
          "cloudVoiceEvidenceBase64", "cloudVoiceEvidenceSHA256"}


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


STORAGE = module("qualified_private_storage", "scripts/ci/private-apk-storage.py")
PRODUCER = module("qualified_producer_admission", "scripts/ci/admit-cloud-signing-input.py")


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def pairs(rows):
    value = {}
    for key, item in rows:
        require(key not in value, "Duplicate JSON field")
        value[key] = item
    return value


def decode(data):
    return json.loads(data.decode("utf-8", errors="strict"), object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-JSON number")))


def encoded(record, field, limit):
    text = record.get(field + "Base64")
    require(isinstance(text, str) and len(text) <= 4 * limit, "Invalid encoded evidence")
    value = base64.b64decode(text, validate=True)
    require(0 < len(value) <= limit and sha(value) == record.get(field + "SHA256"),
            "Evidence bytes differ from reviewed digest")
    return value


def validate(record):
    require(isinstance(record, dict) and set(record) == FIELDS and
            record["schema"] == "alpha-qualified-app-update/v1", "Invalid qualification record")
    require(COMMIT.fullmatch(record["signingWorkflowCommit"]), "Invalid signing workflow commit")
    for field in ("signingRunId", "deliveryArtifactId"):
        require(isinstance(record[field], str) and NUMBER.fullmatch(record[field]), "Invalid run or artifact ID")
    require(type(record["signingRunAttempt"]) is int and 0 < record["signingRunAttempt"] < 10000,
            "Exact signing run attempt required")
    require(type(record["deliveryArtifactBytes"]) is int and 0 < record["deliveryArtifactBytes"] <= 131072,
            "Delivery receipt artifact exceeds bound")
    require(isinstance(record["deliveryArtifactSHA256"], str) and HEX.fullmatch(record["deliveryArtifactSHA256"]),
            "Invalid delivery artifact digest")
    plan_bytes = encoded(record, "signingPlan", 32768)
    plan = decode(plan_bytes)
    # CMS delivery needs an operator's private key and is deliberately unsupported.
    require(isinstance(plan, dict) and plan.get("privateStorage") is not None,
            "Only existing privateStorage delivery is supported; CMS is not admitted")
    storage = STORAGE.validate(plan)
    require(plan.get("updateChannel", {}).get("kind") == "public" and
            plan.get("purpose") != "private-update-qa-baseline", "Public channel qualification required")
    require(COMMIT.fullmatch(plan["alphaCommit"]) and COMMIT.fullmatch(plan["sdkCommit"]), "Invalid producer source")
    bundle = record["signedBundle"]
    require(isinstance(bundle, dict) and set(bundle) == {"bucket", "object", "generation", "bytes", "sha256", "public"},
            "Exact private signing receipt required")
    require(bundle["bucket"] == STORAGE.BUCKET and bundle["object"] == storage["outputObject"] and
            isinstance(bundle["generation"], str) and re.fullmatch(r"[1-9][0-9]{0,24}", bundle["generation"]) and
            type(bundle["bytes"]) is int and 0 < bundle["bytes"] <= STORAGE.MAX_BYTES and
            isinstance(bundle["sha256"], str) and HEX.fullmatch(bundle["sha256"]) and bundle["public"] is False,
            "Signed output differs from the reviewed private delivery")
    apks = record["signedApkSHA256"]
    require(isinstance(apks, dict) and set(apks) == set(VARIANTS) and
            all(isinstance(value, str) and HEX.fullmatch(value) for value in apks.values()) and
            len(set(apks.values())) == 2, "Exactly two distinct signed APK hashes required")
    voice_bytes = encoded(record, "cloudVoiceEvidence", 16384)
    voice = decode(voice_bytes)
    require(isinstance(voice, dict) and set(voice) == {"format", "results"} and
            voice["format"] == "alpha-cloud-voice-qualification-v1" and
            isinstance(voice["results"], list) and len(voice["results"]) == 2, "Content-free voice receipt required")
    observed = []
    for row in voice["results"]:
        require(isinstance(row, dict) and set(row) == {"apkSha256", "provider", "outcome", "checks"} and
                row["provider"] == "cartesia" and row["outcome"] == "passed" and
                isinstance(row["checks"], dict) and set(row["checks"]) == CHECKS and
                all(value is True for value in row["checks"].values()), "Voice qualification incomplete or contains extra fields")
        observed.append(row["apkSha256"])
    require(len(set(observed)) == 2 and set(observed) == set(apks.values()), "Voice receipt does not name exact signed APKs")
    return plan, plan_bytes, voice_bytes


def gh_json(endpoint):
    result = subprocess.run(["gh", "api", endpoint], check=True, capture_output=True, timeout=60)
    require(len(result.stdout) <= 1048576, "GitHub metadata exceeds bound")
    return decode(result.stdout)


def gh_download(endpoint, destination, size, digest):
    # The trusted GitHub API metadata and reviewed archive digest bind this read.
    # RLIMIT_FSIZE also bounds bytes before a failed request can consume disk.
    import resource
    def bound():
        resource.setrlimit(resource.RLIMIT_FSIZE, (size, size))
    with destination.open("xb") as target:
        subprocess.run(["gh", "api", endpoint], stdout=target, stderr=subprocess.DEVNULL,
                       check=True, timeout=120, preexec_fn=bound)
    require(destination.stat().st_size == size and file_sha(destination) == digest,
            "Downloaded delivery artifact differs from reviewed bytes")


def preflight(record, workflow_commit, work, api=gh_json, download=gh_download):
    plan, plan_bytes, voice_bytes = validate(record)
    require(COMMIT.fullmatch(workflow_commit), "Exact publication workflow commit required")
    for source in (plan["alphaCommit"], record["signingWorkflowCommit"]):
        compared = api(f"repos/{REPOSITORY}/compare/{source}...{workflow_commit}")
        require(compared.get("status") in ("ahead", "identical") and
                compared.get("merge_base_commit", {}).get("sha") == source,
                "Producer or signing workflow is not on reviewed main history")
    run = api(f"repos/{REPOSITORY}/actions/runs/{record['signingRunId']}")
    require(run.get("status") == "completed" and run.get("conclusion") == "success" and
            run.get("event") == "workflow_dispatch" and run.get("head_branch") == "main" and
            run.get("head_sha") == record["signingWorkflowCommit"] and
            run.get("head_repository", {}).get("full_name") == REPOSITORY and
            run.get("path") == ".github/workflows/release-cloud-app-signing.yml" and
            run.get("run_attempt") == record["signingRunAttempt"], "Signing run identity differs")
    artifact = api(f"repos/{REPOSITORY}/actions/artifacts/{record['deliveryArtifactId']}")
    require(artifact.get("expired") is False and str(artifact.get("workflow_run", {}).get("id")) == record["signingRunId"] and
            artifact.get("workflow_run", {}).get("head_sha") == record["signingWorkflowCommit"] and
            artifact.get("name") == f"private-cloud-apk-delivery-{record['signingRunId']}-{record['signingRunAttempt']}" and
            artifact.get("size_in_bytes") == record["deliveryArtifactBytes"] and
            artifact.get("digest") == "sha256:" + record["deliveryArtifactSHA256"], "Signing delivery artifact identity differs")
    work.mkdir(mode=0o700, parents=True, exist_ok=False)
    receipt_zip = work / "delivery.zip"
    download(f"repos/{REPOSITORY}/actions/artifacts/{record['deliveryArtifactId']}/zip", receipt_zip,
             record["deliveryArtifactBytes"], record["deliveryArtifactSHA256"])
    with zipfile.ZipFile(receipt_zip) as archive:
        entries = [entry for entry in archive.infolist() if not entry.is_dir()]
        require(len(entries) == 1 and entries[0].filename == "private-storage-receipt.json" and
                entries[0].file_size <= 65536 and not entries[0].flag_bits & 1 and
                stat.S_IFMT(entries[0].external_attr >> 16) in (0, stat.S_IFREG), "Unexpected signing artifact members; CMS is unsupported")
        require(decode(archive.read(entries[0])) == record["signedBundle"], "Signing run receipt differs from reviewed output")
    (work / "signing-plan.json").write_bytes(plan_bytes)
    (work / "cloud-voice.json").write_bytes(voice_bytes)
    return plan


def signed_download(plan, receipt, destination):
    require(receipt["object"] == STORAGE.validate(plan)["outputObject"], "Unbound signed output")
    conn, headers = STORAGE.connection()
    route = "/storage/v1/b/" + STORAGE.BUCKET + "/o/" + quote(receipt["object"], safe="")
    generation = {"generation": receipt["generation"]}
    try:
        metadata = STORAGE.read_json(conn, "GET", route + "?" + urlencode(generation), headers)
        require(metadata.get("bucket") == receipt["bucket"] and metadata.get("name") == receipt["object"] and
                metadata.get("generation") == receipt["generation"] and int(metadata["size"]) == receipt["bytes"],
                "Signed object generation or size differs")
        conn.request("GET", route + "?" + urlencode({**generation, "alt": "media"}), headers=headers)
        response = conn.getresponse()
        require(response.status == 200, "Signed object download refused; no redirects")
        size, digest = 0, hashlib.sha256()
        with destination.open("xb") as target:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                require(size <= receipt["bytes"], "Signed object exceeds reviewed size")
                digest.update(chunk)
                target.write(chunk)
        require(size == receipt["bytes"] and digest.hexdigest() == receipt["sha256"], "Signed object bytes differ")
    finally:
        conn.close()


def copy_verified(source, size, expected_digest, failure, destination=None):
    digest = hashlib.sha256()
    remaining = size
    while chunk := source.read(min(1024 * 1024, remaining + 1)):
        remaining -= len(chunk)
        require(remaining >= 0, failure)
        digest.update(chunk)
        if destination is not None:
            destination.write(chunk)
    require(remaining == 0 and digest.hexdigest() == expected_digest, failure)


def restore_file(root, name, source, size, digest, failure):
    relative = PurePosixPath(name)
    require(not relative.is_absolute() and all(part not in ("..", ".git") for part in relative.parts), "Unsafe evidence path")
    target = root.joinpath(*relative.parts)
    for ancestor in (target, *target.parents):
        require(not ancestor.is_symlink(), "Symlink in restored evidence path")
        if ancestor == root:
            break
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".verified-", delete=False) as output:
        temporary = Path(output.name)
        try:
            copy_verified(source, size, digest, failure, output)
            output.close()
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)


def stage(record, plan, work, product, fetch_unsigned=STORAGE.download, fetch_signed=signed_download):
    unsigned, signed = work / "producer.zip", work / "signed.tar"
    fetch_unsigned(plan, unsigned)
    PRODUCER.admit(unsigned, plan)
    fetch_signed(plan, record["signedBundle"], signed)
    require(signed.stat().st_size == record["signedBundle"]["bytes"] and
            file_sha(signed) == record["signedBundle"]["sha256"], "Signed bundle bytes differ")
    with zipfile.ZipFile(unsigned) as archive:
        producer = decode(archive.read("producer-evidence/manifest.json"))
        inventory = producer["files"]
        require(isinstance(inventory, dict) and len(inventory) <= 4096, "Invalid producer inventory")
        total = 0
        for name, fact in inventory.items():
            allowed = name in ("artifacts/build-config.json", "artifacts/apk-manifest.json", "native-source-manifest.json", "prepared-source-stamp.json", "worker-manifest.json") or name.startswith(("artifacts/sbom/", "apps/app/public/licenses/", "licenses/", "android/app/src/main/assets/agent/", "android/app/src/main/jniLibs/"))
            require(allowed and isinstance(fact, dict) and set(fact) == {"bytes", "sha256"} and
                    type(fact["bytes"]) is int and 0 < fact["bytes"] <= 512 * 1024**2, "Unsupported producer evidence path")
            total += fact["bytes"]
            require(total <= 512 * 1024**2, "Producer evidence exceeds restore bound")
            entry = archive.getinfo("producer-evidence/" + name)
            require(entry.file_size == fact["bytes"] and stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG) and not entry.flag_bits & 1, "Invalid evidence member")
            with archive.open(entry) as content:
                failure = "Producer evidence bytes differ"
                if name in ("prepared-source-stamp.json", "worker-manifest.json"):
                    copy_verified(content, fact["bytes"], fact["sha256"], failure)
                else:
                    target = "android/app/build/generated/local-agent/source-manifest.json" if name == "native-source-manifest.json" else name
                    restore_file(product, target, content, fact["bytes"], fact["sha256"], failure)
        verified = decode(archive.read("apk-verification.json"))
        for variant in VARIANTS:
            name = variant + "-debug.apk"
            rows = [row for row in verified["results"] if row.get("mode") == "debug" and row.get("variant") == variant]
            require(len(rows) == 1, "Producer debug APK is required for full verification")
            entry = archive.getinfo(name)
            require(0 < entry.file_size <= 400_000_000 and stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG) and not entry.flag_bits & 1, "Invalid debug archive member")
            with archive.open(entry) as content:
                restore_file(product, "artifacts/" + name, content, entry.file_size,
                             rows[0]["sha256"], "Producer debug APK bytes differ")
    expected = {v + "-release.apk" for v in VARIANTS} | {"signed.sha256", "signing-plan.json", "production-signer.sha256"}
    if plan.get("rotation") is not None:
        expected.add("rotation.lineage")
    with tarfile.open(signed, "r:") as archive:
        members = archive.getmembers()
        require(len(members) == len(expected) and {item.name for item in members} == expected and
                all(item.isfile() and 0 < item.size <= 400_000_000 for item in members), "Unexpected signed bundle members")
        with archive.extractfile("signing-plan.json") as source:
            require(source.read(32769) == (work / "signing-plan.json").read_bytes(), "Signed bundle plan differs")
        expected_lines = {f"{record['signedApkSHA256'][v]}  {v}-release.apk" for v in VARIANTS}
        with archive.extractfile("signed.sha256") as source:
            checksum = source.read(257)
        require(len(checksum) <= 256 and set(checksum.decode("ascii").strip().splitlines()) == expected_lines,
                "Signed checksum receipt differs")
        for variant in VARIANTS:
            name = variant + "-release.apk"
            member = archive.getmember(name)
            with archive.extractfile(member) as content:
                restore_file(product, "artifacts/" + name, content, member.size,
                             record["signedApkSHA256"][variant], "Signed APK bytes differ from qualification")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("record", type=Path)
    parser.add_argument("--workflow-commit", required=True)
    parser.add_argument("--work", required=True, type=Path)
    parser.add_argument("--product", type=Path)
    args = parser.parse_args()
    require(args.record.is_file() and not args.record.is_symlink() and args.record.stat().st_size <= 131072, "Bounded regular qualification record required")
    record_bytes = args.record.read_bytes()
    record = decode(record_bytes)
    require(os.environ.get("GITHUB_REPOSITORY") == REPOSITORY and os.environ.get("GITHUB_REF") == "refs/heads/main" and
            os.environ.get("GITHUB_SHA") == args.workflow_commit, "Publication runs only on exact reviewed Alpha main")
    plan = preflight(record, args.workflow_commit, args.work)
    if args.product:
        product = args.product.resolve(strict=True)
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=product, text=True).strip()
        require(head == plan["alphaCommit"] and decode((product / "upstream.lock.json").read_bytes())["commit"] == plan["sdkCommit"], "Product checkout differs from admitted producer")
        stage(record, plan, args.work, product)
    output = {"qualificationSHA256": sha(record_bytes), "sourceCommit": plan["alphaCommit"],
              "sdkCommit": plan["sdkCommit"], "versionCode": plan["versionCode"],
              "signedApkSHA256": record["signedApkSHA256"], "voiceEvidenceSHA256": record["cloudVoiceEvidenceSHA256"],
              "voiceAuthority": "reviewed-external-receipt", "published": False}
    (args.work / "qualification-summary.json").write_text(json.dumps(output, indent=2) + "\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
            stream.write(f"qualification_sha256={sha(record_bytes)}\nsource_commit={plan['alphaCommit']}\n")
    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError, zipfile.BadZipFile, tarfile.TarError):
        raise SystemExit("Qualified update refused; preserve exact input receipts for review. No publication was performed by admission.")
