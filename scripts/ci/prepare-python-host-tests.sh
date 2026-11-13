#!/usr/bin/env bash
# CI-only prerequisites and qualification for the host microphone safety tests.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
output=${1:-artifacts/ci-python-host-tests}
mkdir -p "$output"
python3 -m pip install --require-hashes --only-binary=:all: -r scripts/ci/python-host-test-requirements.txt
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
test -n "$sdk"
if ! test -f "$sdk/emulator/lib/emulator_controller.proto"; then
  "$sdk/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$sdk" emulator
fi
test -f "$sdk/emulator/lib/emulator_controller.proto"
python3 -I - "$root" "$sdk" "$output" <<'PY'
import hashlib, importlib.metadata, importlib.util, json, pathlib, platform, subprocess, sys, unittest
root, sdk, output = map(pathlib.Path, sys.argv[1:])
proto = sdk / 'emulator/lib/emulator_controller.proto'
spec = importlib.util.spec_from_file_location('microphone_safety', root / 'test/emulator-microphone-preflight.test.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with (output / 'microphone-preflight.log').open('w') as log:
    result = unittest.TextTestRunner(stream=log, verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(module))
version = subprocess.check_output([str(sdk / 'emulator/emulator'), '-version'], text=True, stderr=subprocess.STDOUT, timeout=30)
record = {'python': platform.python_version(), 'packages': {name: importlib.metadata.version(name) for name in ('grpcio', 'grpcio-tools', 'protobuf', 'setuptools', 'typing-extensions')},
          'emulatorVersion': version.splitlines()[0], 'proto': str(proto), 'protoSha256': hashlib.sha256(proto.read_bytes()).hexdigest(),
          'testsRun': result.testsRun, 'skipped': len(result.skipped), 'passed': result.wasSuccessful() and result.testsRun > 0 and not result.skipped,
          'scope': 'Offline host-tool tests with controlled process/RPC doubles; no emulator connection, microphone read or audio injection.'}
(output / 'qualification.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2))
if not record['passed']:
    raise SystemExit('Microphone preflight must execute its real proto-backed host tests with zero inner skips')
PY
