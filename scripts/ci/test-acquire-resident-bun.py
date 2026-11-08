#!/usr/bin/env python3
"""Target/transport contract tests only; fake HTTP responses never access network."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('acquire', Path(__file__).with_name('acquire-resident-bun.py'))
acquire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acquire)


def artifact(number):
    return {'assetId': number, 'archiveSha256': 'a' * 64, 'binarySha256': 'b' * 64}


class TargetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.lockfile = self.root / 'packages/app/scripts/lib/android-bun-artifacts.lock.json'
        self.lockfile.parent.mkdir(parents=True)
        self.lock = {'schemaVersion': 1, 'repository': 'oven-sh/bun',
                     'channels': {'stable': {'version': '1.4.2', 'revision': 'c' * 40,
                                            'artifacts': {'x64': artifact(1), 'aarch64': artifact(2)}}},
                     'targets': {'android': {'stable': {'version': '1.4.2', 'revision': 'd' * 40,
                                                        'artifacts': {'aarch64': artifact(3)}}}}}
        self.save()

    def save(self):
        self.lockfile.write_text(json.dumps(self.lock))

    def test_native_default_unchanged(self):
        self.assertEqual(acquire.read_artifacts(self.root), self.lock['channels']['stable']['artifacts'])

    def test_android_selects_only_target_arm64(self):
        self.assertEqual(acquire.read_artifacts(self.root, 'android'), {'aarch64': artifact(3)})

    def test_android_never_falls_back_to_musl(self):
        del self.lock['targets']; self.save()
        with self.assertRaises(ValueError): acquire.read_artifacts(self.root, 'android')

    def test_android_rejects_extra_architecture(self):
        self.lock['targets']['android']['stable']['artifacts']['x64'] = artifact(4); self.save()
        with self.assertRaises(ValueError): acquire.read_artifacts(self.root, 'android')

    def test_unknown_target_and_invalid_pin_fail(self):
        with self.assertRaises(ValueError): acquire.read_artifacts(self.root, 'other')
        self.lock['targets']['android']['stable']['artifacts']['aarch64']['binarySha256'] = 'bad'; self.save()
        with self.assertRaises(ValueError): acquire.read_artifacts(self.root, 'android')

    def run_main(self, target=None, abis=None, profile='native'):
        env = {'GH_TOKEN': 'UNIT_TEST_NOT_A_CREDENTIAL', 'ALPHA_LOCAL_AGENT_SOURCE_DIR': str(self.root),
               'RUNNER_TEMP': str(self.root), 'GITHUB_ENV': str(self.root / 'github-env'),
               'ALPHA_RUNTIME_PROFILE': profile}
        if target is not None: env['ELIZA_ANDROID_BUN_TARGET'] = target
        if abis is not None: env['ELIZA_ANDROID_TARGET_ABIS'] = abis
        with patch.dict(os.environ, env, clear=True), patch.object(acquire, 'download') as download, contextlib.redirect_stdout(io.StringIO()):
            acquire.main()
            self.assertNotIn('GH_TOKEN', os.environ)
            return download.call_args_list, (self.root / 'github-env').read_text()

    def test_main_native_still_acquires_two_arches(self):
        calls, output = self.run_main()
        self.assertEqual([c.args[0] for c in calls], [1, 2])
        self.assertTrue(all(c.kwargs['max_bytes'] == acquire.MAX_BYTES for c in calls))
        self.assertIn('ELIZA_BUN_X64_FILE=', output)
        self.assertIn('ELIZA_BUN_AARCH64_FILE=', output)

    def test_main_cloud_acquires_only_bionic_arm64(self):
        calls, output = self.run_main('android', 'arm64-v8a', 'cloud')
        self.assertEqual([c.args[0] for c in calls], [3])
        self.assertEqual(calls[0].kwargs['max_bytes'], 40 * 1024**2)
        self.assertNotIn('X64', output)
        self.assertIn('bun-linux-aarch64-android.zip', output)

    def test_cloud_wrong_target_or_abis_fails_before_download(self):
        for target, abis in [('linux-musl', 'arm64-v8a'), ('android', 'arm64-v8a,x86_64')]:
            with self.subTest(target=target), self.assertRaises(ValueError):
                self.run_main(target, abis, 'cloud')


class TransportTests(unittest.TestCase):
    def test_redirect_never_forwards_token(self):
        body = b'unit fixture, not a real Bun archive'
        requests = []
        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                if len(requests) == 1:
                    raise urllib.error.HTTPError(request.full_url, 302, 'redirect', {'Location': 'https://release-assets.githubusercontent.com/fixture'}, io.BytesIO())
                return io.BytesIO(body)
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / 'archive'
            acquire.download(3, destination, hashlib.sha256(body).hexdigest(), 'UNIT_TEST_NOT_A_CREDENTIAL', opener=Opener())
            self.assertEqual(destination.read_bytes(), body)
        self.assertIsNotNone(requests[0].get_header('Authorization'))
        self.assertIsNone(requests[1].get_header('Authorization'))

    def test_wrong_origin_and_size_or_hash_fail_closed(self):
        for url in ['http://github.com/file', 'https://evil.test/file', 'https://user:pass@github.com/file']:
            with self.assertRaises(ValueError): acquire.safe_asset_url(url)
        class Opener:
            def open(self, request, timeout): return io.BytesIO(b'fixture')
        with tempfile.TemporaryDirectory() as tmp:
            for maximum, digest in [(1, hashlib.sha256(b'fixture').hexdigest()), (100, '0' * 64)]:
                destination = Path(tmp) / 'archive'
                with self.assertRaises(ValueError):
                    acquire.download(3, destination, digest, 'UNIT_TEST_NOT_A_CREDENTIAL', opener=Opener(), max_bytes=maximum)
                self.assertFalse(destination.exists())


class OfflineCommandTests(unittest.TestCase):
    def test_pinned_bun_install_uses_process_cwd_not_global_cwd_flag(self):
        bun = os.environ.get('ALPHA_TEST_BUN') or shutil.which('bun')
        self.assertTrue(bun, 'Pinned Bun must be installed before command contract tests')
        self.assertEqual(subprocess.check_output([bun, '--version'], text=True).strip(), '1.4.2')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'package.json').write_text('{"name":"cwd-contract-fixture","private":true}')
            env = {'PATH': '/usr/bin:/bin', 'HOME': tmp, 'TMPDIR': tmp, 'NO_COLOR': '1'}
            # --help never installs. It reproduces the actual failing parser route
            # without needing a dependency graph, SDK, credentials or network.
            old = subprocess.run([bun, '--no-env-file', '--cwd', tmp, 'install', '--help'],
                                 cwd=tmp, env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(old.returncode, 1)
            self.assertIn('Script not found "install"', old.stderr)
            correct = subprocess.run(['/bin/sh', '-c', 'cd "$1" && shift && exec "$@"', 'sh', tmp,
                                      bun, '--no-env-file', 'install', '--help'],
                                     cwd='/', env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(correct.returncode, 0, correct.stderr)
            self.assertIn('Usage: bun install', correct.stdout + correct.stderr)
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['package.json'])


if __name__ == '__main__':
    unittest.main()
