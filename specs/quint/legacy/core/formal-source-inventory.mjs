import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Authenticate a complete formal-source snapshot at its own immutable revision.
 * Historical translations do not imply coverage of specifications at a later pin.
 */
export function authenticateFormalSources(directory, revision, models, registered) {
  assert.match(revision, /^[a-f0-9]{40}$/, 'Formal sources need an explicit Git revision');
  assert.ok(Array.isArray(models), 'Formal sources need a model allocation');
  const files = models.flatMap(model => {
    assert.ok(registered.has(model.quintModule), `Register the Quint translation of ${model.source}`);
    assert.ok(/\.tla$/i.test(model.source), 'A formal module must name its TLA source');
    assert.ok(Array.isArray(model.configs), 'A formal module must inventory its TLC configurations');
    assert.ok(model.configs.every(config => /\.cfg$/i.test(config.path)), 'TLC sources must be configurations');
    return [{path: model.source, sha256: model.sha256}, ...model.configs];
  });
  assert.equal(new Set(files.map(file => file.path)).size, files.length, 'Formal source paths must be unique');
  for (const file of files) {
    assert.ok(file.path.split('/').every(part => part && part !== '.' && part !== '..'), 'Formal source paths must stay within the repository');
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
  }
  const git = args => execFileSync('git', ['-C', directory, ...args], {maxBuffer: 16 * 1024 * 1024});
  const tracked = git(['ls-tree', '-r', '--name-only', '-z', revision]).toString('utf8')
    .split('\0').filter(path => /\.(tla|cfg)$/i.test(path)).sort();
  assert.deepEqual(tracked, files.map(file => file.path).sort(), `Unallocated or removed formal sources at ${revision}`);
  for (const file of files) {
    const bytes = git(['cat-file', 'blob', `${revision}:${file.path}`]);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
  }
  return files;
}

/** Keep original specification bytes outside vendor while current runtime source stays live. */
export function materializeHistoricalFormalSources(root, sources) {
  return materializeHistoricalSources(root,sources,'specs/quint/legacy/core/source-inventory.json');
}

/** Bind a separate historical runtime witness to its own reviewed source inventory. */
export function materializeHistoricalSources(root, sources, inventoryName) {
  root = resolve(root);
  const inventoryPath = resolve(root, inventoryName);
  const inventory = JSON.parse(readFileSync(inventoryPath));
  const revision = inventory.revision;
  assert.match(revision, /^[a-f0-9]{40}$/);
  const expected = new Map([
    ...(inventory.models ?? []).flatMap(model => [{path:model.source,sha256:model.sha256}, ...model.configs]),
    ...(inventory.historicalArtifacts ?? []),
  ].map(file => [file.path, file.sha256]));
  const vendor = join(root, 'vendor/eliza'), mappings = new Map();
  const prefix = join(root, '.eliza/quint-historical', revision);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  function publish(file, bytes) {
    for (let parent=dirname(file); parent!==root; parent=dirname(parent)) {
      if (existsSync(parent)) assert.ok(lstatSync(parent).isDirectory() && !lstatSync(parent).isSymbolicLink(), 'Linked historical-source cache');
    }
    if (existsSync(file)) {
      assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Nonregular historical-source cache');
      if (readFileSync(file).equals(bytes)) return;
    }
    mkdirSync(dirname(file), {recursive:true});
    const temporary = file+'.'+randomUUID();
    try {writeFileSync(temporary, bytes, {flag:'wx'});renameSync(temporary,file);}
    finally {rmSync(temporary,{force:true});}
  }
  for (const source of sources) {
    const original = resolve(root, source), name = relative(vendor, original).split(sep).join('/');
    if (isAbsolute(name) || name.startsWith('../') || !expected.has(name)) continue;
    assert.ok(name.split('/').every(part=>part && part!=='.' && part!=='..'));
    const bytes = execFileSync('git', ['-C', vendor, 'cat-file', 'blob', `${revision}:${name}`]);
    assert.equal(digest(bytes), expected.get(name), `Historical specification differs at ${revision}:${name}`);
    const destination = join(prefix,name);
    publish(destination,bytes);
    mappings.set(original,destination);
  }
  const resolveSource = source => mappings.get(resolve(root,source)) ?? source;
  const inputs = sources.map(resolveSource);
  inputs.push(inventoryPath,fileURLToPath(import.meta.url));
  let manifest;
  if (mappings.size) {
    manifest = join(prefix,'.source-'+digest(relative(root,inventoryPath)).slice(0,12)+'.json');
    publish(manifest,Buffer.from(JSON.stringify({schema:1,revision,inventory:relative(root,inventoryPath),files:Object.fromEntries([...expected].sort())})+'\n'));
    inputs.push(manifest);
  }
  return {sources:[...new Set(inputs)],resolveSource,revision,manifest};
}
