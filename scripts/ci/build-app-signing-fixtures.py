#!/usr/bin/env python3
"""Build the closed, code-free APKs used only for protected signer custody proof."""

import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile


VARIANTS = ("launcher",)


def build_fixtures(sdk, output):
    aapt = sdk / "build-tools/36.0.0/aapt2"
    platform = sdk / "platforms/android-36/android.jar"
    output.mkdir()
    packages = {}
    with tempfile.TemporaryDirectory(prefix="alpha-signing-fixtures-") as directory:
        manifest = Path(directory) / "AndroidManifest.xml"
        for variant in VARIANTS:
            package = f"org.eliza.alphaphone.signingproof.{variant}"
            manifest.write_text(f'''<manifest xmlns:android="http://schemas.android.com/apk/res/android"
                package="{package}" android:versionCode="1" android:versionName="1">
              <uses-sdk android:minSdkVersion="29" android:targetSdkVersion="36"/>
              <application android:hasCode="false"/>
            </manifest>''')
            apk = output / f"{variant}-release-unsigned.apk"
            subprocess.run([aapt, "link", "-o", apk, "-I", platform, "--manifest", manifest], check=True)
            with zipfile.ZipFile(apk) as archive:
                if archive.namelist() != ["AndroidManifest.xml", "resources.arsc"]:
                    raise ValueError("Unexpected entry in signing fixture APK")
            resources = subprocess.check_output([aapt, "dump", "resources", apk], text=True)
            xml = subprocess.check_output([aapt, "dump", "xmltree", apk, "--file", "AndroidManifest.xml"], text=True)
            if resources.strip() != "Binary APK" or re.findall(r"^\s*E: ([\w-]+)", xml, re.MULTILINE) != [
                "manifest", "uses-sdk", "application"
            ] or not re.search(r":hasCode\(0x[\da-f]+\)=false\s*$", xml, re.MULTILINE):
                raise ValueError("Signing fixture must have no code, resources, components or permissions")
            badging = subprocess.check_output([aapt, "dump", "badging", apk], text=True)
            if not re.search(rf"^package: name='{re.escape(package)}' versionCode='1' ", badging, re.MULTILINE):
                raise ValueError("Wrong signing fixture package identity")
            packages[variant] = package
    (output / "fixture-packages.json").write_text(json.dumps(packages) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sdk", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build_fixtures(args.sdk, args.output)
