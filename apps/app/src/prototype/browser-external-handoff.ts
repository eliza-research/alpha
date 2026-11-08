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
  return async function openExternalBrowser() {
    if (flags.sharing || flags.confirming || flags.disposed || !shell()) return;
    const id = state()?.cur, page = tabs.pageBinding(id, {https: true});
    if (!page) { report(new Error('Load an HTTPS page before opening another browser.')); return; }
    flags.sharing = true;
    try {
      const priv = isPrivate(id);
      shell().vset('browser', {menu:false});
      if (priv) {
        flags.confirming = true; flags.lastGeometry = ''; await update();
        const approved = await reviews.confirm('external-browser', 'Leave private browsing?', `Open in another browser?\n${page.url}\n\nIt may save this address and use its own sign-ins. Your Alpha sign-ins and private tabs aren't shared.`, 'Choose browser');
        flags.confirming = false;
        if (!approved) return;
      }
      if (flags.disposed || document.hidden || shell().S().view!=='browser' || !tabs.current(page, state()?.cur)) throw new Error('The page changed. Review it again before leaving Alpha.');
      flags.lastGeometry=''; await update();
      await Browser.openExternalBrowser({...tabs.guard(page),privateConfirmed:priv});
    } catch (error) { report(error); }
    finally { flags.sharing=false; flags.confirming=false; flags.lastGeometry=''; await update(); }
  };
}
