// @vitest-environment happy-dom
import { Effect } from "effect";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { Machine as Conversation } from "../gen/app__assistant.effect.vibe";
import { Machine as Composer } from "../gen/app__assistant__composer.effect.vibe";
import { Machine as Tabs } from "../gen/app__browser.effect.vibe";
import { Machine as Page } from "../gen/app__browser__address.effect.vibe";
import { verdict } from "../gen/app__browser__address.ts";
import { Machine as Library } from "../gen/app__browser__library.effect.vibe";
import { Machine as Settings } from "../gen/app__settings.effect.vibe";
import { Machine as Preferences } from "../gen/app__settings__preferences.effect.vibe";
import { Machine as Reader } from "../gen/app__browser__reading.effect.vibe";
import { Machine as Share } from "../gen/app__browser__share.effect.vibe";
import { Machine as Site } from "../gen/app__browser__site.effect.vibe";
import { Machine as Home } from "../gen/app__home.effect.vibe";
import { Machine as Offering } from "../gen/app__inbox__suggestion.effect.vibe";
import { Machine as Shell, showing } from "../gen/app__shell.effect.vibe";
import { Machine as Speaker } from "../gen/app__voice__output.effect.vibe";
import assistant from "../src/assistant/index.tsx";
import { Pages, inputOf } from "../src/browser/browser.vibe";
import browser from "../src/browser/index.tsx";
import type { Alpha } from "../src/runtime/area.tsx";
import home from "../src/home/index.tsx";
import inbox from "../src/inbox/index.tsx";
import { Offers } from "../src/inbox/suggestion.vibe";
import { say } from "../src/notices/toasts.vibe";
import { TabHost } from "../src/platform/browser.vibe";
import { button, closeAll, drawn, fill, hardware, later, only, open, press, pressOnTop, readInboxFirst, typeInto, underAct, until } from "./alpha.tsx";
import { memoryIndexedDB } from "./fakes/indexeddb.ts";
import { scene } from "./fakes/scene.ts";
import { askedPage, textReview } from "./fakes/text-review.ts";

underAct();
afterEach(closeAll);

type BrowserRuntime = ReturnType<typeof browser.runtime>;

/** The tab the Browser shows. */
const selectedTab = (runtime: BrowserRuntime) => runtime.runSync(Effect.map(Effect.flatMap(Tabs, (m) => m.get()), (s) => s.selected));

/** The page `tab` shows: by default the selected tab's. */
const selectedPage = (runtime: BrowserRuntime, tab = selectedTab(runtime)) => runtime.runSync(Effect.flatMap(Pages, (pages) => pages.of(tab)));

/** Alpha on an Alpha image with the Browser on screen. */
/** Whether the phone gives a touch at (x, y) to the page, as `HostRect.pageOwnsPoint` decides it below Alpha. */
function pageOwns(shown: { shown?: { x: number; y: number; width: number; height: number }; hostRects: readonly { x: number; y: number; width: number; height: number; cornerRadius: number }[] }, x: number, y: number): boolean {
  const page = shown.shown;
  if (page === undefined || x < page.x || y < page.y || x >= page.x + page.width || y >= page.y + page.height) return false;
  return !shown.hostRects.some((rect) => {
    if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) return false;
    const radius = Math.min(rect.cornerRadius, rect.width / 2, rect.height / 2);
    const cx = Math.min(Math.max(x, rect.x + radius), rect.x + rect.width - radius), cy = Math.min(Math.max(y, rect.y + radius), rect.y + rect.height - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  });
}

async function onBrowser(world = { ...scene(), phone: true, image: true }, notices = false) {
  const running = await open(world, notices ? only("home", "notice", "view:Browser") : only("home", "view:Browser"));
  await until(running.alpha, home.runtime(running.alpha), Home, (h) => h.tiles.load.status === "Loaded");
  const runtime = browser.runtime(running.alpha);
  await press("Browser");
  return { ...running, world, runtime };
}

/** The Browser opened from Home, once its tabs are read back. */
async function onHydratedBrowser(world = { ...scene(), phone: true, image: true }) {
  const opened = await onBrowser(world);
  await until(opened.alpha, opened.runtime, Tabs, (s) => s.hydrated);
  return opened;
}

/** Ask Alpha and the Browser on `world`, once Ask Alpha's composer is open and its conversation ready. */
async function askingBeside(world: ReturnType<typeof scene>) {
  const { alpha } = await open(world, only("home", "assistant", "view:Browser"));
  const ask = assistant.runtime(alpha);
  const runtime = browser.runtime(alpha);
  await until(alpha, ask, Composer, (s) => s.slot === "Open");
  await until(alpha, ask, Conversation, (s) => s.ready);
  return { alpha, ask, runtime };
}

/** The Browser opened from Home with Ask Alpha mounted beside it, once its tabs are read back. */
async function browserBeside(world: ReturnType<typeof scene>) {
  const { alpha } = await open(world, only("home", "assistant", "view:Browser"));
  const runtime = browser.runtime(alpha);
  await press("Browser");
  await until(alpha, runtime, Tabs, (s) => s.hydrated);
  return { alpha, runtime };
}

/** The agent's BROWSER_OPEN of `url`, for the view that asked as `metadata` names it, marked to open at once when the owner's whole message asked for it. */
const openAction = (url: string, metadata: unknown, atOnce = false) => ({
  action: "BROWSER_OPEN",
  data: { actionName: "BROWSER_OPEN", mode: "open", operation: { type: "browser_navigate", url }, clientId: String((metadata as { viewClientId?: unknown }).viewClientId), atOnce },
});

/** Send `text` from Ask Alpha's composer, and wait until its reply completes. */
async function sendFromComposer(alpha: Alpha, ask: ReturnType<typeof assistant.runtime>, text: string) {
  const composer = () => document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message Alpha']");
  const turn = (await ask.runPromise(Effect.flatMap(Conversation, (c) => c.get()))).turn.send.id + 1;
  await drawn(() => vi.waitFor(() => expect(composer()).not.toBeNull()));
  if (composer()?.hidden) await press("Type");
  await fill("Message Alpha", text);
  await press("Send");
  await until(alpha, ask, Conversation, (c) => c.turn.send.id === turn && c.turn.reply === "Complete");
}

/** Alpha on an Alpha image with the Browser on screen and Ask Alpha's bar over it. */
async function askingOnBrowser(world = { ...scene(), phone: true, image: true }) {
  const running = await open(world, only("home", "assistant", "notice", "view:Browser"));
  await until(running.alpha, home.runtime(running.alpha), Home, (h) => h.tiles.load.status === "Loaded");
  const runtime = browser.runtime(running.alpha);
  await press("Browser");
  await until(running.alpha, runtime, Tabs, (s) => s.hydrated);
  const asking = assistant.runtime(running.alpha);
  await until(running.alpha, asking, Conversation, (c) => c.ready && c.context.showing.tag === "App");
  return { ...running, world, runtime, asking };
}

/** Ask Alpha from the bar over the Browser, and wait for the reply to end. */
async function ask(running: Awaited<ReturnType<typeof askingOnBrowser>>, text: string) {
  const { alpha, asking, world } = running;
  world.ask.metadata = [];
  await drawn(() => {
    const box = [...document.querySelectorAll("textarea")].find((one) => one.getAttribute("aria-label") === "Message Alpha");
    if (!box) throw new Error("no composer");
    typeInto(box, text);
  });
  await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
  await press("Send");
  await until(alpha, asking, Conversation, (c) => c.turn.reply === "Complete" && (world.ask.metadata?.length ?? 0) > 0);
  return world.ask.metadata?.[0] as { observation?: { view?: string; selectedObject?: { kind?: string; id?: string; revision?: string } }; browserPage?: { url?: string; text?: string; tabId?: string; revision?: string } } | undefined;
}

async function committedAddress(runtime: ReturnType<typeof browser.runtime>, tabs: ReturnType<typeof scene>["browser"]["tabs"]) {
  const state = await runtime.runPromise(Effect.flatMap(Tabs, (model) => model.get()));
  const tab = tabs.get(`tab${state.selected}`);
  return state.agent === 0 && tab?.committed ? tab.history[tab.at] : undefined;
}

const go = (text: string, kind: "normal" | "private" = "normal") => drawn(async () => {
  if (kind === "private") {
    await press("Menu");
    await pressOnTop("New private tab");
  } else if (!document.querySelector('input[aria-label="Address"]')) {
    await press(/^Edit address/);
  }
  await fill("Address", text);
  const form = document.querySelector<HTMLFormElement>("form[role=search]");
  if (!form) throw new Error("no address field");
  form.requestSubmit();
});

/** Go to `text` in a `kind` tab and wait until its page is shown over HTTPS: the tab and its page. */
async function goSecure(alpha: Alpha, runtime: BrowserRuntime, text: string, kind: "normal" | "private" = "normal") {
  await go(text, kind);
  const tab = selectedTab(runtime);
  const page = selectedPage(runtime, tab);
  await until(alpha, page, Page, (p) => p.phase === "Shown" && p.secure);
  return { tab, page };
}

const placeNative = () => {
  const surface = document.querySelector<HTMLElement>("[data-alpha-browser-page]");
  if (!surface) throw new Error("Browser has no native page slot");
  Object.defineProperty(surface, "getBoundingClientRect", { value: () => new DOMRect(0, 104, 390, 650) });
};

/** Give native Browser pages a laid-out surface in the DOM fixture. */
function layOutNativePage(rectangle: DOMRect | ((node: HTMLElement) => DOMRect | undefined)): void {
  const measure: unknown = Reflect.get(HTMLElement.prototype, "getBoundingClientRect");
  if (typeof measure !== "function") throw new Error("The DOM fixture cannot measure elements");
  const laidOut = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const custom = typeof rectangle === "function" ? rectangle(this) : this.hasAttribute("data-alpha-browser-page") ? rectangle : undefined;
    if (custom !== undefined) return custom;
    const measured: unknown = Reflect.apply(measure, this, []);
    if (!(measured instanceof DOMRect)) throw new Error("The DOM fixture measured an invalid rectangle");
    return measured;
  });
  onTestFinished(() => laidOut.mockRestore());
}

/** The time range history clears over, picked from the Select's list by the keyboard, as a person can. */
const historyRange = async (label: string) => {
  const trigger = document.querySelector<HTMLButtonElement>("#alpha-history-range");
  if (!trigger) throw new Error("no time range for clearing history");
  await drawn(() => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(document.querySelector("[role=listbox]")).not.toBeNull());
  const option = [...document.querySelectorAll<HTMLElement>("[role=option]")].find((one) => one.textContent === label);
  if (!option) throw new Error(`no time range ${label}`);
  await drawn(() => {
    option.focus();
    option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect([document.querySelector("[role=listbox]"), trigger.textContent]).toEqual([null, label]));
};

/** The Clear history button under the time range, not the trash button that opens it. */
const clearHistoryOver = () => drawn(() => {
  const found = [...document.querySelectorAll("[role=group][aria-label='Clear history options'] button")].find((one) => one.textContent === "Clear history");
  if (!(found instanceof HTMLButtonElement)) throw new Error("no Clear history under the time range");
  found.click();
});

const libraryTab = (name: "History" | "Bookmarks") => drawn(() => {
  const tab = button(name);
  if (!tab) throw new Error(`no Library tab ${name}`);
  tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
});

async function askResetBrowserData(alpha: Alpha, runtime: BrowserRuntime) {
  await press("Menu");
  await press("Library, bookmarks and history");
  await libraryTab("History");
  await press("Clear history");
  await press("Reset browser data");
  await until(alpha, runtime, Tabs, (s) => s.erasing === "Asked" && s.layer === "Uncovered");
}

const askClearAll = async (alpha: Awaited<ReturnType<typeof onBrowser>>["alpha"], runtime: ReturnType<typeof browser.runtime>, choice: "Cancel" | "Clear data") => {
  if (!button("Reset browser data")) {
    await press("Menu");
    await press("Library, bookmarks and history");
    await libraryTab("History");
    await press("Clear history");
  }
  await press("Reset browser data");
  await until(alpha, runtime, Tabs, (s) => s.erasing === "Asked");
  await press(choice);
  await until(alpha, runtime, Tabs, (s) => s.erasing === "Kept");
};

async function openHydratedPhoneBrowser() {
  const world = { ...scene(), phone: true, image: true };
  return { ...(await onHydratedBrowser(world)), world };
}

describe("The Browser on a phone", () => {
  it("Opens the saved Library (spec/app/browser/library.md, \"Story: Keep bookmarks\"; spec/app/browser/library.md, \"Story: Look back through history\"; spec/app/browser/address.md, \"Story: Go where I typed\")", async () => {
    const { alpha, runtime, world } = await openHydratedPhoneBrowser();
    // spec/app/browser/address.md, "A tab with no page says \"Search or address\" in its bar, a private tab as a normal one, and only the private mark tells them apart"
    expect(button(/^Edit address/)?.textContent).toBe("Edit addressSearch or address");
    await press(/^Edit address/);
    await until(alpha, runtime, Library, (s) => s.read.status === "Loaded");
    const suggestions = () => document.querySelector("[aria-label='Address suggestions']");
    expect(suggestions()?.textContent).toContain("/on-device-agents");
    await drawn(() => fill("Address", "keys"));
    expect(suggestions()?.textContent).toContain("/keys-in-hardware");
    expect(suggestions()?.textContent).not.toContain("/on-device-agents");
    await press("Cancel editing");
    await press("Menu");
    await until(alpha, runtime, Library, (s) => s.read.status === "Loaded");
    await press("Bookmark");
    await until(alpha, runtime, Library, (s) => s.notice === "NotSecure");
    expect(world.browser.bookmarks.map((one) => one.url)).toEqual(["https://enclave.example/keys-in-hardware"]);
    await press("Library, bookmarks and history");
    await until(alpha, runtime, Library, (s) => s.read.status === "Loaded");
    await libraryTab("History");
    expect([...document.querySelectorAll("button")].some((row) => row.textContent?.includes("news.example/on-device-agents"))).toBe(true);
    // spec/app/browser/library.md, "The Library lists every bookmark and every page of history, one plain list each, with no search and no day headings"
    const listed = () => document.querySelector("[role=tabpanel][data-state=active]");
    expect([listed()?.querySelectorAll("input, [role=search], h2, h3").length, listed()?.querySelectorAll("li").length])
      .toEqual([0, runtime.runSync(Library.use((machine) => machine.get())).history]);
    await libraryTab("Bookmarks");
    const bookmark = [...document.querySelectorAll("button")].find((row) => row.textContent?.includes("Keys in the chip"));
    if (!bookmark) throw new Error("saved bookmark is missing");
    await drawn(() => bookmark.click());
    const page = selectedPage(runtime);
    await until(alpha, page, Page, (s) => s.phase === "Shown");
    expect([...world.browser.tabs.values()].map((one) => one.history[one.at])).toEqual(["https://enclave.example/keys-in-hardware"]);

    await press("Menu");
    await press("Bookmarked");
    await until(alpha, runtime, Library, (s) => s.job === "Idle" && s.marks === 0);
    await until(alpha, runtime, Tabs, (s) => s.layer === "Uncovered");
    expect(world.browser.bookmarks).toEqual([]);
    await press("Menu");
    await press("Bookmark");
    await until(alpha, runtime, Library, (s) => s.job === "Idle" && s.marks === 1);
    await until(alpha, runtime, Tabs, (s) => s.layer === "Uncovered");
    expect(world.browser.bookmarks.map((one) => one.url)).toEqual(["https://enclave.example/keys-in-hardware"]);

    await press("Menu");
    await press("Library, bookmarks and history");
    await until(alpha, runtime, Library, (s) => s.read.status === "Loaded");
    const remove = [...document.querySelectorAll("button")].find((row) => row.getAttribute("aria-label")?.startsWith("Remove bookmark "));
    if (!remove) throw new Error("bookmark removal control is missing");
    await drawn(() => remove.click());
    await until(alpha, runtime, Library, (s) => s.job === "Idle" && s.marks === 0);
    expect(world.browser.bookmarks).toEqual([]);

    await libraryTab("History");
    const kept = "https://enclave.example/keys-in-hardware";
    const other = "https://tables.example/nopa";
    await press("Remove from history The case for on-device agents");
    await later(alpha, 2000);
    await until(alpha, runtime, Library, (s) => s.job === "Idle" && s.history === 2);
    expect(world.browser.saved.history).toEqual([kept, other]);

    // spec/app/browser/library.md, "Clearing history asks first, and can be cancelled"
    await press("Clear history");
    await historyRange("All time");
    await clearHistoryOver();
    await until(alpha, runtime, Library, (s) => s.confirming);
    await hardware("back");
    await until(alpha, runtime, Library, (s) => !s.confirming);
    expect(world.browser.saved.history).toEqual([kept, other]);

    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    world.browser.beforeSave = async (snapshot) => {
      if (snapshot.history.length > 0) return;
      entered.resolve();
      await release.promise;
    };
    try {
      await clearHistoryOver();
      await pressOnTop("Clear history");
      await later(alpha, 2000);
      await entered.promise;
      await press("Back to page");
      const load = page.runSync(Page.use((machine) => machine.get())).load;
      await go(kept);
      await until(alpha, page, Page, (s) => s.phase === "Shown" && s.load > load);
    } finally { release.resolve(); }
    await until(alpha, runtime, Library, (s) => s.job === "Idle" && s.history === 1);
    await later(alpha, 2000);
    await until(alpha, runtime, Tabs, (s) => !s.stale && !s.writing);
    expect(world.browser.saved.history).toEqual([kept]);
  });

  it("Open a page and watch it load (spec/app/browser/address.md, \"Story: Go where I typed\"; spec/app/browser/address.md, \"Story: Watch a page load\"; spec/app/browser/address.md, \"Story: Find in page\"; spec/app/browser/share.md, \"Story: Share the page\")", async () => {
    const { alpha, runtime, world } = await onBrowser();
    // spec/app/browser/index.md, "A launch reads the saved session, and may ask again after a failed read"
    await until(alpha, runtime, Tabs, (s) => s.hydrated);
    const startSearch = () => document.querySelector<HTMLInputElement>('input[aria-label="Search Google or type a URL"]');
    expect([
      world.browser.calls.includes("browsingState"),
      Boolean(document.querySelector('[role="img"][aria-label="Google"]')),
      Boolean(startSearch()),
    ]).toEqual([true, true, true]);

    // spec/app/browser/address.md, "Submitting text opens it, searches for it or says why not, and blank text is not submitted"
    const history = [...world.browser.tabs.values()].map((one) => [...one.history]);
    await fill("Search Google or type a URL", "https://owner:example@private.example");
    await drawn(() => { startSearch()?.form?.requestSubmit(); });
    expect(document.querySelector("[role='alert']")?.textContent).toContain("Remove the username or password from this address.");
    expect([...world.browser.tabs.values()].map((one) => one.history)).toEqual(history);
    await press("Clear search");
    expect(document.querySelector("[role='alert']")).toBeNull();

    await go("https://owner:example@private.example");
    expect(document.querySelector("[role='alert']")?.textContent).toContain("Remove the username or password from this address.");
    expect([...world.browser.tabs.values()].map((one) => one.history)).toEqual(history);
    await press("Cancel editing");
    expect(document.querySelector("[role='alert']")).toBeNull();
    // spec/app/browser/address.md, "Only the latest load of the page commits it or fails it"; spec/app/browser/address.md, "The secure mark shows only on a page that committed over HTTPS"; spec/app/browser/address.md, "The secure mark is drawn only in the phone's own Browser, beside a page that committed over HTTPS"
    const { tab, page } = await goSecure(alpha, runtime, "news.example/on-device-agents");
    expect([...world.browser.tabs.values()].map((one) => one.history)).toEqual([["https://news.example/on-device-agents"]]);
    expect(Boolean(document.querySelector("[aria-label='Secure connection']"))).toBe(true);

    placeNative();
    await press("Menu");
    await press("Share");
    await until(alpha, runtime, Share, (s) => s.sent === 1 && s.delivery.tag === "NoDelivery");
    expect(world.browser.shared.map(({ id, url, navigation }) => [id, url, navigation])).toEqual([
      [`tab${tab}`, "https://news.example/on-device-agents", "1"],
    ]);
    await press("Menu");
    await press("Copy link");
    await until(alpha, runtime, Share, (s) => s.notice === "Copied");
    expect(world.settings.copied).toEqual(["https://news.example/on-device-agents"]);

    // spec/app/browser/site.md, "Clearing a site's data needs a loaded site, and runs one at a time"; spec/app/browser/site.md, "Cleared data forgets the answers given to that site; a clearing that fails forgets nothing"
    await press("Menu");
    await press("Clear site data");
    expect(world.browser.calls.includes("clearSiteData")).toBe(false);
    await press("Clear data");
    await until(alpha, runtime, Site, (s) => s.clear === 1 && !s.clearing);
    expect(world.browser.calls.includes("clearSiteData")).toBe(true);

    // spec/app/browser/address.md, "Typing searches the page, and clearing the text clears the search"; spec/app/browser/address.md, "Only the answer to the latest search counts"
    await press("Menu");
    await press("Find in page");
    await until(alpha, page, Page, (p) => p.finding);
    await fill("Find in page", "agent");
    const status = () => document.querySelector('[role="search"][aria-label="Find in page"] [role="status"]')?.textContent;
    await drawn(() => vi.waitFor(() => expect(status()).toBe("1 of 4")));
    await press("Next match");
    await drawn(() => vi.waitFor(() => expect(status()).toBe("2 of 4")));
    await press("Previous match");
    await drawn(() => vi.waitFor(() => expect(status()).toBe("1 of 4")));
    await fill("Find in page", "absent");
    await drawn(() => vi.waitFor(() => expect(status()).toBe("No matches")));
    // spec/app/browser/address.md, "Closing the find bar clears the search"
    await press("Close find in page");
    await until(alpha, page, Page, (p) => !p.finding && p.matches === 0);

    // spec/app/browser/address.md, "Back and forward move through the tab's own pages"
    await go("enclave.example/keys-in-hardware");
    await until(alpha, page, Page, (p) => p.phase === "Shown" && p.behind === 1);
    await hardware("back");
    await until(alpha, page, Page, (p) => p.phase === "Shown" && p.behind === 0 && p.ahead === 1);
    expect([...world.browser.tabs.values()].map((one) => one.history[one.at])).toEqual(["https://news.example/on-device-agents"]);

    // spec/app/browser/address.md, "Text that is too long, or names a user or a password, is refused; an http or https address opens when it has a host; anything else is a search unless it reads as a host"
    await go("on device agents");
    await until(alpha, page, Page, (p) => p.phase === "Shown" && p.behind === 1);
    expect([...world.browser.tabs.values()].map((one) => one.history.at(-1))).toEqual(["https://www.google.com/search?q=on%20device%20agents"]);
  });

  it('Searches Google directly from the new tab start view (spec/app/browser/address.md, "Story: Go where I typed")', async () => {
    const { alpha, runtime, world } = await onBrowser();
    await until(alpha, runtime, Tabs, (s) => s.hydrated);
    const searchInput = () => document.querySelector<HTMLInputElement>('input[aria-label="Search Google or type a URL"]');
    expect([Boolean(document.querySelector('[role="img"][aria-label="Google"]')), Boolean(searchInput())]).toEqual([true, true]);

    await fill("Search Google or type a URL", "pixel 10a");
    await drawn(() => { searchInput()?.form?.requestSubmit(); });
    const tab = selectedTab(runtime);
    const page = selectedPage(runtime, tab);
    await until(alpha, page, Page, (p) => p.phase === "Shown" && p.secure);
    expect([...world.browser.tabs.values()].map((one) => one.history)).toEqual([["https://www.google.com/search?q=pixel%2010a"]]);
  });

  it.each([
    "https://enclave.example/keys-in-hardware",
    "https://news.example/on-device-agents",
  ])(`Keeps site data if the page moves to %s while clearing is reviewed (spec/app/browser/site.md, "Clearing a site's data needs a loaded site, and runs one at a time")`, async (target) => {
    const { alpha, runtime, world } = await onBrowser();
    await until(alpha, runtime, Tabs, (s) => s.hydrated);
    const { tab, page } = await goSecure(alpha, runtime, "news.example/on-device-agents");
    const initial = page.runSync(Effect.flatMap(Page, (m) => m.get()));
    await press("Menu");
    await press("Clear site data");
    expect(document.querySelector("[role=alertdialog]")?.textContent).toContain("news.example");
    await drawn(() => { world.browser.navigateFromPage?.(`tab${tab}`, target); });
    await until(alpha, page, Page, (p) => p.phase === "Shown" && p.load > initial.load);
    await press("Clear data");
    expect(world.browser.calls).not.toContain("clearSiteData");
    expect(runtime.runSync(Effect.flatMap(Site, (m) => m.get())).clear).toBe(0);
  });

  it("Draws the find bar over the full-size page (spec/app/browser/address.md, \"The find bar opens over a shown page\")", async () => {
    const { alpha, runtime, world } = await onBrowser();
    await until(alpha, runtime, Tabs, (s) => s.hydrated);
    layOutNativePage((node) => {
      if (node.hasAttribute("data-alpha-browser-page")) return node.classList.contains("top-12.5") ? new DOMRect(0, 154, 390, 600) : new DOMRect(0, 104, 390, 650);
      if (node.matches('[role="search"][aria-label="Find in page"]')) return new DOMRect(10, 106, 370, 52);
      return undefined;
    });
    const { tab, page } = await goSecure(alpha, runtime, "news.example/on-device-agents");
    const full = { id: `tab${tab}`, x: 0, y: 104, width: 390, height: 650 };
    await drawn(() => vi.waitFor(() => expect(world.browser.shown).toEqual(full)));
    expect([world.browser.layer, world.browser.hostRects]).toEqual(["above-host", []]);
    expect(document.documentElement.dataset.alphaBrowserUnder).toBeUndefined();

    await press("Menu");
    await press("Find in page");
    await until(alpha, page, Page, (p) => p.finding);
    // spec/app/browser/address.md, "The find bar opens over a shown page": as on v119, the page is drawn below Alpha, whose surface clears over it, so the bar's ring and shadow fall on the page
    await drawn(() => vi.waitFor(() => expect([world.browser.layer, world.browser.hostRects]).toEqual(["below-host", [{ x: 10, y: 106, width: 370, height: 52, cornerRadius: 0 }]])));
    expect(world.browser.shown).toEqual(full);
    expect(document.documentElement.dataset.alphaBrowserUnder).toBe("");
    expect(["top", "bottom"].map((side) => document.documentElement.style.getPropertyValue(`--alpha-browser-under-${side}`))).toEqual(["104px", "754px"]);
    // spec/app/browser/address.md, "The find bar opens over a shown page": only the bar is Alpha's to touch; beside it and just under it, where its shadow falls, the touch reaches the page
    expect([[200, 130], [5, 130], [385, 130], [200, 170], [200, 600]].map(([x, y]) => pageOwns(world.browser, x ?? 0, y ?? 0))).toEqual([false, true, true, true, true]);

    // spec/app/browser/address.md, "The find bar opens over a shown page": all of the page is Alpha's while Ask Alpha is raised over it
    await drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "raise", detent: "Sheet" }))));
    await drawn(() => vi.waitFor(() => expect([world.browser.layer, world.browser.hostRects]).toEqual(["below-host", [{ x: 0, y: 104, width: 390, height: 650, cornerRadius: 0 }]])));
    await drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "goBack" }, (before) => before.assistant === "Sheet"))));
    await drawn(() => vi.waitFor(() => expect(world.browser.hostRects).toEqual([{ x: 10, y: 106, width: 370, height: 52, cornerRadius: 0 }])));

    await press("Close find in page");
    await until(alpha, page, Page, (p) => !p.finding);
    await drawn(() => vi.waitFor(() => expect([world.browser.layer, world.browser.hostRects]).toEqual(["above-host", []])));
    expect(world.browser.shown).toEqual(full);
    expect(document.documentElement.dataset.alphaBrowserUnder).toBeUndefined();
  });

  async function openFindBelowHost(alpha: Awaited<ReturnType<typeof onBrowser>>["alpha"], runtime: Awaited<ReturnType<typeof onBrowser>>["runtime"], extra?: (node: Element) => DOMRect | undefined) {
    await until(alpha, runtime, Tabs, (s) => s.hydrated);
    layOutNativePage((node) => {
      if (node.hasAttribute("data-alpha-browser-page")) return new DOMRect(0, 104, 390, 650);
      if (node.matches('[role="search"][aria-label="Find in page"]')) return new DOMRect(10, 106, 370, 52);
      return extra?.(node);
    });
    const { page } = await goSecure(alpha, runtime, "news.example/on-device-agents");
    await press("Menu");
    await press("Find in page");
    await until(alpha, page, Page, (p) => p.finding);
  }

  it("Measures Alpha's chrome again while it changes over a page below Alpha (spec/app/browser/address.md, \"The find bar opens over a shown page\")", async () => {
    const { alpha, runtime, world } = await onBrowser(undefined, true);
    await openFindBelowHost(alpha, runtime, (node) =>
      node.matches("[data-host-chrome]") && node.textContent === "Saved" ? new DOMRect(95, 170, 200, 48) : undefined);
    const bar = { x: 10, y: 106, width: 370, height: 52, cornerRadius: 0 };
    await drawn(() => vi.waitFor(() => expect([world.browser.layer, world.browser.hostRects]).toEqual(["below-host", [bar]])));

    // spec/app/browser/address.md, "The find bar opens over a shown page": a toast that appears over the page is Alpha's to touch at once
    await drawn(() => alpha.runtime.runPromise(say("Saved")));
    await drawn(() => vi.waitFor(() => expect(world.browser.hostRects).toEqual([bar, { x: 95, y: 170, width: 200, height: 48, cornerRadius: 0 }])));
    expect(pageOwns(world.browser, 195, 194)).toBe(false);

    // spec/app/browser/address.md, "The find bar opens over a shown page": once it has gone, its place is the page's again
    await later(alpha, 1_900);
    await drawn(() => vi.waitFor(() => expect(world.browser.hostRects).toEqual([bar])));
    expect(pageOwns(world.browser, 195, 194)).toBe(true);
  });

  it("Keeps Home hidden under a page below Alpha (spec/app/browser/address.md, \"The find bar opens over a shown page\")", async () => {
    const { alpha, runtime, world } = await onBrowser();
    await openFindBelowHost(alpha, runtime);
    await drawn(() => vi.waitFor(() => expect(world.browser.layer).toBe("below-host")));
    // spec/app/browser/address.md, "The find bar opens over a shown page": while the page is below, Home's layer is never drawn over it, even as the Browser rises over Home
    const home = document.querySelector("[data-alpha-home-layer]");
    expect(home?.className).toMatch(/(^|\s)(invisible|in-data-\[alpha-browser-under\]:invisible)(\s|$)/);
    expect(document.documentElement.dataset.alphaBrowserUnder).toBe("");
  });

  it('Explains unavailable Android page reading (spec/app/browser/reading.md, "An explicit reading starts from the current committed HTTPS page")', async () => {
    const world = { ...scene(), phone: true, image: true };
    world.browser.readingAvailable = false;
    const { alpha, runtime } = await onHydratedBrowser(world);
    await press("Menu");
    await drawn(() => vi.waitFor(() => expect(document.querySelector("[role='note'][aria-label='Page reading unavailable']")).not.toBeNull()));
    await pressOnTop("Read aloud");
    await until(alpha, runtime, Reader, (state) => state.phase === "Unavailable");
    expect(world.voice.spokenPages).toEqual([]);
  });

  it.each(["normal", "private"] as const)("Reads the selected page aloud through the phone's opaque approval (spec/app/browser/reading.md, \"Story: Hear the page read aloud\") on a %s tab", async (kind) => {
    const world = { ...scene(), phone: true, image: true };
    let reviewOwner: string | undefined;
    let reviewSession: string | undefined;
    world.browser.reviewReading = (page) => {
      expect(page).toMatchObject({ url: "https://example.test/article", execution: "device" });
      reviewOwner = page.ownerId;
      reviewSession = page.sessionId;
      return Promise.resolve({ readingToken: "on-device-review" });
    };
    const { alpha, runtime } = await browserBeside(world);
    await goSecure(alpha, runtime, "https://example.test/article", kind);
    placeNative();
    const readPage = async () => {
      await press("Menu");
      await pressOnTop("Read aloud");
    };
    const speaking = assistant.runtime(alpha);
    const cancellations = () => world.browser.calls.filter((call) => call === "cancelReading").length;
    await readPage();
    await drawn(() => vi.waitFor(() => expect(world.voice.spokenPages).toHaveLength(1)));
    await until(alpha, runtime, Reader, (state) => state.phase === "Idle");
    await until(alpha, speaking, Speaker, (state) => state.stage === "Silent" && !state.retiring);
    if (kind === "private") expect(world.browser.saved.history).not.toContain("https://example.test/article");
    expect(world.voice.spoken).toEqual([]);
    const requestId: unknown = expect.any(String);
    expect(world.voice.spokenPages).toEqual([{ readingToken: "on-device-review", ownerId: reviewOwner, sessionId: reviewSession, requestId }]);
    expect(cancellations()).toBe(1);

    world.voice.holdPagePlayback = true;
    await readPage();
    await until(alpha, speaking, Speaker, (state) => state.text === "Page" && state.stage === "Playing");
    const [earlier, active] = world.voice.spokenPages;
    const emit = world.voice.emitLocal;
    if (!earlier || !active || !emit) throw new Error("Missing native Browser playback");
    expect(active.requestId).not.toBe(earlier.requestId);
    // spec/app/browser/reading.md, "Story: Hear the page read aloud": the native dialog stops its reading without navigation.
    await drawn(() => emit("playbackStopped", { requestId: earlier.requestId }));
    expect(speaking.runSync(Speaker.use((machine) => machine.get())).stage).toBe("Playing");
    expect(cancellations()).toBe(1);
    await drawn(() => emit("playbackStopped", { requestId: active.requestId }));
    await until(alpha, speaking, Speaker, (state) => state.stage === "Silent" && !state.retiring);
    await until(alpha, runtime, Reader, (state) => state.phase === "Idle");
    expect(cancellations()).toBe(2);
  });

  it.each(["normal", "private"] as const)('Reviews and edits a Browser excerpt before putting it in the chat draft (spec/app/browser/reading.md, "Story: Review an excerpt to ask about") on a %s tab', async (kind) => {
    const world = { ...scene(), phone: true, image: true };
    world.browser.pageTitle = (url) => url === "https://example.test/article" ? "Article 123456" : undefined;
    let release: ((text: string) => void) | undefined;
    world.browser.reviewQuestion = () => new Promise((resolve) => { release = (text) => resolve({ text }); });
    const { alpha } = await open(world, only("home", "assistant", "view:Browser"));
    const ask = assistant.runtime(alpha);
    const runtime = browser.runtime(alpha);
    await until(alpha, ask, Composer, (s) => s.slot === "Open");
    const turn = await ask.runPromise(Effect.map(Conversation.use((m) => m.get()), (s) => s.turn.send.id));
    await press("Browser");
    await until(alpha, runtime, Tabs, (s) => s.hydrated);
    await goSecure(alpha, runtime, "https://example.test/article", kind);
    placeNative();
    const openReview = async () => {
      release = undefined;
      await press("Menu");
      await drawn(() => vi.waitFor(() => expect(button("Ask about page")).toBeTruthy()));
      await pressOnTop("Ask about page");
      await until(alpha, runtime, Reader, (s) => s.phase === "Reading");
      await drawn(() => vi.waitFor(() => expect(release).toBeDefined()));
    };
    const dialog = () => document.querySelector("[role='dialog'][aria-label='Ask about selected content']");
    await openReview();
    await hardware("back");
    await until(alpha, runtime, Reader, (s) => s.phase === "Idle");
    await drawn(() => release?.("An earlier page answer."));
    expect(dialog()).toBeNull();

    await openReview();
    await drawn(() => release?.("The original article excerpt."));
    await until(alpha, runtime, Reader, (s) => s.phase === "Reviewing");
    expect(dialog()?.querySelector("[aria-label='Selected source']")?.textContent).toBe("Current page");
    expect(dialog()?.textContent).not.toContain("123456");
    await fill("Question about content", "What does it say?");
    await fill("Content excerpt", "The exact edited excerpt.");
    await press("Add to chat");
    await until(alpha, runtime, Shell, (s) => s.assistant === "Sheet");
    expect(document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message Alpha']")?.value)
      .toBe("What does it say?\n\nSource: Current page\n\nThe exact edited excerpt.");
    expect(await ask.runPromise(Effect.map(Conversation.use((m) => m.get()), (s) => s.turn.send.id))).toBe(turn);
  });

  it.each([false, true])('Opens Password manager and returns through Settings (spec/app/settings/index.md, "The owner can open Password manager from the Browser menu") on phone %s', async (phone) => {
    vi.stubGlobal("indexedDB", memoryIndexedDB());
    onTestFinished(() => { vi.unstubAllGlobals(); });
    const world = { ...scene(), phone, image: phone };
    const { alpha } = await open(world, only("home", "view:Browser", "view:Settings"));
    await until(alpha, home.runtime(alpha), Home, (s) => s.tiles.load.status === "Loaded");
    await press("Browser");
    await until(alpha, browser.runtime(alpha), Tabs, (s) => s.hydrated);
    await press("Menu");
    await press("Password manager");
    await until(alpha, alpha.runtime, Settings, (s) => s.page === "BrowserPasswordsPage");
    if (phone) {
      await drawn(() => vi.waitFor(() => expect(button("Unlock")).toBeDefined()));
      await press("Unlock");
      await drawn(() => vi.waitFor(() => expect(button("Add password")).toBeDefined()));
    } else {
      expect(document.body.textContent).toContain("Proton Pass");
      expect(button("Unlock")).toBeUndefined();
    }
    await press("Back to Settings");
    await until(alpha, alpha.runtime, Settings, (s) => s.page === "Top");
    await drawn(() => vi.waitFor(() => expect(world.settings.passwordsUnlocked).toBe(false)));
    expect(world.settings.opened).toEqual([]);
    await hardware("back");
    expect(document.querySelector('input[aria-label="Search Google or type a URL"]')).not.toBeNull();
  });

  it('Only opens a private HTTPS page after the owner confirms it (spec/app/browser/share.md, "Story: Open the page in another browser")', async () => {
    const { alpha, runtime, world } = await onBrowser(undefined, true);
    await until(alpha, runtime, Tabs, (s) => s.hydrated);
    await press("Menu");
    await press("Find in page");
    await drawn(() => vi.waitFor(() => expect(document.body.textContent).toContain("Load a page before finding text in it.")));
    expect(button("Close find in page")).toBeUndefined();
    await later(alpha, 10000);
    await press("Open externally, passkeys unsupported here");
    await drawn(() => vi.waitFor(() => expect(document.body.textContent).toContain("Load an HTTPS page before opening another browser.")));
    expect(button("Close menu")).toBeDefined();
    expect(world.browser.handedOff).toEqual([]);
    await press("New private tab");
    await until(alpha, runtime, Tabs, (s) => s.privates.length === 1 && s.layer === "Address");
    await drawn(async () => {
      await fill("Address", "enclave.example/keys-in-hardware");
      document.querySelector<HTMLFormElement>("form[role=search]")?.requestSubmit();
    });
    const selected = runtime.runSync(Effect.flatMap(Tabs, (m) => m.get())).selected;
    const page = runtime.runSync(Effect.flatMap(Pages, (pages) => pages.of(selected)));
    await until(alpha, page, Page, (p) => p.phase === "Shown" && p.secure);
    placeNative();
    await press("Menu");
    await press("Open externally, passkeys unsupported here");
    await until(alpha, runtime, Share, (s) => s.handoff.showing);
    expect(document.querySelector("[role=alertdialog]")?.textContent).toContain("Leave private browsing?");
    expect(document.querySelector("[role=alertdialog]")?.textContent).toContain("https://enclave.example/keys-in-hardware");
    expect(world.browser.handedOff).toEqual([]);
    await press("Cancel");
    await until(alpha, runtime, Share, (s) => !s.handoff.showing);
    expect(world.browser.handedOff).toEqual([]);

    await press("Open externally, passkeys unsupported here");
    await until(alpha, runtime, Share, (s) => s.handoff.showing);
    await press("Choose browser");
    await until(alpha, runtime, Share, (s) => s.confirmed && !s.launching);
    expect(world.browser.handedOff.map(({ url, privateConfirmed }) => [url, privateConfirmed])).toEqual([
      ["https://enclave.example/keys-in-hardware", true],
    ]);
  });

  it("Open, pick and close tabs (spec/app/browser/index.md, \"Story: Open, pick and close tabs\"; spec/app/browser/index.md, \"Story: Clear all browsing data\")", async () => {
    const { alpha, runtime, world } = await onBrowser();
    await until(alpha, runtime, Tabs, (s) => s.hydrated);
    await go("news.example/on-device-agents");
    // spec/app/browser/index.md, "A new tab, normal or private, opens on top while fewer than eight are open"
    await press("Menu");
    await press("New private tab");
    await until(alpha, runtime, Tabs, (s) => s.open.length === 2 && s.privates.length === 1 && s.layer === "Address");
    expect(document.querySelector("[aria-label='Address suggestions']")?.textContent).not.toContain("/on-device-agents");
    // spec/app/browser/address.md, "A tab with no page says \"Search or address\" in its bar, a private tab as a normal one, and only the private mark tells them apart"
    await press("Cancel editing");
    await until(alpha, runtime, Tabs, (s) => s.layer === "Uncovered");
    expect([button(/^Edit address/)?.textContent, Boolean(button(/^Edit address/)?.querySelector("[aria-label='Private tab']"))]).toEqual(["Edit addressSearch or address", true]);
    await press(/^Edit address/);
    await until(alpha, runtime, Tabs, (s) => s.layer === "Address");
    await drawn(async () => {
      await fill("Address", "enclave.example/keys-in-hardware");
      document.querySelector<HTMLFormElement>("form[role=search]")?.requestSubmit();
    });
    await until(alpha, runtime, Tabs, (s) => s.native.length === 2);
    expect([...world.browser.tabs.values()].map((one) => one.private)).toEqual([false, true]);
    // spec/app/browser/index.md, "Picking another open tab shows it and uncovers the page"
    await press(/^Tabs\b/);
    await until(alpha, runtime, Tabs, (s) => s.layer === "Switcher");
    const selected = document.querySelector<HTMLButtonElement>("button[aria-current=true]");
    if (!selected) throw new Error("no active tab card");
    await drawn(() => selected.click());
    await until(alpha, runtime, Tabs, (s) => s.layer === "Uncovered" && s.privates.includes(s.selected));
    await press(/^Tabs\b/);
    await until(alpha, runtime, Tabs, (s) => s.layer === "Switcher");
    const original = [...document.querySelectorAll("button")].find((control) => control.textContent?.startsWith("The case for on-device agents"));
    if (!original) throw new Error("no original tab card");
    await drawn(() => original.click());
    await until(alpha, runtime, Tabs, (s) => s.layer === "Uncovered" && s.selected === s.open[0]);
    // spec/app/browser/index.md, "Closing a tab closes its native tab, shows another open tab if it was the one shown, and leaves one new tab when it was the last"
    await press(/^Tabs\b/);
    await press("Close The case for on-device agents");
    await until(alpha, runtime, Tabs, (s) => s.open.length === 1 && s.selected === s.privates[0]);
    expect(world.browser.tabs.size).toBe(1);
    // spec/app/browser/index.md, "Cleared data takes every normal tab and the saved session with it, and keeps the private tabs"
    await hardware("back");
    // spec/app/browser/index.md, "Clearing is asked for from the Library's history, and confirmed or cancelled"
    await askResetBrowserData(alpha, runtime);
    await press("Clear data");
    await until(alpha, runtime, Tabs, (s) => s.erasing === "Kept" && s.privates.length === 1 && s.kept.length === 0);
  });

  it('Hides the native page while Clear browsing data is open (spec/app/browser/index.md, "Story: Clear all browsing data")', async () => {
    layOutNativePage(new DOMRect(0, 52, 390, 680));
    const { alpha, runtime, world } = await onBrowser();
    await until(alpha, runtime, Tabs, (s) => s.hydrated);
    const { tab } = await goSecure(alpha, runtime, "news.example/on-device-agents");
    await expect.poll(() => world.browser.shown?.id).toBe(`tab${tab}`);
    await askResetBrowserData(alpha, runtime);
    await expect.poll(() => world.browser.shown).toBeUndefined();
    await press("Cancel");
    await until(alpha, runtime, Tabs, (s) => s.erasing === "Kept");
    await expect.poll(() => world.browser.shown?.id).toBe(`tab${tab}`);
  });

  it("Open the page in another browser (spec/app/browser/share.md, \"Story: Open the page in another browser\")", async () => {
    const { alpha, runtime, world } = await onBrowser();
    await until(alpha, runtime, Tabs, (s) => s.hydrated);
    world.browser.failing.set("plain.example", "insecure");
    world.browser.failing.set("down.example", "unreachable");
    // spec/app/browser/share.md, "Only an unreachable HTTPS address makes a failed page leave, and only from a normal tab": an http-only site has no way out.
    await go("plain.example");
    const page = selectedPage(runtime);
    await until(alpha, page, Page, (p) => p.phase === "Failed");
    expect(button("Open in browser")).toBeUndefined();

    await go("down.example/today");
    await until(alpha, page, Page, (p) => p.phase === "Failed");
    const offer = button("Open in browser");
    const place = document.querySelector("[data-alpha-browser-page]");
    expect(offer !== undefined && place !== null && (offer.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    await press("Open in browser");
    await until(alpha, page, Page, () => world.browser.elsewhere.length === 1);
    expect(world.browser.elsewhere).toEqual(["https://down.example/today"]);

    // spec/app/browser/share.md, "The next load of the page ends the offer for a failed page"
    world.browser.failing.clear();
    await go("news.example/on-device-agents");
    await until(alpha, page, Page, (p) => p.phase === "Shown");
    expect(button("Open in browser")).toBeUndefined();
  });

  it("Email the page, as v121 did (spec/app/browser/share.md, \"Choosing where to send the page sends it once, if it is still the page the panel opened on, and closes the panel\"; spec/app/inbox/suggestion.md, \"Alpha suggests text only for a draft; the owner hands text over from elsewhere in Alpha into a draft, a new reply or a new email; either replaces an offer not yet used\")", async () => {
    const world = { ...scene(), phone: true, image: true };
    const { alpha } = await open(world, only("home", "notice", "view:Browser", "view:Inbox"));
    await until(alpha, home.runtime(alpha), Home, (h) => h.tiles.load.status === "Loaded");
    const letters = inbox.runtime(alpha);
    await readInboxFirst(alpha, letters);
    await press("Browser");
    const runtime = browser.runtime(alpha);
    await until(alpha, runtime, Tabs, (s) => s.hydrated);
    await go("news.example/on-device-agents");
    await until(alpha, selectedPage(runtime), Page, (p) => p.phase === "Shown");
    await press("Menu");
    await press("Email this page");
    // spec/app/inbox/suggestion.md, "Only the owner is shown it, against the draft as it is now; showing it again after the draft changed shows it against the change": the link waits in Inbox for the owner's review.
    await until(alpha, letters, Offering, (s) => s.text !== 0);
    const offered = letters.runSync(Effect.flatMap(Offering, (machine) => machine.get()));
    expect(letters.runSync(Effect.map(Offers, (offers) => offers.text(offered.text)))).toBe("https://news.example/on-device-agents");
    expect(world.inbox.drafts.size).toBe(0);
  });

  it("Let my agent read the page I have open in Browser (spec/app/assistant/context.md, \"Story: Let my agent read the page I have open in Browser\")", async () => {
    const running = await askingOnBrowser();
    const { alpha, runtime } = running;
    layOutNativePage(new DOMRect(0, 64, 412, 700));
    await go("news.example/on-device-agents");
    const tab = selectedTab(runtime);
    await until(alpha, selectedPage(runtime, tab), Page, (p) => p.phase === "Shown");

    // spec/app/assistant/context.md, "A turn carries the page Browser hands it for the tab in front, beside the observation, only to a peer that declares it"
    const shown = await ask(running, "Summarize this page");
    expect(shown?.observation?.view).toBe("browser");
    /** eliza binds the page to the tab the observation selects: the same session-qualified tab id and revision. */
    const selected = shown?.observation?.selectedObject;
    expect(selected?.kind).toBe("browser-tab");
    expect(selected?.id).toMatch(new RegExp(`:tab${tab}$`));
    expect(shown?.browserPage).toMatchObject({ url: "https://news.example/on-device-agents", tabId: selected?.id, revision: selected?.revision });
    expect(shown?.browserPage?.text).toContain("agent");

    // spec/app/browser/reading.md, "A question asked while Browser is the open screen reads the tab in front once, only when it is a normal tab whose HTTPS page has committed and Browser page for Alpha is on"
    await press("Menu");
    await press("New private tab");
    await until(alpha, runtime, Tabs, (s) => s.privates.includes(s.selected));
    await go("news.example/on-device-agents");
    await until(alpha, selectedPage(runtime), Page, (p) => p.phase === "Shown");
    expect((await ask(running, "Summarize this page"))?.browserPage).toBeUndefined();
  });

  it("History is kept through a restart (spec/app/browser/library.md, \"Story: Look back through history\"; spec/app/browser/index.md, \"Story: Save the session\")", async () => {
    const first = await onBrowser();
    await until(first.alpha, first.runtime, Tabs, (s) => s.hydrated);
    await go("enclave.example/keys-in-hardware");
    await until(first.alpha, selectedPage(first.runtime), Page, (p) => p.phase === "Shown");
    // spec/app/browser/index.md, "A stale session is written once it has been read, one write at a time, and never while browsing data is being cleared": the session written keeps history.
    await until(first.alpha, first.runtime, Tabs, (s) => !s.stale && first.world.browser.saved.history[0] === "https://enclave.example/keys-in-hardware");
    const kept = [...first.world.browser.saved.history];
    expect(kept.length).toBeGreaterThan(0);

    await closeAll();
    const again = await onBrowser(first.world);
    await until(again.alpha, again.runtime, Tabs, (s) => s.hydrated);
    expect(again.runtime.runSync(Effect.flatMap(Pages, (pages) => pages.history())).map((row) => row.url)).toEqual(kept);
  });

  it(`The agent's page opens only on my Open on the Browser's card, even an address I typed, and a card left from an earlier request never opens (spec/app/browser/index.md, "Story: Let the agent open a page"; spec/app/browser/index.md, "The agent opens only an HTTPS address with no user name or password in it, in a new normal tab, one at a time"; spec/app/browser/index.md, "The agent gives its tab up when it is done"; spec/app/assistant/index.md, "A complete reply may open one view, once, while the screen it was asked from still shows")`, async () => {
    const world = { ...scene(), phone: true, image: true };
    const { alpha, ask, runtime } = await askingBeside(world);
    const refused = { action: "BROWSER_OPEN", data: { actionName: "BROWSER_OPEN", code: "DEVICE_BROWSER_NOT_REQUESTED" } };
    const asked = async (text: string, url?: string, refusedAfter = false) => {
      world.ask.nextReplyChunks = [url === undefined ? "Sure." : "It's on your screen to open."];
      world.ask.nextActions = (metadata) => [...(url === undefined ? [] : [openAction(url, metadata)]), ...(refusedAfter ? [refused] : [])];
      await sendFromComposer(alpha, ask, text);
    };
    const front = () => committedAddress(runtime, world.browser.tabs);

    const shown = async () => (await runtime.runPromise(Effect.flatMap(Tabs, (t) => t.get())));
    await asked("open example.com and open http://example.com:8080", "https://example.com/", true);
    await drawn(() => vi.waitFor(async () => expect(showing(await alpha.runtime.runPromise(Effect.flatMap(Shell, (sh) => sh.get())), "Browser")).toBe(true)));
    await drawn(() => vi.waitFor(() => expect(button("Open")).toBeDefined()));
    expect(document.body.textContent).toContain("example.com");
    const typed = await shown();
    await later(alpha, 500);
    expect([(await shown()).open.length, (await shown()).agent, [...world.browser.tabs.values()].some((tab) => tab.history[tab.at] === "https://example.com/")]).toEqual([typed.open.length, 0, false]);
    await press("Open");
    await drawn(() => vi.waitFor(() => expect(button("Open")).toBeUndefined()));
    await drawn(() => vi.waitFor(async () => expect(await front()).toBe("https://example.com/"), { timeout: 10_000 }));

    await asked("open the Wikipedia article about the Eiffel Tower", "https://en.wikipedia.org/wiki/Eiffel_Tower");
    await drawn(() => vi.waitFor(() => expect(button("Open")).toBeDefined()));
    const before = (await shown()).open.length;
    await press("Cancel");
    await drawn(() => vi.waitFor(() => expect(button("Open")).toBeUndefined()));
    expect((await shown()).open.length).toBe(before);

    const eiffel = "https://en.wikipedia.org/wiki/Eiffel_Tower";
    await asked("open the Wikipedia article about the Eiffel Tower", eiffel);
    await drawn(() => vi.waitFor(() => expect(button("Open")).toBeDefined()));
    await asked("open example.org", "https://example.org/");
    /** The operation cards' text: the owner's own words name example.org too, so the test waits for a card itself to name the newer page. */
    const card = () => [...document.querySelectorAll("[aria-label='Operation details']")].map((details) => details.textContent ?? "");
    await drawn(() => vi.waitFor(() => expect(card().some((text) => text.includes("example.org"))).toBe(true)));
    expect(document.body.textContent).not.toContain("en.wikipedia.org/wiki/Eiffel_Tower");
    await press("Open");
    await drawn(() => vi.waitFor(async () => expect(await front()).toBe("https://example.org/"), { timeout: 10_000 }));
    expect(button("Open")).toBeUndefined();

    await asked("open the Wikipedia article about the Eiffel Tower", eiffel);
    await drawn(() => vi.waitFor(() => expect(button("Open")).toBeDefined()));
    await asked("thanks");
    const settled = (await shown()).open.length;
    await press("Open");
    await drawn(() => vi.waitFor(() => expect(button("Open")).toBeUndefined()));
    await later(alpha, 500);
    expect([(await shown()).open.length, await front()]).toEqual([settled, "https://example.org/"]);

    await asked("open the Wikipedia article about the Eiffel Tower", eiffel);
    await drawn(() => vi.waitFor(() => expect(button("Open")).toBeDefined()));
    await press("Open");
    await drawn(() => vi.waitFor(async () => expect(await front()).toBe("https://en.wikipedia.org/wiki/Eiffel_Tower"), { timeout: 10_000 }));

    const tabs = () => [...world.browser.tabs.values()].map((one) => one.history[one.at]);
    const kept = tabs();
    await asked("open https://owner:secret@example.org", "https://owner:secret@example.org/");
    await later(alpha, 500);
    expect(button("Open")).toBeUndefined();
    await drawn(() => vi.waitFor(async () => expect(await front()).toBe("https://en.wikipedia.org/wiki/Eiffel_Tower")));
    expect(tabs()).toEqual(kept);
  });

  it(`After I open the agent's page, my next question takes that page with it (spec/app/browser/index.md, "Story: Let the agent open a page"; spec/app/browser/reading.md, "A question asked while Browser is the open screen reads the tab in front once, only when it is a normal tab whose HTTPS page has committed and Browser page for Alpha is on"; spec/app/assistant/context.md, "A turn carries the page Browser hands it for the tab in front, beside the observation, only to a peer that declares it")`, async () => {
    layOutNativePage(new DOMRect(0, 120, 390, 600));
    const world = { ...scene(), phone: true, image: true };
    const { alpha, ask, runtime } = await askingBeside(world);
    const url = "https://example.com/";
    const asked = async (text: string, page?: string) => {
      world.ask.nextReplyChunks = [page === undefined ? "It is an example domain." : "It's on your screen to open."];
      world.ask.nextActions = (metadata) => page === undefined ? [] : [openAction(page, metadata)];
      await sendFromComposer(alpha, ask, text);
    };
    const front = () => committedAddress(runtime, world.browser.tabs);

    await asked("Open example.com", url);
    await drawn(() => vi.waitFor(() => expect(button("Open")).toBeDefined()));
    await press("Open");
    await drawn(() => vi.waitFor(async () => expect(await front()).toBe(url), { timeout: 10_000 }));
    world.ask.metadata = [];
    await asked("Summarize this page.");
    const told = world.ask.metadata.at(-1) as { observation?: { view?: string }; browserPage?: { url?: string; title?: string; text?: string } } | undefined;
    expect(told?.observation?.view).toBe("browser");
    expect(told?.browserPage).toEqual(expect.objectContaining({ url, title: "example.com" }));
    expect(told?.browserPage?.text).toContain("Example");
  });

  async function askEnrolledProposal(options: {
    proposalId: string;
    url: string;
    prompt: string;
    reply: string;
    waitPrefs?: (s: { document: { read: { status: string } }; askFirst: boolean }) => boolean;
    directRequest: boolean;
    forced?: boolean;
    waitCard: boolean;
  }) {
    const world = { ...scene(), phone: true, image: true };
    const review = textReview(world.notes.owner, options.proposalId, { type: "browser_navigate", url: options.url });
    world.telephony.textReview = review;
    const { alpha } = await open(world, only("home", "assistant", "view:Browser"));
    const ask = assistant.runtime(alpha);
    const runtime = browser.runtime(alpha);
    await until(alpha, ask, Conversation, (s) => s.ready);
    if (options.waitPrefs) await until(alpha, alpha.runtime, Preferences, options.waitPrefs);
    await press("Open conversation");
    await until(alpha, alpha.runtime, Shell, (s) => s.assistant === "Sheet");
    const front = () => committedAddress(runtime, world.browser.tabs);
    const reads = review.pendingReads;
    world.ask.nextReplyChunks = [options.reply];
    world.ask.nextActions = (_, capabilities) => (options.directRequest
      ? askedPage(review, `m${world.ask.said.length}u`, options.forced ? ["browser.open-direct.v1"] : capabilities)
      : [{
        action: "PROPOSE_DEVICE_ACTION",
        data: { proposalId: options.proposalId, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true },
      }]);
    await fill("Message Alpha", options.prompt);
    await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
    await press("Send");
    if (options.waitCard) {
      await until(alpha, ask, Conversation, (s) => review.pendingReads > reads && s.turn.reply === "Complete");
      await drawn(() => vi.waitFor(() => expect(button("Open")).toBeDefined()));
    }
    return { world, review, alpha, front };
  }

  it(`On an enrolled phone, the agent's page proposal opens in Browser only on Open in Ask Alpha's card (spec/app/browser/index.md, "Story: Let the agent open a page"; spec/app/browser/index.md, "The agent opens only an HTTPS address with no user name or password in it, in a new normal tab, one at a time")`, async () => {
    const url = "https://en.wikipedia.org/wiki/Eiffel_Tower";
    const { world, review, alpha, front } = await askEnrolledProposal({
      proposalId: "page-open",
      url,
      prompt: "Open the Wikipedia article about the Eiffel Tower",
      reply: "Review this request on your phone before it can run.",
      directRequest: false,
      waitCard: true,
    });
    expect(document.body.textContent).toContain("en.wikipedia.org/wiki/Eiffel_Tower");
    expect(review.decisions).toEqual([]);
    expect([...world.browser.tabs.values()].some((tab) => tab.history[tab.at] === url)).toBe(false);

    await press("Open");
    await vi.waitFor(() => expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied", operationId: "page-open" })]), { timeout: 10_000 });
    expect(showing(await alpha.runtime.runPromise(Effect.flatMap(Shell, (sh) => sh.get())), "Browser")).toBe(true);
    await drawn(() => vi.waitFor(async () => expect(await front()).toBe(url), { timeout: 10_000 }));
  });

  it(`A page my whole message asked for opens at once, with no card, and Ask Alpha lowers to its bar over it; a page I did not ask for whole still waits for my Open (spec/app/browser/index.md, "A page the owner's whole message asked for opens at once, typed or spoken, and any other page waits for the owner's Open"; spec/app/shell/index.md, "A page the agent opens in Browser lowers Ask Alpha to its bar"; spec/app/browser/index.md, "The agent opens only an HTTPS address with no user name or password in it, in a new normal tab, one at a time")`, async () => {
    const world = { ...scene(), phone: true, image: true };
    const { alpha, ask, runtime } = await askingBeside(world);
    await until(alpha, alpha.runtime, Preferences, (s) => s.document.read.status === "Loaded" && !s.askFirst);
    const front = () => committedAddress(runtime, world.browser.tabs);
    const shell = () => alpha.runtime.runPromise(Effect.flatMap(Shell, (sh) => sh.get()));
    const asked = async (text: string, url: string, atOnce: boolean) => {
      world.ask.nextReplyChunks = ["Opening it."];
      world.ask.nextActions = (metadata) => [openAction(url, metadata, atOnce)];
      await sendFromComposer(alpha, ask, text);
    };
    await asked("Open https://www.alphacompute.ai/ in Browser.", "https://www.alphacompute.ai/", true);
    await drawn(() => vi.waitFor(async () => expect(await front()).toBe("https://www.alphacompute.ai/"), { timeout: 10_000 }));
    expect(button("Open")).toBeUndefined();
    await until(alpha, alpha.runtime, Shell, (s) => showing(s, "Browser") && s.assistant === "Bar");

    await press("Open conversation");
    await until(alpha, alpha.runtime, Shell, (s) => s.assistant === "Sheet");
    await asked("open the Wikipedia article about the Eiffel Tower", "https://en.wikipedia.org/wiki/Eiffel_Tower", false);
    await drawn(() => vi.waitFor(() => expect(button("Open")).toBeDefined()));
    await later(alpha, 500);
    expect([await front(), (await shell()).assistant]).toEqual(["https://www.alphacompute.ai/", "Sheet"]);
    await press("Open");
    await drawn(() => vi.waitFor(async () => expect(await front()).toBe("https://en.wikipedia.org/wiki/Eiffel_Tower"), { timeout: 10_000 }));
    await until(alpha, alpha.runtime, Shell, (s) => showing(s, "Browser") && s.assistant === "Bar");
  });

  it(`On an enrolled phone, a page proposal my whole message asked for opens at once through the approvals path, with no card, and Ask Alpha lowers to its bar (spec/app/browser/index.md, "A page the owner's whole message asked for opens at once, typed or spoken, and any other page waits for the owner's Open"; spec/app/shell/index.md, "A page the agent opens in Browser lowers Ask Alpha to its bar")`, async () => {
    const url = "https://www.alphacompute.ai/";
    const { review, alpha, front } = await askEnrolledProposal({
      proposalId: "page-asked",
      url,
      prompt: "Open https://www.alphacompute.ai/ in Browser.",
      reply: "Opening alphacompute.ai.",
      waitPrefs: (s) => s.document.read.status === "Loaded" && !s.askFirst,
      directRequest: true,
      waitCard: false,
    });
    await vi.waitFor(() => expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied", operationId: "page-asked" })]), { timeout: 10_000 });
    await drawn(() => vi.waitFor(async () => expect(await front()).toBe(url), { timeout: 10_000 }));
    expect(button("Open")).toBeUndefined();
    await until(alpha, alpha.runtime, Shell, (s) => showing(s, "Browser") && s.assistant === "Bar");
  });

  const askingFirst = [
    { name: "Ask before Alpha acts is on", kept: JSON.stringify({ askFirst: true, images: true, shares: [] }), status: "Loaded" },
    { name: "the phone could not read the preferences", kept: "not the owner's choices", status: "Failed" },
  ] as const;

  // spec/app/browser/index.md, "A page the owner's whole message asked for opens at once, typed or spoken, and any other page waits for the owner's Open"; spec/app/settings/preferences.md, "Ask before Alpha acts covers the agent's actions on the web, with the camera, in Photos and Files, its reading of the latest texter's number and its text drafts"
  it.each(askingFirst)("While $name, a page my whole message asked for waits for my Open on the Browser's card and Ask Alpha stays up (spec/app/browser/index.md, \"A page the owner's whole message asked for opens at once, typed or spoken, and any other page waits for the owner's Open\"; spec/app/settings/preferences.md, \"Ask before Alpha acts covers the agent's actions on the web, with the camera, in Photos and Files, its reading of the latest texter's number and its text drafts\")", async ({ kept, status }) => {
    localStorage.setItem("alpha.preferences", kept);
    onTestFinished(() => localStorage.removeItem("alpha.preferences"));
    const world = { ...scene(), phone: true, image: true };
    const { alpha, ask, runtime } = await askingBeside(world);
    await until(alpha, alpha.runtime, Preferences, (s) => s.document.read.status === status && s.askFirst);
    const url = "https://www.alphacompute.ai/";
    const front = () => committedAddress(runtime, world.browser.tabs);
    world.ask.nextReplyChunks = ["Opening it."];
    world.ask.nextActions = (metadata) => [openAction(url, metadata, true)];
    await sendFromComposer(alpha, ask, "Open https://www.alphacompute.ai/ in Browser.");
    await drawn(() => vi.waitFor(() => expect(button("Open")).toBeDefined()));
    await later(alpha, 500);
    expect(await front()).not.toBe(url);
    expect((await alpha.runtime.runPromise(Effect.flatMap(Shell, (sh) => sh.get()))).assistant).not.toBe("Bar");
    await press("Open");
    await drawn(() => vi.waitFor(async () => expect(await front()).toBe(url), { timeout: 10_000 }));
  });

  /** Each way the agent may answer while the phone asks first: as it grounds the turn the phone sent, or still marked to run at once, as for a turn sent before asking first came on. */
  const askingFirstAnswers = askingFirst.flatMap((one) => [
    { ...one, answer: "as the agent grounds it", forced: false },
    { ...one, answer: "even marked to run at once", forced: true },
  ]);

  // spec/app/browser/index.md, "A page the owner's whole message asked for opens at once, typed or spoken, and any other page waits for the owner's Open"; spec/app/settings/preferences.md, "Ask before Alpha acts covers the agent's actions on the web, with the camera, in Photos and Files, its reading of the latest texter's number and its text drafts"
  it.each(askingFirstAnswers)("On an enrolled phone while $name, a page proposal my whole message asked for, $answer, runs only on Open in Ask Alpha's card (spec/app/browser/index.md, \"A page the owner's whole message asked for opens at once, typed or spoken, and any other page waits for the owner's Open\"; spec/app/settings/preferences.md, \"Ask before Alpha acts covers the agent's actions on the web, with the camera, in Photos and Files, its reading of the latest texter's number and its text drafts\")", async ({ kept, status, forced }) => {
    localStorage.setItem("alpha.preferences", kept);
    onTestFinished(() => localStorage.removeItem("alpha.preferences"));
    const url = "https://www.alphacompute.ai/";
    const { world, review, alpha, front } = await askEnrolledProposal({
      proposalId: "page-asked",
      url,
      prompt: "Open https://www.alphacompute.ai/ in Browser.",
      reply: "Opening alphacompute.ai.",
      waitPrefs: (s) => s.document.read.status === status && s.askFirst,
      directRequest: true,
      forced,
      waitCard: true,
    });
    await later(alpha, 500);
    expect(review.receipts).toEqual([]);
    expect([...world.browser.tabs.values()].some((tab) => tab.history[tab.at] === url)).toBe(false);

    await press("Open");
    await vi.waitFor(() => expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied", operationId: "page-asked" })]), { timeout: 10_000 });
    await drawn(() => vi.waitFor(async () => expect(await front()).toBe(url), { timeout: 10_000 }));
  });

  // spec/app/browser/address.md, "Story: Watch a page load"; spec/app/browser/address.md, "Reload loads a shown, failed or stopped page again"
  it("Toggles desktop site per native tab from the Browser menu", async () => {
    const { world, runtime } = await openHydratedPhoneBrowser();
    await go("example.com");
    await vi.waitFor(async () => expect(await committedAddress(runtime, world.browser.tabs)).toBe("https://example.com"));
    const firstTab = (await runtime.runPromise(Effect.flatMap(Tabs, (model) => model.get()))).selected;
    const firstId = `tab${firstTab}`;
    expect(world.browser.tabs.get(firstId)?.desktop).toBe(false);

    await press("Menu");
    await pressOnTop("Request desktop site");
    await vi.waitFor(() => expect(world.browser.tabs.get(firstId)?.desktop).toBe(true));
    await vi.waitFor(async () => expect(await committedAddress(runtime, world.browser.tabs)).toBe("https://example.com"));

    await press("Menu");
    expect(button("Request mobile site")).toBeDefined();
    await pressOnTop("Request mobile site");
    await vi.waitFor(() => expect(world.browser.tabs.get(firstId)?.desktop).toBe(false));
    expect(world.browser.calls.filter((call) => call === "setDesktopSite")).toHaveLength(2);
  });

  it('Opens explicit IPv4 web addresses and refuses invalid ports (spec/app/browser/address.md, "Text that is too long, or names a user or a password, is refused; an http or https address opens when it has a host; anything else is a search unless it reads as a host")', async () => {
    expect([
      verdict(inputOf("http://127.0.0.1")),
      verdict(inputOf("https://1.1.1.1")),
      verdict(inputOf("http://192.168.1.1:8080/status")),
      verdict(inputOf("127.0.0.1")),
      verdict(inputOf("https://example.com:99999")),
      verdict(inputOf("https://[::::]")),
    ]).toEqual(["Open", "Open", "Open", "Search", "Refuse", "Refuse"]);
    const { alpha, runtime, world } = await onBrowser();
    await until(alpha, runtime, Tabs, (s) => s.hydrated);
    await go("http://127.0.0.1");
    const page = selectedPage(runtime);
    await until(alpha, page, Page, (p) => p.phase === "Shown");
    expect([...world.browser.tabs.values()].map((one) => one.history[one.at])).toEqual(["http://127.0.0.1"]);
  });

  it('Advances the find-in-page match indicator on Next match (spec/app/browser/address.md, "Story: Find in page")', async () => {
    const { alpha, runtime } = await onBrowser();
    await until(alpha, runtime, Tabs, (s) => s.hydrated);
    await go("news.example/on-device-agents");
    const page = selectedPage(runtime);
    await until(alpha, page, Page, (p) => p.phase === "Shown");
    await press("Menu");
    await press("Find in page");
    await until(alpha, page, Page, (p) => p.finding);
    await fill("Find in page", "the");
    await until(alpha, page, Page, (p) => p.find.status === "Loaded" && p.matches > 1);
    const total = page.runSync(Page.use((m) => m.get())).matches;
    expect(document.body.textContent).toContain(`1 of ${total}`);
    await press("Next match");
    await expect.poll(() => document.body.textContent).toContain(`2 of ${total}`);
  });

  it('Does not create a native tab when load is refused on a non-selected tab (spec/app/browser/index.md, "A tab gets its native tab when it is the one shown and loads a page, and loses it if Android cannot make one")', async () => {
    const { alpha, runtime, world } = await onBrowser();
    await until(alpha, runtime, Tabs, (s) => s.hydrated);
    const first = selectedTab(runtime);
    await press("Menu");
    await press("New tab");
    await until(alpha, runtime, Tabs, (s) => s.open.length === 2 && s.selected !== first);
    const page = runtime.runSync(Effect.flatMap(Pages, (pages) => pages.of(first)));
    await runtime.runPromise(Effect.flatMap(Pages, (pages) => pages.aim(first, "https://news.example/on-device-agents")));
    await page.runPromise(Page.use((m) => m.send({ type: "submit", i: inputOf("https://news.example/on-device-agents") })));
    await until(alpha, page, Page, (p) => p.phase !== "Loading");
    expect([page.runSync(Page.use((m) => m.get())).phase, world.browser.tabs.has(`tab${first}`)]).toEqual(["Failed", false]);
  });

  it('Keeps Library history in sync with normal visits and Clear all browsing data (spec/app/browser/library.md, "Clearing all browsing data empties history at once"; spec/app/browser/library.md, "A page that commits in a normal tab is counted in history, which keeps the newest hundred")', async () => {
    const { alpha, runtime } = await onBrowser();
    await until(alpha, runtime, Tabs, (s) => s.hydrated);
    await press("Menu");
    await press("Library, bookmarks and history");
    await until(alpha, runtime, Library, (s) => s.read.status === "Loaded" && s.history === 3);
    await hardware("back");
    await go("https://alpha.example/fresh-visit");
    const tab = selectedTab(runtime);
    const page = selectedPage(runtime, tab);
    await until(alpha, page, Page, (p) => p.phase === "Shown");
    await until(alpha, runtime, Library, (s) => s.history === 4);
    await askClearAll(alpha, runtime, "Cancel");
    expect(runtime.runSync(Library.use((m) => m.get())).history).toBe(4);
    await askClearAll(alpha, runtime, "Clear data");
    await until(alpha, runtime, Library, (s) => s.history === 0);
    expect(runtime.runSync(Effect.map(TabHost, (host) => host.session.info(`tab${tab}`)))).toBeUndefined();
  });

  // spec/app/browser/reading.md, "Story: Review an excerpt to ask about"; spec/app/browser/reading.md, "The latest reading gives the page's excerpt to review, or finds the page may be sensitive and refuses it, or fails"
  it("Retries a transient empty Browser excerpt capture within the turn budget before giving up", async () => {
    const world = { ...scene(), phone: true, image: true };
    let attempts = 0;
    world.browser.reviewQuestion = () => {
      attempts += 1;
      return Promise.resolve({ text: attempts === 1 ? "" : "Settled article body after retry." });
    };
    const { alpha, runtime } = await browserBeside(world);
    await go("https://example.test/article", "normal");
    const tab = runtime.runSync(Tabs.use((tabs) => tabs.get())).selected;
    const page = runtime.runSync(Effect.flatMap(Pages, (pages) => pages.of(tab)));
    await until(alpha, page, Page, (state) => state.phase === "Shown" && state.secure);
    placeNative();
    await press("Menu");
    await drawn(() => vi.waitFor(() => expect(button("Ask about page")).toBeTruthy()));
    await pressOnTop("Ask about page");
    await later(alpha, 250);
    await until(alpha, runtime, Reader, (s) => s.phase === "Reviewing");
    expect(attempts).toBe(2);
    expect(document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Content excerpt']")?.value).toBe("Settled article body after retry.");
  });
});
