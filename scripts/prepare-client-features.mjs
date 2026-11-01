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
  'packages/contracts/src/browser-address-input.ts',
  'packages/contracts/src/browser-request-grounding.ts',
  // Generated IANA TLD data imported by browser-request-grounding; this leaf has no imports.
  'packages/contracts/src/iana-tlds.ts',
  'packages/contracts/src/stated-clock-time.ts',
  'packages/contracts/src/phone-dial.ts',
  'packages/contracts/src/device-action-execution.ts',
  'packages/contracts/src/client-turn-observation.ts',
  'packages/contracts/src/contracts/remote-agent-pairing.ts',
  'packages/contracts/src/notice-routes.ts',
  'packages/contracts/src/deletion-window.ts',
  'packages/contracts/src/phone-workflow.ts',
  'packages/contracts/src/workflow-client.ts',
  'packages/contracts/src/workflow-device.ts',
  'packages/contracts/src/workflow-intents.ts',
  'packages/contracts/src/workflow-scope.ts',
  'packages/ui/src/agent-surface/AgentSurfaceContext.hooks.ts',
  'packages/ui/src/agent-surface/registry.ts',
  'packages/ui/src/agent-surface/sensitive.ts',
  'packages/ui/src/agent-surface/types.ts',
  'packages/ui/src/agent-surface/useAgentElement.ts',
  'packages/ui/src/api/api-error.ts',
  'packages/ui/src/api/conversation-turn-controller.ts',
  'packages/ui/src/components/composites/deferred-deletion-notice.tsx',
  'packages/ui/src/components/composites/page-panel/content-state.tsx',
  'packages/ui/src/components/composites/page-panel/index.ts',
  'packages/ui/src/components/composites/page-panel/page-panel-collapsible-section.tsx',
  'packages/ui/src/components/composites/page-panel/page-panel-feature-empty.tsx',
  'packages/ui/src/components/composites/page-panel/page-panel-header.tsx',
  'packages/ui/src/components/composites/page-panel/page-panel-layout.tsx',
  'packages/ui/src/components/composites/page-panel/page-panel-types.ts',
  'packages/ui/src/components/ui/badge.tsx',
  'packages/ui/src/components/ui/button.tsx',
  'packages/ui/src/components/ui/card.tsx',
  'packages/ui/src/components/ui/empty-state.tsx',
  'packages/ui/src/components/ui/skeleton-layouts.tsx',
  'packages/ui/src/components/ui/skeleton.tsx',
  'packages/ui/src/components/ui/spinner.tsx',
  'packages/ui/src/utils/cn.ts',
  'packages/ui/src/view-primitives.ts',
  'plugins/plugin-notes/src/client/notes-controller.ts',
  'plugins/plugin-notes/src/client/notes-editor.ts',
  'plugins/plugin-notes/src/client/notes-snapshot-state.ts',
  'plugins/plugin-notes/src/components/NotesSurface.tsx',
  'plugins/plugin-notes/src/components/NotesWorkspace.tsx',
  'plugins/plugin-notes/src/components/viewPrimitives.tsx',
  'plugins/plugin-notes/src/workspace.ts',

  'packages/ui/src/api/transport.ts',
  'plugins/plugin-native-system/src/client/launcher.ts',
  'plugins/plugin-native-system/src/client/shade.ts',
  'plugins/plugin-native-system/src/sense.ts',
  'plugins/plugin-native-system/src/sense-bridge.ts',
  'plugins/plugin-native-system/src/sense-web.ts',
  'plugins/plugin-native-system/src/reset.ts',
  'plugins/plugin-native-system/src/crash-log.ts',
  'packages/ui/src/components/permissions/permission-walkthrough.ts',
  'plugins/plugin-native-system/src/settings.ts',
  'plugins/plugin-native-system/src/definitions.ts',
  'packages/ui/src/components/pages/InstalledAppsLauncher.tsx',
  'packages/contracts/src/contracts/theme.ts',
  'packages/ui/src/config/theme.ts',
  // The shared mobile entry also exports the page registry, its application catalog and
  // MobileApplication (elizaOS/eliza#38276); these leaves are their whole closure.
  'packages/ui/src/app-shell-pages.ts',
  'packages/ui/src/registry-host.ts',
  'packages/ui/src/mobile-shell/index.ts',
  'packages/ui/src/mobile-shell/application-catalog.ts',
  'packages/ui/src/mobile-shell/core.ts',
  'packages/ui/src/mobile-shell/eliza-product.ts',
  'packages/ui/src/mobile-shell/feature-manifest.ts',
  'packages/ui/src/mobile-shell/gestures.ts',
  'packages/ui/src/mobile-shell/MobileAllAppsDrawer.tsx',
  'packages/ui/src/mobile-shell/MobileApplication.tsx',
  'packages/ui/src/mobile-shell/MobileHomeScreen.tsx',
  'packages/ui/src/mobile-shell/MobileViewHost.tsx',
  'packages/ui/src/mobile-shell/mobile-launcher.ts',
  'packages/ui/src/mobile-shell/navigation.ts',
  'packages/ui/src/mobile-shell/product-registration.ts',
  'packages/ui/src/mobile-shell/view-id-migration.ts',
  'packages/ui/src/mobile-shell/view-ids.ts',
  // core.ts re-exports the shared mobile discovery policy (a type-and-function leaf, no imports).
  'packages/ui/src/mobile-shell/view-policy.ts',
  'packages/ui/src/mobile-shell/view-registry.ts',
  'packages/ui/src/voice/pcm-wave.ts',
  "packages/ui/src/utils/reminder-presentation.ts",
  "plugins/plugin-browser/src/native-client-command.ts",
  'plugins/plugin-native-browser-surface/src/address-input.ts',
  'plugins/plugin-native-browser-surface/src/browsing-session.ts',
  'plugins/plugin-native-browser-surface/src/page-reading.ts',
  'plugins/plugin-native-browser-surface/src/page-source.ts',
  'plugins/plugin-native-browser-surface/src/tab-host.ts',
  'packages/core/src/schema-types.ts',
  'packages/core/src/types/json.ts',
  'packages/core/src/types/schema.ts',
  'packages/core/src/types/surface-manifest.ts',
  'packages/core/src/types/view-capability.ts',
  'packages/core/src/types/view-kind.ts',
  'plugins/plugin-calendar/src/meetings/auto-join-types.ts',
  'packages/core/src/types/permissions.ts',
  'packages/contracts/src/lifeops/gmail.ts',
  'packages/contracts/src/lifeops/policy.ts',
  'packages/contracts/src/lifeops/telemetry.ts',
  'packages/contracts/src/lifeops/inbox.ts',
  'packages/contracts/src/lifeops/connectors.ts',
  'packages/contracts/src/lifeops/workflows.ts',
  'packages/contracts/src/lifeops/scheduling.ts',
  'packages/contracts/src/lifeops/reminders.ts',
  'packages/contracts/src/lifeops/events.ts',
  'packages/contracts/src/lifeops/health.ts',
  'packages/contracts/src/lifeops-connector-degradation.ts',
  'packages/contracts/src/lifeops/goals.ts',

  'packages/contracts/src/calendar.ts',
  'packages/core/src/types/effects.ts',
  'plugins/plugin-assistant/src/services/device-actions/foreground-review-contract.ts',
  'plugins/plugin-calendar/src/api/calendar-api.ts',
  'plugins/plugin-calendar/src/api/client-calendar.ts',
  'plugins/plugin-calendar/src/browser.ts',
  'plugins/plugin-calendar/src/client/named-read.ts',
  'plugins/plugin-calendar/src/client/availability-review.ts',
  'plugins/plugin-calendar/src/components/EventEditorDrawer.tsx',
  'plugins/plugin-calendar/src/components/event-editor-command.ts',
  'plugins/plugin-calendar/src/components/event-editor-policy.ts',
  'plugins/plugin-calendar/src/index.ts',
  'plugins/plugin-calendar/src/internal/time.ts',
  'plugins/plugin-calendar/src/service/managed-calendar-host.ts',
  'plugins/plugin-notes/src/capabilities.ts',
  'plugins/plugin-notes/src/client/notes-api.ts',
  'plugins/plugin-notes/src/note-authored.ts',
  'plugins/plugin-notes/src/note-format.ts',
  'plugins/plugin-notes/src/note-id.ts',
  'plugins/plugin-notes/src/types.ts',

  'packages/contracts/src/calendar-linked-sync.ts',
  'packages/ui/src/voice/batch-conversation.ts',
  'packages/ui/src/accessibility/screen-focus.ts',
  'packages/ui/src/voice/voice-session-client-core.ts',
  'packages/ui/src/voice/voice-session-status.ts',
  'packages/ui/src/voice/voice-session-protocol.ts',
  'packages/ui/src/voice/voice-session-state.ts',
  'packages/ui/src/voice/voice-session-ownership.ts',
  'packages/ui/src/voice/voice-session-mic-capture.ts',
  'packages/ui/src/voice/voice-session-playback.ts',
  'packages/ui/src/voice/voice-session-pcm.ts',
  'packages/ui/src/voice/browser-audio-runtime.ts',
  'packages/ui/src/voice/audio-worklet-module-urls.ts',
  'packages/ui/src/voice/worklets',
  'packages/ui/src/logger.ts',
  'packages/core/src/logging.ts',
  'packages/core/src/read-memo.ts',
  'packages/core/src/runtime/single-flight-memo.ts',
  'packages/core/src/view-interaction.ts',
  'packages/core/src/security/log-redaction.ts',
  'packages/host/src/voice/ui-context.ts',

  'packages/ui/src/voice/voice-activity.ts',
  'packages/ui/src/voice/tts-playback-activity.ts',
  'packages/ui/src/voice/end-of-turn.ts',
  'packages/ui/src/voice/voice-chat-playback.ts',
  'packages/ui/src/voice/speech-segments.ts',
  'packages/voice/src/turn.ts',
  'packages/voice/src/browser-capture',
  'packages/voice/src/respond-gate.ts',
  'packages/voice/src/voice-assistant-session.ts',
  'packages/voice/src/live-voice-session.ts',
  'packages/voice/src/native-live-voice.ts',
  'packages/voice/src/native-speech-request.ts',
  'packages/voice/src/voice-turn-routes.ts',
  'packages/voice/src/voice-turn-timing.ts',
  'packages/voice/src/voice-endpoint-chain.ts',
  'packages/voice/src/voice-eot.ts',
  'packages/voice/src/random-id.ts',
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
  'packages/ui/src/components/shell/dock-clearance.ts',
  'packages/ui/src/components/shell/responsive-layout.ts',
  'packages/ui/src/utils/automation-feed-filter.ts',
  'packages/ui/src/overview/daily-overview.ts',
  'packages/ui/src/overview/OverviewCards.tsx',
  'plugins/plugin-workflow/src/client/hosted-digests.ts',
  'plugins/plugin-workflow/src/services/hosted-digest-policy.ts',
  'packages/ui/src/utils/cron-format.ts',
  'packages/core/src/events.ts',
  'packages/core/src/i18n/language.ts',
  'packages/core/src/views/view-interact-protocol.ts',
  'packages/core/src/views/view-action-handoff.ts',
  'packages/core/src/views/completed-action-navigation.ts',
  'packages/ui/src/platform/browser-document-store.ts',
  'packages/ui/src/state/durable-draft.ts',
  'packages/ui/src/state/durable-draft-controller.ts',
  'packages/contracts/src/native-notes-query.ts',
  'packages/contracts/src/device-reviews.ts',
  'plugins/plugin-assistant/src/services/device-actions/contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/phone-dial-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/client-coordinator.ts',
  'plugins/plugin-assistant/src/services/device-actions/maps-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/workflow-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/camera-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/photo-library-contract.ts',
  'plugins/plugin-native-camera/src/definitions.ts',
  'plugins/plugin-native-camera/src/host-ports.ts',
  'plugins/plugin-native-camera/src/session.ts',
  'plugins/plugin-native-camera/src/scan-document.ts',
  'plugins/plugin-assistant/src/services/device-actions/notes-query-result.ts',
  'packages/contracts/src/sms-send.ts',
  'plugins/plugin-assistant/src/services/device-actions/sms-contract.ts',
  'packages/contracts/src/mms-send.ts',
  'packages/contracts/src/native-telephony.ts',
  'packages/contracts/src/native-telephony-session.ts',
  'plugins/plugin-assistant/src/services/device-actions/clock-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/clock-handoff.ts',
  'plugins/plugin-assistant/src/services/device-actions/clock-handoff-history.ts',
  'plugins/plugin-assistant/src/services/device-actions/clock-review-executor.ts',
  'plugins/plugin-assistant/src/services/device-actions/reminder-journal.ts',
  'plugins/plugin-native-reminders/src/android-definitions.ts',
  'plugins/plugin-native-reminders/src/occurrence.ts',
  'plugins/plugin-assistant/src/services/device-actions/calendar-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/device-record-presentation.ts',
  'plugins/plugin-assistant/src/services/device-actions/notes-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/reminder-create-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/reminder-contract.ts',
  'plugins/plugin-files',
  'plugins/plugin-inbox/src/mailbox',
  'plugins/plugin-inbox/src/components/mailbox',
  'plugins/plugin-calendar/src/linked-sync',
  'plugins/plugin-maps/src/client',
  'plugins/plugin-maps/test/navigation-client.test.mjs',
  'plugins/plugin-notes/src/client',
  'plugins/plugin-notes/test/device-query.test.mjs',
  'plugins/plugin-notes/test/notes-trash-policy.test.mjs',
  'plugins/plugin-notes/test/notes-trash-maintenance.test.mjs',
  'plugins/plugin-notes/test/notes-trash-schedule.test.mjs',
  'plugins/plugin-notes/test/notes-trash-store.test.mjs',
  'packages/cloud/sdk/src/subscription-entitlement.ts',
  'packages/ui/src/components/settings/cloud-subscription-summary.tsx',
  'packages/auth/src/auth/native-cloud-sign-in.ts',
  // Credential-bound account billing reader and its snapshot types (AP-03/#410).
  'packages/cloud/sdk/src/cloud-account-billing.ts',
  'packages/cloud/sdk/src/account-billing-snapshot.ts',
  // Framework-free resident Cloud binding controller (AP-04/P-22).
  'packages/auth/src/auth/cloud-resident-binding.ts',
];
/** Copy authenticated upstream source outside the immutable vendor checkout. */
export function prepareClientFeatures({ root = projectRoot, projectVoice = true } = {}) {
  const upstream = upstreamNativeSource(root);
  const source = new Map(CLIENT_FEATURE_PATHS.flatMap(prefix => [...upstream.read(prefix)]));
  const sourceFiles = Object.fromEntries([...source].map(([name, file]) => [name, file.sha256]));


  if(projectVoice){
  // Upstream publishes every renderer type as a leaf entry (@elizaos/core/schema-types,
  // @elizaos/ui/api/transport, plugin-calendar auto-join-types); copied files stay byte-exact.
  // Only two re-export maps remain: they select upstream leaves for bare package specifiers
  // and carry no declarations of their own.
  const project = (name, text) => source.set(name, {bytes:Buffer.from(text),mode:'100644',sha256:hash(Buffer.from(text))});
  project('client-contracts.ts', 'export * from "./packages/contracts/src/calendar";\nexport * from "./packages/contracts/src/calendar-linked-sync";\nexport * from "./packages/contracts/src/device-reviews";\nexport * from "./packages/contracts/src/workflow-device";\nexport * from "./packages/contracts/src/contracts/theme";\n');
  const text = name => source.get(name).bytes.toString();
  // The native compatibility entry re-exports the shared parser by package name.
  // Plain Node consumers need that one import resolved within the copied graph.
  {
    const name = 'plugins/plugin-native-browser-surface/src/address-input.ts';
    const before = 'from "@elizaos/contracts/browser-address-input";';
    const content = text(name);
    if (content.split(before).length !== 2) throw Error('Review changed browser address re-export: ' + name);
    project(name, content.replace(before, 'from "../../../packages/contracts/src/browser-address-input.ts";'));
  }
  // Upstream voice sessions import the shared random-id helper by its emitted .js name. Plain
  // Node (tests and scripts that strip types) cannot map that to the copied .ts source, so the
  // one reviewed value import is pointed at the .ts file; type-only .js imports are erased.
  for (const name of ['packages/voice/src/voice-assistant-session.ts', 'packages/voice/src/live-voice-session.ts']) {
    const before = 'import { randomId } from "./random-id.js";';
    const content = text(name);
    if (content.split(before).length !== 2) throw Error('Review changed voice random-id import: ' + name);
    project(name, content.replace(before, 'import { randomId } from "./random-id.ts";'));
  }
  // The shared account billing reader imports the entitlement helpers by their emitted .js name.
  // Plain Node (tests and scripts that strip types) cannot map that to the copied .ts source, so
  // the one reviewed value import is pointed at the .ts file; its type-only .js import is erased.
  {
    const name = 'packages/cloud/sdk/src/cloud-account-billing.ts', before = '} from "./subscription-entitlement.js";';
    const content = text(name);
    if (content.split(before).length !== 2) throw Error('Review changed account billing import: ' + name);
    project(name, content.replace(before, '} from "./subscription-entitlement.ts";'));
  }

  // The shared native live transport imports the live session's values by their emitted .js name
  // (and only types from turn timing, which type stripping erases); point that one import at .ts.
  {
    const name = 'packages/voice/src/native-live-voice.ts', before = '} from "./live-voice-session.js";';
    const content = text(name);
    if (content.split(before).length !== 2 || /^import (?!type )[^;]*from "\.\/(?!live-voice-session\.js")/m.test(content)) throw Error('Review changed native live voice imports: ' + name);
    project(name, content.replace(before, '} from "./live-voice-session.ts";'));
  }

  // The shared linked-sync modules import @elizaos/contracts by package name. Alpha has no
  // such package: the renderer resolves it through a Vite/tsc alias, but Node consumers
  // (the Vite config bundle, backend hosts and node tests reach calendarSyncHttp through
  // cloud-protocol) cannot. Every symbol they import is in calendar-linked-sync, so point
  // exactly that one import at the projected contract file.
  for (const file of ['google-sync-port.ts', 'sync-controller.ts', 'linked-store.ts']) {
    const name = 'plugins/plugin-calendar/src/linked-sync/' + file;
    const content = text(name), specifier = /\} from "@elizaos\/contracts";/g;
    if ((content.match(specifier) || []).length !== 1 || /["']@elizaos\/contracts\//.test(content))
      throw Error('Review changed linked-sync contracts import: ' + name);
    project(name, content.replace(specifier, '} from "../../../../packages/contracts/src/calendar-linked-sync.ts";'));
  }

  project('alpha-voice-core-protocol.ts','export {ElizaError} from "./packages/core/src/errors";\nexport {redactTrailingArgs} from "./packages/core/src/security/log-redaction";\nexport {parseViewInteractionClientId, AGENT_SURFACE_CAPABILITY_IDS} from "./packages/core/src/views/view-interact-protocol";\nexport {findViewActionHandoff, type ViewActionHandoff} from "./packages/core/src/views/view-action-handoff";\nexport type {PermissionState} from "./packages/core/src/types/permissions";\n');
  }
  const files = Object.fromEntries([...source].map(([name, file]) => [name, file.sha256]));
  const provenance = { baseCommit: upstream.pin, sourceFiles, projectionVersion:projectVoice?12:0, files };
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
