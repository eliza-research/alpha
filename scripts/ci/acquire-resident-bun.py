#!/usr/bin/env python3
"""CI-only authenticated acquisition. The runtime loader still verifies both pins."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ASSET_HOSTS = frozenset(('release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github.com'))
MAX_BYTES = 256 * 1024 * 1024

class AssetHttpError(RuntimeError):
    def __init__(self, status):
        self.status = status
        super().__init__(f"Pinned asset returned HTTP {status}")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def safe_asset_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in ASSET_HOSTS or parsed.port not in (None, 443) or parsed.username or parsed.password or parsed.fragment:
        raise ValueError('Rejected asset redirect origin')
    return url

def download(asset_id, destination, expected, token, opener=None, max_bytes=MAX_BYTES):
    if destination.exists():
        raise ValueError("Refusing to replace an existing archive")
    opener = opener or urllib.request.build_opener(NoRedirect())
    url = f'https://api.github.com/repos/oven-sh/bun/releases/assets/{asset_id}'
    digest = hashlib.sha256()
    created = False
    try:
        for attempt in range(6):
            headers = {'Accept': 'application/octet-stream', 'User-Agent': 'alphaphone-resident-ci'}
            # Never forward credentials, including a redirect back to the API.
            if attempt == 0:
                headers['Authorization'] = f'Bearer {token}'
                headers['X-GitHub-Api-Version'] = '2022-11-28'
            try:
                response = opener.open(urllib.request.Request(url, headers=headers), timeout=60)
            except urllib.error.HTTPError as error:
                if error.code in (301, 302, 303, 307, 308):
                    location = error.headers.get('Location')
                    error.close()
                    if not location:
                        raise ValueError('Missing asset redirect') from None
                    url = safe_asset_url(urllib.parse.urljoin(url, location))
                    continue
                # Do not expose signed URL, body, or request headers in logs.
                status = error.code
                error.close()
                raise AssetHttpError(status) from None
            with response:
                output = destination.open('xb')
                created = True
                with output:
                    count = 0
                    while chunk := response.read(1024 * 1024):
                        count += len(chunk)
                        if count > max_bytes:
                            raise ValueError('Asset exceeded size limit')
                        digest.update(chunk)
                        output.write(chunk)
            if digest.hexdigest() != expected:
                raise ValueError('Pinned archive SHA-256 mismatch')
            return
        raise ValueError('Asset redirect limit exceeded')
    except Exception:
        if created:
            destination.unlink(missing_ok=True)
        raise

def read_artifacts(source, target="linux-musl"):
    lock = json.loads((source / 'packages/app/scripts/lib/android-bun-artifacts.lock.json').read_text())
    if target not in ('linux-musl', 'android'):
        raise ValueError('Unsupported Android Bun target')
    release = (lock.get('targets', {}).get('android', {}).get('stable', {})
               if target == 'android' else lock.get('channels', {}).get('stable', {}))
    if lock.get('schemaVersion') != 1 or lock.get('repository') != 'oven-sh/bun' or release.get('version') != '1.4.2' or not re.fullmatch('[a-f0-9]{40}', release.get('revision', '')):
        raise ValueError('Invalid stable Bun lock')
    artifacts = release.get('artifacts', {})
    arches = ('aarch64',) if target == 'android' else ('x64', 'aarch64')
    if target == 'android' and set(artifacts) != {'aarch64'}:
        raise ValueError('Android Bun requires exactly the pinned ARM64 artifact')
    for arch in arches:
        artifact = artifacts.get(arch, {})
        if type(artifact.get('assetId')) is not int or not 0 < artifact['assetId'] <= 9007199254740991 or any(not re.fullmatch('[a-f0-9]{64}', artifact.get(key, '')) for key in ('archiveSha256', 'binarySha256')):
            raise ValueError('Invalid pinned Bun artifact')
    return artifacts

def main():
    token = os.environ.pop('GH_TOKEN', '')
    if not token:
        raise ValueError('Missing download-step GitHub token')
    source = Path(os.environ['ALPHA_LOCAL_AGENT_SOURCE_DIR']).resolve(strict=True)
    target = os.environ.get('ELIZA_ANDROID_BUN_TARGET', 'linux-musl')
    if target == 'android' and os.environ.get('ELIZA_ANDROID_TARGET_ABIS') != 'arm64-v8a':
        raise ValueError('Android Bun acquisition requires explicit ARM64-only selection')
    if os.environ.get('ALPHA_RUNTIME_PROFILE') == 'cloud' and target != 'android':
        raise ValueError('Hosted Cloud candidate requires Android Bionic Bun')
    artifacts = read_artifacts(source, target)
    # Fresh per-run directory, outside the runtime source; no unverified cache hits.
    output = Path(os.environ['RUNNER_TEMP']) / 'alpha-pinned-android-bun'
    output.mkdir(mode=0o700, exist_ok=False)
    variables = []
    for arch in (('aarch64',) if target == 'android' else ('x64', 'aarch64')):
        artifact = artifacts[arch]
        archive = output / (f'bun-linux-{arch}-android.zip' if target == 'android' else f'bun-linux-{arch}-musl.zip')
        download(artifact['assetId'], archive, artifact['archiveSha256'], token,
                 max_bytes=40 * 1024 * 1024 if target == 'android' else MAX_BYTES)
        variables.append(f'ELIZA_BUN_{arch.upper()}_FILE={archive}')
        print(f'Verified stable Bun {arch} archive {artifact["archiveSha256"]}')
    with open(os.environ['GITHUB_ENV'], 'a') as env:
        env.write('\n'.join(variables) + '\n')

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Network exception repr can contain signed URLs; retain only fixed categories.
        detail = f'HTTP {error.status}' if isinstance(error, AssetHttpError) else type(error).__name__
        print(f'Bun acquisition failed: {detail}', file=sys.stderr)
        sys.exit(1)
