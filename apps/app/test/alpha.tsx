import { type Context, Effect, type Layer, type ManagedRuntime, Stream } from "effect";
import { TestClock } from "effect/testing";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Machine as Inbox } from "../gen/app__inbox.effect.vibe";
import { Machine as Phone } from "../gen/app__phone.effect.vibe";
import { App } from "../src/App.tsx";
import { type Mount, type Place, mounts as every } from "../src/areas.ts";
import { boot } from "../src/boot.tsx";
import type { Platform } from "../src/platform/platform.vibe";
import type inbox from "../src/inbox/index.tsx";
import type { Alpha } from "../src/runtime/area.tsx";
import { pressButton } from "./fakes/phone.ts";
import type { Scene } from "./fakes/scene.ts";
import { fakeWorld } from "./fakes/world.vibe";

const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

/** `work` under React's act in Node, where happy-dom draws only what act flushes; as it is in a browser, which draws by itself. */
export async function drawn(work: () => unknown) {
  if (environment.IS_REACT_ACT_ENVIRONMENT) await act(async () => { await work(); });
  else await work();
}

/** Run React under act: for a journey in Node, before `open`. */
export function underAct() {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
}

/** Alpha's screens at `places` alone: what a journey passes `open`, so that it loads only what it draws. */
export const only = (...places: Place[]) => every.filter((mount) => places.includes(mount.at));

/** Mount the worked example in place of the launcher's full assistant. */
export const askExample: readonly Mount[] = [{ at: "assistant", load: () => import("../src/ask/index.tsx") }];

/** The lines the worked example displays to the owner. */
export const askExampleLines = () => [...document.querySelectorAll("section[aria-label='Ask Alpha'] ol li")].map((line) => line.textContent);

/** Wait for the reviewed number to appear in the open Phone keypad. */
export const filledPhoneKeypad = (alpha: Alpha, digits: number) =>
  until(alpha, alpha.runtime, Phone, (state) => state.front && state.tab === "Keypad" && state.digits === digits);

const closing: (() => Promise<void>)[] = [];
/** What each open Alpha was opened with: the world a journey moves, and the screens its `until` loads. */
const opened = new WeakMap<Alpha, { world?: Scene; mounts: readonly Mount[] }>();

/** Reset document-level styles, alpha data attributes, fake browser overlays, and visibility state between tests. */
export function resetDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.style.fontSize = "";
  document.documentElement.style.removeProperty("--alpha-own-text-scale");
  document.documentElement.style.removeProperty("--alpha-native-inset-top");
  document.documentElement.style.removeProperty("--alpha-native-inset-bottom");
  document.documentElement.style.removeProperty("--alpha-viewport-height");
  for (const attr of [...document.documentElement.attributes]) {
    if (attr.name.startsWith("data-alpha-")) document.documentElement.removeAttribute(attr.name);
  }
  for (const surface of [...document.querySelectorAll("[data-fake-browser-page]")]) surface.remove();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
}

/** Close every Alpha the test opened, and forget what it stored: for `afterEach`. */
export async function closeAll() {
  for (const close of closing.splice(0)) await close();
  localStorage.clear();
  resetDocument();
}

/**
 * Alpha as main.tsx opens it, over this page's localStorage, the fake world and a clock at the world's time, which
 * the test moves. `mounts` are the screens it draws: every screen of Alpha, or the journey's own. `close` is the
 * process dying.
 */
export async function open(world: Scene, mounts: readonly Mount[] = every) {
  return openOver(fakeWorld(world), mounts, world);
}

/** Alpha over `platform`, which a journey with real services builds itself (test/eliza/world.vibe). */
export async function openOver(
  platform: Layer.Layer<Platform>,
  mounts: readonly Mount[] = every,
  options?: Scene | boolean | { readonly world?: Scene; readonly requireNativeSignIn?: boolean },
) {
  const world: Scene | undefined = typeof options === "object" && options !== null
    ? ("world" in options || "requireNativeSignIn" in options ? options.world : options as Scene)
    : undefined;
  const requireNativeSignIn = typeof options === "boolean"
    ? options
    : typeof options === "object" && options !== null && "requireNativeSignIn" in options
      ? options.requireNativeSignIn === true
      : false;
  const alpha = boot(platform, mounts, requireNativeSignIn);
  opened.set(alpha, { world, mounts });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await drawn(async () => {
    root.render(<App alpha={alpha} />);
    await alpha.runtime.runPromise(Effect.void);
  });
  let open = true;
  const close = async () => {
    if (!open) return;
    open = false;
    await drawn(() => root.unmount());
    host.remove();
    await alpha.dispose();
  };
  closing.push(close);
  return { alpha, close };
}

/** Wait, with every screen of `alpha` loaded, until the machine `key` names in `runtime` reaches a state `ok` accepts, and React has drawn it. */
export async function until<I, S>(alpha: Alpha, runtime: ManagedRuntime.ManagedRuntime<I, unknown>, key: Context.Key<I, { readonly changes: Stream.Stream<S> }>, ok: (state: S) => boolean) {
  await drawn(async () => {
    await Promise.allSettled((opened.get(alpha)?.mounts ?? []).map((mount) => mount.load()));
    await runtime.runPromise(Effect.flatMap(key, (machine) => Stream.runHead(Stream.filter(machine.changes, ok))));
  });
}

/** Let `ms` pass, in the world and on the clock of `alpha`. */
export const later = (alpha: Alpha, ms: number) => drawn(() => {
  const world = opened.get(alpha)?.world;
  if (world) world.now += ms;
  return alpha.runtime.runPromise(TestClock.adjust(ms));
});

/** Let the startup cover lift, as it does at the latest 2.5 s after start when Home is mounted over TestClock. */
export async function coverLifted(alpha: Alpha) {
  const cover = () => document.querySelector('[role="status"][aria-label="Loading Alpha"]');
  for (let waited = 0; waited < 2500 && cover(); waited += 500) await later(alpha, 500);
}

/** Let `ms` pass in the world while no Alpha is open: the next one opens that much later. */
export function asleep(world: Scene, ms: number) {
  world.now += ms;
}

/** The button whose accessible name is `name`, if one is shown: Home held under an app shows none. */
export const button = (name: string | RegExp) => [...document.querySelectorAll("button")].filter((found) => !found.closest("[data-alpha-home-layer][inert]")).find((found) => {
  const label = found.getAttribute("aria-label") ?? found.textContent ?? "";
  return typeof name === "string" ? label === name : label.trim().search(name) !== -1;
});

export const press = (name: string | RegExp) => drawn(() => {
  const found = button(name);
  if (!found) throw new Error(`no button ${name}`);
  found.click();
});

/** Choose an item from Chat actions as a keyboard user does. */
export function chatAction(item: string) {
  act(() => {
    const trigger = button("Chat actions");
    if (!trigger) throw new Error("no chat actions");
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  act(() => {
    const chosen = [...document.querySelectorAll("[role=menuitem]")].find((one) => one.textContent === item);
    if (!(chosen instanceof HTMLElement)) throw new Error(`no chat action ${item}`);
    chosen.click();
  });
}

/** Press the button named `name` on the sheet or dialog on top, where the page behind it may hold one of the same name. */
export const pressOnTop = (name: string) => drawn(() => {
  const top = [...document.querySelectorAll("[role=dialog], [role=alertdialog]")].at(-1);
  const found = top && [...top.querySelectorAll("button")].find((one) => (one.getAttribute("aria-label") ?? one.textContent) === name);
  if (!found) throw new Error(`no button ${name} on top`);
  found.click();
});

/** Set `field` to `text` as typing does, so React hears the input event. */
export function typeInto(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field) as object, "value")?.set?.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Press the Home tile that opens `view`. */
const pressTile = (view: string) => drawn(() => {
  const tile = document.querySelector<HTMLButtonElement>(`[data-home-tile='view:${view}']`);
  if (!tile) throw new Error(`No ${view} home tile`);
  tile.click();
});

/** Open Inbox from Home, wait until `letters`, its runtime, has read the owner's mail, and go back Home. */
export async function readInboxFirst(alpha: Alpha, letters: ReturnType<typeof inbox.runtime>) {
  await pressTile("Inbox");
  await until(alpha, letters, Inbox, (state) => state.list.status === "Loaded" && state.selected.account !== 0);
  await hardware("back");
}

/** The words `element` shows on screen, leaving out what only a screen reader hears. */
export function shownWords(element: Element | null | undefined) {
  const copy = element?.cloneNode(true);
  if (!(copy instanceof Element)) return undefined;
  for (const hidden of copy.querySelectorAll(".sr-only")) hidden.remove();
  return copy.textContent?.trim();
}

/** The input whose accessible name is `name`, or null while none is drawn. */
export const input = (name: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);

/** Type `text` into the field whose accessible name is `name`, as a person does: React hears the input event. */
export const fill = (name: string, text: string) => drawn(() => {
  const found = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].find((field) => field.getAttribute("aria-label") === name);
  if (!found) throw new Error(`no field ${name}`);
  typeInto(found, text);
});

/** The page is hidden, as when the owner leaves Alpha, or shown again: what `Device.visible` tells. */
export const seen = (visible: boolean) => drawn(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (visible ? "visible" : "hidden") });
  document.dispatchEvent(new Event("visibilitychange"));
});

/** Hand Alpha a hardware button, as the phone does. */
export const hardware = (pressed: "back" | "home") => drawn(() => pressButton(pressed));
