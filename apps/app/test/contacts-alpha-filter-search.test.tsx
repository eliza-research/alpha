// @vitest-environment happy-dom
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Machine as Contacts } from "../gen/app__contacts.effect.vibe";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import { answerReading } from "../src/contacts/reads.vibe";
import { button, closeAll, drawn, fill, hardware, only, open, press, underAct, until } from "./alpha.tsx";
import { alphaImage } from "./fakes/scene.ts";

underAct();
afterEach(closeAll);

const listed = () => [...document.querySelectorAll<HTMLButtonElement>("[aria-label='Contacts'] button[aria-label]")].map((row) => row.getAttribute("aria-label")).filter((name) => name === "Maya Chen" || name === "Ben Ortiz");

async function contacts() {
  const { alpha } = await open(alphaImage(), only("home", "assistant", "notice", "phone/stage", "view:Contacts", "view:Phone", "view:Messages"));
  await until(alpha, alpha.runtime, Shell, (state) => state.image && state.contacts);
  await drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "openView", view: "Contacts" }))));
  await until(alpha, alpha.runtime, Contacts, (state) => state.front && state.list.status === "Loaded" && state.rows === 2);
  return alpha;
}

describe('Alpha filter and non-filtering bar in Contacts (spec/app/contacts/index.md, "Filtering or changing the filter chip starts a new list")', () => {
  it("clears Alpha's filter chip back to All contacts via the chip or Back, with no Search contacts button", async () => {
    const alpha = await contacts();
    expect(await alpha.runtime.runPromise(answerReading({ type: "contact_show", query: "Ben" }))).toEqual({ kind: "contact-show", status: "shown" });
    await until(alpha, alpha.runtime, Contacts, (state) => state.sought && state.list.status === "Loaded" && state.rows === 1);
    await vi.waitFor(() => expect(button("Clear filter Ben")).toBeDefined());
    expect(button("Search contacts")).toBeUndefined();

    await press("Clear filter Ben");
    await until(alpha, alpha.runtime, Contacts, (state) => !state.sought && state.list.status === "Loaded" && state.rows === 2);
    await vi.waitFor(() => expect(listed().toSorted()).toEqual(["Ben Ortiz", "Maya Chen"]));
    expect(button("Clear filter Ben")).toBeUndefined();

    expect(await alpha.runtime.runPromise(answerReading({ type: "contact_show", query: "Maya" }))).toEqual({ kind: "contact-show", status: "shown" });
    await until(alpha, alpha.runtime, Contacts, (state) => state.sought && state.list.status === "Loaded" && state.rows === 1);
    await hardware("back");
    await until(alpha, alpha.runtime, Contacts, (state) => state.front && !state.sought && state.list.status === "Loaded" && state.rows === 2);
  });

  it("typing in the Ask Alpha bar on Contacts does not filter the contact list", async () => {
    const alpha = await contacts();
    await fill("Ask Alpha", "Maya");
    expect([
      (await alpha.runtime.runPromise(Effect.flatMap(Contacts, (machine) => machine.get()))).sought,
      listed().toSorted(),
      button("Search contacts"),
    ]).toEqual([false, ["Ben Ortiz", "Maya Chen"], undefined]);
  });
});
