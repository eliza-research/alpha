// spec/app/settings/index.md, "Story: Find a setting and come back"; spec/app/settings/index.md, "Story: Reach what another area owns"; spec/app/settings/facts.md, "Story: See what the phone says"; spec/app/settings/android.md, "Story: Change what only Android can change"; spec/app/shell/index.md, "On the launcher the first page of Settings and of Workflows draws no Back, and Android's Back still leaves it"
import {
  Banner,
  Button,
  ConfirmDialog,
  ListGroup,
  type SettingsAccess,
  type SettingsAccessWord,
  SettingsAboutPage,
  SettingsActivityPage,
  type SettingsActivityPageProps,
  SettingsAndroidRow,
  type SettingsAndroidStart,
  type SettingsAndroidTarget,
  type SettingsAndroidTold,
  SettingsAppPage,
  type SettingsAppPageProps,
  SettingsAppsPage,
  SettingsBatteryPage,
  SettingsDeveloperPage,
  type SettingsDeviceRead,
  SettingsDisplayPage,
  SettingsFactRow,
  type SettingsFactReading,
  SettingsGeneralPage,
  SettingsCarrierPage,
  type SettingsNeighbour,
  SettingsNotificationsPage,
  SettingsPage,
  type SettingsPageName,
  SettingsPermissionsPage,
  SettingsPhonePage,
  type SettingsPreferencesNoticeProps,
  SettingsPrivacyPage,
  type SettingsResetNoticeProps,
  type SettingsRoleRowProps,
  type SettingsShare,
  SettingsSoundPage,
  SettingsTopPage,
  type SettingsTextSizePickerProps,
} from "@repo/ui";
import type { ManagedRuntime } from "effect";
import type { MailBackgroundStatus } from "@elizaos/plugin-inbox-client";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import * as Records from "../../gen/app__account__records.ts";
import { useMachine as useRecords } from "../../gen/app__account__records.react.ts";
import type { Machine as RecordsMachine } from "../../gen/app__account__records.effect.vibe";
import type * as ActivityGen from "../../gen/app__settings__activity.ts";
import { useMachine as useActivity } from "../../gen/app__settings__activity.react.ts";
import type { Machine as ActivityMachine } from "../../gen/app__settings__activity.effect.vibe";
import type * as AndroidGen from "../../gen/app__settings__android.ts";
import { useMachine as useAndroid } from "../../gen/app__settings__android.react.ts";
import type { Machine as AndroidMachine } from "../../gen/app__settings__android.effect.vibe";
import * as FactsGen from "../../gen/app__settings__facts.ts";
import { useMachine as useFacts } from "../../gen/app__settings__facts.react.ts";
import type { Machine as FactsMachine } from "../../gen/app__settings__facts.effect.vibe";
import type * as PrefsGen from "../../gen/app__settings__preferences.ts";
import { useMachine as usePrefs } from "../../gen/app__settings__preferences.react.ts";
import type { Machine as PrefsMachine } from "../../gen/app__settings__preferences.effect.vibe";
import type * as ResetGen from "../../gen/app__settings__reset.ts";
import { useMachine as useReset } from "../../gen/app__settings__reset.react.ts";
import type { Machine as ResetMachine } from "../../gen/app__settings__reset.effect.vibe";
import { type Neighbour, type Page, parent, passwordPage, row as placeOn } from "../../gen/app__settings.ts";
import { useMachine as usePages } from "../../gen/app__settings.react.ts";
import type { Machine as PagesMachine } from "../../gen/app__settings.effect.vibe";
import { useMachine as useDeveloper } from "../../gen/app__settings__developer.react.ts";
import type { Machine as DeveloperMachine } from "../../gen/app__settings__developer.effect.vibe";
import { useMachine as useShell } from "../../gen/app__shell.react.ts";
import type { Machine as ShellMachine } from "../../gen/app__shell.effect.vibe";
import { useMachine as useLayers } from "../../gen/app__shell__layers.react.ts";
import type { Machine as LayersMachine } from "../../gen/app__shell__layers.effect.vibe";
import { listed, pageInert, top } from "../../gen/app__shell__layers.ts";
import type { Alpha } from "../runtime/ui.tsx";
import type { Device } from "../platform/index.vibe";
import type { SystemSettings } from "../platform/index.vibe";
import { useTimed } from "../runtime/ui.tsx";
import { untimed } from "../runtime/index.vibe";
import type { Time } from "../runtime/index.vibe";
import { useMachine as useListener } from "../../gen/app__voice__listener.react.ts";
import type { Machine as ListenerMachine } from "../../gen/app__voice__listener.effect.vibe";
import { ListenerControls } from "./ListenerControls.tsx";
import type { AccessSurface } from "../startup/settingsAccess.vibe";
import { AccessReview } from "../startup/SettingsAccess.tsx";
import { AppBack } from "../shell/ui.tsx";
import { closeLayer, openLayer } from "../shell/index.vibe";
import { Layers, Over, Under } from "../shell/ui.tsx";
import { AccountSheetFrame, AccountStatus } from "../account/index.tsx";
import { accountLayer } from "../account/profile.vibe";
import { CalendarAccount, type CalendarConnection } from "./calendar.vibe";
import type { PasswordProviderShelf } from "./passwords.vibe";
import { PasswordEntries } from "./PasswordEntries.tsx";
import { ProtonPass } from "./ProtonPass.tsx";
import { InboxNotices } from "../inbox/notices.vibe";
import type * as BrowserAlerts from "../../gen/app__notices__browserAlerts.effect.vibe";
import { useMachine as useBrowserAlerts } from "../../gen/app__notices__browserAlerts.react.ts";

/** What every Settings page reads: where the owner is, the phone's facts, the hand-overs to Android, the preferences, the reset and the developer tools. */
export type SettingsRuntime = ManagedRuntime.ManagedRuntime<PagesMachine | CalendarAccount | FactsMachine | PasswordProviderShelf | AccessSurface | ActivityMachine | RecordsMachine | AndroidMachine | PrefsMachine | ResetMachine | DeveloperMachine | ListenerMachine | ShellMachine | LayersMachine | Time | Device | SystemSettings | InboxNotices | BrowserAlerts.Machine, unknown>;

/** What the frame gives each page: the runtime, Alpha's places, and the props every page shares. */
export interface PageProps {
  readonly runtime: SettingsRuntime;
  readonly alpha: Alpha;
  readonly common: Common;
}

/** The props every page of Settings shares: the way back, the rows below, Android's pages and where the owner was. */
export interface Common {
  readonly onBack?: () => void;
  readonly actions?: ReactNode;
  readonly onOpen: (page: SettingsPageName) => void;
  readonly onHandOver: (neighbour: SettingsNeighbour) => void;
  readonly starting?: SettingsAndroidStart;
  readonly onAndroid: (start: SettingsAndroidStart) => void;
  readonly told?: SettingsAndroidTold;
  readonly place: number;
  readonly onPlace: (row: number) => void;
}

const pageNames: Record<Exclude<Page, "BrowserPasswordsPage" | "CarrierInfoPage" | "PrivacyNotifications">, SettingsPageName> = {
  Top: "top", General: "general", Display: "display", Sound: "sound", Notifications: "notifications", Battery: "battery",
  NetworkPage: "network", CarrierPage: "carrier", PhonePage: "phone", Privacy: "privacy", Permissions: "permissions", Apps: "apps",
  InboxApp: "inbox", WorkflowsApp: "workflows", CalendarApp: "calendar", CameraApp: "camera", PhotosApp: "photos", MapsApp: "maps", NotesApp: "notes", PasswordsPage: "passwords",
  About: "about", Activity: "activity", Licences: "licences", Developer: "developer", Problems: "problems",
};
const pagesNamed = Object.fromEntries(Object.entries(pageNames).map(([page, name]) => [name, page])) as Record<SettingsPageName, Page>;

const neighbourNames: Record<Neighbour, SettingsNeighbour> = {
  AccountAndPlan: "account-and-plan", GoogleAndEmail: "google-and-email", CalendarAccount: "calendar-account",
  NotificationCollection: "notification-collection", Listener: "listener", Conversations: "conversations", RestartDetails: "restart-details", CalendarBackups: "calendar-backups",
};
const neighboursNamed = Object.fromEntries(Object.entries(neighbourNames).map(([neighbour, name]) => [name, neighbour])) as Record<SettingsNeighbour, Neighbour>;

const targetNames: Record<AndroidGen.Target, SettingsAndroidTarget> = {
  AndroidHome: "android-home", AccountsSync: "accounts-sync", WifiNetworks: "wifi-networks", BluetoothDevices: "bluetooth-devices",
  MobileNetworks: "mobile-networks", AirplaneMode: "airplane-mode", ScreenLock: "screen-lock", DefaultApps: "default-apps",
  PasswordAutofill: "password-autofill", DisplaySettings: "display-settings", Brightness: "brightness", SoundSettings: "sound-settings", DoNotDisturb: "do-not-disturb",
  BatterySaver: "battery-saver", AlphaAlerts: "alpha-alerts", AlertChannel: "alert-channel", NotificationAccess: "notification-access",
  WorkflowAlerts: "workflow-alerts", AppPermissions: "app-permissions", PhotoPermissions: "photo-permissions", AllFilesAccess: "all-files-access",
  LocationSettings: "location-settings", InternetPanel: "internet-panel", SimCards: "sim-cards", AccessPointNames: "access-point-names",
  AboutPhone: "about-phone", DeveloperOptions: "developer-options",
};
const targetsNamed = Object.fromEntries(Object.entries(targetNames).map(([target, name]) => [name, target])) as Record<SettingsAndroidTarget, AndroidGen.Target>;

const toldWords: Record<AndroidGen.Told, SettingsAndroidTold | undefined> = { Silent: undefined, SaidNearby: "nearby", SaidUnavailable: "unavailable", SaidNoAnswer: "no-answer" };

const accessNames: Record<FactsGen.Access, SettingsAccess> = {
  CameraAccess: "camera", MicrophoneAccess: "microphone", LocationAccess: "location", CalendarAccess: "calendar", PhotosAccess: "photos", FilesAccess: "files", NotificationsAccess: "notifications",
};
const accessWords: Record<FactsGen.AccessWord, SettingsAccessWord> = { AccessWaiting: "waiting", AccessUnavailable: "unavailable", Allowed: "allowed", Approximate: "approximate", Off: "off" };
const roleWords: Record<FactsGen.RoleWord, SettingsRoleRowProps["word"]> = {
  RoleWaiting: "waiting", RoleUnavailable: "unavailable", NotOnThisPhone: "not-on-this-phone", HeldByAlpha: "alpha", HeldByAnother: "another", NotHeldByAlpha: "not-alpha",
};

const themeNames: Record<PrefsGen.Theme, "system" | "light" | "dark"> = { System: "system", Light: "light", Dark: "dark" };
const themesNamed = { system: "System", light: "Light", dark: "Dark" } as const satisfies Record<"system" | "light" | "dark", PrefsGen.Theme>;
const noticeNames: Record<PrefsGen.Notice, SettingsPreferencesNoticeProps["notice"] | undefined> = {
  Quiet: undefined, NotSaved: "not-saved", SizeNotConfirmed: "size-not-confirmed", SizeUnavailable: "size-unavailable", NotRecovered: "not-recovered",
};
const shareNames: Record<PrefsGen.Share, SettingsShare> = {
  AgentLocation: "agent-location",
  BrowserPage: "browser-page",
  GmailChanges: "gmail-changes",
  CalendarEdits: "calendar-edits",
  TelegramContext: "telegram-context",
  SlackContext: "slack-context",
};
const sharesNamed = Object.fromEntries(Object.entries(shareNames).map(([share, name]) => [name, share])) as Record<SettingsShare, PrefsGen.Share>;

const saidNames: Record<ResetGen.Said, SettingsResetNoticeProps["said"] | undefined> = {
  Quiet: undefined, EraseUnavailable: "erase-unavailable",
};

const loading = (timed: { readonly read: { readonly status: string } }) => timed.read.status === "Loading";

const collectionWords = { paused: "Paused", "no access": "No access", waiting: "Waiting" } as const;

const sounds: Record<string, string> = { all: "Off", priority: "Priority only", alarms: "Alarms only", none: "On" };

/** What the phone said about one fact, in the words and state the row shows. */
function reading(facts: FactsGen.Facts | undefined, fact: FactsGen.Fact): SettingsFactReading {
  if (facts === undefined) return { word: "waiting" };
  const word = FactsGen.word(facts, fact);
  if (word === "Waiting") return { word: "waiting" };
  if (word === "Unavailable") return { word: "unavailable" };
  const value = facts.reported.find((one) => one.fact === fact)?.value ?? "";
  if (value === "on") return { word: "reported", value: "On", status: "ok" };
  if (value === "paused" || value === "no access" || value === "waiting") return { word: "reported", value: collectionWords[value], status: "warn" };
  if (value === "some off") return { word: "reported", value: "Some off", status: "warn" };
  if (value === "off") return { word: "reported", value: "Off", status: "off" };
  if (fact === "Sound") return { word: "reported", value: sounds[value] ?? value };
  if (fact === "Battery") return { word: "reported", value: value.endsWith(" charging") ? `${value.replace(" charging", "")}%, charging` : `${value}%` };
  return { word: "reported", value };
}

/** Each access as the phone last said, never allowed where it did not say. */
function grants(facts: FactsGen.Facts | undefined): Record<SettingsAccess, SettingsAccessWord> {
  const all = Object.keys(accessNames) as FactsGen.Access[];
  return Object.fromEntries(all.map((access) => [accessNames[access], facts === undefined ? "waiting" : accessWords[FactsGen.accessWord(facts, access)]])) as Record<SettingsAccess, SettingsAccessWord>;
}

/** How the phone's read of the device preferences stands. */
function deviceRead(prefs: PrefsGen.Preferences): SettingsDeviceRead {
  const status = prefs.document.read.status;
  return status === "Loaded" ? "loaded" : status === "Failed" ? "failed" : "reading";
}

/** Manage a Settings ConfirmDialog's open state, shell DialogLayer registration, and Back handler. */
export function useConfirmDialogLayer(alpha: Alpha, layerId: string) {
  const [asking, setAsking] = useState(false);
  const closeDialog = () => {
    setAsking(false);
    alpha.taking(`layer:${layerId}`, () => Promise.resolve(false));
    void alpha.runtime.runPromiseExit(closeLayer(layerId));
  };
  const openDialog = () => {
    setAsking(true);
    alpha.taking(`layer:${layerId}`, () => {
      closeDialog();
      return Promise.resolve(true);
    });
    void alpha.runtime.runPromiseExit(openLayer(layerId, "DialogLayer", true));
  };
  return { asking, openDialog, closeDialog };
}

/** The device preferences as the Privacy and Inbox pages show and change them, each change offered exactly when the rules allow it. */
function useDevice(runtime: SettingsRuntime, alpha: Alpha) {
  const { state, can, send } = useTimed(runtime, usePrefs);
  const { asking, openDialog, closeDialog } = useConfirmDialogLayer(alpha, "settings-recover-confirm");
  if (!state) return undefined;
  const read = deviceRead(state);
  const offer = <E extends PrefsGen.Event>(event: (value: boolean) => E) => (value: boolean) => {
    if (can(event(value), "Owner")) void send(event(value), "Owner");
  };
  const recover = { type: "recover", at: untimed } as const;
  return {
    read,
    askFirst: read !== "loaded" || state.askFirst,
    images: read === "loaded" && state.images,
    shares: Object.fromEntries(state.shares.map((share) => [shareNames[share], true])) as Partial<Record<SettingsShare, boolean>>,
    saving: loading(state.saving),
    recovering: loading(state.recovering),
    onAskFirstChange: offer((askFirst) => ({ type: "setAskFirst", askFirst, at: untimed })),
    onImagesChange: offer((images) => ({ type: "setImages", images, at: untimed })),
    onShareChange: (share: SettingsShare, on: boolean) => offer((value) => ({ type: "setShare", share: sharesNamed[share], on: value, at: untimed }))(on),
    onRecover: can(recover, "Owner") ? openDialog : undefined,
    recovery: (
      <ConfirmDialog
        open={asking && can(recover, "Owner")}
        title="Recover device settings?"
        confirmLabel="Recover"
        destructive
        onConfirm={() => {
          closeDialog();
          if (can(recover, "Owner")) void send(recover, "Owner");
        }}
        onCancel={closeDialog}
      >
        Ask before Alpha acts, Inbox images and what Alpha may share go back to how a new phone has them.
      </ConfirmDialog>
    ),
  };
}

/** Settings' first page; on the launcher it has no Back, as v119 drew it (prototype/model.js:6415, template.html:4159; spec/app/shell/index.md). */
function Top({ runtime, alpha, common }: PageProps) {
  const pages = usePages(runtime).state;
  const listener = useListener(runtime).state;
  return (
    <SettingsTopPage {...common} leading={<AppBack alpha={alpha} firstPage />} onPhone={pages?.phone ?? false}
      developer={pages?.development ?? false} accountDetail={<AccountStatus alpha={alpha} />} micMayBeOn={listener?.mayBeOn}
      onHandOver={(neighbour) => neighbour === "listener" ? common.onAndroid({ target: "android-home" }) : common.onHandOver(neighbour)} />
  );
}

function browserAlertReading(state: BrowserAlerts.Alerts | undefined): SettingsFactReading {
  if (!state || state.phase === "Reading") return { word: "waiting" };
  if (state.status === "Unavailable") return { word: "unavailable" };
  return state.status === "Enabled" ? { word: "reported", value: "On", status: "ok" } : { word: "reported", value: "Off", status: "off" };
}

// spec/app/settings/reset.md, "Erase all data, on the phone, asks the phone to show its disclosure and check the device credential, one review at a time"; spec/app/settings/facts.md, "Set as Home is offered when the newest answer reported a Home role that Alpha can take and does not hold, one request at a time"
function General({ runtime, alpha, common }: PageProps) {
  const pages = usePages(runtime).state;
  const { state: facts, can, send } = useTimed(runtime, useFacts);
  const reset = useTimed(runtime, useReset);
  const browserAlerts = useBrowserAlerts(runtime).state;
  const prefs = useTimed(runtime, usePrefs).state;
  const request = { type: "requestHome", at: untimed } as const;
  const onPhone = pages?.phone ?? false;
  const erase = { type: "erase", at: untimed, onPhone } as const;
  return (
    <SettingsGeneralPage
      {...common}
      wifi={reading(facts, "Wifi")}
      bluetooth={reading(facts, "Bluetooth")}
      mobileData={reading(facts, "MobileData")}
      theme={prefs && themeNames[prefs.theme]}
      alerts={onPhone ? reading(facts, "Alerts") : browserAlertReading(browserAlerts)}
      image={pages?.image ?? false}
      onPhone={onPhone}
      reviewing={reset.state !== undefined && loading(reset.state.review)}
      onErase={reset.can(erase) ? () => void reset.send(erase) : undefined}
      said={reset.state && saidNames[reset.state.said]}
      home={facts && roleWords[FactsGen.roleWord(facts, facts.home)]}
      assistant={facts && roleWords[FactsGen.roleWord(facts, facts.assistant)]}
      requestingHome={facts !== undefined && loading(facts.request)}
      onRequestHome={can(request) ? () => void send(request) : undefined}
      updates={alpha.slot("settings/update")}
    />
  );
}

// spec/app/settings/preferences.md, "Story: Choose how Alpha looks"; spec/app/settings/preferences.md, "Story: Make the text larger or smaller"
function Display({ runtime, common }: PageProps) {
  const onPhone = usePages(runtime).state?.phone ?? false;
  const { state, can, send } = useTimed(runtime, usePrefs);
  if (!state) return null;
  const size = ([75, 100, 115, 130, 150] as const).find((percent) => percent === state.size) ?? 0;
  const choose = (event: PrefsGen.Event) => {
    if (can(event, "Owner")) void send(event, "Owner");
  };
  return (
    <SettingsDisplayPage
      {...common}
      onPhone={onPhone}
      theme={themeNames[state.theme]}
      keeping={loading(state.keeping)}
      onChooseTheme={(theme) => choose({ type: "chooseTheme", theme: themesNamed[theme], at: untimed })}
      legible={state.legible}
      onLegibleChange={(legible) => choose({ type: "setLegible", legible, at: untimed })}
      size={size satisfies SettingsTextSizePickerProps["size"]}
      sizing={loading(state.sizing)}
      onChooseSize={(percent) => choose({ type: "chooseSize", percent, at: untimed })}
      notice={noticeNames[state.notice]}
    />
  );
}

// spec/app/settings/preferences.md, "Story: Decide whether Alpha asks before it acts"; spec/app/settings/preferences.md, "When the device preferences cannot be read, the owner can recover them: the phone resets them to its defaults, and they are read again"; spec/app/settings/index.md, "Set up Alpha access opens all permissions in review"; spec/app/settings/index.md, "Each page links to what another area owns there"
function Privacy({ runtime, alpha, common }: PageProps) {
  const device = useDevice(runtime, alpha);
  const { state: pages, can, send } = usePages(runtime);
  if (!device) return null;
  const { recovery, ...shown } = device;
  const review = { type: "reviewAllAccess" } as const;
  return (
    <>
      {recovery}
      <SettingsPrivacyPage {...common} {...shown} onPhone={pages?.phone ?? false} onSetUpAccess={can(review) ? () => void send(review) : undefined}>
        {alpha.slot("settings/voice")}
        <ListenerControls runtime={runtime} common={common} />
      </SettingsPrivacyPage>
    </>
  );
}

function Permissions({ runtime, common }: PageProps) {
  const facts = useFacts(runtime).state;
  const { state: pages, can, send } = usePages(runtime);
  const { state: alerts } = useBrowserAlerts(runtime);
  const open = { type: "openPrivacyNotifications" } as const;
  const onNotifications = can(open) ? () => void send(open) : undefined;
  if (!pages?.phone) {
    const observe = (access: FactsGen.Access): SettingsFactReading => {
      if (!facts) return { word: "waiting" };
      if (FactsGen.grantIs(facts, access, "Unasked")) return { word: "reported", value: "Ask", status: "warn" };
      const word = FactsGen.accessWord(facts, access);
      if (word === "AccessWaiting") return { word: "waiting" };
      if (word === "Allowed") return { word: "reported", value: "Allowed", status: "ok" };
      if (word === "Off") return { word: "reported", value: "Off", status: "off" };
      return { word: "unavailable", compact: true };
    };
    const alertWord = browserAlertReading(alerts);
    const notification = alertWord.word === "reported" && alertWord.value === "On" ? { ...alertWord, value: "Allowed" } : alertWord;
    return <SettingsPermissionsPage {...common} grants={grants(facts)} browser={{
      camera: observe("CameraAccess"), microphone: observe("MicrophoneAccess"), location: observe("LocationAccess"),
      photos: { word: "reported", value: "Selected", status: "warn" }, files: { word: "reported", value: "Chosen files", status: "warn" },
      notifications: notification,
    }} onNotifications={onNotifications} />;
  }
  return <SettingsPermissionsPage {...common} grants={grants(facts)} onNotifications={onNotifications} />;
}

function Phone({ alpha, common }: PageProps) {
  return (
    <SettingsPhonePage told={common.told} onBack={common.onBack}>
      {alpha.slot("settings/phone")}
    </SettingsPhonePage>
  );
}

// spec/app/settings/android.md, "Each Android page is offered on the Settings page it belongs to"
function Passwords({ runtime, common, alpha }: PageProps) {
  const service = reading(useFacts(runtime).state, "AutofillService");
  const settings = usePages(runtime).state;
  const canChoose = service.word === "reported" && (service.value === "None" || service.value === "Other");
  return (
    <SettingsPage title="Password manager" onBack={common.onBack} backLabel={settings?.page === "BrowserPasswordsPage" ? "Back to Settings" : "Back to Apps"} told={common.told} actions={common.actions}>
      {settings?.phone ? (
        <>
          <PasswordEntries runtime={runtime} />
          {service.word === "reported" ? <ListGroup heading="Autofill">
            <SettingsFactRow title="Autofill service" reading={service} />
            {canChoose ? <SettingsAndroidRow title="Use for autofill" target="password-autofill" starting={common.starting} onAndroid={common.onAndroid} /> : null}
          </ListGroup> : null}
          <ProtonPass runtime={runtime} alpha={alpha} />
        </>
      ) : (
        <ListGroup heading="Other">
          <SettingsFactRow title="Proton Pass" reading={{ word: "reported", value: "Browser" }} />
        </ListGroup>
      )}
    </SettingsPage>
  );
}

function Apps({ runtime, common }: PageProps) {
  const shell = useShell(runtime);
  const pages = usePages(runtime).state;
  const appViews = { browser: "Browser", files: "Files", messages: "Messages" } as const;
  return (
    <SettingsAppsPage
      {...common}
      image={pages?.image ?? false}
      onOpenApp={(app) => {
        const open = { type: "openView", view: appViews[app] } as const;
        if (shell.can(open)) void shell.send(open);
      }}
    />
  );
}

const calendarStatuses: Record<CalendarConnection, NonNullable<SettingsAppPageProps["calendarStatus"]>> = {
  Checking: "checking", NoGrant: "not-connected", ReadOnly: "read-only", Writable: "connected", Unchecked: "unchecked",
};

const inboxWatchPhases: Record<MailBackgroundStatus["status"], NonNullable<SettingsAppPageProps["inboxWatch"]>["phase"]> = {
  "web-unavailable": "off", unavailable: "stopped", disabled: "off", waiting: "waiting",
  "watching-new-mail": "watching", "catching-up": "catchingUp", "history-expired": "expired",
  unsupported: "stopped", retrying: "retrying", "grant-unavailable": "noLongerAllowed", "capacity-reached": "stopped",
};
const inboxCheckedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const noInboxWatch = () => undefined;
const noInboxChanges = () => noInboxWatch;

function App({ runtime, alpha, common, app }: PageProps & { app: "inbox" | "workflows" | "calendar" | "camera" | "photos" | "maps" | "notes" }) {
  const facts = useFacts(runtime).state;
  const phone = usePages(runtime).state?.phone;
  const device = useDevice(runtime, alpha);
  const calendar = runtime.runSync(CalendarAccount);
  const status = useSyncExternalStore((listener) => calendar.subscribe(listener), () => calendar.snapshot(), () => calendar.snapshot());
  const notices = app === "inbox" ? runtime.runSync(InboxNotices) : undefined;
  const watching = useSyncExternalStore(
    (listener) => (notices ? notices.subscribe(listener) : noInboxChanges()),
    () => (notices ? notices.snapshot() : noInboxWatch()),
    noInboxWatch,
  );
  const delivery = watching?.delivery;
  return (
    <>
    {device?.recovery}
    <SettingsAppPage
      {...common}
      app={app}
      onPhone={phone}
      calendarStatus={app === "calendar" ? calendarStatuses[status] : undefined}
      inboxWatch={notices?.supported && delivery ? {
        phase: delivery.notificationsAllowed === false ? "noLongerAllowed" : inboxWatchPhases[delivery.status],
        account: watching?.account,
        checkedAt: delivery.lastSyncAt ? inboxCheckedAt.format(delivery.lastSyncAt) : undefined,
        onSettings: () => void runtime.runPromise(notices.settings()),
      } : undefined}
      grants={grants(facts)}
      read={device?.read}
      images={device?.images}
      saving={device?.saving}
      recovering={device?.recovering}
      onImagesChange={device?.onImagesChange}
      onRecover={device?.onRecover}
    />
    </>
  );
}

function About({ runtime, alpha, common }: PageProps) {
  const facts = useFacts(runtime).state;
  const pages = usePages(runtime).state;
  return (
    <SettingsAboutPage {...common} onPhone={pages?.phone ?? false} alphaVersion={reading(facts, "Versions")} androidVersion={reading(facts, "AndroidVersion")}>
      {alpha.slot("settings/about")}
    </SettingsAboutPage>
  );
}

// spec/app/settings/developer.md, "Export diagnostics shares the log and Alpha's diagnostics, one export at a time, with ten seconds to start"
function Developer({ runtime, common }: PageProps) {
  const { state, can, send } = useTimed(runtime, useDeveloper);
  const facts = useFacts(runtime).state;
  const startExport = { type: "startExport", at: untimed } as const;
  return (
    <SettingsDeveloperPage
      {...common}
      version={reading(facts, "Versions")}
      exporting={state !== undefined && loading(state.exporting)}
      onExport={can(startExport) ? () => void send(startExport) : undefined}
    />
  );
}

const connections: Record<ActivityGen.Connection, SettingsActivityPageProps["connection"]> = {
  Ready: "ready", Starting: "starting", NeedsRestart: "needs-restart", NeedsRetry: "needs-retry", Offline: "offline", Unpackaged: "unpackaged",
};

/** Agent activity as reported by the resident host, with the conversation controls owned by Ask Alpha. */
function Activity({ runtime, alpha, common }: PageProps) {
  const { state, can, send } = useTimed(runtime, useActivity);
  const records = useRecords(runtime);
  const layers = useLayers(runtime).state;
  if (!state || !records.state || !layers) return null;
  const recovery = { type: "recover", how: state.connection === "NeedsRestart" ? "Restart" : "Retry", connection: state.connection } as const;
  const review = records.state;
  const archive = { type: "archive", review: review.review.ticket, reviewing: state.connection === "NeedsRestart", held: pageInert(layers) } as const;
  const close = { type: "closeReview" } as const;
  const canConfirm = records.can(archive);
  const archiving = review.attempt.outcome === "Sent";
  const needsPhoneRestart = Records.phoneMustRestart(review);
  const canRecover = can(recovery) && Records.canOpened(review);
  const dismiss = () => { if (records.can(close)) void records.send(close); };
  const refresh = { type: "refreshActions", connection: state.connection, at: untimed } as const;
  const decline = (proposal: string) => ({ type: "decline", proposal, connection: state.connection, at: untimed }) as const;
  const settle = (proposal: string, happened: boolean) => ({ type: "reconcileAction", proposal, happened, connection: state.connection, at: untimed }) as const;
  return (
    <SettingsActivityPage
      onBack={common.onBack}
      connection={connections[state.connection]}
      actions={state.rows.map((row) => ({ ...row, declinable: can(decline(row.proposal)), unsettled: can(settle(row.proposal, true)) }))}
      reading={state.connection === "Ready" && (state.journal.read.status === "Idle" || state.journal.read.status === "Loading")}
      failed={state.journal.read.status === "Failed"}
      unconfirmed={state.wordResult === "WordUnconfirmed"}
      onRefresh={can(refresh) ? () => void send(refresh) : undefined}
      onDecline={(proposal) => { if (can(decline(proposal))) void send(decline(proposal)); }}
      onReconcile={(proposal, happened) => { if (can(settle(proposal, happened))) void send(settle(proposal, happened)); }}
      onRecover={canRecover ? () => void send(recovery) : undefined}
      onHandOver={common.onHandOver}
    >
      {needsPhoneRestart ? <Banner variant="warn">Alpha couldn’t confirm the archive. Restart your phone before trying again.</Banner> : null}
      {review.showing && !canConfirm && !archiving ? (
        <Banner variant={review.review.status === "Loading" ? "info" : "warn"}>
          {review.review.status === "Loading" ? "Checking retained records…" : "Alpha couldn’t confirm the recovery. Close this review and try again."}
          <Button variant="ghost" size="sm" onClick={dismiss}>Close review</Button>
        </Banner>
      ) : null}
      <ConfirmDialog
        open={review.showing && (canConfirm || archiving)}
        title="Restart Alpha?"
        confirmLabel="Archive and restart"
        destructive
        loading={archiving}
        onConfirm={() => { if (canConfirm) void records.send(archive); }}
        onCancel={dismiss}
      >
        Archive {review.kept} {review.kept === 1 ? "record" : "records"} held by the failed agent and restart it.
      </ConfirmDialog>
      {alpha.slot("settings/activity")}
    </SettingsActivityPage>
  );
}

/** A page of Settings, given the runtime, Alpha and the props every page shares. */
export type Drawn = (props: PageProps) => ReactNode;

function Notifications({ runtime, alpha, common }: PageProps) {
  const facts = useFacts(runtime).state;
  const pages = usePages(runtime).state;
  const { state: web, can, send } = useBrowserAlerts(runtime);
  const change = { type: "choose", desired: web?.status !== "Enabled" } as const;
  const browserAlerts = pages?.phone ? undefined : {
    enabled: !web || web.status === "Unavailable" ? undefined : web.status === "Enabled",
    reading: !web || web.phase === "Reading",
    saving: web?.phase === "Writing",
    saveFailed: web?.saveFailed,
    onChoose: can(change, "Owner") ? (enabled: boolean) => void send({ type: "choose", desired: enabled }, "Owner") : undefined,
  };
  return <SettingsNotificationsPage {...common} onPhone={pages?.phone} browserAlerts={browserAlerts}
    backLabel={pages?.page === "PrivacyNotifications" ? "Back to Privacy" : "Back to General"}
    alerts={reading(facts, "Alerts")} doNotDisturb={reading(facts, "Sound")} collectionPolicy={pages?.phone ? alpha.slot("settings/notification-collection") : undefined} channels={facts?.alerts ?? []} />;
}

const drawn: Partial<Record<Page, Drawn>> = {
  Top,
  General,
  CarrierInfoPage: ({ common }) => <SettingsCarrierPage fields={[]} onPhone={false} onBack={common.onBack} />,
  Display,
  Sound: ({ runtime, common }) => {
    const facts = useFacts(runtime).state;
    return <SettingsSoundPage {...common} sound={reading(facts, "Sound")} media={reading(facts, "MediaVolume")} ring={reading(facts, "RingVolume")} alarm={reading(facts, "AlarmVolume")} />;
  },
  Notifications,
  PrivacyNotifications: Notifications,
  Battery: ({ runtime, common }) => <SettingsBatteryPage {...common} battery={reading(useFacts(runtime).state, "Battery")} />,
  PhonePage: Phone,
  Privacy,
  Permissions,
  Apps,
  PasswordsPage: Passwords,
  BrowserPasswordsPage: Passwords,
  InboxApp: (props) => <App {...props} app="inbox" />,
  WorkflowsApp: (props) => <App {...props} app="workflows" />,
  CalendarApp: (props) => <App {...props} app="calendar" />,
  CameraApp: (props) => <App {...props} app="camera" />,
  PhotosApp: (props) => <App {...props} app="photos" />,
  MapsApp: (props) => <App {...props} app="maps" />,
  NotesApp: (props) => <App {...props} app="notes" />,
  About,
  Activity,
  Developer,
};

/**
 * How a page of Settings is drawn in the stack: `mount` changes only when the page is opened or shown again by Back,
 * so the pages under it stay mounted; a page shown again by Back takes focus on the row the owner left
 * (`SettingsPlaceProps`) and does not rise, as v119 removed the page on top at once (model.js:5139, 5167).
 */
interface Layer {
  readonly mount: number;
  readonly rises: boolean;
}

/** The pages from the first page of Settings to `page`, as v119 stacked them (template.html:4155-4156). */
function pagesTo(page: Page): Page[] {
  const pages = [page];
  while (pages[0] !== "Top") pages.unshift(parent(pages[0] ?? "Top"));
  return pages;
}

/**
 * Settings: the page showing, built from its own component, each control offered exactly when its event is, with
 * what Android said about the last page it was asked to open. `further` draws the pages whose machines their own
 * screens read.
 * @model spec/app/settings/index.md
 */
export function Settings({ runtime, alpha, further }: { runtime: SettingsRuntime; alpha: Alpha; further: Partial<Record<Page, Drawn>> }) {
  const { state, cause, can, send } = usePages(runtime);
  const android = useTimed(runtime, useAndroid);
  const facts = useTimed(runtime, useFacts);
  const layers = useLayers(runtime);
  const [entered, setEntered] = useState<{ page?: Page; depth: number; opened: boolean; mounts: number; layers: Partial<Record<Page, Layer>> }>({ depth: 0, opened: false, mounts: 0, layers: {} });
  if (state && entered.page !== state.page) {
    const opened = state.places.length > entered.depth;
    const shownAgain = entered.page !== undefined && pagesTo(entered.page).includes(state.page);
    setEntered({ page: state.page, depth: state.places.length, opened, mounts: entered.mounts + 1, layers: { ...entered.layers, [state.page]: { mount: entered.mounts + 1, rises: !shownAgain } } });
  }
  if (cause) return (
    <div className="flex h-full flex-col gap-3 bg-background p-4 pt-[max(--spacing(4),var(--alpha-safe-top))] text-foreground">
      <div className="flex items-center">
        <AppBack alpha={alpha} />
      </div>
      <Banner variant="destructive">Alpha could not open Settings</Banner>
    </div>
  );
  if (!state) return <section aria-label="Settings" aria-busy className="relative flex h-full min-h-0 flex-col"><SettingsPage title="Settings" top leading={<AppBack alpha={alpha} firstPage />} /></section>;
  const page = state.page;
  const goBack = { type: "goBack" } as const;
  const closeAccount = { type: "closeLayer", id: accountLayer } as const;
  const accountPanel = alpha.slot("settings/account");
  const start = android.state && loading(android.state.start) ? { target: targetNames[android.state.target], channel: android.state.channel || undefined } : undefined;
  const refresh = { type: "refresh", at: untimed } as const;
  const micMayBeOn = facts.state?.grants.some((grant) => grant.access === "MicrophoneAccess" && (grant.grant === "Granted" || grant.grant === "Limited")) ?? false;
  const common: Common = {
    actions: state.development && state.phone && (page === "Top" || page === "General" || passwordPage(page)) && facts.can(refresh)
      ? <Button variant="ghost" size="sm" className="min-h-11" onClick={() => void facts.send(refresh)}>Refresh</Button>
      : undefined,
    onBack: can(goBack) ? () => void send(goBack) : undefined,
    onOpen: (name) => {
      const target = name === "carrier" && !state.phone ? "CarrierInfoPage" : pagesNamed[name];
      const open = { type: "open", page: target } as const;
      if (can(open)) void send(open);
    },
    onHandOver: (name) => {
      const hand = { type: "handOver", neighbour: neighboursNamed[name], micMayBeOn } as const;
      if (can(hand)) void send(hand);
    },
    starting: start,
    onAndroid: ({ target, channel }) => {
      const handOff = { type: "handOff", page, target: targetsNamed[target], channel: channel ?? "", at: untimed } as const;
      if ((!passwordPage(page) || state.phone) && android.can(handOff)) void android.send(handOff);
    },
    told: android.state && toldWords[android.state.told],
    place: entered.opened && (state.places[state.places.length - 1] ?? 0) === 0 ? -1 : state.places[state.places.length - 1] ?? 0,
    onPlace: (focused) => {
      if (focused !== (state.places[state.places.length - 1] ?? 0)) void send({ type: "focus", focused });
    },
  };
  const layer = (shown: Page) => {
    const Shown = further[shown] ?? drawn[shown];
    if (!Shown) return null;
    const drawnPage = <Shown runtime={runtime} alpha={alpha} common={shown === page ? common : { ...common, place: placeOn(state, shown) }} />;
    const { mount, rises } = entered.layers[shown] ?? { mount: 0, rises: true };
    const key = `${shown}:${mount}`;
    return shown === "Top" ? <Under key={key} covered={page !== "Top"}>{drawnPage}</Under>
      : <Over key={key} inert={shown !== page} aria-hidden={shown !== page || undefined} className={rises ? undefined : "motion-safe:animate-none"}>{drawnPage}</Over>;
  };
  return (
    <section aria-label="Settings" className="relative flex h-full min-h-0 flex-col">
      {state.phone && facts.state?.read.read.status === "Failed" && (page === "Top" || page === "General") ? <Banner variant="warn" className="mx-4 mt-[max(--spacing(3),var(--alpha-safe-top))]">The phone did not answer</Banner> : null}
      <Layers>{pagesTo(page).map(layer)}</Layers>
      <AccessReview runtime={runtime} />
      {accountPanel && layers.state && listed(layers.state, accountLayer) ? (
        <AccountSheetFrame
          open={top(layers.state).id === accountLayer}
          onClose={() => { if (layers.can(closeAccount)) void layers.send(closeAccount); }}
        >
          {accountPanel}
        </AccountSheetFrame>
      ) : null}
    </section>
  );
}
