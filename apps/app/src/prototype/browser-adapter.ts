import {parseNativeHistoryCommand} from "../../../../.eliza/client-features/plugins/plugin-browser/src/native-client-command.ts";
import {parseBrowserAddressInput} from "../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/address-input.ts";
import {browsingSnapshot, restoreBrowsing, DEFAULT_BROWSING_LIMITS} from "../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/browsing-session.ts";
import {BrowserTabSession, newBrowserTabId as newTabId, type BrowserFindResult, type BrowserFullscreen, type BrowserTabEvent, type BrowserTabNotice, type BrowserTabOpened, type BrowserTabState} from "../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/tab-host.ts";
import { registerPlugin } from '../platform-plugins';
import { Capacitor, CapacitorException, ExceptionCode } from '@capacitor/core';
import { DailyApps } from '../daily';
import { createNativeReadingVoice } from '../runtime/native-reading-voice';
import {reviewContentQuestion} from '../browser/content-question';
import {readPublicPageSource as browserReadingSource} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-source.ts';
import {createReadingSupport, pageQuestionExcerpt, READING_UNSUPPORTED_MESSAGE, sensitiveReadingText} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import {webSourceOf} from './summary-source';
import {browserCalendarScope} from './agent-calendar-adapter';
import { connectionController, agentPendingText } from '../runtime/connection-ui';
import { BrowserReviews } from '../browser/review';
import { createExternalBrowserHandoff } from './browser-external-handoff';
import { browserErrorMessage } from '../browser/browser-errors';
import { surfacePollIdle } from '../browser/browser-poll';
const {tabs: MAX_TABS, history: MAX_HISTORY} = DEFAULT_BROWSING_LIMITS;
type Bag = Record<string, any>;
// The shared native tab host (BrowserTabHostPlugin) under Alpha's Capacitor name; the web build
// registers its isolated-frame surface under the same name (browser/register.ts).
const Browser = registerPlugin<any>('AlphaBrowser');
const PROFILE_UNSUPPORTED_NATIVE_MESSAGE='This Android WebView does not support isolated browser profiles';
const PROFILE_UNSUPPORTED_MESSAGE='Update WebView';

/** Public browsing only. Install last, only outside visual fixture mode.
 * Product decision: normal tabs keep sign-ins (one persistent browser profile),
 * and their tabs and history are restored after a cold start. Private tabs use
 * an ephemeral profile and never enter saved tabs or history.
 * The native tabs, their event order and the document revisions that bind page
 * actions are the shared BrowserTabSession; this adapter binds it to Alpha's view. */
export function installPrototypeBrowserAdapter(Component: any, views: Record<string, Bag>) {
  const tabs = new BrowserTabSession({maxTabs: MAX_TABS});
  const session = tabs.session;
  const hiddenGeometry = JSON.stringify({session,id:null});
  const tabInfo = (id: string | undefined | null): Bag | undefined => tabs.info(id);
  // Cold-start tabs that have not been loaded yet: id -> last committed page.
  const restored = new Map<string, {url: string; title: string}>();
  const restoreAttempts = new Map<string, number>();
  const reviews = new BrowserReviews();
  let profileUnsupportedTab:string|undefined;
  let shell: any, lastGeometry = '', disposed = false, sharing = false, confirming = false, clearingData = false;
  let lastPresented:Bag|undefined,presentationFrame:number|undefined,presentationFailed=false;
  // Saving waits for a successful read so a damaged saved record is never overwritten implicitly.
  let sessionRead = false, sessionHydrated = false, lastSaved = '', saveQueue = Promise.resolve();
  let snapshotRevision = 0, snapshotInputs: Bag | undefined;
  let snapshotValue: ReturnType<typeof browsingSnapshot> | null = null, snapshotJson = '';
  let saveEpoch = 0, failedSnapshot = '', retryAt = 0, retryDelay = 2000, saveWarning = false;
  const tabOf = (id: string) => state()?.tabs?.find((tab: Bag) => tab.id === id);
  const isPrivate = (id: string) => !!tabOf(id)?.priv;
  let bookmarkRead: Promise<void> | undefined, bookmarkQueue = Promise.resolve();
  let bookmarkHydrated = false, bookmarkRefreshQueued = false, bookmarkRefreshBackground = false, initialBookmarkRead = false, browserWasActive = false;
  // Browser-owned bookmark storage reports damaged saved data by failing to
  // read. The product then offers its exact-byte recovery dialog in Bookmarks.
  let bookmarkRecovery = false;
  async function checkBookmarkRecovery() {
    if (Capacitor.isNativePlatform()) return false;
    const {bookmarkDocument} = await import('../browser/preference-documents');
    try { await bookmarkDocument.read<string[]>(() => []); return false; } catch { return true; }
  }
  function openBookmarkRecovery() {
    shell?.vset('browser', {lib: null, menu: false});
    void import('../browser/preference-recovery').then(m => m.openBookmarkRecovery()).catch(report);
  }
  function loadBookmarks() {
    if (bookmarkRead) return bookmarkRead;
    bookmarkRead = Browser.bookmarks({session}).then((result: Bag) => {
      if (!disposed) { if (bookmarkRecovery) { bookmarkRecovery = false; refresh(); } shell?.vset('browser', {marks: result.urls}); bookmarkHydrated = true; }
    }).catch(async (error: unknown) => {
      bookmarkHydrated = false;
      if (!disposed && await checkBookmarkRecovery().catch(() => false)) {
        const first = !bookmarkRecovery; bookmarkRecovery = true; refresh();
        if (first) throw new Error('Saved bookmarks need recovery. Open Bookmarks to recover them.');
        return;
      }
      throw error;
    }).finally(() => { bookmarkRead = undefined; });
    return bookmarkRead;
  }
  const unimplemented = (error: unknown) => error instanceof CapacitorException && error.code === ExceptionCode.Unimplemented;
  /** `background`: the first read at startup, outside Browser. A host without the Browser plugin
   * then says nothing over whatever screen is open (sign-in, setup, Settings); opening Browser
   * reads again and reports it there. */
  function refreshBookmarks(background = false) {
    if (disposed) return;
    // Browser opening owns an already-pending startup read too, so its failure must be visible.
    if (bookmarkRefreshQueued) { if (!background) bookmarkRefreshBackground = false; return; }
    bookmarkRefreshBackground = background;
    bookmarkRefreshQueued = true;
    bookmarkQueue = bookmarkQueue.then(() => disposed ? undefined : loadBookmarks()).catch((error: unknown) => { if (!(bookmarkRefreshBackground && shell?.S().view !== 'browser' && unimplemented(error))) report(error); }).finally(() => { bookmarkRefreshQueued = false; });
  }
  function saveBookmark(url: string, saved?: boolean) {
    bookmarkQueue = bookmarkQueue.then(async () => {
      if (!bookmarkHydrated) await loadBookmarks();
      if (disposed) return;
      const result = await Browser.setBookmark({session, url, saved: saved ?? !state().marks.includes(url)});
      if (!disposed) shell.vset('browser', {marks: result.urls, menu: false});
    }).catch(report);
  }
  const state = () => shell?.vget('browser');
  const refresh = () => { ++snapshotRevision; shell?.vset('browser', { nativeRevision: Date.now() }); };
  const report = (error: unknown) => !disposed && shell?.toast(browserErrorMessage(error));
  let reading: AbortController | undefined, questionReview=false;
  // Android only: whether this WebView provider can read a page in isolation.
  // The web build separately requires a committed embedded document.
  const readingSupport = Capacitor.isNativePlatform() ? createReadingSupport(() => Browser.readingSupport(), () => refresh()) : undefined;
  /** Says so, with the menu closed, when page reading cannot work on this device. */
  async function readingUnsupported() {
    if (!readingSupport || await readingSupport.check() !== 'unavailable') return false;
    if (!disposed) { shell?.vset('browser', {menu: false}); report(new Error(READING_UNSUPPORTED_MESSAGE)); }
    return true;
  }
  function stopReading() { const active=reading; reading=undefined; active?.abort(); void Browser.cancelReading({session}).catch(()=>{}); }
  const unsubscribeReading = connectionController.subscribe(()=>{ if(reading && (connectionController.getSnapshot().open || document.hidden)) stopReading(); });
  async function readPage() {
    if(reading){stopReading();return;}
    const id=state()?.cur, info=tabInfo(id), revision=tabs.revision(id);
    if(!Capacitor.isNativePlatform()){
      // The refusal is not left behind an open menu (the same rule as Ask about page).
      if(!info?.committed || info.loading || info.error || info.externalOnly){shell.vset('browser',{menu:false});report(new Error('Load a page before reading.'));return;}
      const controller=new AbortController();reading=controller;
      const valid=()=>{controller.signal.throwIfAborted();if(disposed||document.hidden||document.documentElement.hasAttribute('data-dev-background')||shell.S().screen!=='home'||shell.S().view!=='browser'||state()?.cur!==id||tabs.revision(id)!==revision||connectionController.getSnapshot().open)throw new DOMException('Reading cancelled','AbortError');};
      try{shell.vset('browser',{menu:false});const {reviewBrowserReading}=await import('../browser/reading-review');valid();await reviewBrowserReading(info.url,controller.signal,valid);}
      catch(error){if(!controller.signal.aborted)report(error);}finally{if(reading===controller)reading=undefined;}
      return;
    }
    // Before any speech route is asked for: without isolated reading there is nothing to read.
    if(await readingUnsupported())return;
    if(reading||disposed||state()?.cur!==id||tabs.revision(id)!==revision)return;
    const voice=createNativeReadingVoice(), binding=voice?.binding;
    if(!voice || !binding){report(new Error(connectionController.getSnapshot().session?'This agent does not offer speech to read this page.':agentPendingText()));return;}
    if(!info?.committed || info.loading || info.error){report(new Error('Load an HTTPS page before reading.'));return;}
    const controller=new AbortController();reading=controller;
    const valid=()=>{controller.signal.throwIfAborted();if(disposed||document.hidden||shell.S().view!=='browser'||state()?.cur!==id||tabs.revision(id)!==revision||!voice.isCurrent()||connectionController.getSnapshot().open)throw new DOMException('Reading cancelled','AbortError');};
    const unsubscribe=connectionController.subscribe(()=>{try{valid();}catch{stopReading();}});
    try {
      shell.vset('browser',{menu:false});await new Promise(resolve=>setTimeout(resolve,150));valid();lastGeometry='';await update();
      if(!await voice.ready(controller.signal))throw new Error('Your agent isn’t ready for speech.');valid();
      const result=await Browser.reviewReading({session,id,url:info.url,navigation:info.navigation,...binding});valid();
      await voice.speak(result.readingToken,controller.signal);valid();
    }catch(error){if(!controller.signal.aborted)report(error);}finally{unsubscribe();if(reading===controller){reading=undefined;void Browser.cancelReading({session}).catch(()=>{});}}
  }
  async function askPage() {
    stopReading();
    if(await readingUnsupported())return;
    if(reading||disposed)return;
    const id=state()?.cur,info=tabInfo(id),revision=tabs.revision(id);
    const source=webSourceOf({kind:'web-page',version:1,name:String(info?.title||info?.url||'Web page').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,120),url:info?.url});
    if(!source||!info?.committed||info.loading||info.error||info.externalOnly){shell.vset('browser',{menu:false});report(new Error('Load a public HTTPS page before asking about it.'));return;}
    const controller=new AbortController();reading=controller;
    const current=()=>!controller.signal.aborted&&!disposed&&!document.hidden&&!document.documentElement.hasAttribute('data-dev-background')&&shell.S().screen==='home'&&shell.S().view==='browser'&&state()?.cur===id&&tabs.revision(id)===revision&&!connectionController.getSnapshot().open;
    try{
      shell.vset('browser',{menu:false});
      let text='';
      if(Capacitor.isNativePlatform()){
        await new Promise(resolve=>setTimeout(resolve,150));if(!current())return;lastGeometry='';await update();
        // Android may be unable to read the page in its isolated world (an old System WebView) or return
        // nothing usable. Then the review opens with an empty excerpt, as the web CORS-denied path does,
        // and Continue stays disabled until the user pastes text. A sensitive page never opens a review.
        text=await pageQuestionExcerpt(()=>Browser.reviewQuestion({session,id,url:info.url,navigation:info.navigation}));
      }else{
        const result=await browserReadingSource(source.url,controller.signal);if(result?.blocked)throw Error('This page may contain credentials or verification codes. Open a different page.');text=result?.text||'';
      }
      if(!current())return;questionReview=true;lastGeometry='';await update();
      // A review that fails to open must not leave the page hidden behind a dialog that is not there.
      try{reviewContentQuestion({name:source.name,text,signal:controller.signal,current,validate:text=>!sensitiveReadingText(text),source:async()=>{if(!current())throw Error('Page changed');return source;},compose:(draft,source)=>shell.api('browser').composeContentQuestion(draft,source),closed:()=>{questionReview=false;lastGeometry='';if(reading===controller)reading=undefined;}});}
      catch(error){questionReview=false;lastGeometry='';throw error;}
    }catch(error){if(!controller.signal.aborted)report(error);}finally{if(!questionReview&&reading===controller)reading=undefined;}
  }
  function hide() {
    if (lastGeometry === hiddenGeometry) return;
    void presentBrowser({session,id:null});
  }
  function ensure(id: string, priv = isPrivate(id)) {
    return tabs.ensure(id, priv, () => Browser.create({ session, id, private: priv }).catch((error: unknown) => { if(!disposed&&Capacitor.isNativePlatform()&&state()?.cur===id&&error instanceof Error&&error.message===PROFILE_UNSUPPORTED_NATIVE_MESSAGE){profileUnsupportedTab=id;refresh();} throw error; }));
  }
  async function navigate(raw: string, newTab = false, approvedSignal?: AbortSignal, privateTab = false, background = false) {
    let url: URL;
    try {
      // The shared address-bar classification; Alpha keeps its length bound, HTTPS default and search provider.
      if (raw.trim().length > 4096) throw new Error();
      let input = parseBrowserAddressInput(raw, {defaultProtocol: 'https:'});
      // The shared parser reads any word:digits as host:port; an all-digit, dotless host (10:30, 3:16) is a search, not 0.0.0.10:30.
      if (input.kind === 'url' && /^\d+:\d+(?:[/?#]|$)/.test(raw.trim())) input = {kind: 'search', query: raw.trim()};
      // Typed search operators, bare email text and short decimals stay searches.
      // Explicit web schemes and user-info inputs stay refused; never search a password.
      const typed = raw.trim();
      if (!approvedSignal && !/^https?:/i.test(typed) && (input.kind === 'rejected' ? (input.reason === 'unsupported-protocol' && !typed.includes('@')) || (input.reason === 'credentials' && /^[^\s/:@?#%]+@[^\s/:@?#%]+$/.test(typed)) : input.kind === 'url' && /^\d+(?:\.\d+){0,2}$/.test(typed))) input = {kind:'search',query:typed};
      if (input.kind === 'rejected') throw new Error();
      if (input.kind === 'url') { url = new URL(input.href); if (!url.hostname) throw new Error(); }
      // Alpha's alias: a bare localhost (with an optional path) stays an address, as it was before the shared parser.
      else if (/^localhost(?:[/?#]\S*)?$/i.test(input.query)) { url = new URL('https://' + input.query); if (url.hostname !== 'localhost') throw new Error(); }
      else {
        // Submit only on Enter. No suggestions, background query traffic or agent upload.
        url = new URL('https://www.google.com/search');
        url.searchParams.set('q', input.query);
      }
    } catch { if (approvedSignal) throw new Error('Invalid approved browser destination'); report(new Error('Enter search words or a valid HTTP or HTTPS address without credentials.')); return; }
    const s = state(); if (!s) { if (approvedSignal) throw new Error('Browser unavailable'); return; }
    // Restored rows count: an agent open past the cap fails visibly instead of being dropped.
    if (newTab && s.tabs.length >= MAX_TABS) { const full = new Error('Tab limit'); if (approvedSignal) throw full; report(full); return; }
    profileUnsupportedTab=undefined;
    const selectedTab=s.cur;
    const id = newTab ? newTabId() : s.cur, priv = newTab ? privateTab : isPrivate(id);
    // Keep the last committed address durable while a restored page is loading or fails.
    const saved = restored.get(id);
    if (saved) tabs.annotate(id, { savedUrl: saved.url, title: saved.title });
    restored.delete(id);
    try {
      const creation=ensure(id, priv);
      await creation;
      if(newTab&&(approvedSignal?.aborted||disposed)&&tabs.creation(id)===creation){tabs.forget([id]);void Browser.close({session,id}).catch(report);}
      approvedSignal?.throwIfAborted();
      if (disposed) { if (approvedSignal) throw new Error('Browser closed'); return; }
      const current=state();
      if(tabs.creation(id)!==creation||!current||(!newTab&&!current.tabs.some((tab:Bag)=>tab.id===id))){void Browser.close({session,id}).catch(report);if(approvedSignal)throw new Error('Browser tab closed');return;}
      if((!background||approvedSignal)&&current.cur!==selectedTab){if(newTab){tabs.forget([id]);void Browser.close({session,id}).catch(report);}if(approvedSignal)throw new Error('Browser tab changed');return;}
      // A tab that opened while this one was being created can have filled the last place.
      if (newTab && current.tabs.length >= MAX_TABS) { tabs.forget([id]); void Browser.close({session,id}).catch(report); const full = new Error('Tab limit'); if (approvedSignal) throw full; report(full); return; }
      if (newTab) shell.vset('browser', { tabs: [...state().tabs, { id, hist: ['newtab'], pos: 0, ...(priv ? {priv: true} : {}) }], ...(!background ? {cur: id} : {}) });
      tabs.beginNavigation(id, url.href);
      // A background (restored-tab) load must not close a menu or switcher the
      // user opened while its native tab was being created.
      if (!background) shell.vset('browser', { editing: false, tabsOpen: false, menu: false, lib: null, share: false });
      await Browser.navigate({ session, id, url: url.href });
      refresh();
      restoreAttempts.delete(id);
      return id;
    } catch (error) {
      if (approvedSignal) throw error;
      // A restored tab whose native creation failed transiently (for example while the
      // host document was being replaced) keeps its saved page and retries when shown.
      const attempts = (restoreAttempts.get(id) || 0) + 1;
      if (background && saved && attempts < 3 && !disposed && state()?.tabs?.some((tab: Bag) => tab.id === id)) { if (tabs.has(id)) { void Browser.close({ session, id }).catch(() => {}); tabs.forget([id]); } restoreAttempts.set(id, attempts); restored.set(id, saved); return; }
      restoreAttempts.delete(id); report(error);
    }
  }
  async function command(command: string) {
    const id = state()?.cur; if (!id || !tabs.has(id)) return;
    try { await Browser.command({ session, id, command }); } catch (error) { report(error); }
  }
  // Find in page: native findAllAsync/findNext on the selected tab. Navigation,
  // tab switches and closing clear it natively and the renderer follows.
  let findTimer = 0;
  const findIdle = { finding: false, findQuery: '', findCount: 0, findIndex: 0, findDone: true };
  function openFind() {
    const id = state()?.cur, info = tabInfo(id);
    if (!info?.committed || info.error) { report(new Error('Load a page before finding text in it.')); return; }
    shell.vset('browser', { ...findIdle, finding: true, findTab: id, menu: false });
  }
  function closeFind() {
    window.clearTimeout(findTimer);
    const s = state(), id = s?.findTab;
    if (s?.finding) shell.vset('browser', { ...findIdle, findTab: null });
    if (id && tabs.has(id)) void Browser.clearFind({ session, id }).catch(() => {});
  }
  function findQuery(query: string) {
    const id = state()?.findTab; if (!id || id !== state()?.cur) { closeFind(); return; }
    const value = query.replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, '').slice(0, 200);
    shell.vset('browser', { findQuery: value, findDone: !value, ...(value ? {} : { findCount: 0, findIndex: 0 }) });
    window.clearTimeout(findTimer);
    // Debounced so typing does not issue a native search per keystroke.
    // A tab switch during the debounce must not search a tab that is no longer shown.
    findTimer = window.setTimeout(() => { if (tabs.has(id) && id === state()?.cur && id === state()?.findTab) void Browser.find({ session, id, query: value }).catch(report); }, 150);
  }
  function findStep(forward: boolean) {
    const s = state(), id = s?.findTab;
    if (!id || id !== s.cur || !s.findQuery || !s.findCount) return;
    void Browser.findNext({ session, id, forward }).catch(report);
  }
  async function sharePage() {
    const id=state()?.cur, info=tabInfo(id), revision=tabs.revision(id);
    if(sharing)return;
    if(!info?.committed || info.loading || info.error || !info.navigation){report(new Error('Load a page before sharing it.'));return;}
    sharing=true;
    try {
      shell.vset('browser',{menu:false,share:false});
      // Restore the actual child surface after the reference menu closes.
      await new Promise(resolve=>setTimeout(resolve,150));
      if(disposed || document.hidden || shell.S().view!=='browser' || state()?.cur!==id || tabs.revision(id)!==revision)throw new Error('The page changed before sharing. Try again.');
      lastGeometry='';await update();
      await Browser.share({session,id,navigation:info.navigation,url:info.url});
    } catch(error){report(error);} finally {sharing=false;}
  }
  function sharePageEmail(){
    const id=state()?.cur,info=tabInfo(id),revision=tabs.revision(id);
    if(disposed||document.hidden||shell.S().view!=='browser'||!info?.committed||info.loading||info.error||!info.url||tabs.revision(id)!==revision){report(new Error('Load the current page before sharing it.'));return;}
    shell.vset('browser',{menu:false,share:false});
    shell.api('browser').open('inbox',{compose:{subject:info.title||'Shared page',body:info.url}});
  }
  async function copyPageLink(){
    // Read the committed page at the tap, never the address-bar draft or the render
    // that opened the menu. Redirects and in-page navigation can change that URL.
    const id=state()?.cur,info=tabInfo(id),revision=tabs.revision(id);
    const current=()=>!disposed&&!document.hidden&&shell.S().view==='browser'&&state()?.cur===id&&tabs.revision(id)===revision;
    if(!current()||!info?.committed||info.loading||info.error||!info.url){report(new Error('Load the current page before copying its link.'));return;}
    try{await navigator.clipboard.writeText(info.url);if(current()){shell.vset('browser',{menu:false,share:false});shell.api('browser').toast('Link copied');}}
    catch{if(current())report(new Error('Clipboard unavailable'));}
  }
  const externalHandoff = createExternalBrowserHandoff({tabs, reviews, shell: () => shell, Browser, state, isPrivate, update: () => update(), report, flags: {
    get sharing() { return sharing; }, set sharing(value) { sharing = value; },
    get confirming() { return confirming; }, set confirming(value) { confirming = value; },
    get lastGeometry() { return lastGeometry; }, set lastGeometry(value) { lastGeometry = value; },
    get disposed() { return disposed; },
  }});
  /** Remove renderer tabs whose native WebView is already gone. A closed pop-up returns to its opener. */
  function forgetTabs(ids: string[], clearHistory = false, afterCommit?: () => void) {
    tabs.forget(ids); for (const id of ids) restored.delete(id);
    const s = state(); if (!s) {afterCommit?.();return;}
    const rest = s.tabs.filter((tab: Bag) => !ids.includes(tab.id));
    const next = rest.length ? rest : [{ id: newTabId(), hist: ['newtab'], pos: 0 }];
    const opener = s.tabs.find((tab: Bag) => tab.id === s.cur)?.opener;
    const cur = next.some((tab: Bag) => tab.id === s.cur) ? s.cur : next.some((tab: Bag) => tab.id === opener) ? opener : next[0].id;
    shell.vset('browser', {tabs: next, cur, ...(clearHistory ? {visits: []} : {})}, {afterCommit});
  }
  function savedSnapshot() {
    const s = state(); if (!s) return null;
    // The 100ms native geometry check also runs while another app is open. Only
    // changed tab/history references, selection or native metadata need URL normalization.
    if (!snapshotInputs || snapshotInputs.tabs !== s.tabs || snapshotInputs.visits !== s.visits || snapshotInputs.cur !== s.cur || snapshotInputs.revision !== snapshotRevision) {
      snapshotInputs = {tabs: s.tabs, visits: s.visits, cur: s.cur, revision: snapshotRevision};
      snapshotValue = browsingSnapshot(s, id => { const info = tabInfo(id), saved = restored.get(id); return { url: (!Capacitor.isNativePlatform()&&info?.externalOnly?info.url:info?.savedUrl) || saved?.url, title: info?.title || saved?.title }; });
      snapshotJson = JSON.stringify(snapshotValue);
    }
    return snapshotValue;
  }
  function saveSession() {
    if (!sessionHydrated || clearingData || disposed) return;
    const snapshot = savedSnapshot(); if (!snapshot) return;
    const next = snapshotJson; if (next === lastSaved || (next === failedSnapshot && Date.now() < retryAt)) return;
    const epoch = saveEpoch;
    lastSaved = next;
    saveQueue = saveQueue.then(async () => {
      if (disposed || clearingData || epoch !== saveEpoch) return;
      try {
        await Browser.saveBrowsingState({ session, ...snapshot });
        if (disposed || epoch !== saveEpoch) return;
        failedSnapshot = ''; retryAt = 0; retryDelay = 2000; saveWarning = false;
      } catch {
        if (disposed || epoch !== saveEpoch || lastSaved !== next) return;
        lastSaved = ''; failedSnapshot = next; retryAt = Date.now() + retryDelay; retryDelay = Math.min(60000, retryDelay * 2);
        if (!saveWarning) { saveWarning = true; report(new Error('Tabs and history could not be saved. Alpha will try again shortly.')); }
      }
    });
  }
  async function restoreSession() {
    if (sessionRead || clearingData) return; sessionRead = true;
    const epoch = saveEpoch;
    try {
      const saved = await Browser.browsingState({ session });
      if (disposed) return;
      // Clear owns the newer generation, including a cleared renderer snapshot.
      // An older launch read cannot restore its tabs or history after that boundary.
      if (epoch !== saveEpoch) { if (!sessionHydrated) sessionRead = false; return; }
      const s = state(); if (!s) return;
      // Never replace a tab the user is already typing into: the open tabs then stay, still selected,
      // and the saved tabs that fit under the tab limit follow them, so the first save keeps them.
      const pristine = tabs.ids().length === 0 && s.tabs.length === 1 && !tabs.info(s.tabs[0].id) && !s.editing;
      const next = restoreBrowsing(saved, s, true);
      const added = pristine ? next.restored : next.restored.filter(tab => !s.tabs.some((open: Bag) => open.id === tab.id)).slice(0, Math.max(0, MAX_TABS - s.tabs.length));
      // Restored tabs load (an ordinary GET of the last committed address)
      // only when the tab is shown; nothing is resubmitted.
      for (const tab of added) restored.set(tab.id, { url: tab.url, title: tab.title });
      const rows = added.map(tab => ({ id: tab.id, hist: ['newtab'], pos: 0 }));
      if (added.length) shell.vset('browser', pristine ? { tabs: rows, cur: next.cur, visits: next.visits } : { tabs: [...s.tabs, ...rows], visits: next.visits });
      else if (next.visits.length !== s.visits.length) shell.vset('browser', { visits: next.visits });
      sessionHydrated = true;
      lastSaved = JSON.stringify(savedSnapshot());
    } catch (error) {
      // Restore runs at startup, over any screen: a host without the Browser plugin has no saved tabs to report.
      if (unimplemented(error)) return;
      report(new Error('Saved tabs and history could not be opened. They were kept unchanged; Clear browsing data resets them.'));
    }
  }
  async function confirmBrowser(id: string, title: string, details: string) {
    shell.vset('browser', { menu: false });
    confirming = true; lastGeometry = ''; await update();
    try { return await reviews.confirm(id, title, details, 'Clear data'); }
    finally { confirming = false; lastGeometry = ''; }
  }
  async function clearBrowsingData() {
    if (clearingData) return;
    const ok = await confirmBrowser('browser-clear-data', 'Clear browsing data?', Capacitor.isNativePlatform() ? 'Clears history, cookies and tabs.' : 'Clears history and tabs.');
    if (!ok || disposed) return;
    clearingData = true;
    // Retire queued snapshots and let an already-dispatched save finish before
    // Clear. No old write may restore history after the native clear completes.
    ++saveEpoch; lastSaved = ''; failedSnapshot = ''; retryAt = 0; retryDelay = 2000; saveWarning = false;
    try {
      await saveQueue;
      if (disposed) return;
      const result = await Browser.clearBrowsingData({ session });
      if (disposed) return;
      const normal = state().tabs.filter((tab: Bag) => !tab.priv).map((tab: Bag) => tab.id);
      const closed = [...new Set([...normal, ...(Array.isArray(result?.closed) ? result.closed : [])])];
      // Keep saves paused through React's publication of the cleared snapshot.
      await new Promise<void>(resolve => forgetTabs(closed, true, resolve));
      if (disposed) return;
      sessionHydrated = true; lastSaved = JSON.stringify(savedSnapshot());
      shell.toast(Capacitor.isNativePlatform() ? 'Cleared' : 'Cleared');
    } catch (error) { report(error); } finally { clearingData = false; }
  }
  async function clearSiteData() {
    if (!Capacitor.isNativePlatform()) return;
    const id = state()?.cur, info = tabInfo(id);
    let host = '';
    try { host = new URL(info?.url).hostname; } catch {}
    if (!host || !info?.committed || info.error) { report(new Error('Load a website before clearing its data.')); return; }
    const ok = await confirmBrowser('browser-clear-site', `Clear data for ${host}?`, `Signs you out of ${host}.`);
    if (!ok || disposed) return;
    try {
      const result = await Browser.clearSiteData({ session, id, url: info.url });
      if (!disposed) shell.toast(`Cleared ${result?.site || host}`);
    } catch (error) { report(error); }
  }
  const definition = views.browser;
  definition.state = { ...definition.state, tabs: [{ id: 'b0', hist: ['newtab'], pos: 0 }], cur: 'b0', marks: [], visits: [], booked: null, ag: null, confirm: null, finding: false, findTab: null, findQuery: '', findCount: 0, findIndex: 0, findDone: true };
  // These are in-memory view-reset keys, not disk persistence. Keep the native
  // tab identities while visiting other apps; a cold start begins with b0 until
  // restoreSession replaces it with saved normal tabs.
  definition.persist = ['tabs', 'cur', 'marks', 'visits'];
  definition.onLeave = () => {externalHandoff.retire();stopReading();hide();};
  definition.reply = () => null;
  definition.back = (s: Bag, api: Bag) => {
    if (s.finding) { closeFind(); return true; }
    for (const key of ['editing', 'tabsOpen', 'menu', 'lib', 'share']) if(s[key]) { api.set({ [key]: key === 'lib' ? null : false }); return true; }
    if (tabInfo(s.cur)?.canBack) { void command('back'); return true; }
    return false;
  };
  const focusedAddresses = new WeakSet<HTMLInputElement>();
  definition.render = (s: Bag, api: Bag) => {
    if(profileUnsupportedTab&&profileUnsupportedTab!==s.cur)profileUnsupportedTab=undefined;
    const info = tabInfo(s.cur), url = info?.url ? new URL(info.url) : null;
    const openNew = (priv = false) => { if (s.tabs.length >= MAX_TABS) { api.toast('Tab limit'); return; } const id=newTabId(); api.set({ tabs:[...s.tabs,{id,hist:['newtab'],pos:0,...(priv?{priv:true}:{})}],cur:id,tabsOpen:false,menu:false,editing:true,addr:'' }); };
    const priv = !!s.tabs.find((tab: Bag) => tab.id === s.cur)?.priv;
    const known = (id: string) => tabInfo(id) || restored.get(id);
    const query=String(s.addr||'').trim().toLocaleLowerCase();
    const localSuggestions=Array.from(new Set<string>([...s.marks,...(priv?[]:s.visits)])).filter(value=>value!=='newtab'&&(!query||value.toLocaleLowerCase().includes(query))).slice(0,8).flatMap(value=>{
      try{const address=new URL(value);if(!['https:','http:'].includes(address.protocol)||address.username||address.password)return [];return [{title:address.hostname,url:address.pathname+address.search+address.hash,d:s.marks.includes(value)?api.ic.star:api.ic.clock,go:()=>void navigate(value)}];}catch{return [];}
    });
    const historyOpen = s.lib === 'history';
    const selectedTabStyle = 'background:var(--acc);color:var(--alpha-white)';
    const unselectedTabStyle = 'color:var(--mut)';
    return {
      editing: !!s.editing, notEditing: !s.editing, addr: s.addr || '',
      onAddr: (event: Event) => api.set({addr: (event.target as HTMLInputElement).value}),
      cancelEdit: () => api.set({editing: false}),
      focusRef: (input: HTMLInputElement | null) => {
        if (!input || focusedAddresses.has(input)) return;
        focusedAddresses.add(input);
        input.focus({preventScroll: true});
        input.select();
      },
      tabsOpen: !!s.tabsOpen, nTabs: s.tabs.length,
      tabsTitle: s.tabs.length === 1 ? '1 tab' : s.tabs.length + ' tabs',
      openTabs: () => api.set({tabsOpen: true, menu: false, editing: false}),
      closeTabs: () => api.set({tabsOpen: false}),
      menu: !!s.menu,
      toggleMenu: () => api.set({menu: !api.get('browser').menu, editing: false}),
      closeMenu: () => api.set({menu: false}),
      share: !!s.share, closeShare: () => api.set({share: false}),
      lib: !!s.lib, libIsHist: historyOpen && s.visits.length > 0,
      openLib: () => api.set({lib: 'bookmarks', menu: false}),
      closeLib: () => api.set({lib: null}),
      libMarks: () => api.set({lib: 'bookmarks'}),
      libHist: () => api.set({lib: 'history'}),
      libMarksCss: historyOpen ? unselectedTabStyle : selectedTabStyle,
      libHistCss: historyOpen ? selectedTabStyle : unselectedTabStyle,
      clearHist: () => api.set({visits: []}),
      profileUnsupportedPage:profileUnsupportedTab===s.cur&&!s.editing,profileUnsupportedEditing:profileUnsupportedTab===s.cur&&!!s.editing,profileUnsupportedMessage:PROFILE_UNSUPPORTED_MESSAGE,isNews:false,isEnc:false,isBook:false,isSearch:false,isGeneric:false,isNew:!info,
      privateNotice:Capacitor.isNativePlatform()?'Private · cleared on close':'This tab is not saved in Alpha history. Website cookies and sign-ins are managed by your browser.',isPrivate:priv,openPrivate:()=>openNew(true),clearData:()=>void clearBrowsingData(),clearSite:()=>void clearSiteData(),canClearSite:Capacitor.isNativePlatform()&&!!info?.committed&&!info?.error&&!!url,
      recents:[],sugg:localSuggestions,people:[],agOn:false,confirm:false,clearAddress:(event:Event)=>{api.set({addr:''});(event.currentTarget as HTMLElement).parentElement?.querySelector('input')?.focus();},
      // Find in page is native findAllAsync. A web build's page is an opaque-origin sandboxed frame the host
      // cannot search, so the menu offers no Find there (the template keys on openFind).
      openFind:Capacitor.isNativePlatform()?()=>openFind():undefined,canFind:Capacitor.isNativePlatform()&&!!info?.committed&&!info?.error,finding:!!s.finding&&s.findTab===s.cur,
      find:{query:s.findQuery||'',count:s.findCount||0,index:s.findIndex||0,
        label:!s.findQuery?'':s.findCount?`${s.findIndex||1} of ${s.findCount}`:(s.findDone===false?'Searching…':'No matches'),
        onInput:(e:Event)=>findQuery((e.target as HTMLInputElement).value),
        onKey:(e:KeyboardEvent)=>{if(e.key==='Enter'){e.preventDefault();findStep(!e.shiftKey);}else if(e.key==='Escape'){e.preventDefault();closeFind();}},
        next:()=>findStep(true),prev:()=>findStep(false),close:()=>closeFind(),nextOp:s.findCount?1:0.3,prevOp:s.findCount?1:0.3},
      host:url?.host || 'Search or address',hostCss:url?'':'color:var(--mut)',path:url ? url.pathname + url.search : '', hasLock:Capacitor.isNativePlatform() && !!url && url.protocol==='https:' && !!info?.committed && !info?.loading && !info?.error,
      pageShareAvailable:Capacitor.isNativePlatform(),canCopyLink:!!info?.committed&&!info.loading&&!info.error,pageContentAvailable:Capacitor.isNativePlatform()||!!info?.committed&&!info.loading&&!info.error&&!info.externalOnly,nativeControls:true,externalBrowserAvailable:Capacitor.isNativePlatform(),openExternalBrowser:()=>void externalHandoff.open(),openPasswordProvider:()=>{api.set({menu:false});api.open('settings',{page:'password-provider'});},openDownloads:()=>{api.set({menu:false});void Browser.downloads({session}).catch(report);},copyLink:()=>void copyPageLink(),reload:()=>{api.set({menu:false});void command('reload');},stopLoading:()=>{api.set({menu:false});void command('stop');},loading:!!info?.loading,goBack:()=>void command('back'),goFwd:()=>void command('forward'),backOp:info?.canBack?1:0.3,fwdOp:info?.canForward?1:0.3,
      startEdit:()=>api.set({editing:true,addr:info?.url||'',menu:false}),onAddrKey:(e:KeyboardEvent)=>{ if(e.key==='Enter'){e.preventDefault();void navigate((e.target as HTMLInputElement).value);} else if(e.key==='Escape')api.set({editing:false}); },
      toggleMark:()=>{if((!info?.committed&&!(info?.externalOnly&&!Capacitor.isNativePlatform())) || info.loading || info.error || url?.protocol!=='https:'){api.toast('HTTPS only');return;}saveBookmark(info.url);},markLabel:s.marks.includes(info?.url)?'Bookmarked':'Bookmark',markFill:s.marks.includes(info?.url)?'currentColor':'none',libRows:[...(bookmarkRecovery&&s.lib!=='history'?[{id:'bookmark-recovery',title:'Recover saved bookmarks',host:'Bookmarks unavailable',ini:'!',go:openBookmarkRecovery,canRemove:false,removeAria:'',remove:()=>{}}]:[]),...Array.from(new Set<string>(s.lib==='history'?s.visits:s.marks)).map((u:string)=>({id:u,title:u,host:u,ini:new URL(u).hostname[0],go:()=>void navigate(u),canRemove:s.lib!=='history',removeAria:'Remove bookmark',remove:()=>saveBookmark(u,false)}))],libEmpty:!(bookmarkRecovery&&s.lib!=='history')&&!(s.lib==='history'?s.visits:s.marks).length,newTab:()=>openNew(false),askPage:()=>void askPage(),readAloud:()=>void readPage(),readingUnavailable:readingSupport?.state==='unavailable',readingNote:READING_UNSUPPORTED_MESSAGE,readAloudAvailable:true,openShare:()=>void sharePage(),shareEmail:()=>sharePageEmail(),
      tabCards:s.tabs.map((tab:Bag)=>{const page=known(tab.id),label=page?.title||(tab.priv?'New private tab':'New tab');return {id:tab.id,title:page?.title || page?.url || (tab.priv?'New private tab':'New tab'),host:(tab.priv?'Private · ':'')+(page?.url||''),css:tab.id===s.cur?'box-shadow:inset 0 0 0 2px var(--acc)':'',prev:tab.priv?'background:var(--fg);opacity:.85':'background:var(--s2)',aria:'Switch to '+(tab.priv?'private tab ':'')+label,closeAria:tab.priv?'Close private tab':'Close tab',pick:()=>api.set({cur:tab.id,tabsOpen:false}),close:()=>{ const rest=state().tabs.filter((t:Bag)=>t.id!==tab.id); const fallback=newTabId();if(tabs.has(tab.id))void Browser.close({session,id:tab.id}).catch(report);tabs.forget([tab.id]);restored.delete(tab.id);api.set({tabs:rest.length?rest:[{id:fallback,hist:['newtab'],pos:0}],cur:state().cur===tab.id?(rest[0]?.id||fallback):state().cur}); }};}),
      rootRef:(element:HTMLElement)=>{if(!element)return; if(window.scrollX||window.scrollY)window.scrollTo(0,0); const screen=element.closest('[data-screen]'); if(screen){screen.scrollTop=0;screen.scrollLeft=0;} const viewport=element.querySelector('[data-bscroll]'); if(viewport){viewport.setAttribute('data-native-browser-viewport','true'); viewport.setAttribute('aria-label',info?.error || (info?.externalOnly?'Open externally':info?.loading?'Loading website':'Browser page'));} },
    };
  };
  const oldRender = Component.prototype.renderVals;
  Component.prototype.renderVals = function(){shell=this;
    const browserActive = this.S().view === 'browser';
    if (!initialBookmarkRead || (browserActive && !browserWasActive)) { initialBookmarkRead = true; refreshBookmarks(!browserActive); }
    if (browserActive && !browserWasActive) void readingSupport?.check();
    if (!sessionRead && this.vget('browser')?.tabs) void restoreSession();
    browserWasActive = browserActive;
    this.browserCommand = async (raw:unknown,signal:AbortSignal,current:()=>void) => {
      // Refusals before Browser.command are typed: nothing was dispatched, so the agent
      // must not report that the command may have run.
      let command:ReturnType<typeof parseNativeHistoryCommand>;
      try{command=parseNativeHistoryCommand(raw);}catch(error){return {ok:false,code:'UNSUPPORTED',message:error instanceof Error?error.message:String(error)};}
      const id=state()?.cur,info=tabInfo(id);
      const admittedNavigation=info?.navigation;
      const bound=()=>{signal.throwIfAborted();current();if(disposed||!Capacitor.isNativePlatform()||document.hidden||shell.S().view!=='browser'||state()?.menu||state()?.tabsOpen||state()?.lib||state()?.share||state()?.editing||shell.S().shade||state()?.cur!==id||!tabs.has(id)||!info||(command.subaction==='reload'?!info.url:!info.committed||info.error||info.loading)||tabInfo(id)?.navigation!==admittedNavigation)throw Error('Current native browser tab changed');
        if(command.subaction==='back'&&!info.canBack)throw Error('There is no previous page in this tab.');
        if(command.subaction==='forward'&&!info.canForward)throw Error('There is no next page in this tab.');
      };
      try{bound();}catch(error){return {ok:false,code:'UNAVAILABLE',message:error instanceof Error?error.message:String(error)};}
      const receipt=await Browser.command({session,id,command:command.subaction,navigation:admittedNavigation});
      // A back/reload dispatch may change its own document. Keep exact tab/session
      // and lifetime fences; never call the command again to obtain an acknowledgment.
      signal.throwIfAborted();if(disposed||shell.S().view!=='browser'||state()?.cur!==id||receipt?.session!==session||receipt?.id!==id)throw Error('Native browser result belongs to another tab or session');
      return {ok:true,data:{dispatched:true,completed:false,requiresReadback:true}};
    };
    this.browserNavigateApproved = async (raw: string, signal: AbortSignal, deferPresentation = false) => {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS destinations may be approved');
      signal.throwIfAborted();
      const selected = state()?.cur;
      // A request made from a private page stays in that profile. Opening a
      // destination must not silently switch to saved sign-ins and history.
      const privateTab=!!(shell.S?.().view==='browser'&&isPrivate(selected));
      const id = await navigate(url.href, true, signal, privateTab, deferPresentation);
      const present = () => {
        signal.throwIfAborted();
        if (!id || disposed || document.hidden || state()?.cur !== (deferPresentation ? selected : id) || !tabs.has(id)) return;
        // Select only after completion; even Browser-origin requests keep their
        // original document context throughout journal and receipt handling.
        if (deferPresentation) shell.vset('browser', {cur: id, editing: false, tabsOpen: false, menu: false, lib: null, share: false});
        // Keep the exact dispatched tab; a normal openView resets its identity.
        shell.openView('browser', null, null, { restore: true });
      };
      // Device actions present only after their durable journal and receipt attempt.
      // Ordinary reviewed web sources keep their immediate presentation.
      if (deferPresentation) return present;
      present();
    };
    // Identity only: visible page content, URL and browsing history are not
    // transmitted merely by opening the agent. Navigation changes the revision
    // so a proposal for an earlier document cannot retain current authority.
    this.browserSelection = () => tabs.selection(state()?.cur);
    const S=this.S();const b=this.vget('browser');if(S.view!=='browser'||b.menu||b.editing||b.tabsOpen||b.lib||S.shade)hide();else {blockPageInput();schedulePresentation();}return oldRender.call(this);};
  let listener: any, resumeListener: any, openedListener: any, closedListener: any, noticeListener: any, findListener: any, fullscreenListener: any;
  void Browser.addListener('findResult',(event:BrowserFindResult)=>{
    const s=state(),found=s&&!disposed?tabs.findResult(event,s.findTab):undefined;if(!found)return;
    if(found.cleared){if(s.finding)shell.vset('browser',{...findIdle,findTab:null});return;}
    shell.vset('browser',{findCount:found.count,findIndex:found.index,findDone:found.done});
  }).then((value:any)=>{findListener=value;}).catch(()=>{});
  // A page's video fullscreen is a native view above everything; close renderer overlays.
  void Browser.addListener('fullscreen',(event:BrowserFullscreen)=>{if(!disposed&&tabs.owns(event)&&event.active)shell?.vset('browser',{menu:false,tabsOpen:false,share:false});}).then((value:any)=>{fullscreenListener=value;}).catch(()=>{});
  void DailyApps.addListener('appResumed', () => { if (shell?.S().view === 'browser') refreshBookmarks(); }).then(value => { resumeListener=value; }).catch(()=>{});
  void Browser.addListener('stateChanged',(event:BrowserTabState)=>{
    // Only this document's events, in each tab's native order, for tabs it created or was given.
    // The session model moves the document revision on a new address or load and never lets an
    // external-only fallback gain reading authority.
    const change=tabs.applyState(event);if(!change)return;
    // Android hides child surfaces while a system picker/activity is foreground.
    // Resume must resend geometry even when the host's visibility event did not fire.
    if(change.surfaceResumed)lastGeometry='';
    if(reading && event.id===state()?.cur && change.documentChanged) stopReading();
    // Private tabs never enter history or saved tabs. The web build's frame surface reports a
    // committed load, and a page that navigated inside its frame reports an error instead.
    if(change.committedPage && state() && !isPrivate(event.id))shell.vset('browser',{visits:[event.url,...state().visits.filter((u:string)=>u!==event.url)].slice(0,MAX_HISTORY)});refresh();
  }).then((value:any)=>{listener=value;}).catch(()=>{});
  // target=_blank links and pop-ups that the native browser opened as a tab.
  void Browser.addListener('tabOpened',(event:BrowserTabOpened)=>{
    const s=state();if(disposed||!s||s.tabs.some((tab:Bag)=>tab.id===event.id))return;
    const opened=tabs.applyOpened(event);if(!opened)return;
    if(s.tabs.length>=MAX_TABS){tabs.forget([opened.id]);void Browser.close({session,id:opened.id}).catch(()=>{});shell.toast('Tab limit');return;}
    // The opener is kept only in memory, so a pop-up that closes itself returns to the page that opened it.
    const opener=event.opener&&s.tabs.some((tab:Bag)=>tab.id===event.opener)?{opener:event.opener}:{};
    shell.vset('browser',{tabs:[...s.tabs,{id:opened.id,hist:['newtab'],pos:0,...(opened.private?{priv:true}:{}),...opener}],cur:event.id,editing:false,tabsOpen:false,menu:false,lib:null,share:false});refresh();
  }).then((value:any)=>{openedListener=value;}).catch(()=>{});
  void Browser.addListener('tabClosed',(event:BrowserTabEvent)=>{const id=disposed?undefined:tabs.applyClosed(event);if(id)forgetTabs([id]);}).then((value:any)=>{closedListener=value;}).catch(()=>{});
  void Browser.addListener('notice',(event:BrowserTabNotice)=>{const message=disposed?undefined:tabs.notice(event);if(message!==undefined)shell?.toast(message);}).then((value:any)=>{noticeListener=value;}).catch(()=>{});
  // Explicit modal panels retain whole-window ownership on native hosts.
  // host-modal:begin
  /** First-run access and connection modals withdraw the native page. The assistant is
   * not a modal: on Android it stays above the retained below-host page. */
  const hostModalOpen = (root: { querySelector(selector: string): unknown }, nativeSurface: boolean): boolean => nativeSurface && !!root.querySelector('dialog:modal, .alpha-connection-scrim');
  // host-modal:end
  const nativeUnderlay = () => Capacitor.getPlatform()==='android';
  /** Keep the native page drawn while the host owns interaction with the assistant. */
  const nativeUnderAssistant = () => Capacitor.isNativePlatform() && (['sheet','full'].includes(shell?.S().chat) || !!shell?.chatMotion?.moved);
  function browserBackdrop(rect?:Bag){
    const html=document.documentElement;
    if(!rect){if(html.getAttribute('data-alpha-browser-underlay')!==session)return;html.removeAttribute('data-alpha-browser-underlay');html.style.removeProperty('--alpha-browser-clear-top');html.style.removeProperty('--alpha-browser-clear-bottom');return;}
    const app=document.querySelector<HTMLElement>('[data-alpha-layer="app"]'),box=app?.getBoundingClientRect();
    const scale=box&&app?.offsetWidth?box.width/app.offsetWidth:1;
    html.style.setProperty('--alpha-browser-clear-top',`${Math.max(0,(rect.y-(box?.top||0))/scale)}px`);
    html.style.setProperty('--alpha-browser-clear-bottom',`${Math.max(0,(rect.y+rect.height-(box?.top||0))/scale)}px`);
    html.setAttribute('data-alpha-browser-underlay',session);
  }
  const browserChromeSelector='[data-alpha-layer="composer"],[data-alpha-layer="pill"] > *,[data-alpha-layer="conversation"],.alpha-plan-notice,[data-alpha-toast] > *,[data-screen] > button[aria-label="Home"],[role="search"][aria-label="Find in page"]';
  function browserHostRects(page:Bag){
    if(nativeUnderAssistant())return [{x:page.x,y:page.y,width:page.width,height:page.height,cornerRadius:0}];
    return [...document.querySelectorAll<HTMLElement>(browserChromeSelector)].flatMap(element=>{
      const style=getComputedStyle(element),rect=element.getBoundingClientRect();
      if(element.closest('[inert],[aria-hidden="true"]')||style.display==='none'||style.visibility==='hidden'||style.pointerEvents==='none'||Number(style.opacity)===0||rect.width<=0||rect.height<=0)return [];
      const scale=element.offsetWidth?rect.width/element.offsetWidth:1;
      return [{x:rect.x,y:rect.y,width:rect.width,height:rect.height,cornerRadius:(parseFloat(style.borderTopLeftRadius)||0)*scale}];
    });
  }
  function presentBrowser(payload:Bag){
    const next=JSON.stringify(payload);if(next===lastGeometry)return;
    lastGeometry=next;
    if(!payload.id){lastPresented=undefined;browserBackdrop();}
    return Browser.present(payload).then(()=>{
      if(disposed||lastGeometry!==next)return;
      presentationFailed=false;
      if(payload.id&&nativeUnderlay()){lastPresented=payload;browserBackdrop(payload);}
    }).catch((error:unknown)=>{
      if(disposed||lastGeometry!==next)return;
      lastGeometry='';lastPresented=undefined;browserBackdrop();
      if(!presentationFailed){presentationFailed=true;report(error);}
    });
  }
  // Retire page input before a host render can add controls. The next frame publishes
  // their measured bounds; the website itself is neither hidden nor reloaded.
  function blockPageInput(){
    if(!nativeUnderlay()||!lastPresented)return;
    const p=lastPresented;void presentBrowser({...p,hostRects:[{x:p.x,y:p.y,width:p.width,height:p.height,cornerRadius:0}]});
  }
  function schedulePresentation(){
    if(disposed||!nativeUnderlay()||shell?.S().view!=='browser'||presentationFrame!==undefined)return;
    presentationFrame=window.requestAnimationFrame(()=>{presentationFrame=undefined;void update();if(document.getAnimations?.().some(animation=>animation.playState==='running'&&((animation.effect as KeyframeEffect|null)?.target as Element|null)?.closest?.(browserChromeSelector)))schedulePresentation();});
  }
  const update = () => {
    if(disposed)return;
    saveSession();
    // A stopped Activity is already hidden by the native host. Withdrawing its tab here
    // would cancel the autofill session retained for a password provider's unlock screen.
    if(document.hidden){if(reading)stopReading();return;}
    const s=state(), S=shell?.S();
    // Off the Browser view with the page already withdrawn there is nothing to measure or send.
    if(surfacePollIdle(S?.view,lastGeometry,hiddenGeometry)){if(reading)stopReading();return;}
    const element=document.querySelector('[data-native-browser-viewport]') as HTMLElement|null;
    const hidden=questionReview || confirming || hostModalOpen(document, Capacitor.isNativePlatform()) || !s || !element || !element.isConnected || !element.getClientRects().length || S?.view!=='browser' || s.editing || s.tabsOpen || s.menu || s.lib || s.share || s.ag || s.confirm || S?.shade || S?.screen !== 'home' || (!nativeUnderlay()&&nativeUnderAssistant());
    if(reading && (disposed || document.documentElement.hasAttribute('data-dev-background') || S?.screen!=='home' || S?.view!=='browser' || s?.tabsOpen || s?.editing || S?.shade || ['sheet','full'].includes(S?.chat)))stopReading();
    const rect=element?.getBoundingClientRect();
    // Measure the full page beneath the overlays. Chat movement must not resize the website.
    const page=document.querySelector('[data-alpha-browser-page]')?.getBoundingClientRect();
    const height=rect ? Math.max(0,Math.min(rect.bottom,page?.bottom ?? rect.bottom)-rect.top) : 0;
    // A restored cold-start tab loads its last committed page when first shown.
    if(!hidden && s && restored.has(s.cur) && !tabs.has(s.cur) && !clearingData){const saved=restored.get(s.cur)!;void navigate(saved.url,false,undefined,false,true);}
    const payload=hidden || !tabs.has(s?.cur) ? {session,id:null} : {session,id:s.cur,x:rect!.x,y:rect!.y,width:rect!.width,height};
    const native=payload.id&&nativeUnderlay()?{...payload,layer:'below-host',hostRects:browserHostRects(payload)}:payload;
    return presentBrowser(native);
  };
  const openBrowserView = (event: Event) => {
    const view=(event as CustomEvent<string>).detail;
    // Browser-provider links keep a source the user already selected. Ordinary
    // Calendar entry still starts at Agent Calendar; this scope is test-only.
    shell?.openView(view,view==='calendar'&&browserCalendarScope(shell)?{calendarAuthority:'browser-local'}:undefined);
  };
  window.addEventListener('alpha:browser-open-view', openBrowserView);
  const bookmarksDocumentChanged = () => refreshBookmarks();
  window.addEventListener('alpha:bookmarks-document-changed',bookmarksDocumentChanged);
  const timer=window.setInterval(update,100);
  const visibility = () => { if (document.hidden) externalHandoff.retire(); lastGeometry=''; update(); if (!document.hidden && shell?.S().view === 'browser') refreshBookmarks(); };
  window.addEventListener('resize',update);document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pointermove',schedulePresentation,true);
  const chromeChanged=(node:Node)=>node instanceof Element&&!!(node.matches(browserChromeSelector)||node.closest(browserChromeSelector)||node.querySelector(browserChromeSelector));
  const chromeObserver=new MutationObserver(records=>{if(records.some(record=>chromeChanged(record.target)||[...record.addedNodes,...record.removedNodes].some(chromeChanged))){blockPageInput();schedulePresentation();}});
  chromeObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','inert','aria-hidden']});
  const chromeTransition=(event:Event)=>{if(chromeChanged(event.target as Node))schedulePresentation();};
  for(const event of ['transitionrun','transitionend','transitioncancel','animationstart','animationend'])document.addEventListener(event,chromeTransition,true);
  return ()=>{window.removeEventListener('alpha:bookmarks-document-changed',bookmarksDocumentChanged);window.removeEventListener('alpha:browser-open-view',openBrowserView);stopReading();unsubscribeReading();disposed=true;clearInterval(timer);if(presentationFrame!==undefined)window.cancelAnimationFrame(presentationFrame);browserBackdrop();window.removeEventListener('pointermove',schedulePresentation,true);chromeObserver.disconnect();for(const event of ['transitionrun','transitionend','transitioncancel','animationstart','animationend'])document.removeEventListener(event,chromeTransition,true);window.removeEventListener('resize',update);document.removeEventListener('visibilitychange',visibility);void resumeListener?.remove();void listener?.remove();void openedListener?.remove();void closedListener?.remove();void noticeListener?.remove();void findListener?.remove();void fullscreenListener?.remove();window.clearTimeout(findTimer);for(const id of tabs.dispose())void Browser.close({session,id}).catch(()=>{});};
}
