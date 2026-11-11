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
import subprocess
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent

# Independent allowlist of source owners observed by the Android producer.
MOBILE_CORE_SOURCE_TARGETS = [
    'packages/core/src/services/task.ts',
    'plugins/plugin-notes/src/service.ts',
    'plugins/plugin-notes/src/store.ts',
    'plugins/plugin-notes/src/types.ts',
    'plugins/plugin-notes/src/validation.ts',
    'packages/core/src/runtime/turn-controller.ts',
    'packages/core/src/runtime/room-handler-queue.ts',
    'packages/core/src/runtime/embeddings.ts',
    'plugins/plugin-sql/src/base.ts',
    'packages/agent/src/api/conversation-routes.ts',
    'plugins/plugin-assistant/src/features/advanced-capabilities/experience/service.ts',
    'packages/core/src/plugin-lifecycle.ts',
]

def digest(stream):
    value = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        value.update(block)
    return value.hexdigest()


def read_build_policy_source(file):
    source = file.read_text(encoding='utf-8').strip()
    prefix = 'export default '
    if not source.startswith(prefix) or not source.endswith(';'):
        raise ValueError('Invalid build policy source')
    return json.loads(source[len(prefix):-1])


def file_hash(path):
    with path.open('rb') as stream:
        return digest(stream)



def verify(apk, release=False):
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
        for field, source in [('lockSha256', 'upstream.lock.json'), ('preparerSha256', 'scripts/prepare-local-agent.ts'), ('guardSha256', 'scripts/local-agent-source.ts')]:
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
        restage = 'npm run agent:stage-android'
        if provenance is None:
            raise ValueError('Runtime provenance missing. Run: ' + restage)
        # There is one runtime profile. The staged marker names it; a payload staged for
        # the removed Cloud profile (which omitted the local embedding model) is refused.
        profile_entry = 'assets/agent/alpha-runtime-profile.json'
        staged_profile = staged / 'alpha-runtime-profile.json'
        if profile_entry not in names or not staged_profile.exists():
            raise ValueError('Runtime profile marker missing. Run: ' + restage)
        if hashlib.sha256(archive.read(profile_entry)).hexdigest() != file_hash(staged_profile):
            raise ValueError('Packaged runtime profile differs from staged profile')
        profile = json.loads(archive.read(profile_entry))
        if profile != {'version': 1, 'runtimeProfile': 'native'}:
            raise ValueError('Packaged native profile mismatch. Run: ' + restage)
        for row in provenance['files']:
            entry = row['path']
            if release and entry.startswith(('lib/x86_64/', 'assets/agent/x86_64/')) and entry not in names:
                continue
            if not entry.startswith(('assets/agent/', 'lib/')) or '..' in PurePosixPath(entry).parts:
                raise ValueError('Invalid runtime provenance path')
            if entry not in names:
                raise ValueError('Packaged runtime provenance entry missing: ' + entry)
            with archive.open(entry) as stream:
                if digest(stream) != row['sha256']:
                    raise ValueError('Packaged runtime provenance mismatch: ' + entry)
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
        mobile_policy_file = ROOT / 'scripts/upstream-mobile-build.ts'
        if mobile_policy_file.exists() or mobile_receipt_file.exists() or 'assets/agent/alpha-mobile-build.json' in names:
            check('assets/agent/alpha-mobile-build.json', mobile_receipt_file)
            mobile_receipt = json.loads(archive.read('assets/agent/alpha-mobile-build.json'))
            mobile_policy = read_build_policy_source(mobile_policy_file)
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
            expected_adapters = ['scripts/build-mobile-agent.ts', 'scripts/mobile-uuid-adapter.ts', 'scripts/mobile-bundle-smoke.ts',
                                 'scripts/build-policy-source.ts']
            if mobile_receipt.get('adapterFiles') != {name: file_hash(ROOT / name) for name in expected_adapters}:
                raise ValueError('Packaged mobile producer adapter changed')
            core_catalog_name = 'scripts/upstream-core-sources.ts'
            core_catalog_file = ROOT / core_catalog_name
            core_catalog = read_build_policy_source(core_catalog_file)
            core_digests = core_catalog.get('files')
            if (set(core_catalog) != {'schema', 'baseCommit', 'files'} or
                    core_catalog.get('schema') != 1 or core_catalog.get('baseCommit') != pin or
                    not isinstance(core_digests, dict) or list(core_digests) != MOBILE_CORE_SOURCE_TARGETS):
                raise ValueError('Packaged core source policy differs')
            core_files, core_transforms = {}, []
            for target, expected_hash in core_digests.items():
                git_bytes = subprocess.check_output(
                    ['git', '-C', str(ROOT / 'vendor/eliza'), 'show', f'{pin}:{target}'])
                if (hashlib.sha256(git_bytes).hexdigest() != expected_hash or
                        file_hash(ROOT / 'vendor/eliza' / target) != expected_hash):
                    raise ValueError('Packaged core source input differs')
                core_files[target] = {'beforeSha256': expected_hash, 'afterSha256': expected_hash}
                core_transforms.append({'path': target, 'sourceSha256': expected_hash,
                                        'outputSha256': expected_hash})
            core_inputs = ['scripts/core-state-patch.ts', 'scripts/core-state-preload.ts',
                           'scripts/combined-agent-source.ts', 'scripts/build-policy-source.ts', core_catalog_name]
            expected_core = {'version': 2, 'baseCommit': pin,
                             'manifestSha256': file_hash(core_catalog_file),
                             'inputHashes': {name: file_hash(ROOT / name) for name in core_inputs},
                             'patches': [], 'files': core_files,
                             'transforms': sorted(core_transforms, key=lambda item: item['path'])}
            if mobile_receipt.get('coreState') != expected_core:
                raise ValueError('Packaged core source receipt differs')
        bundle_dependencies = json.loads(archive.read('assets/agent/agent-bundle-dependencies.json'))
        if (bundle_dependencies.get('version') != 1 or
                bundle_dependencies.get('bundleSha256') != checks['assets/agent/agent-bundle.js'] or
                not isinstance(bundle_dependencies.get('packages'), list) or not bundle_dependencies['packages']):
            raise ValueError('Packaged agent dependency inventory does not match bundle')
        declarations = subprocess.check_output(
            ['node', ROOT / 'scripts/native-view-policy.ts'], timeout=30)
        check('assets/agent/native-view-declarations.json', staged / 'native-view-declarations.json',
              hashlib.sha256(declarations).hexdigest())
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
        return {'apk': str(apk), 'runtime': 'PACKAGED', 'runtimeProfile': 'native', 'upstreamCommit': pin, 'verifiedEntries': len(checks), 'runtimeExecution': False}


NOT_DISTRIBUTABLE = 3


def main(argv):
    parser = argparse.ArgumentParser(description='Verify packaged runtime bytes in APKs.')
    parser.add_argument('--release', action='append', default=[], metavar='APK', help='distribution release APK; requires a packaged runtime')
    parser.add_argument('--allow-unpackaged-runtime', action='store_true', help='developer option: report unpackaged releases as distributable=false instead of failing')
    parser.add_argument('apks', nargs='*', metavar='APK')
    args = parser.parse_args(argv)
    if not args.release and not args.apks:
        parser.error('no APKs supplied')
    results = []
    refused = []
    for apk in args.release:
        result = verify(Path(apk), release=True)
        result['release'] = True
        result['distributable'] = result['runtime'] == 'PACKAGED'
        if not result['distributable']:
            refused.append(apk)
        results.append(result)
    results.extend(verify(Path(apk)) for apk in args.apks)
    print(json.dumps(results, indent=2))
    if refused and not args.allow_unpackaged_runtime:
        print('Release APKs without a packaged resident runtime are not distributable: ' + ', '.join(refused)
              + '. Stage it with npm run android:build:local, or pass --allow-unpackaged-runtime for a non-distributable developer build.', file=sys.stderr)
        return NOT_DISTRIBUTABLE
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
