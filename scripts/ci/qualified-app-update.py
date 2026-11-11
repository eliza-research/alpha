"""Admit a reviewed post-signing qualification and stage exact private output.

This composes the existing private producer admission. It never signs, publishes,
decrypts CMS or accepts credentials in a qualification record. The embedded voice
receipt is an explicit human-reviewed assertion, not authenticated acoustic QA.
"""
import argparse
import base64
from contextlib import contextmanager
import hashlib
import importlib.util
import io
from itertools import islice
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import quote, urlencode
import zipfile

from app_update_producer import CANDIDATE, HOSTED_DISPATCH, apk_member_limit, copy_verified, producer_kind

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = "eliza-research/alpha"
REPOSITORY_ID = 1396333361
REPOSITORY_OWNER_ID = 314117943
SIGNING_WORKFLOW_ID = 411388003
HEX = re.compile(r"[0-9a-f]{64}")
COMMIT = re.compile(r"[0-9a-f]{40}")
NUMBER = re.compile(r"[1-9][0-9]{0,15}")
DELIVERY_NAME = re.compile(r"private-cloud-apk-delivery-([1-9][0-9]{0,15})-([1-9][0-9]{0,3})")
DELIVERY_ZIP_LIMIT = 131072
PLAN_LIMIT = 32768
VOICE_LIMIT = 16384
DISPATCH_INPUT_LIMIT = 65535
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


@contextmanager
def open_bounded(file, limit):
    # Open once so type, size, hash and archive parsing all refer to the same file.
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        details = os.fstat(stream.fileno())
        require(stat.S_ISREG(details.st_mode) and 0 < details.st_size <= limit, "Bounded regular evidence file required")
        yield stream, details.st_size


def read_bounded(file, limit):
    with open_bounded(file, limit) as (stream, size):
        value = stream.read(limit + 1)
        require(len(value) == size, "Evidence file length changed")
        return value


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


def public_private_plan(raw):
    plan = decode(raw)
    # CMS delivery needs an operator's private key and is deliberately unsupported.
    require(isinstance(plan, dict) and plan.get("privateStorage") is not None,
            "Only existing privateStorage delivery is supported; CMS is not admitted")
    storage = STORAGE.validate(plan)
    require(plan.get("updateChannel", {}).get("kind") == "public" and
            plan.get("purpose") != "private-update-qa-baseline", "Public channel qualification required")
    require(COMMIT.fullmatch(plan["alphaCommit"]) and COMMIT.fullmatch(plan["sdkCommit"]), "Invalid producer source")
    return plan, storage


def check_signed_receipt(bundle, storage):
    require(isinstance(bundle, dict) and set(bundle) == {"bucket", "object", "generation", "bytes", "sha256", "public"},
            "Exact private signing receipt required")
    require(bundle["bucket"] == STORAGE.BUCKET and bundle["object"] == storage["outputObject"] and
            isinstance(bundle["generation"], str) and re.fullmatch(r"[1-9][0-9]{0,24}", bundle["generation"]) and
            type(bundle["bytes"]) is int and 0 < bundle["bytes"] <= STORAGE.MAX_BYTES and
            isinstance(bundle["sha256"], str) and HEX.fullmatch(bundle["sha256"]) and bundle["public"] is False,
            "Signed output differs from the reviewed private delivery")


def validate(record):
    require(isinstance(record, dict) and set(record) == FIELDS and
            record["schema"] == "alpha-qualified-app-update/v1", "Invalid qualification record")
    require(COMMIT.fullmatch(record["signingWorkflowCommit"]), "Invalid signing workflow commit")
    for field in ("signingRunId", "deliveryArtifactId"):
        require(isinstance(record[field], str) and NUMBER.fullmatch(record[field]), "Invalid run or artifact ID")
    require(type(record["signingRunAttempt"]) is int and 0 < record["signingRunAttempt"] < 10000,
            "Exact signing run attempt required")
    require(type(record["deliveryArtifactBytes"]) is int and 0 < record["deliveryArtifactBytes"] <= DELIVERY_ZIP_LIMIT,
            "Delivery receipt artifact exceeds bound")
    require(isinstance(record["deliveryArtifactSHA256"], str) and HEX.fullmatch(record["deliveryArtifactSHA256"]),
            "Invalid delivery artifact digest")
    plan_bytes = encoded(record, "signingPlan", PLAN_LIMIT)
    plan, storage = public_private_plan(plan_bytes)
    check_signed_receipt(record["signedBundle"], storage)
    apks = record["signedApkSHA256"]
    require(isinstance(apks, dict) and set(apks) == set(VARIANTS) and
            all(isinstance(value, str) and HEX.fullmatch(value) for value in apks.values()) and
            len(set(apks.values())) == 2, "Exactly two distinct signed APK hashes required")
    voice_bytes = encoded(record, "cloudVoiceEvidence", VOICE_LIMIT)
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


def check_signing_run(record, plan, workflow_commit, api):
    require(COMMIT.fullmatch(workflow_commit), "Exact publication workflow commit required")
    for source, producer in ((plan["alphaCommit"], True), (record["signingWorkflowCommit"], False)):
        compared = api(f"repos/{REPOSITORY}/compare/{source}...{workflow_commit}")
        on_main = compared.get("status") in ("ahead", "identical") and compared.get("merge_base_commit", {}).get("sha") == source
        reviewed_producer = producer and not on_main and PRODUCER.reviewed_private_producer(
            plan, decode((ROOT / "android/release-signer.json").read_bytes()))
        require(on_main or reviewed_producer,
                "Producer or signing workflow is not on reviewed main history")
    run = api(f"repos/{REPOSITORY}/actions/runs/{record['signingRunId']}/attempts/{record['signingRunAttempt']}")
    repos = [run.get(key) or {} for key in ("repository", "head_repository")]
    require(run.get("status") == "completed" and run.get("conclusion") == "success" and
            run.get("id") == int(record["signingRunId"]) and run.get("workflow_id") == SIGNING_WORKFLOW_ID and
            run.get("event") == "workflow_dispatch" and run.get("head_branch") == "main" and
            run.get("head_sha") == record["signingWorkflowCommit"] and
            all(repo.get("id") == REPOSITORY_ID and repo.get("full_name") == REPOSITORY and
                (repo.get("owner") or {}).get("id") == REPOSITORY_OWNER_ID for repo in repos) and
            run.get("path") == ".github/workflows/release-cloud-app-signing.yml" and
            run.get("run_attempt") == record["signingRunAttempt"], "Signing run identity differs")


def delivery_identity(artifact_id, api):
    require(isinstance(artifact_id, str) and NUMBER.fullmatch(artifact_id), "Exact delivery artifact ID required")
    artifact = api(f"repos/{REPOSITORY}/actions/artifacts/{artifact_id}")
    provenance = artifact["workflow_run"]
    name = DELIVERY_NAME.fullmatch(artifact["name"])
    source, size, digest = provenance["head_sha"], artifact["size_in_bytes"], artifact["digest"]
    require(name and artifact.get("id") == int(artifact_id) and artifact.get("expired") is False and
            provenance["id"] == int(name[1]) and provenance["head_branch"] == "main" and
            provenance["repository_id"] == provenance["head_repository_id"] == REPOSITORY_ID and
            COMMIT.fullmatch(source) and type(size) is int and 0 < size <= DELIVERY_ZIP_LIMIT and
            re.fullmatch(r"sha256:[0-9a-f]{64}", digest), "Signing delivery artifact identity differs")
    return {"signingWorkflowCommit": source, "signingRunId": name[1], "signingRunAttempt": int(name[2]),
            "deliveryArtifactId": artifact_id, "deliveryArtifactBytes": size, "deliveryArtifactSHA256": digest[7:]}


def delivery_receipt(file, identity):
    raw = read_bounded(file, DELIVERY_ZIP_LIMIT)
    require(len(raw) == identity["deliveryArtifactBytes"] and sha(raw) == identity["deliveryArtifactSHA256"],
            "Delivery ZIP differs from the official archive")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = [entry for entry in archive.infolist() if not entry.is_dir()]
        require(len(entries) == 1 and entries[0].filename == "private-storage-receipt.json" and
                entries[0].file_size <= 65536 and not entries[0].flag_bits & 1 and
                stat.S_IFMT(entries[0].external_attr >> 16) in (0, stat.S_IFREG), "Unexpected signing artifact members; CMS is unsupported")
        return decode(archive.read(entries[0]))


def preflight(record, workflow_commit, work, api=gh_json, download=gh_download):
    plan, plan_bytes, voice_bytes = validate(record)
    check_signing_run(record, plan, workflow_commit, api)
    identity = delivery_identity(record["deliveryArtifactId"], api)
    require(all(record[field] == value for field, value in identity.items()), "Signing delivery artifact identity differs")
    work.mkdir(mode=0o700, parents=True, exist_ok=False)
    receipt_zip = work / "delivery.zip"
    download(f"repos/{REPOSITORY}/actions/artifacts/{record['deliveryArtifactId']}/zip", receipt_zip,
             record["deliveryArtifactBytes"], record["deliveryArtifactSHA256"])
    require(delivery_receipt(receipt_zip, identity) == record["signedBundle"], "Signing run receipt differs from reviewed output")
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


def restore_producer_evidence(unsigned, product, kind):
    with zipfile.ZipFile(unsigned) as archive:
        verified = decode(archive.read("apk-verification.json"))
        debug = PRODUCER.debug_apk_members(archive, verified, kind)
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
        for name, (entry, digest) in debug.items():
            with archive.open(entry) as content:
                restore_file(product, "artifacts/" + name, content, entry.file_size, digest,
                             "Producer debug APK bytes differ")


@contextmanager
def signed_bundle(signed, receipt, plan, plan_bytes):
    signed_apks = {variant + "-release.apk" for variant in VARIANTS}
    expected = signed_apks | {"signed.sha256", "signing-plan.json", "production-signer.sha256"}
    if plan.get("rotation") is not None:
        expected.add("rotation.lineage")
    with open_bounded(signed, STORAGE.MAX_BYTES) as (stream, size):
        require(size == receipt["bytes"] and hashlib.file_digest(stream, "sha256").hexdigest() == receipt["sha256"],
                "Signed bundle bytes differ")
        stream.seek(0)
        with tarfile.open(fileobj=stream, mode="r:") as archive:
            members = list(islice(archive, len(expected) + 1))
            # The exact uncompressed TAR receipt authenticates its member sizes.
            # APKs may fill that envelope. Metadata keeps the historical ceiling.
            signed_limit = min(size, apk_member_limit(producer_kind(plan)))
            metadata_limit = apk_member_limit(HOSTED_DISPATCH)
            require(len(members) == len(expected) and {item.name for item in members} == expected and
                    all(item.isfile() and 0 < item.size <= (signed_limit if item.name in signed_apks else metadata_limit)
                        for item in members), "Unexpected signed bundle members")
            entries = {member.name: member for member in members}
            with archive.extractfile(entries["signing-plan.json"]) as source:
                require(source.read(PLAN_LIMIT + 1) == plan_bytes, "Signed bundle plan differs")
            with archive.extractfile(entries["signed.sha256"]) as source:
                checksum = source.read(257)
            require(len(checksum) <= 256, "Signed checksum receipt differs")
            lines = checksum.decode("ascii").strip().splitlines()
            matches = [re.fullmatch(r"([0-9a-f]{64})  (standalone|launcher)-release\.apk", line) for line in lines]
            require(len(matches) == len(VARIANTS) and all(matches), "Signed checksum receipt differs")
            apks = {match[2]: match[1] for match in matches}
            require(set(apks) == set(VARIANTS), "Signed checksum receipt differs")
            yield archive, entries, apks


def stage(record, plan, work, product, fetch_unsigned=STORAGE.download, fetch_signed=signed_download):
    unsigned, signed = work / "producer.zip", work / "signed.tar"
    fetch_unsigned(plan, unsigned)
    PRODUCER.admit(unsigned, plan)
    fetch_signed(plan, record["signedBundle"], signed)
    plan_bytes = read_bounded(work / "signing-plan.json", PLAN_LIMIT)
    with signed_bundle(signed, record["signedBundle"], plan, plan_bytes) as (archive, entries, apks):
        require(apks == record["signedApkSHA256"], "Signed checksum receipt differs")
        restore_producer_evidence(unsigned, product, producer_kind(plan))
        for variant in VARIANTS:
            name = variant + "-release.apk"
            member = entries[name]
            with archive.extractfile(member) as content:
                restore_file(product, "artifacts/" + name, content, member.size, apks[variant],
                             "Signed APK bytes differ from qualification")


def prepare_qualification(signing_plan, voice_evidence, signed_tar, delivery_zip, artifact_id, workflow_commit, *, api=gh_json):
    plan_bytes = read_bounded(signing_plan, PLAN_LIMIT)
    voice_bytes = read_bounded(voice_evidence, VOICE_LIMIT)
    plan, storage = public_private_plan(plan_bytes)
    require(COMMIT.fullmatch(workflow_commit), "Exact publication workflow commit required")
    main = api(f"repos/{REPOSITORY}/git/ref/heads/main")
    require(main["ref"] == "refs/heads/main" and main["object"]["type"] == "commit" and
            main["object"]["sha"] == workflow_commit, "Publication workflow commit is not current Alpha main")
    identity = delivery_identity(artifact_id, api)
    check_signing_run(identity, plan, workflow_commit, api)
    receipt = delivery_receipt(delivery_zip, identity)
    check_signed_receipt(receipt, storage)
    with signed_bundle(signed_tar, receipt, plan, plan_bytes) as (archive, entries, apks):
        for variant in VARIANTS:
            member = entries[variant + "-release.apk"]
            with archive.extractfile(member) as content:
                copy_verified(content, member.size, apks[variant], "Signed APK bytes differ from qualification")
    record = {"schema": "alpha-qualified-app-update/v1", **identity, "signedBundle": receipt,
              "signedApkSHA256": apks}
    for field, raw in (("signingPlan", plan_bytes), ("cloudVoiceEvidence", voice_bytes)):
        record[field + "Base64"] = base64.b64encode(raw).decode("ascii")
        record[field + "SHA256"] = sha(raw)
    validate(record)
    return record


def qualification_input(record, workflow_commit):
    rendered = json.dumps(record, indent=2) + "\n"
    inputs = json.dumps({"workflow_commit": workflow_commit, "qualification": rendered}, separators=(",", ":"))
    require(len(inputs) <= DISPATCH_INPUT_LIMIT,
            "Qualification exceeds GitHub Actions input size. Use a compact reviewed voice receipt.")
    return rendered


def prepare_cli(argv):
    parser = argparse.ArgumentParser(description="Prepare an Alpha publication qualification from exact local release evidence")
    parser.add_argument("--signing-plan", required=True, type=Path)
    parser.add_argument("--voice-evidence", required=True, type=Path)
    parser.add_argument("--signed-tar", required=True, type=Path)
    parser.add_argument("--delivery-zip", required=True, type=Path)
    parser.add_argument("--delivery-artifact-id", required=True)
    parser.add_argument("--workflow-commit", required=True)
    args = parser.parse_args(argv)
    record = prepare_qualification(args.signing_plan, args.voice_evidence, args.signed_tar,
                                   args.delivery_zip, args.delivery_artifact_id, args.workflow_commit)
    sys.stdout.write(qualification_input(record, args.workflow_commit))


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
    require(os.environ.get("GITHUB_REPOSITORY") == REPOSITORY and
            os.environ.get("GITHUB_REPOSITORY_ID") == str(REPOSITORY_ID) and
            os.environ.get("GITHUB_REPOSITORY_OWNER_ID") == str(REPOSITORY_OWNER_ID) and
            os.environ.get("GITHUB_REF") == "refs/heads/main" and
            os.environ.get("GITHUB_SHA") == args.workflow_commit, "Publication runs only on exact reviewed Alpha main")
    plan = preflight(record, args.workflow_commit, args.work)
    if args.product:
        product = args.product.resolve(strict=True)
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=product, text=True).strip()
        require(head == plan["alphaCommit"] and decode((product / "upstream.lock.json").read_bytes())["commit"] == plan["sdkCommit"], "Product checkout differs from admitted producer")
        stage(record, plan, args.work, product)
    output = {"qualificationSHA256": sha(record_bytes), "sourceCommit": plan["alphaCommit"],
              "sdkCommit": plan["sdkCommit"], "versionCode": plan["versionCode"],
              "runtimeProfile": "native" if producer_kind(plan) == CANDIDATE else "cloud",
              "signedApkSHA256": record["signedApkSHA256"], "voiceEvidenceSHA256": record["cloudVoiceEvidenceSHA256"],
              "voiceAuthority": "reviewed-external-receipt", "published": False}
    (args.work / "qualification-summary.json").write_text(json.dumps(output, indent=2) + "\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
            stream.write(f"qualification_sha256={sha(record_bytes)}\nsource_commit={plan['alphaCommit']}\n")
    print(json.dumps(output))


if __name__ == "__main__":
    try:
        if sys.argv[1:2] == ["prepare-qualification"]:
            prepare_cli(sys.argv[2:])
        else:
            main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError, zipfile.BadZipFile, tarfile.TarError):
        raise SystemExit("Qualified update refused; preserve exact input receipts for review. No publication was performed by admission.")
