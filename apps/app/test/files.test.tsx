// @vitest-environment happy-dom
import { Effect, Option } from "effect";
import { readTurnContext, type DeviceOperation } from "@elizaos/agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Machine as Tabs } from "../gen/app__browser.effect.vibe";
import { Machine as Browser } from "../gen/app__files.effect.vibe";
import { Machine as Shown } from "../gen/app__files__preview.effect.vibe";
import { Machine as Recent } from "../gen/app__files__recent.effect.vibe";
import { everything } from "../gen/app__files__search.effect.vibe";
import { Machine as Bin } from "../gen/app__files__trash.effect.vibe";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import { Machine as Conversation } from "../gen/app__assistant.effect.vibe";
import { Machine as Preferences } from "../gen/app__settings__preferences.effect.vibe";
import assistant from "../src/assistant/index.tsx";
import { Machine as Messages } from "../gen/app__messages.effect.vibe";
import { Machine as MessageComposer } from "../gen/app__messages__composer.effect.vibe";
import { Drafts as MessageDrafts } from "../src/messages/composer.vibe";
import { Machine as Inbox } from "../gen/app__inbox.effect.vibe";
import { Machine as Drafts } from "../gen/app__inbox__drafts.effect.vibe";
import { Letters } from "../src/inbox/composer.vibe";
import { agentFilter, agentOpen, agentRead, approved, fileAction, offer, reviewFileAction, shownAt } from "../src/files/agent.vibe";
import type { Place } from "../src/areas.ts";
import browser from "../src/browser/index.tsx";
import files from "../src/files/index.tsx";
import { called, Files } from "../src/platform/files.vibe";
import { button, closeAll, drawn, fill, hardware, later, only, open, press, pressOnTop, seen, underAct, until } from "./alpha.tsx";
import { scene } from "./fakes/scene.ts";
import { textReview, type TextReviewScene } from "./fakes/text-review.ts";

underAct();
afterEach(closeAll);

const listed = () => [...document.querySelectorAll("[aria-label=Listed] button:not([role=checkbox])")].map((row) => row.getAttribute("aria-label"));
const openRow = (name: string) => drawn(() => {
  const found = [...document.querySelectorAll("[aria-label=Listed] button:not([role=checkbox])")].find((row) => row.getAttribute("aria-label") === name);
  if (!(found instanceof HTMLElement)) throw new Error(`no listed row ${name}`);
  found.click();
});
const openMenu = (label: string) => drawn(() => {
  const trigger = button(label);
  if (!trigger) throw new Error(`no menu ${label}`);
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
});
const menuItem = (name: string) => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent === name);
const choose = async (name: string, menu = "Files options") => {
  await openMenu(menu);
  await drawn(() => {
    const item = menuItem(name);
    if (!item) throw new Error(`no menu item ${name}`);
    item.click();
  });
};
/** The text the preview shows: the lines of its paper cards, in order. */
const shownText = () => [...document.querySelectorAll("[data-alpha-subview=files-preview] ol li")].map((line) => line.lastElementChild?.textContent).join("\n") || undefined;
/** Each paper card of the preview: its heading and its line numbers. */
const textCards = () => [...document.querySelectorAll("[data-alpha-subview=files-preview] ol")].map((card) => [card.previousElementSibling?.textContent, [...card.querySelectorAll("li")].map((line) => line.firstElementChild?.textContent).join(" ")]);
const paths = (world: ReturnType<typeof scene>) => world.files.stored.map((one) => `${one.volume}:${one.path}`).sort();
/** Choose `name`: its checkbox before anything is chosen, the row itself once choosing. */
const select = (name: string) => (button(`Select ${name}`) ? press(`Select ${name}`) : openRow(name));
const buttonOnTop = (name: string) => [...([...document.querySelectorAll("[role=dialog]")].at(-1)?.querySelectorAll("button") ?? [])].find((one) => (one.getAttribute("aria-label") ?? one.textContent) === name);

/** The Home tile of `view`, by its place rather than its words, which carry its badge. */
const homeTile = (view: string) => document.querySelector<HTMLButtonElement>(`[data-home-tile='view:${view}']`);
const openFromHome = (view: string) => drawn(() => {
  const found = homeTile(view);
  if (!found) throw new Error(`no Home tile ${view}`);
  found.click();
});

/** Alpha on a phone with Files on screen, its storage read. */
async function onFiles(world = { ...scene(), phone: true }, ...otherPlaces: Place[]) {
  const running = await open(world, only("home", "view:Files", "notice", ...otherPlaces));
  const { alpha } = running;
  const runtime = files.runtime(alpha);
  if (homeTile("Files")) await openFromHome("Files");
  return { ...running, world, runtime };
}

async function onDownloads() {
  const running = await onFiles();
  const { alpha, runtime } = running;
  await until(alpha, runtime, Browser, (s) => s.storage.status === "Loaded");
  await press("Internal storage");
  await press("Download");
  await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.items.length === 2);
  return running;
}

async function withFilesReviewOnHome(world: ReturnType<typeof scene>, review: TextReviewScene) {
  world.telephony.textReview = review;
  const { alpha } = await open(world, only("home", "view:Files", "assistant", "notice"));
  const chat = assistant.runtime(alpha);
  const storage = files.runtime(alpha);
  await until(alpha, alpha.runtime, Preferences, (s) => s.document.read.status === "Loaded" && !s.askFirst);
  await until(alpha, chat, Conversation, (s) => s.ready);
  return { alpha, chat, storage };
}

async function sendChat(text: string) {
  await fill("Message Alpha", text);
  await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
  await press("Send");
}

describe("Files on a phone", () => {
  it("Browse my storage (spec/app/files/index.md, \"Story: Browse my storage\")", async () => {
    const { alpha, runtime, world } = await onFiles();
    // spec/app/files/index.md, "The top shows each volume with a storage bar that is never fuller than the volume, or says the storage is unavailable"
    await until(alpha, runtime, Browser, (s) => s.storage.status === "Loaded" && s.access === "Granted");
    expect([Boolean(button("Internal storage")), Boolean(button("SD card")), Boolean(button("Trash"))]).toEqual([true, true, true]);
    // spec/app/files/index.md, "The top shows how many files each category holds and the room they take, and how many items the Trash holds, as the storage was last read"
    expect(runtime.runSync(Browser.use((m) => m.get())).tally).toEqual({
      counts: [{ kind: "Download", items: 2, bytes: 5_000 }, { kind: "Image", items: 1, bytes: 3_000 }, { kind: "Video", items: 0, bytes: 0 }, { kind: "Audio", items: 0, bytes: 0 }, { kind: "Document", items: 2, bytes: 2_010 }],
      trashed: 0,
    });

    // spec/app/files/index.md, "The owner opens a volume, a category, a listed folder, a step of the path, or goes back to the top; a category lists exactly the files of its kind"
    await press("Internal storage");
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded");
    expect(listed().sort()).toEqual(["Documents", "Download"]);
    // spec/app/files/index.md, "Opening Files reads the storage and the place it left, and leaving Files drops every read, the selection, the confirmation and the sheets": a place is read once, however often the screen draws it
    const reads = world.files.calls.filter((call) => call === "storageList").length;
    await choose("Grid view");
    await choose("List view");
    await choose("Name A–Z");
    expect([world.files.calls.filter((call) => call === "storageList").length, runtime.runSync(Browser.use((m) => m.get())).trail.length]).toEqual([reads, 1]);
    await openRow("Documents");
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.trail.length === 2);
    expect(listed().sort()).toEqual(["Old", "notes.txt"]);
    await press("Internal storage");
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.trail.length === 1);
    await openMenu("Files options");
    expect(menuItem("Browse storage")).toBeUndefined();
    await drawn(() => menuItem("Grid view")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await hardware("back");
    await press("Images");
    await until(alpha, runtime, Browser, (s) => s.inCategory && s.listing.status === "Loaded");
    // spec/app/files/index.md, "Images and Videos show the phone's folder groups with their counts and open the folder chosen"
    expect(button("Open Download")?.textContent).toContain("1");
    await press("Open Download");
    await until(alpha, runtime, Browser, (s) => !s.inCategory && s.listing.status === "Loaded");
    expect(listed().sort()).toEqual(["beach.jpg", "lease.pdf"]);

    // spec/app/files/index.md, "The owner opens a file that is listed or found, with the names beside it, and Recent remembers it": formats without a preview go directly to Android
    world.files.stored.push({ volume: "primary", path: "Download/archive.zip", directory: false, mimeType: "application/zip", size: 100, modified: 3 });
    await choose("Refresh");
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.items.length === 3);
    world.files.refusing.push("storageOpen");
    await press("archive.zip");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Android could not open this file"));
    world.files.refusing.pop();
    await press("archive.zip");
    await vi.waitFor(() => expect(world.files.opened).toEqual(["Download/archive.zip"]));
    expect(document.querySelector('[aria-label="File actions"]')).toBeNull();

    // spec/app/files/index.md, "A place is called empty only after the phone read all of it; a reading cut short keeps what it read"
    world.files.listMost = 1;
    await choose("Browse storage");
    await press("Internal storage");
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.trail.length === 1);
    expect([listed().length, document.body.textContent?.includes("Only part of this place could be read")]).toEqual([1, true]);
    world.files.listMost = 0;
    await choose("Refresh");
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.items.length === 0);
    expect([document.body.textContent?.includes("Nothing here"), document.body.textContent?.includes("Only part of this place could be read")]).toEqual([false, true]);
    world.files.listMost = 5_000;

    // spec/app/files/index.md, "The place showing is read again when asked, and only its newest answer is taken; a folder that no longer exists brings the owner back to the top and says so, never that the storage is unavailable"
    await hardware("back");
    await press("Internal storage");
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded");
    await openRow("Documents");
    await press("Old");
    // spec/app/files/index.md, "The place showing is read again when asked, and only its newest answer is taken; a folder that no longer exists brings the owner back to the top and says so, never that the storage is unavailable": the phone watches the folder showing
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.trail.length === 3 && world.files.watching === "primary:Documents/Old");
    world.files.stored.splice(world.files.stored.findIndex((one) => one.path === "Documents/Old"), 1);
    world.files.changed();
    await until(alpha, runtime, Browser, (s) => s.missing);
    await drawn(() => {});
    expect([world.files.watching, Boolean(button("Internal storage"))]).toEqual([undefined, true]);
  });

  it('Selects a Files row with a stationary touch and lets drag or cancellation leave it alone (spec/app/files/index.md, "The owner selects items of the place showing, all of them, or none, and a changed selection closes the sheets, telling the owner a share sheet sent nothing, and voids the delete confirmation")', async () => {
    const { alpha, runtime } = await onFiles();
    await until(alpha, runtime, Browser, (state) => state.storage.status === "Loaded");
    await press("Internal storage");
    await until(alpha, runtime, Browser, (state) => state.listing.status === "Loaded");
    await openRow("Download");
    await until(alpha, runtime, Browser, (state) => state.listing.status === "Loaded" && state.trail.length === 2);

    const picked = () => runtime.runSync(Effect.flatMap(Browser, (machine) => machine.get())).picked;
    const touch = (type: string, clientX = 30) => drawn(() => {
      const row = button("lease.pdf");
      if (!row) throw new Error("The listed file is missing");
      row.dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, button: 0, pointerId: 1, pointerType: "touch", clientX, clientY: 20 }));
    });
    await touch("pointerdown");
    await touch("pointermove", 70);
    await later(alpha, 500);
    expect(picked()).toEqual([]);
    await touch("pointerup", 70);

    await touch("pointerdown");
    await touch("pointercancel");
    await later(alpha, 500);
    expect(picked()).toEqual([]);

    await touch("pointerdown");
    await later(alpha, 499);
    expect(picked()).toEqual([]);
    await later(alpha, 1);
    await until(alpha, runtime, Browser, (state) => state.picked.length === 1);
    await drawn(() => button("lease.pdf")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    await touch("pointerup");
    await drawn(() => button("lease.pdf")?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(picked()).toHaveLength(1);
    expect(button("lease.pdf")?.getAttribute("aria-pressed")).toBe("true");

    await press("Cancel");
    await until(alpha, runtime, Browser, (state) => state.picked.length === 0);
    const checkbox = button("Select beach.jpg");
    if (!checkbox) throw new Error("The keyboard selection control is missing");
    await drawn(() => checkbox.focus());
    expect(document.activeElement).toBe(checkbox);
    await drawn(() => checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
    await until(alpha, runtime, Browser, (state) => state.picked.length === 1);
    expect(button("beach.jpg")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("Browse my storage from the Browser's Show in Files, and go back (spec/app/files/index.md, \"Story: Browse my storage\")", async () => {
    const { alpha, runtime, world } = await onFiles({ ...scene(), phone: true, image: true }, "view:Browser");
    await until(alpha, runtime, Browser, (s) => s.storage.status === "Loaded");
    await press("Internal storage");
    await press("Download");
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.trail.length === 2);

    // spec/app/files/index.md, "Back closes one layer inside Files: the Move to sheet, the share sheet, the name clash, the delete confirmation, the details, the Trash, the selection and the filter, then goes up the path a step; at the top, or back where another area's walk began, it leaves Files"
    // spec/app/files/index.md, "The owner sees a listed item's details: what it is, how big it is, when it last changed and where it is; they close when the owner closes them or moves, or when the item is no longer listed"
    await select("beach.jpg");
    await press("Details");
    await until(alpha, runtime, Browser, (s) => s.details !== 0);
    expect(document.querySelector("dl[aria-label=Details]")).not.toBeNull();
    await hardware("back");
    await until(alpha, runtime, Browser, (s) => s.details === 0 && s.picked.length === 1);
    await hardware("back");
    await until(alpha, runtime, Browser, (s) => s.picked.length === 0);
    await choose("Filter files");
    await fill("Filter", "beach");
    await press("Filter");
    await until(alpha, runtime, Browser, (s) => s.search.query.status === "Loaded");
    await hardware("back");
    await until(alpha, runtime, Browser, (s) => !s.search.searching);
    await hardware("back");
    await until(alpha, runtime, Browser, (s) => s.trail.length === 1 && s.listing.status === "Loaded");
    await hardware("back");
    await until(alpha, runtime, Browser, (s) => s.trail.length === 0);

    // spec/app/files/index.md, "Another area opens Files at Downloads: the Download folder of the main volume where the phone has one, else the Downloads category; the owner's own move to the top, a volume or a category ends that walk"
    await hardware("home");
    await openFromHome("Browser");
    await until(alpha, browser.runtime(alpha), Tabs, (s) => s.hydrated);
    const showInFiles = async () => {
      await press("Menu");
      await press("Downloads");
      await drawn(() => {
        const choose = world.browser.showInFiles;
        if (choose === undefined) throw new Error("the phone did not open Browser Downloads");
        choose();
      });
    };
    await showInFiles();
    await until(alpha, runtime, Browser, (s) => s.open && s.handed && s.trail.length === 2 && s.listing.status === "Loaded");
    expect(listed().sort()).toEqual(["beach.jpg", "lease.pdf"]);
    await hardware("back");
    await until(alpha, runtime, Browser, (s) => !s.open);
    expect(alpha.runtime.runSync(Shell.use((m) => m.get())).trail.at(-1)).toBe("Browser");

    world.files.stored.splice(world.files.stored.findIndex((one) => one.path === "Download"), 1);
    await showInFiles();
    await until(alpha, runtime, Browser, (s) => s.open && s.handed && s.inCategory && s.category === "Download" && s.listing.status === "Loaded");
    await choose("Browse storage");
    await until(alpha, runtime, Browser, (s) => s.open && !s.handed && !s.inCategory && s.trail.length === 0);
    expect(alpha.runtime.runSync(Shell.use((m) => m.get())).trail.at(-1)).toBe("Files");
  });

  it("Browse my storage without access (spec/app/files/index.md, \"Story: Browse my storage\")", async () => {
    const world = { ...scene(), phone: true };
    world.files.access = "denied";
    const { alpha, runtime } = await onFiles(world);
    // spec/app/files/index.md, "Allow goes to the permission flow while Android was never asked, and to Android's Settings after"
    const reads = () => world.files.calls.filter((call) => ["storageList", "storageCategory", "storageQuery"].includes(call));
    const prompt = () => [document.body.textContent?.includes("Allow all files access"), document.body.textContent?.includes("This place cannot be read now"), reads()];
    await until(alpha, runtime, Browser, (s) => s.open && s.access === "Unasked");
    expect([Boolean(button("Allow")), ...prompt()]).toEqual([true, true, false, []]);
    await press("Allow");
    await until(alpha, runtime, Browser, (s) => s.access === "Denied");
    expect([Boolean(button("Open Settings")), ...prompt()]).toEqual([true, true, false, []]);
    await press("Open Settings");
    world.files.access = "granted";
    // spec/app/files/index.md, "When the phone says Alpha may read the storage the place is read, and when it takes access away, or says the storage cannot be reached at all, everything read is dropped"
    await press("Open Settings");
    await until(alpha, runtime, Browser, (s) => s.access === "Granted" && s.storage.status === "Loaded");
    expect(world.files.calls.filter((call) => call.startsWith("storageRequestAccess"))).toEqual(["storageRequestAccess", "storageRequestAccess settings", "storageRequestAccess settings"]);
    expect([Boolean(button("All files")), Boolean(button("Internal storage")), ...prompt().slice(0, 2)]).toEqual([true, true, false, false]);
    await press("Downloads");
    await until(alpha, runtime, Browser, (s) => s.inCategory && s.category === "Download" && s.listing.status === "Loaded");
    expect(listed().toSorted()).toEqual(["beach.jpg", "lease.pdf"]);
    world.files.access = "denied";
    await seen(false);
    await seen(true);
    await until(alpha, runtime, Browser, (s) => s.access === "Unasked" && s.items.length === 0);
    expect([Boolean(button("Allow")), ...prompt().slice(0, 2)]).toEqual([true, true, false]);
  });

  it("Arrange and filter what I see (spec/app/files/index.md, \"Story: Arrange and filter what I see\"; spec/app/files/search.md, \"Story: Filter what I see\")", async () => {
    const { alpha, runtime, world } = await onDownloads();
    // spec/app/files/index.md, "The owner chooses a grid or a list, and a sort; choosing the same sort again reverses it"
    await choose("Name A–Z");
    expect(listed()).toEqual(["beach.jpg", "lease.pdf"]);
    await choose("Name Z–A");
    expect(listed()).toEqual(["lease.pdf", "beach.jpg"]);
    await choose("Largest first");
    expect(listed()).toEqual(["beach.jpg", "lease.pdf"]);
    await choose("Smallest first");
    expect(listed()).toEqual(["lease.pdf", "beach.jpg"]);
    // spec/app/files/index.md, "The owner sets a filter of a kind and a text for the place showing, as a chip the owner sees and clears; only what matches both is shown"
    await choose("Filter files");
    await fill("Filter", "LEASE");
    await press("Filter");
    await until(alpha, runtime, Browser, (s) => s.search.query.status === "Loaded");
    expect(runtime.runSync(Browser.use((m) => m.get())).search.hits.map((hit) => hit.name)).toEqual(["lease.pdf"]);
    await fill("Filter", "");
    await press("Images");
    await press("Filter");
    await until(alpha, runtime, Browser, (s) => s.search.query.status === "Loaded" && !s.search.filter.anyKind);
    expect(runtime.runSync(Browser.use((m) => m.get())).search.hits.map((hit) => hit.name)).toEqual(["beach.jpg"]);
    // spec/app/files/index.md, "A refresh asks the filter on again for the place showing, so what it found is never older than what the place lists"
    world.files.stored.push({ volume: "primary", path: "Download/dunes.png", directory: false, mimeType: "image/png", size: 1, modified: 8 });
    await choose("Refresh");
    await until(alpha, runtime, Browser, (s) => s.search.query.status === "Loaded" && s.search.hits.length === 2);
    world.files.stored.pop();
    await press("Clear the filter");
    await until(alpha, runtime, Browser, (s) => !s.search.searching);

    // spec/app/files/index.md, "The place showing is read again when asked, and only its newest answer is taken; a folder that no longer exists brings the owner back to the top and says so, never that the storage is unavailable": coming back to Alpha reads the place again
    await seen(false);
    world.files.stored.push({ volume: "primary", path: "Download/new.txt", directory: false, mimeType: "text/plain", size: 1, modified: 9 });
    await seen(true);
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.items.length === 3);

    world.files.stored.push({ volume: "primary", path: "song.txt", directory: false, mimeType: "text/plain", size: 3, modified: 10 });
    await choose("Browse storage");
    await press("SD card");
    await choose("Filter files");
    await fill("Filter", "song");
    await press("Any kind");
    await press("Filter");
    await until(alpha, runtime, Browser, (s) => s.search.query.status === "Loaded" && s.search.hits.length === 1);
    expect(runtime.runSync(Browser.use((m) => m.get())).search.hits.map((hit) => hit.name)).toEqual(["song.mp3"]);
  });

  it("Change my files (spec/app/files/index.md, \"Story: Change my files\"; spec/app/files/change.md, \"Story: Change my files\"; spec/app/files/destination.md, \"Story: Choose a destination\"; spec/app/files/change.md, \"Story: Share what I selected\")", async () => {
    const { alpha, runtime, world } = await onDownloads();
    const openDocumentsInDestination = async () => {
      await until(alpha, runtime, Browser, (s) => s.sheet.reading.status === "Loaded");
      await pressOnTop("Open Documents");
      await until(alpha, runtime, Browser, (s) => s.sheet.reading.status === "Loaded" && s.sheet.trail.length === 2);
    };

    // spec/app/files/index.md, "A change starts from the selection, of the folder showing, into a destination only as the Move to sheet last read it, as Changes allows it"
    await select("lease.pdf");
    await press("Move");
    // spec/app/files/index.md, "The owner opens the Move to sheet for the selection, at the folder showing, and goes through the volumes and folders in it"
    await pressOnTop("Parent folder");
    await until(alpha, runtime, Browser, (s) => s.sheet.trail.length === 1);
    await pressOnTop("Parent folder");
    await until(alpha, runtime, Browser, (s) => s.sheet.trail.length === 0);
    expect([buttonOnTop("Open Internal storage")?.disabled, buttonOnTop("Open SD card")?.disabled]).toEqual([false, true]);
    await pressOnTop("Open Internal storage");
    await openDocumentsInDestination();
    // spec/app/files/index.md, "A new folder in the destination picker uses the parent as shown and opens the new folder in that picker"
    await pressOnTop("New folder");
    await fill("Name", "Filed copies");
    await pressOnTop("Create");
    await until(alpha, runtime, Browser, (s) => s.sheet.reading.status === "Loaded" && s.sheet.trail.length === 3);
    expect([document.querySelector("nav[aria-label='Destination path']")?.textContent?.includes("Filed copies"), paths(world).includes("primary:Documents/Filed copies")]).toEqual([true, true]);
    await pressOnTop("Parent folder");
    await until(alpha, runtime, Browser, (s) => s.sheet.reading.status === "Loaded" && s.sheet.trail.length === 2 && s.picked.length === 1);
    await pressOnTop("Move here");
    // spec/app/files/index.md, "A change ends as its answer says, what a move took away is told, and the place is read again"
    await until(alpha, runtime, Browser, (s) => s.change.attempt.outcome === "Confirmed" && s.listing.status === "Loaded");
    expect([listed(), paths(world).includes("primary:Documents/lease.pdf")]).toEqual([["beach.jpg"], true]);

    // spec/app/files/change.md, "A change starts when none is under way and nothing of it is still unknown; when names clash in the destination the owner is asked first, and an approved request keeps both"
    await select("beach.jpg");
    await press("Copy");
    await pressOnTop("Parent folder");
    await until(alpha, runtime, Browser, (s) => s.sheet.reading.status === "Loaded");
    await pressOnTop("Open Download");
    await until(alpha, runtime, Browser, (s) => s.sheet.reading.status === "Loaded" && s.sheet.trail.length === 2);
    await pressOnTop("Copy here");
    await until(alpha, runtime, Browser, (s) => s.change.clash.showing);
    await press("Keep both");
    await until(alpha, runtime, Browser, (s) => s.change.attempt.outcome === "Confirmed" && s.listing.status === "Loaded");
    expect(listed().sort()).toEqual(["beach.jpg", "beach.jpg (2)"]);

    // spec/app/files/change.md, "A file of the same name is replaced only when the owner chose to replace it, never for the agent"
    for (let round = 0; round < 2; round += 1) {
      await select("beach.jpg");
      await press("Copy");
      await pressOnTop("Parent folder");
      await openDocumentsInDestination();
      await pressOnTop("Copy here");
      if (runtime.runSync(Effect.flatMap(Browser, (m) => m.get())).change.clash.showing) await press("Replace");
      await until(alpha, runtime, Browser, (s) => s.change.work === "CopyTo" && s.change.attempt.outcome === "Confirmed" && s.listing.status === "Loaded");
    }
    expect([paths(world).filter((path) => path.startsWith("primary:Documents/beach")), world.files.trash.map((one) => one.was.path)]).toEqual([["primary:Documents/beach.jpg"], ["Documents/beach.jpg"]]);
    world.files.trash.splice(0);

    // spec/app/files/index.md, "One request leaves for each change, for items listed as they are now or the file shown, and only when the owner starts, chooses or renames it, or approved it"
    await choose("New folder");
    await fill("Name", "Taxes");
    await pressOnTop("Create");
    await until(alpha, runtime, Browser, (s) => s.change.work === "NewFolder" && s.change.attempt.outcome === "Confirmed" && s.listing.status === "Loaded");
    await select("beach.jpg (2)");
    await press("Rename");
    await fill("Name", "Taxes");
    expect(buttonOnTop("Rename")?.hasAttribute("disabled")).toBe(true);
    await fill("Name", "dunes.jpg");
    await pressOnTop("Rename");
    await until(alpha, runtime, Browser, (s) => s.change.work === "Rename" && s.change.attempt.outcome === "Confirmed" && s.listing.status === "Loaded");
    expect(listed().sort()).toEqual(["Taxes", "beach.jpg", "dunes.jpg"]);

    // spec/app/files/index.md, "The owner opens the share sheet for a selection of one to a hundred files and no folder while none is open, shares from it, and Android says whether it could open it"
    await select("dunes.jpg");
    await press("Share");
    await press("Share to an app");
    await until(alpha, runtime, Browser, (s) => s.change.sending.outcome === "Confirmed");
    expect(world.files.shared).toEqual([["Download/dunes.jpg"]]);
    // spec/app/files/change.md, "Each sheet sends once, by email when an account can take it, through the phone's chooser, as copied text or saved through the system picker, and then goes away; sharing by text message is not offered"
    await press("Share");
    await pressOnTop("Copy");
    await until(alpha, runtime, Browser, (s) => s.change.sending.outcome === "Confirmed" && s.change.sentTo === "Copy");
    expect(await navigator.clipboard.readText()).toBe("Internal storage/Download/dunes.jpg");
    // spec/app/files/change.md, "The sheet goes away when the owner closes it or Files is hidden, and when the selection changes the owner is told it sent nothing; a sheet never opens again"
    await press("Share");
    await until(alpha, runtime, Browser, (s) => s.change.panel !== 0);
    await select("beach.jpg");
    await until(alpha, runtime, Browser, (s) => s.change.panel === 0 && s.change.stale);
    expect(document.body.textContent?.includes("The selection changed, so nothing was shared")).toBe(true);
    await press("Cancel");

    // spec/app/files/index.md, "An approved request runs only in Files on screen, in the folder the owner approved, on a screen that is not protected, and on the item as it was shown; otherwise the agent is told it did not run"
    await select("dunes.jpg");
    const dunes = world.files.stored.find((one) => one.path === "Download/dunes.jpg");
    if (dunes) dunes.modified = 99;
    await press("Move");
    await pressOnTop("Open Taxes");
    await until(alpha, runtime, Browser, (s) => s.sheet.reading.status === "Loaded" && s.sheet.trail.length === 3);
    await pressOnTop("Move here");
    await until(alpha, runtime, Browser, (s) => s.change.work === "MoveTo" && s.change.attempt.outcome === "Refused" && s.listing.status === "Loaded");
    expect(paths(world).includes("primary:Download/dunes.jpg")).toBe(true);
  });

  it('Use a picture from Files in Messages (spec/app/files/preview.md, "Use in Messages offers the exact readable PNG or JPEG to the owner’s recipient picker"; spec/app/messages/index.md, "A picture from Files is offered in a new recipient picker and can join only its chosen empty draft")', async () => {
    const { alpha, runtime, world } = await onFiles({ ...scene(), phone: true, image: true }, "view:Messages");
    const png = atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=");
    world.files.stored.push({ volume: "primary", path: "Download/handed.png", directory: false, mimeType: "image/png", size: png.length, modified: 7 });
    world.files.texts["Download/handed.png"] = png;
    await until(alpha, runtime, Browser, (s) => s.storage.status === "Loaded");
    await press("Internal storage");
    await openRow("Download");
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.trail.length === 2);
    await press("handed.png");
    await until(alpha, runtime, Shown, (s) => s.kind === "Photo" && s.content.status === "Loaded");

    await choose("Use in Messages", "File actions");
    await until(alpha, alpha.runtime, Messages, (s) => s.pane === "Picker" && s.offeredPicture > 0);
    expect(document.querySelector("[aria-label='Picture for this message']")?.textContent).toContain("handed.png");
    expect(world.telephony.sent).toEqual([]);
    await fill("To", "+15550123456");
    await press("Text +15550123456");
    await until(alpha, alpha.runtime, MessageComposer, (s) => s.pictures === 1);
    const { thread } = alpha.runtime.runSync(MessageComposer.use((composer) => composer.get()));
    const pictures = alpha.runtime.runSync(MessageDrafts.use((drafts) => drafts.pictures(thread)));
    expect(pictures).toEqual([{ name: "handed.png", wireName: "picture-1.png", contentType: "image/png", bytes: Uint8Array.from(png, (byte) => byte.charCodeAt(0)) }]);
    expect(world.telephony.sent).toEqual([]);
  });

  it("Look at a file, and find what I opened lately (spec/app/files/preview.md, \"Story: Look at a file\"; spec/app/files/recent.md, \"Story: Find what I opened lately\"; spec/app/files/recent.md, \"Story: Pick a file with the system picker\"; spec/app/files/preview.md, \"Story: Act on the file I am looking at\")", async () => {
    const { alpha, runtime, world } = await onFiles(undefined, "assistant");
    await until(alpha, runtime, Browser, (s) => s.storage.status === "Loaded");
    await press("Internal storage");
    // spec/app/files/shared.md, "A file has a number, a name, a revision that changes whenever the file does, a kind, its size, and the storage volume it is on": a folder row counts what the phone counted in it (files-browser-adapter.ts:1316-1318)
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.trail.length === 1);
    await drawn(() => expect([...document.querySelectorAll("[aria-label=Listed] button:not([role=checkbox])")].find((row) => row.getAttribute("aria-label") === "Documents")?.querySelector("span.text-muted-foreground")?.textContent).toBe("2 items"));
    await openRow("Documents");
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.trail.length === 2);
    /** v119 live rows read size · date with no leading type word (files-browser-adapter.ts:1315-1324); the kind stays for screen readers. */
    const notesRow = [...document.querySelectorAll("[aria-label=Listed] button:not([role=checkbox])")].find((row) => row.getAttribute("aria-label") === "notes.txt");
    const notesDetail = notesRow?.querySelector("span.text-muted-foreground")?.textContent ?? "";
    expect([notesDetail.startsWith("Document"), notesDetail.split(" · ").length, notesRow?.getAttribute("aria-description")]).toEqual([false, 2, `Document · ${notesDetail}`]);
    // spec/app/files/index.md, "The owner opens a file that is listed or found, with the names beside it, and Recent remembers it"
    // spec/app/files/preview.md, "What was read of a file is shown only in its own viewer, while it can be read"
    await press("notes.txt");
    await until(alpha, runtime, Shown, (s) => s.content.status === "Loaded" && s.kind === "Text");
    expect(shownText()).toBe("The words of notes.txt");
    // spec/app/files/preview.md, "The caption and Details show facts for the exact document held": v119's live facts line (selection-adapter.ts:282, files-browser-adapter.ts:1797-1804) with the 18px slot before the facts empty.
    const facts = document.querySelector("[data-facts-slot]")?.parentElement;
    expect([facts?.querySelector("svg"), facts?.querySelector("[data-facts-slot]")?.childNodes.length, facts?.textContent]).toEqual([null, 0, "text/plain · selected on this device · Internal storage › Documents"]);

    // spec/app/files/preview.md, "The owner can share the readable file shown through Android using its own selected-document grant"
    await choose("Details", "File actions");
    expect(document.querySelector("[aria-label='File details']")?.textContent).toContain("Internal storage › Documents");
    await press("Close details");
    const [notesSelection] = [...world.files.selections].find(([, selection]) => selection.path === "Documents/notes.txt") ?? [];
    if (!notesSelection) throw new Error("the phone did not authorize the notes preview");
    await choose("Share", "File actions");
    await vi.waitFor(() => expect(world.files.shared).toEqual([[notesSelection]]));

    const updated = world.files.stored.find((file) => file.path === "Documents/notes.txt");
    if (updated === undefined) throw new Error("the fixture lost the previewed notes");
    const revised = "Alpha shoot brief\n1. Voice checklist\n2. Calendar hold\n3. Files\n4. Inbox draft\n5. Text reminder\n6. Alpha Compute site\nBring a charged Pixel, tripod, and notebook.\n";
    world.files.texts[updated.path] = revised;
    world.files.stored.splice(world.files.stored.indexOf(updated), 1, {
      ...updated, modified: 11, size: new TextEncoder().encode(world.files.texts[updated.path]).length,
    });
    world.files.changed();
    await until(alpha, runtime, Shown, (s) => s.revision === 11 && s.content.status === "Loaded");
    // spec/app/files/preview.md, "Story: Look at a file": v119's live paper cards (selection-adapter.ts:272-283), eight numbered lines a card, as the demo's brief showed (wn-057, v100-15)
    expect([shownText(), textCards()]).toEqual([revised, [["notes.txt", "1 2 3 4 5 6 7 8"], ["notes.txt (continued)", "9"]]]);

    // spec/app/files/preview.md, "Ask Alpha and Open elsewhere hand the file on and change nothing here"
    world.files.texts[updated.path] = "These are the altered notes";
    await choose("Ask Alpha", "File actions");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Alpha could not attach this file"));
    expect(shownText()).toBe(revised);
    world.files.texts[updated.path] = revised;
    await choose("Ask Alpha", "File actions");
    await until(alpha, alpha.runtime, Shell, (s) => s.assistant === "Sheet");
    expect([document.querySelector("[data-alpha-subview=files-preview]") !== null, shownText()]).toEqual([true, revised]);
    await press("Remove notes.txt");
    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (s) => s.assistant === "Bar");
    // spec/app/files/preview.md, "The owner closes the viewer, and so does leaving the screen or the phone locking"
    await press("Close");
    await until(alpha, runtime, Shown, (s) => s.viewer === 0);
    await until(alpha, runtime, Recent, (s) => s.rows.length === 1 && s.shown.grant === 0);

    // spec/app/files/preview.md, "The owner turns the pages of a PDF, and only the newest page asked for is drawn"
    await choose("Browse storage");
    await press("Internal storage");
    await press("Download");
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.trail.length === 2);
    await press("lease.pdf");
    await until(alpha, runtime, Shown, (s) => s.drawing.status === "Loaded" && s.pages === 3 && s.page === 1);
    await press("Next page");
    await until(alpha, runtime, Shown, (s) => s.drawing.status === "Loaded" && s.page === 2);
    // spec/app/files/preview.md, "Open elsewhere hands the file over to read only"
    const [leaseSelection] = [...world.files.selections].find(([, selection]) => selection.path === "Download/lease.pdf") ?? [];
    if (!leaseSelection) throw new Error("the phone did not authorize the PDF preview");
    await choose("Open in Android", "File actions");
    await vi.waitFor(() => expect(world.files.opened).toContain(leaseSelection));
    // spec/app/files/preview.md, "Forget removes the file from Recent, with or without access, and closes the viewer"
    await choose("Forget", "File actions");
    await until(alpha, runtime, Recent, (s) => s.rows.length === 1 && s.shown.grant === 0);
    await vi.waitFor(() => expect(world.files.forgotten).toEqual([leaseSelection]));

    // spec/app/files/preview.md, "A file that holds a verification code or another secret is never handed to Ask Alpha"
    world.files.stored.push({ volume: "primary", path: "Download/code.txt", directory: false, mimeType: "text/plain", size: 30, modified: 4 });
    world.files.texts["Download/code.txt"] = "A service API key must stay here";
    await choose("Refresh");
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.items.length === 3);
    await press("code.txt");
    await until(alpha, runtime, Shown, (s) => s.content.status === "Loaded" && s.secret);
    await openMenu("File actions");
    expect(menuItem("Ask Alpha")).toBeUndefined();
    await drawn(() => menuItem("Open in Android")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await press("Close");

    // spec/app/files/recent.md, "Opening a row again asks the phone first: it opens, moves to the front and is the document open, or its access has ended and it must be selected again, or its provider cannot be reached and it stays"
    await choose("Browse storage");
    await press("notes.txt");
    await until(alpha, runtime, Shown, (s) => s.content.status === "Loaded" && s.kind === "Text");
    await press("Close");
    await until(alpha, runtime, Shown, (s) => s.viewer === 0);
    world.files.selections.delete(notesSelection);
    await press("notes.txt");
    await until(alpha, runtime, Recent, (s) => s.reaching.status === "Failed" && s.rows.filter((row) => row.grant === 0).length === 1);
    expect(button("notes.txt")).toBeUndefined();

    world.files.stored.push({ volume: "primary", path: "Download/restored.txt", directory: false, mimeType: "text/plain", size: 12, modified: 10 });
    world.files.selectedByPicker = "Download/restored.txt";
    await press("Select again: notes.txt");
    await until(alpha, runtime, Shown, (s) => s.content.status === "Loaded" && s.kind === "Text");
    expect(shownText()).toBe("The words of restored.txt");

    // spec/app/files/preview.md, "A picked document is renamed through its provider using the access held for the viewer"
    const pickedViewer = runtime.runSync(Shown.use((machine) => machine.get())).viewer;
    await choose("Rename", "File actions");
    await fill("Name", "retained.txt");
    await pressOnTop("Rename");
    await until(alpha, runtime, Shown, (s) => s.viewer > pickedViewer && s.renaming === 0 && s.content.status === "Loaded");
    expect(shownText()).toBe("The words of retained.txt");

    world.files.pickerRenameNeedsReselection = true;
    await choose("Rename", "File actions");
    await fill("Name", "reselect.txt");
    await pressOnTop("Rename");
    await until(alpha, runtime, Shown, (s) => s.viewer > pickedViewer && s.renaming === 0 && !s.reachable);
    expect(document.querySelector("[aria-label='Preview']")?.textContent).toContain("reselect.txt");
    world.files.selectedByPicker = "Download/reselect.txt";
    await press("Select again");
    await until(alpha, runtime, Shown, (s) => s.content.status === "Loaded" && s.reachable);
    expect(shownText()).toBe("The words of reselect.txt");
    await hardware("back");
    await until(alpha, runtime, Shown, (s) => s.viewer === 0);
    // spec/app/files/recent.md, "A file selected again takes the place of its lapsed row": restored.txt stands where notes.txt was, ahead of code.txt, which still holds its access
    expect(runtime.runSync(Recent.use((m) => m.get())).rows.map((row) => [row.origin, row.grant > 0])).toEqual([["Picked", true], ["InFolder", true]]);

    // spec/app/files/preview.md, "Rename, Move to and Move to Trash act on the storage-backed preview still showing"
    await press("code.txt");
    await until(alpha, runtime, Shown, (s) => s.content.status === "Loaded" && s.secret);
    const previousViewer = runtime.runSync(Shown.use((m) => m.get())).viewer;
    await press("Rename code.txt");
    await fill("Name", "codes.txt");
    await pressOnTop("Rename");
    await until(alpha, runtime, Shown, (s) => s.content.status === "Loaded" && s.viewer > previousViewer);
    expect([paths(world).includes("primary:Download/codes.txt"), document.querySelector("[aria-label='Preview']")?.textContent?.includes("codes.txt")]).toEqual([true, true]);

    await choose("Add to folder", "File actions");
    await until(alpha, runtime, Browser, (s) => s.sheet.open && s.sheet.reading.status === "Loaded");
    expect(runtime.runSync(Browser.use((m) => m.get())).picked).toHaveLength(1);
    await hardware("back");
    await until(alpha, runtime, Browser, (s) => !s.sheet.open);
    await press("Close");
    await until(alpha, runtime, Shown, (s) => s.viewer === 0);
    await press("Cancel");
    await press("codes.txt");
    await until(alpha, runtime, Shown, (s) => s.content.status === "Loaded");
    await choose("Delete", "File actions");
    await until(alpha, runtime, Browser, (s) => s.deleting.showing);
    await pressOnTop("Delete");
    await until(alpha, runtime, Shown, (s) => s.viewer === 0);
    expect(world.files.trash.map((row) => row.was.path)).toEqual(["Download/codes.txt"]);

  });

  it('Offer the file I am looking at to Inbox (spec/app/files/preview.md, "Story: Act on the file I am looking at"; spec/app/inbox/adding.md, "Story: Add files and people to my draft")', async () => {
    const { alpha, runtime, world } = await onFiles(undefined, "view:Inbox");
    const content = "A reviewed attachment";
    world.files.stored.push({ volume: "primary", path: "Download/attach.txt", directory: false, mimeType: "text/plain", size: content.length, modified: 12 });
    world.files.texts["Download/attach.txt"] = content;
    await hardware("home");
    await openFromHome("Inbox");
    await until(alpha, alpha.runtime, Inbox, (state) => state.signedIn && state.selected.account !== 0 && state.accounts.status === "Loaded");
    await hardware("home");
    await openFromHome("Files");
    await until(alpha, runtime, Browser, (state) => state.open && state.storage.status === "Loaded");
    await press("Internal storage");
    await press("Download");
    await until(alpha, runtime, Browser, (state) => state.listing.status === "Loaded" && state.items.some((item) => item.name === "attach.txt"));
    await press("attach.txt");
    await until(alpha, runtime, Shown, (state) => state.content.status === "Loaded");

    await choose("Email", "File actions");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.at(-1) === "Inbox");
    await until(alpha, runtime, Shown, (state) => state.attempt.outcome === "Confirmed");
    expect(alpha.runtime.runSync(Drafts.use((model) => model.get())).open).toBe(false);
    await pressOnTop("New email");

    await until(alpha, alpha.runtime, Drafts, (state) => state.open && state.letter.attachments === 1);
    const draft = alpha.runtime.runSync(Drafts.use((model) => model.get())).letter.id;
    const words = alpha.runtime.runSync(Letters.use((letters) => Effect.sync(() => letters.words(draft))));
    expect(words.files).toEqual([{ name: "attach.txt", mimeType: "text/plain", size: content.length, data: btoa(content) }]);
    expect(world.inbox.changes.some((change) => change.startsWith("send "))).toBe(false);
  });

  it("Let the agent read my files (spec/app/files/index.md, \"Story: Let the agent read my files\")", async () => {
    const { alpha, runtime, world } = await onDownloads();
    const now = () => runtime.runSync(Effect.flatMap(Browser, (machine) => machine.get()));
    // spec/app/files/index.md, "The phone offers Files to an agent that takes Files' operations, and naming files by their place among the results shown only beside them; a request the phone cannot take is never shown for approval"
    expect(await runtime.runPromise(offer)).toEqual({ operations: true, positions: true });

    // spec/app/files/index.md, "The agent reads a folder for itself, and only its newest reading is told to it; it is told it failed without access or on a protected screen"
    // spec/app/files/index.md, "The agent's reading and opening change nothing the owner is working on"
    const read = await runtime.runPromise(agentRead(1, { volume: "primary", path: "Documents" }, { ...everything, text: "NOTES" }, false));
    expect([read.ok, read.items.map((item) => item.name), now().trail.length, now().items.length]).toEqual([true, ["notes.txt"], 2, 2]);
    expect((await runtime.runPromise(agentRead(2, { volume: "primary", path: "Documents" }, everything, true))).ok).toBe(false);

    // spec/app/files/index.md, "An approved filter for a named folder goes to that folder before it searches"
    const targeted = await runtime.runPromise(fileAction({ type: "files_filter", folder: "Documents", text: "notes" }, { attemptId: 1, proposalId: "targeted-filter", operationId: "targeted-filter" }));
    expect([targeted?.kind, now().search.hits.map((item) => item.name)]).toEqual(["applied", ["notes.txt"]]);

    const dated = Date.parse("2026-03-04T12:00:00Z");
    world.files.stored.push(
      { volume: "primary", path: "Download/during.pdf", directory: false, mimeType: "application/pdf", size: 10, modified: dated },
      { volume: "primary", path: "Download/earlier.pdf", directory: false, mimeType: "application/pdf", size: 10, modified: dated - 86_400_000 },
      { volume: "primary", path: "Download/plain.pdf", directory: false, mimeType: "text/plain", size: 10, modified: dated },
    );
    const filter = { type: "files_filter", folder: "Download", kind: "pdf", from: "2026-03-04T00:00:00Z", to: "2026-03-04T23:59:59Z" } as const;
    const filteredByDate = await runtime.runPromise(fileAction(filter, { attemptId: 1, proposalId: "dated-pdfs", operationId: "dated-pdfs" }));
    expect([filteredByDate?.kind, now().search.hits.map((item) => item.name)]).toEqual(["applied", ["during.pdf"]]);

    // spec/app/files/index.md, "The agent sets the owner's filter on Files on screen, and is told how many it found; otherwise it is told it failed"
    const filtered = await runtime.runPromise(agentFilter(3, { ...everything, kind: "Image", anyKind: false }, false));
    expect([filtered.ok, filtered.items.map((item) => item.name), now().search.filter.kind]).toEqual([true, ["beach.jpg"], "Image"]);
    // spec/app/files/index.md, "A position names a result on screen, counting from one; a request naming a position that is not shown names nothing and leaves no card, and a card keeps the files it showed"
    const [first] = await runtime.runPromise(shownAt([1]));
    expect([first?.name, (await runtime.runPromise(shownAt([2]))).length]).toEqual(["beach.jpg", 0]);

    // spec/app/files/index.md, "The agent opens a file the owner is shown, as listed or found now, when no file is open over Files; otherwise it is told it failed"
    const beach = now().items.find((item) => item.name === "beach.jpg");
    if (!beach) throw new Error("beach.jpg is not listed");
    expect((await runtime.runPromise(agentOpen(4, beach, false))).ok).toBe(true);
    await until(alpha, runtime, Shown, (s) => s.viewer !== 0 && s.item === beach.id);
    expect((await runtime.runPromise(agentOpen(5, beach, false))).ok).toBe(false);
    await press("Close");
    await until(alpha, runtime, Shown, (s) => s.viewer === 0);
    await press("Clear the filter");
    await until(alpha, runtime, Browser, (s) => !s.search.searching);

    // spec/app/files/index.md, "An approved request runs only in Files on screen, in the folder the owner approved, on a screen that is not protected, and on the item as it was shown; otherwise the agent is told it did not run"
    // spec/app/files/index.md, "An approved request acts on its own item alone, in the folder showing, and never while Files is away"
    const lease = now().items.find((item) => item.name === "lease.pdf");
    if (!lease) throw new Error("lease.pdf is not listed");
    const folder = now().trail.at(-1) ?? 0;
    const nowhere = { folder: 0, path: [], names: [] };
    expect(await runtime.runPromise(approved({ ticket: 7, act: "Naming", file: lease, folder, name: "lease 2026.pdf", dest: nowhere }, true))).toEqual({ ran: false, outcome: "Refused" });
    expect(await runtime.runPromise(approved({ ticket: 8, act: "Naming", file: lease, folder, name: "lease 2026.pdf", dest: nowhere }, false))).toEqual({ ran: true, outcome: "Confirmed" });
    expect(paths(world).includes("primary:Download/lease 2026.pdf")).toBe(true);
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.items.some((item) => item.name === "lease 2026.pdf"));
    const path = "Download/lease 2026.pdf";
    const reviewed = () => runtime.runPromise(called("storageReviewedIdentities", (plugin) => plugin.storageReviewedIdentities({ volume: "primary", paths: [path] })));
    const before = await reviewed();
    if (!before.reviewed) throw new Error("the renamed lease cannot be reviewed");
    const renamed = world.files.stored.find((one) => one.path === path);
    if (!renamed) throw new Error("the renamed lease is not listed");
    renamed.modified = 77;
    world.files.changed();
    await until(alpha, runtime, Browser, (s) => s.items.some((item) => item.name === "lease 2026.pdf" && item.revision === 77));
    const call = { attemptId: 1, proposalId: "delete-lease", operationId: "delete-lease" };
    expect(await runtime.runPromise(fileAction({ type: "files_trash", paths: [path], reviewed: before.reviewed }, call))).toEqual({ kind: "refused", code: "FILES_UNCHANGED" });
    expect(paths(world).includes(`primary:${path}`)).toBe(true);
    const after = await reviewed();
    if (!after.reviewed) throw new Error("the changed lease cannot be reviewed");
    expect(await runtime.runPromise(fileAction({ type: "files_trash", paths: [path], reviewed: after.reviewed }, { ...call, proposalId: "delete-reviewed-lease", operationId: "delete-reviewed-lease" }))).toEqual({ kind: "applied" });
    expect(world.files.trash.map((one) => one.was.path)).toEqual([path]);

    const ask = async (operation: DeviceOperation, proposalId: string) => {
      const review = await runtime.runPromise(reviewFileAction(operation));
      if (review === undefined) throw new Error(`Files could not review ${operation.type}`);
      return { review, call: { attemptId: 1, operationId: proposalId, proposalId } };
    };

    // spec/app/files/index.md, "A reviewed exact path opens its file or folder; a shown position is bound to the same path at review"
    const elsewhere = { type: "files_open", path: "Documents/notes.txt" } as const;
    const openedFile = await ask(elsewhere, "open-another-folder-file");
    expect(await runtime.runPromise(fileAction(elsewhere, openedFile.call, openedFile.review))).toEqual({ kind: "applied" });
    await until(alpha, runtime, Shown, (state) => state.content.status === "Loaded" && state.kind === "Text");
    expect([shownText(), now().trail.at(-1)]).toEqual(["The words of notes.txt", folder]);
    await press("Close");
    await until(alpha, runtime, Shown, (state) => state.viewer === 0);

    const documentFolder = { type: "files_open", path: "Documents" } as const;
    const openedFolder = await ask(documentFolder, "open-documents-folder");
    expect(await runtime.runPromise(fileAction(documentFolder, openedFolder.call, openedFolder.review))).toEqual({ kind: "applied" });
    await until(alpha, runtime, Browser, (state) => state.listing.status === "Loaded" && state.items.some((item) => item.name === "notes.txt"));
    const folders = await runtime.runPromise(agentFilter(12, { ...everything, kind: "Folder", anyKind: false }, false));
    expect(folders.items.map((row) => row.name)).toEqual(["Old"]);
    const position = { type: "files_open", shown: 1 } as const;
    const openedPosition = await ask(position, "open-shown-folder");
    expect(await runtime.runPromise(fileAction(position, openedPosition.call, openedPosition.review))).toEqual({ kind: "applied" });
    await until(alpha, runtime, Browser, (state) => state.trail.length === 3 && state.listing.status === "Loaded");
    expect(document.querySelector("nav[aria-label='Folder path']")?.textContent).toContain("Old");
    await press("Clear the filter");
    await choose("Browse storage");
    await press("Internal storage");
    await press("Download");
    await until(alpha, runtime, Browser, (state) => state.trail.at(-1) === folder && state.listing.status === "Loaded");

    // spec/app/files/index.md, "A reviewed batch runs once for the paths shown in the review, as one move, Trash job or Android share"
    const pdfs = { ...everything, kind: "Pdf", anyKind: false } as const;
    await runtime.runPromise(agentFilter(15, pdfs, false));
    const sharing = { type: "files_share", shown: [1, 2] } as const;
    const share = await ask(sharing, "share-two");
    await runtime.runPromise(agentFilter(16, { ...pdfs, text: "earlier" }, false));
    expect(await runtime.runPromise(fileAction(sharing, share.call, share.review))).toEqual({ kind: "applied" });
    expect(world.files.shared).toEqual([["Download/during.pdf", "Download/earlier.pdf"]]);

    const moving = { type: "files_move", paths: ["Download/during.pdf", "Documents/notes.txt"], dest: "Documents/Old" } as const;
    const move = await ask(moving, "move-two");
    const changed = world.files.stored.find((item) => item.path === "Download/during.pdf");
    if (changed === undefined) throw new Error("the reviewed file is missing from the phone");
    changed.modified += 1;
    expect(await runtime.runPromise(fileAction(moving, move.call, move.review))).toEqual({ kind: "applied" });
    expect([paths(world).includes("primary:Download/during.pdf"), paths(world).includes("primary:Documents/Old/notes.txt"), world.files.calls.filter((method) => method === "move").length]).toEqual([true, true, 1]);

    // spec/app/files/index.md, "An approved new folder is created once in the exact parent shown on the approval"
    const creating = { type: "files_folder_create", parent: "Documents/Old", name: "Reviewed folder" } as const;
    const staleParent = await ask(creating, "new-folder-stale-parent");
    const parent = world.files.stored.find((item) => item.path === creating.parent);
    if (parent === undefined) throw new Error("the phone's named parent is missing");
    parent.modified += 1;
    expect(await runtime.runPromise(fileAction(creating, staleParent.call, staleParent.review))).toEqual({ kind: "refused", code: "FILES_UNCHANGED" });
    const newFolder = await ask(creating, "new-folder");
    expect(await runtime.runPromise(fileAction(creating, newFolder.call, newFolder.review))).toEqual({ kind: "applied" });
    expect([paths(world).includes("primary:Documents/Old/Reviewed folder"), now().trail.at(-1)]).toEqual([true, folder]);

    const deleting = { type: "files_trash", paths: ["Download/during.pdf", "Download/earlier.pdf"] } as const;
    const deletion = await ask(deleting, "trash-two");
    expect(await runtime.runPromise(fileAction(deleting, deletion.call, deletion.review))).toEqual({ kind: "applied" });
    expect(world.files.trash.map((one) => one.was.path).sort()).toEqual([path, "Download/during.pdf", "Download/earlier.pdf"].sort());

    await hardware("home");
    expect(await runtime.runPromise(approved({ ticket: 10, act: "Deleting", file: beach, folder, name: "", dest: nowhere }, false))).toEqual({ ran: false, outcome: "Refused" });
  });

  it('Opens or filters only what the owner asked for directly (spec/app/files/index.md, "An explicit request to open or filter Files may act directly on the same idle Files view")', async () => {
    const world = { ...scene(), phone: true, image: true };
    const filter = { type: "files_filter", kind: "pdf", folder: "Download" } as const;
    const review = textReview(world.notes.owner, "asked-filter", filter);
    world.telephony.textReview = review;
    const { alpha, runtime } = await onFiles(world, "assistant");
    const chat = assistant.runtime(alpha);
    await until(alpha, runtime, Browser, (s) => s.access === "Granted" && s.storage.status === "Loaded");
    await until(alpha, alpha.runtime, Preferences, (s) => s.document.read.status === "Loaded" && !s.askFirst);
    await until(alpha, chat, Conversation, (s) => s.ready);
    await press("Open conversation");
    await until(alpha, alpha.runtime, Shell, (s) => s.assistant === "Sheet");

    const send = async (id: string, text: string, proposed: "Nothing" | "Review" | "Direct") => {
      review.proposal.id = id;
      review.proposal.state = "pending";
      const reads = review.pendingReads;
      world.ask.nextReplyChunks = [proposed === "Nothing" ? "Your Downloads hold a lease and a photo." : "I found a Files action."];
      world.ask.nextActions = (metadata) => {
        expect(readTurnContext({ content: { metadata } }).voiceUi?.agentActionMode).toBe("direct-files-v1");
        review.proposal.payload.requestMessageId = proposed === "Nothing" ? undefined : `m${world.ask.said.length}u`;
        return proposed === "Nothing" ? [] : [{ action: "PROPOSE_DEVICE_ACTION", data: { proposalId: id, state: "pending", executed: false, approvalRequired: proposed === "Review",
          ...(proposed === "Direct" ? { awaitingDeviceExecution: true, directRequest: true } : { awaitingUserInput: true }) } }];
      };
      await sendChat(text);
      await until(alpha, chat, Conversation, (s) => review.pendingReads > reads && s.turn.reply === "Complete");
    };
    const before = runtime.runSync(Browser.use((m) => m.get()));

    await send("no-files-request", "What is in my Downloads?", "Nothing");
    const after = runtime.runSync(Browser.use((m) => m.get()));
    expect([button("Approve"), review.decisions, review.claims, after.trail, after.search.filter]).toEqual([undefined, [], [], before.trail, before.search.filter]);

    const changes = [
      ["move-lease", "put the lease in my documents", { type: "files_move", paths: ["Download/lease.pdf"], dest: "Documents" }],
      ["share-lease", "send the lease to someone", { type: "files_share", paths: ["Download/lease.pdf"] }],
      ["trash-lease", "get rid of the lease", { type: "files_trash", paths: ["Download/lease.pdf"] }],
      ["taxes-folder", "make a taxes folder in downloads", { type: "files_folder_create", parent: "Download", name: "Taxes" }],
    ] as const;
    for (const [id, text, change] of changes) {
      review.proposal.payload.operation = change;
      await send(id, text, "Review");
      await vi.waitFor(() => expect(button("Approve")).toBeDefined());
      expect([review.decisions, review.claims, world.files.shared, world.files.trash]).toEqual([[], [], [], []]);
    }

    review.proposal.payload.operation = filter;
    await send("asked-filter", "only the pdfs from my downloads please", "Direct");
    await vi.waitFor(() => expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied", operationId: "asked-filter" })]));
    expect(document.body.textContent).toContain("Showing 1 item in Files.");
    expect(button("Approve")).toBeUndefined();

    // spec/app/assistant/context.md, "A turn an agent refuses whole for a direct-request mode it does not know is sent once more without it"
    world.ask.knowsNoActionMode = true;
    world.ask.metadata = [];
    world.ask.nextReplyChunks = ["Your Downloads hold a lease and a photo."];
    await fill("Message Alpha", "what is in my downloads?");
    await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
    await press("Send");
    await until(alpha, chat, Conversation, (s) => s.turn.reply === "Complete");
    expect(world.ask.metadata.map((one) => readTurnContext({ content: { metadata: one } }).voiceUi?.agentActionMode)).toEqual(["direct-files-v1", undefined]);
    expect(document.body.textContent).toContain("Your Downloads hold a lease and a photo.");
    world.ask.knowsNoActionMode = false;

    review.proposal.payload.operation = { type: "files_open", path: "Documents/notes.txt" };
    world.files.refusing.push("readSelected");
    await send("refused-open", "open my notes file", "Direct");
    await vi.waitFor(() => expect(review.receipts.at(-1)).toMatchObject({ outcome: "failed", operationId: "refused-open" }));
    expect(document.body.textContent).not.toContain("Opened the requested item in Files.");
  });

  it('Opens Files once from Home for a complete exact request (spec/app/files/index.md, "An exact Files request from another screen may open Files once after the typed reply finishes")', async () => {
    const world = { ...scene(), phone: true, image: true };
    const filter = { type: "files_filter", kind: "pdf", folder: "Download" } as const;
    const openNotes = { type: "files_open", path: "Documents/notes.txt" } as const;
    const allPdfs = { type: "files_filter", kind: "pdf" } as const;
    const firstShown = { type: "files_open", shown: 1 } as const;
    const review = textReview(world.notes.owner, "home-filter", filter);
    const { alpha, chat, storage } = await withFilesReviewOnHome(world, review);
    await openFromHome("Files");
    await until(alpha, storage, Browser, (s) => s.open && s.storage.status === "Loaded");
    await press("Internal storage");
    await until(alpha, storage, Browser, (s) => s.listing.status === "Loaded" && s.trail.length === 1);
    await openRow("Documents");
    await until(alpha, storage, Browser, (s) => s.listing.status === "Loaded" && s.trail.length === 2);
    await hardware("home");
    await until(alpha, storage, Browser, (s) => !s.open && s.trail.length === 2);

    const panel = () => until(alpha, alpha.runtime, Shell, (s) => s.assistant === "Sheet");
    const fromHome = async () => {
      await until(alpha, alpha.runtime, Shell, (s) => s.trail.length === 0 && s.assistant === "Bar");
      await press("Open conversation");
      await panel();
    };
    const send = async (id: string, text: string, operation: typeof filter | typeof allPdfs | typeof openNotes | typeof firstShown) => {
      review.proposal.id = id;
      review.proposal.state = "pending";
      review.proposal.payload.operation = operation;
      world.ask.nextReplyChunks = ["I found a Files action."];
      const received = Promise.withResolvers<ReturnType<typeof readTurnContext>>();
      world.ask.nextActions = (metadata) => {
        received.resolve(readTurnContext({ content: { metadata } }));
        review.proposal.payload.requestMessageId = `m${world.ask.said.length}u`;
        return [{ action: "PROPOSE_DEVICE_ACTION", data: { proposalId: id, state: "pending", executed: false, approvalRequired: false, awaitingDeviceExecution: true, directRequest: true } }];
      };
      await sendChat(text);
      const context = await received.promise;
      expect(context.voiceUi?.agentActionMode).toBe("direct-files-v1");
    };

    await fromHome();
    world.ask.holdAfterTools = true;
    await send("cancel-at-source", "Show PDFs in Download", filter);
    expect(world.ask.turns.size).toBe(1);
    expect([review.claims, review.journal.size, world.files.calls.includes("storageQuery")]).toEqual([[], 0, false]);
    await hardware("back");
    await fromHome();
    await drawn(() => world.ask.turns.values().next().value?.());
    await until(alpha, chat, Conversation, (s) => s.turn.reply === "Complete");
    expect([review.claims, review.journal.size, world.files.calls.includes("storageQuery")]).toEqual([[], 0, false]);

    const filterGate = Promise.withResolvers<void>();
    world.files.gate = filterGate.promise;
    await send("home-filter", "just my pdfs", allPdfs);
    await until(alpha, alpha.runtime, Shell, (s) => s.trail.join("/") === "Files" && s.assistant === "Sheet");
    await until(alpha, storage, Browser, (s) => s.open && s.storage.status === "Loading");
    expect([review.claims, review.journal.has("home-filter"), review.receipts, world.files.calls.includes("storageQuery")])
      .toEqual([["home-filter"], true, [], false]);
    filterGate.resolve();
    await until(alpha, storage, Browser, (s) => s.trail.length === 0 && !s.inCategory
      && s.search.query.status === "Loaded" && s.search.hits.some((one) => one.name === "lease.pdf"));
    await vi.waitFor(() => expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied", operationId: "home-filter" })]));

    await hardware("home");
    await fromHome();
    const fileGate = Promise.withResolvers<void>();
    world.files.gate = fileGate.promise;
    await send("cancel-in-files", "Open Documents/notes.txt", openNotes);
    await until(alpha, alpha.runtime, Shell, (s) => s.trail.join("/") === "Files" && s.assistant === "Sheet");
    await until(alpha, storage, Browser, (s) => s.open && s.storage.status === "Loading");
    expect(review.journal.has("cancel-in-files")).toBe(true);
    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (s) => s.trail.join("/") === "Files" && s.assistant === "Bar");
    await press("Open conversation");
    await panel();
    fileGate.resolve();
    await vi.waitFor(() => expect(review.receipts).toHaveLength(2));
    expect(review.receipts.at(-1)).toMatchObject({ operationId: "cancel-in-files" });
    expect(review.receipts.at(-1)).not.toMatchObject({ outcome: "applied" });
    expect(world.files.calls).not.toContain("storageSelect");

    await hardware("home");
    await fromHome();
    const reads = review.pendingReads;
    await send("ordinal-without-results", "Open item 1", firstShown);
    await until(alpha, chat, Conversation, (s) => s.turn.reply === "Complete" && review.pendingReads > reads);
    expect(review.claims).toEqual(["home-filter", "cancel-in-files"]);

    await send("home-open", "open the notes file in my documents", openNotes);
    await until(alpha, storage, Shown, (s) => s.kind === "Text" && s.content.status === "Loaded");
    await vi.waitFor(() => expect(review.receipts.at(-1)).toMatchObject({ outcome: "applied", operationId: "home-open" }));
    expect(world.files.calls.filter((call) => call === "storageSelect")).toHaveLength(1);
    await until(alpha, alpha.runtime, Shell, (s) => s.trail.join("/") === "Files");
  });

  it('Shows a change asked away from Files as a notice, and its card once Files is open (spec/app/files/index.md, "A change the agent proposes while Files is not on screen shows a notice to open Files, and its card is built in Files, for Files as it then shows")', async () => {
    const world = { ...scene(), phone: true, image: true };
    const move = { type: "files_move", paths: ["Download/lease.pdf"], dest: "Documents" } as const;
    const review = textReview(world.notes.owner, "move-lease", move);
    const { alpha, chat, storage } = await withFilesReviewOnHome(world, review);
    const askFromHome = async (id: string, text: string) => {
      await until(alpha, alpha.runtime, Shell, (s) => s.trail.length === 0);
      if (alpha.runtime.runSync(Effect.flatMap(Shell, (m) => m.get())).assistant !== "Sheet") await press("Open conversation");
      await until(alpha, alpha.runtime, Shell, (s) => s.assistant === "Sheet");
      review.proposal.id = id;
      review.proposal.state = "pending";
      const reads = review.pendingReads;
      world.ask.nextReplyChunks = ["Review this request on your phone before it can run."];
      world.ask.nextActions = (metadata) => {
        expect(readTurnContext({ content: { metadata } }).voiceUi?.agentActionMode).toBe("direct-files-v1");
        review.proposal.payload.requestMessageId = `m${world.ask.said.length}u`;
        return [{ action: "PROPOSE_DEVICE_ACTION", data: { proposalId: id, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true } }];
      };
      await sendChat(text);
      await until(alpha, chat, Conversation, (s) => review.pendingReads > reads && s.turn.reply === "Complete");
    };
    const openFiles = async () => {
      await press("Minimize chat");
      await until(alpha, alpha.runtime, Shell, (s) => s.assistant === "Bar");
      await openFromHome("Files");
      await until(alpha, storage, Browser, (s) => s.open && s.storage.status === "Loaded");
      await press("Open conversation");
      await until(alpha, alpha.runtime, Shell, (s) => s.trail.join("/") === "Files" && s.assistant === "Sheet");
    };

    await askFromHome("move-lease", "put the lease in my documents");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Open Files to review this action."));
    expect([button("Approve"), review.decisions, review.claims, paths(world).includes("primary:Download/lease.pdf")]).toEqual([undefined, [], [], true]);

    await openFiles();
    await vi.waitFor(() => expect(button("Approve")).toBeDefined());
    expect(document.body.textContent).not.toContain("Open Files to review this action.");
    expect([review.decisions, review.claims, paths(world).includes("primary:Download/lease.pdf")]).toEqual([[], [], true]);
    await press("Approve");
    await vi.waitFor(() => expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied" })]));
    expect([review.decisions, paths(world).includes("primary:Documents/lease.pdf")]).toEqual([["move-lease"], true]);

    await hardware("home");
    review.proposal.payload.operation = { type: "files_trash", paths: ["Documents/lease.pdf"] };
    await askFromHome("trash-lease", "get rid of the lease");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Open Files to review this action."));
    review.proposal.state = "expired";
    await openFiles();
    await later(alpha, 300);
    expect([button("Approve"), document.body.textContent?.includes("Open Files to review this action."), review.decisions]).toEqual([undefined, false, ["move-lease"]]);
  });

  it("Come back after a restart (spec/app/files/index.md, \"Story: Come back after a restart\"; spec/app/files/change.md, \"Story: Come back to my changes after a restart\"; spec/app/files/trash.md, \"Story: Come back to the Trash after a restart\"; spec/app/files/preview.md, \"Story: Come back to a preview after a restart\")", async () => {
    const world = { ...scene(), phone: true };
    // spec/app/files/recent.md, "The earlier Alpha's Recent is carried over once, while this one is still empty: each document it held access to becomes a row of its own, the newest first; one it held without access, and the document it had open, are not carried"
    const leaseSelection = crypto.randomUUID();
    world.files.selections.set(leaseSelection, { volume: "primary", path: "Download/lease.pdf", canRename: true });
    localStorage.setItem("alpha.files.recent.v1", JSON.stringify([
      { key: "selected:a", kind: "selected", name: "lease.pdf", mimeType: "application/pdf", openedAt: 2, status: "ready", selectionId: leaseSelection },
      { key: "selected:b", kind: "selected", name: "gone.txt", mimeType: "text/plain", openedAt: 3, status: "revoked", selectionId: "b" },
    ]));
    world.files.selections.set("b", { volume: "primary", path: "Download/gone.txt", canRename: true });
    world.files.selections.set("c", { volume: "primary", path: "Documents/notes.txt", canRename: true });
    localStorage.setItem("alpha.files.open.v1", "c");
    const first = await onFiles(world);
    await until(first.alpha, first.runtime, Recent, (s) => s.rows.length === 1 && s.rows[0]?.origin === "Picked");
    expect(localStorage.getItem("alpha.files.recent.v1")).toBeNull();
    await vi.waitFor(() => expect([[...world.files.forgotten].sort(), localStorage.getItem("alpha.files.open.v1")]).toEqual([["b", "c"], null]));
    await until(first.alpha, first.runtime, Browser, (s) => s.open && s.storage.status === "Loaded");
    await press("lease.pdf");
    await until(first.alpha, first.runtime, Shown, (s) => s.drawing.status === "Loaded" && s.kind === "Pdf" && s.revision === 5);
    // spec/app/files/preview.md, "A picked document is renamed through its provider using the access held for the viewer"
    await choose("Rename", "File actions");
    await fill("Name", "retained-lease.pdf");
    await pressOnTop("Rename");
    await until(first.alpha, first.runtime, Shown, (s) => s.drawing.status === "Loaded" && s.renaming === 0 && s.revision === world.files.now);
    expect(paths(world)).toContain("primary:Download/retained-lease.pdf");
    await press("Close");
    await until(first.alpha, first.runtime, Browser, (s) => s.storage.status === "Loaded");
    await press("Internal storage");
    await openRow("Documents");
    await until(first.alpha, first.runtime, Browser, (s) => s.listing.status === "Loaded" && s.trail.length === 2);
    await choose("Name A–Z");
    await choose("Grid view");
    await press("notes.txt");
    await until(first.alpha, first.runtime, Shown, (s) => s.content.status === "Loaded");
    await first.close();

    // spec/app/files/index.md, "A restart closes Files, keeps the access, the place, the layout and the sort, reports a change cut off as unknown, and tells the agent its waiting requests failed"
    // spec/app/files/recent.md, "A restart ends the folder session, closes the pickers, the viewer and the opening under way, and keeps the list"
    const second = await onFiles(world);
    await until(second.alpha, second.runtime, Browser, (s) => s.open && s.listing.status === "Loaded" && s.trail.length === 2);
    await until(second.alpha, second.runtime, Browser, (s) => s.layout === "Grid" && s.order === "ByName");
    await until(second.alpha, second.runtime, Shown, (s) => s.viewer === 0);
    await until(second.alpha, second.runtime, Recent, (s) => s.rows.length === 2 && s.rows.filter((row) => row.grant === 0).length === 1);
    await choose("Browse storage");
    await press("retained-lease.pdf");
    await until(second.alpha, second.runtime, Shown, (s) => s.drawing.status === "Loaded" && s.revision === world.files.now);
    await press("Close");
    await press("Internal storage");
    await openRow("Documents");
    await until(second.alpha, second.runtime, Browser, (s) => s.listing.status === "Loaded" && s.trail.length === 2);

    // spec/app/files/change.md, "A restart reports a change or a share cut off as unknown, the change's items unknown too, and closes the choice and the sheet"
    await select("notes.txt");
    await press("Share");
    await until(second.alpha, second.runtime, Browser, (s) => s.change.panel !== 0);
    await second.close();
    const third = await onFiles(world);
    await until(third.alpha, third.runtime, Browser, (s) => s.open && s.listing.status === "Loaded" && s.change.panel === 0 && s.picked.length === 0);
  });

  it("Delete into the Trash and bring it back (spec/app/files/trash.md, \"Story: Delete into the Trash\"; spec/app/files/trash.md, \"Story: See what is in the Trash\"; spec/app/files/trash.md, \"Story: Bring something back\"; spec/app/files/trash.md, \"Story: Erase for good\")", async () => {
    const { alpha, runtime, world } = await onDownloads();

    // spec/app/files/index.md, "Deleting shows what goes to the Trash, and only a confirmation of the selection as shown hands it over"
    await select("lease.pdf");
    await press("Delete");
    await pressOnTop("Delete");
    // spec/app/files/trash.md, "Undo, for a moment, brings back exactly what was just deleted and nothing else"
    await until(alpha, runtime, Bin, (s) => s.attempt.outcome === "Confirmed" && s.binned.length === 1);
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.items.length === 1);
    expect(world.files.trash.map((one) => one.was.path)).toEqual(["Download/lease.pdf"]);
    await press("Undo");
    await until(alpha, runtime, Bin, (s) => s.attempt.outcome === "Confirmed" && s.job.kind === "Binning" && s.binned.length === 0);
    expect([world.files.trash.length, paths(world).includes("primary:Download/lease.pdf")]).toEqual([0, true]);

    await choose("Refresh");
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.items.length === 2);
    await select("beach.jpg");
    await press("Delete");
    await pressOnTop("Delete");
    await until(alpha, runtime, Bin, (s) => s.binned.length === 1);
    await later(alpha, 5_000);
    expect(button("Undo")).toBeUndefined();

    // spec/app/files/trash.md, "A job ends as its answer says for each item: only what the phone confirmed is done, and the rest was refused or is unknown": a file changed since it was shown is not put in the Trash
    await choose("Refresh");
    await until(alpha, runtime, Browser, (s) => s.listing.status === "Loaded" && s.items.length === 1);
    await select("lease.pdf");
    const lease = world.files.stored.find((one) => one.path === "Download/lease.pdf");
    if (lease) lease.modified = 77;
    await press("Delete");
    await pressOnTop("Delete");
    await until(alpha, runtime, Bin, (s) => s.attempt.outcome === "Refused" && s.binned.length === 0);
    expect(paths(world).includes("primary:Download/lease.pdf")).toBe(true);

    // spec/app/files/trash.md, "Looking at the Trash reads its list when it is free and Alpha may read the storage; leaving it, or losing access, drops the list but what a job or the moment to undo still holds"
    await choose("Browse storage");
    await press("Trash");
    await until(alpha, runtime, Bin, (s) => s.open && s.listing.status === "Loaded");
    // spec/app/files/trash.md, "The owner restores a listed item before its time, from a list read since the last job"
    // spec/app/files/trash.md, "The owner opens a listed Trash item's details and can restore or ask to erase that same item"
    await press("beach.jpg");
    await until(alpha, runtime, Bin, (s) => s.details !== 0);
    expect([...document.querySelectorAll("[role=dialog]")].at(-1)?.textContent).toContain("Internal storage › Download");
    await hardware("back");
    await until(alpha, runtime, Bin, (s) => s.open && s.details === 0);
    await press("beach.jpg");
    await pressOnTop("Restore");
    await until(alpha, runtime, Bin, (s) => s.attempt.outcome === "Confirmed" && s.entries.length === 0 && s.listing.status === "Loaded");
    expect(paths(world).includes("primary:Download/beach.jpg")).toBe(true);

    // spec/app/files/trash.md, "Confirming erases exactly the entries shown"
    world.files.trash.push({ id: "9", was: { volume: "primary", path: "Download/old.txt", directory: false, mimeType: "text/plain", size: 1, modified: 1 }, deletedAt: world.files.now });
    await press("Refresh");
    await until(alpha, runtime, Bin, (s) => s.listing.status === "Loaded" && s.entries.length === 1);
    await press("old.txt");
    await pressOnTop("Delete now");
    await pressOnTop("Delete");
    await until(alpha, runtime, Bin, (s) => s.attempt.outcome === "Confirmed" && s.entries.length === 0);
    expect(world.files.trash).toEqual([]);

    // spec/app/files/trash.md, "A job ends as its answer says for each item: only what the phone confirmed is done, and the rest was refused or is unknown"
    world.files.trash.push({ id: "12", was: { volume: "primary", path: "Download/c.txt", directory: false, mimeType: "text/plain", size: 1, modified: 1 }, deletedAt: world.files.now });
    world.files.refusing.push("storageRestore");
    await press("Refresh");
    await until(alpha, runtime, Bin, (s) => s.listing.status === "Loaded" && s.entries.length === 1);
    await press("c.txt");
    await pressOnTop("Restore");
    await until(alpha, runtime, Bin, (s) => s.attempt.outcome === "Refused" && s.listing.status === "Loaded");
    world.files.refusing.splice(0);

    // spec/app/files/trash.md, "The owner marks listed entries, one by one or every one, and a mark lasts while its entry is listed and no job has started"
    // spec/app/files/trash.md, "The owner brings back the marked entries that are still kept, together, from a list read since the last job"
    world.files.trash.push({ id: "13", was: { volume: "primary", path: "Download/d.txt", directory: false, mimeType: "text/plain", size: 1, modified: 1 }, deletedAt: world.files.now });
    await press("Refresh");
    await until(alpha, runtime, Bin, (s) => s.listing.status === "Loaded" && s.entries.length === 2);
    await press("Select items");
    await press("Select c.txt");
    await press("Select d.txt");
    await press("Restore");
    await until(alpha, runtime, Bin, (s) => s.attempt.outcome === "Confirmed" && s.entries.length === 0 && s.listing.status === "Loaded");
    expect(paths(world).filter((path) => path.endsWith("c.txt") || path.endsWith("d.txt"))).toEqual(["primary:Download/c.txt", "primary:Download/d.txt"]);

    // spec/app/files/trash.md, "The owner restores everything listed that is still kept, together, from a list read since the last job"
    world.files.trash.push(
      { id: "10", was: { volume: "primary", path: "Download/a.txt", directory: false, mimeType: "text/plain", size: 1, modified: 1 }, deletedAt: world.files.now },
      { id: "11", was: { volume: "card", path: "b.txt", directory: false, mimeType: "text/plain", size: 1, modified: 1 }, deletedAt: world.files.now },
    );
    await press("Refresh");
    await until(alpha, runtime, Bin, (s) => s.listing.status === "Loaded" && s.entries.length === 2);
    await press("Restore all");
    await until(alpha, runtime, Bin, (s) => s.attempt.outcome === "Confirmed" && s.entries.length === 0 && s.listing.status === "Loaded");
    expect([world.files.trash, paths(world).filter((path) => path.endsWith("a.txt") || path.endsWith("b.txt"))]).toEqual([[], ["card:b.txt", "primary:Download/a.txt"]]);

    // spec/app/files/trash.md, "A job ends as its answer says for each item: only what the phone confirmed is done, and the rest was refused or is unknown"
    world.files.trash.push(
      { id: "20", was: { volume: "primary", path: "Download/returned.txt", directory: false, mimeType: "text/plain", size: 1, modified: 1 }, deletedAt: world.files.now },
      { id: "20", was: { volume: "card", path: "waiting.txt", directory: false, mimeType: "text/plain", size: 1, modified: 1 }, deletedAt: world.files.now },
    );
    world.files.refusing.push("storageRestore:card");
    await press("Refresh");
    await until(alpha, runtime, Bin, (s) => s.listing.status === "Loaded" && s.entries.length === 2);
    await press("Restore all");
    await until(alpha, runtime, Bin, (s) => s.attempt.outcome === "Unknown" && s.listing.status === "Loaded");
    const partial = runtime.runSync(Bin.use((machine) => machine.get()));
    expect([partial.done.map((entry) => entry.name), partial.entries.map((entry) => entry.name), paths(world).includes("primary:Download/returned.txt")]).toEqual([["returned.txt"], ["waiting.txt"], true]);
    world.files.refusing.splice(0);
    await press("waiting.txt");
    await pressOnTop("Restore");
    await until(alpha, runtime, Bin, (s) => s.attempt.outcome === "Confirmed" && s.entries.length === 0 && s.listing.status === "Loaded");
    expect(paths(world)).toContain("card:waiting.txt");

    // spec/app/files/trash.md, "The owner is shown what will be erased, one item, the marked items or everything listed, and a change to the list voids the confirmation"
    world.files.trash.push(
      { id: "14", was: { volume: "primary", path: "Download/e.txt", directory: false, mimeType: "text/plain", size: 1, modified: 1 }, deletedAt: world.files.now },
      { id: "15", was: { volume: "card", path: "f.txt", directory: false, mimeType: "text/plain", size: 1, modified: 1 }, deletedAt: world.files.now },
    );
    await press("Refresh");
    await until(alpha, runtime, Bin, (s) => s.listing.status === "Loaded" && s.entries.length === 2);
    await press("Empty");
    await until(alpha, runtime, Bin, (s) => s.erasing.showing && s.doomed.length === 2);
    await pressOnTop("Empty");
    await until(alpha, runtime, Bin, (s) => s.attempt.outcome === "Confirmed" && s.entries.length === 0 && s.listing.status === "Loaded");
    expect(world.files.trash).toEqual([]);
    // spec/app/files/trash.md, "The Trash is closed, without access, reading, unreadable, empty or listing"
    expect(document.body.textContent?.includes("Trash is empty. Items in Trash are deleted after 30 days.")).toBe(true);
    await hardware("home");
  });

  it('Hide Preview behind Move-to Sheet, avoid invisible checkbox hit-stealing, and trash multi-folder selections (spec/app/files/preview.md, "Story: Act on the file I am looking at"; spec/app/files/index.md, "Story: Change my files"; spec/app/files/trash.md, "Story: Delete into the Trash")', async () => {
    const { alpha, runtime, world } = await onDownloads();

    const hiddenCheck = document.querySelector<HTMLElement>("[aria-label='Select lease.pdf']");
    expect(hiddenCheck?.className).toContain("pointer-events-none");

    await press("lease.pdf");
    await until(alpha, runtime, Shown, (s) => s.content.status === "Loaded");
    expect(document.querySelector("[aria-label='Preview']")).not.toBeNull();
    await choose("Add to folder", "File actions");
    await until(alpha, runtime, Browser, (s) => s.sheet.open && s.sheet.reading.status === "Loaded");
    expect(document.querySelector("[aria-label='Preview']")).toBeNull();
    await hardware("back");
    await until(alpha, runtime, Browser, (s) => !s.sheet.open);
    expect(document.querySelector("[aria-label='Preview']")).not.toBeNull();
    await press("Close");
    await until(alpha, runtime, Shown, (s) => s.viewer === 0);
    await press("Cancel");

    await choose("Browse storage");
    await until(alpha, runtime, Browser, (s) => s.trail.length === 0 && !s.inCategory);
    await press("Documents");
    await until(alpha, runtime, Browser, (s) => s.inCategory && s.listing.status === "Loaded" && s.items.length >= 2);
    await select("lease.pdf");
    await select("notes.txt");
    await press("Delete");
    await pressOnTop("Delete");
    await until(alpha, runtime, Bin, (s) => s.attempt.outcome === "Confirmed" && s.binned.length === 2);
    expect(world.files.trash.map((one) => one.was.path).toSorted()).toEqual(["Documents/notes.txt", "Download/lease.pdf"]);
  });

  it('Preserves confirmed volume erasures when a later volume throws during Empty Trash (spec/app/files/trash.md, "A job ends as its answer says for each item: only what the phone confirmed is done, and the rest was refused or is unknown")', async () => {
    const { alpha, runtime, world } = await onFiles();
    await until(alpha, runtime, Browser, (s) => s.storage.status === "Loaded");
    world.files.trash.push(
      { id: "30", was: { volume: "primary", path: "Download/gone.txt", directory: false, mimeType: "text/plain", size: 1, modified: 1 }, deletedAt: world.files.now },
      { id: "31", was: { volume: "card", path: "stuck.txt", directory: false, mimeType: "text/plain", size: 1, modified: 1 }, deletedAt: world.files.now },
    );
    const plugin = Option.getOrThrow(runtime.runSync(Effect.map(Files, (service) => service.plugin)));
    const original = plugin.storageEmptyTrash.bind(plugin);
    vi.spyOn(plugin, "storageEmptyTrash").mockImplementation((input) => {
      if (input.volume === "card") return Promise.reject(new Error("card unavailable"));
      return original(input);
    });

    await press("Trash");
    await until(alpha, runtime, Bin, (s) => s.open && s.listing.status === "Loaded" && s.entries.length === 2);
    await press("Empty");
    await until(alpha, runtime, Bin, (s) => s.erasing.showing && s.doomed.length === 2);
    await pressOnTop("Empty");
    await until(alpha, runtime, Bin, (s) => s.attempt.outcome === "Unknown" && s.listing.status === "Loaded");
    const state = runtime.runSync(Bin.use((machine) => machine.get()));
    expect(state.done.map((entry) => entry.name)).toEqual(["gone.txt"]);
    expect(state.entries.map((entry) => entry.name)).toEqual(["stuck.txt"]);
  });
});

describe("Files in a browser", () => {
  it("Browse my storage (spec/app/files/index.md, \"Story: Browse my storage\")", async () => {
    const world = scene();
    const { alpha } = await open(world, only("home", "view:Files", "notice"));
    const runtime = files.runtime(alpha);
    await press("Files");
    // spec/app/files/index.md, "Files is closed, unsupported, not yet allowed, denied, at the top, reading, unavailable or showing a place"
    await until(alpha, runtime, Browser, (s) => s.open && !s.supported);
    expect(document.querySelector("section[aria-label=Files]")).toBeNull();
  });
});
