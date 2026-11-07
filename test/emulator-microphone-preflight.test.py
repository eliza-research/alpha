"""Host-tool tests only. Fake process/discovery/RPC; never connect to an emulator."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import grpc
import grpc_tools
from grpc_tools import protoc

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = Path('/Users/nubs/.local/state/alpha-aosp-pixel10a-20261025/voice-android-qa-prep')
SDK = Path('/Users/nubs/Library/Android/sdk')
WAV = EVIDENCE.parent / 'pixel-polish/synthetic-voice-open-calendar/phrase.wav'
TOKEN = 'nonsecret-unit-fixture-token'
SPEC = importlib.util.spec_from_file_location('audio_helper_under_test', ROOT / 'scripts/inject-emulator-audio.py')
HELPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPER)


class FakeChannel:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class FakeStub:
    def __init__(self, enabled):
        self.enabled = enabled
        self.reads = 0
        self.injections = 0
        self.packet_count = 0

    def getMicrophoneState(self, request, metadata, timeout):
        self.reads += 1
        assert timeout == 5
        assert metadata == [('authorization', 'Bearer ' + TOKEN)]
        return types.SimpleNamespace(realAudioEnabled=self.enabled)

    def injectAudio(self, packets, metadata, timeout):
        self.injections += 1
        assert metadata == [('authorization', 'Bearer ' + TOKEN)]
        assert timeout > 0
        self.packet_count = sum(1 for _ in packets)


class MicrophonePreflight(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(dir=EVIDENCE, prefix='mic-preflight-proto-')
        include = Path(grpc_tools.__file__).parent / '_proto'
        proto = SDK / 'emulator/lib/emulator_controller.proto'
        assert protoc.main(['grpc_tools.protoc', '-I' + str(proto.parent), '-I' + str(include),
                            '--python_out=' + cls.temp.name, '--grpc_python_out=' + cls.temp.name, str(proto)]) == 0
        sys.path.insert(0, cls.temp.name)
        import emulator_controller_pb2_grpc
        cls.rpc = emulator_controller_pb2_grpc

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    @contextlib.contextmanager
    def fixture(self, arguments, enabled=False, discovery=None):
        data = {'grpc.token': TOKEN, 'grpc.port': '8556', 'port.serial': '5556'} if discovery is None else discovery
        stub = FakeStub(enabled)
        output = io.StringIO()
        with patch.object(sys, 'argv', ['inject-emulator-audio.py', '--port', '5556', *arguments]), \
             patch.object(HELPER, 'phone_pid', return_value=424242) as pid, \
             patch.object(HELPER, 'discovery', return_value=data) as discover, \
             patch.object(HELPER, 'SDK', SDK), \
             patch.object(grpc, 'insecure_channel', return_value=FakeChannel()) as channel, \
             patch.object(self.rpc, 'EmulatorControllerStub', return_value=stub), \
             contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
            yield stub, output, channel, pid, discover
        self.assertNotIn(TOKEN, output.getvalue())

    def test_check_disabled_host_mic_only_reads_and_reports_safe(self):
        with self.fixture(['--check-microphone']) as (stub, output, channel, pid, discover), \
             patch.object(HELPER.wave, 'open', side_effect=AssertionError('Preflight must not read audio')):
            self.assertEqual(HELPER.main(), 0)
            result = json.loads(output.getvalue().splitlines()[-1])
            self.assertEqual((stub.reads, stub.injections), (1, 0))
            self.assertEqual(result, {'checked': True, 'serial': 'emulator-5556', 'hostMicEnabled': False,
                                      'safeForControlledInjection': True, 'audioInjected': False})
            channel.assert_called_once_with('127.0.0.1:8556')
            pid.assert_called_once_with(5556)
            discover.assert_called_once_with(424242, None, 5556)

    def test_check_enabled_host_mic_is_read_only_and_fails_closed(self):
        with self.fixture(['--check-microphone'], enabled=True) as (stub, output, *_), \
             patch.object(HELPER.wave, 'open', side_effect=AssertionError('Preflight must not read audio')):
            self.assertEqual(HELPER.main(), 2)
            result = json.loads(output.getvalue().splitlines()[-1])
            self.assertTrue(result['hostMicEnabled'])
            self.assertFalse(result['safeForControlledInjection'])
            self.assertEqual((stub.reads, stub.injections), (1, 0))

    def test_missing_bearer_never_constructs_client_or_reads_state(self):
        for data in ({}, {'grpc.port': '8556', 'grpc.jwks': 'nonsecret-fixture-path'}):
            with self.subTest(data=data), self.fixture(['--check-microphone'], discovery=data) as (stub, _, channel, *_):
                with self.assertRaisesRegex(ValueError, 'Authenticated bearer discovery required'):
                    HELPER.main()
                self.assertEqual((stub.reads, stub.injections), (0, 0))
                channel.assert_not_called()

    def test_existing_default_inspection_still_has_no_rpc(self):
        with self.fixture([], discovery={}) as (stub, _, channel, *_):
            self.assertIsNone(HELPER.main())
            self.assertEqual((stub.reads, stub.injections), (0, 0))
            channel.assert_not_called()

    def test_existing_injection_still_rejects_enabled_host_mic(self):
        with self.fixture(['--inject', str(WAV)], enabled=True) as (stub, *_):
            with self.assertRaisesRegex(ValueError, 'Host microphone is enabled'):
                HELPER.main()
            self.assertEqual((stub.reads, stub.injections), (1, 0))

    def test_existing_injection_framing_remains_available_with_safe_fixture(self):
        with self.fixture(['--inject', str(WAV)]) as (stub, output, *_):
            self.assertIsNone(HELPER.main())
            self.assertEqual((stub.reads, stub.injections, stub.packet_count), (1, 1, 125))
            self.assertTrue(json.loads(output.getvalue().splitlines()[-1])['injected'])

    def test_new_check_cannot_prepare_or_inject_before_any_discovery(self):
        destination = EVIDENCE / 'preflight-must-not-create.wav'
        self.assertFalse(destination.exists())
        for arguments in (['--check-microphone', '--prepare', str(destination)],
                          ['--check-microphone', '--inject', str(WAV)]):
            with self.subTest(arguments=arguments), self.fixture(arguments) as (stub, _, channel, pid, discover):
                with self.assertRaises(SystemExit) as error:
                    HELPER.main()
                self.assertEqual(error.exception.code, 2)
                pid.assert_not_called()
                discover.assert_not_called()
                channel.assert_not_called()
                self.assertEqual((stub.reads, stub.injections), (0, 0))
        self.assertFalse(destination.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
