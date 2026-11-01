import {parseNativeHistoryCommand} from "../../../../.eliza/client-features/plugins/plugin-browser/src/native-client-command.ts";
import {parseBrowserAddressInput} from "../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/address-input.ts";
import {browsingSnapshot, restoreBrowsing, DEFAULT_BROWSING_LIMITS} from "../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/browsing-session.ts";
import {BrowserTabSession, newBrowserTabId as newTabId, type BrowserFindResult, type BrowserFullscreen, type BrowserTabEvent, type BrowserTabNotice, type BrowserTabOpened, type BrowserTabState} from "../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/tab-host.ts";
import { registerPlugin } from '../platform-plugins';
import { Capacitor } from '@capacitor/core';
import { DailyApps } from '../daily';
import { createNativeReadingVoice } from '../runtime/native-reading-voice';
import {reviewContentQuestion} from '../browser/content-question';
import {readPublicPageSource as browserReadingSource} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-source.ts';
import {createReadingSupport, pageQuestionExcerpt, READING_UNSUPPORTED_MESSAGE, sensitiveReadingText} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import {webSourceOf} from './summary-source';
import {browserCalendarScope} from './agent-calendar-adapter';
import { connectionController, agentPendingText } from '../runtime/connection-ui';
import { BrowserReviews } from '../browser/review';
import { browserErrorMessage } from '../browser/browser-errors';
const {tabs: MAX_TABS, history: MAX_HISTORY} = DEFAULT_BROWSING_LIMITS;
type Bag = Record<string, any>;
// The shared native tab host (BrowserTabHostPlugin) under Alpha's Capacitor name; the web build
// registers its isolated-frame surface under the same name (browser/register.ts).
const Browser = registerPlugin<any>('AlphaBrowser');
const PROFILE_UNSUPPORTED_NATIVE_MESSAGE='This Android WebView does not support isolated browser profiles';
const PROFILE_UNSUPPORTED_MESSAGE='In-app browsing is unavailable with this Android WebView because isolated browser profiles are not supported. Use another installed browser to browse websites.';

/** Public browsing only. Install last, only outside visual fixture mode.
 * Product decision: normal tabs keep sign-ins (one persistent browser profile),
 * and their tabs and history are restored after a cold start. Private tabs use
 * an ephemeral profile and never enter saved tabs or history.
 * The native tabs, their event order and the document revisions that bind page
 * actions are the shared BrowserTabSession; this adapter binds it to Alpha's view. */
export function installPrototypeBrowserAdapter(Component: any, views: Record<string, Bag>) {
  const tabs = new BrowserTabSession({maxTabs: MAX_TABS});
  const session = tabs.session;
  const tabInfo = (id: string | undefined | null): Bag | undefined => tabs.info(id);
  // Cold-start tabs that have not been loaded yet: id -> last committed page.
  const restored = new Map<string, {url: string; title: string}>();
  const restoreAttempts = new Map<string, number>();
  const reviews = new BrowserReviews();
  let profileUnsupportedTab:string|undefined;
  let shell: any, lastGeometry = '', disposed = false, sharing = false, confirming = false, clearingData = false;
  // Saving waits for a successful read so a damaged saved record is never overwritten implicitly.
  let sessionRead = false, sessionHydrated = false, lastSaved = '', saveQueue = Promise.resolve();
  const tabOf = (id: string) => state()?.tabs?.find((tab: Bag) => tab.id === id);
  const isPrivate = (id: string) => !!tabOf(id)?.priv;
  let bookmarkRead: Promise<void> | undefined, bookmarkQueue = Promise.resolve();
  let bookmarkHydrated = false, bookmarkRefreshQueued = false, initialBookmarkRead = false, browserWasActive = false;
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
  function refreshBookmarks() {
    if (disposed || bookmarkRefreshQueued) return;
    bookmarkRefreshQueued = true;
    bookmarkQueue = bookmarkQueue.then(() => disposed ? undefined : loadBookmarks()).catch(report).finally(() => { bookmarkRefreshQueued = false; });
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
  const refresh = () => shell?.vset('browser', { nativeRevision: Date.now() });
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
    if(reading){stopReading();shell?.toast('Reading stopped');return;}
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
      if(!await voice.ready(controller.signal))throw new Error('The selected agent is not ready for speech.');valid();
      const result=await Browser.reviewReading({session,id,url:info.url,navigation:info.navigation,...binding});valid();
      shell.toast('Preparing reviewed page speech');
      await voice.speak(result.readingToken,controller.signal);valid();shell.toast('Reading finished');
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
      shell.vset('browser',{menu:false});shell.toast('Preparing page excerpt…');
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
      reviewContentQuestion({name:source.name,text,signal:controller.signal,current,validate:text=>!sensitiveReadingText(text),source:async()=>{if(!current())throw Error('Page changed');return source;},compose:(draft,source)=>shell.api('browser').composeContentQuestion(draft,source),closed:()=>{questionReview=false;lastGeometry='';if(reading===controller)reading=undefined;}});
    }catch(error){if(!controller.signal.aborted)report(error);}finally{if(!questionReview&&reading===controller)reading=undefined;}
  }
  function hide() {
    const next = JSON.stringify({session,id:null});
    if (lastGeometry === next) return;
    lastGeometry = next;
    void Browser.present({session,id:null}).catch(() => { if(lastGeometry === next) lastGeometry=''; });
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
  async function openExternalBrowser() {
    if (sharing || confirming || disposed || !shell) return;
    const id = state()?.cur, page = tabs.pageBinding(id, {https: true});
    if (!page) { report(new Error('Load an HTTPS page before opening another browser.')); return; }
    sharing = true;
    try {
      const priv = isPrivate(id);
      shell.vset('browser', {menu:false});
      if (priv) {
        confirming = true; lastGeometry = ''; await update();
        const approved = await reviews.confirm('external-browser', 'Leave private browsing?', `Only this address will be sent to another browser:\n${page.url}\n\nThe other browser may save it in its history and use its own signed-in accounts. Alpha cookies and private tab data are not transferred.`, 'Choose browser');
        confirming = false;
        if (!approved) return;
      }
      if (disposed || document.hidden || shell.S().view!=='browser' || !tabs.current(page, state()?.cur)) throw new Error('The page changed. Review it again before leaving Alpha.');
      lastGeometry=''; await update();
      await Browser.openExternalBrowser({...tabs.guard(page),privateConfirmed:priv});
    } catch (error) { report(error); }
    finally { sharing=false; confirming=false; lastGeometry=''; await update(); }
  }
  /** Remove renderer tabs whose native WebView is already gone. */
  function forgetTabs(ids: string[]) {
    tabs.forget(ids); for (const id of ids) restored.delete(id);
    const s = state(); if (!s) return;
    const rest = s.tabs.filter((tab: Bag) => !ids.includes(tab.id));
    const next = rest.length ? rest : [{ id: newTabId(), hist: ['newtab'], pos: 0 }];
    shell.vset('browser', { tabs: next, cur: next.some((tab: Bag) => tab.id === s.cur) ? s.cur : next[0].id });
  }
  function savedSnapshot() {
    const s = state(); if (!s) return null;
    return browsingSnapshot(s, id => { const info = tabInfo(id), saved = restored.get(id); return { url: (!Capacitor.isNativePlatform()&&info?.externalOnly?info.url:info?.savedUrl) || saved?.url, title: info?.title || saved?.title }; });
  }
  function saveSession() {
    if (!sessionHydrated || clearingData || disposed) return;
    const snapshot = savedSnapshot(); if (!snapshot) return;
    const next = JSON.stringify(snapshot); if (next === lastSaved) return;
    lastSaved = next;
    saveQueue = saveQueue.then(() => disposed || clearingData ? undefined : Browser.saveBrowsingState({ session, ...snapshot })).catch(() => { if (lastSaved === next) lastSaved = ''; });
  }
  async function restoreSession() {
    if (sessionRead) return; sessionRead = true;
    try {
      const saved = await Browser.browsingState({ session });
      if (disposed) return;
      const s = state(); if (!s) return;
      // Never replace a tab the user is already typing into.
      const next = restoreBrowsing(saved, s, tabs.ids().length === 0 && s.tabs.length === 1 && !tabs.info(s.tabs[0].id) && !s.editing);
      // Restored tabs load (an ordinary GET of the last committed address)
      // only when the tab is shown; nothing is resubmitted.
      for (const tab of next.restored) restored.set(tab.id, { url: tab.url, title: tab.title });
      if (next.restored.length) shell.vset('browser', { tabs: next.restored.map(tab => ({ id: tab.id, hist: ['newtab'], pos: 0 })), cur: next.cur, visits: next.visits });
      else if (next.visits.length !== s.visits.length) shell.vset('browser', { visits: next.visits });
      sessionHydrated = true;
      lastSaved = JSON.stringify(savedSnapshot());
    } catch {
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
    const ok = await confirmBrowser('browser-clear-data', 'Clear browsing data?', Capacitor.isNativePlatform() ? 'Deletes cookies and site data, so you will be signed out of websites. Also deletes browsing history and cached files, and closes open tabs. Bookmarks and private tabs are kept.' : 'Clears Alpha browsing history and closes normal tabs. Bookmarks and private tabs are kept. Website cookies and sign-ins are managed in your browser settings.');
    if (!ok || disposed) return;
    clearingData = true;
    try {
      const result = await Browser.clearBrowsingData({ session });
      if (disposed) return;
      const normal = state().tabs.filter((tab: Bag) => !tab.priv).map((tab: Bag) => tab.id);
      forgetTabs([...new Set([...normal, ...(Array.isArray(result?.closed) ? result.closed : [])])]);
      shell.vset('browser', { visits: [] });
      sessionHydrated = true; lastSaved = JSON.stringify(savedSnapshot());
      shell.toast(Capacitor.isNativePlatform() ? 'Browsing data cleared' : 'Alpha tabs and history cleared');
    } catch (error) { report(error); } finally { clearingData = false; }
  }
  async function clearSiteData() {
    if (!Capacitor.isNativePlatform()) return;
    const id = state()?.cur, info = tabInfo(id);
    let host = '';
    try { host = new URL(info?.url).hostname; } catch {}
    if (!host || !info?.committed || info.error) { report(new Error('Load a website before clearing its data.')); return; }
    const ok = await confirmBrowser('browser-clear-site', `Clear data for ${host}?`, `Deletes cookies and site data for ${host}${isPrivate(id) ? ' in this private tab' : ''}, so you will be signed out of this site. History and bookmarks are kept.`);
    if (!ok || disposed) return;
    try {
      const result = await Browser.clearSiteData({ session, id, url: info.url });
      if (!disposed) shell.toast(`Cleared data for ${result?.site || host}. Reload the page to continue.`);
    } catch (error) { report(error); }
  }
  const definition = views.browser;
  definition.state = { ...definition.state, tabs: [{ id: 'b0', hist: ['newtab'], pos: 0 }], cur: 'b0', marks: [], visits: [], booked: null, ag: null, confirm: null, finding: false, findTab: null, findQuery: '', findCount: 0, findIndex: 0, findDone: true };
  // These are in-memory view-reset keys, not disk persistence. Keep the native
  // tab identities while visiting other apps; a cold start begins with b0 until
  // restoreSession replaces it with saved normal tabs.
  definition.persist = ['tabs', 'cur', 'marks', 'visits'];
  definition.onLeave = () => {stopReading();hide();};
  definition.reply = () => null;
  definition.back = (s: Bag, api: Bag) => {
    if (s.finding) { closeFind(); return true; }
    for (const key of ['editing', 'tabsOpen', 'menu', 'lib', 'share']) if(s[key]) { api.set({ [key]: key === 'lib' ? null : false }); return true; }
    if (tabInfo(s.cur)?.canBack) { void command('back'); return true; }
    return false;
  };
  const render = definition.render;
  definition.render = (s: Bag, api: Bag) => {
    if(profileUnsupportedTab&&profileUnsupportedTab!==s.cur)profileUnsupportedTab=undefined;
    const out = render(s, api), info = tabInfo(s.cur), url = info?.url ? new URL(info.url) : null;
    const unavailable = () => api.toast('This browser currently supports public navigation only.');
    const openNew = (priv = false) => { if (s.tabs.length >= MAX_TABS) { api.toast('Close a tab before opening another.'); return; } const id=newTabId(); api.set({ tabs:[...s.tabs,{id,hist:['newtab'],pos:0,...(priv?{priv:true}:{})}],cur:id,tabsOpen:false,menu:false,editing:true,addr:'' }); };
    const priv = !!s.tabs.find((tab: Bag) => tab.id === s.cur)?.priv;
    const known = (id: string) => tabInfo(id) || restored.get(id);
    return { ...out, profileUnsupportedPage:profileUnsupportedTab===s.cur&&!s.editing,profileUnsupportedEditing:profileUnsupportedTab===s.cur&&!!s.editing,profileUnsupportedMessage:PROFILE_UNSUPPORTED_MESSAGE,isNews:false,isEnc:false,isBook:false,isSearch:false,isGeneric:false,isNew:!info,
      privateNotice:Capacitor.isNativePlatform()?'Private tab. Its cookies, sign-ins, site data and pages are deleted when you close it, and it is not saved in history.':'This tab is not saved in Alpha history. Website cookies and sign-ins are managed by your browser.',isPrivate:priv,openPrivate:()=>openNew(true),clearData:()=>void clearBrowsingData(),clearSite:()=>void clearSiteData(),canClearSite:Capacitor.isNativePlatform()&&!!info?.committed&&!info?.error&&!!url,
      recents:[],sugg:[],people:[],agOn:false,confirm:false,
      // Find in page is native findAllAsync. A web build's page is an opaque-origin sandboxed frame the host
      // cannot search, so the menu offers no Find there (the template keys on openFind).
      openFind:Capacitor.isNativePlatform()?()=>openFind():undefined,canFind:Capacitor.isNativePlatform()&&!!info?.committed&&!info?.error,finding:!!s.finding&&s.findTab===s.cur,
      find:{query:s.findQuery||'',count:s.findCount||0,index:s.findIndex||0,
        label:!s.findQuery?'':s.findCount?`${s.findIndex||1} of ${s.findCount}`:(s.findDone===false?'Searching…':'No matches'),
        onInput:(e:Event)=>findQuery((e.target as HTMLInputElement).value),
        onKey:(e:KeyboardEvent)=>{if(e.key==='Enter'){e.preventDefault();findStep(!e.shiftKey);}else if(e.key==='Escape'){e.preventDefault();closeFind();}},
        next:()=>findStep(true),prev:()=>findStep(false),close:()=>closeFind(),nextOp:s.findCount?1:0.3,prevOp:s.findCount?1:0.3},
      host:url?.host || 'Search or address',hostCss:url?'':'color:var(--mut)',path:url ? url.pathname + url.search : '', hasLock:Capacitor.isNativePlatform() && !!url && url.protocol==='https:' && !!info?.committed && !info?.loading && !info?.error,
      pageShareAvailable:Capacitor.isNativePlatform(),pageContentAvailable:Capacitor.isNativePlatform()||!!info?.committed&&!info.loading&&!info.error&&!info.externalOnly,nativeControls:true,externalBrowserAvailable:Capacitor.isNativePlatform(),openExternalBrowser:()=>void openExternalBrowser(),openPasswordProvider:()=>{api.set({menu:false});api.open('settings',{page:'password-provider'});},openDownloads:()=>{api.set({menu:false});void Browser.downloads({session}).catch(report);},reload:()=>{api.set({menu:false});void command('reload');},stopLoading:()=>{api.set({menu:false});void command('stop');},loading:!!info?.loading,goBack:()=>void command('back'),goFwd:()=>void command('forward'),backOp:info?.canBack?1:0.3,fwdOp:info?.canForward?1:0.3,
      startEdit:()=>api.set({editing:true,addr:info?.url||'',menu:false}),onAddrKey:(e:KeyboardEvent)=>{ if(e.key==='Enter'){e.preventDefault();void navigate((e.target as HTMLInputElement).value);} else if(e.key==='Escape')api.set({editing:false}); },
      toggleMark:()=>{if((!info?.committed&&!(info?.externalOnly&&!Capacitor.isNativePlatform())) || info.loading || info.error || url?.protocol!=='https:'){api.toast('Load an HTTPS page before bookmarking it.');return;}saveBookmark(info.url);},markLabel:s.marks.includes(info?.url)?'Bookmarked':'Bookmark',markFill:s.marks.includes(info?.url)?'currentColor':'none',libRows:[...(bookmarkRecovery&&s.lib!=='history'?[{title:'Recover saved bookmarks',host:'Saved bookmarks could not be opened. Their original data is retained.',ini:'!',go:openBookmarkRecovery,canRemove:false,removeAria:'',remove:()=>{}}]:[]),...(s.lib==='history'?s.visits:s.marks).map((u:string)=>({title:u,host:u,ini:new URL(u).hostname[0],go:()=>void navigate(u),canRemove:s.lib!=='history',removeAria:'Remove bookmark',remove:()=>saveBookmark(u,false)}))],libEmpty:!(bookmarkRecovery&&s.lib!=='history')&&!(s.lib==='history'?s.visits:s.marks).length,newTab:()=>openNew(false),askPage:()=>void askPage(),readAloud:()=>void readPage(),readingUnavailable:readingSupport?.state==='unavailable',readingNote:READING_UNSUPPORTED_MESSAGE,bookNow:unavailable,cfOk:unavailable,openShare:()=>void sharePage(),shareEmail:()=>sharePageEmail(),
      tabCards:s.tabs.map((tab:Bag)=>{const page=known(tab.id),label=page?.title||(tab.priv?'New private tab':'New tab');return {title:page?.title || page?.url || (tab.priv?'New private tab':'New tab'),host:(tab.priv?'Private · ':'')+(page?.url||''),css:tab.id===s.cur?'box-shadow:inset 0 0 0 2px var(--acc)':'',prev:tab.priv?'background:var(--fg);opacity:.85':'background:var(--s2)',aria:'Switch to '+(tab.priv?'private tab ':'')+label,closeAria:tab.priv?'Close private tab':'Close tab',pick:()=>api.set({cur:tab.id,tabsOpen:false}),close:()=>{ const rest=state().tabs.filter((t:Bag)=>t.id!==tab.id); const fallback=newTabId();if(tabs.has(tab.id))void Browser.close({session,id:tab.id}).catch(report);tabs.forget([tab.id]);restored.delete(tab.id);api.set({tabs:rest.length?rest:[{id:fallback,hist:['newtab'],pos:0}],cur:state().cur===tab.id?(rest[0]?.id||fallback):state().cur}); }};}),
      rootRef:(element:HTMLElement)=>{out.rootRef?.(element); if(!element)return; const viewport=element.querySelector('[data-bscroll]'); if(viewport){viewport.setAttribute('data-native-browser-viewport','true'); viewport.setAttribute('aria-label',info?.error || (info?.externalOnly?'Open page in browser':info?.loading?'Loading website':'Browser page'));} },
    };
  };
  const oldRender = Component.prototype.renderVals;
  Component.prototype.renderVals = function(){shell=this;
    const browserActive = this.S().view === 'browser';
    if (!initialBookmarkRead || (browserActive && !browserWasActive)) { initialBookmarkRead = true; refreshBookmarks(); }
    if (browserActive && !browserWasActive) void readingSupport?.check();
    if (!sessionRead && this.vget('browser')?.tabs) void restoreSession();
    browserWasActive = browserActive;
    this.browserCommand = async (raw:unknown,signal:AbortSignal,current:()=>void) => {
      const command=parseNativeHistoryCommand(raw),id=state()?.cur,info=tabInfo(id);
      const admittedNavigation=info?.navigation;
      const bound=()=>{signal.throwIfAborted();current();if(disposed||!Capacitor.isNativePlatform()||document.hidden||shell.S().view!=='browser'||state()?.menu||state()?.tabsOpen||state()?.lib||state()?.share||state()?.editing||shell.S().shade||state()?.cur!==id||!tabs.has(id)||!info?.committed||info.error||info.loading||tabInfo(id)?.navigation!==admittedNavigation)throw Error('Current native browser tab changed');};
      bound();
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
      const id = await navigate(url.href, true, signal, false, deferPresentation);
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
    const S=this.S();const b=this.vget('browser');if(S.view!=='browser'||b.menu||b.editing||b.tabsOpen||b.lib||S.shade||nativeUnderAssistant())hide();return oldRender.call(this);};
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
    shell.vset('browser',{tabs:[...s.tabs,{id:opened.id,hist:['newtab'],pos:0,...(opened.private?{priv:true}:{})}],cur:event.id,editing:false,tabsOpen:false,menu:false,lib:null,share:false});refresh();
  }).then((value:any)=>{openedListener=value;}).catch(()=>{});
  void Browser.addListener('tabClosed',(event:BrowserTabEvent)=>{const id=disposed?undefined:tabs.applyClosed(event);if(id)forgetTabs([id]);}).then((value:any)=>{closedListener=value;}).catch(()=>{});
  void Browser.addListener('notice',(event:BrowserTabNotice)=>{const message=disposed?undefined:tabs.notice(event);if(message!==undefined)shell?.toast(message);}).then((value:any)=>{noticeListener=value;}).catch(()=>{});
  // A native surface sits above the host WebView. Hide it for every host overlay.
  // host-modal:begin
  /** A modal host layer (a dialog opened with showModal, such as the first-run access panel, or the
   * connection panel) makes the rest of the host inert, but Android draws the native page above the
   * whole host WebView: left visible, the page covered the panel and stayed interactive. In a browser
   * build the page is an element inside the host document, below any modal, and stays shown. */
  const hostModalOpen = (root: { querySelector(selector: string): unknown }, nativeSurface: boolean): boolean => nativeSurface && !!root.querySelector('dialog:modal, .alpha-connection-scrim');
  // host-modal:end
  /** Android draws its native page above the whole host WebView, so the chat sheet can be seen only while
   * that page is withdrawn: when the sheet rests open and as soon as it is pulled. The web build's page is
   * an element of the phone canvas below the assistant layers and stays where it is under the sheet. */
  const nativeUnderAssistant = () => Capacitor.isNativePlatform() && (['sheet','full'].includes(shell?.S().chat) || !!shell?.chatMotion?.moved);
  const update = () => {
    if(disposed)return;
    const s=state(), S=shell?.S();
    const element=document.querySelector('[data-native-browser-viewport]') as HTMLElement|null;
    const hidden=questionReview || confirming || hostModalOpen(document, Capacitor.isNativePlatform()) || !s || !element || !element.isConnected || !element.getClientRects().length || S?.view!=='browser' || s.editing || s.tabsOpen || s.menu || s.lib || s.share || s.ag || s.confirm || S?.shade || S?.screen !== 'home' || nativeUnderAssistant() || document.hidden;
    if(reading && (disposed || document.hidden || document.documentElement.hasAttribute('data-dev-background') || S?.screen!=='home' || S?.view!=='browser' || s?.tabsOpen || s?.editing || S?.shade || ['sheet','full'].includes(S?.chat)))stopReading();
    const rect=element?.getBoundingClientRect();
    // The page ends above the resting dock's reserve (template.html), never above the dock's current
    // painted position: a composer pulled up with the sheet, or the sheet itself, does not resize it.
    const page=document.querySelector('[data-alpha-browser-page]')?.getBoundingClientRect();
    const height=rect ? Math.max(0,Math.min(rect.bottom,page?.bottom ?? rect.bottom)-rect.top) : 0;
    // A restored cold-start tab loads its last committed page when first shown.
    if(!hidden && s && restored.has(s.cur) && !tabs.has(s.cur) && !clearingData){const saved=restored.get(s.cur)!;void navigate(saved.url,false,undefined,false,true);}
    saveSession();
    const payload=hidden || !tabs.has(s?.cur) ? {session,id:null} : {session,id:s.cur,x:rect!.x,y:rect!.y,width:rect!.width,height};
    const next=JSON.stringify(payload);
    if(next!==lastGeometry){lastGeometry=next;return Browser.present(payload).catch(()=>{lastGeometry='';});}
  };
  const openBrowserView = (event: Event) => {
    const view=(event as CustomEvent<string>).detail;
    // Browser-provider links keep a source the user already selected. Ordinary
    // Calendar entry still starts at Agent Calendar; this scope is test-only.
    shell?.openView(view,view==='calendar'&&browserCalendarScope(shell)?{calendarAuthority:'browser-local'}:undefined);
  };
  window.addEventListener('alpha:browser-open-view', openBrowserView);
  window.addEventListener('alpha:bookmarks-document-changed',refreshBookmarks);
  const timer=window.setInterval(update,100);
  const visibility = () => { lastGeometry=''; update(); if (!document.hidden && shell?.S().view === 'browser') refreshBookmarks(); };
  window.addEventListener('resize',update);document.addEventListener('visibilitychange',visibility);
  return ()=>{window.removeEventListener('alpha:bookmarks-document-changed',refreshBookmarks);window.removeEventListener('alpha:browser-open-view',openBrowserView);stopReading();unsubscribeReading();disposed=true;clearInterval(timer);window.removeEventListener('resize',update);document.removeEventListener('visibilitychange',visibility);void resumeListener?.remove();void listener?.remove();void openedListener?.remove();void closedListener?.remove();void noticeListener?.remove();void findListener?.remove();void fullscreenListener?.remove();window.clearTimeout(findTimer);for(const id of tabs.dispose())void Browser.close({session,id}).catch(()=>{});};
}
