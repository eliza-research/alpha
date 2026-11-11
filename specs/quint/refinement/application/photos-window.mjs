import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { checkTraces } from "../check-traces.mjs";
import { root, captureSources, boundInputs, call, trace, checkpoint, deferred, tick } from "./support.mjs";
const driver = fileURLToPath(import.meta.url);
async function compilePhotosWindow(extraSources = []) {
  const unused = (name) => `()=>{throw Error(${JSON.stringify(name + " is outside Photos window fixture")})}`;
  const ports = /* @__PURE__ */ new Map([
    ["../platform-plugins", "export const registerPlugin=name=>__ports.plugin(name);"],
    ["@capacitor/core", "export const Capacitor={isNativePlatform:()=>true,isPluginAvailable:name=>name==='AlphaPhotos'};"],
    ["./browser-camera", `export const browserCamera={},browserLibrary={},browserPhotoLibrary={};export const mountBrowserCamera=${unused("browser camera")},importBrowserPhoto=${unused("import")},openCameraImageImport=${unused("camera image import")},saveBrowserMedia=${unused("export")},onBrowserPreviewEnded=${unused("browser preview")};`],
    ["../daily", "export const DailyApps={async addListener(){return {async remove(){}}}};"],
    ["../runtime/connection-ui", `export const connectionController={getSnapshot:${unused("connection")}};`],
    ["../runtime/media-copy-intent", `export const readMediaCopyIntent=async()=>null;export const admitMediaCopyIntent=${unused("copy")},acknowledgeMediaCopyIntent=${unused("copy")},mediaCopyIntentDocument=${unused("copy")};`],
    ["../runtime/inline-modal", "export const createInlineModal=()=>({ref(){}});"],
    ["./file-email-review", `export const reviewFileEmail=${unused("email")};`],
    ["../browser/content-question", `export const reviewContentQuestion=${unused("question")};`],
    ["./video-edit-review", `export const openVideoEditReview=${unused("video edit")};`],
    ["./scan-review", `export class ScanKeepError extends Error{};export const openScanReview=${unused("scan")};`],
    ["./scan-pdf", `export class ScanPdfExportError extends Error{};export const systemPickerActive=()=>false,scanExportTitle=${unused("scan title")},exportScanPdf=${unused("scan PDF")},scanPdfRetryable=${unused("scan retry")},duringSystemPicker=${unused("scan picker")};`]
  ]);
  const built = await build({
    absWorkingDir: root,
    entryPoints: ["apps/app/src/prototype/camera-adapter.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    metafile: true,
    loader: { ".css": "empty" },
    define: { "import.meta.env": JSON.stringify({ DEV: false, VITE_ELIZA_DEV_ALLOW_TEST_MOCKS: "" }) },
    plugins: [{ name: "photos-window-ports", setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => ports.has(args.path) ? { path: args.path, namespace: "ports" } : void 0);
      builder.onLoad({ filter: /.*/, namespace: "ports" }, (args) => ({ loader: "js", contents: ports.get(args.path) }));
      builder.onLoad({ filter: /\/photos-view\.ts$/ }, (args) => {
        const text = readFileSync(args.path, "utf8"), marker = "  let cursor = options.more ? options.cursor : \"\";";
        assert.equal(text.split(marker).length, 2, "One real readWindow accumulation seam");
        return { loader: "ts", contents: text.replace(marker, marker + "\n  __ports.reader=()=>({rows,cursor,want,more:options.more});") };
      });
      builder.onLoad({ filter: /\/camera-adapter\.ts$/ }, (args) => {
        const text = readFileSync(args.path, "utf8"), marker = "  async function refresh(more = false) {";
        assert.equal(text.split(marker).length, 2, "One real Photos window observer seam");
        const observed = text.replace("loading = true; const token = ++libraryEpoch;", "loading = true; const token = ++libraryEpoch;__ports.loadInfo={more,token};")
          .replace("trashLoading = true; const token = ++trashEpoch;", "trashLoading = true; const token = ++trashEpoch;__ports.trashInfo={more,token};");
        return { loader: "ts", contents: observed.replace(marker, `  __ports.inspect=()=>({disposed,captures,loaded,loading,next,libraryEpoch,libraryAccess,refreshAgain,counts,countsBusy,countsError,countsEpoch,albumRows,albumKey,albumNext,albumBusy,albumEpoch,trash,trashNext,trashLoaded,trashLoading,trashRefreshAgain,trashEpoch,selection,preview,reading,photoReadEpoch,mutating});
${marker}`) };
      });
    } }]
  });
  const sources = [...Object.keys(built.metafile.inputs).filter((path) => !path.startsWith("ports:") && !path.startsWith("<")), driver, "specs/quint/refinement/application/support.mjs", ...extraSources];
  captureSources(sources);
  return { code: built.outputFiles[0].text, sources };
}
async function createPhotosWindowFixture(compiled, { holdCounts = false, holdTrash = false, albumPort = {} } = {}) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://fixture.invalid" });
  const { window } = dom, { document } = window;
  Object.defineProperty(document, "hidden", { configurable: true, value: false, writable: true });
  const accesses = [], pages = [], updates = [], summaries = [], trashes = [], toasts = [];
  const ports = {}, listeners = new Map();
  const native = {
    libraryAccess() {
      const task = deferred();
      accesses.push({ task, settled: false, ...ports.loadInfo });
      return task.promise;
    },
    list(options = {}) {
      if (options.trashed) {
        const request = { settled: !holdTrash, task: holdTrash ? deferred() : null, options, ...ports.trashInfo };
        trashes.push(request);
        return request.task ? request.task.promise : Promise.resolve({ items: [], next: "" });
      }
      const task = deferred();
      pages.push({ options, task, settled: false });
      return task.promise;
    },
    summary() {
      const request = { settled: !holdCounts, task: holdCounts ? deferred() : null };
      summaries.push(request);
      return request.task ? request.task.promise : Promise.resolve({ favorites: 0, videos: 0, trash: 0, canFavorite: true });
    },
    async albums() {
      return { items: [] };
    },
    async watchLibrary() {
    },
    async addListener(event, listener) {
      listeners.set(event, listener);
      return { async remove() { listeners.delete(event); } };
    },
    async cancelPhotoSelected() {
    },
    ...albumPort
  };
  ports.plugin = (name) => name === "AlphaPhotos" || name === "AlphaMailAttachments" ? native : new Proxy({}, {
    get: (_target, method) => () => {
      throw Error(name + "." + String(method) + " outside Photos window fixture");
    }
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", "__ports", "window", "document", "HTMLElement", "Element", "MutationObserver", "getComputedStyle", compiled.code)(
    createRequire(import.meta.url),
    module,
    module.exports,
    ports,
    window,
    document,
    window.HTMLElement,
    window.Element,
    window.MutationObserver,
    window.getComputedStyle.bind(window)
  );
  const state = { tab: "lib", album: null, open: null, sheet: null, filter: null }, shell = { chat: "peek", view: "photos" };
  let active = true, retired = false, afterSet = () => {
  };
  const api = { ic: {}, S: shell, get: () => state, isActive: () => active, set(patch) {
    Object.assign(state, patch);
    updates.push(structuredClone(patch));
    afterSet(patch);
  }, toast(message) {
    toasts.push(message);
  } };
  class Component {
  }
  const views = { camera: { render: () => ({}), onLeave() {
  } }, photos: { render: () => ({ tabs: [], groups: [] }), onLeave() {
  } } };
  const dispose = module.exports.installPrototypeCameraAdapter(Component, views);
  async function render() {
    const output = views.photos.render(state, api);
    await tick();
    await tick();
    return output;
  }
  async function access(index, scope = "full", success = true) {
    const pending = accesses[index];
    assert.ok(pending && !pending.settled);
    pending.settled = true;
    if (success) pending.task.resolve({ scope, images: scope === "denied" ? "denied" : "full", videos: scope === "denied" ? "denied" : "full" });
    else pending.task.reject(Error("Access failed"));
    await tick();
    await tick();
  }
  async function page(index, items, next = "", success = true) {
    const pending = pages[index];
    assert.ok(pending && !pending.settled);
    pending.settled = true;
    if (success) pending.task.resolve({ items, next });
    else pending.task.reject(Error("Page failed"));
    await tick();
    await tick();
  }
  async function hide() {
    document.hidden = true;
    document.dispatchEvent(new window.Event("visibilitychange"));
    await tick();
    await tick();
  }
  async function show() {
    document.hidden = false;
    document.dispatchEvent(new window.Event("visibilitychange"));
    await tick();
    await tick();
  }
  async function leave() {
    active = false;
    views.photos.onLeave(api);
    await tick();
  }
  function retire() {
    if (!retired) {
      retired = true;
      dispose();
    }
  }
  async function retry() {
    const output = await render();
    output.libraryRetry();
    await tick();
    await tick();
  }
  async function more() {
    const output = await render(), grid = document.createElement("div");
    Object.defineProperties(grid, { clientWidth: { value: 412 }, clientHeight: { value: 600 }, scrollHeight: { value: 900 } });
    grid.scrollTop = 500;
    document.body.append(grid);
    output.gridRef(grid);
    await tick();
    grid.dispatchEvent(new window.Event("scroll"));
    await tick();
    await tick();
  }
  async function counts(index, success = true) {
    const request = summaries[index];
    assert.ok(request?.task && !request.settled);
    request.settled = true;
    if (success) request.task.resolve({ favorites: 1, videos: 0, trash: 0, canFavorite: true });
    else request.task.reject(Error("Counts failed"));
    await tick();
    await tick();
  }
  async function trash(index, items, next = "", success = true) {
    const request = trashes[index];
    assert.ok(request?.task && !request.settled);
    request.settled = true;
    if (success) request.task.resolve({ items, next });
    else request.task.reject(Error("Trash failed"));
    await tick();
    await tick();
  }
  async function enter() { active = true; await render(); }
  async function emitLibrary() { listeners.get("libraryChanged")?.(); await tick(); await tick(); }
  async function close() {
    retire();
    for (const request of [...accesses, ...pages, ...summaries, ...trashes]) if (!request.settled) {
      request.settled = true;
      request.task.reject(Error("Fixture teardown"));
    }
    await tick();
    window.close();
  }
  return { state, shell, api, views, window, document, accesses, pages, updates, summaries, trashes, toasts, render, retry, more, access, page, counts, trash, hide, show, leave, enter, emitLibrary, retire, close, get active() {
    return active;
  }, onSet(callback) {
    afterSet = callback;
  }, inspect: () => structuredClone(ports.inspect()), reader: () => ports.reader ? structuredClone(ports.reader()) : null };
}
const rawRow = (id, rank = id, revision = 1) => ({ id: "m:" + id, date: rank, image: "", width: 1, height: 1, revision: "r" + revision });
const rowOf = (value) => ({ id: Number(value.id.replace(/^native-camera-/, "").slice(2)), rank: value.date, revision: Number(value.revision.slice(1)) });
const cursorOf = (value) => value ? Number(value.slice(1)) : 0;
function observeWindow(f) {
  const value = f.inspect(), reader = f.reader(), last = f.accesses.at(-1);
  const phase = f.accesses.some((request) => !request.settled) ? "access" : f.pages.some((request) => !request.settled) ? "page" : "none";
  return {
    "s.hidden": f.document.hidden,
    "s.active": f.active,
    "s.disposed": value.disposed,
    "s.captures": value.captures.map(rowOf),
    "s.loaded": value.loaded,
    "s.loading": value.loading,
    "s.next": cursorOf(value.next),
    "s.epoch": value.libraryEpoch,
    "s.access": value.libraryAccess?.scope ?? "unknown",
    "s.again": value.refreshAgain,
    "s.job": f.accesses.length,
    "s.jobToken": last?.token ?? 0,
    "s.phase": phase,
    "s.more": last?.more ?? false,
    "s.reader": !!reader,
    "s.rows": reader?.rows.map(rowOf) ?? [],
    "s.cursor": cursorOf(reader?.cursor),
    "s.want": reader?.want ?? 0,
    "s.error": !!f.state.nativeLibraryError
  };
}
async function checkPhotosWindow(extraSources = []) {
  const compiled = await compilePhotosWindow(extraSources), traces = [];
  const cases = [
    "reentrant-refresh",
    "one-page",
    "more",
    "reload-all-pages",
    "coalesced",
    "first-access-hidden",
    "page-hidden",
    "hidden-show-access",
    "hidden-show-page",
    "access-failure",
    "page-failure",
    "late-failure",
    "denied-own",
    "disposed-access",
    "disposed-page",
    "leave-page",
    "sort-ties",
    "more-updates-id",
    "retry-after-failure"
  ];
  for (const name of cases) {
    const f = await createPhotosWindowFixture(compiled), t = trace(name, observeWindow(f));
    const step = (label, action) => checkpoint(t, label, action, observeWindow(f));
    const access = async (index, scope = "full", success = true) => {
      await f.access(index, scope, success);
      step("native access " + index + " settles", call("accessReply", scope, success));
    };
    const page = async (index, rows, next = "", success = true) => {
      await f.page(index, rows, next, success);
      step("native page " + index + " settles", call("pageReply", rows.map(rowOf), cursorOf(next), success));
    };
    try {
      await f.render();
      step("mounted Photos starts its real window read", call("refresh", false));
      if (name === "reentrant-refresh") {
        let once = false;
        f.onSet((patch) => {
          if (!once && Object.hasOwn(patch, "nativeCaptureRevision")) {
            once = true;
            f.views.photos.render(f.state, f.api).libraryRetry();
          }
        });
      }
      if (name === "coalesced") {
        await f.retry();
        step("retry while current read waits", call("refresh", false));
      }
      if (name === "first-access-hidden" || name === "hidden-show-access") {
        await f.hide();
        step("native page hides before access reply", call("hide"));
        if (name === "hidden-show-access") {
          await f.show();
          step("return while old access is pending", call("show"));
        }
        await access(0);
        if (name === "first-access-hidden") {
          assert.equal(f.pages.length, 0);
          traces.push(t);
          continue;
        }
        await access(1);
        await page(0, [rawRow(1)]);
        traces.push(t);
        continue;
      }
      if (name === "disposed-access") {
        f.retire();
        step("dispose while access is pending", call("dispose"));
        await access(0);
        traces.push(t);
        continue;
      }
      if (name === "access-failure" || name === "retry-after-failure") {
        await access(0, "full", false);
        if (name === "retry-after-failure") {
          await f.retry();
          step("explicit retry after failure", call("refresh", false));
          await access(1);
          await page(0, [rawRow(1)]);
        }
        traces.push(t);
        continue;
      }
      await access(0, name === "denied-own" ? "denied" : "full");
      if (["page-hidden", "hidden-show-page", "late-failure"].includes(name)) {
        await f.hide();
        step("native page hides with list pending", call("hide"));
        if (name !== "page-hidden") {
          await f.show();
          step("return queues a fresh read", call("show"));
        }
        await page(0, [rawRow(1)], "", name !== "late-failure");
        if (name !== "page-hidden") {
          await access(1);
          await page(1, [rawRow(2)]);
        }
        traces.push(t);
        continue;
      }
      if (name === "disposed-page") {
        f.retire();
        step("dispose with a list pending", call("dispose"));
        await page(0, [rawRow(1)]);
        traces.push(t);
        continue;
      }
      if (name === "leave-page") {
        await f.leave();
        step("leave Photos while its cache read is pending", call("leave"));
      }
      const first = name === "sort-ties" ? [rawRow(1, 2), rawRow(3, 2), rawRow(2, 1)] : name === "reload-all-pages" ? [rawRow(1), rawRow(2)] : [rawRow(1)];
      if (name === "reentrant-refresh") {
        await f.page(0, first);
        step("reentrant publication callback queues retry before cleanup", [call("refresh", false), call("pageReply", first.map(rowOf), 0, true)]);
        await access(1);
        await page(1, [rawRow(2)]);
        traces.push(t);
        continue;
      }
      await page(0, first, ["more", "reload-all-pages", "more-updates-id"].includes(name) ? "c1" : "", name !== "page-failure");
      if (name === "coalesced") {
        await access(1);
        await page(1, [rawRow(2)]);
      }
      if (name === "more" || name === "more-updates-id") {
        await f.more();
        step("real grid scroll requests next page", call("refresh", true));
        await access(1);
        await page(1, name === "more-updates-id" ? [rawRow(1, 3, 2), rawRow(2)] : [rawRow(2)]);
      }
      if (name === "reload-all-pages") {
        await f.retry();
        step("reload retains loaded window size", call("refresh", false));
        await access(1);
        await page(1, [rawRow(2)], "c2");
        await page(2, [rawRow(1)]);
      }
      traces.push(t);
    } finally {
      await f.close();
    }
  }
  return checkTraces(boundInputs({ model: "PhotosWindow", sources: compiled.sources, traces, scope: "bounded-component", assumptions: [
    "Actual installed camera/Photos adapter, shared camera session, native catalog port and real readWindow/mergeWindow/newestFirst helpers execute. Unused capture/edit/scan/email and browser ports throw or remain inert.",
    "The campaign covers native catalog access and window reads with three stable media identities, bounded rank/revision classes, two cursors and four load identities. Each provider reload page is internally unique and does not repeat an earlier item in that reload.",
    "The real readWindow local accumulation is exposed by a read-only build-time closure observer. The renderer owns request serialization, lifecycle epochs and coalescing. An inactive visible Photos cache may finish, while hidden native catalogs cannot publish.",
    "Album/Trash/counts read protocols, selection/viewer, mutation reviews, thumbnail memory, all provider concurrency and browser media persistence remain separate obligations. Provider replies are controlled native ports, not device evidence."
  ] }));
}
export {
  checkPhotosWindow,
  compilePhotosWindow,
  createPhotosWindowFixture,
  rawRow, rowOf, cursorOf
};
