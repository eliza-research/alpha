import { Effect, Stream } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Machine as Storage } from "../gen/app__files.effect.vibe";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import files from "../src/files/index.tsx";
import { watchChrome } from "../src/shell/chrome.vibe";
import { offer, say } from "../src/notices/toasts.vibe";
import { closeAll, coverLifted, only, open, until } from "./alpha.tsx";
import { scene } from "./fakes/scene.ts";
import "../src/main.css";

afterEach(closeAll);

function centerOf(element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function hitAtCenter(element: Element): Element[] {
  const { x, y } = centerOf(element);
  return document.elementsFromPoint(x, y);
}

function numericZIndex(element: Element | null): number {
  if (element === null) return 0;
  const raw = getComputedStyle(element).zIndex;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

describe("Browser hit-test", () => {
  // spec/app/shell/index.md, "Ask Alpha rises to typing, a sheet or the full screen"; spec/app/notices/toasts.md, "Story: Read a toast before it goes"
  it("layers Home, Ask Alpha, Attach sheet, and Toast", async () => {
    await page.viewport(390, 844);
    const { alpha } = await open(scene(), only("home", "assistant", "notice", "view:Browser", "view:Settings"));
    await coverLifted(alpha);

    const notesTile = page.getByRole("button", { name: "Notes" });
    await expect.element(notesTile).toBeVisible();
    const notesEl = notesTile.element();
    expect(hitAtCenter(notesEl)).toContain(notesEl);

    const openConv = page.getByRole("button", { name: "Open conversation" });
    await expect.element(openConv).toBeVisible();
    expect(hitAtCenter(openConv.element())).toContain(openConv.element());
    await openConv.click();

    await alpha.runtime.runPromise(Effect.flatMap(Shell, (m) => Stream.runHead(Stream.filter(m.changes, (s) => s.assistant === "Sheet"))));
    const assistant = document.querySelector<HTMLElement>("section[aria-label='Ask Alpha']");
    expect(assistant?.getAttribute("data-alpha-detent")).toBe("sheet");

    const composer = document.querySelector<HTMLTextAreaElement>("textarea[data-alpha-composer]");
    expect(composer).not.toBeNull();
    expect(hitAtCenter(composer!)).toContain(composer!);

    await alpha.runtime.runPromise(say("Saved change"));
    const toast = page.getByText("Saved change");
    await expect.element(toast).toBeVisible();
    const toastEl = toast.element();
    const toastContainer = toastEl.closest("[data-alpha-toast-region]") ?? toastEl.closest("[role=status]") ?? toastEl;
    expect(hitAtCenter(toastEl)).toContain(toastEl);
    expect(numericZIndex(toastContainer) >= numericZIndex(assistant)).toBe(true);

    const actions = page.getByRole("button", { name: "Chat actions" });
    await actions.click();
    const attachItem = page.getByRole("menuitem", { name: "Attach media" });
    await expect.element(attachItem).toBeVisible();
    expect(hitAtCenter(attachItem.element())).toContain(attachItem.element());
    await attachItem.click();

    const closeAttach = page.getByRole("button", { name: "Close attachments" });
    await expect.element(closeAttach).toBeVisible();
    const attachDialog = document.querySelector<HTMLElement>("[aria-label='Attach files']");
    expect(attachDialog).not.toBeNull();
    expect(hitAtCenter(closeAttach.element())).toContain(closeAttach.element());
    await closeAttach.click();

    await page.getByRole("button", { name: "Expand chat" }).click();
    await alpha.runtime.runPromise(Effect.flatMap(Shell, (m) => Stream.runHead(Stream.filter(m.changes, (s) => s.assistant === "Full"))));
    expect(assistant?.getAttribute("data-alpha-detent")).toBe("full");
    const shrink = page.getByRole("button", { name: "Shrink chat" });
    await expect.element(shrink).toBeVisible();
    expect(hitAtCenter(shrink.element())).toContain(shrink.element());
  });

  // spec/app/files/index.md, "The owner opens a volume, a category, a listed folder, a step of the path, or goes back to the top; a category lists exactly the files of its kind"; spec/app/notices/toasts.md, "Story: Keep an Undo in reach"; spec/app/shell/keyboard.md, "Ask Alpha's footprint is what it covers now and its bar alone, which is never more; while nothing of Ask Alpha shows, the last footprint stays"
  it("opens the Files folder under an Undo toast, which keeps its Undo and sits just below the risen header", async () => {
    await page.viewport(390, 844);
    const { alpha } = await open({ ...scene(), phone: true }, only("home", "view:Files", "notice"));
    await coverLifted(alpha);
    const storage = files.runtime(alpha);
    await alpha.runtime.runPromise(Shell.use((shell) => shell.send({ type: "openView", view: "Files" })));
    await until(alpha, storage, Storage, (s) => s.storage.status === "Loaded");
    await page.getByRole("button", { name: "Internal storage" }).click();
    await until(alpha, storage, Storage, (s) => s.listing.status === "Loaded" && s.trail.length === 1);
    let undone = 0;
    await alpha.runtime.runPromise(offer("Deleted Lunch", "notes", 1, Effect.sync(() => { undone += 1; })));
    await expect.element(page.getByText("Deleted Lunch")).toBeVisible();
    const pill = page.getByText("Deleted Lunch").element().closest("[data-host-chrome]");
    const header = document.querySelector("[data-alpha-shell-page] [data-host-chrome]:not([data-alpha-comms-dock]):not([data-host-chrome=bottom])");
    if (!pill || !header) throw new Error("no Undo toast or Files header");

    await expect.poll(() => Math.round(pill.getBoundingClientRect().top - header.getBoundingClientRect().bottom)).toBe(8);

    const toast = pill.getBoundingClientRect();
    const row = [...document.querySelectorAll("[aria-label=Listed] button:not([role=checkbox])")].find((one) => {
      const box = one.getBoundingClientRect();
      return box.top < toast.bottom && box.bottom > toast.top;
    });
    if (!row) throw new Error("the Undo toast covers no listed row");
    const box = row.getBoundingClientRect();
    const tap = { x: toast.left + 8, y: (Math.max(box.top, toast.top) + Math.min(box.bottom, toast.bottom)) / 2 };
    expect(row.contains(document.elementFromPoint(tap.x, tap.y))).toBe(true);
    await userEvent.click(row, { position: { x: tap.x - box.left, y: tap.y - box.top } });
    await until(alpha, storage, Storage, (s) => s.listing.status === "Loaded" && s.trail.length === 2);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => undone).toBe(1);
    await expect.element(page.getByText("Deleted Lunch")).not.toBeInTheDocument();
  });

  // spec/app/shell/keyboard.md, "Ask Alpha's footprint is what it covers now and its bar alone, which is never more; while nothing of Ask Alpha shows, the last footprint stays"
  it("measures the header again when a transition that moved it ends, until the shell lets it go", async () => {
    const root = document.createElement("div");
    root.style.cssText = "position: fixed; inset: 0";
    const shellPage = document.createElement("div");
    shellPage.setAttribute("data-alpha-shell-page", "");
    const header = document.createElement("header");
    header.setAttribute("data-host-chrome", "");
    header.style.cssText = "height: 100px; transition: translate 40ms linear";
    shellPage.append(header);
    root.append(shellPage);
    document.body.append(root);
    const heard: number[] = [];
    const stop = watchChrome(root, (event) => { if (event.type === "headerMeasured") heard.push(event.px); });
    const clearance = () => root.style.getPropertyValue("--alpha-header-clearance");
    const moved = () => new Promise<void>((done) => header.addEventListener("transitionend", () => done(), { once: true }));
    try {
      expect(clearance()).toBe("100px");
      const risen = moved();
      header.style.translate = "0 -20px";
      await risen;
      expect(clearance()).toBe("80px");
      expect(heard).toEqual([100, 80]);

      stop();
      const back = moved();
      header.style.translate = "0 0";
      await back;
      expect(clearance()).toBe("80px");
      expect(heard).toEqual([100, 80]);
    } finally {
      stop();
      root.remove();
    }
  });

  // spec/app/shell/index.md, "Story: Move between Home and the apps"
  it("moves Tab focus across Home and Ask Alpha", async () => {
    await page.viewport(390, 844);
    const { alpha } = await open(scene(), only("home", "assistant"));
    await coverLifted(alpha);

    await expect.element(page.getByRole("button", { name: "Open conversation" })).toBeVisible();
    const visited = new Set<Element>();
    for (let step = 0; step < 6; step += 1) {
      await userEvent.tab();
      if (document.activeElement && document.activeElement !== document.body) {
        visited.add(document.activeElement);
        const rect = document.activeElement.getBoundingClientRect();
        expect(rect.width).toBeGreaterThan(0);
        expect(rect.height).toBeGreaterThan(0);
      }
    }
    expect(visited.size).toBeGreaterThanOrEqual(2);
  });

  // spec/app/assistant/dock.md, "A drag released asks the shell once for where it landed, and keeps a sheet's height"; spec/app/assistant/dock.md, "A press that did not move taps its control once"
  it("expands Ask Alpha via real pointer drag", async () => {
    await page.viewport(390, 844);
    const { alpha } = await open(scene(), only("home", "assistant"));
    await coverLifted(alpha);

    const openConv = page.getByRole("button", { name: "Open conversation" });
    await expect.element(openConv).toBeVisible();
    await openConv.click();
    await alpha.runtime.runPromise(Effect.flatMap(Shell, (m) => Stream.runHead(Stream.filter(m.changes, (s) => s.assistant === "Sheet"))));

    const grabber = document.querySelector<HTMLElement>("button[aria-label='Resize chat'], [aria-label='Resize chat']");
    expect(grabber).not.toBeNull();
    await expect.poll(() => hitAtCenter(grabber!).includes(grabber!)).toBe(true);
    const start = centerOf(grabber!);

    grabber!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, button: 0, clientX: start.x, clientY: start.y, pointerId: 7, pointerType: "touch" }));
    for (const nextY of [Math.max(20, start.y - 80), Math.max(20, start.y - 200), 100, 20]) {
      grabber!.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, isPrimary: true, button: 0, clientX: start.x, clientY: nextY, pointerId: 7, pointerType: "touch" }));
    }
    grabber!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, isPrimary: true, button: 0, clientX: start.x, clientY: 20, pointerId: 7, pointerType: "touch" }));

    await expect.poll(() => document.querySelector<HTMLElement>("section[aria-label='Ask Alpha']")?.getAttribute("data-alpha-detent")).toBe("full");
  });

  // spec/app/maps/index.md, "Story: Search for a place"
  it("mounts Maps with hit-testable controls", async () => {
    await page.viewport(390, 844);
    const uncaught: string[] = [];
    const onError = (event: ErrorEvent) => { uncaught.push(event.message); };
    window.addEventListener("error", onError);
    try {
      const world = scene();
      const { alpha } = await open(world, only("home", "assistant", "view:Maps"));
      await coverLifted(alpha);
      await page.getByRole("button", { name: "Maps" }).click();
      await expect.element(page.getByRole("button", { name: "Back" })).toBeVisible();

      const back = page.getByRole("button", { name: "Back" }).element();
      expect(hitAtCenter(back)).toContain(back);

      const search = page.getByRole("searchbox", { name: "Search Maps" });
      await expect.element(search, { timeout: 15_000 }).toBeVisible();
      expect(hitAtCenter(search.element())).toContain(search.element());
      expect(document.querySelector("canvas, section[aria-label='Maps'], [role=region][aria-label*='Map'], [data-alpha-map]")).not.toBeNull();
      expect(uncaught).toEqual([]);
    } finally {
      window.removeEventListener("error", onError);
    }
  });
});
