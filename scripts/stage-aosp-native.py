#!/usr/bin/env python3
"""Alpha's trusted source and policy adapter for upstream native APK admission."""
import argparse
import hashlib
import importlib.util
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHARED = ROOT / 'vendor/eliza/packages/os/scripts/android/stage-android-native.py'
spec = importlib.util.spec_from_file_location('eliza_android_native', SHARED)
shared = importlib.util.module_from_spec(spec)
# Keep the pinned upstream checkout immutable when importing its adapter.
_previous_bytecode = sys.dont_write_bytecode
try:
    sys.dont_write_bytecode = True
    spec.loader.exec_module(shared)
finally:
    sys.dont_write_bytecode = _previous_bytecode
RUNTIME_MODES = shared.RUNTIME_MODES
TARGETS = shared.TARGETS
CLOUD_OMITTED_MODEL = shared.CLOUD_OMITTED_MODEL
REQUIRED_AGENT_ASSETS = shared.REQUIRED_AGENT_ASSETS


def bun_identity(apk):
    # The APK's own provenance names its Bun build; upstream still checks its hashes.
    entry = 'assets/agent/android-agent-runtime-provenance.json'
    with zipfile.ZipFile(apk) as archive:
        if entry not in archive.namelist():
            return 'linux-musl', 'stable'
        provenance = shared.read_json(archive, entry)
    if not isinstance(provenance, dict) or provenance.get('schema') != 'eliza.android_agent_runtime_provenance.v1':
        raise ValueError('Unknown runtime provenance schema')
    bun = provenance.get('bun', {})
    if not isinstance(bun, dict):
        raise ValueError('Invalid runtime Bun identity')
    target, channel = bun.get('target', 'linux-musl'), bun.get('channel', 'stable')
    if target not in ('linux-musl', 'android') or not isinstance(channel, str):
        raise ValueError('Unsupported Bun target')
    return target, channel


def admission(root, apk):
    digest = lambda data: hashlib.sha256(data).hexdigest()
    lock_bytes = (root / 'upstream.lock.json').read_bytes()
    stamp = {
        'lockSha256': digest(lock_bytes),
        'preparerSha256': digest((root / 'scripts/prepare-local-agent.ts').read_bytes()),
        'guardSha256': digest((root / 'scripts/local-agent-source.ts').read_bytes()),
        'copySha256': digest((root / 'scripts/copy-file-clone.ts').read_bytes()),
        'base': json.loads(lock_bytes)['commit'], 'patches': [],
    }
    bun_target, channel = bun_identity(apk)
    bun_lock = json.loads((root / 'vendor/eliza/packages/app/scripts/lib/android-bun-artifacts.lock.json').read_text())
    pins = bun_lock.get('targets', {}).get('android', {}) if bun_target == 'android' else bun_lock.get('channels', {})
    if not isinstance(pins.get(channel), dict):
        raise ValueError('No pinned ' + bun_target + ' Bun for channel: ' + str(channel))
    return {
        'schemaVersion': 1,
        'bunTarget': bun_target,
        'bunPin': pins[channel],
        'profileEntry': 'assets/agent/alpha-runtime-profile.json',
        'rendererFlagsEntry': 'assets/public/build-flags.json',
        'source': {'kind': 'exact-json', 'entry': 'assets/agent/alpha-source.json', 'commit': stamp['base'], 'commitField': 'base', 'expected': stamp},
        'fileBindings': {'assets/agent/native-view-declarations.json': digest((root / 'config/native-view-declarations.json').read_bytes())},
        'worker': {'prefix': 'assets/agent/workflow-worker/', 'lockSha256': digest((root / 'vendor/eliza/bun.lock').read_bytes())},
    }


def stage(apk, output, module, target='stallion', defer_soong=False):
    report = shared.stage(apk, output, module, target, admission(ROOT, apk))
    if not defer_soong:
        finalize_soong(output, module, report)
    return report


def finalize_soong(output, module, report):
    return shared.finalize_soong(output, module, report)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--module', required=True)
    parser.add_argument('--target', choices=tuple(TARGETS), default='stallion')
    parser.add_argument('--defer-soong', action='store_true')
    parser.add_argument('--finalize-soong', action='store_true')
    args = parser.parse_args()
    if args.finalize_soong:
        report = json.loads((args.output / 'native-libraries.json').read_text())
        print(json.dumps(finalize_soong(args.output, args.module, report), indent=2))
    else:
        print(json.dumps(stage(args.apk, args.output, args.module, args.target, args.defer_soong), indent=2))
