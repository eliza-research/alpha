import { createScanPdf } from "@elizaos/plugin-files-client";
import { Effect, ManagedRuntime, Option } from "effect";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { changeDraft, readDraft, type StoredPage } from "../src/files/scanStore.vibe";
import { Documents } from "../src/platform/documents.vibe";
import { Files } from "../src/platform/files.vibe";
import { browserLibrary } from "../src/platform/library.vibe";
import { closeAll, coverLifted, later, only, open } from "./alpha.tsx";
import { scene } from "./fakes/scene.ts";
import "../src/main.css";

function choose(input: HTMLInputElement, file: File): void {
  const items = new DataTransfer();
  items.items.add(file);
  input.files = items.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function scannedPage(width: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, 50);
  const paint = canvas.getContext("2d");
  if (!paint) throw new Error("The scan fixture has no canvas context");
  paint.fillRect(0, 0, width, 50);
  return canvas.convertToBlob({ type: "image/png" });
}

async function pick(file: File, runtime: ManagedRuntime.ManagedRuntime<Documents | Files, never>) {
  const pending = runtime.runPromise(Effect.flatMap(Documents, (documents) => documents.pick()));
  await expect.poll(() => document.querySelector("input[type=file]")).toBeInstanceOf(HTMLInputElement);
  const chooser = document.querySelector<HTMLInputElement>("input[type=file]");
  if (!chooser) throw new Error("no browser file chooser");
  choose(chooser, file);
  return Option.getOrThrow(await pending);
}

// spec/app/files/recent.md, "Story: Pick a file with the system picker"; spec/app/files/preview.md, "Story: Look at a file"
it("imports a chosen file, opens its text, and finds it again in a new browser library runtime", async () => {
  const name = `alpha-library-${crypto.randomUUID()}.txt`;
  const path = `Download/${name}`;
  const words = "A local Files fixture.";
  const first = ManagedRuntime.make(browserLibrary);
  const reopened = ManagedRuntime.make(browserLibrary);
  try {
    const chosen = await pick(new File([words], name, { type: "text/plain" }), first);
    const original = Option.getOrThrow(first.runSync(Effect.map(Documents, (documents) => documents.client)));
    expect(await original.read(chosen)).toMatchObject({ status: "read", text: words });
    await first.dispose();

    const storage = Option.getOrThrow(reopened.runSync(Effect.map(Files, (files) => files.plugin)));
    const listed = await storage.storageList({ path: "Download" });
    expect(listed.status).toBe("ready");
    expect(listed.entries?.map((entry) => entry.name)).toContain(name);
    const selection = await storage.storageSelect({ path });
    if (selection.status !== "selected" || !("selectionId" in selection)) throw new Error("the imported file could not be selected");
    const documents = Option.getOrThrow(reopened.runSync(Effect.map(Documents, (port) => port.client)));
    const id = selection.selectionId as typeof chosen;
    expect(await documents.read(id)).toMatchObject({ status: "read", text: words });

    const reviewed = await storage.storageReviewedIdentities({ paths: [path] });
    expect(reviewed.reviewed).toHaveLength(1);
    const trashed = await storage.storageTrash({ paths: [path], reviewed: reviewed.reviewed });
    expect(trashed.outcomes).toEqual([expect.objectContaining({ path, status: "trashed" })]);
    const trash = await storage.storageTrashList();
    const item = trash.items?.find((one) => one.origin === "Download" && one.name === name);
    if (!item) throw new Error("the imported file did not reach Recently deleted");
    await expect(storage.storageEmptyTrash({ ids: [item.id], confirmed: true })).resolves.toMatchObject({ status: "ready", count: 1 });
    expect(await documents.read(id)).toMatchObject({ status: "unavailable" });
  } finally {
    await first.dispose();
    await reopened.dispose();
  }
});

// spec/app/files/preview.md, "A page is shown only when the worker drew it in isolation and handed it over unwritable"
it("draws the selected PDF one page at a time", async () => {
  const images = await Promise.all([scannedPage(40), scannedPage(60)]);
  const bytes = await Effect.runPromise(createScanPdf({ title: "Files preview", creator: "Alpha" }, images));
  const file = new File([bytes], `alpha-pdf-${crypto.randomUUID()}.pdf`, { type: "application/pdf" });
  const runtime = ManagedRuntime.make(browserLibrary);
  try {
    const id = await pick(file, runtime);
    const documents = Option.getOrThrow(runtime.runSync(Effect.map(Documents, (port) => port.client)));
    const first = await documents.pdf(id, 1);
    const second = await documents.pdf(id, 2);
    expect(first).toMatchObject({ status: "rendered", page: 1, pageCount: 2 });
    expect(second).toMatchObject({ status: "rendered", page: 2, pageCount: 2 });
    if (!first.imageUri || !second.imageUri) throw new Error("PDF pages did not produce browser images");
    expect(first.imageUri).not.toBe(second.imageUri);
    expect((await (await fetch(second.imageUri)).blob()).type).toBe("image/png");
    expect(await documents.pdf(id, 3)).toMatchObject({ status: "failed" });
    await documents.forget(id);
    await expect(fetch(second.imageUri)).rejects.toThrow();
  } finally {
    await runtime.dispose();
  }
});

it('Reorder pages after the clock advances (spec/app/files/scan.md, "Story: Arrange the pages")', async () => {
  await page.viewport(412, 915);
  const { alpha } = await open(scene(), only("home", "view:Files"));
  await coverLifted(alpha);
  try {
    await page.getByRole("button", { name: "Files", exact: true }).click();
    const tools = page.getByRole("button", { name: "Files tools", exact: true });
    await expect.element(tools).toBeVisible();
    document.documentElement.style.setProperty("--alpha-native-inset-top", "58px");
    const main = document.querySelector("main");
    const header = document.querySelector("section[aria-label=Files] header");
    if (!main || !header) throw new Error("Files header did not mount");
    await expect.poll(() => Math.round(header.getBoundingClientRect().top - main.getBoundingClientRect().top)).toBe(58);
    main.setAttribute("data-alpha-launcher", "");
    try {
      expect(Math.round(header.getBoundingClientRect().top - main.getBoundingClientRect().top)).toBe(58);
    } finally {
      main.removeAttribute("data-alpha-launcher");
    }
    document.documentElement.style.removeProperty("--alpha-native-inset-top");
    const trigger = tools.element();
    if (!(trigger instanceof HTMLButtonElement)) throw new Error("Files tools is not a button");
    trigger.focus();
    await userEvent.keyboard("{ArrowDown}");
    const menu = page.getByRole("menu", { name: "Files tools", exact: true });
    await menu.getByRole("menuitem", { name: "Scan document", exact: true }).click();
    const scanner = page.getByRole("dialog", { name: "Scan document", exact: true });
    await expect.element(scanner).toBeVisible();
    const image = (number: number) => scanner.getByRole("img", { name: `Document page ${number}`, exact: true });
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Add page"]');
    if (!input) throw new Error("The scanner has no image picker");
    for (const width of [40, 60]) {
      const blob = await scannedPage(width);
      choose(input, new File([blob], `scan-${width}.png`, { type: blob.type }));
      await expect.element(image(width === 40 ? 1 : 2)).toBeVisible();
    }
    const first = image(1).element().getAttribute("src");
    const second = image(2).element().getAttribute("src");
    if (!first || !second || first === second) throw new Error("The scanner did not open two distinct pages");
    await later(alpha, 10_000);
    await scanner.getByRole("button", { name: "Move page 1 later", exact: true }).click();
    await expect.element(image(1)).toHaveAttribute("src", second);
    await expect.element(image(2)).toHaveAttribute("src", first);
  } finally {
    document.documentElement.style.removeProperty("--alpha-native-inset-top");
    await closeAll();
    await new Promise<void>((resolve, reject) => {
      const removed = indexedDB.deleteDatabase("alpha-scan-pages");
      removed.onsuccess = () => resolve();
      removed.onerror = () => reject(new Error("Could not remove the test scan draft", { cause: removed.error }));
    });
  }
});

// spec/app/files/scanDraft.md, "Story: Keep the scan as I work"
it("deletes scan drafts without conflicting on the next edit and clears damaged drafts", async () => {
  const pixel = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196,
    137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 255, 255, 63, 0, 5, 254, 2, 254, 167, 53, 129, 132, 0, 0, 0,
    0, 73, 69, 78, 68, 174, 66, 96, 130,
  ]);
  const samplePage: StoredPage = {
    blob: new Blob([pixel], { type: "image/png" }),
    width: 1,
    height: 1,
    page: { image: 1, camera: false, text: 0, blank: false, edits: 0, links: 0 },
  };
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("alpha-scan-pages");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(new Error(String(req.error ?? "deleteDatabase failed")));
  });

  const saved = await changeDraft(0, [samplePage]);
  expect(saved).toEqual({ landed: true, revision: 1 });

  const cleared = await changeDraft(1, undefined);
  expect(cleared).toEqual({ landed: true, revision: 1 });

  const nextSave = await changeDraft(1, [samplePage]);
  expect(nextSave).toEqual({ landed: true, revision: 2 });

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opened = indexedDB.open("alpha-scan-pages", 1);
    opened.onsuccess = () => resolve(opened.result);
    opened.onerror = () => reject(new Error(String(opened.error ?? "open failed")));
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("scan", "readwrite");
    tx.objectStore("scan").put({ revision: "corrupt", pages: "bad" }, "current");
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error(String(tx.error ?? "put aborted")));
  });
  db.close();

  expect(await Effect.runPromise(readDraft())).toBe("damaged");
  await expect(changeDraft(0, undefined)).resolves.toEqual({ landed: true, revision: 0 });
  const afterDiscard = await Effect.runPromise(readDraft());
  expect(afterDiscard).not.toBe("damaged");
});
