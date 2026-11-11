#!/usr/bin/env python3
"""Check the protected release key pairs against enrolled public identities."""

import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import struct
import subprocess
import tarfile
import tempfile


KEYSTORE_ALIAS = "alpha-release"
OPENSSL = shutil.which("openssl")
AVB_KEYS = ("apex_payload", "avb")
OS_CERTS = (
    "releasekey", "platform", "shared", "media", "networkstack",
    "sdk_sandbox", "bluetooth", "nfc", "apex",
)
ARCHIVE_ENTRIES = {"fingerprints.json", "avb_pkmd.bin"} | {
    f"{name}.{suffix}" for name in OS_CERTS for suffix in ("pk8.enc", "x509.pem")
} | {
    f"{name}.{suffix}" for name in AVB_KEYS for suffix in ("avbpubkey", "pem.enc", "pub.pem")
}
SECRET_NAMES = (
    "ALPHA_OS_RELEASE_KEYS_PART1_B64", "ALPHA_OS_RELEASE_KEYS_PART2_B64",
    "ALPHA_OS_RELEASE_KEYS_PASSPHRASE", "ALPHA_APP_RELEASE_KEYSTORE_B64",
    "ALPHA_APP_RELEASE_KEYSTORE_PASSWORD",
)


def require(condition):
    if not condition:
        raise ValueError("Release custody check failed")


def decode(encoded):
    require(0 < len(encoded) <= 48 * 1024)
    data = base64.b64decode(encoded, validate=True)
    require(data)
    return data


def archive_entries(compressed):
    limit = 512 * 1024
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as archive:
        contents = archive.read(limit + 1)
    require(len(contents) <= limit)
    files = {}
    with tarfile.open(fileobj=io.BytesIO(contents), mode="r:") as archive:
        for member in archive:
            require(
                member.name in ARCHIVE_ENTRIES and member.name not in files
                and member.isfile() and not member.issparse()
                and 0 < member.size <= 32 * 1024
            )
            with archive.extractfile(member) as entry:
                files[member.name] = entry.read()
            require(len(files[member.name]) == member.size)
    require(files.keys() == ARCHIVE_ENTRIES)
    return files


def openssl(*args, data=None, password=None):
    require(OPENSSL)
    env = {"PATH": os.defpath, "LC_ALL": "C"}
    if password is not None:
        env["ALPHA_PROOF_PASSWORD"] = password
    return subprocess.run(
        [OPENSSL, *args], input=data, capture_output=True, check=True,
        timeout=30, env=env,
    ).stdout


def private_public(private):
    openssl("pkey", "-check", "-noout", data=private)
    return openssl("pkey", "-pubout", "-outform", "DER", data=private)


def certificate_identity(certificate):
    public = openssl("x509", "-pubkey", "-noout", data=certificate)
    der = openssl("x509", "-outform", "DER", data=certificate)
    return openssl("pkey", "-pubin", "-outform", "DER", data=public), sha256(der)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def avb_metadata(public, bits):
    # AVB's AvbRSAPublicKeyHeader, followed by n and R squared modulo n.
    text = openssl("rsa", "-pubin", "-inform", "DER", "-text", "-noout", data=public)
    require(re.search(rb"^Exponent: 65537 \(0x10001\)$", text, re.MULTILINE))
    modulus = openssl("rsa", "-pubin", "-inform", "DER", "-modulus", "-noout", data=public)
    require(modulus.startswith(b"Modulus="))
    n = int(modulus.removeprefix(b"Modulus="), 16)
    require(n.bit_length() == bits and bits in (2048, 4096, 8192))
    n0inv = -pow(n, -1, 2**32) % 2**32
    rr = pow(2, 2 * bits, n)
    return struct.pack(">II", bits, n0inv) + n.to_bytes(bits // 8, "big") + rr.to_bytes(bits // 8, "big")


def verify(root, tmpfs, secrets, public_directory=None):
    def record(relative):
        return json.loads((root / relative).read_bytes())

    expected = record("android/signing/os-custody-expected.json")
    signer = record("android/release-signer.json")
    key_manifest = record("android/signing/alpha-key-manifest.json")
    require(expected["schemaVersion"] == 1)
    require(expected["appSignerSha256"] == signer["signerSha256"])
    cert_digests = expected["osCertificateSha256"]
    avb_digest = expected["avbPublicKeySha256"]
    require(cert_digests.keys() == set(OS_CERTS))
    digests = [*cert_digests.values(), avb_digest, signer["signerSha256"]]
    require(len(set(digests)) == len(digests) and all(re.fullmatch(r"[0-9a-f]{64}", x) for x in digests))

    part1, part2, os_password, app_store, app_password = (secrets[name] for name in SECRET_NAMES)
    require(os_password and app_password)
    files = archive_entries(decode(part1) + decode(part2))
    fingerprints = json.loads(files["fingerprints.json"])
    require(fingerprints["schemaVersion"] == 1 and fingerprints["testKeys"] is False)
    entries = {key["name"]: key for key in fingerprints["keys"]}
    os_keys = {*OS_CERTS, *AVB_KEYS}
    require(entries.keys() in (os_keys, os_keys | {"alphaphone_app"}))
    require(len(entries) == len(fingerprints["keys"]))
    if "alphaphone_app" in entries:
        require(entries["alphaphone_app"]["certificateSha256"] == signer["signerSha256"])
    bits = {key["name"]: key["bits"] for key in key_manifest["keys"]}

    with tempfile.TemporaryDirectory(prefix="alpha-release-proof-", dir=tmpfs) as directory:
        stage = Path(directory)

        def os_public(filename, encoding):
            encrypted = stage / filename
            encrypted.write_bytes(files[filename])
            private = openssl(
                "pkcs8", "-inform", encoding, "-in", str(encrypted),
                "-passin", "env:ALPHA_PROOF_PASSWORD", password=os_password,
            )
            return private_public(private)

        public_keys = []
        for name in OS_CERTS:
            public, digest = certificate_identity(files[f"{name}.x509.pem"])
            require(entries[name]["kind"] == "x509-pk8")
            require(digest == cert_digests[name] == entries[name]["certificateSha256"])
            require(os_public(f"{name}.pk8.enc", "DER") == public)
            public_keys.append(public)
        for name in AVB_KEYS:
            public = openssl("pkey", "-pubin", "-outform", "DER", data=files[f"{name}.pub.pem"])
            require(entries[name]["kind"] == "avb-rsa")
            require(os_public(f"{name}.pem.enc", "PEM") == public)
            metadata = avb_metadata(public, bits[name])
            require(metadata == files[f"{name}.avbpubkey"])
            require(sha256(metadata) == entries[name]["avbPublicKeySha256"])
            if name == "avb":
                require(metadata == files["avb_pkmd.bin"] and sha256(metadata) == avb_digest)
            public_keys.append(public)

        keystore = stage / "app.p12"
        keystore.write_bytes(decode(app_store))
        args = ("pkcs12", "-in", str(keystore), "-passin", "env:ALPHA_PROOF_PASSWORD")
        certificate = openssl(*args, "-clcerts", "-nokeys", password=app_password)
        private = openssl(*args, "-nocerts", "-noenc", password=app_password)
        alias = rb"^\s*friendlyName: " + KEYSTORE_ALIAS.encode() + rb"\s*$"
        require(re.search(alias, certificate, re.MULTILINE) and re.search(alias, private, re.MULTILINE))
        require(certificate.count(b"-----BEGIN CERTIFICATE-----") == 1)
        require(private.count(b"-----BEGIN PRIVATE KEY-----") == 1)
        public, digest = certificate_identity(certificate)
        require(digest == signer["signerSha256"] and private_public(private) == public)
        public_keys.append(public)
        require(len(set(public_keys)) == len(public_keys))
        if public_directory is not None:
            # Enrollment needs the actual public certificates, not just a digest assertion.
            # Construct this fixed allowlist only after every private/public pair passed.
            public_files = {
                f"{name}.x509.pem": files[f"{name}.x509.pem"] for name in OS_CERTS
            }
            public_files["alphaphone_app.x509.pem"] = openssl(
                "x509", "-outform", "PEM", data=certificate,
            )
            public_files["avb_pkmd.bin"] = files["avb_pkmd.bin"]
            public_files["apex_payload.avbpubkey"] = files["apex_payload.avbpubkey"]
            public_entries = []
            for key in key_manifest["keys"]:
                name = key["name"]
                if name in AVB_KEYS:
                    public_entries.append({
                        "name": name, "kind": "avb-rsa", "bits": bits[name],
                        "avbPublicKeySha256": entries[name]["avbPublicKeySha256"],
                    })
                else:
                    cert = public_files[f"{name}.x509.pem"]
                    cert_public, cert_digest = certificate_identity(cert)
                    text = openssl("pkey", "-pubin", "-inform", "DER", "-text", "-noout", data=cert_public)
                    size = re.search(rb"Public-Key: \((\d+) bit\)", text)
                    require(size)
                    public_entries.append({
                        "name": name, "kind": "x509-pk8", "bits": int(size[1]),
                        "certificateSha256": cert_digest,
                        "subject": openssl("x509", "-noout", "-subject", data=cert).decode().strip().removeprefix("subject="),
                    })
            public_files["fingerprints.json"] = (json.dumps({
                "schemaVersion": 1, "testKeys": False, "keys": public_entries,
            }, indent=2) + "\n").encode()
            public_directory.mkdir(mode=0o700, parents=True, exist_ok=False)
            for name, data in public_files.items():
                (public_directory / name).write_bytes(data)
        return {
            "schemaVersion": 1,
            "sourceCommit": os.environ.get("GITHUB_SHA"),
            "osCertificateSha256": cert_digests,
            "avbPublicKeySha256": avb_digest,
            "apexPayloadAvbPublicKeySha256": entries["apex_payload"]["avbPublicKeySha256"],
            "appSignerSha256": digest,
            "keyPairsVerified": len(public_keys),
            "signedImageProduced": False,
            "deviceQualified": False,
        }


def interrupted(*_):
    raise KeyboardInterrupt


if __name__ == "__main__":
    os.umask(0o077)
    signal.signal(signal.SIGTERM, interrupted)
    try:
        secrets = {name: os.environ.pop(name) for name in SECRET_NAMES}
        result = verify(Path.cwd(), Path("/dev/shm"), secrets,
                        Path("artifacts/release-public-identities"))
        output = Path("artifacts/release-custody-proof.json")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2) + "\n")
    except (Exception, KeyboardInterrupt):
        print("Release custody proof failed.", flush=True)
        raise SystemExit(1) from None
    print("Release custody verified. Enrolled identities matched and the APEX payload pair was coherent.")
