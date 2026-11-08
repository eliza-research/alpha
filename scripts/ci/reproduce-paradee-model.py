#!/usr/bin/env python3
"""Run the unchanged pinned converter and retain its hash verdict, including failure."""
import hashlib
import importlib.metadata
import json
import pathlib
import platform
import re
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'vendor/eliza'
FORK = SOURCE / 'plugins/plugin-local-inference/native/llama.cpp'
OUT = ROOT / 'artifacts/paradee-reproduction'

def shipped_model():
    """The Paradee GGUF the product stages, from scripts/host-speech-assets.json."""
    recorded = json.loads((ROOT / 'scripts/host-speech-assets.json').read_text())['tts'][0]
    match = re.fullmatch(r'paradee-8m-v(\d+)_(\d+)\.gguf', recorded['path'])
    if not match:
        raise RuntimeError(f"Unexpected Paradee model name: {recorded['path']}")
    return f'{match[1]}.{match[2]}', recorded

def git(directory, *args):
    return subprocess.check_output(['git', '-C', str(directory), *args], text=True).strip()

def main():
    version, recorded = shipped_model()
    if sys.argv[1:] == ['--print-config']:
        print(json.dumps({'version': version, 'output': recorded['path'],
            'recorded': {'sha256': recorded['sha256'], 'bytes': recorded['bytes']}}))
        return 0
    assert not sys.argv[1:], 'Unknown argument'
    OUT.mkdir(parents=True, exist_ok=False)
    expected_source = git(ROOT, 'ls-tree', 'HEAD', 'vendor/eliza').split()[2]
    expected_fork = git(SOURCE, 'ls-tree', 'HEAD', 'plugins/plugin-local-inference/native/llama.cpp').split()[2]
    assert git(SOURCE, 'rev-parse', 'HEAD') == expected_source
    assert git(FORK, 'rev-parse', 'HEAD') == expected_fork
    assert not git(FORK, 'status', '--porcelain', '--untracked-files=all')
    pins = json.loads((FORK / 'tools/paradee/pins.json').read_text())[f'v{version}']
    inputs = OUT / 'inputs'
    for name in ['pytorch/text_side.pt', 'pytorch/decoder.pt', 'config.json', 'tokenizer.json']:
        row = pins['files'][name]
        url = f"https://huggingface.co/{pins['model']['repo']}/resolve/{pins['model']['revision']}/{name}"
        target = inputs / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read(row['size'] + 1)
        assert len(data) == row['size'], name
        assert hashlib.sha256(data).hexdigest() == row['sha256'], name
        target.write_bytes(data)
    model = OUT / recorded['path']
    converter = FORK / 'tools/paradee/convert_paradee_pt_to_gguf.py'
    command = [sys.executable, str(converter), '--version', version, '--model-dir', str(inputs), '--output', str(model), '--outtype', 'f32', '--check-output']
    with (OUT / 'conversion.log').open('w') as log:
        result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=False)
    record = {
        'sourceCommit': expected_source,
        'nativeCommit': expected_fork,
        'system': platform.platform(),
        'architecture': platform.machine(),
        'python': platform.python_version(),
        'torch': importlib.metadata.version('torch'),
        'numpy': importlib.metadata.version('numpy'),
        'converterSha256': hashlib.sha256(converter.read_bytes()).hexdigest(),
        'version': version,
        'expected': pins['gguf']['f32'],
        'recorded': {'sha256': recorded['sha256'], 'bytes': recorded['bytes']},
        'exitCode': result.returncode,
        'actual': {'bytes': model.stat().st_size, 'sha256': hashlib.sha256(model.read_bytes()).hexdigest()} if model.exists() else None,
        'deviceQualified': False,
    }
    (OUT / 'result.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record, indent=2))
    assert not git(FORK, 'status', '--porcelain', '--untracked-files=all')
    if result.returncode:
        return result.returncode
    # The verdict covers both the engine pin and the bytes the product records and ships.
    actual = record['actual']
    pinned = {'sha256': pins['gguf']['f32']['sha256'], 'bytes': pins['gguf']['f32']['size']}
    return 0 if actual == pinned == record['recorded'] else 1

if __name__ == '__main__':
    sys.exit(main())
