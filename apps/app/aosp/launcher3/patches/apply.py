#!/usr/bin/env python3
"""Fail-closed preimage verifier and applier for the Alpha NEXT Launcher3 QSB Ask Alpha hook."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent.parent / 'branding' / 'system-entry'))
from portable_tools import reject_symlinks, require, safe_relative_path


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def is_sha256_hex(value: object) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_root', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()

    source = args.source_root.resolve(strict=True)
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    head = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    require(head == manifest['revision'], f"Unexpected {manifest['project']} revision: {head}")

    patch_path = ROOT / manifest['patch']
    require(sha256_bytes(patch_path.read_bytes()) == manifest['patchSha256'], 'Patch digest drift')

    states = []
    for row in manifest['files']:
        relative = safe_relative_path(row['path'], 'patch target path')
        target = source / relative
        reject_symlinks(target, source, 'patch target')
        before = row.get('beforeSha256')
        after = row.get('afterSha256')
        require(before is None or is_sha256_hex(before), f"Unpinned beforeSha256 for {row['path']}")
        require(is_sha256_hex(after), f"Unpinned afterSha256 for {row['path']}")
        actual = sha256_bytes(target.read_bytes()) if target.exists() else None
        require(actual in [before, after], f"Unreviewed source drift in {row['path']}")
        states.append(actual == after)

    require(len(set(states)) == 1, 'Partial application requires recovery')
    if all(states):
        print(json.dumps({'state': 'ALREADY_APPLIED_EXACTLY', 'mutated': False}))
        return

    subprocess.run(['git', 'apply', '--check', str(patch_path)], cwd=source, check=True)
    if args.apply:
        subprocess.run(['git', 'apply', str(patch_path)], cwd=source, check=True)
        for row in manifest['files']:
            actual = sha256_bytes((source / row['path']).read_bytes())
            require(actual == row['afterSha256'], f"Post-apply drift in {row['path']}")

    print(json.dumps({
        'state': 'APPLIED_SOURCE_ONLY' if args.apply else 'ADMITTED_NOT_APPLIED',
        'mutated': args.apply,
        'compilation': 'pending',
    }))


if __name__ == '__main__':
    main()
