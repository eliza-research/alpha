#!/usr/bin/env python3
"""Read-only admission unless --apply; never changes visibility, gestures or user settings."""
from pathlib import Path
import argparse, hashlib, json, subprocess, xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source_root', type=Path)
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
source = args.source_root.resolve(strict=True)
manifest = json.loads((ROOT / 'manifest.json').read_text())
digest = lambda value: hashlib.sha256(value).hexdigest()
assert subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip() == manifest['revision']
patch = ROOT / manifest['patch']
assert digest(patch.read_bytes()) == manifest['patchSha256']
dependency = manifest['requiredExistingResource']
dependency_path = source / dependency['path']
for candidate in [dependency_path, *dependency_path.parents]:
    if candidate == source.parent: break
    assert not candidate.is_symlink(), 'Symlink in required resource path'
flags = [node for node in ET.fromstring(dependency_path.read_text()).findall('bool')
         if node.attrib.get('name') == dependency['name']]
assert len(flags) == 1 and flags[0].text.strip() == dependency['defaultValue'], 'Existing Alpha product flag missing or changed'
states=[]
for row in manifest['files']:
    relative=Path(row['path'])
    assert not relative.is_absolute() and '..' not in relative.parts
    target=source/relative
    for candidate in [target,*target.parents]:
        if candidate == source.parent: break
        assert not candidate.is_symlink(), 'Symlink in patch target'
    actual=digest(target.read_bytes())
    assert actual in [row['beforeSha256'],row['afterSha256']], 'Unreviewed source drift'
    states.append(actual == row['afterSha256'])
assert len(set(states))==1, 'Partial application requires recovery'
if all(states):
    print(json.dumps({'state':'ALREADY_APPLIED_EXACTLY','mutated':False}))
else:
    subprocess.run(['git','apply','--check',str(patch)],cwd=source,check=True)
    if args.apply:
        subprocess.run(['git','apply',str(patch)],cwd=source,check=True)
        for row in manifest['files']:
            assert digest((source/row['path']).read_bytes())==row['afterSha256']
    print(json.dumps({'state':'APPLIED_SOURCE_ONLY' if args.apply else 'ADMITTED_NOT_APPLIED','mutated':args.apply,'compilation':'pending'}))
