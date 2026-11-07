import {createElement, type ReactElement} from 'react';
import {OverviewAgendaCard, OverviewAttentionCard, OverviewBriefCard} from '../../../../.eliza/client-features/packages/ui/src/overview/OverviewCards.tsx';
type Bag = Record<string, any>;

const flag = (value: unknown) => (value === true ? 'true' : 'false');
const maskIcon = (name: string, color: string) => createElement('span', {style: {display: 'block', flexShrink: 0, width: 24, height: 24, background: color,
  mask: `url('/icons/lucide/${name}.svg') center/contain no-repeat`, WebkitMask: `url('/icons/lucide/${name}.svg') center/contain no-repeat`}});

/** The Home agenda card: the shared upstream card with Alpha's classes and installed selectors. */
export function homeAgendaCard(out: Bag): ReactElement | null {
  if (out.homeShowCalendar === false || out.homeCalendarConfirmedEmpty === true) return null;
  const next = out.homeCalendarHasNext ? {text: String(out.homeCalendarNext || ''), source: ''} : null;
  return createElement(OverviewAgendaCard, {
    heading: String(out.homeCalendarTime ?? ''), origin: '', title: String(out.homeCalendarTitle ?? ''),
    footer: String(out.homeCalendarFooter ?? ''), hasItem: out.homeCalendarHasEvent === true,
    // The read line appears only when the data adapter put one in the meta row.
    source: '',
    next, overdue: out.homeCalendarOverdue === true, stale: out.homeCalendarStale === true,
    label: String(out.homeCalendarLabel ?? 'Open your calendar'), description: String(out.homeCalendarDescription ?? ''),
    onActivate: typeof out.goCalendar === 'function' ? out.goCalendar : undefined,
    icon: maskIcon('calendar', '#ffffff'),
    videoIcon: out.homeCalendarVideo ? createElement('svg', {width: 16, height: 16, viewBox: '0 0 24 24'}, createElement('path', {d: out.ic?.video || ''})) : undefined,
    classNames: {card: 'home-calendar-card', head: 'home-calendar-head', heading: 'home-calendar-time', origin: 'home-calendar-origin', title: 'serif home-calendar-title',
      meta: 'home-calendar-meta', footer: 'home-calendar-footer', source: 'home-calendar-source', next: 'home-calendar-meta home-calendar-next',
      nextText: 'home-calendar-next-text', nextSource: 'home-calendar-source'},
    dataAttributes: {'data-alpha-home-calendar': '', 'data-alpha-home-calendar-event': flag(out.homeCalendarHasEvent),
      'data-alpha-home-calendar-meta': flag(out.homeCalendarHasMeta),
      'data-alpha-home-calendar-overdue': flag(out.homeCalendarOverdue), 'data-alpha-home-calendar-next': flag(!!next?.text),
      'data-alpha-home-calendar-stale': flag(out.homeCalendarStale)},
    partAttributes: {origin: {'data-alpha-home-calendar-origin': ''}, source: {'data-alpha-home-calendar-source': ''},
      next: {'data-alpha-home-calendar-next-line': ''}, nextSource: {'data-alpha-home-calendar-next-source': ''}},
    style: {flexShrink: 0, scrollSnapAlign: 'start', borderRadius: 30, background: 'var(--acc)', color: '#ffffff', padding: 22, boxSizing: 'border-box'},
  });
}

const INBOX_STATES = new Set(['not-connected', 'idle', 'loading', 'ready', 'stale', 'error']);
/**
 * The Home mail (attention) card: the shared upstream card with the values the Inbox adapter
 * computed from the page the user loaded (presentHomeInboxCard), Alpha's styles and its installed
 * selectors. It shows no message body and reads no mail.
 */
export function homeAttentionCard(out: Bag): ReactElement | null {
  if (out.homeShowInbox === false || out.homeInboxConfirmedEmpty === true) return null;
  const rows = Array.isArray(out.homeInboxRows) && out.homeInboxHasRows !== false
    ? out.homeInboxRows.map((row: Bag) => ({title: String(row?.subject ?? ''), detail: String(row?.from ?? '')})) : [];
  const people = Array.isArray(out.homeAttentionPeople) ? out.homeAttentionPeople.map((person: Bag) => String(person?.ini ?? '')) : [];
  return createElement(OverviewAttentionCard, {
    count: String(out.homeInboxCount ?? ''), rows, title: String(out.homeInboxTitle ?? ''), status: String(out.homeInboxStatus ?? ''), people,
    ...(INBOX_STATES.has(out.homeInboxState) ? {state: out.homeInboxState} : {}),
    label: String(out.homeAttentionLabel ?? 'Open Inbox'), description: String(out.homeInboxDescription ?? ''),
    onActivate: typeof out.goTriage === 'function' ? out.goTriage : undefined,
    icon: maskIcon('inbox', 'var(--acct)'),
    classNames: {card: 'home-card', title: 'serif'},
    dataAttributes: {'data-alpha-home-inbox': ''},
    partAttributes: {rows: {'data-alpha-home-inbox-subjects': ''}},
    style: {flexShrink: 0, scrollSnapAlign: 'start', width: 'max-content', minWidth: 172, maxWidth: 'calc(100% - 48px)', borderRadius: 30, background: 'var(--s2)', padding: 22,
      boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'space-between'},
    styles: {
      head: {display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%'},
      count: {fontSize: 14, fontWeight: 600, textAlign: 'left'},
      rows: {display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 260, minWidth: 0, textAlign: 'left'},
      row: {minWidth: 0},
      rowTitle: {fontSize: 18, fontWeight: 600, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'},
      rowDetail: {fontSize: 12, lineHeight: 1.4, color: 'var(--mut)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'},
      title: {fontSize: 26, lineHeight: 1.1, minWidth: 0, maxWidth: 260, textAlign: 'left', overflowWrap: 'anywhere'},
      status: {fontSize: 12, lineHeight: 1.4, minHeight: 17, color: 'var(--mut)', textAlign: 'left'},
      people: {display: 'flex', gap: 2, visibility: out.homePeopleVisibility === 'hidden' ? 'hidden' : 'visible'},
      person: {width: 28, height: 28, borderRadius: 14, background: 'var(--s3)', fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 0 0 2px var(--s2)', whiteSpace: 'nowrap'},
    },
  });
}

/** The Home brief card, present only while a retained brief exists for this connection. */
export function homeBriefCard(out: Bag): ReactElement | null {
  if (out.homeBriefHas !== true) return null;
  return createElement(OverviewBriefCard, {
    title: String(out.homeBriefTitle ?? ''), status: String(out.homeBriefStatus ?? ''), failed: out.homeBriefFailed === true,
    label: String(out.homeBriefLabel ?? ''), onActivate: typeof out.goBrief === 'function' ? out.goBrief : undefined,
    icon: maskIcon('sparkles', 'var(--acct)'),
    classNames: {card: 'home-brief-card', head: 'home-brief-head', title: 'home-brief-title', status: 'home-brief-status'},
    dataAttributes: {'data-alpha-home-brief': '', 'data-alpha-home-brief-failed': flag(out.homeBriefFailed)},
  });
}

/**
 * Renders Home's agenda, mail and brief cards with the shared upstream components from the values
 * the Home adapters computed. Install outermost among Home adapters (after the calendar, agent
 * calendar, Inbox and digest bindings) so the cards show their final values. It reads and runs nothing.
 */
export function installHomeOverviewCards(Component: any) {
  const p = Component.prototype, render = p.renderVals;
  p.renderVals = function () {
    const out = render.call(this);
    const agenda = homeAgendaCard(out), attention = homeAttentionCard(out), brief = homeBriefCard(out);
    const showWorkflow = out.homeShowWorkflows !== false && out.homeWorkflowConfirmedEmpty !== true;
    return {...out, homeAgendaCard: agenda, homeAttentionCard: attention, homeBriefCard: brief, homeShowWorkflow: showWorkflow,
      homeHasOverviewCards: !!(agenda || attention || brief || showWorkflow)};
  };
}
