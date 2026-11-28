// @vitest-environment happy-dom
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { Machine as Library } from "../gen/app__photos.effect.vibe";
import { Machine as Viewer } from "../gen/app__photos__viewer.effect.vibe";
import { Machine as Messages } from "../gen/app__messages.effect.vibe";
import { Machine as Adding } from "../gen/app__inbox__adding.effect.vibe";
import inbox from "../src/inbox/index.tsx";
import { Incoming } from "../src/inbox/adding.vibe";
import { Machine as MessageComposer } from "../gen/app__messages__composer.effect.vibe";
import { Drafts as MessageDrafts } from "../src/messages/composer.vibe";
import photosArea from "../src/photos/index.tsx";
import { headingOf } from "../src/runtime/dateHeading.ts";
import { button, closeAll, drawn, fill, hardware, only, open, press, readInboxFirst, underAct, until } from "./alpha.tsx";
import { scene } from "./fakes/scene.ts";
import type { FixturePicture } from "./fakes/photos.ts";

underAct();
afterEach(closeAll);

const photoAction = async (label: string, menuLabel = "Photo actions") => {
  await drawn(() => {
    const menu = button(menuLabel);
    if (!menu) throw new Error(`No ${menuLabel} menu`);
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  await drawn(() => {
    const item = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((option) => option.textContent === label);
    if (!item) throw new Error(`No ${label} photo action`);
    item.click();
  });
};

it("Allow Photos and browse the library (spec/app/photos/index.md, \"Story: Give Photos access\"; spec/app/photos/index.md, \"Story: Browse the library\"; spec/app/photos/index.md, \"Story: Select photos\"; spec/app/photos/viewer.md, \"Story: Look at a photo or video\"; spec/app/photos/viewer.md, \"Story: Edit a photo or trim a video\")", async () => {
  const world = { ...scene(), phone: true, now: 1795400000000 + 86_400_000 + 240_000 };
  const { alpha } = await open(world, only("home", "view:Photos", "notice"));
  await press("Photos");
  const runtime = photosArea.runtime(alpha);
  await until(alpha, runtime, Library, (state) => state.library.status === "Loaded" && state.rows.length === 1);
  expect([Boolean(button("Camera.jpg")), Boolean(button("Park.jpg"))]).toEqual([true, false]);

  await press("Allow access");
  await until(alpha, runtime, Library, (state) => state.library.status === "Loaded" && state.access.grant === "Granted");
  await press("Show more");
  await until(alpha, runtime, Library, (state) => state.library.status === "Loaded" && state.rows.length === 3);
  // spec/app/photos/index.md, "Story: Browse the library": the Library is headed by day as v121 headed it, counted back from Alpha's time
  expect([...document.querySelectorAll("[data-alpha-app-scroll=photos] section h2")].map((heading) => heading.textContent)).toEqual(["Yesterday"]);
  // spec/app/photos/index.md, "Story: Browse the library": each heading with the number of items under it beside it, as v119's live camera adapter drew it
  expect([...document.querySelectorAll("[data-alpha-app-scroll=photos] section header")].map((header) => [header.querySelector("h2")?.textContent, header.querySelector("span")?.textContent]))
    .toEqual([["Yesterday", "3"]]);
  // spec/app/photos/index.md, "Story: Browse the library": v119's live camera adapter drew images.svg on the Library tab and folder.svg on Albums
  expect([...document.querySelectorAll('[aria-label="Photos sections"] button')].map((tab) => [tab.textContent, tab.querySelector("svg")?.classList.contains("lucide-images"), tab.querySelector("svg")?.classList.contains("lucide-folder")]))
    .toEqual([["Library", true, false], ["Albums", false, true]]);
  const localNoon = new Date(2026, 10, 24, 12).getTime();
  const captureDaysBack = (days: number) => new Date(2026, 10, 24 - days, 9).getTime();
  expect([0, 1, 3, 29, 30].map((days) => headingOf(captureDaysBack(days), localNoon))).toEqual(["Today", "Yesterday", "Sat, Nov 21", "Mon, Oct 26", "October 2026"]);
  expect(headingOf(new Date(2026, 11, 28, 9).getTime(), new Date(2027, 0, 10, 12).getTime())).toBe("Mon, Dec 28, 2026");
  expect(headingOf(new Date(2025, 9, 20, 9).getTime(), localNoon)).toBe("October 2025");
  expect(headingOf(new Date(2026, 9, 15, 9).getTime(), localNoon, true)).toBe("Thu, Oct 15, 2026");

  await photoAction("Select", "Photos tools");
  await press("Select all");
  await until(alpha, runtime, Library, (state) => state.selecting && state.selected.length === 3);
  await press("Deselect all");
  await until(alpha, runtime, Library, (state) => state.selecting && state.selected.length === 0);
  await drawn(() => expect(button("Delete")?.disabled).toBe(true));
  await press("Cancel selection");

  await press("Park.jpg");
  await until(alpha, runtime, Viewer, (state) => state.read.status === "Loaded");
  await press("Next photo");
  await until(alpha, runtime, Viewer, (state) => state.read.status === "Loaded" && state.read.ticket === 2);
  expect(world.photos.readCount).toBe(2);

  await press("Edit photo");
  await until(alpha, runtime, Viewer, (state) => state.editing && state.preview.showing);
  await press("Noir");
  await until(alpha, runtime, Viewer, (state) => state.edit.look === "Noir" && state.preview.showing);
  await press("Save copy");
  await until(alpha, runtime, Viewer, (state) => state.save.outcome === "Confirmed");
  expect([world.photos.saves, world.photos.rows.some((item) => item.name === "Camera.jpg")]).toEqual([["noir"], true]);

  await drawn(() => {
    world.photos.access = { scope: "denied", images: "denied", videos: "denied" };
    world.photos.changed();
  });
  await until(alpha, runtime, Library, (state) => state.access.grant === "Denied" && state.library.status === "Loaded" && state.rows.length === 2);
  await until(alpha, runtime, Viewer, (state) => state.open === 0);
  expect([Boolean(button("Camera.jpg")), Boolean(button("Park.jpg")), world.photos.promptCount]).toEqual([true, false, 1]);
  await hardware("back");
  await until(alpha, runtime, Library, (state) => !state.visible);
});

it('Use a photo in Messages from its still-open viewer (spec/app/photos/viewer.md, "Use in Messages offers the exact readable original of a permitted photo"; spec/app/messages/index.md, "A picture from Files is offered in a new recipient picker and can join only its chosen empty draft")', async () => {
  const world = { ...scene(), phone: true, image: true };
  world.photos.access = { scope: "full", images: "full", videos: "denied" };
  const source = world.photos.rows[0];
  if (!source) throw new Error("No fixture picture");
  const dataBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=";
  const binary = atob(dataBase64);
  source.name = "Original fixture.png";
  source.size = binary.length;
  source.mutationRevision = source.revision;
  const received: FixturePicture = { name: source.name, mimeType: "image/png", size: binary.length, dataBase64 };
  const started = Promise.withResolvers<void>();
  const late = Promise.withResolvers<FixturePicture>();
  world.photos.selectedPicture = () => { started.resolve(); return late.promise; };
  const { alpha } = await open(world, only("home", "view:Photos", "view:Messages", "notice"));
  const runtime = photosArea.runtime(alpha);
  await press("Photos");
  await until(alpha, runtime, Library, (state) => state.library.status === "Loaded");
  const openPicture = async () => {
    await press(source.name);
    await until(alpha, runtime, Viewer, (state) => state.read.status === "Loaded");
  };
  await openPicture();
  await photoAction("Use in Messages");
  await started.promise;
  await press("Back from photo");
  await until(alpha, runtime, Viewer, (state) => state.open === 0);
  await openPicture();
  await drawn(async () => { late.resolve(received); await late.promise; });
  expect(alpha.runtime.runSync(Messages.use((messages) => messages.get())).offeredPicture).toBe(0);

  world.photos.selectedPicture = () => Promise.resolve(received);
  await photoAction("Use in Messages");
  await until(alpha, alpha.runtime, Messages, (state) => state.pane === "Picker" && state.offeredPicture > 0);
  expect(document.querySelector("[aria-label='Picture for this message']")?.textContent).toContain(source.name);
  await fill("To", "+15550123456");
  await press("Text +15550123456");
  await until(alpha, alpha.runtime, MessageComposer, (state) => state.pictures === 1);
  const { thread } = alpha.runtime.runSync(MessageComposer.use((composer) => composer.get()));
  expect(alpha.runtime.runSync(MessageDrafts.use((drafts) => drafts.pictures(thread)))).toEqual([
    { name: source.name, wireName: "picture-1.png", contentType: "image/png", bytes: Uint8Array.from(binary, (byte) => byte.charCodeAt(0)) },
  ]);
  expect(world.telephony.sent).toEqual([]);
});

it('Offer the original photo for Inbox to review (spec/app/photos/viewer.md, "Story: Share what I am looking at"; spec/app/inbox/adding.md, "A file handed over from Files or Photos is shown to the owner before it joins the draft open, or starts a new message from the account given, and only where it fits")', async () => {
  const world = { ...scene(), phone: true };
  world.photos.access = { scope: "full", images: "full", videos: "denied" };
  const source = world.photos.rows[0];
  if (!source) throw new Error("No fixture photo");
  const dataBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=";
  source.name = "Owner original.png";
  source.size = atob(dataBase64).length;
  source.mutationRevision = source.revision;
  world.photos.selectedPicture = () => Promise.resolve({ name: source.name, mimeType: "image/png", size: source.size, dataBase64 });
  const { alpha } = await open(world, only("home", "view:Photos", "view:Inbox", "notice"));
  const letters = inbox.runtime(alpha);
  await readInboxFirst(alpha, letters);
  await press("Photos");
  const runtime = photosArea.runtime(alpha);
  await until(alpha, runtime, Library, (state) => state.library.status === "Loaded");
  await press(source.name);
  await until(alpha, runtime, Viewer, (state) => state.read.status === "Loaded");
  await photoAction("Email");
  await until(alpha, letters, Adding, (state) => state.thing !== 0);
  expect(letters.runSync(Incoming.use((incoming) => Effect.sync(() => incoming.file())))).toEqual({
    source: "Photos", attached: { name: source.name, mimeType: "image/png", size: source.size, data: dataBase64 },
  });
  expect([world.inbox.changes, world.inbox.attached, world.inbox.drafts.size]).toEqual([[], [], 0]);
});

it('Resume an already-sent photo edit from an older viewer record (spec/app/photos/viewer.md, "A restart forgets the viewer but keeps the save; a save still on its way is no longer trusted, and is looked up")', async () => {
  const kept = "alpha/app/photos/viewer@1";
  const operationId = "alpha-test-photo-edit";
  localStorage.setItem(kept, JSON.stringify({
    visible: true, secure: false, scope: [], open: 1, openedBy: "Owner", listed: true,
    read: { status: "Loaded", ticket: 1 }, kind: "Still", duration: 0, revision: 1, favourite: false, gone: false,
    zoom: 1, playing: false, position: 0, info: false, editing: true,
    edit: { turns: 1, cropped: false, look: "Original", start: 0, end: 0 },
    preview: { showing: false, revision: 2, shown: 2 }, unavailable: false, refusal: "NoRefusal", replace: false,
    save: { id: 4, outcome: "Sent" }, attempts: 4, lookup: { status: "Idle", ticket: 0 }, found: false, restored: false,
  }));
  localStorage.setItem(kept + ".epoch", "earlier-viewer");
  localStorage.setItem("alpha/photos/edit/4", operationId);

  const world = { ...scene(), phone: true };
  const { alpha } = await open(world, only("home", "view:Photos", "notice"));
  await press("Photos");
  await until(alpha, photosArea.runtime(alpha), Viewer, (state) => state.lookup.status === "Loaded" && state.found &&
    state.attempts === 4 && state.open === 0 && state.origin === "LibraryItem");
  expect(world.photos.editLookups).toEqual([operationId]);
  expect(world.photos.saves).toEqual([]);
  expect(localStorage.getItem(kept + ".epoch")).toBe("earlier-viewer");
  expect(localStorage.getItem("alpha/photos/edit/4")).toBe(operationId);
  expect(localStorage.getItem(kept + ".unreadable")).toBeNull();
});

it('Keep Viewer open on Limited-to-Limited library updates and offer both Limited permission actions (spec/app/photos/index.md, "Story: Give Photos access"; spec/app/photos/viewer.md, "Story: Look at a photo or video")', async () => {
  const world = { ...scene(), phone: true };
  const { alpha } = await open(world, only("home", "view:Photos", "notice"));
  await press("Photos");
  const runtime = photosArea.runtime(alpha);
  await until(alpha, runtime, Library, (state) => state.library.status === "Loaded" && state.access.grant === "Denied");
  await press("Allow access");
  await until(alpha, runtime, Library, (state) => state.library.status === "Loaded" && state.access.asked);
  world.photos.access = { scope: "selected", images: "selected", videos: "denied" };
  await drawn(() => {
    world.photos.changed();
  });
  await until(alpha, runtime, Library, (state) => state.library.status === "Loaded" && state.access.grant === "Limited");
  expect([Boolean(button("Choose items or allow all")), Boolean(button("Allow all photos"))]).toEqual([true, true]);

  await press("Park.jpg");
  await until(alpha, runtime, Viewer, (state) => state.read.status === "Loaded" && state.open > 0);
  const opened = runtime.runSync(Viewer.use((viewer) => viewer.get())).open;
  await drawn(() => {
    world.photos.changed();
  });
  await until(alpha, runtime, Library, (state) => state.access.grant === "Limited" && state.library.status === "Loaded");
  expect(runtime.runSync(Viewer.use((viewer) => viewer.get())).open).toBe(opened);

  const viewport = document.querySelector<HTMLElement>("[role=group][tabindex='0']");
  expect(viewport).not.toBeNull();
  if (viewport) {
    viewport.setPointerCapture = () => { throw new DOMException("Not active", "InvalidStateError"); };
    await drawn(() => {
      viewport.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, pointerType: "touch", clientX: 50, clientY: 50 }));
      viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "touch", clientX: 50, clientY: 50 }));
    });
  }
  expect(runtime.runSync(Viewer.use((viewer) => viewer.get())).open).toBe(opened);
});

it('Stops playing when a video ends even if currentTime rounds slightly short of duration (spec/app/photos/viewer.md, "Story: Look at a photo or video")', async () => {
  const world = { ...scene(), phone: true };
  world.photos.access = { scope: "full", images: "full", videos: "full" };
  world.photos.rows.unshift({
    id: "m:external_primary:v:9", name: "Clip.mp4", owned: true, kind: "video",
    image: "", width: 1280, height: 720, size: 10_000,
    date: 1795400500000, revision: "rev-video-9", duration: 5, path: "https://localhost/_alpha_video_/clip.mp4",
  });
  const { alpha } = await open(world, only("home", "view:Photos", "notice"));
  await press("Photos");
  const runtime = photosArea.runtime(alpha);
  await until(alpha, runtime, Library, (state) => state.library.status === "Loaded");
  await press("Clip.mp4");
  await until(alpha, runtime, Viewer, (state) => state.read.status === "Loaded" && state.kind === "Clip" && state.duration === 50);
  const clip = document.querySelector("video");
  if (!clip) throw new Error("No video element");
  expect(clip.getAttribute("poster")?.startsWith("data:image/png;base64,")).toBe(true);
  clip.play = () => Promise.resolve();
  clip.pause = () => {};
  await press("Play video");
  await until(alpha, runtime, Viewer, (state) => state.playing);
  await drawn(() => {
    clip.currentTime = 4.92;
    clip.dispatchEvent(new Event("ended"));
  });
  await until(alpha, runtime, Viewer, (state) => !state.playing && state.position === 50);
});

it('Check a saved copy the earlier Alpha left pending instead of forgetting it (spec/app/photos/index.md, "A saved copy the earlier Alpha left pending is checked once instead of forgotten")', async () => {
  const previous = "alpha.photos.pending-copy.v1";
  localStorage.setItem(previous, "not an operation id!");
  const invalidWorld = { ...scene(), phone: true };
  const invalid = await open(invalidWorld, only("home", "view:Photos", "notice"));
  await press("Photos");
  await until(invalid.alpha, photosArea.runtime(invalid.alpha), Library, (state) => state.library.status === "Loaded");
  expect([invalidWorld.photos.editLookups, invalidWorld.photos.saves, localStorage.getItem(previous)]).toEqual([[], [], "not an operation id!"]);
  await invalid.close();

  localStorage.clear();
  localStorage.setItem(previous, "alpha-test-photo-edit");
  const world = { ...scene(), phone: true };
  const first = await open(world, only("home", "view:Photos", "notice"));
  await press("Photos");
  await until(first.alpha, photosArea.runtime(first.alpha), Library, (state) => state.library.status === "Loaded");
  await vi.waitFor(() => expect([world.photos.editLookups, world.photos.saves, localStorage.getItem(previous)]).toEqual([["alpha-test-photo-edit"], [], null]));
});
