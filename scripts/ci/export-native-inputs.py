"""Prepare a local handoff packet from already reviewed native inputs."""
import argparse
from contextlib import contextmanager, nullcontext
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import uuid
import zipfile

# Local export must not populate a bytecode cache outside the selected output.
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('hosted_native_inputs', Path(__file__).with_name('hosted-native-inputs.py'))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
embedding = native.embedding
require = native.require

PACKET = 'alpha-native-inputs.zip'
RECEIPT = 'packet.json'
RECEIPT_LIMIT = 2 * 1024 * 1024
RECORD_LIMIT = 1024 * 1024
DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
CHUNK = 1024 * 1024


def git(root, *args):
    env = {**os.environ, 'GIT_NO_LAZY_FETCH': '1', 'GIT_ALLOW_PROTOCOL': '', 'GIT_NO_REPLACE_OBJECTS': '1'}
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', *args], cwd=root, env=env, timeout=15)


@contextmanager
def walk_directory(start, parts, excluded=None):
    fd = os.dup(start)
    try:
        for part in parts:
            child = os.open(part, DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = child
            if excluded is not None:
                info = os.fstat(fd)
                require((info.st_dev, info.st_ino) != excluded, 'Output must be outside vendor')
        yield fd
    finally:
        os.close(fd)


@contextmanager
def directory(path, excluded=None):
    parts = Path(os.path.abspath(path)).parts
    root = os.open(parts[0], DIRECTORY)
    try:
        with walk_directory(root, parts[1:], excluded) as fd:
            yield fd
    finally:
        os.close(root)


def stream_fact(stream, size, name, destination=None):
    remaining = size
    digest = hashlib.sha256()
    while chunk := stream.read(min(CHUNK, remaining + 1)):
        remaining -= len(chunk)
        require(remaining >= 0, f'Input size changed: {name}')
        digest.update(chunk)
        if destination is not None:
            destination.write(chunk)
    require(remaining == 0, f'Input size changed: {name}')
    return {'bytes': size, 'sha256': digest.hexdigest()}


def file_identity(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


@contextmanager
def regular_input(root_fd, name, limit):
    path = PurePosixPath(name)
    with walk_directory(root_fd, path.parts[:-1]) as parent:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    with os.fdopen(fd, 'rb') as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and 0 < before.st_size <= limit,
                f'Input is not a bounded regular file: {name}')
        yield source, before.st_size
        require(file_identity(os.fstat(source.fileno())) == file_identity(before), f'Input changed while copying: {name}')


def record_bytes(root, name):
    with directory(root) as fd, regular_input(fd, name, RECORD_LIMIT) as (source, size):
        data = source.read(size + 1)
        require(len(data) == size, f'Input size changed: {name}')
        return data


def pack_member(archive, root_fd, name, member, limit):
    with regular_input(root_fd, name, limit) as (source, size):
        entry = zipfile.ZipInfo(member)
        entry.file_size = size
        entry.create_system = 3
        entry.external_attr = (stat.S_IFREG | 0o600) << 16
        with archive.open(entry, 'w') as destination:
            return stream_fact(source, size, name, destination)


def pack_inputs(archive, voice, component, qualification, inventory, reviewed):
    files = {}
    with directory(voice) as fd:
        for name, expected in sorted(inventory.items()):
            member = f'voice/{name}'
            actual = pack_member(archive, fd, name, member, expected['bytes'])
            require(actual == expected, f'Voice artifact digest or size differs: {name}')
            files[member] = actual

    libraries = {row['name']: row for row in reviewed['libraries']}
    with directory(component) as fd:
        for name, leaf in sorted(native.COMPONENT_MEMBERS.items()):
            member = f'embedding-component/{name}'
            expected = libraries.get(leaf)
            actual = pack_member(archive, fd, name, member, expected['bytes'] if expected else RECEIPT_LIMIT)
            if expected:
                require(actual == {key: expected[key] for key in ('bytes', 'sha256')},
                        f'Embedding library digest or size differs: {leaf}')
            files[member] = actual

    with directory(qualification) as fd:
        for name in native.QUALIFICATION_MEMBERS:
            member = f'embedding-qualification/{name}'
            files[member] = pack_member(archive, fd, name, member, RECEIPT_LIMIT)
    return files


def verify_packet(archive, files, receipt_bytes, reviewed, stage_file=None):
    names = archive.namelist()
    require(len(names) == len(files) + 1 and set(names) == {*files, RECEIPT}, 'Packet inventory differs')
    require(archive.getinfo(RECEIPT).file_size == len(receipt_bytes) and archive.read(RECEIPT) == receipt_bytes,
            'Copied packet receipt differs')
    for name, fact in files.items():
        require(archive.getinfo(name).file_size == fact['bytes'], f'Copied packet member size differs: {name}')
        with archive.open(name) as source, (stage_file(name) if stage_file else nullcontext()) as destination:
            require(stream_fact(source, fact['bytes'], name, destination) == fact, f'Copied packet member differs: {name}')

    def copied_json(name):
        raw = archive.read(name)
        value = json.loads(raw)
        require(isinstance(value, dict), f'Expected an object in {name}')
        return value, raw

    component_prefix = 'embedding-component/component-output'
    component, _ = copied_json(component_prefix + '/export/PREPARATION.json')
    intent, _ = copied_json(component_prefix + '/INTENT.json')
    qualification, _ = copied_json('embedding-qualification/QUALIFICATION.json')
    semantic, semantic_bytes = copied_json('embedding-qualification/embedding-qualification.json')
    embedding.validate_carrier_schema(qualification, semantic)
    native.verify_component(component, reviewed)

    def library_digest(name, size):
        fact = files[f'{component_prefix}/export/{name}']
        require(fact['bytes'] == size, 'Library size/alignment mismatch')
        return fact['sha256']

    embedding.validate_receipt_contents(component, intent, qualification, semantic, semantic_bytes,
                                        reviewed, library_digest)


def committed_inputs(root):
    require(Path(os.fsdecode(git(root, 'rev-parse', '--show-toplevel').rstrip())) == root,
            'Expected the Alpha product checkout root')
    source = git(root, 'rev-parse', 'HEAD').decode().strip()
    require(native.matches(native.COMMIT, source), 'Exact committed Alpha source required')
    records = {}

    def committed_record(checkout, name):
        raw = record_bytes(checkout, name)
        object_name = f'{source}:{name}'
        require(int(git(checkout, 'cat-file', '-s', object_name)) == len(raw) and
                git(checkout, 'cat-file', 'blob', object_name) == raw,
                f'{name} differs from committed Alpha source')
        value = json.loads(raw)
        require(isinstance(value, dict), f'Expected an object in {name}')
        digest = hashlib.sha256(raw).hexdigest()
        records[name] = digest
        return value, digest

    identity, reviewed, inventory = native.reviewed_inputs(root, committed_record)
    gitlink = f"160000 commit {identity['sdkCommit']}\tvendor/eliza"
    require(git(root, 'ls-tree', source, '--', 'vendor/eliza').decode().rstrip('\n') == gitlink,
            'SDK lock differs from the committed vendor pin')
    return source, identity, reviewed, inventory, records


def require_current_inputs(root, source, records):
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == source and
            all(hashlib.sha256(record_bytes(root, name)).hexdigest() == digest
                for name, digest in records.items()), 'Alpha source or reviewed records changed')


def export_packet(root, voice, component, qualification, output):
    root = root.resolve()
    source, identity, reviewed, inventory, records = committed_inputs(root)
    output = Path(os.path.abspath(output))
    vendor = root / 'vendor'
    require(not output.is_relative_to(vendor), 'Output must be outside vendor')
    excluded = None
    if vendor.exists():
        info = vendor.stat()
        excluded = (info.st_dev, info.st_ino)
    with directory(output, excluded) as out_fd:
        info = os.fstat(out_fd)
        require(info.st_uid == os.geteuid() and not info.st_mode & (stat.S_IWGRP | stat.S_IWOTH),
                'Output directory must be owned by the exporter and writable only by its owner')
        pending = '.' + PACKET + '-' + uuid.uuid4().hex
        fd = os.open(pending, os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW, 0o600, dir_fd=out_fd)
        try:
            with os.fdopen(fd, 'w+b') as file:
                with zipfile.ZipFile(file, 'w') as archive:
                    files = pack_inputs(archive, voice, component, qualification, inventory, reviewed)
                    receipt = {'schema': 'alpha-native-input-handoff/v1', 'sourceCommit': source, **identity,
                               'recordSha256': records, 'files': files}
                    receipt_bytes = (json.dumps(receipt, sort_keys=True, indent=2) + '\n').encode()
                    archive.writestr(RECEIPT, receipt_bytes)
                file.flush()
                with zipfile.ZipFile(file) as archive:
                    verify_packet(archive, files, receipt_bytes, reviewed)
                require_current_inputs(root, source, records)
                os.fsync(file.fileno())
                require(file_identity(os.stat(pending, dir_fd=out_fd, follow_symlinks=False)) ==
                        file_identity(os.fstat(file.fileno())), 'Verified pending packet was replaced')
                os.link(pending, PACKET, src_dir_fd=out_fd, dst_dir_fd=out_fd, follow_symlinks=False)
        finally:
            os.unlink(pending, dir_fd=out_fd)
    return output / PACKET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--voice', required=True, type=Path, help='Staged voice root containing assets/ and jniLibs/')
    parser.add_argument('--embedding-component', required=True, type=Path, help='Directory containing component-output/')
    parser.add_argument('--embedding-qualification', required=True, type=Path, help='Directory containing both reviewed qualification files')
    parser.add_argument('--out', required=True, type=Path, help='Existing physical directory for the new packet')
    args = parser.parse_args()
    try:
        packet = export_packet(native.ROOT, args.voice, args.embedding_component, args.embedding_qualification, args.out)
    except (OSError, KeyError, TypeError, ValueError, subprocess.SubprocessError, zipfile.BadZipFile) as failure:
        parser.exit(1, f'Native input packet refused: {failure}\n')
    print(f'Created local handoff packet {packet}')


if __name__ == '__main__':
    main()
