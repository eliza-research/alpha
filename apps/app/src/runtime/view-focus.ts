/**
 * Focus follows the screen (PRD AP-15: TalkBack, keyboard and repeated HOME).
 *
 * The behaviour is Eliza's `createScreenFocus` (`@elizaos/ui/accessibility`): focus that a screen
 * change, an inline modal surface (the Apps drawer) or a rotation dropped to the page body moves
 * to what is now in front, made programmatically focusable only (tabindex -1) and focused without
 * scrolling, so TalkBack announces where the person is and Tab continues from there. Focus a view or
 * the person put somewhere real is never moved.
 *
 * This file only tells it about Alpha's renderer:
 *
 * - the screen's name: the visible title of the app in front (`[data-alpha-app-title]`; the app's
 *   labelled region where it has no title row, as in Maps and the browser page), or the Home
 *   region when Home is in front;
 * - surfaces that manage their own focus: the conversation, the voice panel (and open native
 *   dialogs, which the shared module always includes);
 * - screen changes: `data-active-view` on the root element, and HOME pressed on Home
 *   (`launcher-home`), which changes no view but can still drop focus;
 * - startup: the first view of a page load is not a screen change, and nothing is judged before it
 *   (startup dialogs own focus then).
 */
import { createScreenFocus, isExposed } from '@elizaos/ui/accessibility/screen-focus';

const TITLE = '[data-alpha-app-title]';
const HOME = '[data-alpha-layer="home"]';
const APP = '[data-alpha-layer="app"][role="region"]';
/** Surfaces that manage their own focus: a screen change behind them does not take it. */
const SELF_FOCUSED = '[aria-label="Voice conversation"],[data-alpha-layer="conversation"][aria-hidden="false"],[data-alpha-voice-panel]';

/**
 * The element that names the screen in front: the app's visible title, else the app's own labelled
 * region, or the Home region when Home is in front.
 */
export function screenFocusTarget(doc: Document = document): HTMLElement | null {
  const view = doc.documentElement.dataset.activeView || 'home';
  if (view === 'home') {
    const home = doc.querySelector(HOME);
    return isExposed(home) ? home : null;
  }
  for (const title of doc.querySelectorAll(TITLE)) if (isExposed(title) && (title.textContent || '').trim()) return title;
  const region = doc.querySelector(APP);
  return isExposed(region) && region.getAttribute('aria-label') ? region : null;
}

let installed: (() => void) | null = null;
/** Installed once per document; a second call returns the same uninstaller. */
export function installViewFocus(doc: Document = document): () => void {
  if (installed) return installed;
  const view = doc.defaultView!;
  const focus = createScreenFocus({
    document: doc,
    screen: screenFocusTarget,
    selfFocused: SELF_FOCUSED,
    ready: () => doc.documentElement.dataset.activeView !== undefined,
    focusRing: 'var(--acc,#0000ff)',
  });
  let current = doc.documentElement.dataset.activeView;
  const changes = new MutationObserver(() => {
    const next = doc.documentElement.dataset.activeView;
    if (next === current) return;
    const previous = current; current = next;
    // The first view of a load is not a screen change: startup surfaces own focus then.
    if (previous !== undefined && next !== undefined) focus.screenChanged();
  });
  changes.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-active-view'] });
  const home = () => focus.screenChanged();
  view.addEventListener('launcher-home', home);
  installed = () => {
    installed = null;
    changes.disconnect();
    view.removeEventListener('launcher-home', home);
    focus.dispose();
  };
  return installed;
}
