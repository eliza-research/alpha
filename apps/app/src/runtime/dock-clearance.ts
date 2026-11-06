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
 * covers now. `--alpha-dock-rest` is the bar alone. Home uses their difference
 * to extend its scroll content when a status appears, preserving app positions.
 *
 * Top notices also use this footprint so a long notice cannot cover a multiline draft.
 * While no dock is on screen (the shade or lock screen) the last footprint is
 * kept, so Home does not jump when the dock returns.
 */
export const DOCK_CLEARANCE_PROPERTY = '--alpha-dock-clearance';
export const DOCK_REST_PROPERTY = '--alpha-dock-rest';
const HEADER_CLEARANCE_PROPERTY = '--alpha-header-clearance';
const DOCK = '[data-alpha-layer="composer"],[data-alpha-layer="pill"] > *,.alpha-chat-composer';

/** The dock elements on screen now: rendered, and not retired behind the shade or a voice session. */
export function visibleDocks(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(DOCK)).filter(dock => dock.getClientRects().length > 0 && !dock.closest('[inert]'));
}

let installed: (() => void) | null = null;
/** Installed once per document; a second call returns the same uninstaller. */
export function installDockClearance(): () => void {
  if (installed) return installed;
  let published = '', publishedHeader = '', frame = 0, watched: HTMLElement[] = [];
  const sizes = new ResizeObserver(() => readNow());
  const read = () => {
    frame = 0;
    const screen = document.querySelector<HTMLElement>('[data-screen]');
    if (!screen || !screen.offsetWidth) return;
    const frameBox = screen.getBoundingClientRect(), scale = frameBox.width / screen.offsetWidth || 1;
    const conversation = screen.querySelector<HTMLElement>('[data-alpha-layer="conversation"]:not([inert])');
    const headerRoot = conversation && screen.dataset.alphaChatHalf !== 'true' ? conversation : screen;
    const headers = Array.from(headerRoot.querySelectorAll<HTMLElement>(conversation && headerRoot === conversation ? '[data-alpha-chat-header]' : '[data-alpha-app-header]'))
      .filter(header => header.getClientRects().length > 0 && !header.closest('[inert]'));
    const headerClearance = `${Math.max(0, ...headers.map(header => Math.ceil((header.getBoundingClientRect().bottom - frameBox.top) / scale)))}px`;
    if (headerClearance !== publishedHeader) {
      publishedHeader = headerClearance;
      document.documentElement.style.setProperty(HEADER_CLEARANCE_PROPERTY, headerClearance);
    }
    const docks = visibleDocks(screen);
    const measured = [...docks, ...headers];
    if (measured.length !== watched.length || measured.some((element, index) => element !== watched[index])) {
      sizes.disconnect(); sizes.observe(screen); for (const element of measured) sizes.observe(element);
      watched = measured;
    }
    if (!docks.length) return;
    // The canvas is drawn scaled to the screen (--phone-scale); lengths in CSS are canvas pixels.
    const above = (element: Element) => (frameBox.bottom - element.getBoundingClientRect().top) / scale;
    const clearance = Math.ceil(Math.max(...docks.map(above)));
    // The bar is the composer's last row; the pill is its own bar.
    const rest = Math.ceil(Math.max(...docks.map(dock => above(dock.querySelector('[data-alpha-input-bar]') ?? dock))));
    if (!Number.isFinite(clearance) || clearance <= 0 || !Number.isFinite(rest) || rest <= 0) return;
    const next = `${clearance}/${rest}`;
    if (next === published) return;
    published = next;
    document.documentElement.style.setProperty(DOCK_CLEARANCE_PROPERTY, `${clearance}px`);
    document.documentElement.style.setProperty(DOCK_REST_PROPERTY, `${Math.min(rest, clearance)}px`);
  };
  // A new status row changes the dock before the next animation frame. Publish
  // its measured footprint in the same observer delivery, before it can cover
  // controls whose scroll range still uses the previous height.
  const readNow = () => { if (frame) cancelAnimationFrame(frame); read(); };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(read); };
  // The dock is rendered by the phone shell: it appears, changes kind and leaves with the view.
  const changes = new MutationObserver(records => {
    if (records.some(record => record.target instanceof Element && record.target.closest(DOCK))) readNow();
    else schedule();
  });
  changes.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] });
  // Android's bar insets and the phone's scale arrive as custom properties and classes on the root
  // element (main.tsx); they move the dock without resizing it.
  const root = new MutationObserver(schedule);
  root.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  window.addEventListener('resize', schedule);
  // The dock slides in: its resting place is known only once its entry animation has finished.
  document.addEventListener('animationend', schedule, true);
  document.addEventListener('transitionend', schedule, true);
  read();
  installed = () => {
    installed = null;
    changes.disconnect(); root.disconnect(); sizes.disconnect(); window.removeEventListener('resize', schedule);
    document.removeEventListener('animationend', schedule, true); document.removeEventListener('transitionend', schedule, true);
    if (frame) cancelAnimationFrame(frame);
    document.documentElement.style.removeProperty(DOCK_CLEARANCE_PROPERTY);
    document.documentElement.style.removeProperty(DOCK_REST_PROPERTY);
    document.documentElement.style.removeProperty(HEADER_CLEARANCE_PROPERTY);
  };
  return installed;
}
