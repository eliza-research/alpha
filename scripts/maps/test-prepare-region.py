#!/usr/bin/env python3
"""Pinned-asset and atomic tile-output checks for prepare-region.py, with no network or Java."""
import hashlib, importlib.util, pathlib, sqlite3, subprocess, tempfile

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('prepare_region', HERE / 'prepare-region.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)

def refuses(action, text):
    try:
        action()
    except RuntimeError as error:
        assert text in str(error), error
        return
    raise AssertionError('expected a refusal: ' + text)

def offline(*args, **kwargs):
    raise AssertionError('no download expected')
prepare.urllib.request.urlopen = offline

with tempfile.TemporaryDirectory(prefix='alpha-maps-prepare-') as directory:
    root = pathlib.Path(directory)
    body = b'pinned fixture'
    good = hashlib.sha256(body).hexdigest()
    (root / 'planetiler.jar').write_bytes(body)
    prepare.fetch(root, 'planetiler.jar', 'https://example.invalid/planetiler.jar', good, len(body))
    (root / 'planetiler.jar').write_bytes(b'tampered fixtur')
    refuses(lambda: prepare.fetch(root, 'planetiler.jar', 'https://example.invalid/planetiler.jar', good, len(body)), 'does not match its pinned sha256/size')
    assert all(len(sha256) == 64 and size > 0 for _, sha256, size in prepare.assets.values())

    partial = root / 'monaco.partial.mbtiles'
    partial.write_bytes(b'interrupted run')
    def killed(command, **kwargs):
        assert '--download' not in command and '--output=' + str(partial) in command
        assert not partial.exists(), 'stale partial output was not removed'
        partial.write_bytes(b'half written')
        raise subprocess.TimeoutExpired(command, 600)
    try:
        prepare.tiles(root, killed)
        raise AssertionError('timeout should propagate')
    except subprocess.TimeoutExpired:
        pass
    assert not (root / 'monaco.mbtiles').exists() and not partial.exists()

    def finished(command, **kwargs):
        with sqlite3.connect(partial) as db:
            db.execute('CREATE TABLE tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB)')
            db.execute("INSERT INTO tiles VALUES(0,0,0,x'00')")
    prepare.tiles(root, finished)
    assert (root / 'monaco.mbtiles').exists() and not partial.exists()
print('PASS: pinned assets refuse tampering; tile output is renamed only after success')
