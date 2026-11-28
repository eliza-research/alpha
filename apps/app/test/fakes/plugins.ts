import { alphaAssistantDraft } from "./ask.ts";
import { elizaCalendar } from "./calendar.ts";
import { cameraKeys, elizaCamera } from "./camera.ts";
import { elizaFiles, selectedDocuments } from "./files.ts";
import { alphaInboxAttachments, alphaInboxNotices } from "./inbox.ts";
import { alphaMapsTransport, elizaLocation } from "./maps.ts";
import { alphaNotes } from "./notes.ts";
import { type Faked, elizaAgent, elizaCloud, elizaSecureStore } from "./phone.ts";
import { alphaPhotos, elizaPhotosPermissions } from "./photos.ts";
import { alphaConnection, alphaNetworkLocation } from "./platform.ts";
import { elizaReminders } from "./reminders.ts";
import type { Answering } from "./routes.ts";
import type { Scene } from "./scene.ts";
import { alphaAgentConsent, alphaCarrierSetup, elizaNotices, elizaPasswords, elizaReset, elizaSense, elizaSystem, elizaWiFi, settingsHost } from "./settings.ts";
import { telephonyPlugins } from "./telephony.ts";
import { alphaDevice } from "./update.ts";
import { alphaBrowser } from "./browser.ts";
import { alphaVoiceCloud, elizaCloudSpeech, elizaSignIn } from "./voice.ts";
import { alphaHostedDigests, workflowNoticesHost } from "./workflows.ts";

/**
 * The plugins the fake phone's host registers, by the names their `@CapacitorPlugin` gives: one line per plugin, and
 * its import. Lines are only ever added, and git keeps every branch's (`.gitattributes`). An Alpha image's host
 * registers eliza's telephony plugin, and its contacts plugin where the image grants contacts.
 */
export function plugins(world: Scene, services: { readonly agent: Answering; readonly cloud: Answering }): Record<string, Faked> {
  return {
    ElizaAgent: elizaAgent(services.agent, world.platform, world.settings.recovery),
    ElizaCloud: elizaCloud(services.cloud, () => world.signedIn, world.mailLease, () => world.voice.credentialId, (url) => {
      if (world.inbox.consent) world.inbox.consent.opened.push(url);
      else world.checkout?.opened.push(url);
    }, () => world.voice.billingVerified === world.voice.credentialId, () => world.inbox.consent?.reauthRequired !== true),
    AlphaAssistantDraft: alphaAssistantDraft(world.ask, () => ({ owner: world.notes.ownerIdentity, agent: world.notes.owner, epoch: 1 })),
    ElizaSecureStore: elizaSecureStore(world.secrets, (key) => world.slots.has(key) || /^notes-(?:draft|folders):[1-9][0-9]*$/.test(key)
      || /^sms-draft:v2:(?:new|thread:[1-9][0-9]{0,18}|recipients:[0-9a-f]{64})$/.test(key) || /^messaging-sessions:(slack|telegram):v2$/.test(key) || key === "sms-outgoing:v2:device"),
    ElizaCalendar: elizaCalendar(world.calendar),
    ElizaReminders: elizaReminders(world.reminders, () => world.now),
    ElizaCamera: elizaCamera(world.camera),
    ElizaFiles: elizaFiles(world.files),
    AlphaPhotos: alphaPhotos(world.photos),
    ElizaPhotos: elizaPhotosPermissions(world.photos),
    SelectedDocuments: selectedDocuments(world.files),
    ElizaLocation: elizaLocation(world.maps, () => world.now),
    ElizaSystem: elizaSystem(world.launcher, world.settings),
    ElizaReset: elizaReset(world.settings),
    ...(world.image && world.settings.listener ? { ElizaSense: elizaSense(world.settings, world.settings.listener) } : {}),
    ElizaWiFi: elizaWiFi(world.settings),
    AlphaCarrierSetup: alphaCarrierSetup(world.settings),
    AlphaMapsTransport: alphaMapsTransport(world.maps),
    ...(world.image ? telephonyPlugins(world.telephony, () => world.now) : {}),
    AlphaDevice: (emit, onUnplug) => ({ ...alphaDevice(world.update, () => world.now)(emit, onUnplug), ...settingsHost(world.settings), ...alphaAgentConsent(world.settings), ...cameraKeys(world.camera), takeBillingReturn: () => {
      const session = world.checkout?.returned ?? null;
      if (world.checkout) world.checkout.returned = null;
      return Promise.resolve({ session });
    } }),
    ElizaNotifications: (emit) => ({ ...elizaNotices(world.settings)(emit),
      ...workflowNoticesHost(world.workflows.nativeNotices, () => world.signedIn
        ? { kind: "owned", userId: world.notes.ownerIdentity, organizationId: "organization", agentId: world.notes.owner, epoch: 1 }
        : { kind: "signedOut" })(emit) }),
    ElizaPasswords: elizaPasswords(world.settings),
    AlphaConnection: alphaConnection(world.platform),
    AlphaNetworkLocation: alphaNetworkLocation(world.platform, () => world.now),
    ...(world.voice.onDevice ? { AlphaVoiceCloud: alphaVoiceCloud(world.voice) } : {}),
    ...(world.voice.cloudSpeech ? { ElizaCloudSpeech: elizaCloudSpeech(world.voice) } : {}),
    ElizaSignIn: elizaSignIn(world.voice, () => world.signedIn, world.mailLease),
    ...world.messagingNotices.plugins,
    AlphaBrowser: alphaBrowser(world.browser),
    AlphaInboxAttachments: alphaInboxAttachments(world.inbox),
    ...(world.inbox.notices ? { AlphaInboxNotices: alphaInboxNotices(world.inbox.notices) } : {}),
    AlphaNotes: alphaNotes(world.notes, () => world.telephony.live.length > 0),
    ...(world.workflows.nativeDigests === undefined ? {} : { AlphaHostedDigestDelivery: alphaHostedDigests(world.workflows.nativeDigests) }),
  };
}
