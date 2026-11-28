// spec/app/files/index.md, "Story: Browse my storage"
import type { ElizaFilesPlugin, FileOutcomeRow, FilesAccess, StorageEntry, StorageVolume, TrashEntry, SelectedDocumentsPlugin } from "@elizaos/os-bridges";
import type { StorageAttachmentRow, StorageAttachmentTarget } from "../../src/platform/documents.vibe";
import { answered, type Faked, plugin } from "./phone.ts";

/** One file or folder the fake storage holds, by its volume and its path from that volume's root. */
export interface Stored {
  readonly volume: string;
  path: string;
  readonly directory: boolean;
  readonly mimeType: string;
  readonly size: number;
  modified: number;
}

/** A file in a volume's Trash: what it was, any nested descendants if a folder, and the id the phone gave it. */
interface Binned {
  readonly id: string;
  readonly was: Stored;
  readonly descendants?: Stored[];
  readonly deletedAt: number;
}

interface DocumentSelection {
  readonly volume: string;
  readonly path: string;
  readonly canRename: boolean;
}

/** What the fake phone's storage holds, and how it behaves; a journey changes it between steps. */
export interface FilesScene {
  access: FilesAccess;
  readonly volumes: StorageVolume[];
  readonly stored: Stored[];
  readonly trash: Binned[];
  /** The paths each share handed to Android's chooser, and each file opened in another app. */
  readonly shared: string[][];
  readonly opened: string[];
  /** Every call the page made, by method: what a journey asks of the phone's side. */
  readonly calls: string[];
  /** A listing waits for this before it answers. */
  gate: Promise<unknown>;
  /** The time the phone's clock says, for what it writes. */
  now: number;
  /** The most rows a listing and a search give, as `StorageBrowser.LIST_MAX` and `StorageCatalog.QUERY_MAX` are. */
  listMost: number;
  queryMost: number;
  /** Tell the page the storage changed, as the plugin's `storageChanged` event does: only while it watches a place, as `storageWatch` registers one. */
  changed: () => void;
  /** The place the page asked the phone to watch, if any: a folder as `volume:path`, or a category. */
  watching: string | undefined;
  /** Methods the phone refuses outright, answering `failed`. */
  readonly refusing: string[];
  /** The selections Alpha gave back. */
  readonly forgotten: string[];
  /** What a text file says, by path, where it is not its default words. */
  readonly texts: Record<string, string>;
  selectedByPicker: string | undefined;
  pickerRenameNeedsReselection: boolean;
  readonly selections: Map<string, DocumentSelection>;
  /** A PDF page comes back as a drawn picture, as Android's renderer gives one, rather than an address no page can load. */
  drawsPages: boolean;
}

/** A drawn PDF page: white paper with the file's name, lines of text and its page number, as an image the page can load. */
function drawnPage(path: string, page: number): string {
  const lines = [88, 92, 80, 95, 70, 90, 84, 60].map((width, at) => `<rect x='56' y='${160 + at * 28}' width='${width * 5}' height='10' rx='5' fill='#ddd'/>`).join("");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='612' height='792'><rect width='612' height='792' fill='#fff'/><text x='56' y='110' font-family='Georgia,serif' font-size='30' fill='#1a1a1a'>${leaf(path)}</text>${lines}<text x='572' y='766' font-family='sans-serif' font-size='14' text-anchor='end' fill='#555'>${page}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const file = (volume: string, path: string, mimeType: string, size = 100, modified = 1): Stored => ({ volume, path, directory: false, mimeType, size, modified });
const folder = (volume: string, path: string, modified = 1): Stored => ({ volume, path, directory: true, mimeType: "", size: 0, modified });

export function filesScene(): FilesScene {
  return {
    access: "granted",
    volumes: [{ id: "primary", name: "Internal storage", primary: true, free: 40, total: 100 }, { id: "card", name: "SD card", primary: false, free: 5, total: 10 }],
    stored: [
      folder("primary", "Download"),
      file("primary", "Download/lease.pdf", "application/pdf", 2_000, 5),
      file("primary", "Download/beach.jpg", "image/jpeg", 3_000, 6),
      folder("primary", "Documents"),
      file("primary", "Documents/notes.txt", "text/plain", 10, 3),
      folder("primary", "Documents/Old"),
      file("card", "song.mp3", "audio/mpeg", 4_000, 2),
    ],
    trash: [], shared: [], opened: [], calls: [], gate: Promise.resolve(), now: 10, listMost: 5_000, queryMost: 500, changed: () => {}, watching: undefined, refusing: [], forgotten: [], texts: {}, selectedByPicker: undefined, pickerRenameNeedsReselection: false, selections: new Map(), drawsPages: false,
  };
}

const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const leaf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const join = (folder: string, name: string) => (folder === "" ? name : `${folder}/${name}`);

function authorize(scene: FilesScene, { volume, path }: Stored, canRename: boolean): string {
  const id = crypto.randomUUID();
  scene.selections.set(id, { volume, path, canRename });
  return id;
}

/** `ElizaFiles`, the phone's storage plugin of eliza's Android package, over `scene`: it answers as `FilesPlugin.java` does. */
export function elizaFiles(scene: FilesScene): Faked {
  return plugin<ElizaFilesPlugin, { storageChanged: undefined }>((emit) => {
    scene.changed = () => { if (scene.watching !== undefined) emit("storageChanged", undefined); };
    const denied = () => scene.access !== "granted";
    /** `FilesPlugin.access()` (FilesPlugin.java:204-209, eliza ec5458230278): always `ready`, with Android's grant beside it, whatever the grant is. */
    const access = () => ({ status: "ready" as const, access: scene.access, legacy: false });
    /** `FilesPlugin.denied()` (FilesPlugin.java:77-82), which `admitted()` answers for every read and change while the grant is not `granted` (:162). */
    const refused = () => ({ status: "denied" as const, message: "Allow all-files access to browse storage.", access: scene.access, legacy: false });
    const on = (volume: string | undefined) => volume ?? "primary";
    const find = (volume: string, path: string) => scene.stored.find((one) => one.volume === volume && one.path === path);
    const inside = (volume: string, path: string) => scene.stored.filter((one) => one.volume === volume && (one.path === path || one.path.startsWith(`${path}/`)));
    const called = (method: string) => scene.calls.push(method);
    const entry = (one: Stored): StorageEntry => ({ path: one.path, name: leaf(one.path), directory: one.directory, mimeType: one.mimeType, size: one.size, modified: one.modified,
      ...(one.directory ? { children: scene.stored.filter((other) => other.volume === one.volume && other.path !== one.path && parent(other.path) === one.path).length } : {}) });
    const identity = (one: Stored) => `${one.path}@${one.modified}:${one.size}`.padEnd(43, "_").slice(0, 43).replace(/[^A-Za-z0-9_-]/g, "_");
    const unchanged = (volume: string, paths: readonly string[], reviewed: readonly string[] | undefined) =>
      (path: string) => { const found = find(volume, path); return reviewed === undefined || (found !== undefined && reviewed[paths.indexOf(path)] === identity(found)); };
    function moved(volume: string, path: string, dest: string, copy: boolean): FileOutcomeRow {
      const found = find(volume, path);
      if (!found) return { path, status: "missing" };
      if (parent(path) === dest && !copy) return { path, status: "unchanged" };
      let name = leaf(path);
      for (let n = 2; find(volume, join(dest, name)); n++) name = `${leaf(path)} (${n})`;
      const to = join(dest, name);
      for (const one of inside(volume, path)) {
        const there = `${to}${one.path.slice(path.length)}`;
        if (copy) scene.stored.push({ ...one, path: there, modified: scene.now });
        else one.path = there;
      }
      return { path, status: copy ? "copied" : "moved", to };
    }
    return {
      async storageState() {
        called("storageState");
        await scene.gate;
        return { ...access(), volumes: denied() ? [] : scene.volumes };
      },
      storageRequestAccess(input) {
        called(input?.settings ? "storageRequestAccess settings" : "storageRequestAccess");
        return Promise.resolve(access());
      },
      async storageList({ volume, path }) {
        called("storageList");
        await scene.gate;
        if (denied()) return refused();
        const there = on(volume);
        if (path !== "" && !find(there, path)?.directory) return { status: "missing" };
        const rows = scene.stored.filter((one) => one.volume === there && one.path !== path && parent(one.path) === path).map(entry);
        return { status: "ready", entries: rows.slice(0, scene.listMost), truncated: rows.length > scene.listMost };
      },
      storageCategory({ category }) {
        called("storageCategory");
        if (denied()) return Promise.resolve(refused());
        const of = (one: Stored) => category === "downloads" ? parent(one.path) === "Download"
          : category === "documents" ? one.mimeType === "application/pdf" || one.mimeType.startsWith("text/")
          : one.mimeType.startsWith(`${category.replace(/s$/, "")}/`);
        const entries = scene.stored.filter((one) => one.volume === "primary" && !one.directory && of(one)).map(entry);
        return Promise.resolve({ status: "ready", entries, count: entries.length, bytes: entries.reduce((sum, one) => sum + one.size, 0), truncated: false });
      },
      storageQuery({ text, mimePrefix, documents, folders, folder, from, to }) {
        called("storageQuery");
        if (denied()) return Promise.resolve(refused());
        const entries = scene.stored.filter((one) => one.volume === "primary" && one.directory === (folders === true)
          && (from === undefined || one.modified >= from)
          && (to === undefined || one.modified <= to)
          && (folder === undefined || parent(one.path) === folder)
          && (text === undefined || leaf(one.path).toLowerCase().includes(text.toLowerCase()))
          && (mimePrefix === undefined || one.mimeType.startsWith(mimePrefix))
          && (!documents || one.mimeType === "application/pdf" || one.mimeType.startsWith("text/"))).map(entry);
        return Promise.resolve({ status: "ready", entries: entries.slice(0, scene.queryMost) });
      },
      storageReviewedIdentities({ volume, paths }) {
        called("reviewed");
        const found = paths.map((path) => find(on(volume), path)).filter((one): one is Stored => one !== undefined);
        return Promise.resolve(found.length === paths.length ? { status: "ready", reviewed: found.map((one) => identity(one)) } : { status: "missing" });
      },
      storageTransfer({ volume, paths, dest, copy, reviewed }) {
        called(copy ? "copy" : "move");
        const same = unchanged(on(volume), paths, reviewed);
        return Promise.resolve({ status: "ready", outcomes: paths.map((path): FileOutcomeRow => (same(path) ? moved(on(volume), path, dest, copy) : { path, status: "changed" })) });
      },
      storageRename({ volume, path, name }) {
        called("rename");
        const found = find(on(volume), path);
        if (!found) return Promise.resolve({ status: "missing" });
        const to = join(parent(path), name);
        if (find(on(volume), to)) return Promise.resolve({ status: "exists" });
        for (const one of inside(on(volume), path)) {
          const was = one.path;
          one.path = `${to}${was.slice(path.length)}`;
          if (scene.texts[was] !== undefined) {
            scene.texts[one.path] = scene.texts[was];
            delete scene.texts[was];
          }
        }
        return Promise.resolve({ status: "ready", path: to });
      },
      storageCreateFolder({ volume, parent: where, name }) {
        called("createFolder");
        const path = join(where, name);
        if (find(on(volume), path)) return Promise.resolve({ status: "exists" });
        scene.stored.push(folder(on(volume), path, scene.now));
        return Promise.resolve({ status: "ready", path });
      },
      storageTrash({ volume, paths, reviewed }) {
        called("trash");
        const same = unchanged(on(volume), paths, reviewed);
        return Promise.resolve({ status: "ready", outcomes: paths.map((path): FileOutcomeRow => {
          const found = find(on(volume), path);
          if (!found) return { path, status: "missing" };
          if (!same(path)) return { path, status: "changed" };
          const id = String(Math.max(0, ...scene.trash.map((one) => Number(one.id) || 0)) + 1);
          const all = inside(on(volume), path);
          const descendants = all.filter((one) => one !== found);
          for (const one of all) scene.stored.splice(scene.stored.indexOf(one), 1);
          scene.trash.push({ id, was: found, descendants, deletedAt: scene.now });
          return { path, status: "trashed", to: id };
        }) });
      },
      storageTrashList(input) {
        called("trashList");
        if (denied()) return Promise.resolve(refused());
        const items: TrashEntry[] = scene.trash.filter((one) => input?.volume === undefined || one.was.volume === input.volume)
          .map(({ id, was, deletedAt }) => ({ id, name: leaf(was.path), origin: parent(was.path), directory: was.directory, mimeType: was.mimeType, size: was.size, deletedAt }));
        return Promise.resolve({ status: "ready", items });
      },
      storageRestore({ volume, ids }) {
        called("restore");
        if (scene.refusing.includes("storageRestore")) return Promise.resolve({ status: "failed" });
        if (scene.refusing.includes(`storageRestore:${on(volume)}`)) return Promise.reject(new Error("The phone did not return the restore receipt"));
        return Promise.resolve({ status: "ready", outcomes: ids.map((id): FileOutcomeRow => {
          const found = scene.trash.find((one) => one.id === id && one.was.volume === on(volume));
          if (!found) return { path: id, status: "missing" };
          scene.trash.splice(scene.trash.indexOf(found), 1);
          scene.stored.push(found.was, ...(found.descendants ?? []));
          return { path: id, status: "restored", to: found.was.path };
        }) });
      },
      storageEmptyTrash({ ids }) {
        called("erase");
        const gone = scene.trash.filter((one) => ids.includes(one.id));
        for (const one of gone) scene.trash.splice(scene.trash.indexOf(one), 1);
        return Promise.resolve({ status: "ready", count: gone.length });
      },
      storageShare({ paths }) {
        called("share");
        scene.shared.push([...paths]);
        return Promise.resolve({ status: "opened", count: paths.length });
      },
      storageOpen({ path }) {
        called("open");
        if (scene.refusing.includes("storageOpen")) return Promise.resolve({ status: "unsupported" });
        scene.opened.push(path);
        return Promise.resolve({ status: "opened", count: 1 });
      },
      storageSelect({ volume, path }) {
        called("storageSelect");
        if (denied()) return Promise.resolve(refused());
        const found = find(on(volume), path);
        return Promise.resolve(found && !found.directory ? {
          status: "selected", action: "files", selectionId: authorize(scene, found, false), name: leaf(path), mimeType: found.mimeType, canRename: false,
        } : { status: "missing" });
      },
      storageWatch(input) {
        called("storageWatch");
        scene.watching = input.category ?? `${on(input.volume)}:${input.path ?? ""}`;
        return Promise.resolve({ status: "ready" });
      },
      storageUnwatch() {
        called("storageUnwatch");
        scene.watching = undefined;
        return Promise.resolve({ status: "ready" });
      },
    };
  });
}

/** The documents the fake phone holds for Alpha, as eliza's `SelectedDocuments` host answers: a text's words, a picture's address, a PDF's pages. */
export function selectedDocuments(scene: FilesScene): Faked {
  return plugin<SelectedDocumentsPlugin & {
    pickSelected(): Promise<unknown>;
    attachmentSelected(options: { selectionId: string }): Promise<unknown>;
    reviewStorageAttachment(options: StorageAttachmentRow): Promise<unknown>;
    readStorageAttachment(options: StorageAttachmentTarget & { reviewed: string }): Promise<unknown>;
  }, Record<string, never>>(() => {
    const reviewed = new Map<string, { file: Stored; revision: number }>();
    const storedAttachment = ({ path, volume = "primary" }: StorageAttachmentTarget) =>
      scene.access === "granted" ? scene.stored.find((file) => !file.directory && file.volume === volume && file.path === path) : undefined;
    const held = (selectionId: string) => {
      const selection = scene.selections.get(selectionId);
      return selection === undefined ? undefined : scene.stored.find((one) =>
        !one.directory && one.volume === selection.volume && one.path === selection.path);
    };
    const described = (selectionId: string, found: Stored) => ({
      status: "selected", selectionId, name: leaf(found.path), mimeType: found.mimeType, uri: `content://${found.path}`, size: found.size, modified: found.modified,
      canRename: scene.selections.get(selectionId)?.canRename === true,
    });
    return {
      restoreSelected: () => Promise.resolve({ status: "unavailable", message: "" }),
      pickSelected() {
        const path = scene.selectedByPicker;
        scene.selectedByPicker = undefined;
        const found = scene.stored.find((one) => !one.directory && one.path === path);
        return Promise.resolve({ selectionId: found === undefined ? "" : authorize(scene, found, true) });
      },
      attachmentSelected({ selectionId }) {
        const found = held(selectionId);
        if (!found) return Promise.reject(new Error("Access ended"));
        const raw = scene.texts[found.path] ?? `The words of ${leaf(found.path)}`;
        const hasWideChar = Array.from(raw).some((ch) => (ch.codePointAt(0) ?? 0) > 0xff);
        const dataBase64 = hasWideChar
          ? btoa(Array.from(new TextEncoder().encode(raw), (byte) => String.fromCharCode(byte)).join(""))
          : btoa(raw);
        return Promise.resolve({ name: leaf(found.path), mimeType: found.mimeType, dataBase64 });
      },
      reviewStorageAttachment: (input) => answered(() => {
        const file = storedAttachment(input);
        if (!file || leaf(file.path) !== input.name || file.mimeType !== input.mimeType || file.size !== input.size || file.modified !== input.modified) {
          throw new Error("The listed file changed");
        }
        const receipt = crypto.randomUUID().padEnd(43, "_");
        reviewed.set(receipt, { file, revision: file.modified });
        return { reviewed: receipt };
      }),
      readStorageAttachment: (input) => answered(() => {
        const review = reviewed.get(input.reviewed);
        const file = storedAttachment(input);
        if (!file || !review || review.file !== file || review.revision !== file.modified) throw new Error("The reviewed file changed");
        const text = scene.texts[file.path];
        if (text === undefined || text.length !== file.size) throw new Error("Fixture attachment bytes unavailable");
        return { name: leaf(file.path), mimeType: file.mimeType, dataBase64: btoa(text) };
      }),
      describeSelected({ selectionId }) {
        const found = held(selectionId);
        return Promise.resolve(found ? described(selectionId, found) : { status: "unavailable", message: "" });
      },
      renameSelected({ selectionId, name }) {
        const found = held(selectionId);
        if (!found) return Promise.resolve({ status: "unavailable", message: "" });
        const selection = scene.selections.get(selectionId);
        if (!selection?.canRename) return Promise.resolve({ status: "unsupported", message: "" });
        found.path = join(parent(found.path), name);
        found.modified = scene.now;
        if (scene.pickerRenameNeedsReselection) {
          scene.selections.delete(selectionId);
          return Promise.resolve({ status: "renamed-reselect", message: "" });
        }
        scene.selections.set(selectionId, { ...selection, path: found.path });
        return Promise.resolve(described(selectionId, found));
      },
      pdfSelected({ selectionId, page }) {
        const found = held(selectionId);
        return Promise.resolve(found?.mimeType === "application/pdf" ? { status: "rendered", message: "", page, pageCount: 3, imageUri: scene.drawsPages ? drawnPage(found.path, page) : `page://${found.path}/${page}` } : { status: "unsupported", message: "" });
      },
      readSelected({ selectionId }) {
        if (scene.refusing.includes("readSelected")) return Promise.resolve({ status: "failed", message: "" });
        const found = held(selectionId);
        return Promise.resolve(found ? { status: "read", message: "", text: scene.texts[found.path] ?? `The words of ${leaf(found.path)}`, mimeType: found.mimeType, bytes: found.size } : { status: "unavailable", message: "" });
      },
      openSelected({ selectionId }) {
        if (!held(selectionId)) return Promise.resolve({ status: "unavailable", message: "" });
        scene.opened.push(selectionId);
        return Promise.resolve({ status: "opened", message: "" });
      },
      shareSelected({ selectionId }) {
        if (!held(selectionId)) return Promise.resolve({ status: "unavailable", message: "" });
        scene.shared.push([selectionId]);
        return Promise.resolve({ status: "opened", message: "" });
      },
      forgetSelected({ selectionId }) {
        scene.selections.delete(selectionId);
        scene.forgotten.push(selectionId);
        return Promise.resolve();
      },
    };
  });
}
