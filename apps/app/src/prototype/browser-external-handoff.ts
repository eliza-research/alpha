import type {BrowserTabSession} from "../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/tab-host.ts";
import type {BrowserReviews} from '../browser/review';

/** The Browser adapter's presentation flags the handoff reads and sets. */
export interface ExternalHandoffFlags { sharing: boolean; confirming: boolean; lastGeometry: string; readonly disposed: boolean; }

export interface ExternalHandoffDeps {
  tabs: BrowserTabSession;
  reviews: Pick<BrowserReviews, 'confirm'>;
  shell: () => any;
  Browser: {openExternalBrowser(input: Record<string, unknown>): Promise<unknown>};
  state: () => Record<string, any> | undefined;
  isPrivate: (id: string) => boolean;
  update: () => unknown;
  report: (error: unknown) => void;
  flags: ExternalHandoffFlags;
}

/** "Open in another browser" for the current tab. A private page leaves Alpha only after the user
 * confirms it, and only if the same page is still showing. */
export function createExternalBrowserHandoff({tabs, reviews, shell, Browser, state, isPrivate, update, report, flags}: ExternalHandoffDeps) {
  let visit = 0;
  async function open() {
    const owner = shell(), openedIn = visit;
    if (flags.sharing || flags.confirming || flags.disposed || !owner) return;
    const id = state()?.cur, page = tabs.pageBinding(id, {https: true});
    if (!page) { report(new Error('Load an HTTPS page before opening another browser.')); return; }
    const checkCurrentPage = () => {
      const visible = owner.S();
      if (openedIn !== visit || shell() !== owner || flags.disposed || document.hidden ||
          visible.screen !== 'home' || visible.view !== 'browser' || !tabs.current(page, state()?.cur)) {
        throw new Error('The page changed. Review it again before leaving Alpha.');
      }
    };
    flags.sharing = true;
    try {
      const priv = isPrivate(id);
      owner.vset('browser', {menu:false});
      if (priv) {
        flags.confirming = true; flags.lastGeometry = ''; await update();
        checkCurrentPage();
        const approved = await reviews.confirm('external-browser', 'Leave private browsing?', `Open ${new URL(page.url).hostname} externally?\n${page.url}`, 'Choose browser');
        flags.confirming = false;
        if (!approved) return;
      }
      checkCurrentPage();
      flags.lastGeometry = '';
      await update();
      checkCurrentPage();
      await Browser.openExternalBrowser({...tabs.guard(page),privateConfirmed:priv});
    } catch (error) { report(error); }
    finally { flags.sharing=false; flags.confirming=false; flags.lastGeometry=''; await update(); }
  }
  return {open, retire() {visit++;}};
}
