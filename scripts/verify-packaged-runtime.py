"""Verify packaged runtime bytes; this does not execute or qualify a runtime.

Usage: verify-packaged-runtime.py [--allow-unpackaged-runtime] [--release APK]... [APK]...

APKs passed with --release are distribution releases: without a packaged,
authenticated runtime they are not distributable and the script exits 3
(after printing every result) unless --allow-unpackaged-runtime is given, in
which case those entries are reported with "distributable": false. Debug and
other positional APKs keep the original semantics: NOT_PACKAGED is reported,
not rejected. Byte mismatches always raise (exit 1).
"""
import argparse
import os
import subprocess
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
LOCAL_EMBEDDING_MODEL = {'path': 'assets/agent/models/bge-small-en-v1.5-f16.gguf', 'sha256': 'f0b2fef971e8366438bfd2d9aefea1b0115919389448806d290237f638bae999'}


def digest(stream):
    value = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        value.update(block)
    return value.hexdigest()


def file_hash(path):
    with path.open('rb') as stream:
        return digest(stream)



def verify_local_embedding_source(root):
    # This is the existing source/receipt/model/library gate, not a second qualification schema.
    script = (root / 'scripts/stage-embedding-host.mjs').resolve(strict=True)
    result = subprocess.run(
        [os.environ.get('ALPHA_NODE', 'node'), '--input-type=module', '-e',
         'const {verifyEmbeddingHost}=await import(process.argv[1]); verifyEmbeddingHost(process.argv[2],{requireProducerInputs:true});',
         script.as_uri(), str(root.resolve())],
        cwd=root, capture_output=True, text=True, timeout=45)
    if result.returncode or len(result.stdout) + len(result.stderr) > 65536:
        raise ValueError('Local embedding source qualification failed')


def verify(apk, release=False, runtime_profile="native", local_embeddings=False):
    if local_embeddings and runtime_profile != "cloud":
        raise ValueError("Local embeddings require the Cloud profile")
    staged = ROOT / 'android/app/src/main/assets/agent'
    stamp_file = staged / 'alpha-source.json'
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        runtime_names = [name for name in names if name.startswith('assets/agent/') or name.endswith('/libeliza_bun.so')]
        if not stamp_file.exists():
            if runtime_names:
                raise ValueError('Packaged runtime has no authenticated staged source')
            return {'apk': str(apk), 'runtime': 'NOT_PACKAGED', 'runtimeExecution': False}
        if len(names) != len(set(names)):
            raise ValueError('Duplicate APK entries')
        stamp = json.loads(stamp_file.read_text())
        pin = json.loads((ROOT / 'upstream.lock.json').read_text())['commit']
        if stamp.get('base') != pin or stamp.get('patches') != []:
            raise ValueError('Staged runtime does not match patchless pin')
        for field, source in [('lockSha256', 'upstream.lock.json'), ('preparerSha256', 'scripts/prepare-local-agent.mjs'), ('guardSha256', 'scripts/local-agent-source.mjs')]:
            if stamp.get(field) != file_hash(ROOT / source):
                raise ValueError('Staged source manifest mismatch')
        checks = {}
        # An Android-target Bun may have a narrower admitted ABI set. Authenticate
        # its provenance before using that set; legacy debug builds still require both.
        runtime_abis = {'arm64-v8a', 'x86_64'}
        provenance = None
        provenance_entry = 'assets/agent/android-agent-runtime-provenance.json'
        staged_provenance = staged / 'android-agent-runtime-provenance.json'
        if staged_provenance.exists() or provenance_entry in names:
            if hashlib.sha256(archive.read(provenance_entry)).hexdigest() != file_hash(staged_provenance):
                raise ValueError('Runtime provenance differs from admitted staged provenance')
            provenance = json.loads(archive.read(provenance_entry))
            if provenance.get('schema') != 'eliza.android_agent_runtime_provenance.v1':
                raise ValueError('Runtime provenance missing')
            bun = provenance.get('bun', {})
            target = bun.get('target', 'linux-musl')
            if target not in ('android', 'linux-musl'):
                raise ValueError('Unsupported Bun target')
            if target == 'android':
                if bun.get('architectures') != ['arm64-v8a']:
                    raise ValueError('Invalid Android Bun ABI admission')
                runtime_abis = {'arm64-v8a'}
        restage = 'npm run agent:stage-android' + (' -- --runtime-profile=cloud' if runtime_profile == 'cloud' else '')
        if provenance is None:
            raise ValueError('Runtime provenance missing. Run: ' + restage)
        # The staged profile marker names the profile the payload was staged for;
        # a native APK must not carry a Cloud projection, nor the reverse.
        profile_entry = 'assets/agent/alpha-runtime-profile.json'
        staged_profile = staged / 'alpha-runtime-profile.json'
        if profile_entry not in names or not staged_profile.exists():
            raise ValueError('Runtime profile marker missing. Run: ' + restage)
        if hashlib.sha256(archive.read(profile_entry)).hexdigest() != file_hash(staged_profile):
            raise ValueError('Packaged runtime profile differs from staged profile')
        profile = json.loads(archive.read(profile_entry))
        omitted = LOCAL_EMBEDDING_MODEL
        if runtime_profile == 'cloud':
            expected_profile = {'version': 1, 'runtimeProfile': 'cloud', 'omittedLocalModels': [] if local_embeddings else [omitted]}
            if local_embeddings:
                expected_profile['localEmbeddings'] = True
            if profile != expected_profile:
                raise ValueError('Packaged Cloud profile mismatch')
        elif profile != {'version': 1, 'runtimeProfile': 'native'}:
            raise ValueError('Packaged native profile mismatch. Run: ' + restage)
        for row in provenance['files']:
            entry = row['path']
            if runtime_profile == 'cloud' and entry == omitted['path'] and not local_embeddings:
                if row['sha256'] != omitted['sha256'] or entry in names:
                    raise ValueError('Cloud local-model omission differs')
                continue
            if release and entry.startswith(('lib/x86_64/', 'assets/agent/x86_64/')) and entry not in names:
                continue
            if not entry.startswith(('assets/agent/', 'lib/')) or '..' in PurePosixPath(entry).parts:
                raise ValueError('Invalid runtime provenance path')
            if entry not in names:
                raise ValueError('Packaged runtime provenance entry missing: ' + entry)
            with archive.open(entry) as stream:
                if digest(stream) != row['sha256']:
                    raise ValueError('Packaged runtime provenance mismatch: ' + entry)
        if runtime_profile == 'cloud':
            allowed_embedding_entries = set()
            if local_embeddings:
                verify_local_embedding_source(ROOT)
                if runtime_abis != {'arm64-v8a'}:
                    raise ValueError('Local embeddings require the qualified ARM64 host')
                record = json.loads((ROOT / 'android/embedding-host/qualified-host.json').read_text())
                required_libraries = {'libelizainference.so', 'libelizavoicejni.so', 'libc++_shared.so'}
                if record.get('requalification', {}).get('required') is True or record.get('abi') != 'arm64-v8a' or record.get('jniIdentityRelocated') is not True:
                    raise ValueError('Local embedding host requires current qualification')
                if record.get('model', {}).get('sha256') != omitted['sha256'] or record.get('model', {}).get('dimensions') != 384:
                    raise ValueError('Local embedding model differs')
                rows = record.get('libraries', [])
                if len(rows) != 3 or {row.get('name') for row in rows} != required_libraries:
                    raise ValueError('Local embedding library inventory differs')
                allowed_embedding_entries.add(omitted['path'])
                with archive.open(omitted['path']) as stream:
                    observed = digest(stream)
                if observed != omitted['sha256'] or observed != file_hash(staged / 'models/bge-small-en-v1.5-f16.gguf'):
                    raise ValueError('Packaged BGE model differs')
                checks[omitted['path']] = observed
                for row in rows:
                    entry = 'lib/arm64-v8a/' + row['name']
                    allowed_embedding_entries.add(entry)
                    with archive.open(entry) as stream:
                        observed = digest(stream)
                    if observed != row['sha256'] or observed != file_hash(ROOT / 'android/app/src/main/jniLibs/arm64-v8a' / row['name']):
                        raise ValueError('Packaged embedding host differs: ' + entry)
                    checks[entry] = observed
            if any(name not in allowed_embedding_entries and (re.match(r'^(lib(?:elizainference|elizavoicejni|paradeevoicejni|llama|ggml|omnivoice)|llama-server)', PurePosixPath(name).name) or name.startswith('assets/paradee-voice/') or re.search(r'\.(gguf|onnx|safetensors|pt|pth)$', name)) for name in names):
                raise ValueError('Cloud APK includes unadmitted local inference')

        def check(entry, local, expected=None):
            with archive.open(entry) as stream:
                observed = digest(stream)
            if observed != file_hash(local) or (expected is not None and observed != expected):
                raise ValueError(f'Packaged runtime mismatch: {entry}')
            checks[entry] = observed

        for name in ['alpha-source.json', 'agent-bundle.js', 'agent-bundle-dependencies.json', 'workflow-worker/files.sha256', 'workflow-worker/manifest.json']:
            check('assets/agent/' + name, staged / name)
        # Explicit build adapters are separate from the unmodified source stamp.
        # If this build declares one, bind its receipt and producer input hashes too.
        mobile_receipt_file = staged / 'alpha-mobile-build.json'
        mobile_policy_file = ROOT / 'patches/eliza/mobile-uuid-build.json'
        if mobile_policy_file.exists() or mobile_receipt_file.exists() or 'assets/agent/alpha-mobile-build.json' in names:
            check('assets/agent/alpha-mobile-build.json', mobile_receipt_file)
            mobile_receipt = json.loads(archive.read('assets/agent/alpha-mobile-build.json'))
            mobile_policy = json.loads(mobile_policy_file.read_text())
            if (mobile_receipt.get('format') != 'alpha-mobile-build-v1' or
                    mobile_receipt.get('sourcePin') != pin or
                    mobile_policy.get('baseCommit') != pin or
                    mobile_receipt.get('sourceStampSha256') != file_hash(stamp_file) or
                    mobile_receipt.get('lockSha256') != mobile_policy.get('lockSha256') or
                    mobile_receipt.get('bun') != mobile_policy.get('bun') or
                    mobile_receipt.get('builder') != mobile_policy.get('builder') or
                    mobile_receipt.get('uuid') != {'version': mobile_policy['package']['version'], 'files': mobile_policy['package']['files']} or
                    mobile_receipt.get('bundleSha256') != checks['assets/agent/agent-bundle.js'] or
                    mobile_receipt.get('policySha256') != file_hash(mobile_policy_file) or
                    mobile_receipt.get('smoke') != {'uuidSemantics': True, 'messageTurnBeforeProvider': True}):
                raise ValueError('Packaged mobile producer receipt differs')
            transforms = mobile_receipt.get('transforms', [])
            if (len(transforms) != 1 or
                    transforms[0].get('path') != mobile_policy['package']['root'] + '/dist-node/index.js' or
                    transforms[0].get('sourceSha256') != mobile_policy['package']['files']['dist-node/index.js'] or
                    not re.fullmatch('[a-f0-9]{64}', str(transforms[0].get('bridgeSha256', '')))):
                raise ValueError('Packaged mobile UUID transform differs')
            expected_adapters = ['scripts/build-mobile-agent.mjs', 'scripts/mobile-uuid-adapter.mjs', 'scripts/mobile-bundle-smoke.mjs']
            if mobile_receipt.get('adapterFiles') != {name: file_hash(ROOT / name) for name in expected_adapters}:
                raise ValueError('Packaged mobile producer adapter changed')
            core_manifest_file = ROOT / 'patches/eliza/core-state-manifest.json'
            core_manifest = json.loads(core_manifest_file.read_text())
            core_targets = [('task-service-stop.patch', ['packages/core/src/services/task.ts']),
                            ('notes-state-runtime.patch', ['plugins/plugin-notes/src/service.ts',
                             'plugins/plugin-notes/src/store.ts', 'plugins/plugin-notes/src/types.ts',
                             'plugins/plugin-notes/src/validation.ts']),
                            ('turn-controller-isolation.patch', ['packages/core/src/runtime/turn-controller.ts'])]
            if (set(core_manifest) != {'schema', 'baseCommit', 'patches'} or
                    core_manifest.get('schema') != 1 or core_manifest.get('baseCommit') != pin or
                    len(core_manifest.get('patches', [])) != len(core_targets)):
                raise ValueError('Packaged core patch policy differs')
            core_files, core_patches, core_transforms = {}, [], []
            for core_patch, (patch_name, targets) in zip(core_manifest['patches'], core_targets):
                if (set(core_patch) != {'file', 'sha256', 'targets'} or
                        core_patch.get('file') != patch_name or len(core_patch.get('targets', [])) != len(targets) or
                        core_patch.get('sha256') != file_hash(ROOT / 'patches/eliza' / patch_name)):
                    raise ValueError('Packaged core patch allowlist differs')
                for core_file, core_target in zip(core_patch['targets'], targets):
                    if (set(core_file) != {'path', 'beforeSha256', 'afterSha256'} or
                            core_file.get('path') != core_target or
                            any(not re.fullmatch('[a-f0-9]{64}', str(core_file.get(key, '')))
                                for key in ['beforeSha256', 'afterSha256'])):
                        raise ValueError('Packaged core patch input differs')
                    core_files[core_target] = {key: core_file[key] for key in ['beforeSha256', 'afterSha256']}
                    core_transforms.append({'path': core_target, 'sourceSha256': core_file['beforeSha256'],
                                            'outputSha256': core_file['afterSha256']})
                core_patches.append({'file': patch_name, 'sha256': core_patch['sha256']})
            core_inputs = ['scripts/core-state-patch.mjs', 'scripts/core-state-preload.mjs',
                           'scripts/combined-agent-source.mjs', 'patches/eliza/core-state-manifest.json'] + [
                           'patches/eliza/' + name for name, _targets in core_targets]
            expected_core = {'version': 1, 'baseCommit': pin,
                             'manifestSha256': file_hash(core_manifest_file),
                             'inputHashes': {name: file_hash(ROOT / name) for name in core_inputs},
                             'patches': core_patches, 'files': core_files,
                             'transforms': sorted(core_transforms, key=lambda item: item['path'])}
            if mobile_receipt.get('coreState') != expected_core:
                raise ValueError('Packaged core state transformation differs')
        bundle_dependencies = json.loads(archive.read('assets/agent/agent-bundle-dependencies.json'))
        if (bundle_dependencies.get('version') != 1 or
                bundle_dependencies.get('bundleSha256') != checks['assets/agent/agent-bundle.js'] or
                not isinstance(bundle_dependencies.get('packages'), list) or not bundle_dependencies['packages']):
            raise ValueError('Packaged agent dependency inventory does not match bundle')
        check('assets/agent/native-view-declarations.json', staged / 'native-view-declarations.json', file_hash(ROOT / 'config/native-view-declarations.json'))
        worker_manifest = json.loads((staged / 'workflow-worker/manifest.json').read_text())
        worker_files = worker_manifest.get('files')
        if worker_manifest.get('version') != 1 or not isinstance(worker_files, dict) or not worker_files:
            raise ValueError('Invalid staged worker manifest')
        if worker_manifest.get('sourceStampSha256') != file_hash(stamp_file):
            raise ValueError('Worker belongs to a different prepared runtime')
        expected_worker_files = dict(worker_files)
        expected_worker_files['manifest.json'] = file_hash(staged / 'workflow-worker/manifest.json')
        inventory = set()
        for line in (staged / 'workflow-worker/files.sha256').read_text().splitlines():
            expected, name = line.split('\t', 1)
            relative = PurePosixPath(name)
            if len(expected) != 64 or any(c not in '0123456789abcdef' for c in expected) or relative.is_absolute() or '..' in relative.parts or name in inventory:
                raise ValueError('Invalid worker inventory')
            if expected_worker_files.get(name) != expected:
                raise ValueError('Worker index differs from manifest')
            inventory.add(name)
            check('assets/agent/workflow-worker/' + name, staged / 'workflow-worker' / name, expected)
        if inventory != set(expected_worker_files):
            raise ValueError('Incomplete worker index')
        packaged_worker = {name.removeprefix('assets/agent/workflow-worker/') for name in names if name.startswith('assets/agent/workflow-worker/') and not name.endswith('/')}
        if packaged_worker != inventory | {'files.sha256', 'manifest.json'}:
            raise ValueError('Unexpected packaged worker inventory')
        # Every packaged ABI must match the admitted runtime. Releases keep
        # their shipping ARM64 requirement; legacy debug retains both ABIs.
        packaged_abis = {name.split('/')[1] for name in names if name.startswith('lib/') and name.count('/') >= 2}
        expected_abis = {'arm64-v8a'} if release else runtime_abis
        unexpected_abis = packaged_abis - runtime_abis
        if unexpected_abis:
            raise ValueError(f'Unexpected packaged ABI: {sorted(unexpected_abis)}')
        abis = sorted(packaged_abis | expected_abis)
        for abi in abis:
            if abi not in ('arm64-v8a', 'x86_64'):
                raise ValueError(f'Unexpected packaged ABI: {abi}')
            name = f'lib/{abi}/libeliza_bun.so'
            check(name, ROOT / 'android/app/src/main/jniLibs' / abi / 'libeliza_bun.so')
        return {'apk': str(apk), 'runtime': 'PACKAGED', 'runtimeProfile': runtime_profile, 'upstreamCommit': pin, 'verifiedEntries': len(checks), 'runtimeExecution': False}


NOT_DISTRIBUTABLE = 3


def main(argv):
    parser = argparse.ArgumentParser(description='Verify packaged runtime bytes in APKs.')
    parser.add_argument('--local-embeddings', action='store_true', help='require qualified local BGE inputs in the Cloud profile')
    parser.add_argument('--runtime-profile', choices=['native', 'cloud'], default='native')
    parser.add_argument('--release', action='append', default=[], metavar='APK', help='distribution release APK; requires a packaged runtime')
    parser.add_argument('--allow-unpackaged-runtime', action='store_true', help='developer option: report unpackaged releases as distributable=false instead of failing')
    parser.add_argument('apks', nargs='*', metavar='APK')
    args = parser.parse_args(argv)
    if not args.release and not args.apks:
        parser.error('no APKs supplied')
    results = []
    refused = []
    for apk in args.release:
        result = verify(Path(apk), release=True, runtime_profile=args.runtime_profile, local_embeddings=args.local_embeddings)
        result['release'] = True
        result['distributable'] = result['runtime'] == 'PACKAGED'
        if not result['distributable']:
            refused.append(apk)
        results.append(result)
    results.extend(verify(Path(apk), runtime_profile=args.runtime_profile, local_embeddings=args.local_embeddings) for apk in args.apks)
    print(json.dumps(results, indent=2))
    if refused and not args.allow_unpackaged_runtime:
        print('Release APKs without a packaged resident runtime are not distributable: ' + ', '.join(refused)
              + '. Stage it with npm run android:build:local, or pass --allow-unpackaged-runtime for a non-distributable developer build.', file=sys.stderr)
        return NOT_DISTRIBUTABLE
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
