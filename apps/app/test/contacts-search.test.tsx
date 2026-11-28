// @vitest-environment happy-dom
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Machine as Contacts } from "../gen/app__contacts.effect.vibe";
import { Machine as Home } from "../gen/app__home.effect.vibe";
import { Machine as Phone } from "../gen/app__phone.effect.vibe";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import home from "../src/home/index.tsx";
import type { Alpha } from "../src/runtime/area.tsx";
import { button, closeAll, drawn, hardware, input, only, open, press, underAct, until } from "./alpha.tsx";
import { alphaImage } from "./fakes/scene.ts";

underAct();
afterEach(closeAll);

const searchField = () => input("Search contacts");
const mounts = only("home", "assistant", "notice", "phone/stage", "view:Phone", "view:Contacts", "view:Messages");

/** Alpha as the phone's launcher, with Home loaded. */
async function launcher() {
  const world = alphaImage();
  world.settings.roles = world.settings.roles.map((role) => role.role === "home" ? { ...role, held: true } : role);
  const { alpha } = await open(world, mounts);
  await until(alpha, alpha.runtime, Shell, (state) => state.image && state.contacts);
  await until(alpha, home.runtime(alpha), Home, (state) => state.tiles.load.status === "Loaded");
  return alpha;
}

const tile = (view: "Contacts" | "Phone") => drawn(() => {
  const found = document.querySelector<HTMLButtonElement>(`[data-home-tile='view:${view}']`);
  if (!found) throw new Error(`No ${view} home tile`);
  found.click();
});

const trail = async (alpha: Alpha) => (await alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.get()))).trail.join(",");

describe('Contacts header without owner search (spec/app/contacts/index.md, "Filtering or changing the filter chip starts a new list")', () => {
  it(`On the launcher Contacts draws no Back or Search button, and Android's Back leaves Contacts (spec/app/contacts/index.md, "Filtering or changing the filter chip starts a new list")`, async () => {
    const alpha = await launcher();
    await tile("Contacts");
    await until(alpha, alpha.runtime, Contacts, (state) => state.front && state.list.status === "Loaded");
    await vi.waitFor(() => expect(document.querySelector("main")?.hasAttribute("data-alpha-launcher")).toBe(true));
    expect([button("Back to apps"), button("Search contacts"), searchField(), Boolean(button("New contact"))]).toEqual([undefined, undefined, null, true]);

    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.length === 0);
  });

  it(`On the launcher Phone's Contacts tab keeps tabs and New contact in one header row with no Search button (spec/app/contacts/index.md, "Filtering or changing the filter chip starts a new list")`, async () => {
    const alpha = await launcher();
    await tile("Phone");
    await until(alpha, alpha.runtime, Phone, (state) => state.front);
    await drawn(() => {
      const found = document.querySelector<HTMLElement>("[data-alpha-phone-tab='contacts']");
      if (!found) throw new Error("No Phone Contacts tab");
      found.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      found.click();
    });
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.join(",") === "Phone,Contacts");
    await until(alpha, alpha.runtime, Contacts, (state) => state.front && state.list.status === "Loaded");

    const header = document.querySelector("[data-alpha-phone-header]");
    expect([
      Boolean(header?.querySelector('[role="tablist"][aria-label="Phone"]')),
      Boolean(header?.querySelector('button[aria-label="New contact"]')),
      button("Search contacts"),
      searchField(),
      header?.querySelector("h1")?.classList.contains("sr-only"),
    ]).toEqual([true, true, undefined, null, true]);

    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.join(",") === "Phone");
    expect(await trail(alpha)).toBe("Phone");
  });

  it(`Off the launcher Contacts draws Back to apps and New contact without a Search button (spec/app/contacts/index.md, "Filtering or changing the filter chip starts a new list")`, async () => {
    const { alpha } = await open(alphaImage(), mounts);
    await until(alpha, alpha.runtime, Shell, (state) => state.image && state.contacts);
    await drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "openView", view: "Contacts" }))));
    await until(alpha, alpha.runtime, Contacts, (state) => state.front && state.list.status === "Loaded");
    expect(document.querySelector("main")?.hasAttribute("data-alpha-launcher")).toBe(false);
    await vi.waitFor(() => expect(button("Back to apps")).toBeDefined());
    expect([button("Back"), button("Search contacts"), searchField(), Boolean(button("New contact"))]).toEqual([undefined, undefined, null, true]);

    await press("Back to apps");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.length === 0);
  });
});
