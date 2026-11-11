"""Exercise the APK provenance boundary with real ZIP payloads."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import warnings
import zipfile

spec = importlib.util.spec_from_file_location('packaged_runtime', Path(__file__).resolve().parents[1] / 'scripts/verify-packaged-runtime.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
sha = lambda data: hashlib.sha256(data).hexdigest()
NATIVE_VIEW_POLICY = verifier.ROOT / 'scripts/native-view-policy.ts'
NATIVE_VIEW_DECLARATIONS = subprocess.check_output(
    [os.environ.get('ALPHA_NODE', 'node'), NATIVE_VIEW_POLICY], timeout=30)


class PackagedRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.previous = verifier.ROOT
        verifier.ROOT = self.root
        self.addCleanup(setattr, verifier, 'ROOT', self.previous)
        self.pin = 'a' * 40
        sources = {'upstream.lock.json': json.dumps({'commit': self.pin}).encode(),
                   'scripts/prepare-local-agent.ts': b'prepare',
                   'scripts/local-agent-source.ts': b'guard'}
        for name, data in sources.items():
            self.write(name, data)
        stamp = {'base': self.pin, 'patches': []}
        for key, name in zip(['lockSha256', 'preparerSha256', 'guardSha256'], sources):
            stamp[key] = sha(sources[name])
        stamp_bytes = json.dumps(stamp).encode()
        worker = b'worker payload'
        manifest = json.dumps({'version': 1, 'sourceStampSha256': sha(stamp_bytes), 'files': {'worker.js': sha(worker)}}).encode()
        index = f'{sha(worker)}\tworker.js\n{sha(manifest)}\tmanifest.json\n'.encode()
        self.write('scripts/native-view-policy.ts', NATIVE_VIEW_POLICY.read_bytes())
        self.entries = {'assets/agent/native-view-declarations.json': NATIVE_VIEW_DECLARATIONS,
                        'assets/agent/alpha-source.json': stamp_bytes,
                        'assets/agent/agent-bundle.js': b'agent payload',
                        'assets/agent/agent-bundle-dependencies.json': json.dumps({
                            'version': 1, 'bundleSha256': sha(b'agent payload'),
                            'packages': [{'directory': 'node_modules/example', 'name': 'example', 'version': '1.0.0', 'packageJsonSha256': 'b' * 64}]
                        }).encode(),
                        'assets/agent/workflow-worker/worker.js': worker,
                        'assets/agent/workflow-worker/manifest.json': manifest,
                        'assets/agent/workflow-worker/files.sha256': index,
                        'lib/arm64-v8a/libeliza_bun.so': b'arm64 runtime',
                        'lib/x86_64/libeliza_bun.so': b'x86 runtime',
                        'lib/arm64-v8a/libeliza_ld_musl_aarch64.so': b'arm64 loader'}
        rows = [{'path': name, 'sha256': sha(data), 'size_bytes': len(data)} for name, data in self.entries.items() if name.startswith('lib/') or name.endswith('agent-bundle.js')]
        self.entries['assets/agent/alpha-runtime-profile.json'] = json.dumps({'version': 1, 'runtimeProfile': 'native'}).encode()
        self.entries['assets/agent/android-agent-runtime-provenance.json'] = json.dumps({'schema': 'eliza.android_agent_runtime_provenance.v1', 'files': rows}).encode()
        for name, data in self.entries.items():
            local = name.replace('assets/', 'android/app/src/main/assets/', 1) if name.startswith('assets/') else name.replace('lib/', 'android/app/src/main/jniLibs/', 1)
            self.write(local, data)
        self.apk = self.root / 'candidate.apk'

    def write(self, name, data):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def package(self, entries=None):
        with zipfile.ZipFile(self.apk, 'w') as archive:
            for name, data in (self.entries if entries is None else entries).items():
                archive.writestr(name, data)
        return self.apk

    def test_native_policy_must_match_reviewed_product_source(self):
        name = 'assets/agent/native-view-declarations.json'
        self.write('android/app/src/main/' + name, b'[]')
        with self.assertRaisesRegex(ValueError, 'Packaged runtime mismatch: ' + name):
            verifier.verify(self.package({**self.entries, name: b'[]'}))

    def test_valid_payload_is_byte_verified_without_execution_claim(self):
        result = verifier.verify(self.package())
        self.assertEqual(result['upstreamCommit'], self.pin)
        self.assertEqual(result['verifiedEntries'], 9)
        self.assertFalse(result['runtimeExecution'])

    def test_native_provenance_rows_are_checked(self):
        loader = 'lib/arm64-v8a/libeliza_ld_musl_aarch64.so'
        for release in [False, True]:
            with self.subTest(release=release, mutation='tampered'), self.assertRaisesRegex(ValueError, 'provenance mismatch: ' + loader):
                verifier.verify(self.package({**self.entries, loader: b'tampered loader'}), release=release)
            entries = dict(self.entries)
            del entries[loader]
            with self.subTest(release=release, mutation='missing'), self.assertRaisesRegex(ValueError, 'provenance entry missing: ' + loader):
                verifier.verify(self.package(entries), release=release)

    def test_native_requires_staged_provenance(self):
        entries = dict(self.entries)
        del entries['assets/agent/android-agent-runtime-provenance.json']
        (self.root / 'android/app/src/main/assets/agent/android-agent-runtime-provenance.json').unlink()
        with self.assertRaisesRegex(ValueError, 'provenance missing. Run: npm run agent:stage-android'):
            verifier.verify(self.package(entries))

    def test_native_apk_refuses_cloud_or_missing_profile_marker(self):
        name = 'assets/agent/alpha-runtime-profile.json'
        cloud = json.dumps({'version': 1, 'runtimeProfile': 'cloud', 'omittedLocalModels': []}).encode()
        with self.assertRaisesRegex(ValueError, 'differs from staged profile'):
            verifier.verify(self.package({**self.entries, name: cloud}))
        self.write('android/app/src/main/' + name, cloud)
        with self.assertRaisesRegex(ValueError, 'native profile mismatch'):
            verifier.verify(self.package({**self.entries, name: cloud}))
        entries = dict(self.entries)
        del entries[name]
        with self.assertRaisesRegex(ValueError, 'profile marker missing'):
            verifier.verify(self.package(entries))

    def test_inventory_must_describe_the_packaged_bundle_even_if_staging_matches(self):
        name = 'assets/agent/agent-bundle-dependencies.json'
        original = json.loads(self.entries[name])
        for changes in [{'bundleSha256': 'c' * 64}, {'version': 2}, {'packages': []}]:
            with self.subTest(changes=changes):
                self.entries[name] = json.dumps({**original, **changes}).encode()
                self.write('android/app/src/main/' + name, self.entries[name])
                with self.assertRaisesRegex(ValueError, 'dependency inventory does not match bundle'):
                    verifier.verify(self.package())

    def test_each_payload_byte_and_required_entry_is_checked(self):
        for name in self.entries:
            for mutation in ['alter', 'remove']:
                with self.subTest(name=name, mutation=mutation):
                    entries = dict(self.entries)
                    if mutation == 'alter':
                        entries[name] += b'altered'
                    else:
                        del entries[name]
                    with self.assertRaises((ValueError, KeyError)):
                        verifier.verify(self.package(entries))

    def test_extra_worker_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unexpected packaged worker'):
            verifier.verify(self.package({**self.entries, 'assets/agent/workflow-worker/extra.js': b'extra'}))

    def test_unsupported_dependency_abis_are_rejected_in_debug_and_release(self):
        for abi in ['armeabi-v7a', 'x86']:
            for release in [False, True]:
                with self.subTest(abi=abi, release=release):
                    entries = {**self.entries, f'lib/{abi}/libdependency.so': b'legacy dependency'}
                    with self.assertRaisesRegex(ValueError, 'Unexpected packaged ABI'):
                        verifier.verify(self.package(entries), release=release)

    def test_arm64_only_release_keeps_valid_runtime_admission(self):
        entries = dict(self.entries)
        del entries['lib/x86_64/libeliza_bun.so']
        self.assertEqual(verifier.verify(self.package(entries), release=True)['runtime'], 'PACKAGED')

    def android_entries(self):
        entries = dict(self.entries)
        del entries['lib/x86_64/libeliza_bun.so']
        provenance = {'schema': 'eliza.android_agent_runtime_provenance.v1',
                      'bun': {'target': 'android', 'architectures': ['arm64-v8a']}, 'files': []}
        entries['assets/agent/android-agent-runtime-provenance.json'] = json.dumps(provenance).encode()
        self.write('android/app/src/main/assets/agent/android-agent-runtime-provenance.json', entries['assets/agent/android-agent-runtime-provenance.json'])
        return entries

    def test_android_arm64_debug_and_release_match_admitted_runtime(self):
        entries = self.android_entries()
        for release in [False, True]:
            self.assertEqual(verifier.verify(self.package(entries), release=release)['runtime'], 'PACKAGED')

    def test_android_runtime_rejects_foreign_abi_missing_bun_and_missing_provenance(self):
        entries = self.android_entries()
        for abi in ['x86_64', 'armeabi-v7a', 'riscv64']:
            with self.subTest(abi=abi), self.assertRaisesRegex(ValueError, 'Unexpected packaged ABI'):
                verifier.verify(self.package({**entries, f'lib/{abi}/libcamera.so': b'foreign'}))
        for missing in ['lib/arm64-v8a/libeliza_bun.so', 'assets/agent/android-agent-runtime-provenance.json']:
            changed = dict(entries)
            del changed[missing]
            with self.subTest(missing=missing), self.assertRaises((ValueError, KeyError)):
                verifier.verify(self.package(changed))

    def test_android_provenance_rejects_invalid_targets_and_architectures(self):
        entries = self.android_entries()
        for bun in [{'target': 'other'}, {'target': 'android'}, {'target': 'android', 'architectures': []},
                    {'target': 'android', 'architectures': ['x86_64']},
                    {'target': 'android', 'architectures': ['arm64-v8a', 'arm64-v8a']},
                    {'target': 'android', 'architectures': ['arm64-v8a', 'x86_64']}]:
            changed = dict(entries)
            changed['assets/agent/android-agent-runtime-provenance.json'] = json.dumps({
                'schema': 'eliza.android_agent_runtime_provenance.v1', 'bun': bun, 'files': []}).encode()
            self.write('android/app/src/main/assets/agent/android-agent-runtime-provenance.json', changed['assets/agent/android-agent-runtime-provenance.json'])
            with self.subTest(bun=bun), self.assertRaises(ValueError):
                verifier.verify(self.package(changed))

    def test_changed_source_guard_rejects_otherwise_identical_apk(self):
        self.write('scripts/local-agent-source.ts', b'new guard')
        with self.assertRaisesRegex(ValueError, 'manifest mismatch'):
            verifier.verify(self.package())

    def test_worker_from_different_source_rejected_even_when_staging_matches(self):
        name = 'assets/agent/workflow-worker/manifest.json'
        manifest = json.loads(self.entries[name])
        manifest['sourceStampSha256'] = 'b' * 64
        self.entries[name] = json.dumps(manifest).encode()
        self.write('android/app/src/main/' + name, self.entries[name])
        with self.assertRaisesRegex(ValueError, 'different prepared runtime'):
            verifier.verify(self.package())

    def test_unstaged_runtime_is_rejected_but_empty_runtime_is_reported(self):
        (self.root / 'android/app/src/main/assets/agent/alpha-source.json').unlink()
        with self.assertRaisesRegex(ValueError, 'no authenticated staged source'):
            verifier.verify(self.package())
        result = verifier.verify(self.package({'classes.dex': b'ordinary app'}))
        self.assertEqual(result['runtime'], 'NOT_PACKAGED')
        self.assertFalse(result['runtimeExecution'])

    def test_a_packaged_runtime_reports_the_native_profile(self):
        self.assertEqual(verifier.verify(self.package())['runtimeProfile'], 'native')

    def test_local_models_and_inference_libraries_are_not_refused(self):
        # The removed Cloud verifier refused any local model or inference library in the APK.
        # Every build packages them now; entries outside the runtime provenance are not its concern.
        for name in ['lib/arm64-v8a/libelizainference.so', 'lib/arm64-v8a/libparadeevoicejni.so', 'assets/paradee-voice/model.onnx', 'assets/agent/models/bge-small-en-v1.5-f16.gguf']:
            with self.subTest(name=name):
                self.assertEqual(verifier.verify(self.package({**self.entries, name: b'local payload'}))['runtime'], 'PACKAGED')

    def test_duplicate_zip_entries_rejected(self):
        self.package()
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(self.apk, 'a') as archive:
                archive.writestr('assets/agent/agent-bundle.js', b'duplicate')
        with self.assertRaisesRegex(ValueError, 'Duplicate APK entries'):
            verifier.verify(self.apk)


if __name__ == '__main__':
    unittest.main()
