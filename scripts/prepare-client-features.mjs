import { createHash } from 'node:crypto';
import { upstreamNativeSource } from './upstream-native-source.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function regularPath(filename, directory = false) {
  try {
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) throw Error('Nonregular client feature path: ' + filename);
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function inventory(directory) {
  const files = {};
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw Error('Symlink in client feature source: ' + file);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files[path.relative(directory, file)] = hash(fs.readFileSync(file));
      else throw Error('Nonregular client feature source: ' + file);
    }
  }
  visit(directory);
  return files;
}
function matches(actual, expected) {
  return JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(Object.keys(expected).sort()) &&
    Object.entries(expected).every(([file, digest]) => actual[file] === digest);
}
export const CLIENT_FEATURE_PATHS = [
  'packages/contracts/src/calendar-linked-sync.ts',
  'packages/ui/src/voice/batch-conversation.ts',
  'packages/ui/src/voice/voice-session-client.ts',
  'packages/ui/src/voice/voice-session-protocol.ts',
  'packages/ui/src/voice/voice-session-state.ts',
  'packages/ui/src/voice/voice-session-ownership.ts',
  'packages/ui/src/voice/voice-session-client-core.ts',
  'packages/ui/src/voice/voice-session-status.ts',
  'packages/host/src/voice',
  'packages/core/src/logging.ts',
  'packages/core/src/view-interaction.ts',
  'packages/contracts/src/sms-send.ts',
  'plugins/plugin-workflow/src/services/hosted-digest-policy.ts',
  'packages/ui/src/voice/voice-session-mic-capture.ts',
  'packages/ui/src/voice/voice-session-playback.ts',
  'packages/ui/src/voice/voice-session-pcm.ts',
  'packages/ui/src/voice/browser-audio-runtime.ts',
  'packages/ui/src/voice/audio-worklet-module-urls.ts',
  'packages/ui/src/voice/worklets',
  'packages/ui/src/logger.ts',
  'packages/ui/src/voice/voice-chat-types.ts',
  'packages/core/src/logger.ts',
  'packages/core/src/security/log-redaction.ts',
  'packages/host/src/voice.ts',

  'packages/ui/src/voice/voice-activity.ts',
  'packages/ui/src/voice/tts-playback-activity.ts',
  'packages/ui/src/voice/end-of-turn.ts',
  'packages/ui/src/voice/voice-chat-playback.ts',
  'packages/ui/src/voice/speech-segments.ts',
  'packages/voice/src/turn.ts',
  'packages/voice/src/browser-capture',
  'packages/voice/src/respond-gate.ts',
  'packages/voice/src/voice-eot.ts',
  'packages/core/src/speech.ts',
  'packages/core/src/utils/string-boundaries.ts',
  'packages/core/src/spoken-text.ts',
  'packages/core/src/utils/reasoning-tags.ts',
  'packages/core/src/utils/stage-directions.ts',
  'packages/core/src/errors.ts',
  'packages/core/src/utils/errors.ts',
  'packages/ui/src/components/shell/chat-overlay-motion.ts',
  'packages/ui/src/components/shell/use-pull-gesture.ts',
  'packages/ui/src/gestures/constants.ts',
  'packages/ui/src/gestures/lost-capture.ts',
  'packages/ui/src/gestures/recognizers.ts',
  'packages/ui/src/gestures/useRafCoalescer.ts',
  'packages/ui/src/components/shell/chat-panel-layout.ts',
  'packages/ui/src/components/chat/message-maps-parser.ts',
  'packages/ui/src/utils/automation-feed-filter.ts',
  'packages/ui/src/utils/cron-format.ts',
  'packages/core/src/events.ts',
  'packages/core/src/i18n/language.ts',
  'packages/core/src/views/view-interact-protocol.ts',
  'packages/core/src/views/view-action-handoff.ts',
  'packages/core/src/views/completed-action-navigation.ts',
  'packages/ui/src/platform/browser-document-store.ts',
  'packages/contracts/src/native-notes-query.ts',
  'packages/contracts/src/device-reviews.ts',
  'packages/contracts/src/calendar-linked-sync.ts',
  'plugins/plugin-assistant/src/services/device-actions/notes-query-result.ts',
  'plugins/plugin-assistant/src/services/device-actions/sms-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/calendar-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/device-record-presentation.ts',
  'plugins/plugin-assistant/src/services/device-actions/notes-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/reminder-create-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/reminder-contract.ts',
  'plugins/plugin-files',
  'plugins/plugin-maps/src/client',
  'plugins/plugin-maps/test/navigation-client.test.mjs',
  'plugins/plugin-notes/src/client',
  'plugins/plugin-notes/test/device-query.test.mjs',
  'plugins/plugin-notes/test/notes-trash-policy.test.mjs',
  'plugins/plugin-notes/test/notes-trash-maintenance.test.mjs',
  'plugins/plugin-notes/test/notes-trash-schedule.test.mjs',
];
/** Copy authenticated upstream source outside the immutable vendor checkout. */
export function prepareClientFeatures({ root = projectRoot, projectVoice = true } = {}) {
  const upstream = upstreamNativeSource(root);
  const source = new Map(CLIENT_FEATURE_PATHS.flatMap(prefix => [...upstream.read(prefix)]));
  const sourceFiles = Object.fromEntries([...source].map(([name, file]) => [name, file.sha256]));


  if(projectVoice){
  // Browser consumer projections retain the canonical implementations and exact type declarations.
  // The dashboard transport is unavailable here: Alpha must inject its owned, private fetch.
  if (upstream.pin !== 'b25d8aef2916385c571f4367e099809254fde0bb') throw Error('Review voice projections for the new upstream pin.');
  // The camera contract is upstream at this pin; carry it with the other device-action contracts.
  for(const [name,file] of upstream.read('plugins/plugin-assistant/src/services/device-actions/camera-contract.ts'))source.set(name,file);

  const projectionInputs={
    'packages/host/src/voice.ts':'6fb045651135d7286e4889ae042d2d4a89487741cbebd9dc77cb24b6d4f5dd4c',
    'packages/ui/src/voice/voice-session-client.ts':'a0b99f49add5e3628015ed4fd8edb496f4d5b94c738c1d8589bab38ea489646b',
    'packages/ui/src/voice/voice-chat-types.ts':'552b9bd4f47f6fb56464baffcb5cd2c5afc9a2ed8536b7aee3884c5b0a9408c5',
    'packages/core/src/logger.ts':'9c5ebd00a4f0f40ef134a5b331390d0aa21b767ba3a384198fb9c060403eebe6',
  };
  for(const [name,digest] of Object.entries(projectionInputs))if(sourceFiles[name]!==digest)throw Error('Review changed voice projection input: '+name);
  const project = (name, text) => source.set(name, {bytes:Buffer.from(text),mode:'100644',sha256:hash(Buffer.from(text))});
  const text = name => source.get(name).bytes.toString();

  // Upstream's core client takes an injected fetch; the app entry's dashboard transport is never carried.
  const clientPath='packages/ui/src/voice/voice-session-client.ts';
  if(!text(clientPath).includes('export * from "./voice-session-client-core";'))throw Error('Voice client entry projection source changed.');
  project(clientPath,'export * from "./voice-session-client-core";\n');
  const statusTypes=text('packages/ui/src/voice/voice-chat-types.ts');
  const status='export type { VoiceContinuousStatus } from "./voice-session-status";';
  if(!statusTypes.includes(status))throw Error('Voice type projection source changed.');
  const loggerTypes=text('packages/core/src/logger.ts');
  const start=loggerTypes.indexOf('type LogFn ='),end=loggerTypes.indexOf('/**\n * Log entry structure',start);
  if(start<0||end<start)throw Error('Voice type projection source changed.');
  project('packages/ui/src/voice/voice-chat-types.ts',status+'\n');
  source.delete('packages/core/src/logger.ts');
  project('alpha-voice-core-types.ts',loggerTypes.slice(start,end));
  project('alpha-voice-core-protocol.ts','export {ElizaError} from "./packages/core/src/errors";\nexport {redactTrailingArgs} from "./packages/core/src/security/log-redaction";\nexport {parseViewInteractionClientId} from "./packages/core/src/views/view-interact-protocol";\nexport {findViewActionHandoff, type ViewActionHandoff} from "./packages/core/src/views/view-action-handoff";\n');
  // The pinned upstream global renderer is byte-identical to the carried projection.


  }
  const files = Object.fromEntries([...source].map(([name, file]) => [name, file.sha256]));
  const provenance = { baseCommit: upstream.pin, sourceFiles, projectionVersion:projectVoice?7:0, files };
  const parent = path.join(root, '.eliza'), destination = path.join(parent, 'client-features');
  regularPath(parent, true);
  const exists = regularPath(destination, true), stamp = path.join(destination, '.source.json');
  if (exists) {
    if (!regularPath(stamp)) throw Error('Refusing to replace an unrecognized client feature directory.');
    const previous = JSON.parse(fs.readFileSync(stamp));
    const actual = inventory(destination); delete actual['.source.json'];
    if (previous.baseCommit === upstream.pin && previous.projectionVersion === provenance.projectionVersion && matches(previous.files || {}, files) && matches(actual, files)) return destination;
  }
  fs.mkdirSync(parent, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(parent, 'client-features-stage-'));
  try {
    for (const [name, file] of source) {
      const target = path.join(temporary, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.bytes, { mode: parseInt(file.mode, 8) });
    }
    if (!matches(inventory(temporary), files)) throw Error('Client feature source copy failed authentication.');
    fs.writeFileSync(path.join(temporary, '.source.json'), JSON.stringify(provenance, null, 2));
    fs.rmSync(destination, { force: true, recursive: true });
    fs.renameSync(temporary, destination);
    return destination;
  } finally { fs.rmSync(temporary, { force: true, recursive: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Client feature source prepared: ${prepareClientFeatures()}`);
}
