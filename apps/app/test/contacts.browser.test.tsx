import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { Machine as Agent } from "../gen/app__contacts__agent.effect.vibe";
import { Machine as Contacts } from "../gen/app__contacts.effect.vibe";
import { Machine as Phone } from "../gen/app__phone.effect.vibe";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import { propose } from "../src/contacts/requests.vibe";
import { closeAll, later, only, open, until } from "./alpha.tsx";
import { alphaImage, scene } from "./fakes/scene.ts";
import "../src/main.css";

afterEach(async () => {
  await closeAll();
  document.documentElement.style.removeProperty("--alpha-native-inset-top");
});

// spec/app/contacts/agent.md, "Only the owner approves, only what is shown as it is now, and only when the phone has ruled out an emergency call"
it("Approve a shown text by touch (spec/app/contacts/agent.md, \"Story: Approve what the agent asked\")", async () => {
  const world = { ...scene(), phone: true, image: true };
  const { alpha } = await open(world);
  await until(alpha, alpha.runtime, Phone, (s) => s.telecom === "NoCall");
  await alpha.runtime.runPromise(propose({ type: "sms_send", recipients: ["+14155550199"], body: "Running late", subscriptionId: 1 }, true));
  await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Shown" && s.addressed);
  const send = page.getByRole("button", { name: "Send this text" });
  await expect.element(send).toBeVisible();
  expect(world.telephony.sent).toEqual([]);
  // spec/app/contacts/agent.md, "Only the owner approves, only what is shown as it is now, and only when the phone has ruled out an emergency call": the startup cover lifts at the latest 2.5 s after start; a tap reaches Send only once it has.
  const cover = () => document.querySelector('[role="status"][aria-label="Loading Alpha"]');
  for (let waited = 0; waited < 2500 && cover(); waited += 500) await later(alpha, 500);
  expect(cover()).toBeNull();

  await send.click();
  await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Ended" && s.ending === "Done");
  expect(world.telephony.sent.map(({ recipients, body }) => ({ recipients, body }))).toEqual([{ recipients: ["+14155550199"], body: "Running late" }]);
});

it('Phone single-row header without Contacts search (spec/app/contacts/index.md, "Filtering or changing the filter chip starts a new list")', async () => {
  const world = alphaImage();
  world.settings.roles = world.settings.roles.map((role) => role.role === "home" ? { ...role, held: true } : role);
  await page.viewport(412, 915);
  const { alpha } = await open(world, only("view:Phone", "view:Contacts", "phone/stage", "notice"));
  await until(alpha, alpha.runtime, Shell, (s) => s.image && s.contacts);
  await alpha.runtime.runPromise(Shell.use((shell) => shell.send({ type: "openView", view: "Phone" })));
  await until(alpha, alpha.runtime, Phone, (s) => s.front && s.voicemail && s.recents.status === "Loaded");
  document.documentElement.style.setProperty("--alpha-native-inset-top", "58px");
  const cover = () => document.querySelector('[role="status"][aria-label="Loading Alpha"]');
  for (let waited = 0; waited < 2500 && cover(); waited += 500) await later(alpha, 500);

  const measure = () => {
    const header = document.querySelector<HTMLElement>("[data-alpha-phone-header]");
    const tablist = header?.querySelector<HTMLElement>('[role="tablist"][aria-label="Phone"]');
    const plus = header?.querySelector<HTMLElement>('button[aria-label="New contact"]');
    const back = header?.querySelector<HTMLElement>('button[aria-label^="Back"]');
    if (!header || !tablist) throw new Error("Missing Phone header or tablist");
    const hr = header.getBoundingClientRect();
    const tr = tablist.getBoundingClientRect();
    const pr = plus?.getBoundingClientRect();
    const br = back?.getBoundingClientRect();
    return {
      top: Math.round(hr.top),
      centerDelta: Math.abs((tr.left + tr.width / 2) - (hr.left + hr.width / 2)),
      singleRow: tr.top >= hr.top && tr.bottom <= hr.bottom + 1,
      plusAligned: pr ? Math.abs((pr.top + pr.height / 2) - (tr.top + tr.height / 2)) <= 2 && tr.right <= pr.left && pr.right <= hr.right : true,
      backAligned: br ? br.right <= tr.left : true,
      hasPlus: Boolean(pr),
    };
  };

  const recents = measure();
  expect([recents.top >= 58, recents.centerDelta <= 1, recents.singleRow]).toEqual([true, true, true]);

  await page.getByRole("tab", { name: "Keypad" }).click();
  await until(alpha, alpha.runtime, Phone, (s) => s.tab === "Keypad");
  const keypad = measure();
  expect([keypad.top >= 58, keypad.centerDelta <= 1, keypad.singleRow]).toEqual([true, true, true]);

  await page.getByRole("tab", { name: "Contacts" }).click();
  await until(alpha, alpha.runtime, Contacts, (s) => s.front && s.list.status === "Loaded");
  await expect.element(page.getByRole("button", { name: "New contact" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Search contacts" })).not.toBeInTheDocument();
  const contacts412 = measure();
  expect([contacts412.top >= 58, contacts412.centerDelta <= 1, contacts412.singleRow, contacts412.hasPlus, contacts412.plusAligned]).toEqual([true, true, true, true, true]);

  await page.viewport(360, 800);
  const contacts360 = measure();
  expect([contacts360.centerDelta <= 1, contacts360.singleRow, contacts360.hasPlus, contacts360.plusAligned, contacts360.backAligned]).toEqual([true, true, true, true, true]);

  await page.getByRole("button", { name: "New contact" }).click();
  await until(alpha, alpha.runtime, Contacts, (s) => s.form === "Adding");
});
