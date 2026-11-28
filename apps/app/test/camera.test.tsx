// @vitest-environment happy-dom
import { DeviceExecution } from "@elizaos/agent";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Machine } from "../gen/app__camera.effect.vibe";
import { initial as initialFilm, maxBytes, nearLimit } from "../gen/app__camera__recording.ts";
import * as CameraModel from "../gen/app__camera.ts";
import { Machine as Library } from "../gen/app__photos.effect.vibe";
import { Machine as Viewer } from "../gen/app__photos__viewer.effect.vibe";
import assistant from "../src/assistant/index.tsx";
import { MediaReview } from "../src/assistant/media-review.vibe";
import type { Place } from "../src/areas.ts";
import { CameraAssets, requestCapture, type CaptureAnswer } from "../src/camera/camera.vibe";
import camera from "../src/camera/index.tsx";
import photosArea from "../src/photos/index.tsx";
import { button, closeAll, drawn, hardware, later, only, open, press, seen, underAct, until } from "./alpha.tsx";
import { scene } from "./fakes/scene.ts";
import { textReview } from "./fakes/text-review.ts";

underAct();
afterEach(closeAll);

/** The recording timer as the owner reads it: the elapsed time, then the time left once a limit is a minute away. */
const timerText = () => document.querySelector("[role='timer']")?.textContent;

async function onCamera(world = { ...scene(), phone: true }, ...places: Place[]) {
  const { alpha } = await open(world, only("home", "view:Camera", "notice", ...places));
  const runtime = camera.runtime(alpha);
  await press("Camera");
  await until(alpha, runtime, Machine, (state) => state.phase === "Ready");
  return { alpha, runtime, world };
}

type CameraSession = Awaited<ReturnType<typeof onCamera>>;

async function startVideoRecording({ alpha, runtime }: CameraSession) {
  await press("Video mode");
  await until(alpha, runtime, Machine, (state) => state.mode === "Video");
  await press("Start recording");
  await until(alpha, runtime, Machine, (state) => state.film.stage === "Running");
}

async function takeCapture(session: CameraSession, kind: "photo" | "video") {
  const { alpha, runtime, world } = session;
  if (kind === "photo") {
    await press("Take photo");
    await until(alpha, runtime, Machine, (state) => state.last > 0 && state.shot === 0 && world.camera.photos.length === 1);
    return;
  }
  await startVideoRecording(session);
  await press("Stop recording");
  await until(alpha, runtime, Machine, (state) => state.film.stage === "Saved");
}

async function expectSavedVideo({ alpha, runtime, world }: CameraSession) {
  await until(alpha, runtime, Machine, (state) => state.film.stage === "Saved");
  expect(button("Start recording")).toBeDefined();
  expect(world.camera.savedVideos).toHaveLength(1);
}

function cameraWithFullPhotosAccess() {
  const world = { ...scene(), phone: true };
  world.photos.access = { scope: "full", images: "full", videos: "full" };
  return world;
}

describe("Camera on a phone", () => {
  it("Frame the shot and take photos and videos (spec/app/camera/index.md, \"Story: Frame the shot\")", async () => {
    const cameraSession = await onCamera();
    const { alpha, runtime, world } = cameraSession;

    // spec/app/camera/index.md, "Story: Frame the shot": v119's Camera header holds only back, flip and flash.
    expect(button("Framing grid")).toBeUndefined();
    expect(button("Aspect ratio 4:3")).toBeUndefined();
    expect(button("Timer off")).toBeUndefined();
    await press("Take photo");
    await until(alpha, runtime, Machine, (state) => state.last > 0 && state.shot === 0);
    expect(world.camera.photos).toMatchObject([{ saveToGallery: true, thumbnailOnly: true }]);

    // spec/app/camera/index.md, "Story: Take photos and videos"
    await startVideoRecording(cameraSession);
    // spec/app/camera/recording.md, "Story: Read the clock"
    expect(timerText()).toBe("0:00");
    await later(alpha, 1000);
    await until(alpha, runtime, Machine, (state) => state.film.elapsed === 1);
    expect(timerText()).toBe("0:01");
    await later(alpha, 240_000);
    await until(alpha, runtime, Machine, (state) => state.film.elapsed === 241 && nearLimit(state.film));
    expect(timerText()).toBe("4:01 · 0:59 left");
    expect([
      nearLimit({ ...initialFilm, stage: "Running", elapsed: 1, bytes: Math.floor(maxBytes * 0.9) }),
      nearLimit({ ...initialFilm, stage: "Running", elapsed: 10, bytes: Math.floor(maxBytes * 0.2) }),
    ]).toEqual([false, true]);
    await hardware("back");
    await expectSavedVideo(cameraSession);
    expect(button("Open last video")).toBeDefined();

    // spec/app/camera/index.md, "Story: Leave and come back"
    await seen(false);
    await until(alpha, runtime, Machine, (state) => !state.showing && state.phase === "Off");
    await seen(true);
    await until(alpha, runtime, Machine, (state) => state.phase === "Ready");
    await hardware("home");
    await until(alpha, runtime, Machine, (state) => !state.showing && state.phase === "Off");
  });

  it('Back waits for the recorder to open and keeps the viewfinder (spec/app/camera/index.md, "Back stays in Camera while the recorder settles")', async () => {
    const world = { ...scene(), phone: true };
    let recorderOpened = () => {};
    world.camera.recordingGate = new Promise<void>((resolve) => { recorderOpened = resolve; });
    const cameraSession = await onCamera(world);
    const { alpha, runtime } = cameraSession;
    await press("Video mode");
    await press("Start recording");
    await until(alpha, runtime, Machine, (state) => state.film.stage === "Opening");

    await press("Back to apps");
    await hardware("back");
    await until(alpha, runtime, Machine, (state) => state.showing && state.film.stage === "StopWhenOpened");
    expect(button("Viewfinder. Tap to focus or pinch to zoom")).toBeDefined();
    expect([Boolean(button("Back to apps")), button("Start recording")?.getAttribute("aria-busy")]).toEqual([true, "true"]);
    expect(world.camera.savedVideos).toHaveLength(0);
    await drawn(recorderOpened);
    await expectSavedVideo(cameraSession);

    await hardware("back");
    await until(alpha, runtime, Machine, (state) => !state.showing);
  });

  it("On the launcher Camera's header holds flip alone and Android's Back still leaves (spec/app/camera/index.md, \"Story: Open the camera\"; spec/app/shell/index.md, \"On the launcher the first page of Settings and of Workflows draws no Back, and Android's Back still leaves it\")", async () => {
    const world = { ...scene(), phone: true };
    world.settings.roles = world.settings.roles.map((role) => role.role === "home" ? { ...role, held: true } : role);
    const { alpha, runtime } = await onCamera(world);
    await vi.waitFor(() => expect(document.querySelector("main")?.hasAttribute("data-alpha-launcher")).toBe(true));
    // spec/app/camera/index.md, "Story: Open the camera": v119's header (template.html at 45f6bed30, lines 1861-1868) drew back only off the launcher and had no Scan document.
    expect(button("Back to apps")).toBeUndefined();
    expect(button("Scan document")).toBeUndefined();
    expect(button("Switch camera")).toBeDefined();
    await hardware("back");
    await until(alpha, runtime, Machine, (state) => !state.showing);
  });

  it('Camera has no scan of its own, as v119 drew none, and its shutter still takes a photo (spec/app/camera/index.md, "Story: Open the camera")', async () => {
    expect(Object.keys(CameraModel).filter((name) => /scan/i.test(name))).toEqual([]);
    const session = await onCamera();
    expect(button("Scan document")).toBeUndefined();
    expect(document.querySelector("[role='dialog']")).toBeNull();
    await takeCapture(session, "photo");
    expect(button("Switch camera")).toBeDefined();
  });

  it('Volume stays with Android while Camera asks about the microphone (spec/app/camera/index.md, "Volume keys fire the available shutter while Camera is ready for the owner")', async () => {
    const world = { ...scene(), phone: true };
    world.camera.microphone = "denied";
    const { alpha, runtime } = await onCamera(world);
    await expect.poll(() => world.camera.volumeShutter).toBe(true);
    await press("Video mode");
    await expect.poll(() => world.camera.volumeShutter).toBe(false);

    await drawn(() => window.dispatchEvent(new Event("alpha:volume-shutter")));
    expect(world.camera.savedVideos).toHaveLength(0);
    await press("Record without sound");
    await until(alpha, runtime, Machine, (state) => state.film.stage === "Running");
    await expect.poll(() => world.camera.volumeShutter).toBe(true);
    await drawn(() => window.dispatchEvent(new Event("alpha:volume-shutter")));
    await until(alpha, runtime, Machine, (state) => state.film.stage === "Saved");
    expect(world.camera.savedVideos).toHaveLength(1);
    await expect.poll(() => world.camera.volumeShutter).toBe(false);
  });

  it('The last saved video is ready before its exact thumbnail arrives (spec/app/camera/index.md, "A saved video becomes the last capture")', async () => {
    const world = { ...scene(), phone: true };
    let releaseThumbnail = () => {};
    world.photos.readGate = new Promise<void>((resolve) => { releaseThumbnail = resolve; });
    const { alpha, runtime } = await onCamera(world);
    await press("Video mode");
    await press("Start recording");
    await until(alpha, runtime, Machine, (state) => state.film.stage === "Running");

    const image = world.photos.rows[0]?.image ?? "";
    world.photos.rows.unshift({
      id: "m:removable:v:1", name: "Other clip", owned: false,
      kind: "video", image: "", width: 1280, height: 720, size: 10_000,
      date: 1795401800100, revision: "other-video",
    }, {
      id: "m:external_primary:v:1", name: "Camera clip", owned: true,
      kind: "video", image, width: 1280, height: 720, size: 10_000,
      date: 1795401800000, revision: "owned-video",
    });
    await press("Stop recording");
    await until(alpha, runtime, Machine, (state) => state.film.stage === "Saved");
    const tile = button("Open last video");
    expect(tile?.disabled).toBe(false);
    expect(tile?.querySelector("img")).toBeNull();
    await expect.poll(() => world.photos.readCount).toBe(1);
    await drawn(releaseThumbnail);
    await expect.poll(() => tile?.querySelector("img")?.getAttribute("src")).toBe(image);
    expect(world.photos.promptCount).toBe(0);
  });

  it.each(["photo", "video"] as const)('Open the last owned %s without library access (spec/app/camera/index.md, "The last capture opens in Photos")', async (kind) => {
    const cameraSession = await onCamera(undefined, "view:Photos");
    const { alpha, world } = cameraSession;
    await takeCapture(cameraSession, kind);

    const playback = "https://localhost/_alpha_video_/capture.mp4";
    world.photos.rows.unshift({
      id: kind === "video" ? "m:external_primary:v:1" : "m:external_primary:i:1",
      name: kind === "video" ? "Owned clip.mp4" : "Owned still.jpg", owned: true,
      kind: kind === "video" ? "video" : "image", image: world.photos.rows[0]?.image ?? "",
      width: 1280, height: 720, size: 10_000, date: 1795401800000, revision: "owned-capture",
      ...(kind === "video" ? { path: playback, duration: 1 } : {}),
    });
    await press(`Open last ${kind}`);
    await until(alpha, photosArea.runtime(alpha), Viewer, (state) => state.read.status === "Loaded");
    if (kind === "video") expect(document.querySelector("video")?.getAttribute("src")).toBe(playback);
    else expect(document.querySelector('img[alt="Owned still.jpg"]')).not.toBeNull();
    expect(world.photos.promptCount).toBe(0);
  });

  it('An aggregate camera URI cannot choose a permitted row on another volume (spec/app/camera/index.md, "The last capture opens in Photos")', async () => {
    const cameraSession = await onCamera(cameraWithFullPhotosAccess(), "view:Photos");
    const { alpha, world } = cameraSession;
    await takeCapture(cameraSession, "photo");

    world.photos.rows.unshift({
      id: "m:a0b1-c2d3:i:1", name: "Different still.jpg", owned: false, kind: "image", image: "",
      width: 1280, height: 720, size: 10_000, date: 1795401800000, revision: "different-capture",
    });
    await press("Open last photo");
    await until(alpha, photosArea.runtime(alpha), Library, (state) => state.visible && state.library.status === "Loaded" && state.access.grant === "Granted");
    expect([Boolean(button("Different still.jpg")), world.photos.readCount]).toEqual([true, 1]);
    expect((await photosArea.runtime(alpha).runPromise(Effect.flatMap(Viewer, (viewer) => viewer.get()))).open).toBe(0);
  });

  it.each(["photo", "video"] as const)('Open the exact owned %s with full Photos access (spec/app/camera/index.md, "The last capture opens in Photos")', async (kind) => {
    const cameraSession = await onCamera(cameraWithFullPhotosAccess(), "view:Photos");
    const { alpha, world } = cameraSession;
    await takeCapture(cameraSession, kind);

    if (kind === "video") await expect.poll(() => world.photos.readCount).toBe(1);
    const readsInCamera = world.photos.readCount;
    const playback = "https://localhost/_alpha_video_/owned.mp4";
    const fixture = {
      kind: kind === "video" ? "video" : "image", image: world.photos.rows[0]?.image ?? "",
      width: 1280, height: 720, size: 10_000, date: 1795401800000, revision: "exact-capture",
      ...(kind === "video" ? { path: playback, duration: 1 } : {}),
    };
    world.photos.rows.unshift({
      ...fixture, id: kind === "video" ? "m:a0b1-c2d3:v:1" : "m:a0b1-c2d3:i:1",
      name: "Different volume", owned: false, path: "https://localhost/_alpha_video_/other.mp4",
    });
    world.photos.rows.push({
      ...fixture, id: kind === "video" ? "m:external_primary:v:1" : "m:external_primary:i:1",
      name: "Just captured", owned: true,
    });

    await press(`Open last ${kind}`);
    const photos = photosArea.runtime(alpha);
    await until(alpha, photos, Viewer, (state) => state.read.status === "Loaded");
    if (kind === "video") expect(document.querySelector("video")?.getAttribute("src")).toBe(playback);
    else expect(document.querySelector('img[alt="Just captured"]')).not.toBeNull();
    expect(world.photos.readCount - readsInCamera).toBe(2);
  });

  it("Open Camera’s exact capture beyond the first Photos page (spec/app/photos/index.md, \"Only the newest read's answer is shown, only while Photos is showing, and a further page only adds older items\")", async () => {
    const world = cameraWithFullPhotosAccess();
    const selected = world.photos.rows.find((item) => item.owned);
    if (selected === undefined) throw new Error("The Camera album has no capture");
    selected.date = 1795399000000;
    selected.mutationRevision = "last-capture";
    const mutations: string[] = [];
    world.photos.changeMany = ({ operation, items }) => {
      if (items.length !== 1 || items[0]?.id !== selected.id || items[0]?.revision !== selected.mutationRevision
        || (operation !== "favorite" && operation !== "unfavorite")) return Promise.reject(new Error("Wrong photo or revision"));
      mutations.push(operation);
      selected.mutationRevision = operation;
      selected.favorite = operation === "favorite";
      const status = selected.favorite ? "favorited" : "unfavorited";
      return Promise.resolve({ status: "complete", outcomes: [{ id: selected.id, status, item: selected }] });
    };
    world.photos.rows.splice(world.photos.rows.indexOf(selected), 1);
    world.photos.rows.push(selected);

    const { alpha } = await open(world, only("home", "view:Camera", "view:Photos", "notice"));
    const runtime = camera.runtime(alpha);
    const library = photosArea.runtime(alpha);
    await press("Camera");
    await until(alpha, runtime, Machine, (state) => state.phase === "Ready" && state.last > 0);
    await press("Open last photo");
    await until(alpha, library, Viewer, (state) => state.read.status === "Loaded");
    expect(document.querySelector('img[alt="Camera.jpg"]')).not.toBeNull();
    expect(world.photos.readCount).toBe(1);

    // spec/app/photos/index.md, "The Viewer's favourite, share or delete of the item open is a change of that one item, at the revision it showed"
    await press("Favorite");
    await until(alpha, library, Viewer, (state) => state.favourite);
    await until(alpha, library, Library, (state) => state.library.status === "Loaded" && state.job.done.length === 1 && state.cameraItem > 0);
    await press("Remove from favorites");
    await until(alpha, library, Viewer, (state) => !state.favourite);
    expect(mutations).toEqual(["favorite", "unfavorite"]);

    // spec/app/photos/viewer.md, "Back from a Camera capture returns to Camera"
    await press("Photo info");
    await until(alpha, library, Viewer, (state) => state.info);
    expect(document.querySelector('[role="dialog"][aria-label="Photo info"]')?.textContent).toContain("Camera.jpg");
    await hardware("back");
    await until(alpha, library, Viewer, (state) => !state.info && state.open !== 0);

    await press("Back to Camera");
    await until(alpha, runtime, Machine, (state) => state.showing && state.phase === "Ready");
    await press("Open last photo");
    await until(alpha, library, Viewer, (state) => state.read.status === "Loaded" && state.origin === "CameraCapture");
    await hardware("back");
    await until(alpha, runtime, Machine, (state) => state.showing && state.phase === "Ready");
    await hardware("back");
    await until(alpha, runtime, Machine, (state) => !state.showing);

    await press("Photos");
    await until(alpha, library, Library, (state) => state.visible && state.library.status === "Loaded" && state.rows.length === 2);
    expect(button("Camera.jpg")).toBeUndefined();
    await press("Show more");
    await until(alpha, library, Library, (state) => state.library.status === "Loaded" && state.rows.length === 3);
    await press("Camera.jpg");
    await until(alpha, library, Viewer, (state) => state.read.status === "Loaded" && state.origin === "LibraryItem");
    await press("Back from photo");
    await until(alpha, library, Viewer, (state) => state.open === 0);
    expect(button("Camera.jpg")).toBeDefined();
  });

  it(`Close the off-page Camera viewer when the exact content changes (spec/app/photos/index.md, "The Viewer's favourite, share or delete of the item open is a change of that one item, at the revision it showed")`, async () => {
    const world = cameraWithFullPhotosAccess();
    const capture = world.photos.rows.find((item) => item.owned);
    if (capture === undefined) throw new Error("The Camera album has no capture");
    capture.date = 1795399000000;
    world.photos.rows.splice(world.photos.rows.indexOf(capture), 1);
    world.photos.rows.push(capture);
    const { alpha } = await open(world, only("home", "view:Camera", "view:Photos", "notice"));
    const library = photosArea.runtime(alpha);
    await press("Camera");
    await until(alpha, camera.runtime(alpha), Machine, (state) => state.phase === "Ready" && state.last > 0);
    await press("Open last photo");
    await until(alpha, library, Viewer, (state) => state.read.status === "Loaded");
    await drawn(() => {
      capture.size += 1;
      capture.mutationRevision = "replaced-capture";
      world.photos.changed();
    });
    await until(alpha, library, Library, (state) => state.visible && state.library.status === "Loaded" && state.cameraItem === 0);
    await until(alpha, library, Viewer, (state) => state.open === 0);
    expect(button("Camera.jpg")).toBeUndefined();
  });

  it('Let Alpha take a photo after owner approval (spec/app/camera/index.md, "Story: Let Alpha take a photo")', async () => {
    const world = { ...scene(), phone: true };
    const { alpha } = await open(world, only("home", "view:Camera", "notice"));
    const runtime = camera.runtime(alpha);
    let outcome: Promise<CaptureAnswer> | undefined;
    await drawn(() => { outcome = runtime.runPromise(requestCapture("front")); });
    await until(alpha, runtime, Machine, (state) => state.phase === "Ready" && state.agent.stage === "Asked" && state.agent.approval.showing);
    expect(world.camera.photos).toHaveLength(0);
    expect(world.camera.preview?.direction).toBe("front");
    await drawn(() => {
      const panel = document.querySelector("[aria-label='Camera request']");
      const approve = [...(panel?.querySelectorAll("button") ?? [])].find((control) => control.textContent === "Take photo");
      if (!approve) throw new Error("The Camera request did not offer approval");
      approve.click();
    });
    await until(alpha, runtime, Machine, (state) => state.agent.stage === "Over");
    expect(await outcome).toMatchObject({ result: "Taken", media: { libraryId: "image-1" } });
    expect(world.camera.photos).toHaveLength(1);
    expect(button("Open last photo")).toBeDefined();
  });

  it('Replays the saved camera receipt without an unnegotiated library ID (spec/app/camera/agent.md, "A capture is taken only when the phone saved a photo it names; any other answer, or the camera released first, is uncertain")', async () => {
    const world = { ...scene(), phone: true, image: true };
    const operation = { type: "camera_capture_photo" } as const;
    const review = textReview(world.notes.owner, "camera-shot", operation);
    const libraryId = "m:external_primary:i:17";
    review.cameraLibraryId = true;
    world.telephony.textReview = review;
    const mounts = only("home", "assistant", "view:Camera", "notice");

    const first = await open(world, mounts);
    const session = await assistant.runtime(first.alpha).runPromise(Effect.flatMap(MediaReview, (media) => media.session()));
    if (session === undefined) throw new Error("Camera review was not enrolled");
    expect(session.headers["x-eliza-device-capabilities"]).toBe("camera.capture-photo.v1,camera.capture-library-id.v1");
    const evidence = {
      version: 1, kind: operation.type, operationId: review.proposal.id,
      mediaId: "17", libraryId, width: 640, height: 480, mime: "image/jpeg",
    };
    const offline = new DeviceExecution({
      identity: session.identity,
      journal: {
        get: (id) => Promise.resolve(review.journal.get(id)),
        edit: (id, revision, next) => {
          if ((review.journal.get(id)?.revision ?? 0) !== revision) return Promise.resolve(false);
          review.journal.set(id, next);
          return Promise.resolve(true);
        },
        list: () => Promise.resolve([...review.journal.values()]),
      },
      agent: {
        decide: () => Promise.resolve(undefined),
        claim: () => {
          review.proposal.state = "executing";
          return Promise.resolve({ attemptId: 1, agentAttemptId: review.attemptId });
        },
        receipt: () => Promise.reject(new Error("The receipt connection was lost")),
        reconcile: () => Promise.resolve(undefined),
      },
      validate: () => operation,
      execute: () => Promise.resolve({ kind: "applied", result: evidence }),
      readBack: () => Promise.resolve(undefined),
    });
    const { id, digest, expiresAt } = review.proposal;
    expect(await offline.approve({ id, digest, expiresAt: Date.parse(expiresAt), operation }, {
      live: true, nonsensitive: true, exact: true, forceReview: true, requestEligible: true, reviewed: true,
    })).toMatchObject({ kind: "settled", synced: false });
    expect(review.journal.get(id)).toMatchObject({ acknowledged: false, evidence: { result: evidence } });
    await first.close();

    review.cameraLibraryId = false;
    const second = await open(world, mounts);
    const restarted = await assistant.runtime(second.alpha).runPromise(Effect.flatMap(MediaReview, (media) => media.session()));
    expect(restarted?.headers["x-eliza-device-capabilities"]).toBe("camera.capture-photo.v1");
    const { libraryId: _retainedLocally, ...wireEvidence } = evidence;
    await expect.poll(() => review.receipts).toStrictEqual([{ outcome: "applied", operationId: id, result: wireEvidence }]);
    await expect.poll(() => review.journal.get(id)).toMatchObject({ acknowledged: true, evidence: { result: evidence } });
    expect(world.camera.photos).toHaveLength(0);
  });

  it('Recovers tap-to-focus after a lost pointer capture during pinch (spec/app/camera/index.md, "Story: Frame the shot")', async () => {
    const { alpha, runtime, world } = await onCamera();

    const viewfinder = button("Viewfinder. Tap to focus or pinch to zoom");
    if (!viewfinder) throw new Error("viewfinder button is missing");
    viewfinder.getBoundingClientRect = () => new DOMRect(0, 52, 390, 500);

    await drawn(() => {
      viewfinder.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 100, clientY: 200 }));
      viewfinder.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 2, clientX: 200, clientY: 200 }));
      viewfinder.dispatchEvent(new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 1 }));
      viewfinder.dispatchEvent(new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 2 }));
      viewfinder.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 180, clientY: 250 }));
      viewfinder.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 195, clientY: 300 }));
    });
    await until(alpha, runtime, Machine, (state) => state.focus > 0 && state.confirmed === state.focus);
    expect(world.camera.focus.length).toBeGreaterThan(0);
  });

  it('Checks and saves a truncated recording when size exceeds 100 MB (spec/app/camera/recording.md, "Reaching 100 MB stops the recording and keeps what fits: a piece that would not fit is left out, never the whole video")', async () => {
    const cameraSession = await onCamera();
    const { alpha, runtime, world } = cameraSession;
    await startVideoRecording(cameraSession);

    await drawn(() => runtime.runPromise(Effect.flatMap(Machine, (m) => m.send({ type: "chunk", piece: 10_000, now: 0 }, "Phone"))));
    await drawn(() => runtime.runPromise(Effect.flatMap(Machine, (m) => m.send({ type: "chunk", piece: 104_857_600, now: 0 }, "Phone"))));
    await until(alpha, runtime, Machine, (state) => state.film.stage === "Saved" && state.film.truncated && state.film.checked);
    expect(world.camera.savedVideos).toHaveLength(1);
  });

  it('Returns Blocked Denied immediately when agent capture runs with camera permission denied (spec/app/camera/agent.md, "Story: Take a photo for Alpha")', async () => {
    const world = { ...scene(), phone: true };
    world.camera.permission = "denied";
    const { alpha } = await open(world, only("home", "view:Camera", "notice"));
    const runtime = camera.runtime(alpha);
    let settled: CaptureAnswer | undefined;
    await drawn(() => { void runtime.runPromise(requestCapture()).then((answer) => { settled = answer; }); });
    await until(alpha, runtime, Machine, (state) => state.showing && state.permission.grant === "Denied");
    await later(alpha, 1000);
    expect(settled).toEqual({ result: "Blocked", cause: "Denied" });
  });

  it('Keeps the camera surface solid dark with no visible empty video element before native preview starts (spec/app/camera/index.md, "Story: Open the camera")', async () => {
    const world = { ...scene(), phone: true };
    const gate = Promise.withResolvers<void>();
    world.camera.startGate = gate.promise;
    const { alpha } = await open(world, only("home", "view:Camera", "notice"));
    const runtime = camera.runtime(alpha);
    await press("Camera");
    await until(alpha, runtime, Machine, (state) => state.showing && state.phase === "Starting");
    const root = document.querySelector<HTMLElement>("[data-alpha-camera-root]");
    const viewfinder = document.querySelector<HTMLElement>("[data-alpha-camera=viewfinder]");
    const video = viewfinder?.querySelector<HTMLVideoElement>("video");
    expect([
      root?.classList.contains("bg-background"),
      root?.hasAttribute("data-alpha-camera-native"),
      viewfinder?.classList.contains("bg-background"),
      video?.classList.contains("invisible"),
      video?.getAttribute("poster")?.startsWith("data:image/png;base64,"),
    ]).toEqual([true, false, true, true, true]);
    await drawn(() => gate.resolve());
    await until(alpha, runtime, Machine, (state) => state.phase === "Ready");
    expect([
      root?.hasAttribute("data-alpha-camera-native"),
      video?.classList.contains("invisible"),
    ]).toEqual([true, true]);
  });

  it('Forgets a deleted last capture across Camera visits (spec/app/camera/index.md, "An older library read never replaces a photo taken while it was pending")', async () => {
    const world = { ...scene(), phone: true };
    const running = await open(world, only("home", "view:Camera", "notice"));
    const runtime = camera.runtime(running.alpha);
    await press("Camera");
    await until(running.alpha, runtime, Machine, (state) => state.phase === "Ready" && state.last > 0);
    world.photos.rows.splice(0, world.photos.rows.length, ...world.photos.rows.filter((item) => !item.owned));
    await hardware("back");
    await until(running.alpha, runtime, Machine, (state) => !state.showing);
    await press("Camera");
    await until(running.alpha, runtime, Machine, (state) => state.phase === "Ready" && state.last === 0);
    expect(await runtime.runPromise(Effect.flatMap(CameraAssets, (assets) => assets.newest()))).toBe(0);
  });
});
