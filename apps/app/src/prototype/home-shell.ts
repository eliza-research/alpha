import {createElement, type CSSProperties} from 'react';
import type {FavoritesStore, InstalledApp, LauncherBridge} from '@elizaos/capacitor-system/launcher';
import {appKey} from '@elizaos/capacitor-system/launcher';
import {createMobileShellLauncher, mobileShellIconUrl, MobileHomeScreen, type MobileHomeEntry, type MobileHomeTile} from '@elizaos/ui/mobile-shell';
import {ALPHA_PRODUCT, alphaViews} from '../product/alpha-product';
import {AppsDrawer, HOLD_MS, SLOP, appsDrawerEntries} from './apps-drawer';
import {createInlineModal} from '../runtime/inline-modal';
type Bag = Record<string, any>;

/** Opens Android's App info for exactly one listed entry (and profile). */
export type AppInfoOpener = (target: {packageName: string; activityName?: string; user?: string}) => Promise<void>;

const glyph = (url: string, size: number): CSSProperties => {
  const mask = `url("${url}") center / contain no-repeat`;
  return {display: 'block', width: size, height: size, backgroundColor: 'currentColor', mask, WebkitMask: mask};
};
const HOME_EDIT_CSS = `
[data-alpha-home-key]{position:relative}
[data-alpha-home-editing="true"] [data-mobile-shell-tile]{touch-action:none}
[data-alpha-home-editing="true"] [data-mobile-shell-tile-face]{animation:alpha-wiggle .3s ease-in-out infinite alternate}
[data-alpha-home-dragging] [data-mobile-shell-tile-face]{animation:none;box-shadow:0 8px 24px rgba(0,0,0,.18)}
[data-alpha-home-remove]{position:absolute;top:-6px;left:-6px;width:24px;height:24px;border-radius:12px;background:var(--fg,var(--text));color:var(--bg);display:flex;align-items:center;justify-content:center;z-index:2}
[data-alpha-home-remove]::after{content:"";position:absolute;inset:-10px}
@keyframes alpha-wiggle{from{transform:rotate(-1.5deg)}to{transform:rotate(1.5deg)}}
@media (prefers-reduced-motion: reduce){[data-alpha-home-editing="true"] [data-mobile-shell-tile-face]{animation:none}}
`;

/** Home and its app grid from the shared mobile shell, and Alpha's Apps drawer, themed by the Alpha
 * record (view refresh PLAN section 5). The template fills Home's notice and card slots; open state
 * and Back go through the shared navigation reducer (Component.shellNavigate), so Back and Home close
 * the drawer. The installed favorites are the record's (alpha.launcher.favorites.v1, product views as
 * `alpha:<canonical id>`); the shell migrates their older view ids once before the launcher first
 * reads them. Apps lists installed Android apps only; Alpha's views live on Home, where edit mode
 * (long-press an icon) removes and rearranges icons and "+" restores hidden views. */
export function installHomeShell(Component: any, views: Record<string, Bag>, bridge: LauncherBridge, options: {
  icons?: boolean;
  /** Installed apps exist on Android, or through the explicitly enabled browser fixture. */
  appInventory?: 'android' | 'simulated';
  /** Replaces the installed favorites record (tests only). */
  favorites?: FavoritesStore;
  /** Exact browser device mirrors only; never inferred from labels. */
  aliases?: Record<string, string>;
  /** False when the bridge cannot report package changes; the drawer still re-reads on open and resume. */
  follow?: boolean;
  /** Storage holding the installed favorites; localStorage by default. */
  storage?: () => Storage;
  /** Android's App info for a drawer entry; absent where the platform has none. */
  appInfo?: AppInfoOpener;
} = {}) {
  const p = Component.prototype, mount = p.componentDidMount, unmount = p.componentWillUnmount, render = p.renderVals;
  const back = p.back, goHome = p.goHome, openView = p.openView;
  let owner: any = null;
  const shell = createMobileShellLauncher({
    bridge, registry: alphaViews, icons: options.icons, aliases: options.aliases,
    favorites: options.favorites, storage: options.storage,
    open: view => owner?.openView(alphaViews.hostKey(view)),
    changed: () => owner?.setState({launcherRevision: Date.now()}),
  });
  const inventory = options.appInventory;
  const {launcher} = shell, prefix = ALPHA_PRODUCT.storage.launcherBuiltinPrefix;
  const icon = (id: string) => mobileShellIconUrl(ALPHA_PRODUCT, id);
  const grid = icon(ALPHA_PRODUCT.icons.allApps);
  const glyphs = {app: grid, phone: icon('phone'), search: icon('search'), close: icon('x'), plus: icon('plus'), info: icon('info')};
  const rerender = () => owner?.setState({launcherRevision: Date.now()});
  // The Add to Home sheet owns focus while open; Escape and Back close it.
  const addSheet = createInlineModal(() => owner?.setState({homeAdd: false}));
  const installedApp = (key: string) => launcher.snapshot().apps.find(app => appKey(app) === key);

  // Home long press and edit-mode drag. The tap that ends a long press or a drag is swallowed.
  let press: {key: string; x: number; y: number; timer: ReturnType<typeof setTimeout>} | null = null;
  let drag: {key: string; x: number; y: number; scale: number; tile: HTMLElement; moved: boolean} | null = null;
  let swallow = '';
  const endPress = () => { if (press) clearTimeout(press.timer); press = null; };
  const endDrag = () => { if (drag) { drag.tile.style.transform = ''; drag.tile.style.zIndex = ''; drag.tile.removeAttribute('data-alpha-home-dragging'); } drag = null; };
  const tileOf = (target: EventTarget | null) => (target as Element | null)?.closest?.('[data-mobile-shell-tile]') as HTMLElement | null;
  const keyOf = (tile: Element | null) => tile?.querySelector('[data-alpha-home-key]')?.getAttribute('data-alpha-home-key') || '';
  const focusTile = (key: string) => requestAnimationFrame(() => (document.querySelector(`[data-alpha-home-key="${CSS.escape(key)}"]`)?.closest('[data-mobile-shell-tile]') as HTMLElement | null)?.focus());
  const closeEdit = (self: any) => {
    endPress(); endDrag();
    const S = self.S();
    if (S.homeEdit || S.homeAdd || S.drawerMenu) self.setState({homeEdit: false, homeAdd: false, drawerMenu: null});
  };
  /** Puts a Home icon where another one is; the others keep their order. */
  const place = (key: string, target: string) => {
    const keys = shell.homeEntries().map(entry => entry.key), from = keys.indexOf(key), to = keys.indexOf(target), app = installedApp(key);
    if (from < 0 || to < 0 || from === to || !app) return;
    launcher.clearError();
    for (let step = 0; step < Math.abs(to - from); step++) launcher.moveFavorite(app, to > from ? 1 : -1);
  };
  // Each edit starts without the last one's error; a failed save shows in the edit bar.
  const remove = (key: string) => { const app = installedApp(key); if (app && launcher.isFavorite(app)) { launcher.clearError(); launcher.toggleFavorite(app); } };

  let stop: (() => void) | undefined;
  p.componentDidMount = function (...args: any[]) {
    owner = this;
    if (inventory) stop = shell.observe({follow: options.follow});
    const result = mount?.apply(this, args);
    if (inventory) shell.prepareHome();
    return result;
  };
  p.componentWillUnmount = function (...args: any[]) {
    stop?.(); launcher.cancelPending(); stop = undefined; endPress(); endDrag(); if (owner === this) owner = null;
    return unmount?.apply(this, args);
  };
  /** The drawer entry whose menu is open, while that entry is still listed (an app removed behind
   * its open menu leaves no menu to close). */
  const openMenu = (S: Bag) => S.drawerMenu && appsDrawerEntries(launcher.snapshot(), prefix, String(S.drawerQ || '')).some(entry => entry.key === S.drawerMenu) ? S.drawerMenu as string : null;
  // Back closes the innermost launcher layer first: an entry's menu, the Add sheet, then edit mode.
  // Voice, an open conversation and the assistant surface lie above edit mode, so the base Back
  // handles them first.
  p.back = function (...args: any[]) {
    const S = this.S();
    if (!S.view && !S.shade) {
      if (S.drawerMenu) { this.setState({drawerMenu: null}); if (openMenu(S)) return; }
      const above = (S.voice && S.voice !== 'off') || S.chat === 'full' || S.chat === 'sheet' || !!this.props?.assistantSurface;
      if (!above && S.homeAdd) return this.setState({homeAdd: false});
      if (!above && S.homeEdit && !S.drawer) { endDrag(); return this.setState({homeEdit: false}); }
    }
    return back?.apply(this, args);
  };
  p.goHome = function (...args: any[]) { const result = goHome?.apply(this, args); closeEdit(this); return result; };
  // Opening a view (a tap, the agent or a notification) ends Home edit mode.
  p.openView = function (...args: any[]) { closeEdit(this); return openView?.apply(this, args); };
  p.openAllApps = function () {
    if (!inventory || this.props?.assistantSurface || this.S().homeEdit) return;
    this.setState({...this.shellNavigate({type: 'drawer', open: true}), drawerMenu: null}); void launcher.load();
  };
  p.renderVals = function () {
    const out = render.call(this), S = this.S(), self = this;
    shell.syncViews();
    const snapshot = launcher.snapshot();
    const showDrawer = !!inventory && !out.assistantSurface;
    const drawerOpen = showDrawer && !!S.drawer && !!out.isOn && !out.isView;
    const editing = !!S.homeEdit && !!out.isOn && !out.isView && !drawerOpen && !out.assistantSurface;
    const face = (key: string, tile: {image?: string; glyphUrl?: string; badge?: boolean}) => createElement('span', {'data-mobile-shell-tile-face': '', 'data-alpha-home-key': key},
      tile.image ? createElement('img', {alt: '', src: tile.image}) : tile.glyphUrl ? createElement('span', {'aria-hidden': 'true', style: glyph(tile.glyphUrl, 30)}) : null,
      tile.badge && !editing ? createElement('span', {'data-mobile-shell-tile-badge': ''}) : null,
      editing ? createElement('span', {'data-alpha-home-remove': '', 'aria-hidden': 'true'}, createElement('span', {style: glyph(icon('minus'), 14)})) : null);
    const tile = (entry: MobileHomeEntry): MobileHomeTile => {
      let base: Omit<MobileHomeTile, 'face'>;
      if (entry.kind === 'app') base = {key: entry.key, label: entry.app.label, image: entry.app.icon, glyphUrl: entry.app.icon ? undefined : grid, iconId: entry.app.icon ? undefined : ALPHA_PRODUCT.icons.allApps, onOpen: () => void launcher.launch(entry.app)};
      else {
        const key = alphaViews.hostKey(entry.view), definition = views[key] || {};
        const badge = typeof definition.badge === 'function' && ['phone', 'messages', 'inbox'].includes(key) ? !!definition.badge(self.vget(key)) : false;
        base = {key: entry.key, label: entry.view.label, glyphUrl: alphaViews.iconUrl(entry.view), iconId: ALPHA_PRODUCT.icons.views[entry.view.id], badge, onOpen: () => self.openView(key)};
      }
      // In edit mode an activation is a removal (the "−" for a pointer; any keyboard or assistive
      // activation); the tap itself is resolved by the grid's click capture below.
      return {...base, face: face(entry.key, base), ...(editing ? {ariaLabel: `Remove ${base.label} from Home`, onOpen: () => {}} : {})};
    };
    const appsTile = {key: 'alpha:apps-drawer', label: 'Apps', glyphUrl: grid, iconId: ALPHA_PRODUCT.icons.allApps, onOpen: () => self.openAllApps(), dialog: true};
    const tiles = out.assistantSurface ? [] : [...shell.homeEntries().map(tile), ...(editing || !showDrawer ? [] : [appsTile])];
    const gridProps: Bag = {
      'data-alpha-home-apps': '', 'data-alpha-home-editing': editing ? 'true' : undefined,
      onPointerDown: (event: PointerEvent) => {
        swallow = ''; endPress();
        const target = tileOf(event.target), key = keyOf(target);
        if (!target || !key || event.button > 0) return;
        if (!editing) { press = {key, x: event.clientX, y: event.clientY, timer: setTimeout(() => { press = null; swallow = key; self.setState({homeEdit: true, homeAdd: false}); }, HOLD_MS)}; return; }
        // A press on the remove control never starts a drag.
        if ((event.target as Element).closest('[data-alpha-home-remove]')) return;
        endDrag();
        const box = target.getBoundingClientRect();
        drag = {key, x: event.clientX, y: event.clientY, scale: target.offsetWidth ? box.width / target.offsetWidth : 1, tile: target, moved: false};
      },
      onPointerMove: (event: PointerEvent) => {
        if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > SLOP) endPress();
        if (!drag) return;
        const dx = (event.clientX - drag.x) / drag.scale, dy = (event.clientY - drag.y) / drag.scale;
        if (!drag.moved && Math.hypot(dx, dy) <= SLOP) return;
        if (!drag.moved) {
          drag.moved = true; drag.tile.setAttribute('data-alpha-home-dragging', '');
          // Captured only once it is a drag, so a tap still reaches the icon.
          try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* Synthetic pointers cannot be captured. */ }
        }
        drag.tile.style.transform = `translate(${dx}px, ${dy}px)`; drag.tile.style.zIndex = '2';
      },
      onPointerUp: (event: PointerEvent) => {
        endPress();
        if (!drag) return;
        const done = drag; endDrag();
        if (!done.moved) return;
        swallow = done.key;
        const over = document.elementsFromPoint(event.clientX, event.clientY).map(node => keyOf(tileOf(node))).find(key => key && key !== done.key);
        if (over) place(done.key, over);
        rerender();
      },
      onPointerCancel: () => { endPress(); if (drag) { endDrag(); rerender(); } },
      onContextMenu: (event: MouseEvent) => {
        const key = keyOf(tileOf(event.target));
        if (!key) return;
        event.preventDefault(); endPress();
        if (!editing) { swallow = key; self.setState({homeEdit: true, homeAdd: false}); }
      },
      onClickCapture: (event: MouseEvent) => {
        const target = tileOf(event.target), key = keyOf(target);
        if (!target || !key) return;
        const held = swallow === key; swallow = '';
        if (!held && !editing) return;
        event.preventDefault(); event.stopPropagation();
        if (!held && ((event.target as Element).closest('[data-alpha-home-remove]') || event.detail === 0)) remove(key);
      },
      onKeyDown: (event: KeyboardEvent) => {
        const key = keyOf(tileOf(event.target));
        if (!editing || !key) return;
        const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(key); return; }
        const app = step && installedApp(key);
        if (!app) return;
        event.preventDefault(); launcher.clearError(); launcher.moveFavorite(app, step as -1 | 1); focusTile(key);
      },
    };
    const hideCards = out.homeHasOverviewCards === false;
    const homeShell = createElement(MobileHomeScreen, {
      tiles, covered: !!out.homeHidden,
      onFocusCapture: out.focusAppContent, 'data-alpha-layer': 'home',
      style: {inset: '44px 0 0', zIndex: 10, scrollPaddingBottom: 110},
      layoutProps: {'data-alpha-home-layout': ''}, cardsProps: {className: 'scr', hidden: hideCards, style: hideCards ? {display: 'none'} : undefined}, gridProps, clearanceProps: {'data-alpha-home-clearance': ''},
    });
    const homeEditStyle = createElement('style', null, HOME_EDIT_CSS);
    const appInfo = options.appInfo;
    const allAppsDrawer = showDrawer ? createElement(AppsDrawer, {
      launcher, builtinPrefix: prefix, query: String(S.drawerQ || ''), glyphs,
      onQuery: query => self.setState({...self.shellNavigate({type: 'drawer-query', query}), drawerMenu: null}),
      onClose: () => self.setState({...self.shellNavigate({type: 'drawer', open: false}), drawerMenu: null}),
      menu: drawerOpen ? openMenu(S) : null,
      onMenu: key => self.setState({drawerMenu: key}),
      onAddHome: (app: InstalledApp) => {
        if (launcher.isFavorite(app)) return;
        launcher.toggleFavorite(app);
        if (launcher.isFavorite(app)) self.setState({...self.shellNavigate({type: 'drawer', open: false}), drawerMenu: null});
      },
      onAppInfo: appInfo ? (app: InstalledApp) => {
        const target: {packageName: string; activityName?: string; user?: string} = {packageName: app.packageName};
        if (app.activityName) target.activityName = app.activityName;
        if (app.user) target.user = app.user;
        appInfo(target).catch((error: unknown) => {
          self.toast?.(`${app.label} info could not be opened. ${error instanceof Error && error.message ? error.message : 'Unavailable'}`);
          void launcher.refresh();
        });
      } : undefined,
      'data-alpha-layer': 'drawer', className: 'alpha-app-drawer fadein',
      style: {inset: '44px 0 0', zIndex: 30, padding: '12px 0 108px'},
    }) : null;
    // Product views not on Home, offered by edit mode's "+".
    const hidden = editing ? snapshot.apps.filter(app => app.packageName.startsWith(prefix) && !snapshot.favorites.includes(appKey(app))).map(app => {
      const view = alphaViews.fromLauncherKey(appKey(app)), url = view && alphaViews.iconUrl(view);
      return {key: appKey(app), label: app.label, glyph: `mask:url('${url || grid}') center/contain no-repeat;-webkit-mask:url('${url || grid}') center/contain no-repeat`, add: () => { launcher.clearError(); launcher.toggleFavorite(app); if (!launcher.snapshot().apps.some(other => other.packageName.startsWith(prefix) && !launcher.isFavorite(other))) self.setState({homeAdd: false}); }};
    }) : [];
    return {...out, homeShell, homeEditStyle, allAppsDrawer, drawerOpen, homeEdit: {
      on: editing, noAdd: !hidden.length, error: editing ? snapshot.launchError || '' : '',
      add: () => { if (hidden.length) self.setState({homeAdd: true}); },
      done: () => { endDrag(); launcher.clearError(); self.setState({homeEdit: false, homeAdd: false}); },
      adding: editing && !!S.homeAdd && hidden.length > 0, hidden, closeAdd: () => self.setState({homeAdd: false}), sheetRef: addSheet.ref,
    }};
  };
  return shell;
}
