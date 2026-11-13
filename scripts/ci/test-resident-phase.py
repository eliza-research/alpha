#!/usr/bin/env python3
"""Real Linux subprocess qualification for the CI supervisor; no Android effects."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

assert sys.platform == 'linux' and os.environ.get('GITHUB_ACTIONS') == 'true'
supervisor = Path(__file__).with_name('resident-phase.py').resolve()
results = []
for name, program, expected, interrupt in [
    ('success', 'print("completed")', True, False),
    ('failure', 'print("underlying prepare failure");raise SystemExit(7)', False, False),
    ('timeout', 'import time;time.sleep(300)', False, False),
    ('interrupt', 'import time;time.sleep(300)', False, True),
    ('orphan', 'import subprocess,sys;subprocess.Popen([sys.executable,"-c","import time;time.sleep(300)"])', False, False),
]:
    with tempfile.TemporaryDirectory(prefix='alpha-phase-') as directory:
        child = subprocess.Popen([sys.executable, str(supervisor), '--name', name,
            '--seconds', '2' if name == 'timeout' else '30', sys.executable, '-c', program],
            cwd=directory, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env={**os.environ, 'ALPHA_DIAGNOSTIC_SECRET_CANARY': 'snapshot-env-must-not-appear'})
        if interrupt:
            deadline = time.monotonic() + 10
            log = Path(directory) / 'test-results/resident-ci' / (name + '.log')
            while not log.exists():
                assert child.poll() is None and time.monotonic() < deadline
                time.sleep(.05)
            time.sleep(.2)
            child.send_signal(signal.SIGTERM)
        stdout, stderr = child.communicate(timeout=210)
        state = json.loads((Path(directory) / 'test-results/resident-ci' / (name + '.json')).read_text())
        assert state['passed'] is expected, (name, state)
        assert (child.returncode == 0) is expected, (name, child.returncode)
        if name == 'failure':
            assert state['exitCode'] == 7, state
            assert 'underlying prepare failure' in stderr, stderr
            assert 'exited with code 7' in stderr, stderr
        if name in ('timeout', 'interrupt', 'orphan'):
            assert state.get('ownedGroupCleanup') == 'graceful', (name, state)
        if expected:
            assert 'ownedProcessSnapshot' not in state
        else:
            snapshot = json.loads((Path(directory) / state['ownedProcessSnapshot']).read_text())
            assert all(program not in row['comm'] for row in snapshot['processes'])
            assert 'snapshot-env-must-not-appear' not in json.dumps(snapshot)
            assert snapshot['rootPid'] > 0 and not snapshot['truncated'], snapshot
            assert all(set(row) == {'pid', 'ppid', 'pgid', 'state', 'elapsed', 'cpu', 'comm'} for row in snapshot['processes']), snapshot
            assert all(row['pid'] != child.pid for row in snapshot['processes']), 'Supervisor must never enter the owned child snapshot'
            if name in ('timeout', 'interrupt', 'orphan'):
                assert snapshot['processes'], (name, snapshot)
            state['snapshot'] = snapshot
        results.append({'name': name, 'exitCode': child.returncode, 'state': state})
out = Path('test-results/resident-ci-supervisor')
out.mkdir(parents=True, exist_ok=True)
(out / 'result.json').write_text(json.dumps({'passed': True, 'cases': results}, indent=2) + '\n')
print('Five actual Linux supervisor flows passed')
