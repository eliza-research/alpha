#!/usr/bin/env python3
"""Fetch/reuse hash-bound official source facts needed by guarded Provision staging."""
from pathlib import Path
import argparse, base64, hashlib, json, urllib.request

repo=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
lock=json.loads((repo/'android/aosp/branding/provision/source-inputs.json').read_text())
for row in lock['files']:
    relative=Path(row['project'])/row['path']
    assert not relative.is_absolute() and '..'not in relative.parts
    url='https://android.googlesource.com/platform/'+row['project']+'/+/'+row['revision']+'/'+row['path']
    assert row['url']==url
    target=args.output.resolve()/relative
    for parent in [target,*target.parents]:
        if parent==args.output.resolve().parent:break
        assert not parent.is_symlink()
    if not target.exists():
        with urllib.request.urlopen(url+'?format=TEXT',timeout=30)as response:
            assert response.geturl()==url+'?format=TEXT'
            raw=response.read(8*1024*1024+1)
        assert len(raw)<=8*1024*1024
        value=base64.b64decode(raw,validate=True)
        assert hashlib.sha256(value).hexdigest()==row['sha256']
        target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(value)
    assert hashlib.sha256(target.read_bytes()).hexdigest()==row['sha256'],'Pinned source drift'
print(json.dumps({'state':'PINNED_SOURCE_INPUTS_AVAILABLE','files':len(lock['files']),'output':str(args.output)}))
