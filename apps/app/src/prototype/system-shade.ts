import { registerPlugin } from '../platform-plugins';

/*
 * Android's shade is the one notification and quick-settings surface (issues #416 and #417,
 * docs/gesture-zones.md). Alpha posts its notices as ordinary Android notifications with
 * owner-bound taps and draws no shade of its own in a product build:
 *
 * - launcher Home (Android): a downward pull that starts on empty Home asks Android to expand
 *   its shade (AlphaDevice.openNotificationShade, which needs
 *   EXPAND_STATUS_BAR on the launcher flavor). Any other outcome shows a truthful fallback;
 *   Android's own top-edge swipe always remains.
 * - standalone app: an ordinary app. No pull; Android's top-edge swipe only.
 * - browser development build (ELIZA_DEV_ALLOW_TEST_MOCKS=1): a simulated Android shade stands
 *   in for SystemUI, because a browser has none. It is a developer surface and is never shown
 *   by a production bundle or on Android.
 */

// system-shade:begin (dependency-free; exercised by test/system-shade.test.mjs)
/** Who answers "open notifications": Android itself, the development stand-in, or nobody. */
export type ShadeSurface = 'android' | 'simulated' | 'none';
/** Outcome names AlphaDevice.openNotificationShade resolves with (SystemShade.java). */
export type ShadeOutcome = 'opened' | 'standalone' | 'permission-missing' | 'unsupported' | 'not-in-front';

export function shadeSurface(options: { native: boolean; simulated: boolean }): ShadeSurface {
  if (options.native) return 'android';
  return options.simulated ? 'simulated' : 'none';
}

/** The fallback a person sees when Android did not open its shade. It never claims the shade opened. */
export function shadeFallback(outcome: unknown): string {
  if (outcome === 'opened') return '';
  if (outcome === 'not-in-front') return 'Alpha is not in front. Swipe down from the top edge of the screen for Android notifications.';
  if (outcome === 'standalone') return 'Swipe down from the top edge of the screen for Android notifications.';
  return 'Android did not open its notifications from Alpha. Swipe down from the top edge of the screen instead.';
}

/** What was under the finger when a pull started on Home. Collected from the page by pullStart(). */
export type PullStart = {
  /** Inside the Home layer (not the composer, the conversation, an app view or a sheet). */
  home: boolean;
  /** On a text field or another editable element. */
  editable: boolean;
  /** A text field has focus, so the on-screen keyboard may be open and owns the gesture. */
  keyboard: boolean;
  /** Some element under the finger, Home included, is scrolled away from its top: a downward
   * pull scrolls that content back instead. */
  scrolled: boolean;
};

/** Shell state that decides whether Home is empty Home. */
export type PullContext = {
  launcher: boolean; assistant: boolean; screen: string; view: unknown; chat: string;
  voice: string; drawer: boolean; secure: boolean; shade: boolean;
};

/** Height of Android's status bar band in canvas pixels. A pull from there is Android's own. */
export const STATUS_BAND = 44;

/**
 * Whether a finished pull on Home asks for Android's shade. Only on launcher Home with nothing
 * over it, only a clearly downward pull, never one that started in the status bar band (Android
 * already answered it), on editable content, while the keyboard may be up, or on content that
 * can still scroll toward its top.
 */
export function emptyHomeShadePull(context: PullContext, start: PullStart | null | undefined, startY: number, dx: number, dy: number, threshold = 46): boolean {
  if (!context.launcher || context.assistant || context.secure || context.shade) return false;
  if (context.screen !== 'home' || context.view || context.drawer || context.voice !== 'off') return false;
  if (context.chat === 'sheet' || context.chat === 'full') return false;
  if (!(dy > threshold) || !(dy > Math.abs(dx) * 1.5)) return false;
  if (!(startY >= STATUS_BAND)) return false;
  if (!start || !start.home || start.editable || start.keyboard || start.scrolled) return false;
  return true;
}

/** Touch slop in canvas pixels before a pull on an overflowing Home is decided. */
export const PULL_SLOP = 6;

/**
 * A Home taller than the screen (launcher landscape, large text or display size) leaves vertical
 * touch to the WebView, which would scroll or overscroll and cancel the pointer stream before the
 * pull reaches Alpha. At its top such a Home cannot scroll further down, so Alpha may take a
 * clearly downward drag there for the shade pull without taking any scroll from the person:
 * 'claim' (prevent the WebView's handling), 'release' (leave the gesture to the WebView for good),
 * or 'wait' (still inside the slop).
 */
export function overflowPullDecision(eligible: boolean, dx: number, dy: number, slop = PULL_SLOP): 'claim' | 'release' | 'wait' {
  if (!eligible) return 'release';
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return 'wait';
  return dy > 0 && dy > Math.abs(dx) ? 'claim' : 'release';
}
// system-shade:end

const EDITABLE = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="textbox"],[role="slider"]';

/** Reads what a pull started on. Pure DOM reads; safe to call from pointerdown. */
export function pullStart(target: EventTarget | null): PullStart | null {
  const element = target instanceof Element ? target : null;
  if (!element) return null;
  const home = element.closest('[data-alpha-layer="home"]');
  const active = document.activeElement;
  let scrolled = false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.scrollTop > 0) {
      const overflow = getComputedStyle(node).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) { scrolled = true; break; }
    }
    if (node === home) break;
  }
  return {
    home: !!home,
    editable: !!element.closest(EDITABLE),
    keyboard: !!(active && active !== document.body && active.matches?.(EDITABLE)),
    scrolled,
  };
}

/**
 * A Home whose content fits gives vertical drags to the page, so a downward pull reaches Alpha as
 * pointer events instead of being taken by the WebView for scrolling or overscroll. A Home that
 * overflows (launcher landscape, large text) scrolls normally; at its top a downward pull on empty
 * Home is taken over by installOverflowPull instead.
 */
export function markHomeFits(): void {
  const home = document.querySelector<HTMLElement>('[data-alpha-layer="home"]');
  if (!home) return;
  const fits = home.scrollHeight <= home.clientHeight + 1 ? 'true' : 'false';
  if (home.dataset.alphaHomeFits !== fits) home.dataset.alphaHomeFits = fits;
}

/**
 * Takes a downward pull at the top of an overflowing launcher Home away from the WebView, so it
 * reaches gDown/gUp as an ordinary pointer gesture (overflowPullDecision). Every other touch,
 * upward scrolling included, is left alone. `eligible` is the shell's pull context check.
 */
function installOverflowPull(eligible: () => boolean): () => void {
  let start: { x: number; y: number; scale: number } | null = null, claimed = false;
  const touchstart = (event: TouchEvent) => {
    start = null; claimed = false;
    if (event.touches.length !== 1) return;
    const target = event.target instanceof Element ? event.target : null;
    const home = target?.closest<HTMLElement>('[data-alpha-layer="home"]');
    if (!home || home.dataset.alphaHomeFits !== 'false' || home.scrollTop > 0 || !eligible()) return;
    const screen = home.closest('[data-screen]')?.getBoundingClientRect();
    const scale = screen && screen.width ? screen.width / 412 : 1, touch = event.touches[0];
    if (screen && (touch.clientY - screen.top) / scale < STATUS_BAND) return;
    const begin = pullStart(target);
    if (!begin || !begin.home || begin.editable || begin.keyboard || begin.scrolled) return;
    start = { x: touch.clientX, y: touch.clientY, scale };
  };
  const touchmove = (event: TouchEvent) => {
    if (!start) return;
    if (claimed) { if (event.cancelable) event.preventDefault(); return; }
    const touch = event.touches[0];
    if (!touch || event.touches.length !== 1) { start = null; return; }
    const decision = overflowPullDecision(true, (touch.clientX - start.x) / start.scale, (touch.clientY - start.y) / start.scale);
    if (decision === 'wait') return;
    if (decision === 'release' || !event.cancelable) { start = null; return; }
    claimed = true; event.preventDefault();
  };
  const end = () => { start = null; claimed = false; };
  const options: AddEventListenerOptions = { capture: true, passive: false };
  document.addEventListener('touchstart', touchstart, options);
  document.addEventListener('touchmove', touchmove, options);
  document.addEventListener('touchend', end, true);
  document.addEventListener('touchcancel', end, true);
  return () => {
    document.removeEventListener('touchstart', touchstart, options);
    document.removeEventListener('touchmove', touchmove, options);
    document.removeEventListener('touchend', end, true);
    document.removeEventListener('touchcancel', end, true);
  };
}

const device = registerPlugin<{ openNotificationShade(): Promise<{ status?: string }> }>('AlphaDevice');

/** Android side of the system shade: ask Android, and say so truthfully when it does not open. */
export function installSystemShade(Component: any, options: { native: boolean }): void {
  const p = Component.prototype, mount = p.componentDidMount, update = p.componentDidUpdate, unmount = p.componentWillUnmount;
  // Home's height changes without a render too (text size, fonts loading, the dock): watch both
  // Home and its content, and follow Home when the shell replaces the element.
  const scheduleFit = (self: any) => {
    if (self.alphaHomeFitFrame != null) return;
    self.alphaHomeFitFrame = requestAnimationFrame(() => { self.alphaHomeFitFrame = undefined; markHomeFits(); });
  };
  const watch = (self: any) => {
    const home = document.querySelector('[data-alpha-layer="home"]'), layout = home?.querySelector('[data-alpha-home-layout]'), clearance = home?.querySelector('[data-alpha-home-clearance]');
    if (home !== self.alphaHomeWatched || layout !== self.alphaHomeLayoutWatched || clearance !== self.alphaHomeClearanceWatched) {
      self.alphaHomeObserver?.disconnect();
      self.alphaHomeWatched = home; self.alphaHomeLayoutWatched = layout; self.alphaHomeClearanceWatched = clearance;
      // An observer reports each element once when observed, and again whenever its size changes,
      // so renders do not force a layout read here.
      if (home && typeof ResizeObserver !== 'undefined') {
        self.alphaHomeObserver = new ResizeObserver(() => markHomeFits());
        self.alphaHomeObserver.observe(home);
        // Dock padding can change the outer height while the content box stays unchanged.
        if (layout) self.alphaHomeObserver.observe(layout, { box: 'border-box' });
        // The half sheet changes scroll range without resizing Home or its stable icon layout.
        if (clearance) self.alphaHomeObserver.observe(clearance);
      } else markHomeFits();
    }
  };
  p.componentDidMount = function () {
    mount?.call(this);
    this.alphaHomeFits = () => scheduleFit(this);
    document.fonts?.addEventListener('loadingdone', this.alphaHomeFits);
    window.addEventListener('resize', this.alphaHomeFits);
    watch(this);
    // Same rule as the pull itself (emptyHomeShadePull), checked before the drag is known.
    const self = this;
    this.alphaOverflowPull = installOverflowPull(() => emptyHomeShadePull(self.pullContext(), { home: true, editable: false, keyboard: false, scrolled: false }, STATUS_BAND, 0, Infinity));
  };
  p.componentDidUpdate = function (...args: unknown[]) { update?.apply(this, args); watch(this); scheduleFit(this); };
  p.componentWillUnmount = function () { window.removeEventListener('resize', this.alphaHomeFits); document.fonts?.removeEventListener('loadingdone', this.alphaHomeFits); if (this.alphaHomeFitFrame != null) cancelAnimationFrame(this.alphaHomeFitFrame); this.alphaHomeObserver?.disconnect(); this.alphaOverflowPull?.(); unmount?.call(this); };
  if (!options.native) return;
  p.expandAndroidShade = async function () {
    if (this.alphaShadeAsking) return;
    this.alphaShadeAsking = true;
    let outcome: unknown = 'unsupported';
    try { outcome = (await device.openNotificationShade())?.status; }
    catch { outcome = 'unsupported'; }
    finally { this.alphaShadeAsking = false; }
    const message = shadeFallback(outcome);
    if (message) this.toast(message);
  };
}
