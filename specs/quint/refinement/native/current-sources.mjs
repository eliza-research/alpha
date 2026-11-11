import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {preparePatchedNative} from '../../../../scripts/prepare-patched-native.mjs';
import {app, root} from './java.mjs';

const staged = preparePatchedNative();
const aliases = {
  PhotoAttachmentSource: 'SelectedPhotoCopy', NativeVoiceIpc: 'BufferedStreamExchange',
  AlphaListeningPolicy: 'SenseListeningPolicy', AlphaListeningLease: 'SenseListeningLease',
};
const sense = 'vendor/eliza/packages/app/platforms/android/sense/src/main/java/ai/eliza/sense/';
const systemui = 'vendor/eliza/packages/os/android/sense/systemui/chip/source/';
const direct = Object.fromEntries(['IndicatorLease', 'ListenerPolicy', 'CrashLoopBreaker', 'ListeningEpoch', 'ListenerStore']
  .map(name => [name, sense + name + '.java']));
Object.assign(direct, Object.fromEntries(['SenseListeningPolicy', 'SenseListeningLease']
  .map(name => [name, systemui + name + '.java'])));
direct.SmsSendJournal = 'vendor/eliza/plugins/plugin-native-messages/android/src/main/java/ai/eliza/plugins/messages/SmsSendJournal.java';

export function currentNativeSource(name) {
  const base = name.replace(/\.java$/, '');
  const resolved = aliases[base] || base;
  if (direct[resolved]) return direct[resolved];
  const matches = Object.keys(staged.files).filter(path => path.endsWith('/' + resolved + '.java'));
  if (matches.length === 1) return join(staged.root, matches[0]);
  try { readFileSync(join(root, app, name)); return app + name; } catch {}
  for (const area of ['runtime','connection']) {const path = 'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/'+area+'/'+resolved+'.java'; if(existsSync(join(root,path)))return path;}
  throw Error(`Current native source is ambiguous or absent: ${name} (${matches.join(',')})`);
}

export const nativePatchInputs = ['android/upstream-native-sources.json', 'scripts/prepare-patched-native.mjs',
  join(staged.root, '.source.json'),
  ...JSON.parse(readFileSync(join(root, 'android/upstream-native-sources.json'), 'utf8')).patches.map(row => 'patches/eliza/' + row.file)];
