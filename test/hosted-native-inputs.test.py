"""Closed fixtures for automatic native input admission. No external services."""
import copy
import datetime
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_inputs', ROOT / 'scripts/ci/hosted-native-inputs.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
export_spec = importlib.util.spec_from_file_location('export_native_inputs', ROOT / 'scripts/ci/export-native-inputs.py')
exporter = importlib.util.module_from_spec(export_spec)
export_spec.loader.exec_module(exporter)
PACKAGE, SDK, ENGINE, SOURCE = 'ai.alphacompute.alphaphone', 'a' * 40, 'b' * 40, 'c' * 40


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fact(data):
    return {'bytes': len(data), 'sha256': digest(data)}


def encoded(value):
    return json.dumps(value).encode()


def write(root, path, value):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    data = encoded(value)
    target.write_bytes(data)
    return digest(data)


def zipped(entries):
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w') as output:
        for name, value in entries.items():
            output.writestr(name, value)
    return archive.getvalue()


def fixture(root, *, bad_voice=False, bad_component=False):
    reviewed = json.loads((ROOT / native.EMBEDDING_RECORD).read_text())
    reviewed.update(pin=SDK, forkPin=ENGINE, identity=PACKAGE)
    libraries = {name: name.encode() for name in native.embedding.LIBRARIES}
    reviewed['libraries'] = [{'name': name, **fact(data), 'alignment16KiB': True} for name, data in libraries.items()]
    voice = {'pin': SDK, 'forkPin': ENGINE, 'identity': PACKAGE, 'bundle': {'assetRoot': native.VOICE_ASSETS},
             'models': [{'path': 'model.gguf', **fact(b'voice')}], 'abis': []}
    voice_members = {f'{native.VOICE_ASSETS}/model.gguf': b'wrong' if bad_voice else b'voice'}
    for abi in native.ABIS:
        entries = []
        for name in native.VOICE_LIBRARIES:
            data = libraries[name] if abi == 'arm64-v8a' else abi.encode() + libraries[name]
            voice_members[f'jniLibs/{abi}/{name}'] = data
            entries.append({'name': name, **fact(data)})
        voice['abis'].append({'abi': abi, 'libraries': entries})
    if bad_component:
        libraries['libelizavoicejni.so'] = b'other JNI'
    component = {key: reviewed[key] for key in ('pin', 'forkPin', 'identity', 'abi', 'inputs', 'producerInputs', 'jniBinding')}
    component.update(built=True, libraries=[
        {'path': '/producer/' + name, **fact(data), 'alignment16KiB': True} for name, data in libraries.items()
    ])
    semantic = encoded({'pass': True, 'nativeAbi': '21', 'dimensions': 384, 'embeddingCalls': 10,
                        'callerRetirementDrained': True, 'nativeKernelCancellationClaimed': False, 'rawNorms': [1] * 10,
                        'repeatCosine': 1, 'reopenCosine': 1, 'relatedCosine': .9, 'unrelatedCosine': .1, 'elapsedMs': 100})
    qualification = {**component, 'qualifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                     'semanticReceiptSha256': digest(semantic)}
    archives = {
        'voice': zipped(voice_members),
        'embeddingComponent': zipped({
            'component-output/INTENT.json': encoded({'SDK': SDK, 'native': ENGINE, 'source': SOURCE}),
            'component-output/export/PREPARATION.json': encoded(component),
            **{'component-output/export/' + name: data for name, data in libraries.items()},
        }),
        'embeddingQualification': zipped({'QUALIFICATION.json': encoded(qualification), 'embedding-qualification.json': semantic}),
    }
    plan = {'schema': 'alpha-hosted-native-inputs/v1', 'packageName': PACKAGE, 'sdkCommit': SDK,
            'voiceRecordSha256': write(root, native.VOICE_RECORD, voice),
            'embeddingRecordSha256': write(root, native.EMBEDDING_RECORD, reviewed),
            'artifacts': {name: {'id': str(index), 'sha256': digest(data)} for index, (name, data) in enumerate(archives.items(), 11)}}
    write(root, 'app.config.json', {'appId': PACKAGE})
    write(root, 'upstream.lock.json', {'commit': SDK})
    write(root, native.MANIFEST, plan)
    return plan, {plan['artifacts'][name]['id']: data for name, data in archives.items()}


class ArtifactAPI:
    def __init__(self, archives, *, overrides=None, result='success'):
        self.archives = archives
        self.overrides = overrides or {}
        self.result = result
        self.requests = []
        self.expiry = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3)).strftime('%Y-%m-%dT%H:%M:%SZ')

    def open(self, request, timeout):
        path = request.full_url.split('/actions/', 1)[1].split('/')
        self.requests.append(path)
        if path == ['runs', '7']:
            return io.BytesIO(encoded({'head_sha': SOURCE, 'conclusion': self.result}))
        assert path[0] == 'artifacts'
        data = self.archives[path[1]]
        if path[-1] == 'zip':
            return io.BytesIO(data)
        return io.BytesIO(encoded({
            'id': int(path[1]), 'digest': 'sha256:' + digest(data), 'size_in_bytes': len(data), 'expired': False,
            'expires_at': self.expiry,
            'workflow_run': {'id': 7, 'repository_id': native.embedding.REPOSITORY_ID,
                             'head_repository_id': native.embedding.REPOSITORY_ID, 'head_sha': SOURCE},
            **self.overrides.get(path[1], {}),
        }))


class NativeInputPacketTest(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='alpha-input-packet-test-')
        self.addCleanup(scratch.cleanup)
        self.base = Path(scratch.name).resolve()
        self.root = self.base / 'alpha'
        self.root.mkdir()
        plan, archives = fixture(self.root)
        (self.root / native.MANIFEST).unlink()
        self.git('init', '-q')
        self.git('add', 'app.config.json', 'upstream.lock.json', 'android')
        self.git('update-index', '--add', '--cacheinfo', f'160000,{SDK},vendor/eliza')
        self.git('commit', '-qm', 'Reviewed product and native records')
        self.source = self.git('rev-parse', 'HEAD').strip()
        self.inputs = []
        self.expected = {}
        for artifact, folder in zip(native.ARTIFACTS, ('voice', 'embedding-component', 'embedding-qualification')):
            directory = self.base / folder
            directory.mkdir()
            data = archives[plan['artifacts'][artifact]['id']]
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                for name in archive.namelist():
                    content = archive.read(name)
                    target = directory / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(content)
                    self.expected[f'{folder}/{name}'] = content
            (directory / 'private-host-log.txt').write_text('outside the approved inventory')
            self.inputs.append(directory)
        self.output = self.base / 'output'
        self.output.mkdir()

    def git(self, *args):
        return subprocess.check_output(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                                        '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', *args],
                                       cwd=self.root, text=True)

    def export(self):
        return exporter.export_packet(self.root, *self.inputs, self.output)

    def test_exports_only_exact_inputs_and_binds_the_committed_records(self):
        target = self.export()
        self.assertEqual(target, self.output / exporter.PACKET)
        self.assertEqual(list(self.output.iterdir()), [target])
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        with zipfile.ZipFile(target) as archive:
            self.assertEqual(set(archive.namelist()), {*self.expected, exporter.RECEIPT})
            for name, data in self.expected.items():
                self.assertEqual(archive.read(name), data)
            receipt = json.loads(archive.read(exporter.RECEIPT))
        self.assertEqual(receipt['sourceCommit'], self.source)
        self.assertEqual(receipt['sdkCommit'], SDK)
        self.assertEqual(receipt['packageName'], PACKAGE)
        self.assertEqual(receipt['files'], {name: fact(data) for name, data in self.expected.items()})
        self.assertEqual(receipt['recordSha256'], {name: digest((self.root / name).read_bytes())
                                                   for name in ('app.config.json', 'upstream.lock.json',
                                                                native.VOICE_RECORD, native.EMBEDDING_RECORD)})
        self.assertNotIn('artifacts', receipt)
        self.assertFalse((self.root / native.MANIFEST).exists())

    def test_refuses_changed_voice_or_embedding_bytes_without_output(self):
        for key, reason in ((f'voice/{native.VOICE_ASSETS}/model.gguf', 'Voice artifact digest'),
                            ('embedding-component/component-output/export/libelizavoicejni.so', 'Embedding library digest')):
            with self.subTest(member=key):
                target = self.base / key
                original = target.read_bytes()
                target.write_bytes(bytes([original[0] ^ 1]) + original[1:])
                with self.assertRaisesRegex(ValueError, reason):
                    self.export()
                self.assertEqual(list(self.output.iterdir()), [])
                target.write_bytes(original)

    def test_semantic_receipt_must_pass_and_bind_the_copied_bytes(self):
        semantic = self.inputs[2] / 'embedding-qualification.json'
        invalid = json.loads(semantic.read_bytes())
        invalid['pass'] = False
        semantic.write_bytes(encoded(invalid))
        with self.assertRaisesRegex(ValueError, 'Semantic receipt not bound'):
            self.export()
        qualification = self.inputs[2] / 'QUALIFICATION.json'
        value = json.loads(qualification.read_bytes())
        value['semanticReceiptSha256'] = digest(semantic.read_bytes())
        qualification.write_bytes(encoded(value))
        with self.assertRaisesRegex(ValueError, 'Actual ARM64 semantic qualification did not pass'):
            self.export()
        self.assertEqual(list(self.output.iterdir()), [])

    def test_refuses_symlink_member_and_output_ancestor(self):
        model = self.inputs[0] / native.VOICE_ASSETS / 'model.gguf'
        exact = self.base / 'detached-model'
        model.rename(exact)
        model.symlink_to(exact)
        with self.assertRaises(OSError):
            self.export()
        self.assertEqual(list(self.output.iterdir()), [])
        model.unlink()
        exact.rename(model)
        alias = self.base / 'aliased'
        alias.symlink_to(self.output, target_is_directory=True)
        with self.assertRaises(OSError):
            exporter.export_packet(self.root, *self.inputs, alias)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_reviewed_records_must_match_the_commit_and_sdk_gitlink(self):
        voice = self.root / native.VOICE_RECORD
        original = voice.read_bytes()
        voice.write_bytes(original + b'\n')
        with self.assertRaisesRegex(ValueError, 'differs from committed Alpha source'):
            self.export()
        voice.write_bytes(original)
        self.git('update-index', '--add', '--cacheinfo', f"160000,{'f' * 40},vendor/eliza")
        self.git('commit', '-qm', 'Mismatched SDK gitlink')
        with self.assertRaisesRegex(ValueError, 'SDK lock differs'):
            self.export()
        self.assertEqual(list(self.output.iterdir()), [])

    def test_git_replacements_cannot_supply_the_committed_records(self):
        voice = self.root / native.VOICE_RECORD
        voice.write_bytes(voice.read_bytes() + b'\n')
        self.git('add', native.VOICE_RECORD)
        tree = self.git('write-tree').strip()
        replacement = self.git('commit-tree', tree, '-m', 'Replacement source records').strip()
        self.git('replace', self.source, replacement)
        self.assertEqual(self.git('rev-parse', 'HEAD').strip(), self.source)
        self.assertEqual(self.git('show', f'HEAD:{native.VOICE_RECORD}'), voice.read_text())
        with self.assertRaisesRegex(ValueError, 'differs from committed Alpha source'):
            self.export()
        self.assertEqual(list(self.output.iterdir()), [])

    def test_output_must_be_private_to_its_owner_and_outside_vendor(self):
        self.output.chmod(0o775)
        with self.assertRaisesRegex(ValueError, 'writable only by its owner'):
            self.export()
        self.assertEqual(list(self.output.iterdir()), [])
        vendor = self.root / 'vendor/eliza'
        vendor.mkdir(parents=True)
        aliases = [vendor]
        case_alias = self.root / 'Vendor/eliza'
        if case_alias.is_dir():
            aliases.append(case_alias)
        for output in aliases:
            with self.subTest(output=output), self.assertRaisesRegex(ValueError, 'Output must be outside vendor'):
                exporter.export_packet(self.root, *self.inputs, output)
        self.assertEqual(list(vendor.iterdir()), [])

    def test_publication_race_preserves_other_packet(self):
        target = self.output / exporter.PACKET
        verify = exporter.verify_packet

        def raced(*args):
            verify(*args)
            target.write_bytes(b'other operator packet')

        with patch.object(exporter, 'verify_packet', side_effect=raced), self.assertRaises(FileExistsError):
            self.export()
        self.assertEqual(target.read_bytes(), b'other operator packet')
        self.assertEqual(list(self.output.iterdir()), [target])

    def test_verifies_the_actual_copied_packet_members(self):
        pack = exporter.pack_member

        def changed_copy(archive, root_fd, name, member, limit):
            if member == f'voice/{native.VOICE_ASSETS}/model.gguf':
                archive.writestr(member, b'other')
                return fact(b'voice')
            return pack(archive, root_fd, name, member, limit)

        with patch.object(exporter, 'pack_member', side_effect=changed_copy):
            with self.assertRaisesRegex(ValueError, 'Copied packet member differs'):
                self.export()
        self.assertEqual(list(self.output.iterdir()), [])

    def test_retains_the_original_compiled_sdk_when_the_reviewed_inputs_match(self):
        original_sdk = 'd' * 40
        component = self.inputs[1] / 'component-output'
        preparation = component / 'export/PREPARATION.json'
        qualification = self.inputs[2] / 'QUALIFICATION.json'
        for file in (preparation, qualification):
            value = json.loads(file.read_bytes())
            file.write_bytes(encoded({**value, 'pin': original_sdk}))
        intent = component / 'INTENT.json'
        intent.write_bytes(encoded({**json.loads(intent.read_bytes()), 'SDK': original_sdk}))
        with zipfile.ZipFile(self.export()) as archive:
            self.assertEqual(json.loads(archive.read(exporter.RECEIPT))['sdkCommit'], SDK)
            self.assertEqual(json.loads(archive.read('embedding-component/component-output/export/PREPARATION.json'))['pin'],
                             original_sdk)


class HostedNativeInputsTest(unittest.TestCase):
    def test_checked_in_voice_inventory_is_extractable(self):
        voice = json.loads((ROOT / native.VOICE_RECORD).read_text())
        inventory = native.voice_inventory(voice)
        self.assertEqual(len(inventory), len(voice['models']) + len(native.ABIS) * len(native.VOICE_LIBRARIES))
        self.assertIn('jniLibs/x86_64/libc++_shared.so', inventory)

    def test_missing_manifest_names_exact_path(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(ValueError, 'Missing ' + native.MANIFEST):
            native.load_plan(Path(directory))

    def test_stale_package_sdk_record_and_artifact_pins_fail_before_transport(self):
        changes = (
            ('package', lambda plan: plan.update(packageName='other.app')),
            ('SDK is stale', lambda plan: plan.update(sdkCommit='d' * 40)),
            ('record digests are stale', lambda plan: plan.update(voiceRecordSha256='0' * 64)),
            ('Invalid voice artifact pin', lambda plan: plan['artifacts']['voice'].update(id='latest')),
            ('Invalid voice artifact pin', lambda plan: plan['artifacts']['voice'].update(id='9007199254740992')),
            ('Native artifacts must be distinct', lambda plan: plan['artifacts']['voice'].update(id='12')),
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original, _ = fixture(root)
            for reason, mutate in changes:
                with self.subTest(reason=reason), self.assertRaisesRegex(ValueError, reason):
                    plan = copy.deepcopy(original)
                    mutate(plan)
                    write(root, native.MANIFEST, plan)
                    native.load_plan(root)

    def test_mismatched_shared_engine_fails_before_transport(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan, _ = fixture(root)
            voice = json.loads((root / native.VOICE_RECORD).read_text())
            voice['abis'][0]['libraries'][0]['sha256'] = 'd' * 64
            plan['voiceRecordSha256'] = write(root, native.VOICE_RECORD, voice)
            write(root, native.MANIFEST, plan)
            with self.assertRaisesRegex(ValueError, 'Voice and embedding libelizainference.so differ'):
                native.load_plan(root)

    def acquire(self, root, **options):
        _, archives = fixture(root, **options)
        env = {'GITHUB_REPOSITORY': native.embedding.REPOSITORY, 'GH_TOKEN': 'inert-fixture-token',
               'GITHUB_REPOSITORY_ID': str(native.embedding.REPOSITORY_ID),
               'GITHUB_REPOSITORY_OWNER_ID': str(native.embedding.REPOSITORY_OWNER_ID),
               'GITHUB_SHA': SOURCE, 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2'}
        def committed(args, **kwargs):
            return native.subprocess.CompletedProcess(args, 0, (root / args[-1].removeprefix('HEAD:')).read_bytes())
        with patch.object(native.subprocess, 'check_output', return_value=SOURCE + '\n'), \
             patch.object(native.subprocess, 'run', side_effect=committed), \
             patch.object(native.urllib.request, 'build_opener', return_value=ArtifactAPI(archives)):
            native.acquire(root, env, *native.load_plan(root))

    def test_complete_immutable_artifacts_produce_bound_admission(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.acquire(root)
            output = root / native.OUTPUT
            self.assertEqual((output / 'voice' / native.VOICE_ASSETS / 'model.gguf').read_bytes(), b'voice')
            self.assertEqual((output / 'embedding/libelizavoicejni.so').read_bytes(), b'libelizavoicejni.so')
            receipt = json.loads((output / 'admission.json').read_text())
            self.assertEqual((receipt['source'], receipt['sdkCommit'], receipt['runId'], receipt['attempt']),
                             (SOURCE, SDK, '123', '2'))
            self.assertEqual(receipt['manifestSha256'], digest((root / native.MANIFEST).read_bytes()))
            self.assertEqual(receipt['artifacts']['voice']['artifactId'], 11)
            self.assertGreater(receipt['artifacts']['voice']['archiveBytes'], receipt['artifacts']['voice']['expandedBytes'])

    def test_changed_uncommitted_manifest_is_refused_before_transport(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root)
            env = {'GITHUB_REPOSITORY': native.embedding.REPOSITORY, 'GH_TOKEN': 'inert-fixture-token',
                   'GITHUB_REPOSITORY_ID': str(native.embedding.REPOSITORY_ID),
                   'GITHUB_REPOSITORY_OWNER_ID': str(native.embedding.REPOSITORY_OWNER_ID),
                   'GITHUB_SHA': SOURCE, 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2'}
            changed = native.subprocess.CompletedProcess([], 0, b'other committed input pins')
            with patch.object(native.subprocess, 'check_output', return_value=SOURCE + '\n'), \
                 patch.object(native.subprocess, 'run', return_value=changed), \
                 patch.object(native.urllib.request, 'build_opener') as transport, \
                 self.assertRaisesRegex(ValueError, native.MANIFEST + ' differs from the reviewed checkout'):
                native.acquire(root, env, *native.load_plan(root))
            transport.assert_not_called()

    def test_archive_hash_alone_cannot_admit_other_model_or_embedding_bytes(self):
        for options, reason in (({'bad_voice': True}, 'Voice artifact digest differs'),
                                ({'bad_component': True}, 'Embedding component libraries differ')):
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with self.assertRaisesRegex(ValueError, reason):
                    self.acquire(root, **options)
                self.assertFalse((root / native.OUTPUT).exists())

    def test_remote_preflight_reports_all_exact_expiries_without_archive_requests_or_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _, archives = fixture(root)
            plan, plan_digest, _, inventory = native.load_plan(root)
            api = ArtifactAPI(archives, overrides={'12': {'expires_at': '2098-01-01T00:00:00Z'}})
            with patch.object(native, 'admit_consumer', return_value=('fixture-token', SOURCE, '123', '1')) as consumer, \
                 patch.object(native.urllib.request, 'build_opener', return_value=api):
                self.assertEqual(native.check_remote(root, {}, plan, plan_digest, inventory),
                                 {'voice': api.expiry, 'embeddingComponent': '2098-01-01T00:00:00Z',
                                  'embeddingQualification': api.expiry})
            consumer.assert_called_once_with(root, {}, plan, plan_digest)
            self.assertEqual(api.requests, [path for artifact_id in archives
                                           for path in (['artifacts', artifact_id], ['runs', '7'])])
            self.assertFalse((root / native.OUTPUT).parent.exists())

    def test_remote_preflight_names_each_expired_or_replaced_pin_and_rejects_failed_producers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _, archives = fixture(root)
            plan, plan_digest, _, inventory = native.load_plan(root)
            cases = (
                (ArtifactAPI(archives, overrides={'11': {'expired': True}, '12': {'digest': 'different'},
                                                '13': {'expires_at': '2001-01-01T00:00:00Z'}}),
                 r'(?s)voice artifact 11: .*expired.*embeddingComponent artifact 12: .*digest.*'
                 r'embeddingQualification artifact 13: .*expired'),
                (ArtifactAPI(archives, result='failure'), r'voice artifact 11: Artifact run did not succeed'),
                (ArtifactAPI(archives, overrides={'13': {'expires_at': 'not a date'}}),
                 r'embeddingQualification artifact 13: Artifact expiry timestamp is unavailable'),
            )
            for api, reason in cases:
                with self.subTest(reason=reason), \
                     patch.object(native, 'admit_consumer', return_value=('fixture-token', SOURCE, '123', '1')), \
                     patch.object(native.urllib.request, 'build_opener', return_value=api), \
                     self.assertRaisesRegex(ValueError, reason):
                    native.check_remote(root, {}, plan, plan_digest, inventory)
                self.assertTrue(all(path[-1] != 'zip' for path in api.requests))
                self.assertFalse((root / native.OUTPUT).parent.exists())

    def test_automatic_workflow_admits_inputs_before_prepare_and_keeps_diagnostics(self):
        workflow = (ROOT / '.github/workflows/resident-android.yml').read_text()
        steps = ('Check the automatic native input manifest and artifact availability',
                 'actions/setup-java@', 'android-actions/setup-android@', 'Install pinned Android native toolchain',
                 'Acquire exact native inputs for the automatic candidate', 'Stage the admitted voice and embedding inputs',
                 'Prepare and qualify fresh resident source', 'bun scripts/stage-embedding-host.ts --verify',
                 'native-input-admission.json')
        self.assertEqual(sorted(workflow.index(step) for step in steps), [workflow.index(step) for step in steps])
        preflight = workflow.split('Check the automatic native input manifest and artifact availability', 1)[1].split('      - ', 1)[0]
        self.assertIn("if: env.ALPHA_APP_UPDATE_CANDIDATE == '1'", preflight)
        self.assertIn('GH_TOKEN:', preflight)
        self.assertIn('--check-remote', preflight)
        acquire = workflow.split('Acquire exact native inputs for the automatic candidate', 1)[1].split('      - name:', 1)[0]
        stage = workflow.split('Stage the admitted voice and embedding inputs', 1)[1].split('      - name:', 1)[0]
        self.assertIn("if: env.ALPHA_APP_UPDATE_CANDIDATE == '1'", acquire)
        self.assertIn("if: env.ALPHA_APP_UPDATE_CANDIDATE == '1'", stage)
        self.assertIn('GH_TOKEN:', acquire)
        self.assertNotIn('GH_TOKEN:', stage)
        self.assertIn("if: env.ALPHA_APP_UPDATE_CANDIDATE != '1'\n        run: bun scripts/voice-host.ts --verify --allow-absent", workflow)


if __name__ == '__main__':
    unittest.main()
