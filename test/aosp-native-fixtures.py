"""Offline admission regressions; fixtures do not prove APK or image execution."""
import importlib.util
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import re
import struct
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


native = load('stage_native', 'stage-aosp-native.py')
ELF = b'\x7fELF\x02\x01' + bytes(12) + b'\xb7\x00' + bytes(44)
ELF_X86 = ELF[:18] + b'\x3e\x00' + ELF[20:]
BP = '''// Generated from a hash- and signer-verified downstream launcher.
android_app_import {
    name: "AlphaPhone",
    apk: "Launcher.apk",
    presigned: true,
    preprocessed: true,
    product_specific: true,
    dex_preopt: { enabled: false },
}
'''


class Packaging(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.apk = self.root / 'input.apk'
        self.output = self.root / 'output'

    def archive(self, extra=None, compression=zipfile.ZIP_STORED):
        entries = [('AndroidManifest.xml', b'manifest fixture'), ('classes.dex', b'dex fixture')]
        entries += extra if extra is not None else [('lib/arm64-v8a/libcamera.so', ELF)]
        with warnings.catch_warnings(), zipfile.ZipFile(self.apk, 'w', compression=compression) as z:
            warnings.simplefilter('ignore', UserWarning)
            for name, payload in entries:
                z.writestr(name, payload)
        if self.output.exists():
            shutil.copyfile(self.apk, self.output / 'Launcher.apk')

    def overlay(self):
        self.output.mkdir()
        (self.output / 'Android.bp').write_text(BP)
        if self.apk.exists():
            shutil.copyfile(self.apk, self.output / 'Launcher.apk')

    def test_native_rejections_preserve_overlay(self):
        self.overlay()
        cases = [([('lib/arm64-v8a/libcamera.so', ELF)], zipfile.ZIP_DEFLATED),
                 ([('lib/arm64-v8a/libcamera.so', b'not elf')], zipfile.ZIP_STORED),
                 ([('lib/arm64-v8a/libcamera.so', ELF[:20])], zipfile.ZIP_STORED),
                 ([('lib/arm64-v8a/../libcamera.so', ELF)], zipfile.ZIP_STORED),
                 ([('lib/arm64-v8a/libeliza_bun.so', ELF)], zipfile.ZIP_STORED),
                 ([('lib/x86_64/libcamera.so', ELF)], zipfile.ZIP_STORED)]
        for entries, compression in cases:
            with self.subTest(entries=entries):
                self.archive(entries, compression)
                with self.assertRaises(ValueError):
                    native.stage(self.apk, self.output, 'AlphaPhone')
                self.assertEqual((self.output / 'Android.bp').read_text(), BP)
                self.assertEqual(set(self.output.iterdir()), {self.output / 'Android.bp', self.output / 'Launcher.apk'})

    def test_changed_overlay_is_not_overwritten(self):
        self.archive()
        self.overlay()
        (self.output / 'Android.bp').write_text('user-owned module')
        with self.assertRaises(ValueError):
            native.stage(self.apk, self.output, 'AlphaPhone')
        self.assertEqual((self.output / 'Android.bp').read_text(), 'user-owned module')
        self.assertFalse((self.output / 'native-arm64').exists())

    def test_native_payload_is_installed_byte_exact_without_enabling_runtime(self):
        self.archive()
        self.overlay()
        report = native.stage(self.apk, self.output, 'AlphaPhone')
        self.assertEqual((self.output / 'native-arm64/libcamera.so').read_bytes(), ELF)
        self.assertEqual(report['libraries'][0]['installPath'], '/product/app/AlphaPhone/lib/arm64/libcamera.so')
        for flag in ['residentAgentIncluded', 'runtimeVerified', 'deployReady']:
            self.assertFalse(report[flag])
        self.assertEqual(json.loads((self.output / 'native-libraries.json').read_text()), report)

    def resident_fixture(self, target='stallion'):
        config = native.TARGETS[target]
        abi = config['abi']
        elf = ELF_X86 if target == 'cuttlefish' else ELF
        # Synthetic source and binary pins keep these tests offline; actual APK
        # provenance and executable loading require their separate checks.
        trust = self.root / 'trust'
        pin_files = {
            'upstream.lock.json': json.dumps({'commit': '1' * 40}).encode(),
            'scripts/prepare-local-agent.mjs': (ROOT / 'scripts/prepare-local-agent.mjs').read_bytes(),
            'scripts/copy-file-clone.mjs': (ROOT / 'scripts/copy-file-clone.mjs').read_bytes(),
            'scripts/local-agent-source.mjs': b'guard fixture',
            'vendor/eliza/bun.lock': b'dependency lock fixture',
            'config/native-view-declarations.json': b'{}',
        }
        digest = lambda data: hashlib.sha256(data).hexdigest()
        bun = {'version': '1.4.2', 'revision': '2' * 40,
               'artifacts': {config['bunArch']: {'binarySha256': digest(elf)}}}
        pin_files['vendor/eliza/packages/app/scripts/lib/android-bun-artifacts.lock.json'] = json.dumps({'channels': {'stable': bun}}).encode()
        for name, data in pin_files.items():
            target = trust / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        # Evaluate the actual preparer's stamp expression against synthetic pins.
        # A new/removed field in production must exercise the native verifier too.
        expression = re.search(r'const stamp=(.+);', pin_files['scripts/prepare-local-agent.mjs'].decode()).group(1)
        script = "const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const root=process.argv[1];const lock=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json')));const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');console.log(JSON.stringify(" + expression + "))"
        stamp = json.loads(subprocess.check_output(['node', '-e', script, str(trust)]))
        stamp_bytes = json.dumps(stamp).encode()
        entries = {'lib/' + abi + '/' + name: elf for name in config['modes']}
        entries.update({'assets/agent/' + name: b'fixture asset' for name in native.REQUIRED_AGENT_ASSETS})
        entries.update({'assets/agent/' + abi + '/' + name: elf for name in config['assets'].values()})
        entries['assets/agent/' + abi + '/libstdc++.so.6.0.33'] = elf
        provenance = {'schema': 'eliza.android_agent_runtime_provenance.v1',
                      'bun': {'version': bun['version'], 'revision': bun['revision'], 'channel': 'stable'},
                      'files': [{'path': n, 'size_bytes': len(data), 'sha256': digest(data)} for n, data in entries.items()]}
        entries['assets/agent/android-agent-runtime-provenance.json'] = json.dumps(provenance).encode()
        entries['assets/agent/alpha-source.json'] = stamp_bytes
        entries['assets/agent/native-view-declarations.json'] = b'{}'
        prefix = 'assets/agent/workflow-worker/'
        worker_files = {name: b'{}' for name in ['node_modules/smthrs/package.json', 'node_modules/zod/package.json',
                         'node_modules/effect/package.json', 'node_modules/@smthrs/engine/package.json', 'dependencies.json']}
        manifest = {'version': 1, 'sourceStampSha256': digest(stamp_bytes),
                    'lockSha256': digest(pin_files['vendor/eliza/bun.lock']),
                    'files': {n: digest(data) for n, data in worker_files.items()}}
        worker_files['manifest.json'] = json.dumps(manifest).encode()
        index = ''.join(digest(data) + '\t' + n + '\n' for n, data in worker_files.items()).encode()
        worker_files['files.sha256'] = index
        entries.update({prefix + n: data for n, data in worker_files.items()})
        return trust, entries

    def cloud_fixture(self, target='stallion'):
        trust, entries = self.resident_fixture(target)
        omitted = native.CLOUD_OMITTED_MODEL
        del entries[omitted['path']]
        provenance_path = 'assets/agent/android-agent-runtime-provenance.json'
        provenance = json.loads(entries[provenance_path])
        for row in provenance['files']:
            if row['path'] == omitted['path']:
                row['sha256'] = omitted['sha256']
        entries[provenance_path] = json.dumps(provenance).encode()
        entries['assets/agent/alpha-runtime-profile.json'] = json.dumps({
            'version': 1, 'runtimeProfile': 'cloud', 'omittedLocalModels': [omitted]}).encode()
        entries['assets/public/build-flags.json'] = json.dumps({'testMocks': False, 'runtimeProfile': 'cloud'}).encode()
        return trust, entries

    def test_cloud_stages_exact_resident_without_requiring_omitted_local_model(self):
        trust, entries = self.cloud_fixture()
        self.archive(list(entries.items()))
        before = self.apk.read_bytes()
        self.overlay()
        with patch.object(native, 'ROOT', trust):
            report = native.stage(self.apk, self.output, 'AlphaPhone')
        self.assertEqual(self.apk.read_bytes(), before)
        self.assertEqual(report['runtimeAdmission']['runtimeProfile'], 'cloud')
        self.assertEqual(report['runtimeAdmission']['omittedLocalModels'], [native.CLOUD_OMITTED_MODEL])
        self.assertTrue(report['residentAgentIncluded'])
        self.assertFalse(report['runtimeVerified'])
        self.assertFalse(report['deployReady'])
        for name in native.RUNTIME_MODES:
            self.assertEqual((self.output / 'native-arm64' / name).read_bytes(), ELF)

    def test_cloud_refuses_mixed_profiles_and_missing_or_changed_original_provenance(self):
        trust, original = self.cloud_fixture()
        self.overlay()
        profile_path = 'assets/agent/alpha-runtime-profile.json'
        flags_path = 'assets/public/build-flags.json'
        provenance_path = 'assets/agent/android-agent-runtime-provenance.json'
        variants = []
        for profile in [None, {'version': 1, 'runtimeProfile': 'unknown'},
                        {'version': 1, 'runtimeProfile': 'native'},
                        {'version': 1, 'runtimeProfile': 'cloud', 'omittedLocalModels': []}]:
            entries = dict(original)
            if profile is None:
                del entries[profile_path]
            else:
                entries[profile_path] = json.dumps(profile).encode()
            variants.append(entries)
        for flags in [None, {'testMocks': True, 'runtimeProfile': 'cloud'}, {'testMocks': False, 'runtimeProfile': 'native'}]:
            entries = dict(original)
            if flags is None:
                del entries[flags_path]
            else:
                entries[flags_path] = json.dumps(flags).encode()
            variants.append(entries)
        for name in [native.CLOUD_OMITTED_MODEL['path'], 'assets/extra.onnx',
                     'assets/paradee-voice/config.json', 'lib/arm64-v8a/libelizainference.so']:
            variants.append({**original, name: ELF})
        for alteration in ['missing-model-record', 'changed-model-hash', 'changed-bundle', 'missing-worker']:
            entries = dict(original)
            provenance = json.loads(entries[provenance_path])
            if alteration == 'missing-model-record':
                provenance['files'] = [row for row in provenance['files'] if row['path'] != native.CLOUD_OMITTED_MODEL['path']]
            elif alteration == 'changed-model-hash':
                for row in provenance['files']:
                    if row['path'] == native.CLOUD_OMITTED_MODEL['path']:
                        row['sha256'] = '0' * 64
            elif alteration == 'changed-bundle':
                entries['assets/agent/agent-bundle.js'] += b'changed'
            else:
                del entries['assets/agent/workflow-worker/dependencies.json']
            entries[provenance_path] = json.dumps(provenance).encode()
            variants.append(entries)
        for index, entries in enumerate(variants):
            with self.subTest(index=index):
                self.archive(list(entries.items()))
                with patch.object(native, 'ROOT', trust), self.assertRaises((ValueError, KeyError)):
                    native.stage(self.apk, self.output, 'AlphaPhone')
                self.assertEqual((self.output / 'Android.bp').read_text(), BP)
                self.assertEqual(set(self.output.iterdir()), {self.output / 'Android.bp', self.output / 'Launcher.apk'})

    def test_native_profile_still_requires_its_original_local_model(self):
        trust, entries = self.resident_fixture()
        del entries[native.CLOUD_OMITTED_MODEL['path']]
        self.archive(list(entries.items()))
        self.overlay()
        with patch.object(native, 'ROOT', trust), self.assertRaises(KeyError):
            native.stage(self.apk, self.output, 'AlphaPhone')
        self.assertEqual(set(self.output.iterdir()), {self.output / 'Android.bp', self.output / 'Launcher.apk'})

    def test_complete_resident_payload_gets_explicit_modes_without_execution_claim(self):
        trust, entries = self.resident_fixture()
        self.archive(list(entries.items()))
        self.overlay()
        with patch.object(native, 'ROOT', trust):
            report = native.stage(self.apk, self.output, 'AlphaPhone')
        self.assertTrue(report['residentAgentIncluded'])
        self.assertFalse(report['runtimeVerified'])
        self.assertFalse(report['deployReady'])
        import configparser
        config = configparser.ConfigParser()
        config.read(self.output / 'config.fs')
        for name, mode in native.RUNTIME_MODES.items():
            entry = config['product/app/AlphaPhone/lib/arm64/' + name]
            self.assertEqual(entry['mode'], mode)
            self.assertEqual(entry['user'], 'AID_ROOT')
            self.assertEqual(entry['group'], 'AID_ROOT')
            self.assertEqual(entry['caps'], '0')

    def test_resident_provenance_corruptions_refuse_before_overlay_mutation(self):
        trust, original = self.resident_fixture()
        self.overlay()
        for name in ['assets/agent/agent-bundle.js', 'assets/agent/alpha-source.json',
                     'assets/agent/native-view-declarations.json', 'assets/agent/workflow-worker/dependencies.json', 'assets/agent/workflow-worker/files.sha256']:
            with self.subTest(name=name):
                entries = {**original, name: original[name] + b'changed'}
                self.archive(list(entries.items()))
                with patch.object(native, 'ROOT', trust), self.assertRaises(ValueError):
                    native.stage(self.apk, self.output, 'AlphaPhone')
                self.assertEqual((self.output / 'Android.bp').read_text(), BP)
                self.assertEqual(set(self.output.iterdir()), {self.output / 'Android.bp', self.output / 'Launcher.apk'})

    def test_changed_copy_helper_rejects_current_preparer_stamp(self):
        trust, entries = self.resident_fixture()
        self.archive(list(entries.items()))
        self.overlay()
        (trust / 'scripts/copy-file-clone.mjs').write_text('changed copier')
        with patch.object(native, 'ROOT', trust), self.assertRaisesRegex(ValueError, 'source stamp'):
            native.stage(self.apk, self.output, 'AlphaPhone')
        self.assertEqual(set(self.output.iterdir()), {self.output / 'Android.bp', self.output / 'Launcher.apk'})

    def test_self_consistent_bun_substitution_still_refuses_pinned_binary_mismatch(self):
        trust, entries = self.resident_fixture()
        name = 'lib/arm64-v8a/libeliza_bun.so'
        entries[name] += b'changed'
        entries['assets/agent/arm64-v8a/bun'] = entries[name]
        path = 'assets/agent/android-agent-runtime-provenance.json'
        provenance = json.loads(entries[path])
        for entry in provenance['files']:
            if entry['path'] in [name, 'assets/agent/arm64-v8a/bun']:
                entry.update(size_bytes=len(entries[name]), sha256=hashlib.sha256(entries[name]).hexdigest())
        entries[path] = json.dumps(provenance).encode()
        self.archive(list(entries.items()))
        self.overlay()
        with patch.object(native, 'ROOT', trust), self.assertRaisesRegex(ValueError, 'pinned binary'):
            native.stage(self.apk, self.output, 'AlphaPhone')
        self.assertEqual(set(self.output.iterdir()), {self.output / 'Android.bp', self.output / 'Launcher.apk'})

    def test_cuttlefish_exact_x86_payload_modes_and_no_arm64_installation(self):
        trust, entries = self.cloud_fixture('cuttlefish')
        # A fat APK may contain another ABI; it must not be installed in x86's directory.
        entries['lib/arm64-v8a/libcamera.so'] = ELF
        self.archive(list(entries.items()))
        before = self.apk.read_bytes()
        self.overlay()
        with patch.object(native, 'ROOT', trust):
            report = native.stage(self.apk, self.output, 'AlphaPhone', 'cuttlefish')
        self.assertEqual(self.apk.read_bytes(), before)
        expected = {'libeliza_bun.so': '0755', 'libeliza_ld_musl_x86_64.so': '0755',
                    'libeliza_ld_musl_x86_64_real.so': '0755', 'libeliza_stdcpp.so': '0644',
                    'libeliza_gcc_s.so': '0644', 'libsigsys-handler.so': '0644'}
        self.assertEqual({x.name for x in (self.output / 'native-x86_64').iterdir()}, set(expected))
        self.assertFalse((self.output / 'native-arm64').exists())
        import configparser
        config = configparser.ConfigParser()
        config.read(self.output / 'config.fs')
        self.assertEqual(set(config.sections()), {'product/app/AlphaPhone/lib/x86_64/' + n for n in expected})
        for name, mode in expected.items():
            self.assertEqual((self.output / 'native-x86_64' / name).read_bytes(), ELF_X86)
            self.assertEqual(dict(config['product/app/AlphaPhone/lib/x86_64/' + name]),
                             {'mode': mode, 'user': 'AID_ROOT', 'group': 'AID_ROOT', 'caps': '0'})
        self.assertFalse((self.output / 'Android.mk').exists())
        blueprint = (self.output / 'Android.bp').read_text()
        self.assertIn('android_app_import {', blueprint)
        self.assertIn('required: ["AlphaPhone_native_0"', blueprint)
        self.assertEqual(blueprint.count('prebuilt_app_native {'), len(expected))
        self.assertEqual(blueprint.count('relative_install_path: "AlphaPhone/lib/x86_64"'), len(expected))
        self.assertNotIn('arm64', blueprint)
        for name in expected:
            self.assertIn('src: "native-x86_64/' + name + '"', blueprint)
            self.assertIn('filename: "' + name + '"', blueprint)
        self.assertTrue(report['residentAgentIncluded'])
        self.assertFalse(report['runtimeVerified'])
        self.assertFalse(report['deployReady'])
        self.assertEqual(report['target'], 'cuttlefish')

    def test_cuttlefish_wrong_abi_missing_runtime_and_unknown_target_fail_before_write(self):
        trust, original = self.cloud_fixture('cuttlefish')
        variants = []
        for name in ['lib/x86_64/libeliza_bun.so', 'lib/x86_64/libsigsys-handler.so',
                     'lib/x86_64/libeliza_ld_musl_x86_64_real.so']:
            entries = dict(original)
            del entries[name]
            variants.append(entries)
        variants.append({**original, 'lib/x86_64/libeliza_bun.so': ELF})
        variants.append({**original, 'lib/x86_64/libeliza_unreviewed.so': ELF_X86})
        # A complete ARM fixture cannot establish a Cuttlefish runtime.
        _, arm = self.cloud_fixture()
        variants.append(arm)
        self.overlay()
        for entries in variants:
            self.archive(list(entries.items()))
            with patch.object(native, 'ROOT', trust), self.assertRaises((ValueError, KeyError)):
                native.stage(self.apk, self.output, 'AlphaPhone', 'cuttlefish')
            self.assertEqual(set(self.output.iterdir()), {self.output / 'Android.bp', self.output / 'Launcher.apk'})
        self.archive(list(original.items()))
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            native.stage(self.apk, self.output, 'AlphaPhone', 'generic-x86')
        self.assertEqual((self.output / 'Android.bp').read_text(), BP)

    def test_cuttlefish_self_consistent_bun_substitution_cannot_override_x64_pin(self):
        trust, entries = self.cloud_fixture('cuttlefish')
        replaced = ['lib/x86_64/libeliza_bun.so', 'assets/agent/x86_64/bun']
        for name in replaced:
            entries[name] += b'changed'
        path = 'assets/agent/android-agent-runtime-provenance.json'
        provenance = json.loads(entries[path])
        for entry in provenance['files']:
            if entry['path'] in replaced:
                data = entries[entry['path']]
                entry.update(size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        entries[path] = json.dumps(provenance).encode()
        self.archive(list(entries.items()))
        self.overlay()
        with patch.object(native, 'ROOT', trust), self.assertRaisesRegex(ValueError, 'pinned binary'):
            native.stage(self.apk, self.output, 'AlphaPhone', 'cuttlefish')
        self.assertEqual(set(self.output.iterdir()), {self.output / 'Android.bp', self.output / 'Launcher.apk'})


if __name__ == '__main__':
    unittest.main()
