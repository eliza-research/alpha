"""Verify an exact local native input packet and stage its three upload trees."""
import argparse
from contextlib import ExitStack, contextmanager
import ctypes
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import struct
import subprocess
import sys
import uuid
import zipfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('export_native_inputs', Path(__file__).with_name('export-native-inputs.py'))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)
native = exporter.native
require = exporter.require

ZIP_END = struct.Struct('<4s4H2LH')


def authorized_members(inventory, reviewed):
    pinned = {'voice/' + name: fact for name, fact in inventory.items()}
    libraries = {row['name']: row for row in reviewed['libraries']}
    for name, leaf in native.COMPONENT_MEMBERS.items():
        row = libraries.get(leaf)
        pinned['embedding-component/' + name] = {key: row[key] for key in ('bytes', 'sha256')} if row else None
    for name in native.QUALIFICATION_MEMBERS:
        pinned['embedding-qualification/' + name] = None
    limits = {name: fact['bytes'] if fact else exporter.RECEIPT_LIMIT for name, fact in pinned.items()}
    limits[exporter.RECEIPT] = exporter.RECEIPT_LIMIT
    return pinned, limits


def check_zip_envelope(source, size, names):
    # The exporter writes a single-disk ZIP with no comment or extended headers.
    # Check the central directory bound before ZipFile allocates and parses it.
    require(size >= ZIP_END.size, 'Invalid native input packet ZIP')
    source.seek(size - ZIP_END.size)
    end = source.read(ZIP_END.size)
    require(len(end) == ZIP_END.size, 'Invalid native input packet ZIP')
    signature, disk, directory_disk, disk_entries, entries, directory_size, offset, comment_size = ZIP_END.unpack(end)
    maximum = sum(46 + len(name.encode()) for name in names)
    require(signature == b'PK\x05\x06' and disk == directory_disk == comment_size == 0 and
            disk_entries == entries == len(names) and 0 < directory_size <= maximum and
            offset + directory_size + ZIP_END.size == size, 'Invalid native input packet ZIP directory')
    source.seek(0)


def packet_receipt(archive, limits, pinned, identity, records):
    entries = archive.infolist()
    require(len(entries) == len(limits) and {entry.filename for entry in entries} == limits.keys(),
            'Packet inventory differs from reviewed inputs')
    for entry in entries:
        require(entry.orig_filename == entry.filename and not entry.is_dir() and not entry.external_attr & 0x10 and
                stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG) and
                not entry.flag_bits & 1 and entry.compress_type == zipfile.ZIP_STORED and
                0 < entry.file_size == entry.compress_size <= limits[entry.filename],
                f'Invalid packet member type or size: {entry.filename}')

    def unique_pairs(pairs):
        fields = dict(pairs)
        require(len(fields) == len(pairs), 'Duplicate packet receipt field')
        return fields

    raw = archive.read(exporter.RECEIPT)
    receipt = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_pairs)
    require(isinstance(receipt, dict) and set(receipt) == {'schema', 'sourceCommit', 'recordSha256', 'files', *identity}
            and receipt['schema'] == 'alpha-native-input-handoff/v1'
            and native.matches(native.COMMIT, receipt['sourceCommit']), 'Invalid packet receipt')
    require(all(receipt[name] == value for name, value in identity.items()) and receipt['recordSha256'] == records,
            'Packet receipt differs from committed native input records')
    files = receipt['files']
    require(isinstance(files, dict) and files.keys() == pinned.keys(), 'Packet receipt inventory differs')
    for name, expected in pinned.items():
        fact = files[name]
        require(isinstance(fact, dict) and set(fact) == {'bytes', 'sha256'} and
                type(fact['bytes']) is int and fact['bytes'] == archive.getinfo(name).file_size and
                native.matches(native.SHA256, fact['sha256']) and (expected is None or fact == expected),
                f'Packet receipt differs from reviewed member: {name}')
    return raw, files


@contextmanager
def staged_file(root_fd, name):
    path = PurePosixPath(name)
    with ExitStack() as stack:
        parent = root_fd
        for part in path.parts[:-1]:
            try:
                os.mkdir(part, 0o700, dir_fd=parent)
            except FileExistsError:
                pass
            parent = stack.enter_context(exporter.walk_directory(parent, (part,)))
        fd = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        with os.fdopen(fd, 'wb') as destination:
            yield destination


def publish_directory(parent_fd, temporary, name):
    # Plain rename can replace an existing empty directory.
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        rename, flag = getattr(libc, 'renameatx_np', None), 0x00000004  # RENAME_EXCL
    elif sys.platform.startswith('linux'):
        rename, flag = getattr(libc, 'renameat2', None), 1  # Linux RENAME_NOREPLACE
    else:
        raise ValueError('Exclusive directory publication is unavailable on this host')
    require(rename is not None, 'Exclusive directory publication is unavailable on this host')
    rename.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    rename.restype = ctypes.c_int
    if rename(parent_fd, os.fsencode(temporary), parent_fd, os.fsencode(name), flag) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), name)


def stage_packet(root: Path, packet: Path, expected_sha256: str, output: Path) -> Path:
    require(native.matches(native.SHA256, expected_sha256), 'Exact packet SHA-256 required')
    root = root.resolve()
    source, identity, reviewed, inventory, records = exporter.committed_inputs(root)
    pinned, limits = authorized_members(inventory, reviewed)
    # Exact expanded file bounds plus ZIP headers and framing.
    maximum = sum(limits.values()) + sum(76 + 2 * len(name.encode()) for name in limits) + ZIP_END.size
    packet, output = Path(os.path.abspath(packet)), Path(os.path.abspath(output))
    vendor = root / 'vendor'
    require(output.name and not output.is_relative_to(vendor), 'Output must be outside vendor')
    excluded = None
    if vendor.exists():
        info = vendor.stat()
        excluded = info.st_dev, info.st_ino

    with exporter.directory(output.parent, excluded) as parent:
        info = os.fstat(parent)
        require(info.st_uid == os.geteuid() and not info.st_mode & (stat.S_IWGRP | stat.S_IWOTH),
                'Output parent must be owned and writable only by the current user')
        try:
            os.stat(output.name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise FileExistsError(f'Output already exists: {output}')
        temporary = '.alpha-native-inputs-' + uuid.uuid4().hex
        os.mkdir(temporary, 0o700, dir_fd=parent)
        created = os.stat(temporary, dir_fd=parent, follow_symlinks=False)
        published = False
        try:
            with exporter.walk_directory(parent, (temporary,)) as pending:
                require(os.path.samestat(created, os.fstat(pending)), 'Staging directory was replaced')
                with exporter.directory(packet.parent) as packet_parent, \
                        exporter.regular_input(packet_parent, packet.name, maximum) as (stream, size):
                    require(exporter.stream_fact(stream, size, 'native input packet')['sha256'] == expected_sha256,
                            'Native input packet SHA-256 differs')
                    check_zip_envelope(stream, size, limits)
                    with zipfile.ZipFile(stream) as archive:
                        receipt, files = packet_receipt(archive, limits, pinned, identity, records)
                        exporter.verify_packet(archive, files, receipt, reviewed, lambda name: staged_file(pending, name))
                with staged_file(pending, exporter.RECEIPT) as destination:
                    destination.write(receipt)
                exporter.require_current_inputs(root, source, records)
                visible = os.stat(temporary, dir_fd=parent, follow_symlinks=False)
                require(os.path.samestat(visible, created), 'Verified staging directory was replaced')
                publish_directory(parent, temporary, output.name)
                published = True
        finally:
            if not published:
                try:
                    visible = os.stat(temporary, dir_fd=parent, follow_symlinks=False)
                except FileNotFoundError:
                    pass
                else:
                    if os.path.samestat(visible, created):
                        shutil.rmtree(temporary, dir_fd=parent)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--packet', required=True, type=Path)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    try:
        output = stage_packet(native.ROOT, args.packet, args.sha256, args.out)
    except (OSError, KeyError, TypeError, ValueError, subprocess.SubprocessError, zipfile.BadZipFile) as failure:
        parser.exit(1, f'Native input packet refused: {failure}\n')
    print(f'Staged verified native input packet in {output}')


if __name__ == '__main__':
    main()
