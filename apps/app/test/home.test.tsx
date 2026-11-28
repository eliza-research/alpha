// @vitest-environment happy-dom
import { digestInbox, type DigestResult, hostedDigestProtocol } from "@elizaos/plugin-workflow-client";
import { Effect } from "effect";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import * as Home from "../gen/app__home.effect.vibe";
import * as Drawer from "../gen/app__home__drawer.effect.vibe";
import { Machine as DigestSchedules } from "../gen/app__digests__schedules.effect.vibe";
import { Machine as WorkflowList } from "../gen/app__workflows__list.effect.vibe";
import * as Cards from "../gen/app__home__cards.effect.vibe";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import { Machine as Canvas } from "../gen/app__shell__keyboard.effect.vibe";
import { Machine as Layers } from "../gen/app__shell__layers.effect.vibe";
import { Machine as Toasts } from "../gen/app__notices__toasts.effect.vibe";
import home from "../src/home/index.tsx";
import type { Alpha } from "../src/runtime/area.tsx";
import { button, closeAll, drawn, fill, hardware, later, only, open, press, seen, underAct, until } from "./alpha.tsx";
import { memoryIndexedDB } from "./fakes/indexeddb.ts";
import { scene, type Scene } from "./fakes/scene.ts";
import { agentEvent } from "./fakes/calendar.ts";
import { actInApps, chooseApp, closeApps, openApps, told } from "../src/home/home.vibe";
import { savedKey, written } from "../src/home/saved.vibe";
import { waiting } from "../src/home/waiting.vibe";
import { fromAreas } from "../src/home/cards.vibe";
import { MessagingBridge } from "../src/messaging/bridge.vibe";
import { digestScope } from "../src/workflows/brief.vibe";
import workflows from "../src/workflows/index.tsx";
import type { NativeDigestScene, WorkflowsScene } from "./fakes/workflows.ts";

underAct();
afterEach(closeAll);

const tiles = () => [...document.querySelectorAll("nav[aria-label='Apps on Home'] [data-home-tile]")].map((tile) => tile.getAttribute("data-home-tile"));
const tileButton = (id: string) => document.querySelector<HTMLButtonElement>(`[data-home-tile="${id}"]`);
const toast = () => document.querySelector("[role=status]")?.textContent;
const held = (name: string) => button(name)?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
const pointer = (type: string, clientX: number, clientY: number) => new PointerEvent(type, { bubbles: true, isPrimary: true, pointerId: 1, button: 0, clientX, clientY });
const pulled = (startY = 68, dx = 0) => drawn(() => {
  const zone = document.querySelector("h1")?.parentElement;
  zone?.dispatchEvent(pointer("pointerdown", 100, startY));
  zone?.dispatchEvent(pointer("pointerup", 100 + dx, startY + 80));
});
const alphaApps = ["view:Inbox", "view:Telegram", "view:Slack", "view:Calendar", "view:Clock", "view:Reminders", "view:Browser", "view:Camera", "view:Photos", "view:Maps", "view:Notes", "view:Files", "view:Workflows", "view:Wallet", "view:Settings"];
const homeOrder = ["view:Phone", "view:Messages", "view:Inbox", "view:Telegram", "view:Slack", "view:Calendar", "view:Clock", "view:Reminders", "view:Browser", "view:Camera", "view:Photos", "view:Maps", "view:Notes", "view:Contacts", "view:Files", "view:Workflows", "view:Wallet", "view:Settings"];
const holdingHome = (world: Scene) => {
  world.settings.roles = world.settings.roles.map((role) => role.role === "home" ? { ...role, held: true, holders: ["ai.alphacompute.alphaphone"] } : role);
  return world;
};

const digestResult = (cursor: number, status: string, output: string): DigestResult => {
  const at = new Date(cursor * 3_600_000).toISOString();
  return { cursor, runId: `run-${cursor}`, workflowId: "workflow", workflowVersionId: "version", templateVersion: "template",
    scheduledAt: at, startedAt: at, completedAt: at, source: {}, status, output, error: null };
};

function keepDigests(alpha: Alpha, scope: string, entries: readonly DigestResult[]) {
  let acknowledged = false;
  const agent = hostedDigestProtocol((path) => Effect.sync(() => {
    if (path.endsWith("/ack")) { acknowledged = true; return {}; }
    return { entries: acknowledged ? [] : entries };
  }));
  return alpha.runtime.runPromise(Effect.flatMap(digestInbox(scope), (inbox) => inbox.sync(agent, 1)));
}

describe("Home on a phone", () => {
  // spec/app/home/index.md, "Story: Start Home"; spec/app/home/index.md, "Story: Keep my apps on Home"; spec/app/home/index.md, "Story: Edit Home"
  it("Start Home, keep my apps on it and edit it (spec/app/home/index.md, \"Story: Start Home\"; spec/app/home/index.md, \"Story: Keep my apps on Home\"; spec/app/home/index.md, \"Story: Edit Home\")", async () => {
    const world = holdingHome({ ...scene(), phone: true });
    const first = await open(world, only("home"));
    const { alpha } = first;
    const homes = home.runtime(alpha);

    // spec/app/home/index.md, "Startup says once per run how Alpha is presented, and Home then reads its saved tiles"; spec/app/home/index.md, "The Apps tile and Apps drawer are suppressed on Home": with nothing saved Home shows Alpha's own apps that this phone admits, without an Apps tile.
    await until(alpha, homes, Home.Machine, (h) => h.host === "AsLauncher" && h.tiles.load.status === "Loaded");
    expect([tiles(), Boolean(button("Apps"))]).toEqual([alphaApps, false]);

    // spec/app/home/tiles.md, "Only Phone, Messages, Inbox, Telegram and Slack carry a badge, only when something waits there, and no tile does while Home is being edited"
    await drawn(() => {
      waiting.tell("Inbox", "3 unread");
      waiting.tell("Notes", "1 shared");
    });
    expect([button("Inbox3 unread") !== undefined, button("Telegram") !== undefined, button("Slack") !== undefined, button("Wallet") !== undefined, button("Notes") !== undefined]).toEqual([true, true, true, true, true]);

    // spec/app/home/index.md, "A long press on bare Home or beside the quiet landscape Ask sheet starts editing, only on the phone and once the tiles are read"
    await drawn(() => button("Notes")?.dispatchEvent(pointer("pointerdown", 80, 330)));
    await drawn(() => button("Notes")?.dispatchEvent(pointer("pointermove", 80, 352)));
    await later(alpha, 450);
    expect((await homes.runPromise(Home.Machine.use((m) => m.get()))).editing).toBe(false);
    await drawn(() => button("Notes")?.dispatchEvent(pointer("pointerdown", 80, 330)));
    await later(alpha, 450);
    await until(alpha, homes, Home.Machine, (h) => h.editing);
    await drawn(() => button("Notes")?.dispatchEvent(pointer("pointerup", 80, 330)));
    expect(button("Inbox") !== undefined).toBe(true);

    // spec/app/home/index.md, "A tile on Home is removed or moved only while Home is being edited"; spec/app/home/index.md, "Every change is sent whole to be saved under its number, and nothing else is ever saved"
    await press("Remove Notes");
    await until(alpha, homes, Home.Machine, (h) => h.tiles.save.outcome === "Confirmed");
    expect(tiles()).toEqual(alphaApps.filter((tile) => tile !== "view:Notes"));

    await press("Remove Clock");
    await until(alpha, homes, Home.Machine, (h) => h.tiles.save.outcome === "Confirmed" && h.tiles.save.id === 2);
    await press("Remove Reminders");
    await until(alpha, homes, Home.Machine, (h) => h.tiles.save.outcome === "Confirmed" && h.tiles.save.id === 3);

    // spec/app/home/index.md, "While editing, Add to Home lists Alpha's own apps that this phone admits and Home does not hold, and opens only if there is one"
    await press("Add to Home");
    await until(alpha, homes, Home.Machine, (h) => h.adding);
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Add to Home"));
    await press("Notes");
    await until(alpha, homes, Home.Machine, (h) => h.adding && h.tiles.save.outcome === "Confirmed" && h.tiles.save.id === 4);
    expect(tiles().at(-1)).toBe("view:Notes");
    // spec/app/home/index.md, "Add to Home adds one of Alpha's own apps it lists"
    await press("Clock");
    await until(alpha, homes, Home.Machine, (h) => h.adding && h.tiles.save.outcome === "Confirmed" && h.tiles.save.id === 5);
    await press("Reminders");
    // spec/app/home/index.md, "Add to Home closes once there is nothing left to add"
    await until(alpha, homes, Home.Machine, (h) => !h.adding && h.tiles.save.outcome === "Confirmed" && h.tiles.save.id === 6);
    const added = ["view:Notes", "view:Clock", "view:Reminders"];
    expect(tiles().slice(-added.length)).toEqual(added);

    // spec/app/home/index.md, "Back closes one layer of Home's own: Add to Home, then editing; Done ends editing"
    await hardware("back");
    await until(alpha, homes, Home.Machine, (h) => !h.editing);
    expect(Boolean(button("Done"))).toBe(false);
    await drawn(() => {
      waiting.tell("Telegram", "2 unread");
      waiting.tell("Slack", "1 mention");
    });
    expect([button("Telegram2 unread") !== undefined, button("Slack1 mention") !== undefined]).toEqual([true, true]);

    // spec/app/home/index.md, "A restart forgets everything but its numbers, which keep rising, so nothing asked before it can answer after it": the tiles come back as they were saved.
    await first.close();
    const second = await open(world, only("home"));
    await until(second.alpha, home.runtime(second.alpha), Home.Machine, (h) => h.tiles.load.status === "Loaded" && h.tiles.load.ticket === 2);
    expect(tiles().slice(-added.length)).toEqual(added);

    // spec/app/shell/index.md, "Phone and Messages exist only on an Alpha image, and Contacts only where that image admits it": the same saved tiles on an Alpha image that grants contacts show Phone, Messages and Contacts in Home order too.
    await second.close();
    const third = await open({ ...world, image: true }, only("home"));
    await until(third.alpha, home.runtime(third.alpha), Home.Machine, (h) => h.tiles.load.status === "Loaded" && h.tiles.load.ticket === 3);
    expect(tiles()).toEqual([...homeOrder.filter((tile) => !added.includes(tile)), ...added]);

    // spec/app/home/tiles.md, "What was saved comes back as it was saved, an empty Home included; with no record Home shows its defaults"
    await third.close();
    localStorage.setItem(savedKey, "{invalid");
    const recovered = await open(world, only("home"));
    await until(recovered.alpha, home.runtime(recovered.alpha), Home.Machine, (h) => h.tiles.load.status === "Failed");
    expect([tiles(), localStorage.getItem(savedKey)]).toEqual([alphaApps, "{invalid"]);
  });

  it('Keeps my existing Clock and Reminders pins on the phone (spec/app/home/tiles.md, "What was saved comes back as it was saved, an empty Home included; with no record Home shows its defaults")', async () => {
    const chosen = written([{ tag: "Own", view: "Reminders" }, { tag: "Own", view: "Clock" }, { tag: "Own", view: "Notes" }]);
    localStorage.setItem(savedKey, chosen);
    const world = holdingHome({ ...scene(), phone: true });
    const { alpha } = await open(world, only("home"));
    await until(alpha, home.runtime(alpha), Home.Machine, (state) => state.host === "AsLauncher" && state.tiles.load.status === "Loaded");
    expect([tiles(), localStorage.getItem(savedKey)]).toEqual([["view:Reminders", "view:Clock", "view:Notes"], chosen]);
  });

  it.each([false, true])("Opens an app or Apps beside the landscape Ask sheet with coarse pointer %s (spec/app/home/index.md, \"An Alpha tile beside the landscape Ask sheet opens its app and lowers Ask Alpha to rest\"; spec/app/shell/index.md, \"Apps can open beside the landscape Ask sheet and Close leaves Ask open\")", async (coarse) => {
    const pointer = window.matchMedia("(pointer: coarse)");
    Object.defineProperty(pointer, "matches", { configurable: true, value: coarse });
    const originalMatch = window.matchMedia.bind(window);
    const media = vi.spyOn(window, "matchMedia").mockImplementation((query) => query === "(pointer: coarse)" ? pointer : originalMatch(query));
    const width = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const height = Object.getOwnPropertyDescriptor(window, "innerHeight");
    onTestFinished(() => {
      media.mockRestore();
      if (width) Object.defineProperty(window, "innerWidth", width);
      if (height) Object.defineProperty(window, "innerHeight", height);
    });
    const world = holdingHome({ ...scene(), phone: true });
    const clock = "org.fixture.clock/org.fixture.clock.Main";
    localStorage.setItem(savedKey, written([{ tag: "Own", view: "Notes" }, { tag: "Installed", app: clock }]));
    const { alpha } = await open(world, only("home", "assistant", "view:Notes", "view:Workflows"));
    const rotate = async (landscape: boolean) => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: landscape ? 844 : 390 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: landscape ? 390 : 844 });
      await drawn(() => window.dispatchEvent(new Event("resize")));
      await until(alpha, alpha.runtime, Canvas, (state) => state.landscape === landscape);
    };
    await rotate(true);
    const homes = home.runtime(alpha);
    const dialog = () => document.querySelector('[data-alpha-apps-drawer]');
    const chat = () => document.querySelector('[data-alpha-detent="sheet"]');
    await until(alpha, homes, Home.Machine, (state) => state.installed.read.status === "Loaded");
    await press("Open conversation");
    await until(alpha, alpha.runtime, Shell, (state) => state.assistant === "Sheet");
    expect(tileButton("view:Notes")?.closest("[inert]")).toBeNull();
    expect(button("Apps")).toBeUndefined();
    // spec/app/home/index.md, "A favorite on bare Home or beside the landscape Ask sheet opens the installed app and leaves Ask where it is"
    expect(tileButton(`app:${clock}`)?.closest("[inert]")).toBeNull();
    await drawn(() => tileButton(`app:${clock}`)?.click());
    await vi.waitFor(() => expect(world.launcher.opened).toEqual(["org.fixture.clock"]));
    await until(alpha, homes, Home.Machine, (state) => state.handoff.attempt.outcome === "Confirmed");
    expect(chat()).not.toBeNull();

    await alpha.runtime.runPromise(Layers.use((layers) => layers.send({ type: "openLayer", id: "review", kind: "DialogLayer", covers: true })));
    await until(alpha, alpha.runtime, Layers, (state) => state.open.length === 1);
    expect(tileButton("view:Notes")?.closest("[inert]")).not.toBeNull();
    expect(tileButton(`app:${clock}`)?.closest("[inert]")).not.toBeNull();
    await press("Notes");
    await drawn(() => tileButton(`app:${clock}`)?.click());
    expect(world.launcher.opened).toEqual(["org.fixture.clock"]);
    expect(await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).toMatchObject({ trail: [], drawer: false, assistant: "Sheet" });
    await alpha.runtime.runPromise(Layers.use((layers) => layers.send({ type: "closeLayer", id: "review" })));
    await until(alpha, alpha.runtime, Layers, (state) => state.open.length === 0);

    // spec/app/home/index.md, "The Apps tile and Apps drawer are suppressed on Home"
    const routeBefore = (await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).route;
    await homes.runPromise(openApps(routeBefore, true));
    expect((await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).drawer).toBe(false);

    await alpha.runtime.runPromise(Shell.use((shell) => shell.send({ type: "openDrawerBeside", phone: true, landscapePhone: true })));
    await until(alpha, alpha.runtime, Shell, (state) => state.drawer && state.assistant === "Sheet");
    expect(dialog()).toBeNull();
    const drawerRoute = (await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).route;
    await homes.runPromise(actInApps(drawerRoute, true, { type: "search", query: "clock", open: true }));
    await until(alpha, homes, Drawer.Machine, (state) => state.query === "clock");

    await rotate(false);
    await homes.runPromise(closeApps(drawerRoute, true));
    expect((await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).drawer).toBe(true);
    expect(chat()).not.toBeNull();
    await rotate(true);
    expect((await homes.runPromise(Drawer.Machine.use((state) => state.get()))).query).toBe("clock");
    await homes.runPromise(closeApps(drawerRoute, true));
    await until(alpha, alpha.runtime, Shell, (state) => !state.drawer && state.assistant === "Sheet");
    expect(dialog()).toBeNull();
    expect(chat()).not.toBeNull();

    await alpha.runtime.runPromise(Shell.use((shell) => shell.send({ type: "openDrawerBeside", phone: true, landscapePhone: true })));
    await until(alpha, alpha.runtime, Shell, (state) => state.drawer && state.assistant === "Sheet");
    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (state) => state.drawer && state.assistant === "Bar");
    expect(dialog()).toBeNull();
    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (state) => !state.drawer && state.assistant === "Bar");

    await press("Open conversation");
    await until(alpha, alpha.runtime, Shell, (state) => state.assistant === "Sheet");
    // spec/app/home/index.md, "A long press on bare Home or beside the quiet landscape Ask sheet starts editing, only on the phone and once the tiles are read"
    await drawn(() => held("Notes"));
    await vi.waitFor(() => expect(button("Done")).toBeDefined());
    await rotate(false);
    expect(button("Done")).toBeUndefined();
    await rotate(true);
    await vi.waitFor(() => expect(button("Done")).toBeDefined());
    await press("Remove Clock");
    await vi.waitFor(() => expect(tiles()).toEqual(["view:Notes"]));
    expect(chat()).not.toBeNull();
    // spec/app/home/index.md, "While editing, Add to Home lists Alpha's own apps that this phone admits and Home does not hold, and opens only if there is one"
    const add = () => [...document.querySelectorAll('[role="dialog"]')].find((node) => node.querySelector("h2")?.textContent === "Add to Home");
    await press("Add to Home");
    await vi.waitFor(() => expect(add()).toBeDefined());
    expect(chat()?.closest("[inert]")).toBeNull();
    await rotate(false);
    await vi.waitFor(() => expect(add()).toBeUndefined());
    await until(alpha, homes, Home.Machine, (state) => !state.adding);
    await rotate(true);
    await vi.waitFor(() => expect(button("Add to Home")?.disabled).toBe(false));
    await press("Add to Home");
    await vi.waitFor(() => expect(add()).toBeDefined());
    await hardware("back");
    await vi.waitFor(() => expect(add()).toBeUndefined());
    expect(chat()).not.toBeNull();
    await vi.waitFor(() => expect(button("Add to Home")?.disabled).toBe(false));
    await press("Add to Home");
    await vi.waitFor(() => expect(button("Files")).toBeDefined());
    await press("Files");
    await vi.waitFor(() => expect(tiles()).toEqual(["view:Notes", "view:Files"]));
    await hardware("back");
    await vi.waitFor(() => expect(add()).toBeUndefined());
    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (state) => state.assistant === "Bar");
    expect(button("Done")).toBeDefined();
    await hardware("back");
    await vi.waitFor(() => expect(button("Done")).toBeUndefined());

    await press("Open conversation");
    await until(alpha, alpha.runtime, Shell, (state) => state.assistant === "Sheet");
    await press("Notes");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.at(-1) === "Notes" && state.assistant === "Bar");
    expect(document.querySelector("[data-alpha-detent=sheet]")).toBeNull();

    // spec/app/home/cards.md, "A Workflows or Brief card beside the landscape Ask sheet opens Workflows from the same Home visit"
    await hardware("home");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.length === 0 && state.assistant === "Bar");
    await press("Open conversation");
    await until(alpha, alpha.runtime, Shell, (state) => state.assistant === "Sheet");
    const workflow = () => [...document.querySelectorAll<HTMLButtonElement>("section[aria-label='Your day'] > button")]
      .find((card) => card.textContent?.startsWith("Desk check"));
    await vi.waitFor(() => expect(workflow()?.disabled).toBe(false));
    expect(workflow()?.closest("[inert]")).toBeNull();
    await drawn(() => workflow()?.click());
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.at(-1) === "Workflows" && state.assistant === "Bar");
    expect(chat()).toBeNull();
    await vi.waitFor(() => expect(button("Add to Workflows")).toBeDefined());
    expect(world.workflows.admissions).toEqual([]);
  });

  it('Suppresses the Apps tile and drawer UI while keeping underlying drawer rules intact (spec/app/home/index.md, "Story: Find an installed app in Apps"; spec/app/home/drawer.md, "Story: Find an installed app by name")', async () => {
    const world = { ...scene(), phone: true };
    const { alpha } = await open(world, only("home", "assistant"));
    const homes = home.runtime(alpha);
    const dialog = () => document.querySelector('[role="dialog"][aria-label="Apps"]');
    await until(alpha, homes, Home.Machine, (h) => h.host === "AsApp" && h.tiles.load.status === "Loaded");
    expect((await homes.runPromise(Home.Machine.use((m) => m.get()))).installed.read.status).toBe("Idle");
    expect(button("Apps")).toBeUndefined();

    const route0 = (await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).route;
    await homes.runPromise(openApps(route0, false));
    expect((await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).drawer).toBe(false);

    await alpha.runtime.runPromise(Shell.use((shell) => shell.send({ type: "openDrawer", phone: true })));
    await until(alpha, homes, Home.Machine, (h) => h.installed.read.status === "Loaded");
    expect(dialog()).toBeNull();

    const route1 = (await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).route;
    await homes.runPromise(actInApps(route1, false, { type: "search", query: "fíxture.clock", open: true }));
    await until(alpha, homes, Drawer.Machine, (state) => state.query === "fíxture.clock");
    await homes.runPromise(actInApps(route1, false, { type: "openApp", app: "org.fixture.clock/org.fixture.clock.Main", now: 0 }));
    await vi.waitFor(() => expect(world.launcher.opened).toEqual(["org.fixture.clock"]));

    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (state) => !state.drawer);
    await until(alpha, homes, Drawer.Machine, (state) => state.query === "");

    await alpha.runtime.runPromise(Shell.use((shell) => shell.send({ type: "openDrawer", phone: true })));
    await until(alpha, alpha.runtime, Shell, (state) => state.drawer);
    expect(dialog()).toBeNull();

    // spec/app/shell/index.md, "Back closes one layer: Ask Alpha by a step, then the app on top": Ask Alpha stays above the drawer and leaves first.
    await press("Open conversation");
    await until(alpha, alpha.runtime, Shell, (state) => state.drawer && state.assistant === "Sheet");
    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (state) => state.drawer && state.assistant === "Bar");
    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (state) => !state.drawer);

    await alpha.runtime.runPromise(Shell.use((shell) => shell.send({ type: "openDrawer", phone: true })));
    await until(alpha, alpha.runtime, Shell, (state) => state.drawer);
    await hardware("home");
    await until(alpha, alpha.runtime, Shell, (state) => !state.drawer && state.trail.length === 0);
    expect(dialog()).toBeNull();
  });

  // spec/app/home/tiles.md, "Home's defaults use the product's Home order, and Home holds at most 4096 tiles"; spec/app/home/index.md, "The Apps tile and Apps drawer are suppressed on Home"
  it('Shows Telegram, Slack and Wallet on Home by default without an Apps tile and opens them directly (spec/app/home/tiles.md, "Home\'s defaults use the product\'s Home order, and Home holds at most 4096 tiles"; spec/app/home/index.md, "The Apps tile and Apps drawer are suppressed on Home")', async () => {
    const world = { ...scene(), phone: true };
    world.telegram.enabled = true;
    const { alpha } = await open(world, only("home", "assistant", "view:Telegram", "view:Slack", "view:Wallet"));
    const homes = home.runtime(alpha);
    await until(alpha, homes, Home.Machine, (h) => h.tiles.load.status === "Loaded");
    expect(tiles()).toContain("view:Telegram");
    expect(tiles()).toContain("view:Slack");
    expect(tiles()).toContain("view:Wallet");
    expect(Boolean(button("Telegram"))).toBe(true);
    expect(Boolean(button("Slack"))).toBe(true);
    expect(Boolean(button("Wallet"))).toBe(true);
    expect(Boolean(button("Apps"))).toBe(false);

    await press("Telegram");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.at(-1) === "Telegram");
    await vi.waitFor(() => expect(document.querySelector("[data-alpha-telegram-auth]")?.textContent).toContain("Sign in to Telegram"));
    await hardware("home");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.length === 0);
    await press("Wallet");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.at(-1) === "Wallet");
    await hardware("home");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.length === 0);
    await press("Slack");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.at(-1) === "Slack");
  });

  it('Keeps underlying native app menu, App info and pin rules intact while Apps drawer UI is suppressed (spec/app/home/drawer.md, "Story: Act on an installed app from its menu")', async () => {
    const world = { ...scene(), phone: true };
    const { alpha } = await open(world, only("home"));
    const homes = home.runtime(alpha);
    const clockKey = "org.fixture.clock/org.fixture.clock.Main";

    await until(alpha, homes, Home.Machine, (state) => state.host === "AsApp" && state.tiles.load.status === "Loaded");
    expect(button("Apps")).toBeUndefined();
    await alpha.runtime.runPromise(Shell.use((shell) => shell.send({ type: "openDrawer", phone: true })));
    await until(alpha, homes, Home.Machine, (state) => state.installed.read.status === "Loaded");
    expect(document.querySelector('[role="dialog"][aria-label="Apps"]')).toBeNull();

    const route1 = (await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).route;
    await homes.runPromise(actInApps(route1, false, { type: "openMenu", app: clockKey, open: true, listed: [clockKey] }));
    await until(alpha, homes, Drawer.Machine, (state) => state.menu === clockKey);
    await hardware("back");
    await until(alpha, homes, Drawer.Machine, (state) => state.menu === "");
    expect((await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).drawer).toBe(true);
    expect(world.launcher.opened).toEqual([]);

    await homes.runPromise(actInApps(route1, false, { type: "openMenu", app: clockKey, open: true, listed: [clockKey] }));
    await until(alpha, homes, Drawer.Machine, (state) => state.menu === clockKey);
    await homes.runPromise(chooseApp(clockKey, "Info", route1, false));
    await until(alpha, homes, Home.Machine, (state) => state.handoff.ask.tag === "AppInfo" && state.handoff.attempt.outcome === "Confirmed");
    await until(alpha, homes, Drawer.Machine, (state) => state.menu === "");
    expect([world.launcher.infos, world.launcher.opened]).toEqual([["org.fixture.clock"], []]);

    await homes.runPromise(actInApps(route1, false, { type: "openMenu", app: clockKey, open: true, listed: [clockKey] }));
    await until(alpha, homes, Drawer.Machine, (state) => state.menu === clockKey);
    await homes.runPromise(chooseApp(clockKey, "Pin", route1, false));
    await until(alpha, homes, Home.Machine, (state) => state.tiles.save.outcome === "Confirmed");
    await until(alpha, alpha.runtime, Shell, (state) => !state.drawer);
    expect(tiles()).toContain(`app:${clockKey}`);
  });

  const agendaScene = (calendars: { id: string; name: string }[], events: { id: string; calendarId: string; title: string; startHour: number; endHour: number }[]) => {
    const hour = 3_600_000;
    const day = 10 * 86_400_000;
    const world = { ...scene(), phone: true, now: day + 8 * hour };
    world.calendar.granted = true;
    world.calendar.calendars.push(...calendars.map((c) => ({ ...c, writable: true, local: true })));
    world.calendar.phoneEvents = events.map((e) => ({
      id: e.id, calendarId: e.calendarId, title: e.title, begin: day + e.startHour * hour, end: day + e.endHour * hour, allDay: false, recurring: false,
    }));
    return { world, day, hour };
  };

  // spec/app/home/cards.md, "Story: See my day at a glance"; spec/app/home/cards.md, "Story: The agenda card"; spec/app/home/cards.md, "Story: Open my day from a card"
  it("See my day at a glance and open it from a card (spec/app/home/cards.md, \"Story: See my day at a glance\"; spec/app/home/cards.md, \"Story: The agenda card\"; spec/app/home/cards.md, \"Story: Open my day from a card\")", async () => {
    const { world, day, hour } = agendaScene(
      [{ id: "1", name: "Work" }, { id: "2", name: "Family" }],
      [
        { id: "a", calendarId: "1", title: "Standup", startHour: 10, endHour: 11 },
        { id: "b", calendarId: "2", title: "Dentist", startHour: 9, endHour: 10 },
      ],
    );
    const { alpha } = await open(world);
    const homes = home.runtime(alpha);
    const agenda = () => document.querySelector<HTMLButtonElement>("button[aria-label^='Open calendar event:'], button[aria-label^='Open overdue reminder:']");
    const time = (offset: number) => new Date(day + offset * hour).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    // spec/app/home/cards.md, "When Home shows and when Alpha comes back to the front, Home asks again for every calendar not read today that is not already being read"; spec/app/home/cards.md, "The card leads with an overdue reminder, then the item that begins first; of two alike, the first read"
    await until(alpha, homes, Cards.Machine, (c) => c.calendar.source === "Ready" && c.calendar.items.length === 2);
    expect(agenda()?.getAttribute("aria-label")).toMatch(/^Open calendar event: Dentist,/);
    expect(agenda()?.textContent).toContain(`${time(9)} – `);
    expect(agenda()?.textContent).toContain(time(10));

    // spec/app/home/cards.md, "The agenda draws on both calendars and the reminders saved on the phone, leaving out a calendar Calendar hides and a reminder already done"
    await drawn(() => fromAreas.hidden([2]));
    expect(agenda()?.getAttribute("aria-label")).toMatch(/^Open calendar event: Standup,/);
    await drawn(() => fromAreas.reminders([{ due: day + 7 * hour, overdue: true, done: false, title: "Call the bank" }, { due: day, overdue: true, done: true, title: "Paid rent" }]));
    // spec/app/home/cards.md, "Under an overdue reminder the card also names the next item that is not overdue, so the reminder never hides it"
    expect(agenda()?.textContent).toMatch(/^Overdue reminderCall the bank.*Standup/);

    // spec/app/home/cards.md, "The Telegram and Slack cards show unread and mention counts with up to two preview rows, marked not up to date when stale, and are not drawn when disconnected or with nothing unread"
    const bridge = alpha.runtime.runSync(MessagingBridge);
    await drawn(() => {
      bridge.publishHomeCard("Telegram", { connected: true, unread: 2, mentions: 1, rows: [{ title: "Alex", detail: "See you at 5" }], current: true });
      bridge.publishHomeCard("Slack", { connected: true, unread: 0, mentions: 0, rows: [{ title: "#design", detail: "Quiet" }], current: true });
    });
    expect(Boolean(button("Open Telegram: Telegram · 2 unread · 1 @"))).toBe(true);
    expect(Boolean(button("Open Slack: Slack · 0 unread"))).toBe(false);

    // spec/app/home/cards.md, "A card opens its app: the agenda Calendar, Messages and Phone their own, mail Inbox, Telegram and Slack their own, the brief and Workflows Workflows; the agenda asks its calendar again if the last read did not succeed"
    await drawn(() => agenda()?.click());
    await until(alpha, alpha.runtime, Shell, (s) => s.trail.at(-1) === "Calendar");
    await drawn(() => { fromAreas.reminders([]); fromAreas.hidden([]); });
  });

  it('Keeps no place for cards while none is drawn, so the tiles never jump (spec/app/home/cards.md, "The row holds the agenda, Messages, Phone, Workflows, mail, Telegram, Slack and brief cards in that order, each only when drawn, and is not drawn when none is")', async () => {
    const world = holdingHome({ ...scene(), phone: true });
    world.calendar.silent = true;
    world.workflows.prompts.clear();
    world.workflows.tasks.splice(0);
    world.inbox.mail.splice(0);
    const { alpha } = await open(world, only("home"));
    const homes = home.runtime(alpha);
    await until(alpha, homes, Home.Machine, (h) => h.tiles.load.status === "Loaded");
    expect([(await homes.runPromise(Cards.Machine.use((cards) => cards.get()))).agent.source, document.querySelectorAll("section[aria-label='Your day'] button").length]).toEqual(["Unanswered", 0]);
    const scroller = document.querySelector("h1")?.parentElement?.parentElement;
    const parts = [...(scroller?.children ?? [])].map((part) => part.querySelector("h1") ? "heading" : part.querySelector("[data-home-tile]") ? "tiles" : part.getAttribute("aria-hidden") === "true" ? "space" : "other");
    const aboveTiles = parts.slice(0, parts.indexOf("tiles"));
    expect([aboveTiles[0], aboveTiles.filter((part) => part === "space")]).toEqual(["heading", ["space"]]);
  });

  // spec/app/home/cards.md, "Story: See my day at a glance"
  it("See my day as it is where I am, west of UTC and east of it (spec/app/home/cards.md, \"Story: See my day at a glance\")", async () => {
    const hour = 3_600_000;
    const agenda = () => document.querySelector<HTMLButtonElement>("button[aria-label^='Open calendar event:']");
    const dated = (at: number) => new Date(at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    // spec/app/home/cards.md, "Story: See my day at a glance": Home tells the day as it is where the owner is, west of UTC after its midnight as well as east of it. The agenda card heads its event with the owner's day and tells its time in the owner's zone, so the UTC day ("Mon, Nov 23" on Tuesday the 24th in Los Angeles) is never drawn. Each place is opened later than the last, as a restart keeps the day it last read.
    const zone = process.env.TZ;
    const day = 10 * 86_400_000;
    const seenThere: Array<{ readonly card: string | undefined; readonly utcDay: boolean }> = [];
    const wanted: string[][] = [];
    const allDay: string[] = [];
    /** A phone at `at` in time zone `where`, whose Work calendar holds `events`. */
    const phoneThere = (where: string, at: number, events: Scene["calendar"]["phoneEvents"]) => {
      process.env.TZ = where;
      const there = { ...scene(), phone: true, now: at };
      there.calendar.granted = true;
      there.calendar.calendars.push({ id: "1", name: "Work", writable: true, local: true });
      there.calendar.phoneEvents = events;
      return there;
    };
    try {
      for (const [where, at] of [["Asia/Tokyo", day - 3 * hour], ["UTC", day + 8 * hour], ["America/Los_Angeles", day + 18 * hour]] as const) {
        const opened = await open(phoneThere(where, at, [{ id: "a", calendarId: "1", title: "Standup", begin: at + 2 * hour, end: at + 3 * hour, allDay: false, recurring: false }]), only("home"));
        await until(opened.alpha, home.runtime(opened.alpha), Cards.Machine, (c) => c.calendar.source === "Ready" && c.calendar.items.length === 1);
        await drawn(() => undefined);
        const utcMidnight = Math.floor(at / 86_400_000) * 86_400_000;
        const utcDays = [dated(utcMidnight), new Date(utcMidnight).toLocaleDateString([], { weekday: "long", day: "numeric" })];
        seenThere.push({ card: agenda()?.textContent ?? undefined, utcDay: dated(utcMidnight) !== dated(at) && utcDays.some((shown) => (document.body.textContent ?? "").includes(shown)) });
        wanted.push(["Standup", dated(at + 2 * hour), new Date(at + 2 * hour).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: where })]);
        await opened.close();
      }
      // spec/app/home/cards.md, "An item stays on the card until it ends: a timed item through its last minute, an all-day item until its day is over, an overdue reminder until it is handled": an all-day event is the owner's date, as v121 read it. In Tokyo at 06:00 on the 11th (UTC still the 10th) yesterday's all-day event has ended; in Los Angeles at 18:00 on the 11th (UTC already the 12th) today's has not.
      localStorage.clear();
      for (const [where, at] of [["Asia/Tokyo", day - 3 * hour], ["America/Los_Angeles", day + 26 * hour]] as const) {
        const opened = await open(phoneThere(where, at, [
          { id: "y", calendarId: "1", title: "Moving day", begin: day - 86_400_000, end: day, allDay: true, recurring: false },
          { id: "t", calendarId: "1", title: "Holiday", begin: day, end: day + 86_400_000, allDay: true, recurring: false },
          { id: "n", calendarId: "1", title: "Trip", begin: day + 86_400_000, end: day + 2 * 86_400_000, allDay: true, recurring: false },
        ]), only("home"));
        await until(opened.alpha, home.runtime(opened.alpha), Cards.Machine, (c) => c.calendar.source === "Ready" && c.calendar.items.length === 3);
        await drawn(() => undefined);
        allDay.push(agenda()?.getAttribute("aria-label") ?? "");
        await opened.close();
      }
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
    expect(seenThere.map(({ card, utcDay }, at) => [wanted[at]?.every((part) => card?.includes(part)) ?? false, utcDay])).toEqual(seenThere.map(() => [true, false]));
    const owners = new Date(1970, 0, 11).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    expect(allDay).toEqual([`Open calendar event: Holiday, ${owners}, All day`, `Open calendar event: Holiday, ${owners}, All day`]);
  });

  it('Agenda advances once an event ends and a partial agent feed keeps prior titles (spec/app/home/cards.md, "An item stays on the card until it ends: a timed item through its last minute, an all-day item until its day is over, an overdue reminder until it is handled"; spec/app/home/cards.md, "An answer replaces what the calendar had; one whose access is off or has no account leaves nothing behind, and one that failed, could not reach it or ran out keeps what was read before, as not up to date")', async () => {
    const { world, hour } = agendaScene(
      [{ id: "1", name: "Work" }],
      [
        { id: "b", calendarId: "1", title: "Dentist", startHour: 9, endHour: 10 },
        { id: "a", calendarId: "1", title: "Standup", startHour: 10, endHour: 11 },
      ],
    );
    const startOfDay = new Date(world.now);
    startOfDay.setHours(0, 0, 0, 0);
    const utcNextDay = Date.UTC(startOfDay.getFullYear(), startOfDay.getMonth(), startOfDay.getDate() + 1);
    const holidayEnds = startOfDay.getTime() + 48 * hour;
    const designReviewBegin = startOfDay.getTime() + 74 * hour;
    world.calendar.phoneEvents.push({
      id: "c", calendarId: "1", title: "Holiday", begin: utcNextDay, end: utcNextDay + 24 * hour, allDay: true, recurring: false,
    });
    world.calendar.feedState = "complete";
    world.calendar.events = [
      agentEvent("Design Review", designReviewBegin, designReviewBegin + hour),
    ];
    const { alpha } = await open(world, only("home"));
    const homes = home.runtime(alpha);
    const agenda = () => document.querySelector<HTMLButtonElement>("button[aria-label^='Open calendar event:'], button[aria-label^='Open overdue reminder:']");
    await until(alpha, homes, Cards.Machine, (c) => c.calendar.source === "Ready" && c.agent.source === "Ready");
    expect(agenda()?.getAttribute("aria-label")).toMatch(/^Open calendar event: Dentist,/);

    await later(alpha, 2 * hour);
    expect(agenda()?.getAttribute("aria-label")).toMatch(/^Open calendar event: Dentist,/);
    await later(alpha, 1);
    await vi.waitFor(() => expect(agenda()?.getAttribute("aria-label")).toMatch(/^Open calendar event: Standup,/));

    await later(alpha, 1 * hour);
    await vi.waitFor(() => expect(agenda()?.getAttribute("aria-label")).toMatch(/^Open calendar event: Holiday,/));

    await later(alpha, holidayEnds - world.now - 1);
    expect(agenda()?.getAttribute("aria-label")).toMatch(/^Open calendar event: Holiday,/);
    await later(alpha, 1);
    await vi.waitFor(() => expect(agenda()?.getAttribute("aria-label")).toMatch(/^Open calendar event: Design Review,/));

    world.calendar.feedState = "partial";
    world.calendar.events = [
      agentEvent("Partial Wrong Title", designReviewBegin, designReviewBegin + hour),
    ];
    await later(alpha, 24 * hour);
    await until(alpha, homes, Cards.Machine, (c) => c.agent.source === "Unavailable");
    expect(agenda()?.getAttribute("aria-label")).toMatch(/^Open calendar event: Design Review,/);
  });

  it('Inline drawer notice clears when the drawer closes or retrying succeeds (spec/app/home/index.md, "A notice shows as a toast on bare Home and in the edit bar while editing")', async () => {
    const world = { ...scene(), phone: true };
    world.launcher.refusing.set("org.fixture.clock", "disabled");
    const { alpha } = await open(world, only("home"));
    const homes = home.runtime(alpha);
    await until(alpha, homes, Home.Machine, (h) => h.tiles.load.status === "Loaded");
    await alpha.runtime.runPromise(Shell.use((shell) => shell.send({ type: "openDrawer", phone: true })));
    await until(alpha, homes, Home.Machine, (h) => h.installed.read.status === "Loaded");
    const drawerRoute = (await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).route;
    await homes.runPromise(actInApps(drawerRoute, false, { type: "openApp", app: "org.fixture.clock/org.fixture.clock.Main", now: 0 }));
    await until(alpha, homes, Home.Machine, (h) => h.handoff.attempt.outcome === "Refused");
    await vi.waitFor(() => expect(told.snapshot()).toMatchObject({ place: "InDrawer", notice: { tag: "TellNotOpened" } }));

    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (s) => !s.drawer);
    await vi.waitFor(() => expect(told.snapshot()).toBeUndefined());
  });

  // spec/app/home/cards.md, "Story: The other cards"; spec/app/home/cards.md, "Story: Open my day from a card"
  it("See what waits in my apps on Home's cards and open one (spec/app/home/cards.md, \"Story: The other cards\"; spec/app/home/cards.md, \"Story: Open my day from a card\")", async () => {
    const world = { ...scene(), phone: true, image: true };
    world.telephony.calls = [];
    world.telephony.texts = [];
    world.telephony.voicemails = [];
    const { alpha } = await open(world);
    await until(alpha, home.runtime(alpha), Home.Machine, (h) => h.tiles.load.status === "Loaded");
    await until(alpha, alpha.runtime, Shell, (s) => s.image);
    const card = (title: string) => [...document.querySelectorAll<HTMLButtonElement>("section[aria-label='Your day'] > button")]
      .find((found) => found.textContent?.startsWith(title) || found.getAttribute("aria-label")?.startsWith(`Open ${title}`));
    const pressCard = (title: string) => drawn(() => {
      const found = card(title);
      if (!found || found.disabled) throw new Error(`Home card unavailable: ${title}`);
      found.click();
    });
    const showing = (view?: "Inbox" | "Workflows") => vi.waitFor(async () => {
      const state = await alpha.runtime.runPromise(Shell.use((shell) => shell.get()));
      expect(state.trail.at(-1)).toBe(view);
    }, { timeout: 5_000 });
    const mail = { connected: true, unread: 4, rows: [{ title: "Bank", detail: "Statement ready" }], current: false };

    // spec/app/home/cards.md, "The Messages and Phone cards show their waiting rows, only on an Alpha image, and are not drawn without a row"; spec/app/home/cards.md, "The mail card shows the unread count, senders and subjects only, never a message body; marked not up to date when Inbox's page is not, and not drawn without an account or a row"
    await drawn(() => {
      fromAreas.messages([{ title: "Ana", detail: "Lunch at one?" }]);
      fromAreas.phone([]);
      fromAreas.mail(mail);
    });
    expect([card("Messages") !== undefined, card("Phone") !== undefined, card("4 unread")?.textContent]).toEqual([true, false, expect.stringMatching(/Not up to date/)]);

    // spec/app/home/cards.md, "The Workflows card shows the first two enabled rows and how many more, marked when they are not current, stale or partly unavailable, and is not drawn without a row"; spec/app/home/cards.md, "The brief card shows the brief kept for Home, or that its run failed, and is not drawn without one"
    await drawn(() => {
      fromAreas.flows({ rows: [{ title: "Morning brief", detail: "Daily" }, { title: "Inbox sweep", detail: "Hourly" }, { title: "Rent", detail: "Monthly" }], freshness: "SomeUnavailable" });
      fromAreas.brief({ outcome: "RunFailed", at: 7 * 3_600_000 });
    });
    expect(card("Morning brief")?.textContent).toBe("Morning briefInbox sweepSome unavailable");

    // spec/app/home/cards.md, "The row holds the agenda, Messages, Phone, Workflows, mail, Telegram, Slack and brief cards in that order, each only when drawn, and is not drawn when none is"
    expect([...document.querySelectorAll("section[aria-label='Your day'] > button")].map((found) => ["Messages", "Morning brief", "4 unread", "Latest brief"].find((title) => found.textContent?.startsWith(title) || found.getAttribute("aria-label")?.startsWith(`Open ${title}`)))).toEqual(["Messages", "Morning brief", "4 unread", "Latest brief"]);

    await drawn(() => { fromAreas.messages([]); fromAreas.mail({ connected: false, unread: 0, rows: [], current: false }); fromAreas.flows({ rows: [], freshness: "UpToDate" }); fromAreas.brief(undefined); });
    expect(document.querySelector("section[aria-label='Your day']")).toBeNull();

    // spec/app/home/cards.md, "A card opens its app: the agenda Calendar, Messages and Phone their own, mail Inbox, Telegram and Slack their own, the brief and Workflows Workflows; the agenda asks its calendar again if the last read did not succeed"
    await drawn(() => fromAreas.mail(mail));
    await pressCard("4 unread");
    await showing("Inbox");

    // spec/app/digests/index.md, "Home shows the newest kept result of the owner that ran, finished or failed, through a restart; a result that did not run never replaces it, and a page of another owner never reaches it"
    await keepDigests(alpha, digestScope({ agentId: world.notes.owner, identityId: world.notes.ownerIdentity }), [digestResult(1, "failed", "The morning brief could not run.")]);
    await hardware("home");
    await showing();
    await vi.waitFor(() => expect(card("Latest brief")?.textContent).toMatch(/The morning brief could not run\..*Failed/), { timeout: 5_000 });
    await pressCard("Latest brief");
    await showing("Workflows");
  });

  it('Shows Android’s retained brief and refreshes its digest results through the native inbox (spec/app/digests/index.md, "Android supplies one verified view of retained results and background checks")', async () => {
    // spec/app/assistant/index.md, "Stored attachments are posted with their message, and a message whose attachments could not be stored never left": the WebView's IndexedDB keeps the result attached to Ask Alpha.
    vi.stubGlobal("indexedDB", memoryIndexedDB());
    onTestFinished(() => { vi.unstubAllGlobals(); });
    const world = { ...scene(), phone: true };
    const initial = digestResult(1, "finished", "Owner’s retained Android brief");
    const missed = digestResult(2, "missed", "A missed run cannot replace the brief");
    const resultText = "The exact result from native refresh";
    const refreshed = digestResult(3, "finished", resultText);
    world.ask.spokenFiles = [];
    const browser: NonNullable<WorkflowsScene["hosted"]> = {
      entries: [digestResult(90, "finished", "Browser result for the same agent")], reads: 0, acknowledgements: [],
    };
    const native: NativeDigestScene = {
      snapshot: { rows: [initial, missed], backgroundEnabled: false, noticesAllowed: false, lease: "native-digest-lease", support: "nativeScheduled" },
      incoming: undefined,
      manualLeases: [],
    };
    world.workflows.hosted = browser;
    world.workflows.nativeDigests = native;
    const { alpha } = await open(world);
    const brief = () => [...document.querySelectorAll("section[aria-label='Your day'] > button")]
      .find((candidate) => candidate.textContent?.startsWith("Latest brief"))?.textContent;
    const results = () => [...document.querySelectorAll<HTMLButtonElement>("ul[aria-label='Digest results'] li > button")];
    await vi.waitFor(() => expect(brief()).toContain(initial.output), { timeout: 5_000 });
    expect(brief()).not.toContain(missed.output);
    expect(native.manualLeases).toEqual([]);

    await press("Workflows");
    const area = workflows.runtime(alpha);
    await until(alpha, area, WorkflowList, (state) => state.list.status === "Loaded");
    await press("Add to Workflows");
    await press("Scheduled digest");
    await until(alpha, area, DigestSchedules, (state) => state.open && state.schedules.status === "Loaded");
    await vi.waitFor(() => expect(results()).toHaveLength(2), { timeout: 5_000 });

    const started = native.manualLeases.length;
    native.incoming = [initial, missed, refreshed];
    await press("Refresh digests");
    await vi.waitFor(() => expect(results()).toHaveLength(3), { timeout: 5_000 });
    expect(native.manualLeases.slice(started)).toEqual([native.snapshot.lease]);

    await drawn(() => {
      const row = results().find((item) => item.textContent?.includes(new Date(refreshed.scheduledAt).toLocaleString()));
      if (row === undefined) throw new Error("Refreshed digest unavailable");
      row.click();
    });
    await vi.waitFor(() => expect(document.querySelector("[aria-label='Digest result']")?.textContent).toContain(resultText));

    // spec/app/digests/index.md, "Ask Alpha about a result hands that result to Ask Alpha"
    const composer = () => document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message Alpha']");
    const attachment = "Remove Saved result.txt";
    const recorded = () => document.querySelectorAll("section[aria-label='Ask Alpha'] [role=log] article").length;
    const unsent = () => expect([recorded(), world.ask.kept.size, world.ask.said, world.ask.spokenFiles]).toEqual([0, 0, [], []]);
    await vi.waitFor(() => expect(button("Ask Alpha")).toBeDefined());
    await press("Ask Alpha");
    await vi.waitFor(() => expect([composer()?.value, Boolean(button(attachment))]).toEqual(["Help me understand this saved result.", true]));
    unsent();

    await press(attachment);
    await vi.waitFor(() => expect(button(attachment)).toBeUndefined());
    const draft = "Tell me which part should come first.";
    await fill("Message Alpha", draft);
    await press("Minimize chat");
    await vi.waitFor(() => expect(button("Ask Alpha")).toBeDefined());
    await press("Ask Alpha");
    await vi.waitFor(() => expect([composer()?.value, Boolean(button(attachment))]).toEqual([draft, true]));
    unsent();

    await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
    await press("Send");
    await vi.waitFor(() => expect(world.ask.said).toEqual([draft]), { timeout: 5_000 });
    expect(world.ask.spokenFiles?.map(({ images }) => images)).toEqual([
      [{ name: "Saved result.txt", mimeType: "text/plain", data: btoa(resultText) }],
    ]);

    await hardware("home");
    await vi.waitFor(() => expect(brief()).toContain(refreshed.output), { timeout: 5_000 });
    expect([browser.reads, browser.acknowledgements]).toEqual([0, []]);
  });

  // spec/app/home/apps.md, "Story: Know what is installed"; spec/app/home/index.md, "Story: See the apps on this phone"; spec/app/home/index.md, "Story: Open an app"
  it("Keep saved installed apps on Home up to date and open them (spec/app/home/apps.md, \"Story: Know what is installed\"; spec/app/home/index.md, \"Story: See the apps on this phone\"; spec/app/home/index.md, \"Story: Open an app\")", async () => {
    const world = { ...scene(), phone: true };
    localStorage.setItem(savedKey, written([{ tag: "Own", view: "Notes" }, { tag: "Installed", app: "org.fixture.clock/org.fixture.clock.Main" }]));
    const { alpha } = await open(world);
    const homes = home.runtime(alpha);

    // spec/app/home/index.md, "Once the saved tiles are read, the phone's apps are read if Home holds an installed app, and a record that could not be read is told"
    await until(alpha, homes, Home.Machine, (h) => h.installed.read.status === "Loaded");
    expect([tiles(), Boolean(button("Apps"))]).toEqual([["view:Notes", "app:org.fixture.clock/org.fixture.clock.Main"], false]);

    // spec/app/home/index.md, "Only an app in the last reading is opened, never while Home is being edited"
    await drawn(() => tileButton("app:org.fixture.clock/org.fixture.clock.Main")?.click());
    await until(alpha, homes, Home.Machine, (h) => h.handoff.attempt.outcome === "Confirmed");
    expect(world.launcher.opened).toEqual(["org.fixture.clock"]);

    // spec/app/home/index.md, "Android's answer ends the wait; a refusal is told with its reason, and the apps are read again"
    world.launcher.refusing.set("org.fixture.clock", "disabled");
    await drawn(() => tileButton("app:org.fixture.clock/org.fixture.clock.Main")?.click());
    await until(alpha, homes, Home.Machine, (h) => h.handoff.attempt.outcome === "Refused" && h.installed.read.status === "Loaded");
    await until(alpha, alpha.runtime, Toasts, (t) => t.showing);
    expect([toast(), world.launcher.opened.length]).toEqual(["Couldn't open Clock. It's turned off.", 2]);

    // spec/app/home/index.md, "A failed reading that takes an installed tile off Home says so"; spec/app/home/index.md, "Home shows a tile only while its app is on this phone; a tile whose app has gone keeps its place and comes back with the app"
    const [clock, ...rest] = world.launcher.apps;
    world.launcher.apps = rest;
    world.launcher.changed();
    await until(alpha, homes, Home.Machine, (h) => !h.installed.apps.includes("org.fixture.clock/org.fixture.clock.Main") && h.installed.read.status === "Loaded");
    expect(tiles()).not.toContain("app:org.fixture.clock/org.fixture.clock.Main");
    world.launcher.apps = [clock, ...world.launcher.apps];
    world.launcher.changed();
    await until(alpha, homes, Home.Machine, (h) => h.installed.apps.includes("org.fixture.clock/org.fixture.clock.Main"));
    expect(tiles().at(-1)).toBe("app:org.fixture.clock/org.fixture.clock.Main");

    // spec/app/home/apps.md, "A change seen while Alpha shows is read at once, unless a reading is on its way; seen while Alpha is away, it waits"; spec/app/home/apps.md, "When Alpha comes back to the front, a change that waited is read once"
    const asked = (await homes.runPromise(Home.Machine.use((h) => h.get()))).installed.read.ticket;
    await seen(false);
    world.launcher.apps = world.launcher.apps.slice(1);
    world.launcher.changed();
    await until(alpha, homes, Home.Machine, (h) => h.installed.pending);
    expect((await homes.runPromise(Home.Machine.use((h) => h.get()))).installed.read.ticket).toBe(asked);
    await seen(true);
    await until(alpha, homes, Home.Machine, (h) => !h.installed.pending && h.installed.read.status === "Loaded" && !h.installed.apps.includes("org.fixture.clock/org.fixture.clock.Main"));
    expect((await homes.runPromise(Home.Machine.use((h) => h.get()))).installed.read.ticket).toBe(asked + 1);
  });

  // spec/app/home/index.md, "Story: Pull down for notifications"
  it("Pull down for notifications (spec/app/home/index.md, \"Story: Pull down for notifications\")", async () => {
    const world = holdingHome({ ...scene(), phone: true });
    world.launcher.shade = "silent";
    const { alpha } = await open(world);
    const homes = home.runtime(alpha);
    await until(alpha, homes, Home.Machine, (h) => h.host === "AsLauncher" && h.tiles.load.status === "Loaded");

    // spec/app/shell/gestures.md, "A pull opens the shade only when it is clearly downward, one and a half times its sideways travel, starts below the 44-point status band, on Home itself and not in a field, with no keyboard up and nothing under the finger scrolled from its top"
    await pulled(10);
    await pulled(68, 70);
    expect(world.launcher.shades).toBe(0);

    // spec/app/home/index.md, "When Android has not answered in time the wait ends; Alpha says nothing of an app, and says Android did not answer about the shade"
    await pulled();
    await until(alpha, homes, Home.Machine, (h) => h.handoff.attempt.outcome === "Sent");
    await later(alpha, 5_000);
    await until(alpha, homes, Home.Machine, (h) => h.handoff.attempt.outcome === "Unknown");
    await until(alpha, alpha.runtime, Toasts, (t) => t.showing);
    expect(toast()).toBe("Android didn't answer about notifications. Swipe down from the top edge of the screen for Android notifications.");

    // spec/app/home/index.md, "Alpha speaks about the shade only to say that Android did not open it or did not answer"
    world.launcher.shade = "opened";
    await pulled();
    await until(alpha, homes, Home.Machine, (h) => h.handoff.attempt.outcome === "Confirmed");
    expect(world.launcher.shades).toBe(2);

    // spec/app/home/index.md, "Alpha is told when it becomes, or stops being, the phone's launcher"
    world.settings.roles = world.settings.roles.map((role) => role.role === "home" ? { ...role, held: false, holders: ["com.android.launcher3"] } : role);
    await seen(false);
    await seen(true);
    await until(alpha, homes, Home.Machine, (h) => h.host === "AsApp");
    await pulled();
    expect(world.launcher.shades).toBe(2);
  });
});

describe("Home in a browser", () => {
  // spec/app/digests/index.md, "Home shows the newest kept result of the owner that ran, finished or failed, through a restart; a result that did not run never replaces it, and a page of another owner never reaches it"
  it("Shows the current owner's retained brief after restart (spec/app/digests/index.md, \"Story: Receive results without losing or repeating one\")", async () => {
    const world = scene();
    const setup = await open(world);
    await keepDigests(setup.alpha, digestScope({ agentId: world.notes.owner, identityId: world.notes.ownerIdentity }), [digestResult(1, "finished", "Owner’s morning brief"), digestResult(2, "missed", "Must stay off Home")]);
    await keepDigests(setup.alpha, digestScope({ agentId: world.notes.owner, identityId: "another-owner" }),
      [digestResult(1, "finished", "Another owner’s morning brief")]);
    await keepDigests(setup.alpha, `alpha/workflows/digests/${encodeURIComponent(world.notes.owner)}`,
      [digestResult(100, "finished", "Unverified older brief")]);
    await setup.close();

    await open(world);
    const latest = () => [...document.querySelectorAll("section[aria-label='Your day'] > button")]
      .find((card) => card.textContent?.startsWith("Latest brief"))?.textContent;
    await vi.waitFor(() => expect(latest()).toContain("Owner’s morning brief"));
    expect(latest()).not.toContain("Must stay off Home");
    expect(latest()).not.toContain("Unverified older brief");

    world.notes.ownerIdentity = "another-owner";
    await seen(false);
    await seen(true);
    await vi.waitFor(() => expect(latest()).toContain("Another owner’s morning brief"));
  });

  // spec/app/home/index.md, "Story: Open an app"
  it("Open one of Alpha's apps from Home (spec/app/home/index.md, \"Story: Open an app\")", async () => {
    const world = scene();
    const { alpha } = await open(world);
    const homes = home.runtime(alpha);
    await until(alpha, homes, Home.Machine, (h) => h.tiles.load.status === "Loaded");

    // spec/app/home/index.md, "Off the phone Home reads no apps, edits nothing and asks Android nothing"
    await pulled();
    expect([Boolean(button("Apps")), (await homes.runPromise(Home.Machine.use((m) => m.get()))).handoff.attempt.id]).toEqual([false, 0]);
    held("Notes");
    expect((await homes.runPromise(Home.Machine.use((m) => m.get()))).editing).toBe(false);

    // spec/app/home/index.md, "A tap on one of Alpha's own tiles on bare Home asks the shell to open that app, never while Home is being edited"
    await press("Notes");
    await until(alpha, alpha.runtime, Shell, (s) => s.trail.at(-1) === "Notes");
  });
});
