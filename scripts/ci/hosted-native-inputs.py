"""Resolve the reviewed native inputs for an automatic unsigned APK candidate."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = 'android/hosted-native-inputs.json'
VOICE_RECORD = 'android/voice-host/qualified-voice-host.json'
EMBEDDING_RECORD = 'android/embedding-host/qualified-host.json'
OUTPUT = 'test-results/resident-ci-native-inputs'
VOICE_ASSETS = 'assets/paradee-voice/v1'
ABIS = ('arm64-v8a', 'x86_64')
VOICE_LIBRARIES = ('libelizainference.so', 'libc++_shared.so')
ARTIFACTS = ('voice', 'embeddingComponent', 'embeddingQualification')
SHA256 = re.compile(r'[0-9a-f]{64}')
COMMIT = re.compile(r'[0-9a-f]{40}')
ID = re.compile(r'[1-9][0-9]{0,19}')

spec = importlib.util.spec_from_file_location('embedding_artifacts', Path(__file__).with_name('embedding-artifacts.py'))
embedding = importlib.util.module_from_spec(spec)
spec.loader.exec_module(embedding)
require = embedding.require


def matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def record(root, name):
    file = root / name
    require(file.exists(), f'Missing {name}. Supply the reviewed exact native input manifest before building an automatic candidate.')
    info = file.lstat()
    require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= 1024 * 1024, f'Invalid {name}')
    raw = file.read_bytes()
    value = json.loads(raw)
    require(isinstance(value, dict), f'Invalid {name}')
    return value, hashlib.sha256(raw).hexdigest()


def voice_inventory(voice):
    require(voice['bundle']['assetRoot'] == VOICE_ASSETS, 'Voice artifact layout differs from the reviewed record')
    require(isinstance(voice['models'], list) and voice['models'], 'Reviewed voice model inventory is empty')
    require([row['abi'] for row in voice['abis']] == list(ABIS), 'Reviewed voice ABI inventory differs')
    rows = [(f'{VOICE_ASSETS}/{row["path"]}', row) for row in voice['models']]
    for abi in voice['abis']:
        require([row['name'] for row in abi['libraries']] == list(VOICE_LIBRARIES), 'Reviewed voice library inventory differs')
        rows.extend((f'jniLibs/{abi["abi"]}/{row["name"]}', row) for row in abi['libraries'])
    inventory = {}
    names = set()
    for name, row in rows:
        path = PurePosixPath(name)
        require(re.fullmatch(r'[A-Za-z0-9._+/-]+', name) and not path.is_absolute() and '..' not in path.parts
                and name == path.as_posix() and name.casefold() not in names, 'Invalid reviewed voice member path')
        require(type(row['bytes']) is int and row['bytes'] > 0 and matches(SHA256, row['sha256']),
                'Invalid reviewed voice member digest or size')
        names.add(name.casefold())
        inventory[name] = {'bytes': row['bytes'], 'sha256': row['sha256']}
    return inventory


def load_plan(root):
    plan, digest = record(root, MANIFEST)
    require(set(plan) == {'schema', 'packageName', 'sdkCommit', 'voiceRecordSha256', 'embeddingRecordSha256', 'artifacts'}
            and plan['schema'] == 'alpha-hosted-native-inputs/v1', f'Invalid {MANIFEST} schema')
    package = record(root, 'app.config.json')[0]['appId']
    sdk = record(root, 'upstream.lock.json')[0]['commit']
    voice, voice_digest = record(root, VOICE_RECORD)
    reviewed, embedding_digest = record(root, EMBEDDING_RECORD)
    require(plan['packageName'] == package == voice['identity'] == reviewed['identity'], 'Hosted native input package differs')
    require(matches(COMMIT, sdk) and plan['sdkCommit'] == sdk == voice['pin'], 'Hosted native input SDK is stale')
    require(plan['voiceRecordSha256'] == voice_digest and plan['embeddingRecordSha256'] == embedding_digest,
            'Hosted native input record digests are stale')
    require(matches(COMMIT, voice['forkPin']) and voice['forkPin'] == reviewed['forkPin'], 'Reviewed native engine source differs')
    artifacts = plan['artifacts']
    require(isinstance(artifacts, dict) and set(artifacts) == set(ARTIFACTS), 'Three reviewed native artifacts required')
    for name, entry in artifacts.items():
        require(isinstance(entry, dict) and set(entry) == {'id', 'sha256'} and
                matches(ID, entry['id']) and int(entry['id']) <= 9007199254740991 and
                matches(SHA256, entry['sha256']), f'Invalid {name} artifact pin')
    require(len({row['id'] for row in artifacts.values()}) == len(ARTIFACTS), 'Native artifacts must be distinct')
    inventory = voice_inventory(voice)
    require(reviewed['abi'] == 'arm64-v8a' and len(reviewed['libraries']) == len(embedding.LIBRARIES)
            and {row['name'] for row in reviewed['libraries']} == set(embedding.LIBRARIES)
            and all(type(row['bytes']) is int and row['bytes'] > 0 and matches(SHA256, row['sha256'])
                    and row['alignment16KiB'] is True for row in reviewed['libraries']),
            'Reviewed embedding library inventory differs')
    reviewed_libraries = {row['name']: (row['bytes'], row['sha256']) for row in reviewed['libraries']}
    for name in VOICE_LIBRARIES:
        shared = inventory[f'jniLibs/arm64-v8a/{name}']
        require(reviewed_libraries.get(name) == (shared['bytes'], shared['sha256']), f'Voice and embedding {name} differ')
    return plan, digest, reviewed, inventory


def extract_voice(archive, target, inventory):
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        require(len(entries) == len(inventory) and {item.filename for item in entries} == set(inventory),
                'Voice artifact members differ from the reviewed inventory')
        for entry in entries:
            expected = inventory[entry.filename]
            mode = stat.S_IFMT(entry.external_attr >> 16)
            require(mode in (0, stat.S_IFREG) and not entry.flag_bits & 1 and entry.file_size == expected['bytes'],
                    'Invalid voice artifact member type or size')
            destination = target / entry.filename
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            count, digest = 0, hashlib.sha256()
            with source.open(entry) as reader, destination.open('xb') as writer:
                while chunk := reader.read(1024 * 1024):
                    count += len(chunk)
                    require(count <= expected['bytes'], 'Voice artifact member exceeds reviewed size')
                    digest.update(chunk)
                    writer.write(chunk)
            require(count == expected['bytes'] and digest.hexdigest() == expected['sha256'],
                    f'Voice artifact digest differs: {entry.filename}')


def verify_component(component, reviewed):
    for key in ('forkPin', 'identity', 'abi', 'inputs', 'producerInputs', 'jniBinding'):
        require(component.get(key) == reviewed[key], f'Embedding component differs from reviewed {key}')
    compiled = {Path(row['path']).name: (row['bytes'], row['sha256'], row['alignment16KiB']) for row in component['libraries']}
    expected = {row['name']: (row['bytes'], row['sha256'], row['alignment16KiB']) for row in reviewed['libraries']}
    require(compiled == expected, 'Embedding component libraries differ from the reviewed record')


def acquire(root, env, plan, plan_digest, reviewed, inventory):
    require(embedding.canonical_repository(env), 'Canonical repository required')
    token = env.get('GH_TOKEN')
    require(token, 'Native artifact access token unavailable')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    require(matches(COMMIT, source) and source == env.get('GITHUB_SHA'), 'Native inputs consumer source differs')
    for name, expected in ((MANIFEST, plan_digest), (VOICE_RECORD, plan['voiceRecordSha256']),
                           (EMBEDDING_RECORD, plan['embeddingRecordSha256'])):
        committed = subprocess.run(['git', 'show', f'HEAD:{name}'], cwd=root, capture_output=True)
        require(committed.returncode == 0 and hashlib.sha256(committed.stdout).hexdigest() == expected,
                f'{name} differs from the reviewed checkout')
    run, attempt = env.get('GITHUB_RUN_ID'), env.get('GITHUB_RUN_ATTEMPT')
    require(matches(ID, run) and matches(ID, attempt), 'Native inputs consumer run identity missing')
    target = root / OUTPUT
    target.parent.mkdir(parents=True, exist_ok=True)
    require(not target.exists() and not target.is_symlink(), 'Native input output already exists')
    opener = urllib.request.build_opener(embedding.NoRedirect())
    with tempfile.TemporaryDirectory(dir=target.parent, prefix='native-inputs-') as directory:
        pending = Path(directory) / 'inputs'
        pending.mkdir(mode=0o700)
        receipts = {}
        voice_bytes = sum(row['bytes'] for row in inventory.values())
        # Exact expanded file sizes are checked separately. Allow ZIP framing and
        # compression overhead only for this voice archive's known inventory.
        voice_bound = voice_bytes + (voice_bytes + 99) // 100 + 65536
        for name in ARTIFACTS:
            pin = plan['artifacts'][name]
            archive = pending / f'{name}.zip'
            receipt = embedding.download(pin['id'], pin['sha256'], archive, token, opener,
                                         max_archive=voice_bound if name == 'voice' else embedding.MAX_ARCHIVE)
            if name == 'voice':
                extract_voice(archive, pending / 'voice', inventory)
            elif name == 'embeddingComponent':
                embedding.extract_selected(archive, pending / 'embedding', {
                    'component-output/export/PREPARATION.json': 'PREPARATION.json',
                    'component-output/INTENT.json': 'INTENT.json',
                    **{'component-output/export/' + lib: lib for lib in embedding.LIBRARIES}})
            else:
                embedding.extract_selected(archive, pending / 'qualification', {
                    'QUALIFICATION.json': 'QUALIFICATION.json',
                    'embedding-qualification.json': 'embedding-qualification.json'})
            with zipfile.ZipFile(archive) as z:
                receipts[name] = {**receipt, 'archiveBytes': archive.stat().st_size,
                                  'expandedBytes': sum(entry.file_size for entry in z.infolist())}
            archive.unlink()
        component_dir = pending / 'embedding'
        component = embedding.read_json(component_dir / 'PREPARATION.json')
        qualification = pending / 'qualification'
        semantic = qualification / 'embedding-qualification.json'
        identity = embedding.validate_receipts(component, embedding.read_json(component_dir / 'INTENT.json'),
                                               embedding.read_json(qualification / 'QUALIFICATION.json'),
                                               embedding.read_json(semantic), semantic.read_bytes(), component_dir)
        verify_component(component, reviewed)
        receipt = {'schema': 'alpha-hosted-native-input-admission/v1', 'source': source, 'runId': run, 'attempt': attempt,
                   'sdkCommit': plan['sdkCommit'], 'packageName': plan['packageName'], 'manifestSha256': plan_digest,
                   'voiceRecordSha256': plan['voiceRecordSha256'], 'embeddingRecordSha256': plan['embeddingRecordSha256'],
                   'artifacts': receipts, 'embedding': identity}
        (pending / 'admission.json').write_text(json.dumps(receipt, indent=2) + '\n')
        pending.rename(target)


def main(args):
    require(args in (['--check'], ['--acquire']), 'Use hosted-native-inputs.py --check or --acquire')
    plan, digest, reviewed, inventory = load_plan(ROOT)
    if args == ['--acquire']:
        acquire(ROOT, os.environ, plan, digest, reviewed, inventory)
        print('Verified exact hosted native artifacts; canonical staging is required')
    else:
        print('Automatic native input manifest matches the current package, SDK and records')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (OSError, KeyError, TypeError, ValueError, zipfile.BadZipFile) as failure:
        raise SystemExit(f'Hosted native input admission: {failure}') from None
