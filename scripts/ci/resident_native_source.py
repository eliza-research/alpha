"""Verify generated Java provenance; resident JS source remains patchless."""
import hashlib
import json
import subprocess
from pathlib import Path


def verify_generated_native(generated, frozen, root=Path('.')):
    root = Path(root).resolve()
    digest = lambda value: hashlib.sha256(value).hexdigest()
    for relative in ('scripts/local-agent-source.mjs', 'scripts/stage-local-agent-sources.mjs'):
        assert frozen[relative] == digest((root / relative).read_bytes()), 'Native source build input drift'
    lock = json.loads((root / 'upstream.lock.json').read_text())
    assert generated['runtimeSource'] == {'commit': lock['commit']}
    assert generated['patches'] == [], 'Resident source must be patchless at the merged upstream pin'
    seen = set()
    for row in generated['files']:
        origin = row['path']
        assert not origin.startswith('/') and '..' not in Path(origin).parts and origin not in seen
        seen.add(origin)
        committed = subprocess.check_output(['git', '-C', 'vendor/eliza', 'show', lock['commit'] + ':' + origin], cwd=root)
        original = digest(committed)
        assert row['sourceSha256'] == original, 'Native original source drift'
        assert row['sha256'] == original, 'Native admitted source drift'
        if origin.endswith('.java'):
            target = row['generatedPath']
            assert target.startswith('android/app/build/generated/local-agent/java/') and '..' not in Path(target).parts
            assert frozen[target] == row['generatedSha256'], 'Generated native source drift'
    required = {'packages/app/platforms/android/app/src/main/java/ai/elizaos/app/' + name + '.java'
                for name in ('ElizaAgentService', 'IpcStartupRecovery')}
    assert required.issubset(seen), 'Missing reviewed resident source'
    return {}
