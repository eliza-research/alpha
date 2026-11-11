"""Sign an exact preserving pilot OTA without replacing APK, APEX or AVB keys."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import struct
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
HEX = re.compile(r"[0-9a-f]{64}")


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


STORAGE = module("ota_private_storage", "scripts/ci/private-apk-storage.py")
PROOF = module("ota_key_custody", "scripts/ci/release-custody-proof.py")
require = STORAGE.require


def digest(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def pairs(rows):
    result = {}
    for key, value in rows:
        require(key not in result, "Duplicate JSON field")
        result[key] = value
    return result


def read(file):
    return json.loads(file.read_text(), object_pairs_hook=pairs)


def validate(plan):
    fields = {"schema", "purpose", "sourceCommit", "sdkCommit", "targetFiles", "otaTools",
              "outputObject", "product", "device", "targetFingerprint", "buildTimestamp"}
    require(set(plan) == fields and plan["schema"] == "alpha-preserving-os-ota-signing/v1" and
            plan["purpose"] == "pilot-no-platform-key-rotation", "Unexpected OS signing purpose")
    pin = read(ROOT / "android/signing/ota-tools.json")
    require(pin["schema"] == 1 and pin["qualified"] is True and HEX.fullmatch(pin["sha256"]) and
            HEX.fullmatch(pin["apkSignerMappingsSha256"]) and HEX.fullmatch(pin["avbKeyConfigurationSha256"]),
            "OS producer/tool identities must be reviewed before signing")
    require(plan["sourceCommit"] in pin["allowedProducerCommits"] and
            plan["sdkCommit"] == pin["sdkCommit"] and plan["otaTools"]["sha256"] == pin["sha256"],
            "Unreviewed OS producer or tools")
    require(plan["product"] == "alpha_stallion_phone" and plan["device"] == "stallion" and
            isinstance(plan["targetFingerprint"], str) and
            re.fullmatch(r"Alpha/alpha_stallion_phone/stallion:17/[^\s]{1,512}", plan["targetFingerprint"]) and
            type(plan["buildTimestamp"]) is int and plan["buildTimestamp"] > 0, "Wrong OS target")
    for field, prefix, maximum in [("targetFiles", "os", 12 * 1024**3), ("otaTools", "os-tools", 3 * 1024**3)]:
        obj = plan[field]
        require(set(obj) == {"bucket", "object", "generation", "bytes", "sha256"} and
                obj["bucket"] == STORAGE.BUCKET and isinstance(obj["sha256"], str) and HEX.fullmatch(obj["sha256"]) and
                obj["object"] == f"unsigned/{prefix}/{obj['sha256']}.zip" and
                isinstance(obj["generation"], str) and re.fullmatch(r"[1-9][0-9]{0,24}", obj["generation"]) and
                type(obj["bytes"]) is int and 0 < obj["bytes"] <= maximum, "Unbound private OS input")
    require(re.fullmatch(r"signed/os-ota/" + plan["targetFiles"]["sha256"] + r"/[0-9a-f]{32}/ota\.zip",
                         plan["outputObject"]), "Unbound exclusive OS output")
    return pin


def key_values(data):
    result = {}
    for line in data.decode().splitlines():
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            require(key not in result, "Duplicate OS metadata field")
            result[key] = value
    return result


def member(archive, name):
    info = archive.getinfo(name)
    require(info.file_size <= 1024 * 1024 and not info.flag_bits & 1, "OS metadata exceeds bound")
    return archive.read(info)


def inspect_target(file, plan, pin):
    with zipfile.ZipFile(file) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)) and all(not PurePosixPath(n).is_absolute() and
                ".." not in PurePosixPath(n).parts and "\\" not in n for n in names), "Unsafe target archive")
        require(not any(n.startswith("META/") and n.endswith((".py", ".pyc")) for n in names),
                "Target-supplied signing hooks are not admitted")
        misc = key_values(member(archive, "META/misc_info.txt"))
        # The pinned A/B generator does not load the legacy non-A/B tool_extensions path.
        require(misc.get("ab_update") == "true", "Expected an A/B OTA target")
        partitions = [line.strip() for line in member(archive, "META/ab_partitions.txt").decode().splitlines()]
        require(partitions and all(re.fullmatch(r"[a-z][a-z0-9_]*", p) for p in partitions) and
                not set(partitions) & {"userdata", "metadata", "persist", "frp", "misc", "avb_custom_key"},
                "OTA cannot replace data or trust-state partitions")
        signers = {}
        for line in member(archive, "META/apkcerts.txt").decode().splitlines():
            values = dict(re.findall(r'(\w+)="([^"]*)"', line))
            if "name" in values:
                require(values["name"] not in signers, "Duplicate APK signer row")
                signers[values["name"]] = {k: values.get(k) for k in ("certificate", "private_key")}
        avb = {k: v for k, v in misc.items() if k.startswith("avb_") and
               k.endswith(("_key_path", "_algorithm", "_rollback_index_location"))}
        canonical = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        require(canonical(signers) == pin["apkSignerMappingsSha256"] and
                canonical(avb) == pin["avbKeyConfigurationSha256"], "OS signing identities changed")
        # Alpha's product identity overrides the generic system-image identity.
        props = key_values(member(archive, "PRODUCT/etc/build.prop"))
        require(props.get("ro.build.fingerprint", props.get("ro.product.build.fingerprint")) == plan["targetFingerprint"] and
                int(props.get("ro.build.date.utc", props.get("ro.product.build.date.utc"))) == plan["buildTimestamp"],
                "Target build metadata differs")


def extract_tools(file, destination):
    with zipfile.ZipFile(file) as archive:
        infos = archive.infolist()
        require(len(infos) <= 30000 and sum(x.file_size for x in infos) <= 8 * 1024**3, "Tools archive exceeds bounds")
        names = {x.filename for x in infos}
        require(len(names) == len(infos), "Duplicate tool archive entry")
        links = {x.filename.rstrip("/") for x in infos if stat.S_ISLNK(x.external_attr >> 16)}
        for info in infos:
            relative = PurePosixPath(info.filename)
            require(not relative.is_absolute() and ".." not in relative.parts and "\\" not in info.filename and
                    not any(str(parent) in links for parent in relative.parents), "Unsafe tool path")
            target = destination / info.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            if info.is_dir():
                target.mkdir(exist_ok=True)
            elif stat.S_ISLNK(info.external_attr >> 16):
                link = archive.read(info).decode()
                require(not Path(link).is_absolute() and (target.parent / link).resolve().is_relative_to(destination), "Tool link escapes archive")
                target.symlink_to(link)
            else:
                require(stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG), "Unexpected tool entry")
                with archive.open(info) as source, target.open("xb") as output:
                    shutil.copyfileobj(source, output, 1024 * 1024)
                target.chmod((info.external_attr >> 16) & 0o777 or 0o644)
    require((destination / "bin/ota_from_target_files").is_file(), "OTA generator missing")


def verify_whole_file(file, expected, workspace):
    with file.open("rb") as stream:
        stream.seek(-6, 2)
        footer = stream.read(6)
        start, marker, comment = struct.unpack("<HHH", footer)
        require(marker == 0xffff and 6 < start <= comment and comment + 22 < file.stat().st_size, "Invalid OTA signature footer")
        stream.seek(-comment - 22, 2)
        end = stream.read(comment + 22)
        require(end[:4] == b"PK\x05\x06" and b"PK\x05\x06" not in end[4:], "OTA end record differs")
        stream.seek(-start, 2)
        signature = stream.read(start - 6)
        length = file.stat().st_size - comment - 2
        prefix = workspace / "signed-content.bin"
        stream.seek(0)
        with prefix.open("xb") as output:
            while length:
                chunk = stream.read(min(length, 1024 * 1024));require(chunk, "Truncated OTA content")
                output.write(chunk);length -= len(chunk)
    cms, certs = workspace / "ota-signature.der", workspace / "ota-signer.pem"
    cms.write_bytes(signature)
    subprocess.run(["openssl", "cms", "-verify", "-binary", "-inform", "DER", "-in", str(cms),
                    "-content", str(prefix), "-noverify", "-out", os.devnull, "-certsout", str(certs)],
                   check=True, capture_output=True, timeout=900)
    raw = certs.read_bytes();require(raw.count(b"-----BEGIN CERTIFICATE-----") == 1, "Unexpected OTA signer chain")
    _, actual = PROOF.certificate_identity(raw);require(actual == expected, "OTA signer differs from enrollment")
    prefix.unlink()


def download(plan, workspace):
    pin = validate(plan)
    workspace.mkdir(mode=0o700, parents=True, exist_ok=False)
    STORAGE.download_object(plan["targetFiles"], workspace / "target-files.zip", 12 * 1024**3)
    STORAGE.download_object(plan["otaTools"], workspace / "otatools.zip", 3 * 1024**3)
    inspect_target(workspace / "target-files.zip", plan, pin)
    extract_tools(workspace / "otatools.zip", workspace / "tools")


def sign(plan, workspace):
    pin = validate(plan)
    require(digest(workspace / "target-files.zip") == plan["targetFiles"]["sha256"] and
            digest(workspace / "otatools.zip") == plan["otaTools"]["sha256"], "Signing input drift")
    inspect_target(workspace / "target-files.zip", plan, pin)
    names = PROOF.SECRET_NAMES[:3]
    secrets = {name: os.environ.pop(name) for name in names}
    files = PROOF.archive_entries(PROOF.decode(secrets[names[0]]) + PROOF.decode(secrets[names[1]]))
    cert = files["releasekey.x509.pem"]
    public, expected = PROOF.certificate_identity(cert)
    require(expected == read(ROOT / "android/signing/os-custody-expected.json")["osCertificateSha256"]["releasekey"], "OS release key differs")
    private = PROOF.openssl("pkcs8", "-inform", "DER", "-passin", "env:ALPHA_PROOF_PASSWORD",
                            data=files["releasekey.pk8.enc"], password=secrets[names[2]])
    require(PROOF.private_public(private) == public, "OS release pair differs")
    public_text = PROOF.openssl("pkey", "-pubin", "-inform", "DER", "-text", "-noout", data=public)
    bits = re.search(rb"Public-Key: \((\d+) bit\)", public_text)
    expected_bits = next(row["bits"] for row in read(ROOT / "android/signing/alpha-key-manifest.json")["keys"] if row["name"] == "releasekey")
    require(bits and int(bits[1]) == expected_bits, "OS signing key parameters differ")
    require(subprocess.check_output(["stat", "-f", "-c", "%T", "/dev/shm"], text=True).strip() == "tmpfs", "Signing key requires tmpfs")
    output = workspace / "ota.zip"
    env = {"PATH": str(workspace / "tools/bin") + ":/usr/bin:/bin",
           "JAVA_HOME": os.environ["JAVA_HOME"], "TMPDIR": str(workspace / "tmp"), "LC_ALL": "C"}
    Path(env["TMPDIR"]).mkdir()
    with tempfile.TemporaryDirectory(prefix="alpha-os-ota-", dir="/dev/shm") as name:
        stage = Path(name);key = stage / "releasekey"
        key.with_suffix(".x509.pem").write_bytes(cert)
        key.with_suffix(".pem").write_bytes(private)
        key.with_suffix(".pk8").write_bytes(PROOF.openssl("pkcs8", "-topk8", "-nocrypt", "-outform", "DER", data=private))
        import shlex
        signer_args = shlex.join(["pkeyutl", "-sign", "-inkey", str(key.with_suffix(".pem")), "-pkeyopt", "digest:sha256"])
        command = [str(workspace / "tools/bin/ota_from_target_files"), "-k", str(key),
                   "--payload_signer", "/usr/bin/openssl", "--payload_signer_args", signer_args,
                   "--payload_signer_maximum_signature_size", str(expected_bits // 8), str(workspace / "target-files.zip"), str(output)]
        with (workspace / "signing-private.log").open("xb") as log:
            subprocess.run(command, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=7200)
    verify_whole_file(output, expected, workspace)
    with zipfile.ZipFile(output) as archive:
        meta = key_values(member(archive, "META-INF/com/android/metadata"))
        require(meta.get("ota-type") == "AB" and meta.get("pre-device") == plan["device"] and
                meta.get("post-build") == plan["targetFingerprint"] and int(meta["post-timestamp"]) == plan["buildTimestamp"] and
                "ota-wipe" not in meta and "ota-downgrade" not in meta, "OTA is not the admitted preserving target")
    receipt = {"schema": "alpha-preserving-os-ota/v1", "sourceCommit": plan["sourceCommit"],
               "targetFingerprint": plan["targetFingerprint"], "otaCertificateSha256": expected,
               "sha256": digest(output), "bytes": output.stat().st_size, "platformAPEXOrAVBKeysRotated": False,
               "wipeData": False, "releaseQualified": False, "deviceQualified": False}
    (workspace / "signing-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")


def interrupted(*_):
    raise KeyboardInterrupt


if __name__ == "__main__":
    os.umask(0o077)
    signal.signal(signal.SIGTERM, interrupted)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("validate", "download", "sign", "upload"))
    parser.add_argument("plan", type=Path)
    parser.add_argument("workspace", type=Path)
    args = parser.parse_args()
    try:
        plan = read(args.plan);validate(plan)
        if args.mode == "download": download(plan, args.workspace)
        elif args.mode == "sign": sign(plan, args.workspace)
        elif args.mode == "upload":
            receipt = read(args.workspace / "signing-receipt.json")
            require(digest(args.workspace / "ota.zip") == receipt["sha256"], "Signed OTA drift")
            delivered = STORAGE.upload_object(plan["outputObject"], args.workspace / "ota.zip", 8 * 1024**3)
            (args.workspace / "private-storage-receipt.json").write_text(json.dumps({**receipt, "privateStorage": delivered}, indent=2) + "\n")
        print("OS " + args.mode + " completed; no device operation or production acceptance implied.")
    except (Exception, KeyboardInterrupt):
        print("OS " + args.mode + " refused; preserve the exact inputs. No automatic retry.")
        raise SystemExit(1) from None
