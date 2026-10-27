#!/usr/bin/env python3
"""Guarded source-only Alpha branding/first-run staging. No build, device or user-data operations."""
from pathlib import Path
import argparse, hashlib, json, os, subprocess, tempfile, xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[1]
BRAND = REPO / 'android/aosp/branding'
LOCK = json.loads((BRAND / 'provision/source-inputs.json').read_text())
digest = lambda value: hashlib.sha256(value).hexdigest()

def pinned(project, path):
    return next(row for row in LOCK['files'] if row['project'] == project and row['path'] == path)

def check_revision(root, project):
    row = next(row for row in LOCK['files'] if row['project'] == project)
    assert subprocess.check_output(['git','-C',str(root/project),'rev-parse','HEAD'],text=True).strip() == row['revision'], 'Source revision drift: ' + project

def safe(root, relative):
    path = Path(relative)
    assert not path.is_absolute() and '..' not in path.parts, 'Unsafe stage path'
    current = root
    for component in path.parts:
        current /= component
        assert not current.is_symlink(), 'Symlink target: ' + str(relative)
    return current

def project_activity(original):
    anchor = '        finishSetup();\n    }\n\n    private void finishSetup()'
    assert original.count(anchor) == 1
    return original.replace(anchor,
        '        if (!AlphaFreshPresets.shouldRunWelcome(this)) {\n'
        '            finishSetup();\n            return;\n        }\n'
        '        AlphaWelcome.show(this, this::finishSetup);\n    }\n\n    private void finishSetup()', 1)

def previous_activity(original):
    anchor = '        finishSetup();\n    }\n\n    private void finishSetup()'
    return original.replace(anchor,
        '        if (Settings.Secure.getInt(getContentResolver(), Settings.Secure.USER_SETUP_COMPLETE, 0) != 0) {\n'
        '            finishSetup();\n            return;\n        }\n'
        '        AlphaWelcome.show(this, this::finishSetup);\n    }\n\n    private void finishSetup()', 1)

def project_manifest(original):
    assert original.count('    <application>') == 1
    return original.replace('    <application>',
        '    <uses-permission android:name="android.permission.MANAGE_ROLE_HOLDERS"/>\n'
        '    <uses-permission android:name="android.permission.SET_WALLPAPER"/>\n\n'
        '    <application android:label="@string/alpha_name" android:icon="@drawable/alpha_mark" android:theme="@android:style/Theme.Material.NoActionBar">\n'
        '        <activity android:name="AlphaAppearance" android:exported="true" android:label="@string/alpha_name"/>',1)

def build_plan(root, assets, report_hash, source_inputs, prior=None, product_mk_hash=None):
    check_revision(root, 'packages/apps/Provision')
    check_revision(root, 'frameworks/base')
    report_path = assets / 'branding-assets.json'
    assert digest(report_path.read_bytes()) == report_hash, 'Asset report pin mismatch'
    report = json.loads(report_path.read_text())
    assert report['sourceLogoSha256'] == digest((REPO / 'apps/app/public/logo-mark.svg').read_bytes())
    assert (report['width'],report['height'],report['accent'],report['wallpaperBackground']) == (1080,2424,'#0000FF','#050505')
    for name,key in [('bootanimation.zip','bootAnimationSha256'),('default_wallpaper.png','wallpaperSha256')]:
        assert digest((assets/name).read_bytes()) == report[key], 'Asset payload drift: ' + name
    plan = {}; allowed = {}
    def put(path, value, preimages=()):
        plan[path] = value
        allowed[path] = set(preimages)
    # Stage only the source-owned visual/resource directories, including independent hardware
    # invocation defaults. No app APK, assistant implementation or listener source is modified.
    for name in ['Android.bp','branding.mk','secure-camera-inputs.json']:
        put('vendor/alphaphone/branding/'+name,(BRAND/name).read_bytes())
    for folder in ['overlay','keyboard-overlay','manifests']:
        for path in sorted((BRAND/folder).rglob('*')):
            assert not path.is_symlink(), 'Symlink in branding source'
            if path.is_file(): put('vendor/alphaphone/branding/'+str(path.relative_to(BRAND)),path.read_bytes())
    # Consume reviewed presets through the existing overlay identity; never rewrite device choices.
    entry = json.loads((BRAND/'system-entry/manifest.json').read_text())['productOverlay']
    entry_path = BRAND/'system-entry'/entry['path']
    assert digest(entry_path.read_bytes()) == entry['sha256'], 'System entry overlay drift'
    put('vendor/alphaphone/branding/overlay/frameworks/base/packages/SystemUI/res/values/alpha-system-entry.xml',entry_path.read_bytes())
    for name in ['bootanimation.zip','default_wallpaper.png','branding-assets.json']:
        put('vendor/alphaphone/branding/generated/'+name,(assets/name).read_bytes())
    put('vendor/alphaphone/branding/overlay/frameworks/base/core/res/res/drawable-nodpi/default_wallpaper.png',(assets/'default_wallpaper.png').read_bytes())
    project = 'packages/apps/Provision'
    for filename, transform in [('src/com/android/provision/DefaultActivity.java',project_activity),('AndroidManifest.xml',project_manifest)]:
        row = pinned(project,filename)
        baseline = source_inputs/project/filename
        assert digest(baseline.read_bytes()) == row['sha256'], 'Pinned Provision preimage drift'
        original = baseline.read_text(); candidate = transform(original).encode()
        admitted = [row['sha256']]
        if filename.endswith('DefaultActivity.java'): admitted.append(digest(previous_activity(original).encode()))
        put(project+'/'+filename,candidate,admitted)
    previous = json.loads((BRAND/'provision/admitted-previous-sources.json').read_text())
    for name in ['AlphaWelcome.java','AlphaAppearance.java','AlphaFreshPresets.java','AlphaFreshSetupPolicy.java']:
        target = project+'/src/com/android/provision/'+name
        put(target,(BRAND/'provision'/name).read_bytes(),previous.get(name,[]))
    put(project+'/res/values/alpha.xml',(BRAND/'provision/strings.xml').read_bytes(),previous.get('strings.xml',[]))
    svg = ET.fromstring((REPO/'apps/app/public/logo-mark.svg').read_text())
    assert svg.attrib['viewBox'] == '0 0 120 120' and len(list(svg)) == 1
    path = next(iter(svg)).attrib['d']
    icon = ('<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="88dp" android:height="88dp" android:viewportWidth="120" android:viewportHeight="120"><path android:fillColor="#FFFFFFFF" android:pathData="'+path+'"/></vector>\n').encode()
    put(project+'/res/drawable/alpha_mark.xml',icon)
    put(project+'/res/drawable-nodpi/alpha_wallpaper.png',(assets/'default_wallpaper.png').read_bytes())
    product = safe(root,'vendor/alphaphone/product.mk'); current = product.read_bytes()
    include = '$(call inherit-product, vendor/alphaphone/branding/branding.mk)'
    assert current.decode().count(include) <= 1, 'Duplicate branding inclusion'
    if include not in current.decode():
        assert product_mk_hash == digest(current), 'Explicit generated product.mk preimage pin required'
        put('vendor/alphaphone/product.mk',current+b'\n# Alpha OS visual identity.\n'+include.encode()+b'\n',[digest(current)])
    rows=[]
    prior_rows = {row['path']:row['sha256'] for row in (prior or {}).get('files',[])}
    for name,value in plan.items():
        target=safe(root,name); actual=digest(target.read_bytes())if target.exists()else None
        after=digest(value)
        assert actual is None or actual==after or actual in allowed[name] or actual==prior_rows.get(name), 'Unreviewed existing stage file: '+name
        rows.append({'path':name,'beforeSha256':actual,'sha256':after,'changed':actual!=after})
    return plan,rows

def apply_plan(root,plan,rows,backup):
    # Recheck every preimage before any mutation; preserve changed existing source bytes.
    for row in rows:
        target=safe(root,row['path']); actual=digest(target.read_bytes())if target.exists()else None
        assert actual==row['beforeSha256'], 'Stage input changed after admission'
    for row in rows:
        if not row['changed']: continue
        target=safe(root,row['path'])
        if target.exists():
            retained=safe(backup,row['path']);retained.parent.mkdir(parents=True,exist_ok=True);retained.write_bytes(target.read_bytes())
        target.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=target.parent,delete=False)as f:
            f.write(plan[row['path']]); temporary=f.name
        os.replace(temporary,target)
    for row in rows: assert digest(safe(root,row['path']).read_bytes())==row['sha256']

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--aosp-root',type=Path,required=True)
    parser.add_argument('--assets-dir',type=Path,required=True)
    parser.add_argument('--assets-report-sha256',required=True)
    parser.add_argument('--source-inputs',type=Path,required=True)
    parser.add_argument('--receipt',type=Path,required=True)
    parser.add_argument('--product-mk-sha256')
    parser.add_argument('--prior-receipt',type=Path)
    parser.add_argument('--prior-receipt-sha256')
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args();prior=None
    if args.prior_receipt:
        assert args.prior_receipt_sha256==digest(args.prior_receipt.read_bytes()),'Prior receipt pin required'
        prior=json.loads(args.prior_receipt.read_text())
    root=args.aosp_root.resolve(strict=True)
    plan,rows=build_plan(root,args.assets_dir.resolve(strict=True),args.assets_report_sha256,args.source_inputs.resolve(strict=True),prior,args.product_mk_sha256)
    args.receipt.parent.mkdir(parents=True,exist_ok=True)
    assert not args.receipt.exists(),'Preserve existing receipt; use a new path'
    backup=args.receipt.parent/(args.receipt.stem+'-source-preimages')
    if args.apply: apply_plan(root,plan,rows,backup)
    record={'schema':1,'state':'ALPHA_BRANDING_SOURCE_STAGED_NOT_BUILT'if args.apply else'ADMITTED_SOURCE_PLAN_NOT_APPLIED','applied':args.apply,'assetReportSha256':args.assets_report_sha256,'sourceLockSha256':digest((BRAND/'provision/source-inputs.json').read_bytes()),'files':rows,'backup':str(backup)if args.apply else None,'userDataTouched':False,'settingsWrittenDuringStaging':False,'assistantOrPowerImplementationChanged':False,'imageBuilt':False,'deviceQualified':False,'productionQualified':False}
    args.receipt.write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps({'state':record['state'],'files':len(rows),'receipt':str(args.receipt)}))

if __name__=='__main__':main()
