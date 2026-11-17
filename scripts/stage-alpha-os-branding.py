#!/usr/bin/env python3
"""Guarded source-only Alpha OS policy, branding and first-run staging. No build or device operations."""
from pathlib import Path
import argparse, hashlib, json, os, re, subprocess, tempfile, zipfile

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

def project_role_controller(original):
    field = '    private RoleManager mUserRoleManager;'
    assert original.count(field) == 1, 'Role controller field changed'
    candidate = original.replace(field, field + '\n    private boolean mAlphaRoleUpgradeRunning;', 1)
    start = '        mUserRoleManager.setRoleNamesFromController(roleNames);'
    assert candidate.count(start) == 1, 'Role initialization changed'
    candidate = candidate.replace(start, start + '''

        mAlphaRoleUpgradeRunning = true;
        try {
            if (!AlphaRoleUpgrade.run(new AlphaRoleUpgradeAndroid(
                    mContext, mUser, mUserRoleManager, this))) return false;
        } finally {
            mAlphaRoleUpgradeRunning = false;
        }
''', 1)
    end = '\n    @Override\n    @WorkerThread\n    public boolean onAddRoleHolder'
    assert candidate.count(end) == 1, 'Role default completion changed'
    candidate = candidate.replace(end, '''

    private boolean keepAlphaOwnerChoice(String roleName) {
        if (mAlphaRoleUpgradeRunning) return true;
        AlphaRoleUpgradeAndroid upgrade = new AlphaRoleUpgradeAndroid(
                mContext, mUser, mUserRoleManager, this);
        return !upgrade.eligible() || upgrade.keepOwnerChoice(roleName);
    }
    @Override
    @WorkerThread
    public boolean onAddRoleHolder''', 1)
    # These three entry points share the same worker as default-role grants. Mark explicit
    # requests before mutation so a retry cannot undo a later owner choice.
    for start, anchor in [
            ('public boolean onAddRoleHolder', '        boolean added = false;'),
            ('public boolean onRemoveRoleHolder', '        boolean dontKillApp = hasFlag'),
            ('public boolean onClearRoleHolders', '        boolean dontKillApp = hasFlag')]:
        begin = candidate.index(start)
        point = candidate.index(anchor, begin)
        candidate = candidate[:point] + '        if (!keepAlphaOwnerChoice(roleName)) return false;\n\n' + candidate[point:]
    return candidate

def core_policy_plan(root, read_baseline=None):
    """Materialize the reviewed policy packet in scratch space, never in the build checkout."""
    packet = BRAND / 'core-launcher'
    manifest = json.loads((packet / 'manifest.json').read_text())
    revision = next(row['revision'] for row in LOCK['files'] if row['project'] == 'frameworks/base')
    assert manifest['revision'] == revision and manifest['project'] == 'frameworks/base', 'Core policy source pin drift'
    patch = packet / manifest['patch']
    assert patch.parent == packet and digest(patch.read_bytes()) == manifest['patchSha256'], 'Core policy patch drift'
    headers = [line for line in patch.read_text().splitlines() if line.startswith(('--- ', '+++ '))]
    expected = []
    for row in manifest['files']:
        path = Path(row['path'])
        assert not path.is_absolute() and '..' not in path.parts, 'Unsafe core policy path'
        expected += ['--- /dev/null' if row['beforeSha256'] is None else '--- a/' + row['path'], '+++ b/' + row['path']]
    assert headers == expected, 'Core patch exceeds its manifest scope'
    with tempfile.TemporaryDirectory(prefix='alpha-core-policy-stage-') as directory:
        temporary = Path(directory)
        for row in manifest['files']:
            if row['beforeSha256'] is None: continue
            data = read_baseline(row['path']) if read_baseline else subprocess.check_output([
                'git', '-C', str(root / 'frameworks/base'), 'show', revision + ':' + row['path']])
            assert digest(data) == row['beforeSha256'], 'Core baseline drift: ' + row['path']
            target = safe(temporary, row['path']); target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
        subprocess.run(['git', 'apply', '--check', str(patch)], cwd=temporary, check=True, capture_output=True)
        subprocess.run(['git', 'apply', str(patch)], cwd=temporary, check=True, capture_output=True)
        output = {}
        for row in manifest['files']:
            data = safe(temporary, row['path']).read_bytes()
            assert digest(data) == row['afterSha256'], 'Core policy output drift: ' + row['path']
            output['frameworks/base/' + row['path']] = (data, row['beforeSha256'])
        return output

def image_identity(image_stage, aapt, apksigner):
    """Recheck the normal signed canonical launcher stage before its source packet is planned."""
    admission = json.loads(safe(image_stage, 'image-policy-admission.json').read_text())
    config = json.loads((REPO/'app.config.json').read_text())
    # OS images are staged only for the canonical application identity.
    assert admission['schema'] == 1 and admission['packageName'] == config['appId'], 'Image identity differs from the canonical application'
    relative = 'provisioning/alpha-telephony-components.xml'
    assert admission['handlerDefaultsSha256'] == digest(safe(image_stage,relative).read_bytes()), 'Image provisioning packet drift: '+relative
    descriptor_bytes = safe(image_stage, 'launcher.json').read_bytes()
    descriptor = json.loads(descriptor_bytes)
    assert admission['launcherDescriptorSha256'] == digest(descriptor_bytes), 'Launcher descriptor hash drift'
    apk = safe(image_stage, 'Launcher.apk')
    hasher = hashlib.sha256()
    with apk.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''): hasher.update(chunk)
    assert admission['apkSha256'] == descriptor['apkSha256'] == hasher.hexdigest(), 'Staged APK hash drift'
    assert descriptor['packageName'] == admission['packageName'] and descriptor['moduleName'] == config['moduleName'], 'Launcher descriptor identity drift'
    assert descriptor.get('development') is False, 'A development launcher cannot select production image policy'
    product = json.loads((REPO/'android/aosp/pixel10a-product.json').read_text())
    assert admission['sourceLockSha256'] == product['sourceLock']['sha256'] == digest((REPO/product['sourceLock']['file']).read_bytes()), 'Image source lock drift'
    assert admission['platformCertificateSha256'] == product['signer']['platformCertificateSha256'] and re.fullmatch('[0-9a-f]{64}', admission['platformCertificateSha256']), 'Image platform certificate drift'
    signer = json.loads((REPO/product['signer']['apkDescriptor']).read_text())['signerSha256']
    assert descriptor['certificateSha256'] == signer and re.fullmatch('[0-9a-f]{64}', signer), 'Launcher signer admission drift'
    # Normal tools verify the APK itself again, not merely a self-reported success bit.
    verified = subprocess.check_output([apksigner, 'verify', '--verbose', '--print-certs', str(apk)], text=True)
    actual = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)$', verified, re.M)
    assert [value.lower() for value in actual] == [signer], 'Staged APK signer differs from reviewed signer'
    badging = subprocess.check_output([aapt, 'dump', 'badging', str(apk)], text=True)
    assert 'application-debuggable' not in badging, 'A debuggable launcher cannot select production image policy'
    package = re.search(r"^package: name='([^']+)'", badging, re.M)
    assert package and package.group(1) == admission['packageName'], 'Staged APK package differs from the canonical identity'
    # The standalone source stage must retain the same receiver and nine-handler qualification
    # as stage-aosp. Reuse the actual product qualifiers rather than a second Python manifest model.
    tree = subprocess.check_output([aapt, 'dump', 'xmltree', str(apk), 'AndroidManifest.xml'], text=True)
    with tempfile.TemporaryDirectory(prefix='alpha-image-manifest-') as temporary:
        manifest=Path(temporary)/'manifest.txt';manifest.write_text(tree)
        code="""const [file, appId, stage, roles] = process.argv.slice(-4);
const tree = await Bun.file(file).text();
(await import(stage)).assertImageLauncherManifest(tree, true, appId);
(await import(roles)).aospTelephonyRoleComponents(tree, appId);"""
        subprocess.check_output([os.environ.get('ALPHA_BUN','bun'), '-e', code, str(manifest),
            admission['packageName'], str(REPO/'scripts/stage-aosp.ts'), str(REPO/'scripts/aosp-telephony-roles.ts')], text=True, cwd=REPO)
    return admission

BRANDING_INCLUDE = '$(call inherit-product, vendor/alphaphone/branding/branding.mk)'
BRANDING_SUFFIX = b'\n# Alpha OS visual identity.\n' + BRANDING_INCLUDE.encode() + b'\n'

def stage_preimage(root, image_stage, name):
    """A source packet publishes beside its admitted image stage, which becomes vendor/alphaphone.
    Its vendor/alphaphone preimages are that stage, never an older install in the source tree."""
    prefix = 'vendor/alphaphone/'
    return safe(image_stage, name[len(prefix):]) if image_stage and name.startswith(prefix) else safe(root, name)

def branding_product(current, product_mk_hash, image_stage):
    """Return the new product.mk bytes to stage, or None when no change is planned."""
    assert current.decode().count(BRANDING_INCLUDE) <= 1, 'Duplicate branding inclusion'
    if image_stage:
        # stage-aosp added exactly this include to the generated stage; bind it to that preimage.
        assert current.endswith(BRANDING_SUFFIX) and product_mk_hash == digest(current[:-len(BRANDING_SUFFIX)]), 'Image stage product.mk differs from its pinned preimage'
        return None
    if BRANDING_INCLUDE in current.decode(): return None
    assert product_mk_hash == digest(current), 'Explicit generated product.mk preimage pin required'
    return current + BRANDING_SUFFIX

def build_plan(root, assets, report_hash, source_inputs, prior=None, product_mk_hash=None, core_baseline=None, image_stage=None):
    existing = lambda name: stage_preimage(root, image_stage, name)
    check_revision(root, 'packages/apps/Provision')
    check_revision(root, 'frameworks/base')
    report_path = assets / 'branding-assets.json'
    assert digest(report_path.read_bytes()) == report_hash, 'Asset report pin mismatch'
    report = json.loads(report_path.read_text())
    assert report['sourceLogoSha256'] == digest((REPO / 'apps/app/public/logo-mark.svg').read_bytes())
    assert (report['width'],report['height'],report['accent'],report['wallpaperBackground']) == (1080,2424,'#0000FF','#000000')
    for name,key in [('bootanimation.zip','bootAnimationSha256'),('default_wallpaper.png','wallpaperSha256')]:
        assert digest((assets/name).read_bytes()) == report[key], 'Asset payload drift: ' + name
    target = json.loads((BRAND/'core-launcher/manifest.json').read_text()).get('targetAppId')
    if target != 'ai.alphacompute.alphaphone': raise ValueError('Current OS policy must bind the reviewed Alpha Compute package')
    plan = {}; allowed = {}
    def put(path, value, preimages=()):
        plan[path] = value
        allowed[path] = set(preimages)
    # This is part of normal OS staging for every fresh image and update, not a phone-side edit.
    for name, (data, before) in core_policy_plan(root, core_baseline).items():
        put(name, data, (before,) if before is not None else ())
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
    role_project = 'packages/modules/Permission'
    role_path = 'PermissionController/role-controller/java/com/android/role/controller/service/'
    role_file = role_path + 'RoleControllerServiceImpl.java'
    role_input = pinned(role_project, role_file)
    check_revision(root, role_project)
    original = safe(source_inputs, role_project+'/'+role_file).read_bytes()
    assert digest(original) == role_input['sha256'], 'Role controller preimage drift'
    put(role_project+'/'+role_file, project_role_controller(original.decode()).encode(),
        [role_input['sha256']])
    for name in ['AlphaRoleUpgrade.java', 'AlphaRoleUpgradeAndroid.java']:
        put(role_project+'/'+role_path+name, (BRAND/'provision'/name).read_bytes())
    put(project+'/res/values/alpha.xml',(BRAND/'provision/strings.xml').read_bytes(),previous.get('strings.xml',[]))
    # Reuse the already reviewed product icon, including its blue circle, inset and clipping.
    # Generating a bare logo vector here would silently change the installed setup identity.
    icon_source = REPO / LOCK['productIcon']['path']
    icon = icon_source.read_bytes()
    assert digest(icon) == LOCK['productIcon']['sha256'], 'Product setup icon drift'
    assert digest((REPO / LOCK['productIcon']['logoSource']).read_bytes()) == LOCK['productIcon']['logoSourceSHA256'], 'Product icon identity source drift'
    put(project+'/res/drawable/alpha_mark.xml',icon)
    put(project+'/res/drawable-nodpi/alpha_wallpaper.png',(assets/'default_wallpaper.png').read_bytes())
    # The production product copies this feature only after the matching Provision sources are staged.
    put('vendor/alphaphone/branding/provision/fresh-telephony.xml',
        (BRAND/'provision/fresh-telephony.xml').read_bytes())
    current = existing('vendor/alphaphone/product.mk').read_bytes()
    branded = branding_product(current, product_mk_hash, image_stage)
    if branded is not None: put('vendor/alphaphone/product.mk',branded,[digest(current)])
    rows=[]
    prior_rows = {row['path']:row['sha256'] for row in (prior or {}).get('files',[])}
    for name,value in plan.items():
        target=existing(name); actual=digest(target.read_bytes())if target.exists()else None
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
    parser.add_argument('--source-inputs',type=Path)
    parser.add_argument('--image-stage',type=Path)
    parser.add_argument('--aapt',default='aapt')
    parser.add_argument('--apksigner',default='apksigner')
    parser.add_argument('--packet-output',type=Path)
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
    admission = image_identity(args.image_stage.resolve(strict=True), args.aapt, args.apksigner) if args.image_stage else None
    assert not args.packet_output or admission, 'A source packet requires normal signed-image admission'
    assert not (args.packet_output and args.apply), 'Packet generation does not apply source'
    if args.packet_output:
        assert args.packet_output.resolve().parent == args.image_stage.resolve(), 'Packet must publish with its admitted image stage'
    with tempfile.TemporaryDirectory(prefix='alpha-provision-inputs-') as temporary:
        inputs = args.source_inputs.resolve(strict=True) if args.source_inputs else Path(temporary)
        if not args.source_inputs:
            for project, filename in [
                    ('packages/apps/Provision', 'src/com/android/provision/DefaultActivity.java'),
                    ('packages/apps/Provision', 'AndroidManifest.xml'),
                    ('packages/modules/Permission', 'PermissionController/role-controller/java/com/android/role/controller/service/RoleControllerServiceImpl.java')]:
                row=pinned(project, filename)
                data=subprocess.check_output(['git','-C',str(root/project),'show',row['revision']+':'+filename])
                assert digest(data)==row['sha256'], 'Pinned Provision source drift'
                output=safe(inputs, project+'/'+filename);output.parent.mkdir(parents=True,exist_ok=True);output.write_bytes(data)
        plan,rows=build_plan(root,args.assets_dir.resolve(strict=True),args.assets_report_sha256,inputs,prior,args.product_mk_sha256,
                          image_stage=args.image_stage.resolve(strict=True) if args.packet_output else None)
    args.receipt.parent.mkdir(parents=True,exist_ok=True)
    assert not args.receipt.exists(),'Preserve existing receipt; use a new path'
    backup=args.receipt.parent/(args.receipt.stem+'-source-preimages')
    if args.apply: apply_plan(root,plan,rows,backup)
    if args.packet_output:
        # An opaque source archive avoids duplicate Android.bp discovery when the vendor overlay
        # is copied into an AOSP tree. It is review input, never another build module directory.
        with zipfile.ZipFile(args.packet_output, 'x', compression=zipfile.ZIP_DEFLATED) as packet:
            for row in rows: packet.writestr(row['path'], plan[row['path']])
    record={'schema':1,'state':'ALPHA_BRANDING_SOURCE_STAGED_NOT_BUILT'if args.apply else'ADMITTED_SOURCE_PLAN_NOT_APPLIED','applied':args.apply,'assetReportSha256':args.assets_report_sha256,'productIconSha256':LOCK['productIcon']['sha256'],'sourceLockSha256':digest((BRAND/'provision/source-inputs.json').read_bytes()),'corePolicyManifestSha256':digest((BRAND/'core-launcher/manifest.json').read_bytes()),'files':rows,'backup':str(backup)if args.apply else None,'userDataTouched':False,'settingsWrittenDuringStaging':False,'assistantOrPowerImplementationChanged':False,'coreLauncherTrayAndSharedFilesPolicyIncluded':True,'imageBuilt':False,'deviceQualified':False,'productionQualified':False}
    if admission:
        record['imageIdentityAdmission'] = admission
    if args.packet_output:
        record['state']='SIGNED_IMAGE_SOURCE_PACKET_NOT_APPLIED'
        record['packetOutput']=args.packet_output.name
        record['packetSha256']=digest(args.packet_output.read_bytes())
    args.receipt.write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps({'state':record['state'],'files':len(rows),'receipt':str(args.receipt)}))

if __name__=='__main__':main()
