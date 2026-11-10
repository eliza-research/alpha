"""Admit the frozen APK, helper signer and native source inputs used by resident CI."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

from resident_native_source import verify_generated_native


def verify_resident_fixture(archive, expected_manifest_sha256, android_home):
    digest = lambda value: hashlib.sha256(value).hexdigest()
    assert digest((archive / 'apk-manifest.json').read_bytes()) == expected_manifest_sha256
    manifest = json.loads((archive / 'apk-manifest.json').read_text())
    expected = {variant + '-' + kind + '.apk' for variant in ['standalone', 'launcher']
                for kind in ['debug', 'release-unsigned', 'androidTest']}
    expected |= {'private-peer-debug.apk', 'private-peer-manifest.json'}
    assert set(manifest) == expected
    for name, recorded in manifest.items():
        assert digest((archive / name).read_bytes()) == recorded

    helper = json.loads((archive / 'private-peer-manifest.json').read_text())
    assert helper['package'] == 'ai.alphacompute.alphaphone.peerfixture' and helper['schemaVersion'] == 1
    assert helper['apkSha256'] == manifest['private-peer-debug.apk']
    expected_helper_sources = {str(path) for path in Path('android/private-peer-fixture/src').rglob('*') if path.is_file()}
    expected_helper_sources |= {'android/private-peer-fixture/build.gradle', 'scripts/ci/build-private-peer.py'}
    assert set(helper['sources']) == expected_helper_sources
    for relative, recorded in helper['sources'].items():
        assert relative.startswith('android/private-peer-fixture/') or relative == 'scripts/ci/build-private-peer.py'
        assert '..' not in Path(relative).parts and Path(relative).is_file() and digest(Path(relative).read_bytes()) == recorded
    signer = Path(android_home) / 'build-tools/36.0.0/apksigner'
    badging = subprocess.check_output([str(signer.parent / 'aapt'), 'dump', 'badging', str(archive / 'private-peer-debug.apk')], text=True)
    assert re.search(r"^package: name='ai.alphacompute.alphaphone.peerfixture' ", badging, re.M)
    assert 'application-debuggable' in badging and 'launchable-activity:' not in badging and 'android.permission.INTERNET' not in badging
    for name in ['private-peer-debug.apk'] + [variant + '-' + kind + '.apk' for variant in ['standalone', 'launcher'] for kind in ['debug', 'androidTest']]:
        certs = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})$', subprocess.check_output([str(signer), 'verify', '--print-certs', str(archive / name)], text=True), re.M)
        assert certs == [helper['signerSha256']]

    assert (archive / 'inputs-before.json').read_bytes() == (archive / 'inputs-after.json').read_bytes()
    frozen = json.loads((archive / 'inputs-before.json').read_text())['files']
    lock = json.loads(Path('upstream.lock.json').read_text())
    assert frozen['upstream.lock.json'] == digest(Path('upstream.lock.json').read_bytes())
    assert subprocess.check_output(['git', '-C', 'vendor/eliza', 'rev-parse', 'HEAD'], text=True).strip() == lock['commit']
    generated = json.loads((archive / 'native-generated-source-manifest.json').read_text())
    assert digest((archive / 'native-generated-source-manifest.json').read_bytes()) == frozen['android/app/build/generated/local-agent/source-manifest.json']
    verify_generated_native(generated, frozen)
    for relative, recorded in frozen.items():
        if relative.startswith(('android/app/src/androidTest/', 'android/app/src/testMocks/', 'android/app/src/main/java/')):
            assert Path(relative).is_file() and digest(Path(relative).read_bytes()) == recorded
    return manifest, frozen, lock
