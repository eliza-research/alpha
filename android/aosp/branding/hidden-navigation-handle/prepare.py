#!/usr/bin/env python3
"""Fetch/reuse the exact pinned Launcher3 source and stage the reviewed draw-only patch."""
from pathlib import Path
import argparse, base64, hashlib, json, subprocess, urllib.request

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--inputs-root', type=Path, default=ROOT / '.cache')
args = parser.parse_args()
data = args.inputs_root.resolve()
manifest = json.loads((ROOT / 'manifest.json').read_text())
assert manifest['project'] == 'packages/apps/Launcher3'
assert hashlib.sha256((ROOT / manifest['patch']).read_bytes()).hexdigest() == manifest['patchSha256']
for row in manifest['files']:
    path = Path(row['path'])
    assert not path.is_absolute() and '..' not in path.parts
    url = 'https://android.googlesource.com/platform/packages/apps/Launcher3/+/' + manifest['revision'] + '/' + row['path']
    assert row['url'] == url
    target = data / 'baseline' / path
    for candidate in [target, *target.parents]:
        if candidate == data.parent: break
        assert not candidate.is_symlink(), 'Symlink in source input path'
    if not target.exists():
        with urllib.request.urlopen(url + '?format=TEXT', timeout=30) as response:
            assert response.geturl() == url + '?format=TEXT'
            encoded = response.read(1024 * 1024 + 1)
        assert len(encoded) <= 1024 * 1024
        content = base64.b64decode(encoded, validate=True)
        assert hashlib.sha256(content).hexdigest() == row['beforeSha256']
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    assert hashlib.sha256(target.read_bytes()).hexdigest() == row['beforeSha256'], 'Input drift'
    staged = data / 'staged' / path
    for candidate in [staged, *staged.parents]:
        if candidate == data.parent: break
        assert not candidate.is_symlink(), 'Symlink in staged input path'
    staged.parent.mkdir(parents=True, exist_ok=True)
    staged.write_bytes(target.read_bytes())
subprocess.run(['git', 'apply', '--check', str(ROOT / manifest['patch'])], cwd=data / 'staged', check=True)
subprocess.run(['git', 'apply', str(ROOT / manifest['patch'])], cwd=data / 'staged', check=True)
for row in manifest['files']:
    assert hashlib.sha256((data / 'staged' / row['path']).read_bytes()).hexdigest() == row['afterSha256']
print(json.dumps({'state':'STAGED_SOURCE_ONLY','revision':manifest['revision'],'patchSHA256':manifest['patchSha256'],'compilation':'pending'}))
