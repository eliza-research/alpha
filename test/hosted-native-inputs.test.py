"""Closed fixtures for automatic native input admission. No external services."""
import copy
import datetime
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_inputs', ROOT / 'scripts/ci/hosted-native-inputs.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
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
    def __init__(self, archives):
        self.archives = archives

    def open(self, request, timeout):
        path = request.full_url.split('/actions/', 1)[1].split('/')
        if path == ['runs', '7']:
            return io.BytesIO(encoded({'head_sha': SOURCE, 'conclusion': 'success'}))
        assert path[0] == 'artifacts'
        data = self.archives[path[1]]
        if path[-1] == 'zip':
            return io.BytesIO(data)
        return io.BytesIO(encoded({
            'id': int(path[1]), 'digest': 'sha256:' + digest(data), 'size_in_bytes': len(data), 'expired': False,
            'workflow_run': {'id': 7, 'repository_id': native.embedding.REPOSITORY_ID,
                             'head_repository_id': native.embedding.REPOSITORY_ID, 'head_sha': SOURCE},
        }))


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

    def test_unreviewed_or_mismatched_shared_engine_fails_before_transport(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan, _ = fixture(root)
            voice = json.loads((root / native.VOICE_RECORD).read_text())
            voice['abis'][0]['libraries'][0]['sha256'] = 'd' * 64
            plan['voiceRecordSha256'] = write(root, native.VOICE_RECORD, voice)
            write(root, native.MANIFEST, plan)
            with self.assertRaisesRegex(ValueError, 'Voice and embedding libelizainference.so differ'):
                native.load_plan(root)
            voice['abis'][0]['engineAdmission'] = 'unreviewed workspace build'
            plan['voiceRecordSha256'] = write(root, native.VOICE_RECORD, voice)
            write(root, native.MANIFEST, plan)
            with self.assertRaisesRegex(ValueError, 'Unreviewed voice engine'):
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

    def test_automatic_workflow_admits_inputs_before_prepare_and_keeps_diagnostics(self):
        workflow = (ROOT / '.github/workflows/resident-android.yml').read_text()
        steps = ('Check the automatic native input manifest', 'Install pinned Android native toolchain',
                 'Acquire exact native inputs for the automatic candidate', 'Stage the admitted voice and embedding inputs',
                 'Prepare and qualify fresh resident source', 'bun scripts/stage-embedding-host.ts --verify',
                 'native-input-admission.json')
        self.assertEqual(sorted(workflow.index(step) for step in steps), [workflow.index(step) for step in steps])
        acquire = workflow.split('Acquire exact native inputs for the automatic candidate', 1)[1].split('      - name:', 1)[0]
        stage = workflow.split('Stage the admitted voice and embedding inputs', 1)[1].split('      - name:', 1)[0]
        self.assertIn("if: env.ALPHA_APP_UPDATE_CANDIDATE == '1'", acquire)
        self.assertIn("if: env.ALPHA_APP_UPDATE_CANDIDATE == '1'", stage)
        self.assertIn('GH_TOKEN:', acquire)
        self.assertNotIn('GH_TOKEN:', stage)
        self.assertIn("if: env.ALPHA_APP_UPDATE_CANDIDATE != '1'\n        run: bun scripts/voice-host.ts --verify --allow-absent", workflow)


if __name__ == '__main__':
    unittest.main()
