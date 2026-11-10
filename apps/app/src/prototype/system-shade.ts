import { registerPlugin } from '../platform-plugins';
import {
  defaultShadeFallbackCopy,
  emptyHomePullEligible,
  installOverflowPull,
  readPullStart,
  requestNotificationShade,
  shadeFallback as sharedShadeFallback,
  type PullContext,
  type PullStart,
} from '@elizaos/capacitor-system/shade';

/*
 * Android's shade is the one notification and quick-settings surface (issues #416 and #417). Alpha posts its notices as ordinary Android notifications with
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

// The shade and empty-Home pull policy is shared (@elizaos/capacitor-system/shade, tested
// there); Alpha supplies its wording and the selector of its Home layer.
export { emptyHomeShadePull, overflowPullDecision, PULL_SLOP, shadeSurface, STATUS_BAND } from '@elizaos/capacitor-system/shade';
export type { PullContext, PullStart, ShadeSurface } from '@elizaos/capacitor-system/shade';

/** Alpha's words for each outcome; they never claim the shade opened. */
export const ALPHA_SHADE_COPY = defaultShadeFallbackCopy('Alpha');
const HOME = { home: '[data-alpha-layer="home"]', screen: '[data-screen]' };

/** The fallback a person sees when Android did not open its shade. It never claims the shade opened. */
export function shadeFallback(outcome: unknown): string { return sharedShadeFallback(outcome, ALPHA_SHADE_COPY); }

/** Reads what a pull started on. Pure DOM reads; safe to call from pointerdown. */
export function pullStart(target: EventTarget | null): PullStart | null { return readPullStart(target, HOME); }

/**
 * A Home whose content fits gives vertical drags to the page, so a downward pull reaches Alpha as
 * pointer events instead of being taken by the WebView for scrolling or overscroll. A Home that
 * overflows (a short screen, large text) scrolls normally; at its top a downward pull on empty
 * Home is taken over by the shared installOverflowPull instead.
 */
export function markHomeFits(): void {
  const home = document.querySelector<HTMLElement>(HOME.home);
  if (!home) return;
  const fits = home.scrollHeight <= home.clientHeight + 1 ? 'true' : 'false';
  if (home.dataset.alphaHomeFits !== fits) home.dataset.alphaHomeFits = fits;
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
    // The overflow pull's non-passive touch listeners run on every touch, so they exist only while
    // Home is showing; an app or the lock screen scrolls without them.
    const context = self.pullContext() as PullContext, showing = context.screen === 'home' && !context.view;
    if (showing && !self.alphaOverflowPull) {
      // Same rule as the pull itself (emptyHomeShadePull), checked before the drag is known.
      self.alphaOverflowPull = installOverflowPull(() => emptyHomePullEligible(self.pullContext() as PullContext), HOME);
    } else if (!showing && self.alphaOverflowPull) {
      self.alphaOverflowPull();
      self.alphaOverflowPull = undefined;
    }
  };
  p.componentDidMount = function () {
    mount?.call(this);
    this.alphaHomeFits = () => scheduleFit(this);
    document.fonts?.addEventListener('loadingdone', this.alphaHomeFits);
    window.addEventListener('resize', this.alphaHomeFits);
    watch(this);
  };
  p.componentDidUpdate = function (...args: unknown[]) { update?.apply(this, args); watch(this); scheduleFit(this); };
  p.componentWillUnmount = function () { window.removeEventListener('resize', this.alphaHomeFits); document.fonts?.removeEventListener('loadingdone', this.alphaHomeFits); if (this.alphaHomeFitFrame != null) cancelAnimationFrame(this.alphaHomeFitFrame); this.alphaHomeObserver?.disconnect(); this.alphaOverflowPull?.(); this.alphaOverflowPull = undefined; unmount?.call(this); };
  if (!options.native) return;
  p.expandAndroidShade = async function () {
    if (this.alphaShadeAsking) return;
    this.alphaShadeAsking = true;
    let message: string;
    try { message = await requestNotificationShade(device, ALPHA_SHADE_COPY); }
    finally { this.alphaShadeAsking = false; }
    if (message) this.toast(message);
  };
}
