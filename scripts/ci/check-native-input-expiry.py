"""Report the expiry of the reviewed launcher OTA artifact pins using metadata only."""
from datetime import datetime, timedelta, timezone
import importlib.util
import os
from pathlib import Path


spec = importlib.util.spec_from_file_location('hosted_native_inputs', Path(__file__).with_name('hosted-native-inputs.py'))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)

# A daily check gives maintainers about three to four days of overlap with a seven-day carrier.
RENEWAL_WINDOW = timedelta(days=4)


def check(root, env, now):
    manifest = root / native.MANIFEST
    if not manifest.exists() and not manifest.is_symlink():
        return [('notice', f'Awaiting initial native input provisioning in #916. {native.MANIFEST} is absent.')]

    plan, digest, _, inventory = native.load_plan(root)
    expirations = native.check_remote(root, env, plan, digest, inventory)
    findings = []
    for name, timestamp in expirations.items():
        message = f'{name} artifact {plan["artifacts"][name]["id"]} expires at {timestamp}.'
        if datetime.fromisoformat(timestamp) - now <= RENEWAL_WINDOW:
            findings.append(('warning', f'{message} Review its replacement pin while this artifact is still available.'))
        else:
            findings.append(('', message))
    return findings


def publish(findings, env):
    summary = ['## Launcher OTA native input expiry', '']
    for level, message in findings:
        if level:
            data = message.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
            print(f'::{level} title=Launcher OTA native inputs::{data}')
        else:
            print(message)
        summary.append(f'- {message}')
    if env.get('GITHUB_STEP_SUMMARY'):
        with Path(env['GITHUB_STEP_SUMMARY']).open('a', encoding='utf-8') as output:
            output.write('\n'.join(summary) + '\n')
    # Fail the independent monitoring run so GitHub's failure notifications can surface renewal work.
    return int(any(level in ('warning', 'error') for level, _ in findings))


def main(root=native.ROOT, env=os.environ):
    try:
        findings = check(root, env, datetime.now(timezone.utc))
    except (OSError, KeyError, TypeError, ValueError) as error:
        details = str(error).splitlines() or [type(error).__name__]
        findings = [('error', detail) for detail in details]
    return publish(findings, env)


if __name__ == '__main__':
    raise SystemExit(main())
