#!/usr/bin/env python3
"""Fail-closed fetcher and verifier for pinned GrapheneOS Android 17 GmsCompat sources."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

PIN_FILE_DEFAULT = Path(__file__).resolve().parent / "gmscompat-pin.json"
REQUIRED_REPOS = ("GmsCompat", "GmsCompatConfig", "frameworksBaseGmsCompat")
HEX_40 = re.compile(r"^[0-9a-f]{40}$")
HEX_64 = re.compile(r"^[0-9a-f]{64}$")
FORBIDDEN_SUFFIXES = (".apk", ".apex", ".jar", ".dex", ".so", ".vdex", ".odex")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_pin(pin_path: Path) -> dict[str, Any]:
    raw = json.loads(pin_path.read_text(encoding="utf-8"))
    if raw.get("schemaVersion") != 1:
        raise ValueError("gmscompat-pin.json must declare schemaVersion == 1")
    if raw.get("failClosed") is not True:
        raise ValueError("gmscompat-pin.json must declare failClosed == true")
    if raw.get("proprietaryBinariesInRepo") is not False:
        raise ValueError("gmscompat-pin.json must declare proprietaryBinariesInRepo == false")
    repos = raw.get("repositories")
    if not isinstance(repos, dict):
        raise ValueError("gmscompat-pin.json missing repositories mapping")
    for key in REQUIRED_REPOS:
        entry = repos.get(key)
        if not isinstance(entry, dict):
            raise ValueError(f"gmscompat-pin.json missing repository entry {key}")
        commit = entry.get("commit", "")
        if not isinstance(commit, str) or not HEX_40.match(commit):
            raise ValueError(f"Repository {key} has invalid 40-char commit SHA: {commit!r}")
        if not isinstance(entry.get("url"), str) or not entry["url"].startswith("https://"):
            raise ValueError(f"Repository {key} must use an https:// URL")
        if not isinstance(entry.get("targetPath"), str) or not entry["targetPath"]:
            raise ValueError(f"Repository {key} missing targetPath")
        verified = entry.get("verifiedFiles")
        if not isinstance(verified, list) or not verified:
            raise ValueError(f"Repository {key} must list at least one verifiedFiles entry")
        for item in verified:
            if not isinstance(item, dict) or not HEX_64.match(str(item.get("sha256", ""))):
                raise ValueError(f"Repository {key} has invalid verifiedFiles SHA-256 entry")
    return raw


def check_no_forbidden_binaries(directory: Path) -> list[str]:
    problems: list[str] = []
    if not directory.is_dir():
        return problems
    for path in directory.rglob("*"):
        if path.is_file() and path.suffix.lower() in FORBIDDEN_SUFFIXES:
            problems.append(f"forbidden binary artifact present: {path}")
    return problems


def verify_tree(pin: dict[str, Any], aosp_root: Path) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    failures: list[str] = []
    repos = pin["repositories"]
    for key in REQUIRED_REPOS:
        entry = repos[key]
        target_dir = aosp_root / entry["targetPath"]
        expected_commit = entry["commit"]
        actual_commit: str | None = None
        commit_ok = False
        if (target_dir / ".git").exists():
            proc = subprocess.run(
                ["git", "-C", str(target_dir), "rev-parse", "HEAD"],
                capture_output=True,
                text=True,
                check=False,
            )
            if proc.returncode == 0:
                actual_commit = proc.stdout.strip()
                commit_ok = actual_commit == expected_commit
        if key != "frameworksBaseGmsCompat" and not commit_ok:
            failures.append(
                f"{key}: HEAD {actual_commit!r} does not match pinned commit {expected_commit}"
            )
        file_checks: list[dict[str, Any]] = []
        for item in entry["verifiedFiles"]:
            rel_path = item["path"]
            expected_sha = item["sha256"].lower()
            full_path = target_dir / rel_path
            if not full_path.is_file():
                failures.append(f"{key}: missing verified file {full_path}")
                file_checks.append(
                    {"path": rel_path, "expected": expected_sha, "actual": None, "ok": False}
                )
                continue
            actual_sha = sha256_file(full_path)
            matched = actual_sha == expected_sha
            if not matched:
                failures.append(
                    f"{key}: SHA-256 mismatch for {rel_path} (expected {expected_sha}, got {actual_sha})"
                )
            file_checks.append(
                {"path": rel_path, "expected": expected_sha, "actual": actual_sha, "ok": matched}
            )
        if key != "frameworksBaseGmsCompat":
            failures.extend(check_no_forbidden_binaries(target_dir))
        results.append(
            {
                "repository": key,
                "targetPath": str(target_dir),
                "expectedCommit": expected_commit,
                "actualCommit": actual_commit,
                "commitMatched": commit_ok,
                "files": file_checks,
            }
        )
    return {"ok": len(failures) == 0, "results": results, "failures": failures}


def fetch_into_aosp(pin: dict[str, Any], aosp_root: Path) -> None:
    repos = pin["repositories"]
    for key in ("GmsCompat", "GmsCompatConfig"):
        entry = repos[key]
        target_dir = aosp_root / entry["targetPath"]
        target_dir.parent.mkdir(parents=True, exist_ok=True)
        if not (target_dir / ".git").exists():
            subprocess.run(["git", "init", str(target_dir)], check=True)
        subprocess.run(
            ["git", "-C", str(target_dir), "fetch", "--depth=1", entry["url"], entry["commit"]],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(target_dir), "checkout", "--detach", "FETCH_HEAD"],
            check=True,
        )

    fb = repos["frameworksBaseGmsCompat"]
    fb_target = aosp_root / fb["targetPath"]
    staging_dir = aosp_root / ".gmscompat-staging" / "frameworks_base"
    staging_dir.parent.mkdir(parents=True, exist_ok=True)
    if not (staging_dir / ".git").exists():
        subprocess.run(["git", "init", str(staging_dir)], check=True)
    subprocess.run(
        ["git", "-C", str(staging_dir), "fetch", "--depth=1", fb["url"], fb["commit"]],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(staging_dir), "checkout", "--detach", "FETCH_HEAD"],
        check=True,
    )
    for item in fb["verifiedFiles"]:
        rel_path = item["path"]
        src = staging_dir / rel_path
        dst = fb_target / rel_path
        if not src.is_file():
            raise FileNotFoundError(f"Pinned frameworks_base file not found after fetch: {src}")
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(src.read_bytes())


def build_plan(pin: dict[str, Any], aosp_root: Path) -> dict[str, Any]:
    repos = pin["repositories"]
    return {
        "ok": True,
        "mode": "dry-run",
        "androidRelease": pin.get("androidRelease"),
        "aospTag": pin.get("aospTag"),
        "failClosed": pin.get("failClosed"),
        "aospRoot": str(aosp_root),
        "repositories": [
            {
                "name": key,
                "url": repos[key]["url"],
                "branch": repos[key]["branch"],
                "commit": repos[key]["commit"],
                "targetPath": str(aosp_root / repos[key]["targetPath"]),
                "verifiedFiles": repos[key]["verifiedFiles"],
            }
            for key in REQUIRED_REPOS
        ],
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Fetch and verify pinned GrapheneOS Android 17 GmsCompat sources fail-closed."
    )
    parser.add_argument("--pin", type=Path, default=PIN_FILE_DEFAULT, help="Path to gmscompat-pin.json")
    parser.add_argument("--aosp-root", type=Path, default=Path("/aosp"), help="Target AOSP checkout root")
    parser.add_argument("--dry-run", action="store_true", help="Validate pin and print JSON plan without network")
    parser.add_argument("--verify", action="store_true", help="Verify an existing AOSP tree against pinned SHAs")
    args = parser.parse_args(argv)

    pin = load_pin(args.pin)
    if args.dry_run:
        print(json.dumps(build_plan(pin, args.aosp_root), indent=2))
        return 0
    if args.verify:
        report = verify_tree(pin, args.aosp_root)
        print(json.dumps(report, indent=2))
        return 0 if report["ok"] else 1

    fetch_into_aosp(pin, args.aosp_root)
    report = verify_tree(pin, args.aosp_root)
    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
