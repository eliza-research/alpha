"""Static packaging evidence for an immutable build; never prints secret material."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import zipfile
from datetime import datetime, timezone

archive = Path(sys.argv[1]).resolve()
root = Path(__file__).resolve().parent.parent
if not archive.is_relative_to(root / "test-results"):
    raise SystemExit("Use an archived build beneath test-results")
output = archive / "static-secret-scan.json"
if output.exists():
    raise SystemExit("Preserve existing scan evidence")
manifest = json.loads((archive / "apk-manifest.json").read_text())
inputs = json.loads((archive / "inputs-before.json").read_text())["files"]
prefixes = ["android/app/src/androidTest/java/"]
descriptors = [
    ("L" + name[len(prefix):-5] + ";").encode()
    for prefix in prefixes
    for name in inputs if name.startswith(prefix) and name.endswith(".java")
]
key_path = Path.home() / ".config/alphaphone/cerebras-key"
try:
    metadata = key_path.lstat()
except FileNotFoundError:
    raise SystemExit("No provider key at ~/.config/alphaphone/cerebras-key; this scan checks archives for that key and needs it locally")
if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
    raise SystemExit("Provider key must be a private owner-owned regular file")
secret = key_path.read_text().strip()
if not secret:
    raise SystemExit("Provider key file is empty")
raw_secret = secret.encode()
patterns = [raw_secret, secret.encode("utf-16le"), base64.b64encode(raw_secret), raw_secret.hex().encode()]
debug_classes = ["DevelopmentAgentPlugin", "DevelopmentVoiceCapture", "SyntheticAutofillService"]
debug_class_packages = (b"Lai/alphacompute/alphaphone/",)
results = []
for name in sorted(manifest):
    if not re.fullmatch(r"launcher-(?:debug|release|release-unsigned)\.apk", name):
        continue
    apk = archive / name
    raw = apk.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != manifest[name]:
        raise SystemExit("Archived APK hash mismatch")
    with zipfile.ZipFile(apk) as package:
        members = [package.read(item) for item in package.infolist() if not item.is_dir()]
        dex = b"".join(package.read(item) for item in package.namelist() if re.fullmatch(r"classes\d*\.dex", item))
    secret_absent = all(pattern not in data for data in [raw, *members] for pattern in patterns)
    release = name.endswith(("-release.apk", "-release-unsigned.apk"))
    test_absent = all(value not in dex for value in descriptors) if release else None
    presence = {
        value: any(prefix + value.encode() + b";" in dex for prefix in debug_class_packages)
        for value in debug_classes
    }
    # No APK carries developer hooks.
    hooks_consistent = not any(presence.values())
    passed = secret_absent and (not release or test_absent) and hooks_consistent
    results.append({"apk": name, "sha256": digest, "archiveHashMatched": True,
                    "providerSecretAbsent": secret_absent, "androidTestClassesAbsent": test_absent,
                    "debugOnlyClassPresence": presence, "passed": passed})
report = {"inspectedAt": datetime.now(timezone.utc).isoformat(),
          "scope": "Raw and decompressed ZIP secret representation scan; release DEX test/debug exclusion. Static packaging evidence only.",
          "testClassDescriptorCount": len(descriptors), "results": results}
with output.open("x") as stream:
    json.dump(report, stream, indent=2)
if len(results) != 2 or not all(item["passed"] for item in results):
    raise SystemExit("Static packaging scan failed; inspect boolean evidence")
print("PASS: four archived APKs, static secret and distribution boundaries")
