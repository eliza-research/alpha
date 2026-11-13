"""Exercise expiry reporting with only controlled GitHub metadata."""
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
from textwrap import dedent
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_expiry', ROOT / 'scripts/ci/check-native-input-expiry.py')
expiry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(expiry)
NOW = datetime(2026, 11, 11, 13, 47, tzinfo=timezone.utc)
REPO_ID = expiry.native.embedding.REPOSITORY_ID
ENV = {'GITHUB_REPOSITORY_ID': str(REPO_ID), 'GH_TOKEN': 'inert-fixture-token'}
SOURCE = 'a' * 40
DIGEST = 'b' * 64
VOICE_BYTES = 256 * 1024 * 1024


def timestamp(delta):
    return (NOW + delta).isoformat().replace('+00:00', 'Z')


class FrozenDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW.astimezone(tz)


class MetadataAPI:
    def __init__(self):
        self.plan = {'artifacts': {name: {'id': str(index), 'sha256': DIGEST}
                                  for index, name in enumerate(expiry.native.ARTIFACTS, 11)}}
        self.routes = {}
        self.calls = []
        for index, name in enumerate(expiry.native.ARTIFACTS, 11):
            self.routes[f'actions/artifacts/{index}'] = {
                'id': index, 'expired': False, 'expires_at': timestamp(timedelta(days=7)),
                'digest': 'sha256:' + DIGEST, 'size_in_bytes': VOICE_BYTES if name == 'voice' else 100,
                'workflow_run': {'id': index + 10, 'repository_id': REPO_ID,
                                 'head_repository_id': REPO_ID, 'head_sha': SOURCE},
            }
            self.routes[f'actions/runs/{index + 10}'] = {'conclusion': 'success', 'head_sha': SOURCE}

    def open(self, request, timeout):
        url = urlsplit(request.full_url)
        assert request.get_method() == 'GET' and url.netloc == 'api.github.com'
        path = url.path.removeprefix(f'/repositories/{REPO_ID}/')
        self.calls.append(path)
        return io.BytesIO(json.dumps(self.routes[path]).encode())


class NativeInputExpiryTest(unittest.TestCase):
    def check(self, api, *, report=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / expiry.native.MANIFEST
            manifest.parent.mkdir()
            manifest.touch()
            inventory = {'voice-model': {'bytes': VOICE_BYTES}}
            with patch.object(expiry.native, 'load_plan', return_value=(api.plan, None, None, inventory)), \
                 patch.object(expiry.native, 'admit_consumer', return_value=(ENV['GH_TOKEN'], SOURCE, '17', '1')), \
                 patch.object(expiry.native.urllib.request, 'build_opener', return_value=api), \
                 patch.object(expiry.native.datetime, 'datetime', FrozenDateTime), \
                 patch.object(expiry, 'datetime', FrozenDateTime):
                if report:
                    summary = root / 'summary.md'
                    log = io.StringIO()
                    with redirect_stdout(log):
                        code = expiry.main(root, {**ENV, 'GITHUB_STEP_SUMMARY': str(summary)})
                    return code, log.getvalue(), summary.read_text()
                return expiry.check(root, ENV, NOW)

    def test_absent_manifest_reports_awaiting_provisioning_without_api_access(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            summary = root / 'summary.md'
            log = io.StringIO()
            with patch.object(expiry.native.urllib.request, 'build_opener') as transport, redirect_stdout(log):
                self.assertEqual(expiry.main(root, {'GITHUB_STEP_SUMMARY': str(summary)}), 0)
            transport.assert_not_called()
            self.assertIn('::notice ', log.getvalue())
            self.assertIn('#916', summary.read_text())
            self.assertIn(expiry.native.MANIFEST, summary.read_text())

    def test_workflow_checks_the_reviewed_main_commit_after_a_develop_event(self):
        workflow = (ROOT / '.github/workflows/native-input-expiry.yml').read_text()
        self.assertIn("github.event_name == 'schedule'", workflow)
        self.assertIn("github.ref == 'refs/heads/main' && github.sha || 'refs/heads/main'", workflow)
        step = dedent(workflow.split('        run: |\n', 1)[1])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(['git', 'init', '-q'], cwd=root, check=True)
            subprocess.run(['git', '-c', 'commit.gpgsign=false',
                            '-c', 'user.name=Expiry fixture', '-c', 'user.email=expiry@example.invalid',
                            'commit', '-q', '--allow-empty', '-m', 'Reviewed main'], cwd=root, check=True)
            source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
            checker = root / 'scripts/ci/check-native-input-expiry.py'
            checker.parent.mkdir(parents=True)
            checker.write_text('import os\nprint(os.environ["GITHUB_SHA"])\n')
            summary = root / 'summary.md'
            run = subprocess.run(['bash', '-e', '-c', step], cwd=root, check=True, capture_output=True, text=True,
                                 env={**os.environ, 'GITHUB_REF': 'refs/heads/develop', 'GITHUB_SHA': SOURCE,
                                      'GITHUB_STEP_SUMMARY': str(summary)})
            self.assertEqual(run.stdout.strip(), source)
            self.assertIn(source, summary.read_text())

    def test_all_three_current_pins_use_only_exact_metadata_routes(self):
        api = MetadataAPI()
        findings = self.check(api)
        self.assertEqual([level for level, _ in findings], ['', '', ''])
        self.assertEqual(api.calls, ['actions/artifacts/11', 'actions/runs/21', 'actions/artifacts/12',
                                     'actions/runs/22', 'actions/artifacts/13', 'actions/runs/23'])

    def test_four_day_boundary_surfaces_in_warning_summary_and_exit_code(self):
        api = MetadataAPI()
        api.routes['actions/artifacts/11']['expires_at'] = timestamp(timedelta(days=4, seconds=1))
        api.routes['actions/artifacts/13']['expires_at'] = timestamp(timedelta(days=4))
        code, log, summary = self.check(api, report=True)
        self.assertEqual(code, 1)
        self.assertEqual(log.count('::warning '), 1)
        expected = 'embeddingQualification artifact 13 expires at 2026-11-15T13:47:00Z'
        self.assertIn(f'::warning title=Launcher OTA native inputs::{expected}', log)
        self.assertIn(expected, summary)
        self.assertIn('voice artifact 11', summary)
        self.assertIn('embeddingComponent artifact 12', summary)

    def test_expired_and_wrong_digest_pins_are_reported_together(self):
        api = MetadataAPI()
        api.routes['actions/artifacts/11']['expires_at'] = timestamp(timedelta(0))
        api.routes['actions/artifacts/12']['expired'] = True
        api.routes['actions/artifacts/13']['digest'] = 'sha256:' + 'c' * 64
        code, log, summary = self.check(api, report=True)
        self.assertEqual(code, 1)
        self.assertEqual(log.count('::error '), 3)
        for expected in ('voice artifact 11: Artifact has expired', 'embeddingComponent artifact 12: Artifact is expired',
                         'embeddingQualification artifact 13: Artifact digest differs'):
            self.assertIn(expected, log)
            self.assertIn(expected, summary)
        self.assertEqual(api.calls, ['actions/artifacts/11', 'actions/runs/21', 'actions/artifacts/12', 'actions/artifacts/13'])

    def test_invalid_timestamp_origin_and_failed_producer_are_rejected(self):
        api = MetadataAPI()
        api.routes['actions/artifacts/11']['expires_at'] = '2026-11-18T13:47:00'
        api.routes['actions/artifacts/12']['workflow_run']['head_repository_id'] = 1
        api.routes['actions/runs/23']['conclusion'] = 'failure'
        code, log, _ = self.check(api, report=True)
        self.assertEqual(code, 1)
        self.assertEqual(log.count('::error '), 3)
        for reason in ('expiry timestamp is unavailable', 'canonical repository', 'run did not succeed'):
            self.assertIn(reason, log)

    def test_replacement_pin_with_the_same_digest_and_later_expiry_clears_warning(self):
        api = MetadataAPI()
        api.routes['actions/artifacts/13']['expires_at'] = timestamp(timedelta(days=2))
        self.assertEqual(self.check(api)[2][0], 'warning')
        api.plan['artifacts']['embeddingQualification']['id'] = '33'
        api.routes['actions/artifacts/33'] = dict(api.routes['actions/artifacts/13'], id=33, expires_at=timestamp(timedelta(days=7)))
        self.assertEqual(self.check(api)[2][0], '')
        self.assertEqual(api.calls[-2:], ['actions/artifacts/33', 'actions/runs/23'])


if __name__ == '__main__':
    unittest.main()
