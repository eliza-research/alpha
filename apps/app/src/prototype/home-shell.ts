import {createElement, type CSSProperties} from 'react';
import type {FavoritesStore, LauncherBridge} from '@elizaos/capacitor-system/launcher';
import {createMobileShellLauncher, mobileShellIconUrl, MobileAllAppsDrawer, MobileHomeScreen, type MobileHomeEntry, type MobileHomeTile} from '@elizaos/ui/mobile-shell';
import {ALPHA_PRODUCT, alphaViews} from '../product/alpha-product';
type Bag = Record<string, any>;

/** Home, its app grid and All apps from the shared mobile shell, themed by the Alpha record.
 * The template fills Home's notice and card slots; open state and Back go through the shared
 * navigation reducer (Component.shellNavigate), so Back and Home close the drawer. The installed
 * favorites are the record's (alpha.launcher.favorites.v1, product views as `alpha:<canonical
 * id>`); the shell migrates their older view ids once before the launcher first reads them. */
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
} = {}) {
  const p = Component.prototype, mount = p.componentDidMount, unmount = p.componentWillUnmount, render = p.renderVals;
  let owner: any = null;
  const shell = createMobileShellLauncher({
    bridge, registry: alphaViews, icons: options.icons, aliases: options.aliases,
    favorites: options.favorites, storage: options.storage,
    open: view => owner?.openView(alphaViews.hostKey(view)),
    changed: () => owner?.setState({launcherRevision: Date.now()}),
  });
  const grid = mobileShellIconUrl(ALPHA_PRODUCT, ALPHA_PRODUCT.icons.allApps);
  const inventory = options.appInventory;
  const installedOnly = inventory === 'android';
  const drawerTitle = installedOnly ? 'Apps' : 'All apps';
  let stop: (() => void) | undefined;
  p.componentDidMount = function (...args: any[]) {
    owner = this;
    if (inventory) stop = shell.observe({follow: options.follow});
    const result = mount?.apply(this, args);
    if (inventory) shell.prepareHome();
    return result;
  };
  p.componentWillUnmount = function (...args: any[]) {
    stop?.(); shell.launcher.cancelPending(); stop = undefined; if (owner === this) owner = null;
    return unmount?.apply(this, args);
  };
  p.openAllApps = function () {
    if (!inventory || this.props?.assistantSurface) return;
    this.setState(this.shellNavigate({type: 'drawer', open: true}));
    void shell.launcher.load();
  };
  p.renderVals = function () {
    const out = render.call(this), S = this.S(), self = this;
    shell.syncViews();
    const tile = (entry: MobileHomeEntry): MobileHomeTile => {
      if (entry.kind === 'app') return {key: entry.key, label: entry.app.label, image: entry.app.icon, glyphUrl: entry.app.icon ? undefined : grid, iconId: entry.app.icon ? undefined : ALPHA_PRODUCT.icons.allApps, onOpen: () => void shell.launcher.launch(entry.app)};
      const key = alphaViews.hostKey(entry.view), definition = views[key] || {};
      const badge = typeof definition.badge === 'function' && ['phone', 'messages', 'inbox'].includes(key) ? !!definition.badge(self.vget(key)) : false;
      return {key: entry.key, label: entry.view.label, glyphUrl: alphaViews.iconUrl(entry.view), iconId: ALPHA_PRODUCT.icons.views[entry.view.id], badge, onOpen: () => self.openView(key)};
    };
    const showDrawer = !!inventory && !out.assistantSurface;
    const homeShell = createElement(MobileHomeScreen, {
      tiles: out.assistantSurface ? [] : shell.homeEntries().map(tile),
      onOpenAllApps: showDrawer ? () => self.openAllApps() : undefined, allAppsLabel: drawerTitle, allAppsGlyphUrl: grid, allAppsIconId: ALPHA_PRODUCT.icons.allApps, covered: !!out.homeHidden,
      onFocusCapture: out.focusAppContent, 'data-alpha-layer': 'home',
      style: {inset: '44px 0 0', zIndex: 10, scrollPaddingBottom: 110},
      layoutProps: {'data-alpha-home-layout': ''}, cardsProps: {className: 'scr'}, gridProps: {'data-alpha-home-apps': ''}, clearanceProps: {'data-alpha-home-clearance': ''},
    });
    const allAppsDrawer = showDrawer ? createElement(MobileAllAppsDrawer, {
      title: drawerTitle, installedOnly,
      shellLauncher: shell, registry: alphaViews, query: String(S.drawerQ || ''),
      onQuery: query => self.setState(self.shellNavigate({type: 'drawer-query', query})),
      onClose: () => self.setState(self.shellNavigate({type: 'drawer', open: false})),
      'data-alpha-layer': 'drawer', className: 'alpha-app-drawer fadein',
      style: {inset: '44px 0 0', zIndex: 30, padding: '12px 0 108px'},
      inventoryStyle: {'--launcher-title-weight': '300'} as CSSProperties,
    }) : null;
    return {...out, homeShell, allAppsDrawer, drawerOpen: showDrawer && !!S.drawer && !!out.isOn && !out.isView};
  };
  return shell;
}
