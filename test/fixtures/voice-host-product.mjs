import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT, VOICE_HOST} from '../../scripts/generate-licenses.mjs';
import {VOICE_ASR_SLOT} from '../../scripts/voice-host.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');

/** A product root with a fixture record, fixture bundle bytes and the shared inputs it must match. */
export function fixtureProduct(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-voice-stage-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const from = path.join(dir, 'from');
  const record = JSON.parse(fs.readFileSync(path.join(ROOT, VOICE_HOST), 'utf8'));
  // These temporary files are synthetic, including their source identities. Keep
  // the fixture internally consistent without relabeling any real artifact. The
  // separate committed-record test above still enforces the actual product pin.
  record.pin = '1'.repeat(40);
  record.forkPin = '2'.repeat(40);
  const write = (relative, content) => { fs.mkdirSync(path.dirname(path.join(from, relative)), {recursive: true}); fs.writeFileSync(path.join(from, relative), content); return {sha256: sha(content), bytes: Buffer.byteLength(content)}; };
  for (const model of record.models) Object.assign(model, write(model.sourceFile ? path.join(path.dirname(model.path), model.sourceFile) : model.path, `fixture ${model.path}`));
  for (const abi of record.abis) for (const library of abi.libraries)
    Object.assign(library, write(`jniLibs/${abi.abi}/${library.name}`, `${library.name} ${abi.abi}`));
  const inputs = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor/eliza/plugins/plugin-local-inference/native/android/inputs.json'), 'utf8'));
  for (const key of ['paradee', 'lexicon']) { const row = record.models.find(model => model.path === inputs[key].path); inputs[key] = {...inputs[key], sha256: row.sha256, bytes: row.bytes}; }
  fs.mkdirSync(path.join(dir, 'vendor/eliza/plugins/plugin-local-inference/native/android'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'vendor/eliza/plugins/plugin-local-inference/native/android/inputs.json'), JSON.stringify(inputs, null, 2));
  fs.mkdirSync(path.join(dir, 'android/voice-host'), {recursive: true});fs.mkdirSync(path.join(dir, 'android/paradee-voice'), {recursive: true});
  fs.writeFileSync(path.join(dir, VOICE_HOST), JSON.stringify(record, null, 2));
  fs.writeFileSync(path.join(dir, VOICE_ASR_SLOT), JSON.stringify({backend: record.asrSlot.backend, files: record.models.filter(model => model.role.startsWith('asr-')).map(({path: file, role, sha256, bytes}) => ({path: file, role, sha256, bytes}))}));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'upstream.lock.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'upstream.lock.json'), JSON.stringify({...lock, commit: record.pin}));
  fs.copyFileSync(path.join(ROOT, 'app.config.json'), path.join(dir, 'app.config.json'));
  return {dir, from, record};
}
