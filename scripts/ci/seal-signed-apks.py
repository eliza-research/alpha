"""Seal a reviewed signed-APK bundle using only its approved recipient's public certificate."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def seal(openssl, bundle, bundle_sha, recipient, recipient_sha, output):
    for value in (bundle_sha, recipient_sha):
        require(re.fullmatch("[0-9a-f]{64}", value), "Expected lowercase SHA-256 pins")
    for file in (bundle, recipient):
        require(file.is_file() and not file.is_symlink(), "Expected regular input files")
    require(sha256(bundle) == bundle_sha, "Signed bundle digest differs")
    require(recipient.stat().st_size <= 65536, "Recipient certificate exceeds the input bound")
    # Pin the copied public certificate used by both validation and encryption.
    output = output.parent.resolve() / output.name
    require(not output.exists() and not output.is_symlink(), "Encrypted output already exists")
    require(output.parent.is_dir(), "Encrypted output directory is missing")
    with tempfile.TemporaryDirectory(dir=output.parent, prefix=".alpha-seal-") as scratch:
        root = Path(scratch)
        certificate = root / "recipient.pem"
        certificate.write_bytes(recipient.read_bytes())
        der = subprocess.check_output([openssl, "x509", "-in", str(certificate), "-outform", "DER"])
        require(hashlib.sha256(der).hexdigest() == recipient_sha, "Recipient certificate digest differs")
        subprocess.run([openssl, "x509", "-in", str(certificate), "-noout", "-checkend", "0"],
                       check=True, stdout=subprocess.DEVNULL)
        encrypted = root / "signed-apks.cms"
        subprocess.run([openssl, "cms", "-encrypt", "-binary", "-aes-256-gcm", "-outform", "DER",
                        "-in", str(bundle), "-out", str(encrypted), "-recip", str(certificate),
                        "-keyopt", "rsa_padding_mode:oaep", "-keyopt", "rsa_oaep_md:sha256",
                        "-keyopt", "rsa_mgf1_md:sha256"], check=True)
        require(sha256(bundle) == bundle_sha, "Signed bundle changed during encryption")
        # Link atomically on the same filesystem and never overwrite an existing output.
        os.link(encrypted, output)
    return {"bundleSHA256": bundle_sha, "recipientCertificateSHA256": recipient_sha,
            "ciphertextSHA256": sha256(output)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("bundle_sha256")
    parser.add_argument("recipient_certificate", type=Path)
    parser.add_argument("recipient_sha256")
    parser.add_argument("output", type=Path)
    parser.add_argument("--openssl", default="openssl")
    args = parser.parse_args()
    try:
        print(json.dumps(seal(args.openssl, args.bundle, args.bundle_sha256, args.recipient_certificate,
                              args.recipient_sha256, args.output), indent=2))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Refused signed APK envelope: {error}\n")
