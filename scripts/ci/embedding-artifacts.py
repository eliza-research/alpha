"""Acquire exact reviewed embedding inputs; never build or promote compile-only output."""
import datetime
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPOSITORY = 'eliza-research/alpha'
REPOSITORY_ID = 1396333361
REPOSITORY_OWNER_ID = 314117943
LIBRARIES = ('libelizainference.so', 'libelizavoicejni.so', 'libc++_shared.so')
MAX_ARCHIVE = 128 * 1024 * 1024
MAX_EXPANDED = 192 * 1024 * 1024


def canonical_repository(env):
    return (env.get('GITHUB_REPOSITORY') == REPOSITORY and
            env.get('GITHUB_REPOSITORY_ID') == str(REPOSITORY_ID) and
            env.get('GITHUB_REPOSITORY_OWNER_ID') == str(REPOSITORY_OWNER_ID))


def require(value, message):
    if not value:
        raise ValueError(message)


def settings(env):
    enabled = env.get('ALPHA_LOCAL_EMBEDDINGS', '0') == '1'
    require(env.get('ALPHA_LOCAL_EMBEDDINGS', '0') in ('0', '1'), 'Invalid embedding capability')
    names = ('COMPONENT', 'QUALIFICATION')
    inputs = [(env.get('ALPHA_EMBEDDING_' + name + '_ARTIFACT_ID', ''),
               env.get('ALPHA_EMBEDDING_' + name + '_SHA256', '')) for name in names]
    if not enabled:
        require(not any(value for pair in inputs for value in pair), 'Embedding artifact inputs require explicit opt-in')
        return []
    for identity, digest in inputs:
        require(re.fullmatch(r'[1-9][0-9]{0,19}', identity), 'Embedding artifact ID is required')
        require(re.fullmatch(r'[0-9a-f]{64}', digest), 'Embedding artifact SHA-256 is required')
    require(inputs[0][0] != inputs[1][0], 'Component and qualification artifacts must be distinct')
    return inputs


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def json_api(path, token, opener):
    url = 'https://api.github.com/repos/' + REPOSITORY + '/' + path
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json', 'User-Agent': 'alpha-qualified-embedding-inputs'})
    try:
        with opener.open(request, timeout=20) as response:
            body = response.read(65537)
    except Exception:
        raise ValueError('GitHub artifact metadata unavailable') from None
    require(len(body) <= 65536, 'Artifact metadata exceeds bound')
    value = json.loads(body)
    require(isinstance(value, dict), 'Expected an artifact or run metadata object')
    return value


def validate_metadata(value, identity, digest, *, max_archive=MAX_ARCHIVE):
    require(value.get('id') == int(identity), 'Artifact identity differs from requested input')
    require(value.get('expired') is False, 'Artifact is expired or has unknown expiry status')
    require(value.get('digest') == 'sha256:' + digest, 'Artifact digest differs from requested input')
    size = value.get('size_in_bytes')
    require(type(size) is int and 0 < size <= max_archive, 'Artifact size exceeds bound')
    run = value.get('workflow_run')
    require(isinstance(run, dict), 'Artifact run metadata is unavailable')
    require(run.get('repository_id') == REPOSITORY_ID and run.get('head_repository_id') == REPOSITORY_ID,
            'Artifact must originate in the canonical repository')
    require(type(run.get('id')) is int and run['id'] > 0, 'Artifact run identity missing')
    require(re.fullmatch(r'[0-9a-f]{40}', run.get('head_sha', '')), 'Artifact source identity missing')
    return run


def safe_redirect(url):
    parsed = urllib.parse.urlsplit(url)
    host = parsed.hostname or ''
    require(parsed.scheme == 'https' and parsed.port in (None, 443) and not parsed.username and not parsed.password,
            'Unsafe artifact redirect')
    require(host == 'github.com' or host.endswith('.githubusercontent.com') or host.endswith('.blob.core.windows.net'),
            'Unexpected artifact redirect host')
    return url


def admit_artifact_metadata(identity, digest, token, opener, *, max_archive=MAX_ARCHIVE):
    metadata = json_api('actions/artifacts/' + identity, token, opener)
    run = validate_metadata(metadata, identity, digest, max_archive=max_archive)
    status = json_api('actions/runs/' + str(run['id']), token, opener)
    require(status.get('conclusion') == 'success' and status.get('head_sha') == run['head_sha'], 'Artifact run did not succeed')
    return metadata, run


def download(identity, digest, target, token, opener, *, max_archive=MAX_ARCHIVE):
    metadata, run = admit_artifact_metadata(identity, digest, token, opener, max_archive=max_archive)
    url = 'https://api.github.com/repos/' + REPOSITORY + '/actions/artifacts/' + identity + '/zip'
    for attempt in range(5):
        headers = {'User-Agent': 'alpha-qualified-embedding-inputs'}
        if attempt == 0:
            headers['Authorization'] = 'Bearer ' + token
        try:
            response = opener.open(urllib.request.Request(url, headers=headers), timeout=20)
        except urllib.error.HTTPError as error:
            if error.code not in (301, 302, 303, 307, 308):
                error.close()
                raise ValueError('Embedding artifact download failed') from None
            location = error.headers.get('Location')
            error.close()
            require(location, 'Artifact redirect missing')
            url = safe_redirect(urllib.parse.urljoin(url, location))
            continue
        except Exception:
            raise ValueError('Embedding artifact download failed') from None
        value = hashlib.sha256()
        count = 0
        with response, target.open('xb') as output:
            while chunk := response.read(1024 * 1024):
                count += len(chunk)
                require(count <= metadata['size_in_bytes'], 'Artifact download exceeds bound')
                output.write(chunk)
                value.update(chunk)
        require(count == metadata['size_in_bytes'] and value.hexdigest() == digest, 'Downloaded artifact digest mismatch')
        return {'artifactId': int(identity), 'sha256': digest, 'run': run['id'], 'source': run['head_sha']}
    raise ValueError('Artifact redirect limit exceeded')


def extract_selected(archive, destination, selected):
    destination.mkdir(mode=0o700)
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        require(len(entries) <= 256, 'Artifact entry count exceeds bound')
        names, total = set(), 0
        for item in entries:
            path = PurePosixPath(item.filename)
            require(not path.is_absolute() and '..' not in path.parts and '\\' not in item.filename, 'Unsafe artifact entry')
            require(item.filename.casefold() not in names, 'Duplicate artifact entry')
            names.add(item.filename.casefold())
            require(not stat.S_ISLNK(item.external_attr >> 16) and not item.flag_bits & 1, 'Artifact links/encryption refused')
            total += item.file_size
            require(total <= MAX_EXPANDED, 'Expanded artifact exceeds bound')
        for name, output in selected.items():
            info = source.getinfo(name)
            require(not info.is_dir() and 0 < info.file_size <= 32 * 1024 * 1024, 'Selected artifact member exceeds bound')
            with source.open(info) as reader, (destination / output).open('xb') as writer:
                count = 0
                while chunk := reader.read(1024 * 1024):
                    count += len(chunk)
                    require(count <= info.file_size, 'Artifact member exceeds declared size')
                    writer.write(chunk)


def read_json(path):
    require(path.stat().st_size <= 2 * 1024 * 1024, 'Receipt exceeds bound')
    return json.loads(path.read_text())


def validate_input_inventory(rows, reviewed, digest_fields):
    message = 'Complete producer/native inputs required'
    expected = {row['path'] for row in reviewed}
    require(len(expected) == len(reviewed) and bool(expected), message)
    require(isinstance(rows, list) and len(rows) == len(expected), message)
    observed = set()
    for row in rows:
        require(isinstance(row, dict) and set(row) == {'path', *digest_fields}, message)
        path = row['path']
        require(isinstance(path, str) and path in expected and path not in observed, message)
        for field in digest_fields:
            value = row[field]
            require(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value), message)
        observed.add(path)


def validate_receipts(component, intent, qualification, semantic, semantic_bytes, component_dir):
    require(component.get('built') is True and component.get('abi') == 'arm64-v8a', 'Component is not a built ARM64 input')
    for key in ('pin', 'forkPin', 'identity', 'abi', 'inputs', 'producerInputs', 'jniBinding', 'built'):
        require(qualification.get(key) == component.get(key), 'Qualification changes compiled field: ' + key)
    require(component.get('pin') == intent.get('SDK') and component.get('forkPin') == intent.get('native'), 'Component source intent differs')
    require(re.fullmatch(r'[0-9a-f]{40}', intent.get('source', '')), 'Compiled Alpha identity missing')
    # This checkout owns the path inventory. The carrier binds the supplied digests
    # to the original compiled receipt; canonical staging checks current source bytes.
    record = Path(__file__).resolve().parents[2] / 'android/embedding-host/qualified-host.json'
    reviewed = read_json(record)
    validate_input_inventory(component.get('inputs'), reviewed['inputs'], ('sourceSha256', 'generatedSha256'))
    validate_input_inventory(component.get('producerInputs'), reviewed['producerInputs'], ('sha256',))
    require(qualification.get('semanticReceiptSha256') == hashlib.sha256(semantic_bytes).hexdigest(), 'Semantic receipt not bound to qualification')
    require(isinstance(qualification.get('qualifiedAt'), str), 'Reviewed semantic qualification timestamp missing')
    try:
        at = datetime.datetime.fromisoformat(qualification['qualifiedAt'].replace('Z', '+00:00'))
    except (ValueError, TypeError):
        raise ValueError('Reviewed semantic qualification timestamp missing') from None
    require(at.tzinfo is not None and at <= datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5), 'Invalid qualification timestamp')
    require(semantic.get('pass') is True and semantic.get('nativeAbi') == '21' and semantic.get('dimensions') == 384,
            'Actual ARM64 semantic qualification did not pass')
    require(type(semantic.get('embeddingCalls')) is int and semantic.get('embeddingCalls') == 10 and semantic.get('callerRetirementDrained') is True
            and semantic.get('nativeKernelCancellationClaimed') is False, 'Incomplete semantic/lifecycle proof')
    norms = semantic.get('rawNorms')
    require(isinstance(norms, list) and len(norms) == 10 and all(type(x) in (int, float) and math.isfinite(x) and x > 0 for x in norms), 'Invalid embedding norms')
    for name in ('repeatCosine', 'reopenCosine', 'relatedCosine', 'unrelatedCosine'):
        value = semantic.get(name)
        require(type(value) in (int, float) and math.isfinite(value) and -1.00001 <= value <= 1.00001, 'Invalid semantic cosine')
    require(semantic['repeatCosine'] > .99999 and semantic['reopenCosine'] > .99999
            and semantic['relatedCosine'] > semantic['unrelatedCosine'] + .1, 'Semantic thresholds did not pass')
    elapsed = semantic.get('elapsedMs')
    require(type(elapsed) in (int, float) and math.isfinite(elapsed) and 0 <= elapsed <= 180000, 'Invalid semantic elapsed time')
    rows = component.get('libraries', [])
    require(len(rows) == 3 and {Path(row.get('path', '')).name for row in rows} == set(LIBRARIES), 'Incomplete component libraries')
    qualified = qualification.get('libraries', [])
    require(len(qualified) == 3, 'Incomplete qualified libraries')
    for row in rows:
        name = Path(row['path']).name
        found = [x for x in qualified if Path(x.get('path', '')).name == name]
        require(len(found) == 1, 'Duplicate/missing qualified library')
        require(found[0].get('requiredSymbols') == row.get('requiredSymbols'), 'Qualification changes required symbols')
        require(found[0].get('artifactPath', name) == name, 'Invalid artifact library mapping')
        for key in ('path', 'sha256', 'bytes', 'alignment16KiB'):
            require(found[0].get(key) == row.get(key), 'Qualification changes compiled library')
        require(row.get('alignment16KiB') is True and (component_dir / name).stat().st_size == row.get('bytes'), 'Library size/alignment mismatch')
        require(hashlib.sha256((component_dir / name).read_bytes()).hexdigest() == row.get('sha256'), 'Library digest mismatch')
    return {'compiledAlpha': intent['source'], 'compiledSDK': component['pin'], 'native': component['forkPin'],
            'qualifiedAt': qualification['qualifiedAt'], 'qualificationTransferred': False}



def carrier_environment(env):
    raw = env.get('ALPHA_EMBEDDING_CARRIER_JSON')
    if raw is None:
        return env
    require(isinstance(raw, str) and len(raw) <= 512, 'Carrier JSON exceeds bound')
    try:
        value = json.loads(raw)
    except (ValueError, TypeError):
        raise ValueError('Invalid carrier JSON') from None
    require(isinstance(value, dict) and set(value) == {'commit', 'qualification_sha256', 'semantic_sha256'}, 'Unexpected carrier JSON fields')
    require(all(isinstance(item, str) for item in value.values()), 'Carrier values must be strings')
    result = dict(env)
    result.update(ALPHA_EMBEDDING_CARRIER_COMMIT=value['commit'],
                  ALPHA_EMBEDDING_QUALIFICATION_FILE_SHA256=value['qualification_sha256'],
                  ALPHA_EMBEDDING_SEMANTIC_FILE_SHA256=value['semantic_sha256'])
    return result


def carrier_settings(env):
    require(re.fullmatch(r'[0-9a-f]{40}', env.get('ALPHA_EMBEDDING_CARRIER_COMMIT', '')), 'Exact carrier commit required')
    identity = env.get('ALPHA_EMBEDDING_COMPONENT_ARTIFACT_ID', '')
    digest = env.get('ALPHA_EMBEDDING_COMPONENT_SHA256', '')
    require(re.fullmatch(r'[1-9][0-9]{0,19}', identity) and re.fullmatch(r'[0-9a-f]{64}', digest), 'Exact component artifact required')
    for name in ('ALPHA_EMBEDDING_QUALIFICATION_FILE_SHA256', 'ALPHA_EMBEDDING_SEMANTIC_FILE_SHA256'):
        require(re.fullmatch(r'[0-9a-f]{64}', env.get(name, '')), 'Exact carrier file hashes required')
    return identity, digest


def validate_carrier_schema(qualification, semantic):
    # Nothing else from the local machine, account, harness preimages or history is published.
    allowed = {'pin', 'forkPin', 'identity', 'abi', 'inputs', 'producerInputs', 'jniBinding',
               'built', 'libraries', 'qualifiedAt', 'semanticReceiptSha256'}
    require(set(qualification) <= allowed, 'Carrier contains unapproved qualification fields')
    allowed_report = {'pass', 'nativeAbi', 'dimensions', 'embeddingCalls', 'rawNorms', 'repeatCosine',
                      'reopenCosine', 'relatedCosine', 'unrelatedCosine', 'callerRetirementDrained',
                      'nativeKernelCancellationClaimed', 'elapsedMs'}
    require(set(semantic) <= allowed_report, 'Carrier contains unapproved semantic fields')
    for row in qualification.get('inputs', []):
        require(set(row) == {'path', 'sourceSha256', 'generatedSha256'}, 'Unapproved native input fields')
    for row in qualification.get('producerInputs', []):
        require(set(row) == {'path', 'sha256'}, 'Unapproved producer input fields')
    for row in qualification.get('libraries', []):
        require(set(row) <= {'path', 'sha256', 'bytes', 'alignment16KiB', 'requiredSymbols', 'artifactPath'},
                'Unapproved library fields')


def read_carrier_bytes(root, name, expected):
    require(root.is_dir() and not root.is_symlink() and not root.parent.is_symlink(), 'Carrier directory is not regular')
    require(root.resolve().is_relative_to(Path.cwd().resolve()), 'Carrier escaped workspace')
    file = root / name
    require(file.is_file() and not file.is_symlink() and file.stat().st_size <= 2 * 1024 * 1024, 'Carrier file is not bounded and regular')
    data = file.read_bytes()
    require(hashlib.sha256(data).hexdigest() == expected, 'Carrier file hash mismatch')
    return data


def prepare_carrier(env):
    env = carrier_environment(env)
    identity, digest = carrier_settings(env)
    require(canonical_repository(env) and env.get('GH_TOKEN'), 'Canonical artifact access required')
    work = Path('test-results/embedding-carrier-inputs')
    work.mkdir(mode=0o700, parents=True, exist_ok=False)
    opener = urllib.request.build_opener(NoRedirect())
    download(identity, digest, work / 'component.zip', env['GH_TOKEN'], opener)
    extract_selected(work / 'component.zip', work / 'component', {
        'component-output/export/PREPARATION.json': 'PREPARATION.json',
        'component-output/INTENT.json': 'INTENT.json',
        **{'component-output/export/' + name: name for name in LIBRARIES}})
    checked = subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', 'qualification-carrier', 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=10)
    require(checked.returncode == 0 and checked.stdout.strip() == env['ALPHA_EMBEDDING_CARRIER_COMMIT'], 'Carrier checkout identity differs')
    root = Path('qualification-carrier/embedding-qualification')
    qualification_bytes = read_carrier_bytes(root, 'QUALIFICATION.json', env['ALPHA_EMBEDDING_QUALIFICATION_FILE_SHA256'])
    semantic_bytes = read_carrier_bytes(root, 'embedding-qualification.json', env['ALPHA_EMBEDDING_SEMANTIC_FILE_SHA256'])
    qualification, semantic = json.loads(qualification_bytes), json.loads(semantic_bytes)
    validate_carrier_schema(qualification, semantic)
    validate_receipts(read_json(work / 'component/PREPARATION.json'), read_json(work / 'component/INTENT.json'),
                      qualification, semantic, semantic_bytes, work / 'component')
    output = Path('test-results/embedding-qualified-carrier')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    (output / 'QUALIFICATION.json').write_bytes(qualification_bytes)
    (output / 'embedding-qualification.json').write_bytes(semantic_bytes)
    print('Prepared only the two hash-verified public-corpus qualification files for artifact upload')

def main(args, env=os.environ):
    if args == ['--check-carrier-inputs']:
        carrier_settings(carrier_environment(env))
        print('Exact carrier commit and file inputs valid')
        return
    if args == ['--prepare-carrier']:
        prepare_carrier(env)
        return
    inputs = settings(env)
    if args == ['--check-inputs']:
        print('Embedding artifact inputs valid' if inputs else 'Local embeddings not requested')
        return
    require(args == [], 'Unknown embedding artifact option')
    if not inputs:
        return
    require(canonical_repository(env), 'Canonical repository required')
    token = env.get('GH_TOKEN')
    require(token, 'Artifact access token unavailable')
    output = Path('test-results/resident-ci/embedding-inputs')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    opener = urllib.request.build_opener(NoRedirect())
    records = []
    for name, (identity, digest) in zip(('component', 'qualification'), inputs):
        records.append(download(identity, digest, output / (name + '.zip'), token, opener))
    extract_selected(output / 'component.zip', output / 'component', {
        'component-output/export/PREPARATION.json': 'PREPARATION.json',
        'component-output/INTENT.json': 'INTENT.json',
        **{'component-output/export/' + name: name for name in LIBRARIES}})
    extract_selected(output / 'qualification.zip', output / 'qualification', {
        'QUALIFICATION.json': 'QUALIFICATION.json', 'embedding-qualification.json': 'embedding-qualification.json'})
    component = read_json(output / 'component/PREPARATION.json')
    intent = read_json(output / 'component/INTENT.json')
    qualification = read_json(output / 'qualification/QUALIFICATION.json')
    semantic_path = output / 'qualification/embedding-qualification.json'
    identity = validate_receipts(component, intent, qualification, read_json(semantic_path), semantic_path.read_bytes(), output / 'component')
    (output / 'ADMISSION.json').write_text(json.dumps({'state': 'PINNED_INPUTS_VERIFIED_PENDING_CANONICAL_STAGE',
        **identity, 'artifacts': records, 'consumer': env.get('GITHUB_SHA'), 'sourceReceiptsUnmodified': True}, indent=2) + '\n')
    print('Verified compiled component and bound semantic qualification; canonical staging remains required')


if __name__ == '__main__':
    main(sys.argv[1:])
