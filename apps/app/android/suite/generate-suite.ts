#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type AssetsProfile = "core" | "thin" | "ocr";
export type SurfaceKind = "overlay" | "app";

export interface IntentFilterSpec {
  readonly action: string;
  readonly category?: string;
  readonly browsable?: boolean;
  readonly scheme?: string;
  readonly host?: string;
  readonly path?: string;
  readonly mimeType?: string;
}

export interface SuiteAppEntry {
  readonly id: string;
  readonly view: string | null;
  readonly surface: SurfaceKind;
  readonly applicationId: string;
  readonly label: string;
  readonly defaultRoles: readonly string[];
  readonly intentFilters: readonly IntentFilterSpec[];
  readonly permissions: readonly string[];
  readonly allowedAgentRoutePrefixes: readonly string[];
  readonly allowedCloudRoutePrefixes: readonly string[];
  readonly allowedSecureStoreSlots: readonly string[];
  readonly assetsProfile: AssetsProfile;
  readonly imageOnly: boolean;
  readonly taskAffinity: string;
}

export interface SuiteRegistry {
  readonly schemaVersion: 1;
  readonly corePackage: string;
  readonly ipcPermission: string;
  readonly apps: readonly SuiteAppEntry[];
}

export interface GeneratedOutput {
  readonly relativePath: string;
  readonly content: string;
  readonly sha256: string;
}

const SUITE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY_PATH = join(SUITE_DIR, "apps.json");
const DEFAULT_OUT_DIR = join(SUITE_DIR, "generated");
const DEFAULT_IPC_POLICY_PATH = resolve(SUITE_DIR, "../alpha-ipc/src/main/assets/alpha-suite-policy.json");
const EXPECTED_VIEWS = new Set([
  "Phone", "Messages", "Contacts", "Browser", "Inbox", "Telegram", "Slack",
  "Calendar", "Clock", "Reminders", "Camera", "Photos", "Maps", "Notes",
  "Files", "Workflows", "Wallet", "Settings",
]);

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string, context: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${context}: expected non-empty string for "${key}"`);
  }
  return value;
}

function requireStringArray(obj: Record<string, unknown>, key: string, context: string): readonly string[] {
  const value = obj[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${context}: expected string[] for "${key}"`);
  }
  return value as readonly string[];
}

function parseIntentFilter(raw: unknown, context: string): IntentFilterSpec {
  if (!isRecord(raw)) throw new Error(`${context}: intent filter must be an object`);
  const action = requireString(raw, "action", context);
  const category = raw.category === undefined ? undefined : requireString(raw, "category", context);
  const browsable = raw.browsable === undefined ? undefined : Boolean(raw.browsable);
  const scheme = raw.scheme === undefined ? undefined : requireString(raw, "scheme", context);
  const host = raw.host === undefined ? undefined : requireString(raw, "host", context);
  const path = raw.path === undefined ? undefined : requireString(raw, "path", context);
  if ((host !== undefined && !scheme) || (path !== undefined && (!host || !path.startsWith("/")))) {
    throw new Error(`${context}: an exact path needs a host and a host needs a scheme`);
  }
  const mimeType = raw.mimeType === undefined ? undefined : requireString(raw, "mimeType", context);
  return {
    action,
    ...(category === undefined ? {} : { category }),
    ...(browsable === undefined ? {} : { browsable }),
    ...(scheme === undefined ? {} : { scheme }),
    ...(host === undefined ? {} : { host }),
    ...(path === undefined ? {} : { path }),
    ...(mimeType === undefined ? {} : { mimeType }),
  };
}

function parseAppEntry(raw: unknown, index: number): SuiteAppEntry {
  const context = `apps[${index}]`;
  if (!isRecord(raw)) throw new Error(`${context}: must be an object`);
  const id = requireString(raw, "id", context);
  if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error(`${context}: invalid id "${id}"`);
  const rawView = raw.view;
  const view = rawView === null ? null : typeof rawView === "string" && rawView.trim() !== "" ? rawView : null;
  if (rawView !== null && view === null) throw new Error(`${context}: view must be string or null`);
  const surfaceRaw = requireString(raw, "surface", context);
  if (surfaceRaw !== "overlay" && surfaceRaw !== "app") {
    throw new Error(`${context}: surface must be "overlay" or "app", got "${surfaceRaw}"`);
  }
  const applicationId = requireString(raw, "applicationId", context);
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(applicationId)) {
    throw new Error(`${context}: invalid applicationId "${applicationId}"`);
  }
  const label = requireString(raw, "label", context);
  const defaultRoles = requireStringArray(raw, "defaultRoles", context);
  if (!Array.isArray(raw.intentFilters)) throw new Error(`${context}: intentFilters must be an array`);
  const intentFilters = raw.intentFilters.map((item, idx) => parseIntentFilter(item, `${context}.intentFilters[${idx}]`));
  const permissions = requireStringArray(raw, "permissions", context);
  const allowedAgentRoutePrefixes = requireStringArray(raw, "allowedAgentRoutePrefixes", context);
  const allowedCloudRoutePrefixes = requireStringArray(raw, "allowedCloudRoutePrefixes", context);
  const allowedSecureStoreSlots = requireStringArray(raw, "allowedSecureStoreSlots", context);
  for (const prefix of [...allowedAgentRoutePrefixes, ...allowedCloudRoutePrefixes]) {
    if (prefix !== "*" && !prefix.startsWith("/")) {
      throw new Error(`${context}: route prefix "${prefix}" must be "*" or start with "/"`);
    }
  }
  const profileRaw = requireString(raw, "assetsProfile", context);
  if (profileRaw !== "core" && profileRaw !== "thin" && profileRaw !== "ocr") {
    throw new Error(`${context}: invalid assetsProfile "${profileRaw}"`);
  }
  if (typeof raw.imageOnly !== "boolean") throw new Error(`${context}: imageOnly must be boolean`);
  const taskAffinity = requireString(raw, "taskAffinity", context);
  return {
    id,
    view,
    surface: surfaceRaw,
    applicationId,
    label,
    defaultRoles,
    intentFilters,
    permissions,
    allowedAgentRoutePrefixes,
    allowedCloudRoutePrefixes,
    allowedSecureStoreSlots,
    assetsProfile: profileRaw,
    imageOnly: raw.imageOnly,
    taskAffinity,
  };
}

/** Reads and rigorously validates {@code apps/app/android/suite/apps.json}. */
export function loadSuiteRegistry(registryPath: string = DEFAULT_REGISTRY_PATH): SuiteRegistry {
  const raw: unknown = JSON.parse(readFileSync(registryPath, "utf8"));
  if (!isRecord(raw)) throw new Error("apps.json root must be an object");
  if (raw.schemaVersion !== 1) throw new Error(`Unsupported schemaVersion: ${String(raw.schemaVersion)}`);
  const corePackage = requireString(raw, "corePackage", "root");
  const ipcPermission = requireString(raw, "ipcPermission", "root");
  if (!Array.isArray(raw.apps)) throw new Error("root.apps must be an array");
  const apps = raw.apps.map((entry, index) => parseAppEntry(entry, index));

  const seenIds = new Set<string>();
  const seenPackages = new Set<string>();
  const seenViews = new Set<string>();
  let coreCount = 0;

  for (const app of apps) {
    if (seenIds.has(app.id)) throw new Error(`Duplicate app id: ${app.id}`);
    seenIds.add(app.id);
    if (seenPackages.has(app.applicationId)) throw new Error(`Duplicate applicationId: ${app.applicationId}`);
    seenPackages.add(app.applicationId);
    if (app.id === "core") {
      coreCount += 1;
      if (app.applicationId !== corePackage) throw new Error("core entry applicationId must match corePackage");
      if (app.view !== null || app.surface !== "overlay") throw new Error("core entry must have view=null and surface=overlay");
    } else {
      if (app.view === null || app.surface !== "app") throw new Error(`App "${app.id}" must have non-null view and surface="app"`);
      if (!EXPECTED_VIEWS.has(app.view)) throw new Error(`App "${app.id}" references unknown view "${app.view}"`);
      if (seenViews.has(app.view)) throw new Error(`Duplicate view "${app.view}"`);
      seenViews.add(app.view);
    }
  }
  if (coreCount !== 1) throw new Error(`Expected exactly 1 core entry, found ${coreCount}`);
  for (const expectedView of EXPECTED_VIEWS) {
    if (!seenViews.has(expectedView)) throw new Error(`Missing required view in apps.json: ${expectedView}`);
  }
  return { schemaVersion: 1, corePackage, ipcPermission, apps };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function renderIntentFilter(filter: IntentFilterSpec): string {
  const lines: string[] = ["            <intent-filter>"];
  lines.push(`                <action android:name="${escapeXml(filter.action)}" />`);
  if (filter.category !== undefined) {
    lines.push(`                <category android:name="${escapeXml(filter.category)}" />`);
  }
  if (filter.browsable === true) {
    lines.push(`                <category android:name="android.intent.category.BROWSABLE" />`);
  }
  const data = (["scheme", "host", "path", "mimeType"] as const).flatMap((name) => {
    const value = filter[name];
    return value === undefined ? [] : [`android:${name}="${escapeXml(value)}"`];
  });
  if (data.length > 0) lines.push(`                <data ${data.join(" ")} />`);
  lines.push("            </intent-filter>");
  return lines.join("\n");
}

interface FlavorPluginProfile {
  readonly modules: readonly string[];
  readonly sourceDirs: readonly string[];
  readonly resDirs?: readonly string[];
  readonly pluginClasses: readonly string[];
}

const messagingNotices = {
  sourceDir: "../../app/src/main/java/ai/alphacompute/alphaphone/messaging",
  plugin: "ai.alphacompute.alphaphone.messaging.AlphaMessagingNoticesPlugin",
};

const FLAVOR_PLUGIN_PROFILES: Readonly<Record<string, FlavorPluginProfile>> = {
  telegram: {
    modules: [],
    sourceDirs: [messagingNotices.sourceDir],
    pluginClasses: [messagingNotices.plugin],
  },
  slack: {
    modules: [],
    sourceDirs: [messagingNotices.sourceDir, "../../app/src/main/java/ai/alphacompute/alphaphone/slack"],
    pluginClasses: [messagingNotices.plugin, "ai.alphacompute.alphaphone.slack.AlphaSlackOAuthPlugin"],
  },
  phone: {
    modules: [":eliza-messages", ":eliza-phone", ":eliza-contacts", ":eliza-action-journal"],
    sourceDirs: ["src/plugins/telephony/java", "src/plugins/contacts/java"],
    pluginClasses: [
      "ai.alphacompute.thinapp.ThinTelephonyPlugin",
      "ai.alphacompute.thinapp.ThinContactsPlugin",
      "ai.alphacompute.thinapp.ThinOngoingCallPlugin",
      "ai.alphacompute.thinapp.ThinTelephonyActionJournalPlugin",
    ],
  },
  messages: {
    modules: [":eliza-messages", ":eliza-phone", ":eliza-contacts", ":eliza-action-journal"],
    sourceDirs: ["src/plugins/telephony/java", "src/plugins/contacts/java"],
    pluginClasses: [
      "ai.alphacompute.thinapp.ThinTelephonyPlugin",
      "ai.alphacompute.thinapp.ThinContactsPlugin",
      "ai.alphacompute.thinapp.ThinTelephonyActionJournalPlugin",
    ],
  },
  contacts: {
    modules: [":eliza-messages", ":eliza-phone", ":eliza-contacts", ":eliza-action-journal"],
    sourceDirs: ["src/plugins/telephony/java", "src/plugins/contacts/java"],
    pluginClasses: [
      "ai.alphacompute.thinapp.ThinTelephonyPlugin",
      "ai.alphacompute.thinapp.ThinContactsPlugin",
      "ai.alphacompute.thinapp.ThinTelephonyActionJournalPlugin",
    ],
  },
  browser: {
    modules: [":eliza-browser-surface"],
    sourceDirs: ["src/plugins/browser/java"],
    resDirs: ["src/plugins/browser/res"],
    pluginClasses: [
      "ai.eliza.plugins.browsersurface.ElizaSurfaceManagerPlugin",
      "ai.alphacompute.thinapp.ThinBrowserPlugin",
    ],
  },
  inbox: {
    modules: [":eliza-media"],
    sourceDirs: ["src/plugins/inbox/java"],
    pluginClasses: ["ai.alphacompute.thinapp.ThinInboxAttachmentsPlugin"],
  },
  calendar: {
    modules: [":eliza-calendar"],
    sourceDirs: ["src/plugins/calendar/java"],
    pluginClasses: ["ai.alphacompute.thinapp.ThinCalendarPlugin"],
  },
  clock: {
    modules: [":eliza-system", ":eliza-secure-store"],
    sourceDirs: [
      "src/plugins/system/java",
      "../../app/src/main/java/ai/alphacompute/alphaphone/clock",
    ],
    pluginClasses: [
      "ai.alphacompute.thinapp.ThinSystemPlugin",
      "ai.alphacompute.alphaphone.clock.AlphaClockAlertsPlugin",
    ],
  },
  reminders: {
    modules: [":eliza-reminders"],
    sourceDirs: ["src/plugins/reminders/java"],
    pluginClasses: ["ai.alphacompute.thinapp.ThinRemindersPlugin"],
  },
  camera: {
    modules: [":eliza-camera", ":eliza-media", ":eliza-filesystem"],
    sourceDirs: ["src/plugins/media/java", "src/plugins/documents/java"],
    pluginClasses: [
      "ai.eliza.plugins.camera.CameraPlugin",
      "ai.alphacompute.thinapp.ThinPhotosPlugin",
      "ai.alphacompute.thinapp.ThinPhotoLibraryPlugin",
      "ai.alphacompute.thinapp.ThinPhotosPermissionsPlugin",
      "ai.alphacompute.thinapp.ThinSelectedDocumentsPlugin",
      "ai.alphacompute.thinapp.ThinScanPlugin",
    ],
  },
  photos: {
    modules: [":eliza-media"],
    sourceDirs: ["src/plugins/media/java"],
    pluginClasses: [
      "ai.alphacompute.thinapp.ThinPhotosPlugin",
      "ai.alphacompute.thinapp.ThinPhotoLibraryPlugin",
      "ai.alphacompute.thinapp.ThinPhotosPermissionsPlugin",
    ],
  },
  maps: {
    modules: [":eliza-location"],
    sourceDirs: ["src/plugins/maps/java"],
    pluginClasses: [
      "ai.eliza.plugins.location.LocationPlugin",
      "ai.alphacompute.thinapp.ThinMapsTransportPlugin",
      "ai.alphacompute.thinapp.ThinNetworkLocationPlugin",
    ],
  },
  notes: {
    modules: [":eliza-media"],
    sourceDirs: ["src/plugins/notes/java"],
    pluginClasses: [
      "ai.alphacompute.thinapp.ThinNotesPlugin",
      "ai.alphacompute.thinapp.ThinNoteDocumentsPlugin",
    ],
  },
  files: {
    modules: [":eliza-filesystem", ":eliza-media"],
    sourceDirs: ["src/plugins/files/java", "src/plugins/media/java", "src/plugins/documents/java"],
    pluginClasses: [
      "ai.alphacompute.thinapp.ThinSelectedDocumentsPlugin",
      "ai.alphacompute.thinapp.ThinScanPlugin",
      "ai.alphacompute.thinapp.ThinFilesPlugin",
      "ai.alphacompute.thinapp.ThinPhotosPermissionsPlugin",
    ],
  },
  workflows: {
    modules: [":eliza-system", ":eliza-calendar"],
    sourceDirs: ["src/plugins/system/java", "src/plugins/calendar/java"],
    pluginClasses: [
      "ai.alphacompute.thinapp.ThinSystemPlugin",
      "ai.alphacompute.thinapp.ThinCalendarPlugin",
    ],
  },
  settings: {
    modules: [
      ":eliza-system",
      ":eliza-wifi",
      ":eliza-location",
      ":eliza-filesystem",
      ":eliza-media",
      ":eliza-calendar",
      ":eliza-contacts",
    ],
    sourceDirs: [
      "src/plugins/system/java",
      "src/plugins/files/java",
      "src/plugins/media/java",
      "src/plugins/calendar/java",
      "src/plugins/contacts/java",
    ],
    pluginClasses: [
      "ai.alphacompute.thinapp.ThinSystemPlugin",
      "ai.eliza.plugins.system.SensePlugin",
      "ai.eliza.plugins.wifi.WiFiPlugin",
      "ai.eliza.plugins.location.LocationPlugin",
      "ai.alphacompute.thinapp.ThinFilesPlugin",
      "ai.alphacompute.thinapp.ThinPhotosPermissionsPlugin",
      "ai.alphacompute.thinapp.ThinCalendarPlugin",
      "ai.alphacompute.thinapp.ThinContactsPlugin",
    ],
  },
};

function renderOptionalFeatures(permissions: readonly string[]): readonly string[] {
  const permSet = new Set(permissions);
  const features: string[] = [];
  if (permSet.has("android.permission.CAMERA")) {
    features.push("android.hardware.camera", "android.hardware.camera.autofocus");
  }
  if (permSet.has("android.permission.RECORD_AUDIO")) {
    features.push("android.hardware.microphone");
  }
  if (permSet.has("android.permission.ACCESS_FINE_LOCATION") || permSet.has("android.permission.ACCESS_COARSE_LOCATION")) {
    features.push("android.hardware.location", "android.hardware.location.gps");
  }
  if (permSet.has("android.permission.ACCESS_WIFI_STATE")) {
    features.push("android.hardware.wifi");
  }
  if (permSet.has("android.permission.CALL_PHONE") || permSet.has("android.permission.SEND_SMS")) {
    features.push("android.hardware.telephony");
  }
  return features.map((name) => `    <uses-feature android:name="${name}" android:required="false" />`);
}

function renderQueries(registry: SuiteRegistry, app: SuiteAppEntry): readonly string[] {
  const packages = new Set<string>([
    registry.corePackage,
    "proton.android.pass",
    "ai.alphacompute.alphaphone.sense",
    "com.android.systemui",
  ]);
  for (const sibling of registry.apps) {
    if (sibling.applicationId !== app.applicationId) {
      packages.add(sibling.applicationId);
    }
  }
  const packageLines = [...packages].map((pkg) => `        <package android:name="${escapeXml(pkg)}" />`);
  return [
    `    <queries>`,
    ...packageLines,
    `        <intent>`,
    `            <action android:name="android.intent.action.VIEW" />`,
    `            <category android:name="android.intent.category.BROWSABLE" />`,
    `            <data android:scheme="https" />`,
    `        </intent>`,
    `        <intent>`,
    `            <action android:name="android.intent.action.VIEW" />`,
    `            <data android:scheme="geo" />`,
    `        </intent>`,
    `        <intent>`,
    `            <action android:name="android.intent.action.DIAL" />`,
    `            <data android:scheme="tel" />`,
    `        </intent>`,
    `        <intent>`,
    `            <action android:name="android.intent.action.SENDTO" />`,
    `            <data android:scheme="mailto" />`,
    `        </intent>`,
    `        <intent>`,
    `            <action android:name="android.intent.action.SENDTO" />`,
    `            <data android:scheme="smsto" />`,
    `        </intent>`,
    `        <intent>`,
    `            <action android:name="android.intent.action.SET_ALARM" />`,
    `        </intent>`,
    `        <intent>`,
    `            <action android:name="android.intent.action.SHOW_ALARMS" />`,
    `        </intent>`,
    `        <intent>`,
    `            <action android:name="android.intent.action.DISMISS_ALARM" />`,
    `        </intent>`,
    `        <intent>`,
    `            <action android:name="android.intent.action.SNOOZE_ALARM" />`,
    `        </intent>`,
    `        <intent>`,
    `            <action android:name="android.support.customtabs.action.CustomTabsService" />`,
    `        </intent>`,
    `        <intent>`,
    `            <action android:name="android.settings.SETTINGS" />`,
    `        </intent>`,
    `    </queries>`,
  ];
}

function renderFlavorComponents(app: SuiteAppEntry): readonly string[] {
  if (app.id === "browser") {
    return [
      `        <provider`,
      `            android:name="androidx.core.content.FileProvider"`,
      `            android:authorities="\${applicationId}.browser.fileprovider"`,
      `            android:exported="false"`,
      `            android:grantUriPermissions="true">`,
      `            <meta-data`,
      `                android:name="android.support.FILE_PROVIDER_PATHS"`,
      `                android:resource="@xml/alpha_browser_file_paths" />`,
      `        </provider>`,
    ];
  }
  if (app.id === "slack" || app.id === "telegram") {
    return [
      `        <provider android:name="ai.alphacompute.alphaphone.messaging.MessagingNoticeAuthority"`,
      `            android:authorities="${app.applicationId}.messaging-notices" android:exported="true"`,
      `            android:permission="ai.alphacompute.permission.AGENT_IPC" />`,
      `        <receiver android:name="ai.alphacompute.alphaphone.messaging.MessagingNotices$Dismissed" android:exported="false" />`,
    ];
  }
  if (app.id === "clock" || app.id === "reminders") {
    const clock = app.id === "clock";
    const receiver = clock ? "ai.alphacompute.alphaphone.clock.ClockAlertReceiver" : "ai.alphacompute.thinapp.ThinReminderReceiver";
    return [
      ...(clock ? [
        `        <provider android:name="ai.alphacompute.alphaphone.clock.ClockAuthority"`,
        `            android:authorities="ai.alphacompute.clock.alerts" android:exported="true"`,
        `            android:permission="ai.alphacompute.permission.AGENT_IPC" />`,
      ] : []),
      `        <receiver`,
      `            android:name="${receiver}"`,
      `            android:exported="false">`,
      `            <intent-filter>`,
      `                <action android:name="android.intent.action.BOOT_COMPLETED" />`,
      `                <action android:name="android.intent.action.TIME_SET" />`,
      `                <action android:name="android.intent.action.TIMEZONE_CHANGED" />`,
      ...(clock ? [
        `                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />`,
        `                <action android:name="android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" />`,
      ] : []),
      `            </intent-filter>`,
      `        </receiver>`,
    ];
  }
  if (app.id === "phone") {
    return [
      `        <receiver`,
      `            android:name="ai.alphacompute.thinapp.ThinSmsSendReceiver"`,
      `            android:exported="false" />`,
      `        <receiver`,
      `            android:name="ai.alphacompute.thinapp.ThinTelephonyDeletionWakeup"`,
      `            android:exported="false" />`,
      `        <service`,
      `            android:name="ai.alphacompute.thinapp.ThinInCallService"`,
      `            android:exported="true"`,
      `            android:permission="android.permission.BIND_INCALL_SERVICE">`,
      `            <meta-data`,
      `                android:name="android.telecom.IN_CALL_SERVICE_UI"`,
      `                android:value="true" />`,
      `            <meta-data`,
      `                android:name="android.telecom.IN_CALL_SERVICE_RINGING"`,
      `                android:value="false" />`,
      `            <intent-filter>`,
      `                <action android:name="android.telecom.InCallService" />`,
      `            </intent-filter>`,
      `        </service>`,
      `        <activity`,
      `            android:name="ai.alphacompute.thinapp.ThinCallActivity"`,
      `            android:exported="false"`,
      `            android:launchMode="singleTop"`,
      `            android:screenOrientation="portrait"`,
      `            android:theme="@android:style/Theme.DeviceDefault.NoActionBar" />`,
    ];
  }
  if (app.id === "messages") {
    return [
      `        <receiver`,
      `            android:name="ai.alphacompute.thinapp.ThinSmsSendReceiver"`,
      `            android:exported="false" />`,
      `        <receiver`,
      `            android:name="ai.alphacompute.thinapp.ThinTelephonyDeletionWakeup"`,
      `            android:exported="false" />`,
      `        <receiver`,
      `            android:name="ai.alphacompute.thinapp.ThinSmsDeliverReceiver"`,
      `            android:exported="true"`,
      `            android:permission="android.permission.BROADCAST_SMS">`,
      `            <intent-filter>`,
      `                <action android:name="android.provider.Telephony.SMS_DELIVER" />`,
      `            </intent-filter>`,
      `        </receiver>`,
      `        <receiver`,
      `            android:name="ai.alphacompute.thinapp.ThinMmsWapPushReceiver"`,
      `            android:exported="true"`,
      `            android:permission="android.permission.BROADCAST_WAP_PUSH">`,
      `            <intent-filter>`,
      `                <action android:name="android.provider.Telephony.WAP_PUSH_DELIVER" />`,
      `                <data android:mimeType="application/vnd.wap.mms-message" />`,
      `            </intent-filter>`,
      `        </receiver>`,
      `        <receiver`,
      `            android:name="ai.alphacompute.thinapp.ThinMmsResultReceiver"`,
      `            android:exported="false" />`,
      `        <service`,
      `            android:name="ai.alphacompute.thinapp.ThinRespondViaMessageService"`,
      `            android:exported="true"`,
      `            android:permission="android.permission.SEND_RESPOND_VIA_MESSAGE">`,
      `            <intent-filter>`,
      `                <action android:name="android.intent.action.RESPOND_VIA_MESSAGE" />`,
      `                <category android:name="android.intent.category.DEFAULT" />`,
      `                <data android:scheme="sms" />`,
      `                <data android:scheme="smsto" />`,
      `                <data android:scheme="mms" />`,
      `                <data android:scheme="mmsto" />`,
      `            </intent-filter>`,
      `        </service>`,
      `        <provider`,
      `            android:name="ai.eliza.plugins.messages.MmsFileProvider"`,
      `            android:authorities="\${applicationId}.mms"`,
      `            android:exported="false"`,
      `            android:grantUriPermissions="true" />`,
    ];
  }
  if (app.id === "contacts") {
    return [
      `        <receiver`,
      `            android:name="ai.alphacompute.thinapp.ThinSmsSendReceiver"`,
      `            android:exported="false" />`,
      `        <receiver`,
      `            android:name="ai.alphacompute.thinapp.ThinTelephonyDeletionWakeup"`,
      `            android:exported="false" />`,
    ];
  }
  if (app.id === "notes") {
    return [
      `        <service`,
      `            android:name="ai.alphacompute.thinapp.ThinNoteRecordingService"`,
      `            android:exported="false"`,
      `            android:foregroundServiceType="microphone" />`,
    ];
  }
  if (app.id === "maps") {
    return [
      `        <service`,
      `            android:name="ai.alphacompute.thinapp.ThinNavigationService"`,
      `            android:exported="false"`,
      `            android:foregroundServiceType="location" />`,
    ];
  }
  if (app.id === "files" || app.id === "camera") {
    return [
      `        <service`,
      `            android:name="ai.alphacompute.thinapp.ThinIsolatedPdfService"`,
      `            android:exported="false"`,
      `            android:isolatedProcess="true"`,
      `            android:process=":isolated_pdf"`,
      `            android:stopWithTask="true" />`,
    ];
  }
  return [];
}

function renderFlavorPluginsJava(app: SuiteAppEntry): string {
  const profile = FLAVOR_PLUGIN_PROFILES[app.id];
  const calls = (profile?.pluginClasses ?? []).map(
    (cls) => `        activity.registerThinPlugin(${cls}.class);`,
  );
  return [
    `package ai.alphacompute.thinapp;`,
    ``,
    `/** Generated per-flavor native Capacitor plugin registrar for {@code ${app.id}}. */`,
    `final class FlavorPlugins {`,
    `    private FlavorPlugins() {}`,
    ``,
    `    static void register(ThinAppActivity activity) {`,
    ...(app.id === "slack" || app.id === "telegram"
      ? ["        ai.alphacompute.alphaphone.messaging.MessagingNotices.opened(activity, activity.getIntent());"]
      : []),
    ...calls,
    `    }`,
    `}`,
    ``,
  ].join("\n");
}

interface AppIconSpec {
  readonly strokes: readonly string[];
  readonly accentFills?: readonly string[];
}

const APP_ICON_SPECS: Readonly<Record<string, AppIconSpec>> = {
  phone: {
    strokes: [
      "M7,4 L10,4 L11.5,8 L9.5,9.5 C10.6,11.8 12.2,13.4 14.5,14.5 L16,12.5 L20,14 L20,17 C20,18.7 18.7,20 17,20 C10.4,20 4,13.6 4,7 C4,5.3 5.3,4 7,4 Z",
    ],
    accentFills: [
      "M16.5,5.5 A1.5,1.5 0 1,1 16.49,5.5 Z",
    ],
  },
  messages: {
    strokes: [
      "M5,5 H19 C20.1,5 21,5.9 21,7 V15 C21,16.1 20.1,17 19,17 H10 L5,20.5 V17 C3.9,17 3,16.1 3,15 V7 C3,5.9 3.9,5 5,5 Z",
      "M8,10 H16",
      "M8,13.2 H13",
    ],
    accentFills: [
      "M16.2,13.2 A1.2,1.2 0 1,1 16.19,13.2 Z",
    ],
  },
  contacts: {
    strokes: [
      "M12,11 A3.5,3.5 0 1,0 12,4 A3.5,3.5 0 1,0 12,11 Z",
      "M5,20 C5,16.2 8.1,14 12,14 C15.9,14 19,16.2 19,20",
    ],
    accentFills: [
      "M18.5,6.5 A1.3,1.3 0 1,1 18.49,6.5 Z",
    ],
  },
  browser: {
    strokes: [
      "M12,3 A9,9 0 1,0 12,21 A9,9 0 1,0 12,3 Z",
      "M3.5,12 H20.5",
      "M12,3 C14.8,5.6 16,8.7 16,12 C16,15.3 14.8,18.4 12,21 C9.2,18.4 8,15.3 8,12 C8,8.7 9.2,5.6 12,3 Z",
    ],
    accentFills: [
      "M12,10.5 A1.5,1.5 0 1,1 11.99,10.5 Z",
    ],
  },
  inbox: {
    strokes: [
      "M4,6 H20 C20.6,6 21,6.4 21,7 V17 C21,17.6 20.6,18 20,18 H4 C3.4,18 3,17.6 3,17 V7 C3,6.4 3.4,6 4,6 Z",
      "M3.5,7.2 L12,13.2 L20.5,7.2",
    ],
    accentFills: [
      "M18,5.8 A1.6,1.6 0 1,1 17.99,5.8 Z",
    ],
  },
  telegram: {
    strokes: [
      "M20.5,4.5 L3.5,11.2 L9.8,13.5 L17.5,7.5 L12.2,14.8 L17.8,19.2 L20.5,4.5 Z",
      "M9.8,13.5 L11.4,18.8 L13.8,16.2",
    ],
  },
  slack: {
    strokes: [
      "M9,4.5 V19.5",
      "M15,4.5 V19.5",
      "M4.5,9 H19.5",
      "M4.5,15 H19.5",
    ],
    accentFills: [
      "M15,9 A1.4,1.4 0 1,1 14.99,9 Z",
    ],
  },
  calendar: {
    strokes: [
      "M4,6 H20 C20.6,6 21,6.4 21,7 V19 C21,19.6 20.6,20 20,20 H4 C3.4,20 3,19.6 3,19 V7 C3,6.4 3.4,6 4,6 Z",
      "M3,10.5 H21",
      "M8,3.5 V7",
      "M16,3.5 V7",
    ],
    accentFills: [
      "M15.5,15 A1.6,1.6 0 1,1 15.49,15 Z",
    ],
  },
  clock: {
    strokes: [
      "M12,3 A9,9 0 1,0 12,21 A9,9 0 1,0 12,3 Z",
      "M12,7.2 V12 L15.8,14.2",
    ],
    accentFills: [
      "M12,10.6 A1.4,1.4 0 1,1 11.99,10.6 Z",
    ],
  },
  reminders: {
    strokes: [
      "M12,3.5 A8.5,8.5 0 1,0 12,20.5 A8.5,8.5 0 1,0 12,3.5 Z",
      "M8.4,12.2 L11,14.8 L16,9.4",
    ],
    accentFills: [
      "M18.2,5.8 A1.4,1.4 0 1,1 18.19,5.8 Z",
    ],
  },
  camera: {
    strokes: [
      "M4,8 H7.2 L8.8,5.5 H15.2 L16.8,8 H20 C20.6,8 21,8.4 21,9 V18 C21,18.6 20.6,19 20,19 H4 C3.4,19 3,18.6 3,18 V9 C3,8.4 3.4,8 4,8 Z",
      "M12,10 A3.5,3.5 0 1,0 12,17 A3.5,3.5 0 1,0 12,10 Z",
    ],
    accentFills: [
      "M12,12.2 A1.3,1.3 0 1,1 11.99,12.2 Z",
    ],
  },
  photos: {
    strokes: [
      "M4,5 H20 C20.6,5 21,5.4 21,6 V18 C21,18.6 20.6,19 20,19 H4 C3.4,19 3,18.6 3,18 V6 C3,5.4 3.4,5 4,5 Z",
      "M4,16.5 L9.2,11.5 L13.5,15.5 L16.2,13 L20,16.5",
    ],
    accentFills: [
      "M15.8,8.8 A1.6,1.6 0 1,1 15.79,8.8 Z",
    ],
  },
  maps: {
    strokes: [
      "M12,21 C12,21 18.5,14.8 18.5,10 C18.5,6.4 15.6,3.5 12,3.5 C8.4,3.5 5.5,6.4 5.5,10 C5.5,14.8 12,21 12,21 Z",
    ],
    accentFills: [
      "M12,8.1 A1.9,1.9 0 1,1 11.99,8.1 Z",
    ],
  },
  notes: {
    strokes: [
      "M6,3.5 H14.5 L19,8 V19.5 C19,20.1 18.6,20.5 18,20.5 H6 C5.4,20.5 5,20.1 5,19.5 V4.5 C5,3.9 5.4,3.5 6,3.5 Z",
      "M14.5,3.5 V8 H19",
      "M8.5,12 H15.5",
      "M8.5,15.8 H13.5",
    ],
    accentFills: [
      "M15.6,15.8 A1.2,1.2 0 1,1 15.59,15.8 Z",
    ],
  },
  files: {
    strokes: [
      "M3.5,6 C3.5,5.4 3.9,5 4.5,5 H9.5 L11.5,7.5 H19.5 C20.1,7.5 20.5,7.9 20.5,8.5 V18 C20.5,18.6 20.1,19 19.5,19 H4.5 C3.9,19 3.5,18.6 3.5,18 V6 Z",
      "M3.5,10.5 H20.5",
    ],
    accentFills: [
      "M16.5,14.5 A1.4,1.4 0 1,1 16.49,14.5 Z",
    ],
  },
  workflows: {
    strokes: [
      "M13.2,3.2 L5.8,13 H12 L10.8,20.8 L18.2,11 H12 L13.2,3.2 Z",
    ],
    accentFills: [
      "M17.8,5.6 A1.4,1.4 0 1,1 17.79,5.6 Z",
    ],
  },
  wallet: {
    strokes: [
      "M4,6.5 H19 C19.8,6.5 20.5,7.2 20.5,8 V17.5 C20.5,18.3 19.8,19 19,19 H5 C4.2,19 3.5,18.3 3.5,17.5 V7 C3.5,5.9 4.4,5 5.5,5 H17.5",
      "M15.5,11.2 H20.5 V14.8 H15.5 C14.6,14.8 14,14.1 14,13 C14,11.9 14.6,11.2 15.5,11.2 Z",
    ],
    accentFills: [
      "M16.2,13 A1.1,1.1 0 1,1 16.19,13 Z",
    ],
  },
  settings: {
    strokes: [
      "M4.5,7.5 H19.5",
      "M4.5,12 H19.5",
      "M4.5,16.5 H19.5",
    ],
    accentFills: [
      "M9,5.7 A1.8,1.8 0 1,1 8.99,5.7 Z",
      "M15.5,10.2 A1.8,1.8 0 1,1 15.49,10.2 Z",
      "M10.5,14.7 A1.8,1.8 0 1,1 10.49,14.7 Z",
    ],
  },
};

function renderAdaptiveIconXml(): string {
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">`,
    `    <background android:drawable="@drawable/ic_launcher_background" />`,
    `    <foreground android:drawable="@drawable/ic_launcher_foreground" />`,
    `    <monochrome android:drawable="@drawable/ic_launcher_foreground" />`,
    `</adaptive-icon>`,
    ``,
  ].join("\n");
}

function renderIconBackgroundXml(): string {
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<vector xmlns:android="http://schemas.android.com/apk/res/android"`,
    `    android:width="108dp"`,
    `    android:height="108dp"`,
    `    android:viewportWidth="108"`,
    `    android:viewportHeight="108">`,
    `    <path android:fillColor="#0A0A0E" android:pathData="M0,0 H108 V108 H0 Z" />`,
    `    <path android:strokeColor="#1F2438" android:strokeWidth="1.2" android:fillColor="#00000000" android:pathData="M24,24 H84 V84 H24 Z" />`,
    `</vector>`,
    ``,
  ].join("\n");
}

function renderIconForegroundXml(appId: string): string {
  const spec = APP_ICON_SPECS[appId] ?? APP_ICON_SPECS.notes;
  const strokeLines = (spec?.strokes ?? []).map(
    (d) => `        <path android:fillColor="#00000000" android:strokeColor="#FFFFFF" android:strokeWidth="1.85" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="${d}" />`,
  );
  const accentLines = (spec?.accentFills ?? []).map(
    (d) => `        <path android:fillColor="#4B6BFF" android:pathData="${d}" />`,
  );
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<vector xmlns:android="http://schemas.android.com/apk/res/android"`,
    `    android:width="108dp"`,
    `    android:height="108dp"`,
    `    android:viewportWidth="108"`,
    `    android:viewportHeight="108">`,
    `    <group android:translateX="32" android:translateY="32" android:scaleX="1.8333" android:scaleY="1.8333">`,
    ...strokeLines,
    ...accentLines,
    `    </group>`,
    `</vector>`,
    ``,
  ].join("\n");
}

function renderThinManifest(registry: SuiteRegistry, app: SuiteAppEntry): string {
  const permSet = new Set(app.permissions);
  const permissionLines = [
    registry.ipcPermission,
    ...app.permissions.filter((perm) => perm !== registry.ipcPermission),
  ].map((perm) => {
    const maxSdk = perm === "android.permission.SCHEDULE_EXACT_ALARM" && permSet.has("android.permission.USE_EXACT_ALARM")
      ? ' android:maxSdkVersion="32"' : "";
    return `    <uses-permission android:name="${escapeXml(perm)}"${maxSdk} />`;
  });

  if (permSet.has("android.permission.READ_MEDIA_IMAGES") && !permSet.has("android.permission.READ_EXTERNAL_STORAGE")) {
    permissionLines.push(
      `    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" tools:replace="android:maxSdkVersion" />`,
    );
  }
  if ((app.id === "files" || app.id === "camera") && !permSet.has("android.permission.WRITE_EXTERNAL_STORAGE")) {
    permissionLines.push(
      `    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" tools:replace="android:maxSdkVersion" />`,
    );
  }

  const featureLines = renderOptionalFeatures(app.permissions);
  const queryLines = renderQueries(registry, app);
  const extraFilters = app.intentFilters.map(renderIntentFilter);
  const flavorComponents = renderFlavorComponents(app);

  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android"`,
    `    xmlns:tools="http://schemas.android.com/tools">`,
    ...permissionLines,
    ...featureLines,
    ...queryLines,
    `    <application`,
    `        android:icon="@mipmap/ic_launcher"`,
    `        android:roundIcon="@mipmap/ic_launcher_round"`,
    `        android:label="${escapeXml(app.label)}">`,
    `        <activity`,
    `            android:name="ai.alphacompute.thinapp.ThinAppActivity"`,
    `            android:label="${escapeXml(app.label)}"`,
    `            android:exported="true"`,
    `            android:launchMode="singleTask"`,
    `            android:taskAffinity="${escapeXml(app.taskAffinity)}"`,
    `            android:windowSoftInputMode="adjustResize"`,
    `            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|density|navigation"`,
    `            android:theme="@style/AlphaTheme.Launch">`,
    `            <intent-filter>`,
    `                <action android:name="android.intent.action.MAIN" />`,
    `                <category android:name="android.intent.category.LAUNCHER" />`,
    `            </intent-filter>`,
    ...extraFilters,
    `        </activity>`,
    `        <activity`,
    `            android:name="ai.alphacompute.runtime.AlphaAgentOpenActivity"`,
    `            android:exported="true"`,
    `            android:permission="${escapeXml(registry.ipcPermission)}"`,
    `            android:excludeFromRecents="true"`,
    `            android:noHistory="true"`,
    `            android:theme="@android:style/Theme.Translucent.NoTitleBar">`,
    `            <intent-filter>`,
    `                <action android:name="ai.alphacompute.action.AGENT_OPEN" />`,
    `                <category android:name="android.intent.category.DEFAULT" />`,
    `                <data android:scheme="alpha" android:host="${escapeXml(app.id)}" />`,
    `            </intent-filter>`,
    `        </activity>`,
    ...flavorComponents,
    `    </application>`,
    `</manifest>`,
    "",
  ].join("\n");
}

function renderFlavorsGradle(registry: SuiteRegistry): string {
  const thinApps = registry.apps.filter((app) => app.surface === "app");
  const blocks = thinApps.map((app) => [
    `        ${app.id} {`,
    `            dimension 'alphaApp'`,
    `            applicationId '${app.applicationId}'`,
    `            resValue 'string', 'app_name', '${app.label.replaceAll("'", "\\'")}'`,
    `            buildConfigField 'String', 'ALPHA_APP_ID', '"${app.id}"'`,
    `            buildConfigField 'String', 'ALPHA_VIEW', '"${app.view ?? ""}"'`,
    `            buildConfigField 'String', 'ALPHA_SURFACE', '"${app.surface}"'`,
    `            buildConfigField 'String', 'ALPHA_ASSETS_PROFILE', '"${app.assetsProfile}"'`,
    `            buildConfigField 'boolean', 'ALPHA_IMAGE_ONLY', '${String(app.imageOnly)}'`,
    `            manifestPlaceholders = [`,
    `                alphaAppId: '${app.id}',`,
    `                alphaAppLabel: '${app.label.replaceAll("'", "\\'")}',`,
    `                alphaTaskAffinity: '${app.taskAffinity}',`,
    `            ]`,
    `        }`,
  ].join("\n"));

  const sourceSetBlocks = thinApps.map((app) => {
    const profile = FLAVOR_PLUGIN_PROFILES[app.id];
    const javaDirs = [
      `file('../generated/flavors/${app.id}/java')`,
      ...(profile?.sourceDirs ?? []).map((dir) => `file('${dir}')`),
    ];
    const resDirs = [
      `file('../generated/flavors/${app.id}/res')`,
      ...(profile?.resDirs ?? []).map((dir) => `file('${dir}')`),
    ];
    return [
      `        ${app.id} {`,
      `            manifest.srcFile file('../generated/flavors/${app.id}/AndroidManifest.xml')`,
      `            java.srcDirs += [${javaDirs.join(", ")}]`,
      `            res.srcDirs += [${resDirs.join(", ")}]`,
      `            assets.srcDirs += [file('src/${app.id}/assets')]`,
      `        }`,
    ].join("\n");
  });

  const dependencyLines: string[] = [];
  for (const app of thinApps) {
    const profile = FLAVOR_PLUGIN_PROFILES[app.id];
    if (!profile) continue;
    for (const moduleName of profile.modules) {
      dependencyLines.push(`    ${app.id}Implementation project('${moduleName}')`);
    }
  }

  return [
    `android {`,
    `    flavorDimensions += 'alphaApp'`,
    `    productFlavors {`,
    ...blocks,
    `    }`,
    `    sourceSets {`,
    ...sourceSetBlocks,
    `    }`,
    `}`,
    ``,
    `dependencies {`,
    ...dependencyLines,
    `}`,
    "",
  ].join("\n");
}

/** Computes all deterministic generated files for the Alpha NEXT multi-APK suite. */
export function buildSuiteOutputs(registry: SuiteRegistry, registryRaw: string): readonly GeneratedOutput[] {
  const outputs: GeneratedOutput[] = [];
  const push = (relativePath: string, content: string) => {
    outputs.push({ relativePath, content, sha256: sha256Hex(content) });
  };

  for (const app of registry.apps) {
    if (app.surface !== "app") continue;
    push(`flavors/${app.id}/AndroidManifest.xml`, renderThinManifest(registry, app));
    push(`flavors/${app.id}/java/ai/alphacompute/thinapp/FlavorPlugins.java`, renderFlavorPluginsJava(app));
    push(`flavors/${app.id}/res/mipmap-anydpi-v26/ic_launcher.xml`, renderAdaptiveIconXml());
    push(`flavors/${app.id}/res/mipmap-anydpi-v26/ic_launcher_round.xml`, renderAdaptiveIconXml());
    push(`flavors/${app.id}/res/drawable/ic_launcher_background.xml`, renderIconBackgroundXml());
    push(`flavors/${app.id}/res/drawable/ic_launcher_foreground.xml`, renderIconForegroundXml(app.id));
  }

  push("suite-flavors.gradle", renderFlavorsGradle(registry));

  const policyJson = `${JSON.stringify({
    schemaVersion: registry.schemaVersion,
    corePackage: registry.corePackage,
    ipcPermission: registry.ipcPermission,
    apps: registry.apps.map((app) => ({
      id: app.id,
      view: app.view,
      surface: app.surface,
      applicationId: app.applicationId,
      allowedAgentRoutePrefixes: app.allowedAgentRoutePrefixes,
      allowedCloudRoutePrefixes: app.allowedCloudRoutePrefixes,
      allowedSecureStoreSlots: app.allowedSecureStoreSlots,
      imageOnly: app.imageOnly,
    })),
  }, null, 2)}\n`;
  push("alpha-suite-policy.json", policyJson);

  const manifestJson = `${JSON.stringify({
    schemaVersion: 1,
    registrySha256: sha256Hex(registryRaw),
    corePackage: registry.corePackage,
    ipcPermission: registry.ipcPermission,
    counts: {
      total: registry.apps.length,
      core: registry.apps.filter((app) => app.surface === "overlay").length,
      thinApps: registry.apps.filter((app) => app.surface === "app").length,
      imageOnly: registry.apps.filter((app) => app.imageOnly).length,
      ocrApps: registry.apps.filter((app) => app.assetsProfile === "ocr").length,
    },
    apps: registry.apps.map((app) => ({
      id: app.id,
      view: app.view,
      surface: app.surface,
      applicationId: app.applicationId,
      label: app.label,
      defaultRoles: app.defaultRoles,
      assetsProfile: app.assetsProfile,
      imageOnly: app.imageOnly,
      viteEnv: app.surface === "overlay"
        ? { VITE_ALPHA_SURFACE: "overlay" }
        : { VITE_ALPHA_SURFACE: "app", VITE_ALPHA_VIEW: app.view },
      webOutDir: app.surface === "overlay" ? "dist-suite/overlay" : `dist-suite/${app.id}`,
      gradleTask: app.surface === "overlay" ? ":app:assembleLauncherRelease" : `:thin-app:assemble${app.id[0]?.toUpperCase() ?? ""}${app.id.slice(1)}Release`,
    })),
  }, null, 2)}\n`;
  push("suite-manifest.json", manifestJson);

  return outputs;
}

function main(argv: readonly string[]): number {
  const checkOnly = argv.includes("--check");
  const jsonOutput = argv.includes("--json");
  const outIndex = argv.indexOf("--out");
  const outDir = outIndex >= 0 && argv[outIndex + 1] ? resolve(argv[outIndex + 1] ?? DEFAULT_OUT_DIR) : DEFAULT_OUT_DIR;
  const registryIndex = argv.indexOf("--registry");
  const registryPath = registryIndex >= 0 && argv[registryIndex + 1]
    ? resolve(argv[registryIndex + 1] ?? DEFAULT_REGISTRY_PATH)
    : DEFAULT_REGISTRY_PATH;

  const registryRaw = readFileSync(registryPath, "utf8");
  const registry = loadSuiteRegistry(registryPath);
  const outputs = buildSuiteOutputs(registry, registryRaw);

  const drifted: string[] = [];
  const written: string[] = [];

  for (const output of outputs) {
    const target = join(outDir, output.relativePath);
    const current = existsSync(target) ? readFileSync(target, "utf8") : undefined;
    if (current === output.content) continue;
    if (checkOnly) {
      drifted.push(output.relativePath);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, output.content, "utf8");
      written.push(output.relativePath);
    }
  }

  const policyOutput = outputs.find((item) => item.relativePath === "alpha-suite-policy.json");
  if (policyOutput !== undefined && outDir === DEFAULT_OUT_DIR) {
    const currentIpcPolicy = existsSync(DEFAULT_IPC_POLICY_PATH)
      ? readFileSync(DEFAULT_IPC_POLICY_PATH, "utf8")
      : undefined;
    if (currentIpcPolicy !== policyOutput.content) {
      if (checkOnly) {
        drifted.push("../alpha-ipc/src/main/assets/alpha-suite-policy.json");
      } else {
        mkdirSync(dirname(DEFAULT_IPC_POLICY_PATH), { recursive: true });
        writeFileSync(DEFAULT_IPC_POLICY_PATH, policyOutput.content, "utf8");
        written.push("../alpha-ipc/src/main/assets/alpha-suite-policy.json");
      }
    }
  }

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify({
      ok: drifted.length === 0,
      mode: checkOnly ? "check" : "write",
      registryPath,
      outDir,
      apps: registry.apps.length,
      generatedFiles: outputs.length,
      written,
      drifted,
    }, null, 2)}\n`);
  } else if (checkOnly) {
    if (drifted.length > 0) {
      process.stderr.write(`Suite outputs drifted (${drifted.length}): ${drifted.join(", ")}\n`);
    } else {
      process.stdout.write(`Suite registry valid (${registry.apps.length} apps, ${outputs.length} generated files up to date)\n`);
    }
  } else {
    process.stdout.write(`Generated ${outputs.length} suite files (${written.length} updated) for ${registry.apps.length} apps in ${outDir}\n`);
  }

  return drifted.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
