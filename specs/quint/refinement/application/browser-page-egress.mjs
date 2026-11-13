/** Replays BrowserPageEgress traces against the installed Browser adapter: the rendered Share,
 * Share by email, Copy link and Bookmark controls over the shared tab session.
 *
 * Controlled ports: the native share sheet call (it settles when the model says), the 150 ms
 * wait before the page is checked again, the bookmark store (it applies each write at once), the
 * clipboard (it accepts or refuses each write as the model says) and the page states the native
 * tab host reports. Abstraction: the tab loads one HTTPS address and
 * one HTTP address; a model revision n is reported with navigation `n<n>`; `page` is read from
 * what the rendered controls offer; `secure`, `captured`, `secureSeen` and `readySeen` are
 * model-only. */
import assert from 'node:assert/strict';
import {modelTraces, replayTraces} from './browser-model-traces.mjs';
import {browserAdapterHost} from './browser-adapter-host.mjs';

const model = {path: 'specs/quint/application/BrowserPageEgress.qnt', module: 'BrowserPageEgress'};
const scenarios = ['shareWaitsForMenuTest', 'navigationDuringDelayRefusesTest', 'hiddenDuringDelayRefusesTest', 'unloadedPageRefusesEveryEgressTest', 'insecurePageIsNotBookmarkedTest', 'privateTabEgressTest', 'copyLinkNeedsShownPageTest', 'insecurePageFailureIsExplainedTest', 'failedShareIsReportedTest'];
const witnesses = ['SharedWitness', 'PageChangedBeforeShareWitness', 'PageMovedUnderShareSheetWitness', 'PrivatePageBookmarkedWitness', 'PrivatePageEmailedWitness', 'PrivatePageCopiedWitness', 'InsecurePageFailedWitness'];
const secureUrl = 'https://example.test/a', plainUrl = 'http://example.test/a';
const notices = {loadNotice: 'Load a page before sharing it.', changedNotice: 'The page changed before sharing. Try again.', emailNotice: 'Load the current page before sharing it.',
  bookmarkNotice: 'HTTPS only', failureNotice: 'The share sheet could not open.',
  copyNotice: 'Load the current page before copying its link.', copiedNotice: 'Link copied', clipboardNotice: 'Clipboard unavailable',
  insecureNotice: 'This site has no secure (HTTPS) connection, so it cannot be opened.'};

export async function browserPageEgressDriver() {
  return async trace => {
    const marks = new Set(), delays = [], copied = [], timeout = globalThis.setTimeout;
    let clipboardAccepts = true;
    const host = await browserAdapterHost({instant: ['bookmarks', 'setBookmark', 'browsingState', 'saveBrowsingState', 'present', 'close', 'cancelReading', 'readingSupport', 'create', 'navigate'],
      results: {bookmarks: () => ({urls: [...marks]}), setBookmark: ({url, saved}) => { if (saved) marks.add(url); else marks.delete(url); return {urls: [...marks]}; }}});
    globalThis.setTimeout = (run, ms, ...rest) => ms === 150 ? (delays.push(run), 0) : timeout(run, ms, ...rest);
    const state = host.state;
    Object.defineProperty(host.page.window.navigator, 'clipboard', {configurable: true, value: {writeText: async text => { if (!clipboardAccepts) throw new Error('refused'); copied.push(text); }}});
    if (trace.init.priv) host.rendered().openPrivate();
    host.rendered().onAddrKey({key: 'Enter', preventDefault() {}, target: {value: secureUrl}});
    await host.sync();
    const id = state().cur;
    let sequence = 0, revision = 1, url = secureUrl;
    const report = async fields => { host.emit('stateChanged', {id, sequence: ++sequence, navigation: `n${revision}`, url, title: 'Page', error: '', ...fields}); await host.sync(); };
    return {
      async startLoad(https) { revision++; url = https ? secureUrl : plainUrl; await report({loading: true, committed: false}); },
      commit: () => report({loading: false, committed: true}),
      loadFails: () => report({loading: false, committed: false, error: 'The page could not be opened.'}),
      async hide() { host.page.setHidden(true); await host.sync(); },
      async show() { host.page.setHidden(false); await host.sync(); },
      async leaveBrowser() { host.shellState.view = 'home'; host.view.onLeave(); await host.sync(); },
      async returnToBrowser() { host.shellState.view = 'browser'; await host.sync(); },
      async startShare() { host.rendered().openShare(); await host.sync(); },
      async shareDelayEnds() { assert.equal(delays.length, 1, 'one share is waiting'); delays.shift()(); await host.sync(); },
      nativeShareSettles: ok => host.settleCall('share', ok ? {} : {error: notices.failureNotice}),
      async shareEmail() { host.rendered().shareEmail(); await host.sync(); },
      async copyLink(ok) { clipboardAccepts = ok; host.rendered().copyLink(); await host.sync(); },
      async toggleBookmark() { host.rendered().toggleMark(); await host.sync(); },
      observe() {
        const s = state(), out = host.rendered(), shares = host.calls.filter(call => call.name === 'share'), selection = host.component.browserSelection();
        const emails = host.opened.filter(([view]) => view === 'inbox');
        for (const call of shares) assert.deepEqual([call.input.id, [secureUrl, plainUrl].includes(call.input.url)], [id, true], 'the share sheet gets this tab and its address');
        for (const [, input] of emails) assert.ok([secureUrl, plainUrl].includes(input.compose.body), 'the email draft carries the page address');
        assert.ok(copied.every(text => [secureUrl, plainUrl].includes(text)), 'the clipboard gets the page address');
        assert.ok(host.messages.every(message => Object.values(notices).includes(message)), `unexpected message: ${host.messages.join(' | ')}`);
        assert.equal(s.cur, id);
        const page = out.loading ? 'loading' : out.canFind ? 'ready' : 'failed';
        return {priv: !!out.isPrivate, page, revision: selection ? Number(selection.revision) : null,
          share: host.waiting('share') ? 'native' : delays.length ? 'waiting' : 'idle', sent: shares.length ? Number(shares.at(-1).input.navigation.slice(1)) : 0,
          nativeShares: shares.length, emails: emails.length, copies: copied.length, bookmarkWrites: host.calls.filter(call => call.name === 'setBookmark').length, marked: s.marks.includes(secureUrl),
          visited: s.visits.length > 0, ...Object.fromEntries(Object.entries(notices).map(([key, message]) => [key, host.messages.includes(message)]))};
      },
      async teardown() { globalThis.setTimeout = timeout; await host.teardown(); },
    };
  };
}

export async function checkBrowserPageEgress({random = 40, steps = 30} = {}) {
  const create = await browserPageEgressDriver();
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, create, {project: s => ({priv: s.priv, page: s.page, revision: s.page === 'failed' ? null : s.revision, share: s.share, sent: s.sent, nativeShares: s.nativeShares,
    emails: s.emails, copies: s.copies, bookmarkWrites: s.bookmarkWrites, marked: s.marked, visited: s.visited, loadNotice: s.loadNotice, changedNotice: s.changedNotice, emailNotice: s.emailNotice,
    bookmarkNotice: s.bookmarkNotice, failureNotice: s.failureNotice, copyNotice: s.copyNotice, copiedNotice: s.copiedNotice, clipboardNotice: s.clipboardNotice, insecureNotice: s.insecureNotice})});
}
