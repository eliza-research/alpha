#!/usr/bin/env python3
"""Fetch only hash-pinned official source inputs; valid existing inputs are reused offline."""
from pathlib import Path
import argparse, base64, hashlib, json, os, tempfile, urllib.request

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--inputs-root', type=Path, default=ROOT / '.cache')
args = parser.parse_args()
data = args.inputs_root.resolve()
manifest = json.loads((ROOT / 'SOURCE-INPUTS.json').read_text())
assert manifest['project'] == 'frameworks/base'
revision = manifest['revision']
assert len(revision) == 40 and all(c in '0123456789abcdef' for c in revision)
base = 'https://android.googlesource.com/platform/frameworks/base/+/' + revision + '/'
fetched = reused = 0
for row in manifest['files']:
    relative = Path(row['path'])
    assert not relative.is_absolute() and '..' not in relative.parts
    assert row['url'] == base + row['path'], 'Unexpected source authority'
    destination = data / 'baseline' / relative
    current = data
    for component in ('baseline', *relative.parts):
        current /= component
        assert not current.is_symlink(), 'Symlink in source input path'
    if destination.exists():
        assert hashlib.sha256(destination.read_bytes()).hexdigest() == row['beforeSha256'], 'Existing input drift: ' + row['path']
        reused += 1
        continue
    with urllib.request.urlopen(row['url'] + '?format=TEXT', timeout=30) as response:
        assert response.geturl() == row['url'] + '?format=TEXT', 'Unexpected source redirect'
        encoded = response.read(64 * 1024 * 1024 + 1)
    assert len(encoded) <= 64 * 1024 * 1024, 'Input exceeds bounded source size'
    content = base64.b64decode(encoded, validate=True)
    assert hashlib.sha256(content).hexdigest() == row['beforeSha256'], 'Fetched source hash mismatch: ' + row['path']
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as temporary:
        temporary.write(content)
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, destination)
    fetched += 1
print(json.dumps({'revision':revision, 'fetched':fetched, 'reused':reused, 'inputsRoot':str(data)}))
