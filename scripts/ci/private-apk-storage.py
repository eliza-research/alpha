"""Exact-object private APK transport; never receives the account's broad token."""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import stat
from urllib.parse import quote, urlencode

BUCKET = "alpha-aosp-lab-20261024-private-apks"
MAX_BYTES = 1_500_000_000


def require(value, message):
    if not value:
        raise ValueError(message)


def validate(plan):
    storage = plan["privateStorage"]
    require(storage["bucket"] == BUCKET, "Unexpected private bucket")
    sha = plan["archiveSHA256"]
    require(isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{64}", sha), "Invalid archive digest")
    require(storage["inputObject"] == f"unsigned/{sha}.zip", "Input object must bind the archive digest")
    require(isinstance(storage["inputGeneration"], str) and
            re.fullmatch(r"[1-9][0-9]{0,24}", storage["inputGeneration"]), "Exact input generation required")
    require(re.fullmatch(r"signed/" + sha + r"/[0-9a-f]{32}/signed-apks.tar",
                         storage["outputObject"]), "Invalid exclusive delivery object")
    require(type(plan["archiveBytes"]) is int and 0 < plan["archiveBytes"] <= MAX_BYTES,
            "Invalid archive byte bound")
    require(plan["producerKind"] == "root-reviewed-private-runner", "Unreviewed producer kind")
    require(re.fullmatch(r"[0-9a-f]{64}", plan["privateProducerReceiptSHA256"]),
            "Reviewed private producer receipt required")
    return storage


def connection():
    token = os.environ.get("ALPHA_PRIVATE_STORAGE_TOKEN", "")
    require(token and "\n" not in token and "\r" not in token, "Missing scoped storage credential")
    return http.client.HTTPSConnection("storage.googleapis.com", timeout=90), {
        "Authorization": "Bearer " + token,
    }


def read_json(conn, method, route, headers, body=None):
    conn.request(method, route, body=body, headers=headers)
    response = conn.getresponse()
    require(response.status == 200, f"Private storage request failed with HTTP {response.status}; no retry")
    data = response.read(65537)
    require(len(data) <= 65536, "Storage metadata exceeds bound")
    return json.loads(data)


def download(plan, destination):
    storage = validate(plan)
    return download_object({"bucket": BUCKET, "object": storage["inputObject"],
                            "generation": storage["inputGeneration"],
                            "bytes": plan["archiveBytes"], "sha256": plan["archiveSHA256"]},
                           destination, MAX_BYTES)


def download_object(pin, destination, max_bytes):
    require(set(pin) == {"bucket", "object", "generation", "bytes", "sha256"} and
            pin["bucket"] == BUCKET and isinstance(pin["object"], str) and
            re.fullmatch(r"unsigned/[a-z0-9/_-]*[0-9a-f]{64}\.zip", pin["object"]) and
            isinstance(pin["generation"], str) and re.fullmatch(r"[1-9][0-9]{0,24}", pin["generation"]) and
            type(pin["bytes"]) is int and 0 < pin["bytes"] <= max_bytes and
            isinstance(pin["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", pin["sha256"]),
            "Invalid exact private object")
    conn, headers = connection()
    route = "/storage/v1/b/" + BUCKET + "/o/" + quote(pin["object"], safe="")
    query = {"generation": pin["generation"]}
    try:
        metadata = read_json(conn, "GET", route + "?" + urlencode(query), headers)
        require(metadata["bucket"] == BUCKET and metadata["name"] == pin["object"] and
                metadata["generation"] == pin["generation"] and
                int(metadata["size"]) == pin["bytes"], "Pinned storage metadata differs")
        conn.request("GET", route + "?" + urlencode({**query, "alt": "media"}), headers=headers)
        response = conn.getresponse()
        require(response.status == 200, "Private archive download refused; no redirect or retry")
        size, digest = 0, hashlib.sha256()
        with destination.open("xb") as output:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                require(size <= pin["bytes"], "Private archive exceeds its reviewed size")
                digest.update(chunk)
                output.write(chunk)
        require(size == pin["bytes"] and digest.hexdigest() == pin["sha256"],
                "Downloaded archive differs from reviewed bytes")
    finally:
        conn.close()


def upload(plan, source):
    storage = validate(plan)
    return upload_object(storage["outputObject"], source, MAX_BYTES)


def upload_object(object_name, source, max_bytes):
    require(isinstance(object_name, str) and len(object_name) < 512 and
            re.fullmatch(r"signed/[a-z0-9/_-]+\.(?:tar|zip)", object_name), "Invalid exclusive output object")
    require(not source.is_symlink(), "Delivery source cannot be a symlink")
    with source.open("rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and 0 < before.st_size <= max_bytes, "Invalid delivery file")
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
        stream.seek(0)
        conn, headers = connection()
        headers.update({"Content-Type": "application/octet-stream", "Content-Length": str(before.st_size)})
        route = "/upload/storage/v1/b/" + BUCKET + "/o?" + urlencode({
            "uploadType": "media", "name": object_name, "ifGenerationMatch": "0",
        })
        try:
            metadata = read_json(conn, "POST", route, headers, stream)
        finally:
            conn.close()
        after = os.fstat(stream.fileno())
        require((before.st_ino, before.st_size, before.st_mtime_ns) ==
                (after.st_ino, after.st_size, after.st_mtime_ns), "Delivery source changed during upload")
        stream.seek(0)
        require(hashlib.file_digest(stream, "sha256").hexdigest() == digest, "Delivery bytes changed")
        require(metadata["bucket"] == BUCKET and metadata["name"] == object_name and
                int(metadata["size"]) == before.st_size and
                re.fullmatch(r"[1-9][0-9]{0,24}", metadata["generation"]), "Delivery metadata differs")
        return {"bucket": BUCKET, "object": object_name, "generation": metadata["generation"],
                "bytes": before.st_size, "sha256": digest, "public": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("validate", "download", "upload"))
    parser.add_argument("plan", type=Path)
    parser.add_argument("file", type=Path, nargs="?")
    args = parser.parse_args()
    try:
        plan = json.loads(args.plan.read_text())
        if args.mode == "validate":
            validate(plan)
            print("Private storage plan validated; artifact bytes not yet checked")
        else:
            require(args.file is not None, "A transport file is required")
            result = download(plan, args.file) if args.mode == "download" else upload(plan, args.file)
            if result:
                print(json.dumps(result, indent=2))
    except (ValueError, KeyError, TypeError, OSError, http.client.HTTPException):
        # Never echo credential-bearing requests or provider response bodies.
        parser.exit(1, "Private APK transport refused; preserve evidence and inspect exact object before retrying.\n")
