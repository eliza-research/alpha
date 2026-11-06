import {Capacitor} from '@capacitor/core';
import {mockAttentionRows} from './mock-attention';
import {HOME_DEFAULTS} from './model.js';
import {browserStorageUsage} from '../browser/storage-usage';
import {browserDevProfile} from '../browser/dev-profile';
import {attendeeInitials, homeAgendaHeader, homeCalendarEmptyTitle, homeCalendarName, overdueDueLabel, presentHomeAttention, presentHomeBrief, presentHomeBriefCard, presentHomeCalendar, presentHomeCalendarSource, presentHomeNext, type HomeAttentionSummary, type HomeBriefSummary} from './home-cards';
type Bag = Record<string, any>;
const installed = new WeakSet<object>();

/** Production-only absence of provider data. Never install in visual fixtures.
 * Install after effect adapters, before mounting. Does not create user records,
 * clear native app data, or pretend disconnected sources are synchronized. */
export function installPrototypeDataAdapter(Component: any, views: Record<string, Bag>) {
  if (installed.has(views)) return;
  installed.add(views);
  // Home draws no card for a failed calendar read, so opening Calendar by any route reads it again.
  const openView = Component.prototype.openView;
  Component.prototype.openView = function (key: string, ...args: any[]) {
    if (key === 'calendar') { const source = views.calendar?.displaySources?.(); if (source?.error) source.retry?.(); }
    return openView.call(this, key, ...args);
  };
  const empty: Record<string, Bag> = {
    photos: { list: [], trash: [], albums: [], open: null, album: null, edit: null, sheet: null, filter: null, seq: null, sel: null },
    files: { files: [], folder: null, open: null, asked: {}, asking: null, sel: null, sheet: null },
    phone: { recents: [], vms: [], vmOpen: null, playing: null, call: null, callWho: null, incoming: null, ring: null },
    messages: { threads: {}, unread: {}, extra: [], botI: {}, thread: null, compose: null, typing: null },
    inbox: { mails: [], sent: [], acct: 'all', open: null, compose: null },
    workflows: { flows: [], open: null, run: null, build: null, create: false, running: null },
    wallet: { cards: [], open: null, pay: false, card: null, paid: null, add: null, transit: 0, trips: [], calAdded: {}, pays: 0 },
    settings: { accounts: [], conns: {}, acct: null, adding: false, addStep: null, addProv: null, addEmail: '', addPw: '', addServer: '', addLvl: null },
  };
  for (const [name, state] of Object.entries(empty)) {
    if (views[name]) views[name].state = { ...views[name].state, ...state };
  }
  const wrap = (name: string, patch: (out: Bag, state: Bag, api: Bag) => Bag) => {
    if (!views[name]?.render) return;
    const render = views[name].render;
    views[name].render = (state: Bag, api: Bag) => patch(render(state, ['phone', 'messages', 'inbox'].includes(name) ? { ...api, people: [] } : api), state, api);
  };
  // Native captures are owned by camera-adapter's closure and SAF previews by
  // selection-adapter. Keep their final render output; clear only model fixtures.
  wrap('photos', out => ({
    ...out,
    empty: !out.libraryLoading && !out.libraryError && !(out.groups || []).some((group: Bag) => (group.items || []).length > 0),
  }));
  let storageUsage={storageW:'0%',storageText:'App storage',storageBarStyle:'display:none'},storageActive=false,storagePending=false,storageEpoch=0;
  const browserStorage=!Capacitor.isNativePlatform(),filesLeave=views.files?.onLeave;
  if(browserStorage&&views.files)views.files.onLeave=(...args:any[])=>{storageActive=false;storagePending=false;storageEpoch++;return filesLeave?.(...args);};
  const refreshStorage=async(api:Bag)=>{if(storagePending||!api.isActive()||document.hidden)return;storagePending=true;const epoch=storageEpoch;try{const usage=await browserStorageUsage();if(epoch===storageEpoch&&api.isActive()){storageUsage=usage;api.set({browserStorageRevision:Date.now()});}}catch{if(epoch===storageEpoch&&api.isActive()){storageUsage={storageW:'0%',storageText:'App storage could not be read',storageBarStyle:'display:none'};api.set({browserStorageRevision:Date.now()});}}finally{if(epoch===storageEpoch)storagePending=false;}};
  wrap('files', (out,_state,api) => {
    // Refresh on arrival and after returning from a folder or preview, not on a polling timer.
    const storageVisible=browserStorage&&api.isActive()&&!_state.folder&&!_state.open;
    if(storageVisible&&!storageActive)void refreshStorage(api);storageActive=storageVisible;
    return ({
    ...out,
    locs: (out.locs || []).map((location: Bag) => ({
      ...location, sub: location.nativeTree ? location.sub : location.name === 'Photos' ? 'Choose a photo' : 'Choose a document',
    })),
    ...(browserStorage?storageUsage:{storageW:'0%',storageText:'Storage usage unavailable',storageBarStyle:'display:none'}),
  });});
  wrap('phone', out => ({ ...out, favs: [], hasFavs: false }));
  wrap('messages', out => ({ ...out, ...(out.empty ? { emptyText: 'Messages are not connected' } : {}) }));
  wrap('inbox', out => ({ ...out, emptyText: 'Inbox is not connected' }));
  wrap('wallet', (out, _state, api) => ({
    ...out, passes: [], ps: null, isPass: false,
    startAdd: () => api.toast('Wallet is not connected. No card details are collected.'),
    startPay: () => api.toast('Wallet is not connected. Nothing has been charged.'),
  }));
  const p = Component.prototype;
  const renderVals = p.renderVals;
  p.renderVals = function () {
    const out = renderVals.call(this);
    const now = Date.now();
    const calendarSource = views.calendar.displaySources?.();
    const calendarState = this.vget('calendar');
    const overdueRows: Bag[] = (typeof this.overdueReminders === 'function' ? (() => { try { return this.overdueReminders(); } catch { return []; } })() : [])
      .filter((row: Bag) => row && typeof row.title === 'string' && Number.isFinite(row.at) && Number(row.at) < now);
    // The app calendar can be hidden in Calendar's display settings; Calendar then leaves its events
    // out, and so does Home. Device calendars have no in-app toggle. Reminders are not affected.
    const calendarHidden = !!calendarSource && !calendarSource.native && (calendarSource.sources || []).some((source: Bag) => source.id === 'local' && source.on === false);
    const ordered = (calendarState.events || [])
      .filter((event: Bag) => event.reminderStatus !== 'completed')
      .filter((event: Bag) => !event.alphaCalendarId || (calendarSource?.ready && !calendarHidden))
      .map((event: Bag) => {
        const instant=(value:number)=>{const date=new Date(value);return event.nativeEvent?.allDay?new Date(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()).getTime():Number(value);};
        return {event,begin:instant(event.nativeEvent?.begin??event.reminderAt),end:instant(event.nativeEvent?.end??event.reminderAt)};
      })
      // Overdue reminders (reminder adapter's overdueReminders()) stay on Home until handled.
      .concat(overdueRows.map((row: Bag) => ({event: {id: row.id, title: row.title, off: row.off, overdue: true}, begin: Number(row.at), end: Infinity})))
      .filter((item: Bag) => Number.isFinite(item.begin) && (Number.isFinite(item.end) || item.event.overdue) && (item.event.nativeEvent?.allDay?item.end>now:item.end>=now))
      // An overdue reminder is first even when an event already in progress began before it was due.
      .sort((a: Bag, b: Bag) => Number(!!b.event.overdue) - Number(!!a.event.overdue) || a.begin - b.begin);
    const agenda = ordered[0];
    // Under an overdue reminder, the next event (or reminder) still shows on a line of its own.
    const following = agenda?.event.overdue ? ordered.find((item: Bag) => !item.event.overdue) : undefined;
    const cardState = calendarSource?.loading ? 'loading' : calendarSource?.ready ? 'ready' : 'error';
    // The calendar adapter may report its read time; otherwise the first render that sees the
    // loaded rows stands in for it (both are reads from this device, never a sync claim).
    const rows = this.nativeCalendarRows;
    if (cardState === 'ready' && rows !== calendarReadRows) { calendarReadRows = rows; calendarReadAt = now; }
    if (cardState !== 'ready') calendarReadRows = undefined;
    const readAt = Number.isFinite(calendarState.nativeCalendarReadAt) ? Number(calendarState.nativeCalendarReadAt) : cardState === 'ready' ? calendarReadAt : null;
    // Reminders have their own store and read time: the reminder adapter replaces reminderRows on
    // each completed read, and the first render that sees the new rows stands in for that read.
    const reminderRows = this.reminderRows;
    if (reminderRows !== reminderReadRows) { reminderReadRows = reminderRows; reminderReadAt = Array.isArray(reminderRows) ? now : null; }
    const meeting = (event: Bag) => [event.nativeEvent?.meetingUrl, event.nativeEvent?.location, event.where].some((value: unknown) => typeof value === 'string' && /\bhttps:\/\/[^\s]+/i.test(value));
    const calendar = presentHomeCalendar({
      state: cardState, readAt, now, device: Capacitor.isNativePlatform() ? 'this device' : 'this browser',
      agenda: agenda ? {title: agenda.event.title || 'Untitled event', begin: agenda.begin, overdue: !!agenda.event.overdue, allDay: !!(agenda.event.nativeEvent?.allDay ?? agenda.event.allDay), video: meeting(agenda.event), people: attendeeInitials(agenda.event.nativeEvent?.attendees ?? agenda.event.who ?? [])} : null,
    });
    // Development inbox fixtures report through the same summary as a provider adapter.
    const unreadRows:Bag[]=browserDevProfile?(this.vget('inbox').mails||[]).filter((mail:Bag)=>mail.unread&&!mail.arch&&!mail.del):[];
    const unread=unreadRows.length;
    const attentionSummary: HomeAttentionSummary|null = browserDevProfile ? {state:'ready',unread,source:'Development inbox',updatedAt:now} : homeSources.attention();
    const attention = presentHomeAttention(attentionSummary, now);
    const retainedBrief = homeSources.brief();
    const brief = presentHomeBrief(retainedBrief, now), briefCard = presentHomeBriefCard(retainedBrief, now);
    const day = agenda ? new Date(agenda.begin) : null;
    const dateLabel = (day || new Date(now)).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const overdue = !!agenda?.event.overdue;
    // Source and freshness of the item on the card: the calendar it was read from and when this
    // app read it, or the reminder store for an overdue reminder.
    const calendarName = agenda && !overdue ? homeCalendarName(calendarSource?.sources, agenda.event.nativeEvent?.calendarId) : null;
    const provenance = presentHomeCalendarSource({state: cardState === 'error' && !calendarSource?.error ? 'other' : cardState, overdue, reminder: !!agenda?.event.alphaReminderId, reminderReadAt, readAt, now, native: Capacitor.isNativePlatform(), calendar: calendarName, truncated: !!calendarSource?.truncated});
    const next = following ? presentHomeNext({title: String(following.event.title || ''), begin: following.begin, allDay: !!(following.event.nativeEvent?.allDay ?? following.event.allDay), now,
      provenance: presentHomeCalendarSource({state: cardState === 'error' && !calendarSource?.error ? 'other' : cardState, overdue: false, reminder: !!following.event.alphaReminderId, reminderReadAt, readAt, now, native: Capacitor.isNativePlatform(), calendar: homeCalendarName(calendarSource?.sources, following.event.nativeEvent?.calendarId), truncated: !!calendarSource?.truncated})}) : null;
    const eventTitle=agenda?String(agenda.event.title||'Untitled event'):'';
    const timeLabel=(instant:number)=>new Date(instant).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    const endDay=agenda?new Date(agenda.end):null;
    const endLabel=agenda&&endDay&&day&&endDay.toDateString()!==day.toDateString()?`${endDay.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})}, ${timeLabel(agenda.end)}`:agenda?timeLabel(agenda.end):'';
    const eventTime=agenda?overdue?overdueDueLabel(agenda.begin,now):agenda.event.nativeEvent?.allDay?'All day':timeLabel(agenda.begin)+(Number.isFinite(agenda.end)&&agenda.end>agenda.begin?` – ${endLabel}`:''):'';
    return {
      ...out, shadeN: [],
      // No suggestion chips: the owner types or speaks their own request.
      sugg: [], showSugg: false,
      homeCalendarHasEvent:!!agenda,homeCalendarFooter:eventTime,
      homeCalendarLabel: agenda ? overdue ? `Open overdue reminder: ${eventTitle}, ${eventTime}` : `Open calendar event: ${eventTitle}, ${dateLabel}, ${eventTime}` : 'Open your calendar',
      homeCalendarTime: homeAgendaHeader(dateLabel, overdue ? overdueRows.length : 0),
      homeCalendarTitle: eventTitle || homeCalendarEmptyTitle(calendarSource, calendarHidden),
      // The card's last row holds the event time and, when known, where and when it was read.
      homeCalendarHasMeta: !!(agenda || provenance.read),
      homeCalendarSource: provenance.read, homeCalendarOrigin: provenance.origin, homeCalendarOverdue: overdue,
      homeCalendarDescription: [provenance.description, next?.description].filter(Boolean).join('. '),
      homeCalendarNext: next?.text || '', homeCalendarNextSource: next?.source || '', homeCalendarHasNext: !!next,
      homeCalendarVideo: calendar.video, homeCalendarPeople: calendar.people.map(ini => ({ini})),
      homePeopleVisibility: calendar.people.length ? 'visible' : 'hidden',
      homeAttentionLabel: attention.label,
      homeAttentionPeople: [], homeAttentionPeopleVisibility: 'hidden',
      ...(browserDevProfile?{homeInboxCount:attention.count,homeInboxRows:unreadRows.slice(0,2).map(mail=>({subject:mail.subj||'(no subject)',from:mail.name||mail.email||''})),homeInboxHasRows:unread>0,homeInboxTitle:unread?'':'No unread email',homeInboxStatus:'Development inbox'}:{}),
      homeWorkflowLabel: brief.label, homeWorkflowTitle: brief.title, homeWorkflowTime: brief.time, homeWorkflowSource: brief.source,
      // After a failed read, opening Calendar from the card reads it again; Calendar itself does not retry on entry.
      goCalendar: () => { if (calendarSource?.error) calendarSource.retry?.(); this.openView('calendar', agenda ? {open:agenda.event.id, day:agenda.event.off, openDay:agenda.event.off} : undefined); },
      homeBriefHas: briefCard.has, homeBriefTitle: briefCard.title, homeBriefStatus: briefCard.status, homeBriefLabel: briefCard.label, homeBriefFailed: briefCard.failed,
      // Opens the retained results list. Showing the card reads nothing; opening the list syncs
      // retained results with the agent as it does from Settings. Neither runs a digest.
      goBrief: () => window.dispatchEvent(new Event('alpha:hosted-digests')),
      goFlows: () => this.openView('workflows'),
      goTriage: () => attention.action === 'connections' ? this.openView('settings', {page:'connections'}) : this.openView('inbox',{acct:'all',open:null,q:null}),
      clearAll: () => this.setState({ shade: false }),
    };
  };
  const mount = p.componentDidMount, unmount = p.componentWillUnmount;
  p.componentDidMount = function (...args: any[]) {
    this.homeSourcesChanged = () => this.setState({ homeSourcesRevision: Date.now() });
    window.addEventListener(HOME_SOURCES_CHANGED, this.homeSourcesChanged);
    return mount?.apply(this, args);
  };
  p.componentWillUnmount = function (...args: any[]) {
    window.removeEventListener(HOME_SOURCES_CHANGED, this.homeSourcesChanged);
    return unmount?.apply(this, args);
  };
}
let calendarReadRows: unknown, calendarReadAt: number | null = null;
let reminderReadRows: unknown, reminderReadAt: number | null = null;

export const HOME_SOURCES_CHANGED = 'alpha:home-sources-changed';
/** Live Home card sources. Provider adapters register here (P06 inboxAttention(), P05
 * latestRetainedDigest()); until one does, Home shows the honest not-connected / no-brief state. */
const homeSources: {attention: () => HomeAttentionSummary | null; brief: () => HomeBriefSummary | null} = {attention: () => null, brief: () => null};
export function setHomeSources(next: Partial<typeof homeSources>) {
  const safe = <T,>(read: () => T | null) => () => { try { return read(); } catch { return null; } };
  if (next.attention) homeSources.attention = safe(next.attention);
  if (next.brief) homeSources.brief = safe(next.brief);
  window.dispatchEvent(new Event(HOME_SOURCES_CHANGED));
}

/** Which Home cards are drawn (docs/ui-refresh-2026-11, tla/HomeLayout.tla). A card is drawn only
 * when it has something to show: the next event or an overdue reminder, an enabled workflow,
 * unread mail from a connected account, a retained brief. With none, Home shows the date, and a
 * Connect Google button while Google is known to be disconnected. Installed outermost, after
 * every adapter that writes the card values. */
export function installHomeCardVisibility(Component: any, openGoogle: () => void) {
  const p = Component.prototype, render = p.renderVals;
  p.renderVals = function () {
    const out = render.call(this);
    const calendar = !!out.homeCalendarHasEvent, workflows = !!out.homeWorkflowHasRows, inbox = !!out.homeInboxHasRows, brief = !!out.homeBriefHas;
    const none = !calendar && !workflows && !inbox && !brief;
    return {...out, homeShowCalendar: calendar, homeShowWorkflows: workflows, homeShowInbox: inbox, homeShowDate: none,
      homeShowSetup: none && out.homeGoogleConnected === false,
      homeDateLabel: new Date().toLocaleDateString([], {weekday: 'long', month: 'long', day: 'numeric'}),
      connectGoogle: openGoogle};
  };
}

/** Neutral Home card values used when no fixture defaults are bundled. */
const NEUTRAL_HOME = {
  homeCalendarLabel: 'Open your calendar', homeCalendarTime: 'Calendar', homeCalendarTitle: 'Loading events…',homeCalendarHasEvent:false,homeCalendarHasMeta:false,homeCalendarFooter:'',
  homeCalendarSource: '', homeCalendarOrigin: '', homeCalendarDescription: '', homeCalendarOverdue: false, homeCalendarNext: '', homeCalendarNextSource: '', homeCalendarHasNext: false, homeCalendarVideo: false, homeCalendarPeople: [] as Bag[],
  homeWorkflowFreshness: '', homeWorkflowDescription: '',
  homeBriefHas: false, homeBriefTitle: '', homeBriefStatus: '', homeBriefLabel: '', homeBriefFailed: false, homeInboxDescription: '',
  homeWorkflowLabel: 'Open workflows', homeWorkflowTitle: 'No brief yet', homeWorkflowTime: 'Workflows', homeWorkflowSource: '',
};

/** Call in both fixture and production before mounting. Fixture builds keep the
 * reference layout with HOME_DEFAULTS from fixtures.js; production builds swap
 * that module, so Home starts from neutral copy until live adapters override it. */
export function installPrototypeHomeBindings(Component: any) {
  const p = Component.prototype;
  const render = p.renderVals;
  p.renderVals = function () {
    const out = render.call(this);
    let storageAccessWarning='';
    if(!Capacitor.isNativePlatform())try{if(!window.indexedDB)throw Error();window.localStorage.getItem('alpha.appearance.v1');}catch{storageAccessWarning='Saving is unavailable. Changes may not be saved. Check your browser’s storage settings and reload.';}
    const activeView=this.S().view||'home';
    const chatModal=out.panelPE==='auto'&&this.S().chat==='full';
    const attention = mockAttentionRows();
    return {
      ...NEUTRAL_HOME,
      ...(HOME_DEFAULTS || {}),
      homeAttentionLabel: attention.length ? `${attention.length} ${attention.length === 1 ? 'item needs' : 'items need'} your attention` : 'Nothing needs your attention', homeAttentionPeople: attention,
      homeAttentionPeopleVisibility: attention.length ? 'visible' : 'hidden',
      ...out,
      activeViewLabel: activeView[0].toUpperCase()+activeView.slice(1), storageAccessWarning,
      nonblockingChat:out.panelPE==='auto'&&this.S().chat==='sheet',
      // OG's resting half sheet leaves the app interactive. Full chat, shade
      // and voice still retire the covered layer's focus/accessibility controls.
      homeHidden: !!(out.isView || out.shadeY === '0' || chatModal || out.voiceOn || this.S().drawer),
      appHidden: !!(out.shadeY === '0' || chatModal || out.voiceOn),
      conversationHidden: out.panelPE !== 'auto' || out.shadeY === '0' || !!out.voiceOn,
      shadeHidden: out.shadeY !== '0' || !!out.voiceOn,
      dockHidden: out.shadeY === '0' || !!out.voiceOn,
    };
  };
}
