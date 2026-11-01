/**
 * Alpha Phone as a registered product of the shared mobile shell. Identity, theme,
 * icons, view order and labels, older view ids and installed storage names are the
 * versioned record in config/alpha-product.json; the shell, view registry,
 * navigation and launcher join are upstream (@elizaos/ui/mobile-shell). This module
 * reads only the React-free core entry, so agent navigation and voice never load Home.
 */
import {
  createMobileViewRegistry,
  defineMobileProductRegistration,
  mobileShellThemeVariables,
  mobileShellViewPath,
  mobileShellViewPaths,
  type MobileProductRegistration,
  type MobileShellAppearance,
} from '@elizaos/ui/mobile-shell/core';
import record from '../../../../config/alpha-product.json' with {type: 'json'};
import {isMvpView} from '../prototype/mvp-features';

export const ALPHA_PRODUCT = defineMobileProductRegistration(record as MobileProductRegistration);

/** Alpha's view registry and its navigation answers for one availability policy, given by
 * Alpha renderer key. The app uses the MVP scope and AOSP image admission (below). */
export function alphaNavigation(available: (hostKey: string) => boolean) {
  // Every view is drawn by Alpha's own renderer (docs/architecture.md, remaining host pieces): none
  // is contributed to the shell's MobileViewHost.
  const views = createMobileViewRegistry(ALPHA_PRODUCT, {available: view => available(views.hostKey(view))});
  return {
    views,
    /** The renderer key navigation to any accepted id lands on ('home' for Home); undefined when
     * that view is not available in this install. */
    viewKey(viewId: string): string | undefined {
      const target = views.target(viewId);
      return !target ? undefined : target.kind === 'home' ? 'home' : views.hostKey(target.view);
    },
    /** Canonical id of a renderer key, as the agent's view metadata names it. */
    canonicalViewId: (view: string): string => views.canonicalId(view) ?? view,
    /** Route paths a navigation handoff may name for a view id; none for an unknown id. A
     * recognized older or served id (workflows, home, reminders) keeps accepting the paths it
     * was accepted with before the shared registry, `/<id>` and `/apps/<id>`, beside the
     * canonical paths, which stay the emitted form. */
    viewPaths(viewId: string): string[] {
      const id = views.canonicalId(viewId);
      return id ? [...new Set([...mobileShellViewPaths(id), `/${viewId}`, `/apps/${viewId}`])] : [];
    },
    /** Canonical route path of a renderer key (Home is /chat). */
    viewPath(view: string): string {
      const id = views.canonicalId(view);
      return id ? mobileShellViewPath(id) : `/${view}`;
    },
  };
}

// Availability is read on every call: the AOSP image can admit Contacts at runtime.
const navigation = alphaNavigation(isMvpView);
export const alphaViews = navigation.views;
export const alphaViewKey = navigation.viewKey;
export const alphaCanonicalViewId = navigation.canonicalViewId;
export const alphaViewPaths = navigation.viewPaths;
export const alphaViewPath = navigation.viewPath;

/** A fixed product colour of the record's palette, for the few reads that are not CSS (a
 * comparison with stored data). Everything drawn uses var(<name>) instead. */
export function alphaPaletteColor(name: string): string | undefined {
  const color = ALPHA_PRODUCT.theme.palette?.[name];
  return typeof color === 'string' ? color : color?.light;
}

/** CSS custom properties of Alpha's theme: canonical shell properties, the stylesheet aliases
 * (--s2, --acct, ...) and the palette (--alpha-...) the record declares. */
export function alphaThemeVariables(appearance: MobileShellAppearance): Record<string, string> {
  return mobileShellThemeVariables(ALPHA_PRODUCT, appearance);
}
