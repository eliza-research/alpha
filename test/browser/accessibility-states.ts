import { expect, type Page } from '@playwright/test';
import {openCanonicalCalendarForm} from './helpers/canonical-calendar';
import {openLegacyNotes,openLegacyAttachment} from './helpers/legacy-notes';
import {openOwnedPhotoViewer} from './helpers/owned-photo';
import {installHomeCalendar} from './helpers/home-calendar';
import {calendarSyncFixture} from './calendar-sync-fixture';
import {settled} from './helpers/settled';

/**
 * The retained MVP surface, as a list of states the accessibility sweep visits.
 *
 * "live" states use the product adapters with no connection and no data: they are what a
 * new or disconnected phone shows, including each app's empty, unavailable and
 * permission-denied states. The event form explicitly supplies a closed canonical
 * read port because a disconnected agent correctly refuses to open that form.
 * "mock" states are the labelled fixture mode with populated
 * lists and open subviews, reached by its `start=` deep links (development server only).
 */
export type State = {
  name: string; open: (page: Page, theme?: 'light' | 'dark') => Promise<void>;
  /** The subview this state must put on screen; opening fails if it is not the exposed one. */
  shows?: string;
};

const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));
const settle = async (page: Page) => {
  await expect(page.locator('.alpha-phone')).toBeVisible();
  // Entry motion has finished and fonts are loaded: final geometry, not a fixed wait.
  await settled(page);
};

const press = async (page: Page, steps: string[]) => { for (const step of steps) await page.getByRole('button', { name: step, exact: true }).first().click(); };
/** The named subview is on screen and exposed (not retired behind another subview). */
const showing = async (page: Page, subview?: string) => {
  if (subview) await expect(page.locator(`[data-alpha-subview="${subview}"]:not([inert])`)).toBeVisible();
};
const live = (name: string, steps: string[] = [], shows?: string): State => ({
  name: `live ${name}`, shows,
  open: async (page, theme) => {
    await page.addInitScript(offline);
    await page.goto(theme ? `/?theme=${theme}` : '/');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await press(page, steps);
    await settle(page);
    await showing(page, shows);
  },
});
/** Legacy-only controls remain covered through the explicit Older notes source. */
const legacyNotes = (name: string, steps: string[], shows?: string): State => ({
  name: `live ${name}`, shows,
  open: async (page, theme) => {
    await page.addInitScript(offline);
    await page.goto(theme ? `/?theme=${theme}` : '/');
    await openLegacyNotes(page);
    await press(page, steps);
    await settle(page);
    await showing(page, shows);
  },
});
/** Fixture screens that finish arriving on a timer: the control that marks them complete. */
const ARRIVES: Record<string, string> = {};
const mock = (start: string, steps: string[] = [], shows?: string): State => ({
  name: `mock ${[start, ...steps].join(' > ')}`, shows,
  open: async (page, theme) => {
    // Edit and info require a real library revision; prototype images have none.
    if(start==='photos:viewer'&&steps.some(step=>step==='Edit photo'||step==='Photo info'))await openOwnedPhotoViewer(page,theme);
    else await page.goto(`/?mode=mock&theme=${theme || 'light'}&start=${start}`);
    await settle(page);
    if (ARRIVES[start]) { await expect(page.getByRole('button', { name: ARRIVES[start], exact: true })).toBeVisible(); await settle(page); }
    if (steps.length) { await press(page, steps); await settle(page); }
    await showing(page, shows);
  },
});

/** Primary views and the subviews, dialogs and failure states reachable without a provider. */
export const LIVE_STATES: State[] = [
  live('Home'),
  live('Conversation', ['Open conversation']),
  live('Inbox (not connected)', ['Inbox']),
  live('Calendar', ['Calendar']),
  // An admitted read-only source exposes the real form; no calendar event write runs.
  {name:'live Calendar new event',shows:'calendar-form',open:async(page,theme)=>{await openCanonicalCalendarForm(page,theme);await settle(page);await showing(page,'calendar-form');}},
  live('Calendar month', ['Calendar', 'Month view']),
  live('Browser', ['Browser']),
  live('Browser tabs', ['Browser', 'Tabs']),
  live('Camera (unavailable)', ['Camera']),
  live('Photos (empty)', ['Photos']),
  live('Maps (no location)', ['Maps']),
  live('Notes (empty)', ['Notes']),
  legacyNotes('Notes new note', ['New note']),
  legacyNotes('Notes new folder', ['New folder']),
  legacyNotes('Notes recently deleted', ['New note', 'More', 'Delete', 'Recently deleted'], 'notes-trash'),
  live('Files', ['Files']),
  live('Workflows', ['Workflows']),
  live('Settings', ['Settings']),
  live('Settings models', ['Settings', 'Models']),
  live('Settings display', ['Settings', 'Display']),
  live('Settings privacy', ['Settings', 'Privacy & data']),
  live('Settings about', ['Settings', 'About']),
  live('Settings scheduled digests', ['Settings', 'Scheduled digests']),
  live('Settings agent connection', ['Settings', 'Agent connection']),
  // The remaining Settings pages, and each app's open menu, search field and editor.
  live('Settings character', ['Settings', 'Character']),
  live('Settings accounts', ['Settings', 'Accounts']),
  live('Settings connections', ['Settings', 'Connections']),
  live('Settings notifications', ['Settings', 'Notifications']),
  live('Settings calendar', ['Settings', 'Calendar']),
  live('Settings password manager', ['Settings', 'Password manager']),
  live('Browser menu', ['Browser', 'Menu']),
  live('Browser address', ['Browser', 'Edit address']),
  live('Calendar alarms', ['Calendar', 'Clock alarms']),
  legacyNotes('Notes note menu', ['New note', 'More']),
  {name:'live Notes source document',open:async(page,theme)=>{await page.addInitScript(offline);await page.goto(theme ? `/?theme=${theme}` : '/');await openLegacyAttachment(page);await settle(page);}},
  legacyNotes('Notes recorder', ['Record and transcribe'], 'notes-recorder'),
  live('Workflows new automation', ['Workflows', 'New automation'], 'automations-detail'),
];

/** The simulated browser inventory exists only in test-mocks builds. */
export const BROWSER_APP_STATES: State[] = [live('All apps', ['All apps'])];

/** The subview each fixture deep link must put on screen. */
const SUBVIEW: Record<string, string> = {
  'inbox:mail': 'inbox-detail', 'inbox:compose': 'inbox-composing',
  'calendar:event': 'calendar-detail', 'calendar:invite': 'calendar-detail', 'calendar:add': 'calendar-detail', 'calendar:new': 'calendar-form',
  'browser:tabs': 'browser-tabs',
  'photos:viewer': 'photos-viewer',
  'notes:editor': 'notes-editor', 'notes:voice': 'notes-voice',
  'files:folder': 'files-folder', 'files:preview': 'files-preview',
  'workflows:flow': 'workflows-detail', 'workflows:run': 'workflows-runOpen', 'workflows:failed': 'workflows-runOpen', 'workflows:new': 'workflows-builder',
};

/** Populated lists and open subviews of every retained view (fixture data, development only). */
export const MOCK_STATES: State[] = [
  'home', 'shade', 'sheet', 'full',
  'inbox', 'inbox:mail', 'inbox:compose',
  'calendar', 'calendar:event', 'calendar:invite', 'calendar:month', 'calendar:add', 'calendar:new',
  'browser', 'browser:book', 'browser:tabs',
  'camera', 'camera:video',
  'photos', 'photos:viewer', 'photos:albums', 'photos:search',
  'maps', 'maps:search', 'maps:place', 'maps:route', 'maps:nav',
  'notes', 'notes:editor', 'notes:voice',
  'files', 'files:folder', 'files:preview',
  'workflows', 'workflows:flow', 'workflows:run', 'workflows:failed', 'workflows:new',
  'settings', 'settings:accounts', 'settings:adding', 'settings:privacy',
].map(start => mock(start, [], SUBVIEW[start])).concat([
  // Subviews, menus, sheets and search fields one or two taps inside a view.
  mock('inbox', ['Search email']),
  mock('inbox:mail', ['Reply'], 'inbox-composing'),
  mock('calendar:event', ['Edit event'], 'calendar-form'),
  mock('calendar', ['Clock alarms']),
  mock('browser', ['Menu']),
  mock('browser', ['Menu', 'Bookmarks and history'], 'browser-library'),
  mock('browser', ['Menu', 'Share']),
  mock('browser', ['Edit address']),
  mock('photos:albums', ['Favorites'], 'photos-album'),
  mock('photos:viewer', ['Edit photo'], 'photos-edit'),
  mock('photos:viewer', ['Photo info']),
  mock('photos:viewer', ['Share photo']),
  mock('photos', ['Select photos']),
  mock('notes', ['New folder']),
  mock('notes', ['Open The case for on-device agents'], 'notes-link'),
  mock('notes:editor', ['Share note']),
  mock('files:folder', ['Sort and more']),
  mock('files:preview', ['Rename']),
  mock('files:preview', ['Move file']),
  mock('files:preview', ['Share file']),
  // Deleting a fixture file shows the toast with Undo over the folder.
  mock('files:preview', ['Delete file']),
  mock('workflows:flow', ['Change'], 'workflows-builder'),
  // The builder's trigger and step sheets, and the Settings connection sheet.
  mock('workflows', ['New automation', 'Edit When step'], 'workflows-builder'),
  mock('workflows:new', ['Add Read step'], 'workflows-builder'),
  mock('settings', ['Connections', 'Slack']),
  mock('settings', ['Character']),
  mock('settings', ['Connections']),
  mock('settings', ['Notifications']),
  mock('settings:accounts', ['you@gmail.example']),
]);

/**
 * A signed-in phone with one connected mailbox, held at the provider boundary: the product's own
 * Inbox, Home and Settings adapters render against a synthetic cloud client. No account, OAuth
 * or mail exists; the names and subjects are invented. Development server only, because the
 * boundary is replaced by importing the page's own modules.
 */
async function connectMailbox(page: Page) {
  await page.evaluate(async () => {
    const { connectionController: controller } = await import('/src/runtime/connection-ui.tsx' as string);
    const { secureConnectionStore: store } = await import('/src/runtime/native-connection.ts' as string);
    const slots: Record<string, unknown> = {};
    store.read = async (key: string) => structuredClone(slots[key] ?? null) as any;
    store.compareExchange = async (key: string, prior: unknown, next: unknown) => {
      if (JSON.stringify(slots[key] ?? null) !== JSON.stringify(prior)) return { status: 'conflict' };
      if (next === null) delete slots[key]; else slots[key] = structuredClone(next);
      return { status: 'saved' };
    };
    const mail = (id: string, subject: string, extra: Record<string, unknown> = {}) => ({
      id, threadId: `thread-${id}`, subject, from: `Synthetic Sender ${id.toUpperCase()}`, fromEmail: `sender-${id}@example.test`, to: ['owner@example.test'], cc: [], replyTo: null,
      snippet: `A synthetic preview line that is long enough to need more than one row of the list (${id}).`, receivedAt: '2026-10-06T12:00:00Z', unread: false, ...extra,
    });
    const inbox = [
      mail('a', 'Quarterly planning review and budget notes', { unread: true }), mail('b', 'Re: Friday'), mail('c', 'A subject long enough that it cannot fit on one line of a phone at any text size', { unread: true }),
      mail('d', 'Receipt'), mail('e', 'Itinerary for the offsite'), mail('f', 'Notes'), mail('g', 'Invitation: design review'), mail('h', 'Welcome'),
    ];
    const client = {
      gmailAccounts: async () => [{ connectionId: 'grant-0', label: 'owner@example.test', configured: true, connected: true, reason: 'connected', grantedCapabilities: ['google.gmail.triage'] }],
      gmailInboxCapabilities: async () => ({ version: 1, from: 'owner@example.test', threads: true, send: false, providerDrafts: false, mailboxMutations: true, attachments: true, providerExactlyOnce: false, atomicDraftReplacement: false, readState: true }),
      gmailSearch: async (_grant: string, query: string) => ({ messages: query === 'in:inbox' ? structuredClone(inbox) : [], syncedAt: 'fixture', nextPageToken: null }),
      gmailRead: async (_grant: string, id: string) => ({ message: inbox.find(item => item.id === id), bodyText: `Synthetic body of ${id}.`, links: [] }),
      gmailThread: async (_grant: string, threadId: string) => {
        const message = inbox.find(item => item.threadId === threadId)!;
        return { messages: [{ message, bodyText: `Synthetic body paragraph for ${message.id}. `.repeat(40), historyId: `h-${message.id}`, attachments: [] }], total: 1, offset: 0, historyId: 'thread-history', nextOffset: null };
      },
      initiateGmail: async () => { throw Error('No live OAuth in fixture'); },
    };
    controller.getCloudClient = () => ({ client, sessionId: 'fixture-cloud', credentialId: 'fixture' } as any);
    const snapshot = { ...controller.getSnapshot(), cloudAccount: { environment: 'production', userId: 'fixture-owner', sessionId: 'fixture-cloud', credentialId: 'fixture' } } as any;
    controller.getSnapshot = () => snapshot;
  });
}
const connected = (name: string, steps: Array<string | RegExp> = [], options: { shows?: string; home?: boolean } = {}): State => ({
  name: `connected ${name}`, shows: options.shows,
  open: async (page, theme) => {
    await page.addInitScript(offline);
    await page.goto(theme ? `/?theme=${theme}` : '/');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await connectMailbox(page);
    // The mailbox is read when Inbox opens; Home's card and badge come from that read.
    await page.getByRole('button', { name: 'Inbox', exact: true }).and(page.locator('[data-mobile-shell-tile]')).click();
    await expect(page.getByRole('button', { name: /^Unread, Synthetic Sender A/ })).toBeVisible();
    if (options.home) { await page.getByRole('button', { name: 'Back to apps', exact: true }).click(); await expect(page.locator('[data-alpha-home-inbox]')).toContainText('2 unread'); }
    for (const step of steps) await page.getByRole('button', { name: step, exact: typeof step === 'string' }).first().click();
    await settle(page);
    await showing(page, options.shows);
  },
});

/** Provider-connected screens: a signed-in account with a connected mailbox (synthetic, see connectMailbox). */
export const CONNECTED_STATES: State[] = [
  connected('Home', [], { home: true }),
  connected('Inbox'),
  connected('Inbox sent (empty)', ['Sent']),
  connected('Inbox search', ['Search email']),
  connected('Inbox message', [/^Unread, Synthetic Sender A/], { shows: 'inbox-detail' }),
  connected('Inbox long subject', [/^Unread, Synthetic Sender C/], { shows: 'inbox-detail' }),
  connected('Inbox compose', ['Compose'], { shows: 'inbox-composing' }),
  connected('Settings', ['Settings'], { home: true }),
  connected('Settings accounts', ['Settings', 'Accounts'], { home: true }),
  connected('Settings connections', ['Settings', 'Connections'], { home: true }),
];

/** Live states that exist only behind the one Developer gate: the development server opened with ?tools=1. */
export const DEVELOPMENT_STATES: State[] = [
  {
    name: 'live Settings developer',
    open: async (page, theme) => {
      await page.addInitScript(offline);
      await page.goto(theme ? `/?theme=${theme}&tools=1` : '/?tools=1');
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
      await press(page, ['Settings', 'Developer']);
      await settle(page);
    },
  },
];

/** The renderer's own failure screens. */
export const FAILURE_STATES: State[] = [
  {
    name: 'render failure recovery',
    open: async page => {
      await page.addInitScript(offline); await page.goto('/');
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new Event('alpha:force-render-error')));
      const recovery = page.getByRole('alertdialog', { name: 'Alpha Phone needs to reload' });
      await expect(recovery).toBeVisible();
      await recovery.getByText('Diagnostics', { exact: true }).click();
    },
  },
  {
    name: 'startup failure recovery',
    open: async page => {
      await page.addInitScript(offline); await page.goto('/');
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
      // The plain-DOM screen used when React never mounted, shown over a live page here so the
      // sweep also proves it takes the page behind it out of focus order.
      await page.evaluate(async () => { const module = await import('/src/runtime/error-boundary.tsx' as string); module.showRecoveryScreen('startup', new Error('private detail')); });
      const recovery = page.getByRole('alertdialog', { name: 'Alpha Phone needs to reload' });
      await expect(recovery).toBeVisible();
      await recovery.getByText('Diagnostics', { exact: true }).click();
    },
  },
];

/**
 * Fixture screens no tap path reaches (development server only). The lock screen is the fixture
 * shell's own; the photos-empty viewer is the Photos viewer left open after its photo is gone,
 * reached by pointing the open viewer at a photo that is no longer in the library.
 */
export const FIXTURE_STATES: State[] = [
  mock('lock'),
  {
    name: 'mock photos:viewer > photo gone', shows: 'photos-empty',
    open: async (page, theme) => {
      await mock('photos:viewer', [], 'photos-viewer').open(page, theme);
      await page.evaluate(() => {
        // The phone's root component holds each view's state; the viewer re-reads it on render.
        const root = document.getElementById('root') as any, key = Object.keys(root).find(name => name.startsWith('__reactContainer$'))!;
        const pending = [root[key]];
        while (pending.length) {
          const fiber = pending.pop();
          if (typeof fiber?.stateNode?.vset === 'function') { fiber.stateNode.vset('photos', { open: 'photo-no-longer-in-library' }); return; }
          if (fiber?.sibling) pending.push(fiber.sibling);
          if (fiber?.child) pending.push(fiber.child);
        }
        throw Error('No phone shell');
      });
      await settle(page);
      await showing(page, 'photos-empty');
    },
  },
];

/**
 * The Android HOME (launcher) presentation, booted as home-native-launcher.spec.ts does: an
 * Android Capacitor bridge whose ElizaSystem reports the launcher build. Its headers and system
 * bars differ from the standalone app the other states show.
 */
const launcherBridge = () => {
  localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));
  const w = window as any; w.androidBridge = {};
  const plugins: Record<string, string[]> = {
    ElizaSystem: ['listLauncherApps', 'launchApp', 'resolveDefaultApp', 'openDefaultApp', 'getBuildInfo', 'getLocaleInfo', 'getLaunchInfo'],
      DeviceApps: ['platformCapabilities'],
    DailyApps: ['surfaceInfo', 'requestPermissions', 'closeAssistant'],
    AlphaNotifications: ['status', 'list'],
    AlphaVoiceCloud: ['checkPermissions', 'requestPermissions'],
    AlphaDevice: ['openSettings'],
  };
  const answer = (plugin: string, method: string) => {
    if (plugin === 'ElizaSystem') {
      if (method === 'listLauncherApps') return { apps: [{ packageName: 'org.example.clock', label: 'Synthetic clock' }, { packageName: 'org.example.weather', label: 'Synthetic weather' }] };
      if (method === 'resolveDefaultApp') return { role: 'dial', available: false };
      if (method === 'getBuildInfo') return { launcher: true, version: 'stub' };
      if (method === 'getLaunchInfo') return { assistant: false };
      if (method === 'getLocaleInfo') return { locale: 'en-US', hour24: false };
      return {};
    }
    if (plugin === 'DailyApps' && method === 'surfaceInfo') return { assistant: false, developmentBuild: true, topInset: 0, bottomInset: 0 };
    if (plugin === 'AlphaNotifications' && method === 'status') return { permissionGranted: true, appEnabled: true };
    if (plugin === 'AlphaNotifications' && method === 'list') return { items: [], scope: 'alpha-phone' };
    if (plugin === 'AlphaVoiceCloud' && method === 'checkPermissions') return { microphone: 'granted' };
    return {};
  };
  const cap: any = w.Capacitor = {
    Plugins: {},
    PluginHeaders: Object.entries(plugins).map(([name, methods]) => ({ name, methods: [...methods, 'addListener', 'removeListener'].map(m => ({ name: m, rtype: m === 'addListener' ? 'callback' : 'promise' })) })),
    nativeCallback: () => 'stub-callback',
    nativePromise: async (plugin: string, method: string) => answer(plugin, method),
  };
  for (const name of Object.keys(plugins)) cap.Plugins[name] = { addListener: () => ({ remove: async () => {} }) };
};
const launcher = (name: string, steps: string[] = [], shows?: string): State => ({
  name: `launcher ${name}`, shows,
  open: async (page, theme) => {
    await page.addInitScript(launcherBridge);
    await page.goto(theme ? `/?theme=${theme}` : '/');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/standalone-app/);
    await press(page, steps);
    await settle(page);
    await showing(page, shows);
  },
});
export const INSTALLED_APPS_STATE: State = {
  ...launcher('Apps', ['Apps']),
  open: async (page, theme) => {
    await launcher('Apps', ['Apps']).open(page, theme);
    const drawer = page.getByRole('dialog', {name: 'Apps', exact: true});
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', {name: 'Open Synthetic clock', exact: true})).toBeVisible();
    await expect(drawer.getByRole('button', {name: 'Open Calendar', exact: true})).toHaveCount(0);
  },
};
export const LAUNCHER_STATES: State[] = [
  launcher('Home'),
  INSTALLED_APPS_STATE,
  launcher('Conversation', ['Open conversation']),
  // Every retained app view in the launcher presentation (its headers and system bars differ).
  launcher('Inbox', ['Inbox']),
  launcher('Calendar', ['Calendar']),
  launcher('Calendar month', ['Calendar', 'Month view']),
  launcher('Browser', ['Browser']),
  launcher('Camera', ['Camera']),
  launcher('Photos', ['Photos']),
  launcher('Maps', ['Maps']),
  launcher('Notes', ['Notes']),
  launcher('Files', ['Files']),
  launcher('Workflows', ['Workflows']),
  launcher('Settings', ['Settings']),
  launcher('Settings display', ['Settings', 'Display']),
];

/** A seeded local calendar (browser store), so the Calendar view has events to audit. */
const syntheticCalendar = async (page: Page) => page.evaluate(async () => {
  const { BrowserCalendar } = await import('/src/browser/calendar.ts' as string), calendar = new BrowserCalendar(), day = new Date(); day.setHours(10, 0, 0, 0);
  for (const [title, offset] of [['Synthetic design review', 0], ['Synthetic venue walkthrough', 2]] as const)
    await calendar.save({ calendarId: 'local', title, location: 'Synthetic room 4', begin: day.getTime() + offset * 3_600_000, end: day.getTime() + (offset + 1) * 3_600_000, allDay: false, creationId: crypto.randomUUID() });
});
const calendarWithEvents: State = {
  name: 'connected Calendar with events',
  open: async (page, theme) => {
    await page.addInitScript(offline);
    await page.goto(theme ? `/?theme=${theme}` : '/');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await syntheticCalendar(page);
    await press(page, ['Calendar']);
    await settle(page);
  },
};
CONNECTED_STATES.push(calendarWithEvents);

/**
 * Connected states other than a mailbox (MVP-48): an agent's own calendar, a linked Google Calendar
 * account and a connected agent with a conversation. Each is held at the same boundary its own
 * browser spec uses (home-daily-overview, calendar-sync-settings, journey-d-digests); every
 * account, event and reply is synthetic, and none of these states writes to a provider.
 */
// A fixed local noon keeps the agent's event inside today's Calendar window whenever the sweep runs.
const AGENT_CALENDAR_DAY = { year: 2026, month: 9, day: 14 };
const agentCalendar = (name: string, steps: string[] = []): State => ({
  name: `connected Agent Calendar ${name}`,
  open: async (page, theme) => {
    const { year, month, day } = AGENT_CALENDAR_DAY;
    await page.clock.install({ time: new Date(year, month, day, 12, 0, 0) });
    await page.addInitScript(offline);
    await page.goto(theme ? `/?theme=${theme}` : '/');
    const start = new Date(year, month, day, 14, 30, 0), end = new Date(year, month, day, 15, 15, 0);
    await installHomeCalendar(page, { title: 'Synthetic planning review with a long enough title to wrap', startAt: start.toISOString(), endAt: end.toISOString() });
    await expect(page.locator('[data-alpha-home-calendar]')).toContainText('Synthetic planning review');
    await press(page, steps);
    if (steps.length) await expect(page.getByText(/^Synthetic planning review/).first()).toBeVisible();
    await settle(page);
  },
});
/** The Google Calendar sync sheet for a linked account, before and after its read-only review. */
const googleCalendar = (name: string, review: boolean): State => ({
  name: `connected Google Calendar sync ${name}`,
  open: async (page, theme) => {
    const dialog = await calendarSyncFixture(page, false, theme);
    await expect(dialog).toBeVisible();
    if (review) {
      await dialog.getByRole('button', { name: 'Review sync', exact: true }).click();
      await expect(dialog.getByText(/owner@example.invalid.*Personal.*1 Alpha events/)).toBeVisible();
    }
    await settle(page);
    expect(await page.evaluate(() => (window as any).calendarSyncFixture.writes)).toBe(0);
  },
});
const DEVELOPMENT_REPLY = 'Development reply. Edit this response in Agent connection.';
/** The on-device development agent profile (no model or network) answering one typed message. */
const developmentAgent = (name: string, conversation: boolean): State => ({
  name: `connected agent ${name}`,
  open: async (page, theme) => {
    await page.goto(`/?mode=dev&theme=${theme || 'light'}`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Agent connection', exact: true }).click();
    await page.getByRole('button', { name: 'Connect development profile', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Development connections', exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => !!(await import('/src/runtime/connection-ui.tsx' as string)).connectionController.getSnapshot().session), { timeout: 15_000 }).toBe(true);
    if (conversation) {
      await page.getByRole('button', { name: 'Back to apps', exact: true }).click();
      const composer = page.getByRole('textbox', { name: 'Ask Alpha', exact: true });
      await composer.fill('What is on my list for this afternoon?');
      await composer.press('Enter');
      await expect(page.locator('[data-alpha-layer="conversation"][aria-hidden="false"]').getByText(DEVELOPMENT_REPLY, { exact: true })).toBeVisible();
    }
    await settle(page);
  },
});
CONNECTED_STATES.push(
  agentCalendar('on Home'),
  agentCalendar('in Calendar', ['Calendar']),
  googleCalendar('account', false),
  googleCalendar('review', true),
  developmentAgent('Settings', false),
  developmentAgent('Conversation', true),
);

/**
 * Large text as the renderer sees it: every declared pixel size multiplied, as WebView text zoom does.
 *
 * WebView text zoom (Alpha's size times the system font scale) is applied by the renderer before
 * any script can measure, and the app never writes it. The emulation here differs in two ways that
 * it has to cancel out:
 * - It rewrites declared sizes in a MutationObserver (browser/display.ts). Observers run in the order
 *   they were created, so a dock publisher created at startup would measure a status row added to
 *   the composer before the row's text was scaled, and publish a clearance that only the next
 *   frame's resize corrects. The publisher is restarted once, after the rewriting observer exists,
 *   so it measures scaled content as it would under real text zoom.
 * - The browser build applies its own stored text size to `--browser-text-scale` when its device
 *   settings load or change, which can land after this call. The emulated size is held by an
 *   !important rule, which the app's inline value does not override.
 */
export async function setTextScale(page: Page, scale: number) {
  await page.evaluate(async value => {
    const harness = window as unknown as { __alphaTextZoom?: HTMLStyleElement };
    if (!harness.__alphaTextZoom) {
      const display = await import('/src/browser/display.ts' as string);
      display.installBrowserDisplay();
      const { installDockClearance } = await import('/src/runtime/dock-clearance.ts' as string);
      installDockClearance()();
      installDockClearance();
      harness.__alphaTextZoom = document.createElement('style');
      harness.__alphaTextZoom.dataset.alphaTestTextZoom = '';
      document.head.append(harness.__alphaTextZoom);
    }
    harness.__alphaTextZoom.textContent = `:root{--browser-text-scale:${value}!important}`;
  }, scale);
  // The renderer's own probe (runtime/text-scale.ts) has measured the new size and published it, so
  // the layout rules that read it have applied; then any reflow motion settles.
  // The probe reports on its next layout; a starved renderer can take seconds to lay out a frame.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale').trim()), { timeout: 15_000 }).toBe(String(scale));
  await settled(page);
}
