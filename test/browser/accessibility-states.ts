import { expect, type Page } from '@playwright/test';
import {openOwnedPhotoViewer} from './helpers/owned-photo';

/**
 * The retained MVP surface, as a list of states the accessibility sweep visits.
 *
 * "live" states use the product adapters with no connection and no data: they are what a
 * new or disconnected phone shows, including each app's empty, unavailable and
 * permission-denied states. "mock" states are the labelled fixture mode with populated
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
  // Entry transitions are short even with reduced motion; fonts decide final geometry.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450);
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
/** Fixture screens that finish arriving on a timer: the control that marks them complete. */
const ARRIVES: Record<string, string> = {
  // The scan fixture finds its page after about a second; the result actions are the state.
  'camera:scan': 'Add event',
};
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
  live('All apps', ['All apps']),
  live('Conversation', ['Open conversation']),
  live('Inbox (not connected)', ['Inbox']),
  live('Calendar', ['Calendar']),
  live('Calendar new event', ['Calendar', 'New event']),
  live('Calendar views menu', ['Calendar', 'Calendar views']),
  live('Calendar search', ['Calendar', 'Search']),
  live('Browser', ['Browser']),
  live('Browser tabs', ['Browser', 'Tabs']),
  live('Camera (unavailable)', ['Camera']),
  live('Photos (empty)', ['Photos']),
  live('Maps (no location)', ['Maps']),
  live('Notes (empty)', ['Notes']),
  live('Notes new note', ['Notes', 'New note']),
  live('Notes trash', ['Notes', 'Open Trash'], 'notes-trash'),
  live('Files', ['Files']),
  live('Workflows', ['Workflows']),
  live('Settings', ['Settings']),
  // Settings pages and sheets the browser build reaches (docs/ui-refresh-2026-11 Settings structure).
  live('Settings about', ['Settings', 'About']),
  live('Settings problem log', ['Settings', 'About', 'Problem log']),
  live('Settings licenses', ['Settings', 'About', 'Open source licenses']),
  live('Settings scheduled digests', ['Settings', 'Scheduled digests']),
  live('Settings agent', ['Settings', 'Agent']),
  live('Settings Eliza Cloud', ['Settings', 'Eliza Cloud']),
  live('Settings Google', ['Settings', 'Google']),
  live('Settings in-app alerts', ['Settings', 'In-app alerts']),
  // The remaining Settings pages, and each app's open menu, search field and editor.
  live('Settings calendars', ['Settings', 'Calendars']),
  live('Browser menu', ['Browser', 'Menu']),
  live('Browser address', ['Browser', 'Edit address']),
  live('Calendar alarms', ['Calendar', 'Clock alarms']),
  live('Photos search', ['Photos', 'Search photos']),
  live('Notes search', ['Notes', 'Search notes']),
  live('Notes source document', ['Notes', 'New note', 'Link source document']),
  live('Notes recording', ['Notes', 'Record and transcribe'], 'notes-recording'),
  live('Files search', ['Files', 'Search files']),
  live('Workflows new automation', ['Workflows', 'New automation'], 'automations-detail'),
];

/** The subview each fixture deep link must put on screen. */
const SUBVIEW: Record<string, string> = {
  'inbox:mail': 'inbox-detail', 'inbox:compose': 'inbox-composing',
  'calendar:event': 'calendar-detail', 'calendar:invite': 'calendar-detail', 'calendar:add': 'calendar-detail', 'calendar:new': 'calendar-form',
  'browser:tabs': 'browser-tabs',
  'photos:viewer': 'photos-viewer',
  'notes:editor': 'notes-editor', 'notes:rec': 'notes-recording', 'notes:voice': 'notes-voice',
  'files:folder': 'files-folder', 'files:preview': 'files-preview',
  'workflows:flow': 'workflows-detail', 'workflows:run': 'workflows-runOpen', 'workflows:failed': 'workflows-runOpen', 'workflows:new': 'workflows-builder',
};

/** Populated lists and open subviews of every retained view (fixture data, development only). */
export const MOCK_STATES: State[] = [
  'home', 'shade', 'sheet', 'full',
  'inbox', 'inbox:mail', 'inbox:compose',
  'calendar', 'calendar:event', 'calendar:invite', 'calendar:month', 'calendar:add', 'calendar:new',
  'browser', 'browser:book', 'browser:tabs',
  'camera', 'camera:video', 'camera:scan',
  'photos', 'photos:viewer', 'photos:albums', 'photos:search',
  'maps', 'maps:search', 'maps:place', 'maps:route', 'maps:nav',
  'notes', 'notes:editor', 'notes:rec', 'notes:voice',
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
  mock('notes', ['Search notes']),
  mock('notes', ['Open The case for on-device agents'], 'notes-link'),
  mock('notes:editor', ['Share note']),
  mock('files', ['Search files']),
  mock('files:folder', ['View and sort']),
  mock('files:folder', ['Select files']),
  mock('files:preview', ['Rename']),
  mock('files:preview', ['Move file']),
  mock('files:preview', ['Share file']),
  // Deleting a fixture file shows the toast with Undo over the folder.
  mock('files:preview', ['Delete file']),
  mock('workflows:flow', ['Change'], 'workflows-builder'),
  // The builder's trigger and step sheets. (Settings' Connections page and its per-service sheets
  // were removed; the Google accounts panel is swept live as 'Settings Google'.)
  mock('workflows', ['New automation', 'Edit When step'], 'workflows-builder'),
  mock('workflows:new', ['Add Read step'], 'workflows-builder'),
  mock('settings', ['Character']),
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
    await page.getByRole('button', { name: 'Inbox', exact: true }).click();
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
  connected('Settings Google', ['Settings', 'Google'], { home: true }),
];

/** Live states that exist only on the development server (developer surfaces). */
export const DEVELOPMENT_STATES: State[] = [
  live('Settings developer', ['Settings', 'Developer']),
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
 * Android Capacitor bridge whose DeviceApps reports the launcher build. Its headers and system
 * bars differ from the standalone app the other states show.
 */
const launcherBridge = () => {
  localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));
  const w = window as any; w.androidBridge = {};
  const plugins: Record<string, string[]> = {
    DeviceApps: ['list', 'launch', 'resolveDefault', 'openDefault', 'buildInfo', 'localeInfo', 'launchInfo'],
    DailyApps: ['surfaceInfo', 'requestPermissions', 'closeAssistant'],
    AlphaNotifications: ['status', 'list'],
    AlphaVoiceCloud: ['checkPermissions', 'requestPermissions'],
    AlphaDevice: ['openSettings'],
  };
  const answer = (plugin: string, method: string) => {
    if (plugin === 'DeviceApps') {
      if (method === 'list') return { apps: [{ packageName: 'org.example.clock', label: 'Synthetic clock' }, { packageName: 'org.example.weather', label: 'Synthetic weather' }] };
      if (method === 'resolveDefault') return { role: 'dial', available: false };
      if (method === 'buildInfo') return { launcher: true, version: 'stub' };
      if (method === 'launchInfo') return { assistant: false };
      if (method === 'localeInfo') return { locale: 'en-US', hour24: false };
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
export const LAUNCHER_STATES: State[] = [
  launcher('Home'),
  launcher('All apps', ['All apps']),
  launcher('Calendar', ['Calendar']),
  launcher('Notes', ['Notes']),
  launcher('Files', ['Files']),
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

/** Large text as the renderer sees it: every declared pixel size multiplied, as WebView text zoom does. */
export async function setTextScale(page: Page, scale: number) {
  await page.evaluate(async value => {
    const display = await import('/src/browser/display.ts' as string);
    display.installBrowserDisplay();
    document.documentElement.style.setProperty('--browser-text-scale', String(value));
  }, scale);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
}
