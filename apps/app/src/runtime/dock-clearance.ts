import { installDockClearance as installSharedDockClearance, visibleDocks as sharedVisibleDocks } from '../../../../.eliza/client-features/packages/ui/src/components/shell/dock-clearance.ts';
/**
 * How much of the bottom of the phone the composer or pill takes, including an expanded chat's
 * text/voice composer, measured in the phone canvas's own pixels.
 *
 * The dock floats over the page. Home used to scroll underneath it with a fixed 108px of padding,
 * which stopped being enough as soon as Home needed to scroll: at 200% text the last row of apps
 * was drawn under the composer, and TalkBack read the composer after controls that sat lower on
 * the screen (round 8 emulator run). A fixed number cannot be right either way: Android moves the
 * dock up by the navigation bar inset, and the composer grows with a longer draft or a status
 * line. So the footprint is measured and published as `--alpha-dock-clearance` on the root
 * element; phone.css gives Home, the app library and every app scroller that
 * much scroll padding so a focused control is brought wholly above the dock.
 * Home and the app library fill the phone behind the floating dock; clearance
 * belongs inside their scroll content rather than clipping the outer viewport.
 *
 * Two lengths are published. `--alpha-dock-clearance` is everything the dock
 * covers now. `--alpha-dock-rest` is the bar alone. Measurements use layout
 * coordinates: entrance animations and chat dragging must not resize Home.
 *
 * Top notices also use this footprint so a long notice cannot cover a multiline draft.
 * While no dock is on screen (the shade or lock screen) the last footprint is
 * kept, so Home does not jump when the dock returns.
 */
export const DOCK_CLEARANCE_PROPERTY = '--alpha-dock-clearance';
export const DOCK_REST_PROPERTY = '--alpha-dock-rest';
const HEADER_CLEARANCE_PROPERTY = '--alpha-header-clearance';
// App headers, the Apps drawer's title row with its Close button, and an open
// in-phone modal sheet (a month picker, a menu): a notice goes below it, or, when the sheet
// leaves no room, just above the dock as before, never over the sheet's header.
const APP_HEADERS = '[data-alpha-app-header],[data-alpha-layer="drawer"] div:has(> h1),[role="dialog"][aria-modal="true"]:not([data-alpha-layer="drawer"])';
const DOCK = '[data-alpha-layer="composer"],[data-alpha-layer="pill"] > *,.alpha-chat-composer';

/** The dock elements on screen now: rendered, and not retired behind the shade or a voice session. */
export function visibleDocks(root: ParentNode = document): HTMLElement[] {
  return sharedVisibleDocks(root, DOCK);
}

let installed: (() => void) | null = null;
/**
 * Installed once per document; a second call returns the same uninstaller. The measuring and
 * publishing are shared with Eliza (packages/ui/src/components/shell/dock-clearance.ts); Alpha
 * supplies its screen, dock and bar selectors and its installed property names.
 */
export function installDockClearance(): () => void {
  if (installed) return installed;
  const uninstall = installSharedDockClearance({ screen: '[data-screen]', docks: DOCK, bar: '[data-alpha-input-bar]', clearanceProperty: DOCK_CLEARANCE_PROPERTY, restProperty: DOCK_REST_PROPERTY });
  const uninstallHeader = installHeaderClearance();
  installed = () => { installed = null; uninstallHeader(); uninstall(); };
  return installed;
}

/** Product headers stay tappable when transient notices appear at the top. */
function installHeaderClearance(): () => void {
  let frame = 0, published = '', watched: HTMLElement[] = [];
  const sizes = new ResizeObserver(() => schedule());
  const measure = () => {
    frame = 0;
    const screen = document.querySelector<HTMLElement>('[data-screen]');
    if (!screen || !screen.offsetWidth) return;
    const box = screen.getBoundingClientRect(), scale = box.width / screen.offsetWidth || 1;
    const conversation = screen.querySelector<HTMLElement>('[data-alpha-layer="conversation"]:not([inert])');
    const fullChat = conversation && screen.dataset.alphaChatHalf !== 'true';
    const headers = Array.from((fullChat ? conversation : screen).querySelectorAll<HTMLElement>(fullChat ? '[data-alpha-chat-header]' : APP_HEADERS))
      .filter(header => header.getClientRects().length > 0 && !header.closest('[inert]'));
    const measured = [screen, ...headers];
    if (measured.length !== watched.length || measured.some((header, index) => header !== watched[index])) {
      sizes.disconnect(); for (const header of measured) sizes.observe(header); watched = measured;
    }
    const next = `${Math.max(0, ...headers.map(header => Math.ceil((header.getBoundingClientRect().bottom - box.top) / scale)))}px`;
    if (next !== published) {
      published = next;
      document.documentElement.style.setProperty(HEADER_CLEARANCE_PROPERTY, next);
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
  const changes = new MutationObserver(schedule);
  changes.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] });
  const root = new MutationObserver(schedule);
  root.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  window.addEventListener('resize', schedule);
  document.addEventListener('animationend', schedule, true);
  document.addEventListener('transitionend', schedule, true);
  measure();
  return () => {
    changes.disconnect(); root.disconnect(); sizes.disconnect();
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('animationend', schedule, true);
    document.removeEventListener('transitionend', schedule, true);
    document.documentElement.style.removeProperty(HEADER_CLEARANCE_PROPERTY);
  };
}
