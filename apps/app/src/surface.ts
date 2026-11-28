// spec/app/shell/index.md, "Story: Move between Home and the apps"
import type { View } from "../gen/app__shell.ts";
import { viewOrder } from "./shell/order.ts";

/** Runtime surface mode: the full monolith launcher, the system-wide Ask Alpha overlay, or one standalone app view. */
export type AlphaSurface =
  | { readonly mode: "monolith" }
  | { readonly mode: "overlay" }
  | { readonly mode: "app"; readonly view: View };

/** Every built-in view name in canonical casing. */
export const SURFACE_VIEWS: readonly View[] = viewOrder;

const VIEW_BY_LOWER = new Map<string, View>(
  SURFACE_VIEWS.map((view) => [view.toLowerCase(), view]),
);

const COMMS_VIEWS: ReadonlySet<View> = new Set<View>(["Phone", "Messages", "Contacts"]);
const OCR_VIEWS: ReadonlySet<View> = new Set<View>(["Camera", "Files"]);

/** Parse an untrusted view name into a validated `View`, matching canonical or lowercase spelling. @throws {never} */
export function parseView(raw: string | null | undefined): View | undefined {
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  return VIEW_BY_LOWER.get(trimmed.toLowerCase());
}

/** Inputs used to resolve the active surface from build-time env and optional URL query parameters. */
export interface SurfaceInputs {
  readonly envSurface?: string;
  readonly envView?: string;
  readonly search?: string;
}

/** Resolve the active `AlphaSurface`; defaults to `{ mode: "monolith" }` when unset or invalid. @throws {never} */
export function parseSurface({ envSurface, envView, search }: SurfaceInputs): AlphaSurface {
  const normalizedEnv = envSurface?.trim().toLowerCase();
  if (normalizedEnv === "overlay") return { mode: "overlay" };
  if (normalizedEnv === "app") {
    const view = parseView(envView);
    if (view !== undefined) return { mode: "app", view };
  }
  if ((normalizedEnv === undefined || normalizedEnv === "" || normalizedEnv === "monolith") && search) {
    const params = new URLSearchParams(search);
    const querySurface = params.get("surface")?.trim().toLowerCase();
    if (querySurface === "overlay") return { mode: "overlay" };
    if (querySurface === "app") {
      const view = parseView(params.get("view"));
      if (view !== undefined) return { mode: "app", view };
    }
  }
  return { mode: "monolith" };
}

/** Resolve the active surface for the current page from Vite env and `location.search`. @throws {never} */
export function currentSurface(): AlphaSurface {
  const envSurface: unknown = import.meta.env.VITE_ALPHA_SURFACE;
  const envView: unknown = import.meta.env.VITE_ALPHA_VIEW;
  const search = typeof location !== "undefined" ? location.search : undefined;
  return parseSurface({ envSurface: typeof envSurface === "string" ? envSurface : undefined, envView: typeof envView === "string" ? envView : undefined, search });
}

/** Lock key scoped to `surface` so multi-surface tabs do not contend with one another. @throws {never} */
export function lockNameFor(surface: AlphaSurface): string {
  switch (surface.mode) {
    case "monolith":
      return "alpha.page";
    case "overlay":
      return "alpha.page:overlay";
    case "app":
      return `alpha.page:app:${surface.view}`;
  }
}

/** Whether `surface` requires offline OCR assets (`monolith`, `Camera`, and `Files` only). @throws {never} */
export function needsLocalOcr(surface: AlphaSurface): boolean {
  switch (surface.mode) {
    case "monolith":
      return true;
    case "overlay":
      return false;
    case "app":
      return OCR_VIEWS.has(surface.view);
  }
}

/** Whether a mount at `place` belongs to `surface`. @throws {never} */
export function allowsPlace(surface: AlphaSurface, place: string): boolean {
  switch (surface.mode) {
    case "monolith":
      return true;
    case "overlay":
      return place === "assistant" || place === "assistant/calendar" || place === "overlay" || place === "notice";
    case "app":
      if (place === `view:${surface.view}` || place === "overlay" || place === "notice") return true;
      if (place === "phone/stage") return COMMS_VIEWS.has(surface.view);
      if (place.startsWith("settings/")) return surface.view === "Settings";
      return false;
  }
}

/** Filter `all` screen mounts to the subset belonging to `surface`, preserving order and reference identity in monolith mode. @throws {never} */
export function mountsFor<T extends { readonly at: string }>(surface: AlphaSurface, all: readonly T[]): readonly T[] {
  if (surface.mode === "monolith") return all;
  return all.filter((mount) => allowsPlace(surface, mount.at));
}
