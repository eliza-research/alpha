#!/usr/bin/env python3
"""Proposed owning CI check. Source-only draft; not executed or installed."""
import time
SCRIPT_ENTRY = time.monotonic()
CURRENT_DEADLINE = SCRIPT_ENTRY + 20
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import stat
import subprocess
import sys

SDK = '35e0a605b3d560eedec664e79693d5ecc0b5ece3'
HOST = 'f222d4ce2e67fc0c401bec9d35bb3b72fbe83e9d74ca6c2bf7353d0d79e2026b'
JSON_SHA = '3ea61b2a06e31edf1c91134fe9106b0ebb16628be169f3db75bc7a2b06b45796'
ENTRY_SECONDS = 180  # <240s GHA timeout, leaving >=60s platform margin.
PREFLIGHT_SECONDS = 20
WORK_END_SECONDS = 150  # Absolute from entry, including preflight.
CLEANUP_END_SECONDS = 170  # 20s cleanup +10s receipt reserve within180s.
MAX_LOG = 131072
MAX_RECEIPT = 1048576
HASH_READ_BYTES = 0
OWNING_SHA256 = {'plugins/plugin-native-calendar/test/native-host/bridge-check.mjs': 'cbea41bf08f6e716b66bc1f6d0846aa228b62f276d4d110e885608b6ef71a4f5', 'plugins/plugin-native-calendar/test/native-host/bridge-runtime/CalendarBridgeContract.java': '0ea39bee3624ce081330e17cba8f4ad4b02e49182f0282abc1a83f95a9d354a8', 'plugins/plugin-native-calendar/test/native-host/bridge-runtime/android/content/ContentResolver.java': 'b2c6ff0a6be6699c6a1dffe9552548cc3c84698893df6363a52e724040dce368', 'plugins/plugin-native-calendar/test/native-host/bridge-runtime/android/content/ContentUris.java': '4b693912eecd4fc44cf53d1f9e87faeb084e9569bc6c96fd819f26133164d303', 'plugins/plugin-native-calendar/test/native-host/bridge-runtime/android/content/ContentValues.java': '136557f2d3f5f87c7897eadb1f0c21d3250daa9abc7c8f4c3a8b1513e612f311', 'plugins/plugin-native-calendar/test/native-host/bridge-runtime/android/content/Context.java': '49464ad8498e0c4ea867530fa0233f958390529f4f7fb6c4af9d920626763624', 'plugins/plugin-native-calendar/test/native-host/bridge-runtime/android/content/Intent.java': 'e2f1e3fd69a28e5bfd5d2fc8ed3ff5c57930deeafc04246a9e064d5e23704305', 'plugins/plugin-native-calendar/test/native-host/bridge-runtime/android/content/SharedPreferences.java': 'a82e4836a6a794afb430f536bbcfe75f390aa6e6719966ee0b06241bec1f9434', 'plugins/plugin-native-calendar/test/native-host/bridge-runtime/android/content/pm/ActivityInfo.java': 'b3793d04c2ce1b5272f5e4ea664b2b9037a7be05ff54c20475152fdb8e3b9032', 'plugins/plugin-native-calendar/test/native-host/bridge-runtime/android/content/pm/PackageManager.java': 'c1f8cad6a8926f32caa0b2e6135860591f974f2780553777228326c01d5c4193', 'plugins/plugin-native-calendar/test/native-host/bridge-runtime/android/content/pm/ResolveInfo.java': '8af09a1d23095f8437915c465c480391ba295f028e03ad7cb323410439314c99', 'plugins/plugin-native-calendar/test/native-host/bridge-runtime/android/database/Cursor.java': '4b9bfb33c7f5c331cdab4735d22ca19176104acb1dec4111c86682b8a3eb9bd8', 'plugins/plugin-native-calendar/test/native-host/bridge-runtime/android/net/Uri.java': '8540fa9dedbf8ab64dbc3f29c97b6a149855c00af5ce94c7f85cfce4e27077d9', 'plugins/plugin-native-calendar/test/native-host/bridge-runtime/androidx/appcompat/app/AppCompatActivity.java': '5feb4ae0c648494826cba5a2d688deca1aa488d1e5d7ae9e8ebb6e10a73d8092', 'plugins/plugin-native-calendar/test/native-host/bridge-runtime/com/getcapacitor/Plugin.java': '81a319f86dc65d9d050896bb9d8f2e18f98f79e868e92cbcab9cfc781575e570', 'plugins/plugin-native-calendar/test/native-host/bridge-runtime/com/getcapacitor/PluginCall.java': '00a6bf9d8da5b21b7cbcb407ae113f0ac6ffa00c6bc2110191a5d5848c916460', 'plugins/plugin-native-calendar/test/native-host/read-window/android/provider/CalendarContract.java': '5ecedf08c9b7275cb7ee7d504fc82e64e64aa12ac4721556fd37d9464dcd851e'}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def deadline():
    require(time.monotonic() < CURRENT_DEADLINE, 'Current phase absolute deadline exceeded')


def timeout(seconds):
    deadline()
    return min(seconds, CURRENT_DEADLINE - time.monotonic())


def digest(path):
    global HASH_READ_BYTES
    p = Path(path)
    require(p.is_file() and not p.is_symlink(), 'Nonregular fixed input')
    require(p.stat().st_size <= 160 * 1024**2, 'Fixed input exceeds byte bound')
    before = p.stat()
    md, count = hashlib.sha256(), 0
    with p.open('rb') as stream:
        while block := stream.read(65536):
            deadline()
            count += len(block)
            HASH_READ_BYTES += len(block)
            require(count <= 160 * 1024**2 and HASH_READ_BYTES <= 512 * 1024**2,
                    'Actual fixed-input read budget exceeded')
            md.update(block)
    after = p.stat()
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) and count == before.st_size,
            'Fixed input changed during bounded read')
    return md.hexdigest()


def bounded_json(path, value, limit=MAX_RECEIPT, failure_receipt=False):
    written = 0
    with Path(path).open('xb') as stream:
        for chunk in json.JSONEncoder(indent=2).iterencode(value):
            if not failure_receipt:
                deadline()
            encoded = chunk.encode()
            written += len(encoded)
            require(written <= limit - 1, 'Receipt serialization exceeds bound')
            stream.write(encoded)
        stream.write(b'\n')


def owned_path(path):
    p = Path(path).absolute()
    for part in [p, *p.parents]:
        if part.exists():
            require(not part.is_symlink(), 'Symlink in owned output ancestry')
    require(p.parent.stat().st_uid == os.getuid(), 'Output parent is not owned')
    return p


def safe_git(root, args):
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
           'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_NO_LAZY_FETCH': '1',
           'GIT_OPTIONAL_LOCKS': '0', 'GIT_TERMINAL_PROMPT': '0'}
    result = subprocess.run(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null',
        '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-C', str(root), *args],
        env=env, capture_output=True, check=True, timeout=timeout(2))
    require(len(result.stdout) <= 16384, 'Git metadata output exceeds bound')
    return result.stdout.decode().strip()


def output_size(root):
    total, count = 0, 0
    for directory, dirs, names in os.walk(root, followlinks=False):
        for name in [*dirs, *names]:
            deadline()
            p = Path(directory) / name
            st = p.lstat()
            require(not stat.S_ISLNK(st.st_mode), 'Symlink in owned output')
            count += 1
            require(count <= 4096, 'Owned output entry bound exceeded')
            if stat.S_ISREG(st.st_mode):
                total += st.st_size
                require(total <= 64 * 1024**2, 'Owned output byte bound exceeded')
    return total


def group_members(pgid, roots, executables):
    result = subprocess.run(['/usr/bin/ps', '-eo', 'pid=,pgid=,rss='],
        capture_output=True, timeout=timeout(2), check=True)
    require(len(result.stdout) <= 1048576, 'Process inventory exceeds bound')
    rows = [list(map(int, line.split())) for line in result.stdout.splitlines()]
    members = {}
    for pid, group, rss in rows:
        deadline()
        if group != pgid:
            continue
        require(len(members) < 64, 'Owned process-group member bound exceeded')
        try:
            with open('/proc/' + str(pid) + '/stat', 'rb') as stream:
                raw = stream.read(4097)
        except (FileNotFoundError, ProcessLookupError):
            continue
        require(len(raw) <= 4096, 'Process birth metadata exceeds bound')
        fields = raw[raw.rfind(b')') + 2:].split()
        # Linux stat fields 5=pgrp, 6=session, 22=starttime; tail starts at field3.
        require(len(fields) >= 20 and int(fields[2]) == pgid and int(fields[3]) == pgid,
                'Owned group/session changed during observation')
        members[pid] = {'birthTicks': int(fields[19]), 'rssBytes': rss * 1024}
        try:
            exe = Path(os.readlink('/proc/' + str(pid) + '/exe'))
            cwd = Path(os.readlink('/proc/' + str(pid) + '/cwd'))
            uid = os.stat('/proc/' + str(pid)).st_uid
        except (FileNotFoundError, ProcessLookupError):
            if fields[0] == b'Z':
                members[pid]['zombie'] = True
                continue
            members.pop(pid)
            continue
        require(uid == os.getuid() and
                (str(exe) in executables or any(exe.is_relative_to(p) for p in roots)) and
                any(cwd.is_relative_to(p) for p in roots), 'Process executable/source context is not owned')
        members[pid].update(exe=str(exe), cwd=str(cwd), uid=uid)
    return members


GENERATED = ['apps/app/public/licenses/THIRD_PARTY_NOTICES.txt',
             'apps/app/public/licenses/third-party-notices.json']


def tracked_frame(root):
    changed = safe_git(root, ['diff', '--no-ext-diff', '--no-textconv', '--name-only',
                             '--ignore-submodules=none', 'HEAD', '--']).splitlines()
    require(set(changed).issubset(GENERATED), 'Unexpected tracked source changed')
    return {'changed': changed, 'generatedHashes': {name: digest(root / name) for name in GENERATED}}


def source_frame_path():
    run, attempt = os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT']
    require(run.isdecimal() and attempt.isdecimal(), 'Invalid workflow namespace')
    return owned_path(Path(os.environ['RUNNER_TEMP']) /
                      ('alpha-calendar-source-frame-' + run + '-' + attempt + '.json'))


def qualification_namespace():
    run, attempt = os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT']
    require(run.isdecimal() and attempt.isdecimal(), 'Invalid workflow namespace')
    return owned_path(Path(os.environ['RUNNER_TEMP']) / ('alpha-calendar-bridge-' + run + '-' + attempt))


def read_json(path, limit):
    deadline()
    require(not path.is_symlink() and path.is_file(), 'Unsafe JSON input')
    with path.open('rb') as stream:
        data = stream.read(limit + 1)
    require(len(data) <= limit, 'Actual JSON read bound exceeded')
    return json.loads(data)


def record_source_frame():
    entered = SCRIPT_ENTRY
    root = Path(__file__).resolve().parents[2]
    head = safe_git(root, ['rev-parse', 'HEAD'])
    require(head == os.environ['ALPHA_CALENDAR_BRIDGE_EXPECTED_HEAD'], 'Unexpected source frame head')
    value = {'head': head, 'tree': safe_git(root, ['rev-parse', 'HEAD^{tree}']),
             'sdk': safe_git(root, ['rev-parse', 'HEAD:vendor/eliza']), 'beforeNormalBuild': tracked_frame(root)}
    require(value['sdk'] == SDK and time.monotonic() - entered < 20, 'Source-frame deadline/pin failure')
    bounded_json(source_frame_path(), value, 32768)


def main():
    global CURRENT_DEADLINE
    entry = SCRIPT_ENTRY
    require(os.uname().sysname == 'Linux', 'This hook is for the hosted Linux job')
    root = Path(__file__).resolve().parents[2]
    expected_head = os.environ['ALPHA_CALENDAR_BRIDGE_EXPECTED_HEAD']
    head = safe_git(root, ['rev-parse', 'HEAD'])
    require(head == expected_head, 'Checkout differs from the workflow SHA')
    tree = safe_git(root, ['rev-parse', 'HEAD^{tree}'])
    frame_file = source_frame_path()
    require(frame_file.is_file() and not frame_file.is_symlink() and frame_file.stat().st_size <= 32768,
            'Missing bounded pre-normal-build source frame')
    source_frame = read_json(frame_file, 32768)
    require((source_frame['head'], source_frame['tree'], source_frame['sdk']) == (head, tree, SDK),
            'Pre-build source frame differs')
    source_frame['afterNormalBuild'] = tracked_frame(root)
    require(safe_git(root, ['rev-parse', 'HEAD:vendor/eliza']) == SDK, 'Unexpected SDK gitlink')
    require(safe_git(root / 'vendor/eliza', ['rev-parse', 'HEAD']) == SDK, 'Unexpected SDK checkout')
    host = root / 'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaCalendarPlugin.java'
    require(digest(host) == HOST, 'Unexpected Alpha calendar host')
    require((root / '.nvmrc').read_text().strip() == '24.15.0', 'Unexpected Node declaration')
    node = Path(shutil.which('node')).resolve(strict=True)
    java_home = Path(os.environ['JAVA_HOME']).resolve(strict=True)
    jar = Path(os.environ['ALPHA_JSON_JAR']).resolve(strict=True)
    require(digest(jar) == JSON_SHA, 'Normal host-test JSON jar differs')
    namespace = qualification_namespace()
    require(not namespace.exists(), 'Qualification namespace already exists; no replay')
    namespace.mkdir(mode=0o700)
    receipt = namespace / 'receipt'
    config = namespace / 'inputs.json'
    driver = root / 'vendor/eliza/plugins/plugin-native-calendar/test/native-host/bridge-check.mjs'
    fixed = [host, node, jar, driver, java_home / 'bin/java', java_home / 'bin/javac',
        java_home / 'release', root / 'scripts/ci/calendar-bridge.init.gradle',
        root / 'scripts/ci/calendar-bridge.py', root / '.nvmrc',
        root / 'android/.eliza-consumer-profile.json', root / 'android/consumer-host.json',
        root / 'upstream.lock.json', root / 'patches/eliza/native-manifest.json']
    fixture = driver.parent / 'bridge-runtime'
    for relative, expected in OWNING_SHA256.items():
        require(digest(root / 'vendor/eliza' / relative) == expected, 'Canonical owning source changed')
    # This directory is the small tracked owning fixture; no dependency/cache traversal.
    seen, visited = set(), 0
    for directory, dirs, names in os.walk(fixture, followlinks=False):
        for name in [*dirs, *names]:
            visited += 1
            require(visited <= 64, 'Owning fixture traversal bound exceeded')
            require(not (Path(directory) / name).is_symlink(), 'Symlink in owning fixture')
        for name in sorted(names):
            if name.endswith('.java'):
                file = Path(directory) / name
                seen.add(str(file.relative_to(root / 'vendor/eliza')))
                fixed.append(file)
                require(len(fixed) <= 64, 'Fixed fixture count exceeds bound')
    expected_fixture = {name for name in OWNING_SHA256 if '/bridge-runtime/' in name and name.endswith('.java')}
    require(seen == expected_fixture, 'Owning fixture Java set differs; no extra Java inputs')
    fixed += [driver.parent / 'read-window/android/provider/CalendarContract.java']
    require(len(fixed) <= 64, 'Fixed input count exceeds bound')
    initial = {str(p): digest(p) for p in fixed}
    cfg = {'head': head, 'tree': tree, 'sdk': SDK, 'root': str(root),
        'outputDirectory': str(receipt), 'node': str(node), 'driver': str(driver),
        'json': str(jar), 'javaHome': str(java_home), 'fixedInputs': initial, 'sourceFrame': source_frame,
        'readRoots': [str(root), str(java_home), str(node.parent), str(jar.parent),
            str(Path(os.environ['ANDROID_HOME']).resolve(strict=True)),
            str(Path(os.environ['GRADLE_USER_HOME']).resolve(strict=True))]}
    bounded_json(config, cfg, 65536)
    argv = ['./gradlew', '--offline', '--no-daemon', '--max-workers=1',
        '--no-build-cache', '--no-configuration-cache',
        '--init-script', str(root / 'scripts/ci/calendar-bridge.init.gradle'),
        '-PcalendarBridgeInputs=' + str(config),
        '-PELIZA_RUNTIME_PROFILE=native', '-PELIZA_ALLOW_UNPACKAGED_RUNTIME=1',
        '-PELIZA_DEV_ALLOW_TEST_MOCKS=0', ':app:qualifyCalendarPairedJournalBridge']
    require(time.monotonic() - entry <= PREFLIGHT_SECONDS, 'Preflight budget exhausted')
    CURRENT_DEADLINE = entry + WORK_END_SECONDS
    free = shutil.disk_usage(root).free
    require(free >= 24268435456, 'Proposed entry disk floor not met')
    log = namespace / 'gradle.log'
    child, failure, peak = None, None, 0
    known, first, last = {}, None, None
    cleanup_errors, sent = [], []
    observations = 0
    process_roots = [root, namespace, java_home,
        Path(os.environ['ANDROID_HOME']).resolve(strict=True),
        Path(os.environ['GRADLE_USER_HOME']).resolve(strict=True), node.parent]
    system_exes = {'/usr/bin/' + name for name in
        ['sh', 'dash', 'bash', 'env', 'git', 'patch', 'python3', 'uname', 'sed', 'xargs', 'dirname', 'readlink', 'tr']}

    def observe():
        nonlocal known, first, last, observations
        rows = group_members(child.pid, process_roots, system_exes)
        if first is None:
            require(child.pid in rows, 'Initial owned leader/birth missing')
            first = rows
        else:
            require(not rows or any(pid in known and known[pid] == row['birthTicks']
                                    for pid, row in rows.items()), 'Unanchored PID generation; refuse signal')
        known = {pid: row['birthTicks'] for pid, row in rows.items()}
        last = rows
        observations += 1
        return rows

    def safely_signal(which):
        require(safe_git(root, ['rev-parse', 'HEAD']) == head and digest(host) == HOST,
                'Source context differs; refuse group signal')
        # Context work can block. The last operation before killpg must be a fresh
        # birth-anchored observation, with no intervening Git/hash work.
        rows = observe()
        if not rows:
            return
        # Fresh snapshot has a surviving PID+birth anchor from the previous observation.
        try:
            os.killpg(child.pid, which)
            sent.append({'signal': int(which), 'members': rows})
        except ProcessLookupError:
            pass  # Group exited between validated observation and signal.

    try:
        with log.open('xb') as stream, selectors.DefaultSelector() as selector:
            child = subprocess.Popen(argv, cwd=root / 'android', start_new_session=True,
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            observe()  # Establish leader/start-tick anchor immediately, before learning descendants.
            selector.register(child.stdout, selectors.EVENT_READ)
            logged, sampled = 0, 0
            while child.poll() is None or selector.get_map():
                require(time.monotonic() - entry < WORK_END_SECONDS, 'Absolute work deadline exceeded')
                for key, _ in selector.select(timeout=0.2):
                    block = os.read(key.fd, 32768)
                    if not block:
                        selector.unregister(key.fileobj)
                    else:
                        logged += len(block)
                        require(logged <= MAX_LOG, 'Gradle log bound exceeded')
                        stream.write(block)
                if time.monotonic() - sampled >= 1:
                    sampled = time.monotonic()
                    rows = observe()
                    rss = sum(row['rssBytes'] for row in rows.values())
                    peak = max(peak, rss)
                    require(rss <= 2147483648, 'Process-group RSS bound exceeded')
                    current = shutil.disk_usage(root).free
                    require(current >= 24000000000 and free - current <= 268435456, 'Disk bound exceeded')
                    output_size(namespace)
            require(child.returncode == 0, 'Normal qualification command failed')
    except Exception as error:
        failure = str(error)[:500]
    finally:
        CURRENT_DEADLINE = entry + CLEANUP_END_SECONDS
        # Reuse the reviewed anchored-observation/anchored-signal cleanup pattern.
        # A failed ps/proc/kill check is a failure receipt, never an unguarded escape from finally.
        if child is not None:
            try:
                rows = observe()
                if rows:
                    safely_signal(signal.SIGTERM)
                    until = min(entry + CLEANUP_END_SECONDS - 5, time.monotonic() + 5)
                    while time.monotonic() < until:
                        if not observe():
                            break
                        time.sleep(0.1)
                    if observe():
                        safely_signal(signal.SIGKILL)
                child.wait(timeout=timeout(3))
            except Exception as error:
                cleanup_errors.append(str(error)[:300])
            if child.returncode is None:
                # Popen owns this direct child and has not reaped it. This fallback
                # never targets a numeric process group or any unverified descendant.
                # Preserve cleanup_errors/uncertain group closure even if it succeeds.
                try:
                    deadline()
                    child.terminate()
                    sent.append({'kind': 'POPEN_DIRECT_CHILD_ATTEMPT', 'pid': child.pid,
                                 'signal': int(signal.SIGTERM)})
                    try:
                        child.wait(timeout=timeout(1))
                    except subprocess.TimeoutExpired:
                        deadline()
                        child.kill()
                        sent.append({'kind': 'POPEN_DIRECT_CHILD_ATTEMPT', 'pid': child.pid,
                                     'signal': int(signal.SIGKILL)})
                        child.wait(timeout=timeout(2))
                except Exception as error:
                    cleanup_errors.append('direct-child-fallback: ' + str(error)[:250])
            try:
                if child.stdout is not None:
                    child.stdout.close()
            except Exception as error:
                cleanup_errors.append(str(error)[:300])
        closed = child is None
        if child is not None:
            try:
                final = observe()
                closed = not final
            except Exception as error:
                cleanup_errors.append(str(error)[:300])
        if cleanup_errors or not closed:
            failure = failure or 'Birth-verified process-group closure incomplete'
        CURRENT_DEADLINE = entry + ENTRY_SECONDS
        try:
            require(time.monotonic() - entry < ENTRY_SECONDS, 'Final receipt reserve exhausted')
            require(initial == {str(p): digest(p) for p in fixed}, 'Fixed inputs drifted')
            require(tracked_frame(root) == source_frame['afterNormalBuild'],
                    'Tracked frame/generated outputs changed during qualification')
            result = receipt / 'result.json'
            if failure is None:
                require(result.is_file() and not result.is_symlink() and result.stat().st_size <= 32768,
                        'Actual bridge result missing/unbounded; no skipped-task success')
                actual = read_json(result, 32768)
                require(actual.get('status') == 'PASS_CONTROLLED_JVM_BRIDGE' and
                    actual.get('source') == {'head': head, 'tree': tree, 'sdk': SDK},
                    'Bridge result does not bind this actual source')
        except Exception as error:
            failure = failure or str(error)[:500]
        # Exactly six persistent files can be published. Never upload receipt/tmp.
        publish = [receipt / name for name in ['inputs.json', 'taskgraph.json', 'bridge.log', 'result.json']]
        publish += [log]
        try:
            amount = 0
            for path in publish:
                if path.exists():
                    require(not path.is_symlink() and path.is_file(), 'Unsafe published file')
                    amount += path.stat().st_size
            require(amount <= MAX_RECEIPT - 32768, 'Published receipt size exceeds bound')
        except Exception as error:
            failure = failure or str(error)[:500]
        def final_bounds():
            require(time.monotonic() - entry < ENTRY_SECONDS, 'Final whole-entry deadline exceeded')
            current = shutil.disk_usage(root).free
            require(current >= 24000000000 and free - current <= 268435456, 'Final disk bound exceeded')
            require(output_size(namespace) <= 64 * 1024**2, 'Final owned output bound exceeded')
        try:
            final_bounds()
        except Exception as error:
            failure = failure or str(error)[:500]
        supervisor = {'command': argv, 'head': head, 'tree': tree,
            'sdk': SDK, 'secondsFromEntry': time.monotonic() - entry,
            'deadlinesFromEntry': {'work': WORK_END_SECONDS, 'cleanup': CLEANUP_END_SECONDS,
                                  'entry': ENTRY_SECONDS, 'ghaStep': 240},
            'peakPGRSSBytes': peak, 'processGroupClosed': closed, 'observations': observations,
            'initialBirthSnapshot': first, 'lastBirthSnapshot': last, 'signals': sent,
            'cleanupErrors': cleanup_errors, 'sourceFrame': source_frame,
            'helperHashReadBytes': HASH_READ_BYTES, 'failure': failure}
        # A bounded failure receipt may still be written after a missed deadline;
        # it performs no more work/observation and can never authorize PASS.
        bounded_json(namespace / 'supervisor.json', supervisor, 32768, failure_receipt=True)
        try:
            final_bounds()
        except Exception as error:
            failure = failure or str(error)[:500]
            supervisor['failure'] = failure
            supervisor['status'] = 'FAIL_LATE_FINAL_BOUND'
            replacement = namespace / 'supervisor-failure.tmp'
            bounded_json(replacement, supervisor, 32768, failure_receipt=True)
            os.replace(replacement, namespace / 'supervisor.json')
        require(failure is None, failure)


if __name__ == '__main__':
    if sys.argv[1:] == ['--source-frame']:
        record_source_frame()
    else:
        require(not sys.argv[1:], 'Unknown qualification argument')
        try:
            main()
        except Exception as error:
            # Preflight/observation/final-receipt failures must not disappear without metadata.
            namespace = qualification_namespace()
            if not namespace.exists():
                namespace.mkdir(mode=0o700)
            fallback = namespace / 'supervisor.json'
            if not fallback.exists():
                bounded_json(fallback, {'failure': str(error)[:500], 'processGroupClosed': False,
                    'closureConfirmed': False, 'status': 'FAIL_OR_PREFLIGHT_REFUSAL'}, 32768, failure_receipt=True)
            raise
