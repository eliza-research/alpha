"""Exercise the APK provenance boundary with real ZIP payloads."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import warnings
import zipfile

spec = importlib.util.spec_from_file_location('packaged_runtime', Path(__file__).resolve().parents[1] / 'scripts/verify-packaged-runtime.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
sha = lambda data: hashlib.sha256(data).hexdigest()


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
                   'scripts/prepare-local-agent.mjs': b'prepare',
                   'scripts/local-agent-source.mjs': b'guard'}
        for name, data in sources.items():
            self.write(name, data)
        stamp = {'base': self.pin, 'patches': []}
        for key, name in zip(['lockSha256', 'preparerSha256', 'guardSha256'], sources):
            stamp[key] = sha(sources[name])
        stamp_bytes = json.dumps(stamp).encode()
        worker = b'worker payload'
        manifest = json.dumps({'version': 1, 'sourceStampSha256': sha(stamp_bytes), 'files': {'worker.js': sha(worker)}}).encode()
        index = f'{sha(worker)}\tworker.js\n{sha(manifest)}\tmanifest.json\n'.encode()
        self.write('config/native-view-declarations.json', b'[]')
        self.entries = {'assets/agent/native-view-declarations.json': b'[]',
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
        self.write('config/native-view-declarations.json', b'["changed"]')
        with self.assertRaises(ValueError):
            verifier.verify(self.package(self.entries))

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
        self.write('scripts/local-agent-source.mjs', b'new guard')
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

    def cloud_entries(self):
        omitted = {'path': 'assets/agent/models/bge-small-en-v1.5-f16.gguf', 'sha256': 'f0b2fef971e8366438bfd2d9aefea1b0115919389448806d290237f638bae999'}
        self.entries['assets/agent/pglite.data'] = b'database payload'
        rows = [{'path': name, 'sha256': sha(data), 'size_bytes': len(data)} for name, data in self.entries.items() if name.endswith(('libeliza_bun.so', 'pglite.data', 'agent-bundle.js'))]
        self.entries['assets/agent/alpha-runtime-profile.json'] = json.dumps({'version': 1, 'runtimeProfile': 'cloud', 'omittedLocalModels': [omitted]}).encode()
        self.entries['assets/agent/android-agent-runtime-provenance.json'] = json.dumps({'schema': 'eliza.android_agent_runtime_provenance.v1', 'files': rows}).encode()
        for name, data in self.entries.items():
            if name.startswith('assets/'):
                self.write('android/app/src/main/' + name, data)
        return self.entries

    def test_cloud_apk_binds_database_and_producer_provenance_to_staged_bytes(self):
        entries = dict(self.cloud_entries())
        self.assertEqual(verifier.verify(self.package(entries), runtime_profile='cloud')['runtimeProfile'], 'cloud')
        entries['assets/agent/pglite.data'] = b'replaced database'
        provenance = json.loads(entries['assets/agent/android-agent-runtime-provenance.json'])
        for row in provenance['files']:
            if row['path'] == 'assets/agent/pglite.data':
                row['sha256'] = sha(entries[row['path']])
        entries['assets/agent/android-agent-runtime-provenance.json'] = json.dumps(provenance).encode()
        with self.assertRaisesRegex(ValueError, 'differs from admitted staged provenance'):
            verifier.verify(self.package(entries), runtime_profile='cloud')

    def test_cloud_android_arm64_debug_and_release_match_provenance(self):
        entries = dict(self.cloud_entries())
        del entries['lib/x86_64/libeliza_bun.so']
        name = 'assets/agent/android-agent-runtime-provenance.json'
        provenance = json.loads(entries[name])
        provenance['bun'] = {'target': 'android', 'architectures': ['arm64-v8a']}
        provenance['files'] = [row for row in provenance['files'] if not row['path'].startswith('lib/x86_64/')]
        entries[name] = json.dumps(provenance).encode()
        self.write('android/app/src/main/' + name, entries[name])
        for release in [False, True]:
            self.assertEqual(verifier.verify(self.package(entries), release=release, runtime_profile='cloud')['runtime'], 'PACKAGED')

    def test_cloud_apk_rejects_local_inference_and_models(self):
        original = dict(self.cloud_entries())
        for name in ['lib/x86_64/libggml-cpu.so', 'lib/arm64-v8a/libparadeevoicejni.so', 'assets/agent/models/extra.gguf']:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'local inference'):
                verifier.verify(self.package({**original, name: b'unadmitted local payload'}), runtime_profile='cloud')

    def test_duplicate_zip_entries_rejected(self):
        self.package()
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(self.apk, 'a') as archive:
                archive.writestr('assets/agent/agent-bundle.js', b'duplicate')
        with self.assertRaisesRegex(ValueError, 'Duplicate APK entries'):
            verifier.verify(self.apk)


    def local_entries(self):
        entries=dict(self.cloud_entries())
        # ZIP-only fixtures stub the separately tested canonical native source gate.
        source_gate=verifier.verify_local_embedding_source
        verifier.verify_local_embedding_source=lambda root: None
        self.addCleanup(setattr,verifier,'verify_local_embedding_source',source_gate)
        entries.pop('lib/x86_64/libeliza_bun.so')
        model=b'synthetic embedding model, not qualified device evidence'
        old=verifier.LOCAL_EMBEDDING_MODEL
        verifier.LOCAL_EMBEDDING_MODEL={**old,'sha256':sha(model)}
        self.addCleanup(setattr,verifier,'LOCAL_EMBEDDING_MODEL',old)
        entries[old['path']]=model
        libraries=[]
        for name in ['libelizainference.so','libelizavoicejni.so','libc++_shared.so']:
            data=('synthetic '+name).encode();entries['lib/arm64-v8a/'+name]=data
            self.write('android/app/src/main/jniLibs/arm64-v8a/'+name,data)
            libraries.append({'name':name,'sha256':sha(data)})
        record={'abi':'arm64-v8a','jniIdentityRelocated':True,'model':{'sha256':sha(model),'dimensions':384},'libraries':libraries}
        self.write('android/embedding-host/qualified-host.json',json.dumps(record).encode())
        self.record=record
        entries['assets/agent/alpha-runtime-profile.json']=json.dumps({'version':1,'runtimeProfile':'cloud','omittedLocalModels':[],'localEmbeddings':True}).encode()
        provenance=json.loads(entries['assets/agent/android-agent-runtime-provenance.json'])
        provenance['bun']={'target':'android','architectures':['arm64-v8a']}
        provenance['files']=[row for row in provenance['files'] if not row['path'].startswith('lib/x86_64/')]
        provenance['files'].append({'path':old['path'],'sha256':sha(model),'size_bytes':len(model)})
        entries['assets/agent/android-agent-runtime-provenance.json']=json.dumps(provenance).encode()
        for name,data in entries.items():
            if name.startswith('assets/'):self.write('android/app/src/main/'+name,data)
        return entries

    def test_explicit_capability_accepts_exact_model_and_three_libraries(self):
        entries=self.local_entries();result=verifier.verify(self.package(entries),runtime_profile='cloud',local_embeddings=True)
        self.assertEqual(result['runtime'],'PACKAGED');self.assertFalse(result['runtimeExecution'])

    def test_capability_cannot_be_assumed_from_assets(self):
        with self.assertRaisesRegex(ValueError,'profile mismatch'):
            verifier.verify(self.package(self.local_entries()),runtime_profile='cloud')

    def test_missing_library_rejected(self):
        entries=self.local_entries();entries.pop('lib/arm64-v8a/libelizavoicejni.so')
        with self.assertRaises(KeyError):verifier.verify(self.package(entries),runtime_profile='cloud',local_embeddings=True)

    def test_wrong_model_rejected(self):
        entries=self.local_entries();entries[verifier.LOCAL_EMBEDDING_MODEL['path']]=b'wrong'
        with self.assertRaises(ValueError):verifier.verify(self.package(entries),runtime_profile='cloud',local_embeddings=True)

    def test_stale_native_qualification_rejected(self):
        entries=self.local_entries();self.record['requalification']={'required':True};self.write('android/embedding-host/qualified-host.json',json.dumps(self.record).encode())
        with self.assertRaisesRegex(ValueError,'current qualification'):verifier.verify(self.package(entries),runtime_profile='cloud',local_embeddings=True)

    def test_speech_or_extra_model_rejected(self):
        entries=self.local_entries()
        for name in ['assets/paradee-voice/voice.gguf','assets/agent/models/chat.gguf','lib/arm64-v8a/libparadeevoicejni.so']:
            with self.subTest(name=name),self.assertRaisesRegex(ValueError,'unadmitted local inference'):
                verifier.verify(self.package({**entries,name:b'extra'}),runtime_profile='cloud',local_embeddings=True)

    def test_model_free_cloud_rejected_when_local_capability_requested(self):
        with self.assertRaisesRegex(ValueError,'profile mismatch'):verifier.verify(self.package(self.cloud_entries()),runtime_profile='cloud',local_embeddings=True)

    def test_production_bge_pin_unchanged(self):
        self.assertEqual(verifier.LOCAL_EMBEDDING_MODEL['sha256'],'f0b2fef971e8366438bfd2d9aefea1b0115919389448806d290237f638bae999')

    def test_canonical_native_source_failure_refuses_matching_payload(self):
        entries=self.local_entries()
        def rejected(root):
            raise ValueError('Local embedding source qualification failed')
        verifier.verify_local_embedding_source=rejected
        with self.assertRaisesRegex(ValueError,'source qualification failed'):
            verifier.verify(self.package(entries),runtime_profile='cloud',local_embeddings=True)

    def test_missing_canonical_source_checker_refuses_matching_payload(self):
        entries=self.local_entries()
        # Restore the actual subprocess gate: the fixture has no qualified checker/source.
        import importlib.util
        spec=importlib.util.spec_from_file_location('real_verifier',Path(__file__).resolve().parents[1]/'scripts/verify-packaged-runtime.py')
        real=importlib.util.module_from_spec(spec);spec.loader.exec_module(real)
        verifier.verify_local_embedding_source=real.verify_local_embedding_source
        with self.assertRaises(FileNotFoundError):
            verifier.verify(self.package(entries),runtime_profile='cloud',local_embeddings=True)


if __name__ == '__main__':
    unittest.main()
