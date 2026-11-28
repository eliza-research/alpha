// @vitest-environment happy-dom
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import { Machine as Home } from "../gen/app__home.effect.vibe";
import { Machine as Conversation } from "../gen/app__assistant.effect.vibe";
import { Machine as Composer } from "../gen/app__assistant__composer.effect.vibe";
import { Machine as Chats } from "../gen/app__assistant__chats.effect.vibe";
import { Machine as Search } from "../gen/app__assistant__search.effect.vibe";
import { Machine as Contacts } from "../gen/app__contacts.effect.vibe";
import { Machine as Agent } from "../gen/app__contacts__agent.effect.vibe";
import { Machine as Phone } from "../gen/app__phone.effect.vibe";
import * as Voice from "../gen/app__voice.effect.vibe";
import { type Asking, propose, withdrawn } from "../src/contacts/requests.vibe";
import { sheetOf } from "../src/contacts/contacts.vibe";
import { type Reading, answerReading } from "../src/contacts/reads.vibe";
import { Machine as Messages } from "../gen/app__messages.effect.vibe";
import { Machine as MessageComposer } from "../gen/app__messages__composer.effect.vibe";
import { at } from "../src/areas.ts";
import assistant from "../src/assistant/index.tsx";
import home from "../src/home/index.tsx";
import { untimed } from "../src/runtime/reactor.vibe";
import { placeOf } from "../src/voice/voice.vibe";
import { button, chatAction, closeAll, drawn, fill, filledPhoneKeypad, hardware, later, only, open as openAlpha, press, underAct, until } from "./alpha.tsx";
import { prepared } from "./fakes/notes.ts";
import { alphaImage as image, type Scene } from "./fakes/scene.ts";

underAct();
afterEach(closeAll);

const mounts = [
  ...only("home", "view:Contacts", "view:Phone", "view:Messages", "assistant", "phone/stage", "notice"),
  at("overlay", () => import("../src/phone/strip.tsx")),
  at("overlay", () => import("../src/contacts/requestCard.tsx")),
];

const open = async (world: Scene) => {
  const running = await openAlpha(world, mounts);
  await until(running.alpha, home.runtime(running.alpha), Home, (state) => state.tiles.load.status === "Loaded");
  return running;
};

async function mountedContacts(world: Scene) {
  const { alpha } = await open(world);
  await until(alpha, alpha.runtime, Shell, (state) => state.contacts);
  return alpha;
}

const launch = (name: "Contacts" | "Messages") => drawn(() => {
  const tile = document.querySelector<HTMLButtonElement>(`button[data-home-tile='view:${name}']`);
  if (!tile) throw new Error(`no ${name} tile on Home`);
  tile.click();
});

async function openContacts(world: Scene) {
  const running = await open(world);
  await until(running.alpha, running.alpha.runtime, Shell, (s) => s.contacts);
  await launch("Contacts");
  return running;
}

describe("Contacts on an Alpha image", () => {
  it("Retries a contact's New message in the same Ask stage and keeps an addressed draft", async () => {
    const world = image();
    const slot = "sms-draft:v2:new";
    world.secrets.set(slot, "unreadable draft");
    const alpha = await mountedContacts(world);
    const show = async (name: string) => {
      await launch("Contacts");
      await until(alpha, alpha.runtime, Contacts, (state) => state.front && state.list.status === "Loaded");
      await press(name);
      await until(alpha, alpha.runtime, Contacts, (state) => state.opened && state.card.status === "Loaded");
    };
    const to = () => document.querySelector<HTMLInputElement>('input[aria-label="To"]')?.value;
    const enabled = (name: string) => vi.waitFor(async () => {
      await drawn(() => undefined);
      expect(button(name)?.disabled).toBe(false);
    }, { timeout: 12_000, interval: 50 });
    /** Return to Contacts on the Ask Alpha stage, and wait until it reads Maya's card again. */
    const returnToCard = async () => {
      await enabled("Return to Contacts");
      await press("Return to Contacts");
      await until(alpha, alpha.runtime, Shell, (state) => state.trail.join(",") === "Contacts" && state.assistant === "Sheet");
      await until(alpha, alpha.runtime, Contacts, (state) => state.front && state.opened && state.contact === "7" && state.card.status === "Loaded");
    };

    // spec/app/messages/index.md, "New message reads the contacts that have a number and brings back the owner's unsent New draft"; spec/app/shell/index.md, "Opening another communications app from the stage keeps Ask Alpha open"
    await show("Maya Chen");
    await press("Open Alpha");
    await until(alpha, alpha.runtime, Shell, (state) => state.assistant === "Sheet");
    await press("Message +14155550100");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.join(",") === "Contacts,Messages" && state.assistant === "Sheet");
    await until(alpha, alpha.runtime, Messages, (state) => state.front && state.pane === "Threads");
    await enabled("Retry");
    expect(world.secrets.get(slot)).toBe("unreadable draft");
    world.secrets.delete(slot);
    await press("Retry");
    await until(alpha, alpha.runtime, Messages, (state) => state.pane === "New" && state.newDraft.recipient > 0);
    expect(to()).toBe("+14155550100");
    // spec/app/messages/index.md, "Story: Start a new message"
    await enabled("Back to texting Maya Chen");
    expect(document.querySelector('section[aria-label="Ask Alpha"] header')?.textContent).toContain("Maya Chen · Messages");
    const saved = world.secrets.get(slot);
    expect(saved).toBeDefined();

    // spec/app/phone/comms.md, "A view change while the conversation is open keeps the sheet's height and remembers the view it left"
    await enabled("Expand chat");
    await press("Expand chat");
    await until(alpha, alpha.runtime, Shell, (state) => state.assistant === "Full");
    expect(document.querySelector("[data-alpha-shell-page]")?.hasAttribute("inert")).toBe(true);
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Current view"]')?.textContent).toContain("Maya Chen · Messages"), { timeout: 12_000 });
    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.join(",") === "Contacts,Messages" && state.assistant === "Sheet");
    await enabled("Return to Contacts");
    expect(button("Return to Contacts")?.closest('section[aria-label="Ask Alpha"]')).toBeInstanceOf(HTMLElement);
    // spec/app/contacts/index.md, "Leaving Contacts forgets the rows and the open contact, and keeps a form the owner was filling in"
    await returnToCard();
    expect(button("Message +14155550100")).toBeDefined();

    // spec/app/phone/index.md, "A number handed to Phone opens the keypad with it filled in, and never dials"; spec/app/shell/index.md, "Opening another communications app from the stage keeps Ask Alpha open"
    await press("Call +14155550100");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.join(",") === "Contacts,Phone" && state.assistant === "Sheet");
    await filledPhoneKeypad(alpha, 12);
    expect(document.querySelector<HTMLInputElement>("[data-alpha-phone-number]")?.value).toBe("+14155550100");
    expect([world.telephony.placed, world.telephony.dialed]).toEqual([[], []]);

    // spec/app/contacts/index.md, "Returning to a contact on the Ask Alpha stage reads that exact card again"
    await returnToCard();
    expect(button("Call +14155550100")).toBeDefined();

    await hardware("home");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.length === 0);
    await show("Ben Ortiz");
    await press("Message +14155550122");
    await until(alpha, alpha.runtime, Messages, (state) => state.pane === "New" && state.newDraft.recipient > 0);
    expect(to()).toBe("+14155550100");
    expect(world.secrets.get(slot)).toBe(saved);
    expect(world.telephony.sent).toEqual([]);
  });

  it('Search chat over a contact and return to its dock (spec/app/assistant/search.md, "Search from a closed Contact remembers the card that opened it")', async () => {
    const world = image();
    world.ask.kept.set("c7", { roomId: "r7", title: "Lunch", messages: [{ id: "m1", role: "user", text: "Friday at noon" }] });
    const { alpha } = await open(world);
    const runtime = assistant.runtime(alpha);
    await until(alpha, runtime, Conversation, (state) => state.ready);

    const showContact = async () => {
      await launch("Contacts");
      await until(alpha, alpha.runtime, Contacts, (state) => state.list.status === "Loaded");
      await press("Maya Chen");
      await until(alpha, alpha.runtime, Contacts, (state) => state.card.status === "Loaded");
    };
    await showContact();

    const search = async () => {
      chatAction("Search chat");
      await until(alpha, runtime, Search, (state) => state.open && state.origin.tag === "ContactDock");
    };
    await search();
    await until(alpha, alpha.runtime, Shell, (state) => state.assistant === "Bar" && state.trail.at(-1) === "Contacts");
    await fill("Search chats", "friday");
    await until(alpha, runtime, Search, (state) => state.hits.status === "Loaded" && state.shown === 1);
    await hardware("back");
    await until(alpha, runtime, Search, (state) => !state.open);
    await until(alpha, alpha.runtime, Contacts, (state) => state.opened && state.contact === "7");
    await drawn(() => vi.waitFor(() => expect(document.activeElement).toBe(button("Chat actions"))));

    await search();
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Search chats"]')?.value).toBe("");
    await hardware("home");
    await until(alpha, runtime, Search, (state) => !state.open);
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.length === 0);
    await showContact();
    await search();
    await fill("Search chats", "friday");
    await until(alpha, runtime, Search, (state) => state.hits.status === "Loaded" && state.shown === 1);
    await press(/^Friday at noon/);
    await until(alpha, runtime, Chats, (state) => state.around > 0 && state.page.status === "Loaded");
    await until(alpha, alpha.runtime, Shell, (state) => state.assistant === "Full" && state.trail.at(-1) === "Contacts");
    expect(world.ask.said).toEqual([]);
  });

  it("Browse my contacts, look at one, change it and delete it (spec/app/contacts/index.md, \"Story: Browse my contacts\"; spec/app/contacts/index.md, \"Story: Give Alpha access to my contacts\"; spec/app/contacts/index.md, \"Story: Know what happened to my change\"; spec/app/contacts/index.md, \"Story: Look at one contact\"; spec/app/contacts/index.md, \"Story: Add or change a contact\"; spec/app/contacts/index.md, \"Story: Delete a contact\"; spec/app/phone/comms.md, \"Story: Address the person or Alpha from one bar\")", async () => {
    const world = image();
    world.telephony.contacts = false;
    // spec/app/contacts/index.md, "Contacts reads the list each time it comes to the front"
    const { alpha } = await openContacts(world);
    await until(alpha, alpha.runtime, Contacts, (s) => s.front && s.list.status === "Failed" && s.rows === 0);
    await press("Allow");
    await until(alpha, alpha.runtime, Contacts, (s) => s.list.status === "Loaded" && s.rows === 2);

    // spec/app/contacts/index.md, "Filtering or changing the filter chip starts a new list"
    expect(button("Search contacts")).toBeUndefined();
    await fill("Ask Alpha", "Maya");
    expect([Boolean(document.querySelector('[aria-label="Ben Ortiz"]')), Boolean(button("Ask Alpha")), button("Talk")]).toEqual([true, true, undefined]);
    await drawn(() => document.querySelector<HTMLInputElement>("input[aria-label='Ask Alpha']")?.form?.requestSubmit());
    await drawn(() => vi.waitFor(() => expect(world.ask.said).toEqual(["Maya"])));
    await drawn(() => alpha.back());
    await until(alpha, alpha.runtime, Shell, (s) => s.assistant === "Bar");
    await until(alpha, alpha.runtime, Contacts, (s) => s.list.status === "Loaded" && s.rows === 2);

    // spec/app/contacts/index.md, "Opening a contact reads it from the phone afresh"
    await press("Maya Chen");
    await until(alpha, alpha.runtime, Contacts, (s) => s.opened && s.card.status === "Loaded" && s.held.phones === 1);

    // spec/app/contacts/index.md, "Save writes a form that was changed and has a name, a number or an address"
    await press("Edit contact");
    await until(alpha, alpha.runtime, Contacts, (s) => s.form === "Changing");
    await fill("Last name", "Chen-Ortiz");
    expect(button("Save")?.disabled, "Save is available after editing a contact").toBe(false);
    await press("Save");
    await until(alpha, alpha.runtime, Contacts, (s) => s.write.outcome === "Confirmed" && s.form === "Shut");
    expect(world.telephony.people.find((one) => one.id === "7")).toMatchObject({ familyName: "Chen-Ortiz", revision: 2 });
    await until(alpha, alpha.runtime, Contacts, (s) => s.opened && (s.card.status === "Loaded" || s.card.status === "Failed"));
    const displayed = await alpha.runtime.runPromise(Effect.flatMap(Contacts, (machine) => machine.get()));
    expect(displayed.card, "The saved contact is readable").toMatchObject({ status: "Loaded" });
    const card = await alpha.runtime.runPromise(answerReading({ type: "contact_read_selected" }));
    expect(card).toMatchObject({ status: "read", contact: { displayName: "Maya Chen-Ortiz" } });

    // spec/app/contacts/index.md, "Confirming deletes the contact that was shown"
    const deletion = Promise.withResolvers<void>();
    world.telephony.holdContactDeletion = deletion.promise;
    await press("Delete contact");
    await until(alpha, alpha.runtime, Contacts, (s) => s.confirming);
    await press("Delete");
    await until(alpha, alpha.runtime, Contacts, (s) => s.write.outcome === "Sent" && s.change === "Remove");
    expect(world.telephony.people.map((one) => one.id)).toEqual(["7", "8"]);
    deletion.resolve();
    await later(alpha, 500);
    await until(alpha, alpha.runtime, Contacts, (s) => s.write.outcome === "Confirmed" && s.change === "Remove" && !s.opened);
    expect(world.telephony.people.map((one) => one.id)).toEqual(["8"]);

    // spec/app/contacts/index.md, "Call and Message open Phone or Messages with the number filled in, and do nothing else"; spec/app/phone/index.md, "A number handed to Phone opens the keypad with it filled in, and never dials"
    await until(alpha, alpha.runtime, Contacts, (s) => s.list.status === "Loaded" && s.rows === 1);
    await press("Ben Ortiz");
    await until(alpha, alpha.runtime, Contacts, (s) => s.card.status === "Loaded");
    await press("Call +14155550122");
    await until(alpha, alpha.runtime, Phone, (s) => s.tab === "Keypad" && s.digits === 12);
    expect([world.telephony.placed, world.telephony.dialed]).toEqual([[], []]);
  });

  it(`Open a New message from a contact and keep any draft already addressed (spec/app/contacts/index.md, "Call and Message open Phone or Messages with the number filled in, and do nothing else")`, async ({ onTestFinished }) => {
    vi.stubEnv("ELIZA_DEV_ALLOW_TEST_MOCKS", "1");
    onTestFinished(() => { vi.unstubAllEnvs(); });
    const world = image();
    const alpha = await mountedContacts(world);
    const to = () => document.querySelector<HTMLInputElement>('input[aria-label="To"]')?.value;
    const text = () => document.querySelector<HTMLTextAreaElement>('[data-alpha-messages-composer] textarea');

    await launch("Messages");
    await until(alpha, alpha.runtime, Messages, (state) => state.front && state.list.status === "Loaded");
    await press("New message");
    await vi.waitFor(() => expect(text()?.getAttribute("aria-label")).toBe("Message"), { timeout: 12_000 });
    await fill("Message", "Synthetic draft kept on this phone");
    await until(alpha, alpha.runtime, Messages, (state) => state.newDraft.revision > 0);
    await hardware("home");

    const composeFor = async (name: string, address: string, expected: string) => {
      await launch("Contacts");
      await until(alpha, alpha.runtime, Contacts, (state) => state.front && state.list.status === "Loaded");
      await press(name);
      await until(alpha, alpha.runtime, Contacts, (state) => state.card.status === "Loaded");
      await press(`Message ${address}`);
      await vi.waitFor(() => expect(to()).toBe(expected), { timeout: 12_000 });
    };

    await composeFor("Maya Chen", "+14155550100", "+14155550100");
    expect([to(), text()?.value]).toEqual(["+14155550100", "Synthetic draft kept on this phone"]);
    await hardware("home");
    await composeFor("Ben Ortiz", "+14155550122", "+14155550100");
    expect([to(), text()?.value, world.telephony.sent]).toEqual(["+14155550100", "Synthetic draft kept on this phone", []]);
  });

  it("Add or change a contact in the phone's own editor where Alpha may not write contacts (spec/app/contacts/index.md, \"Story: Add or change a contact\")", async () => {
    const world = image();
    world.telephony.editable = false;
    const { alpha } = await openContacts(world);
    await until(alpha, alpha.runtime, Contacts, (s) => s.list.status === "Loaded" && s.rows === 2 && !s.editable);

    // spec/app/contacts/index.md, "Where the phone does not let Alpha write contacts, New and Edit open the phone's own contact editor instead"
    await press("New contact");
    await press("Maya Chen");
    await until(alpha, alpha.runtime, Contacts, (s) => s.opened && s.card.status === "Loaded");
    await press("Edit contact");
    await until(alpha, alpha.runtime, Contacts, () => world.telephony.editors.length === 2);
    expect([world.telephony.editors, (await alpha.runtime.runPromise(Contacts.use((machine) => machine.get()))).form, world.telephony.people.map((one) => one.revision)]).toEqual([["new", "7"], "Shut", [1, 1]]);
  });

  it('Append the next page to my contacts (spec/app/contacts/index.md, "Story: Browse my contacts")', async () => {
    const world = image();
    const first = world.telephony.people[0];
    if (!first) throw new Error("the phone has no starting contact");
    world.telephony.people.push(
      ...Array.from({ length: 49 }, (_, index) => ({ ...first, id: String(index + 10), displayName: `Contact ${index + 1}` })),
      { ...first, id: "59", displayName: "7 Studio" },
      { ...first, id: "60", displayName: "Émile Amari" },
    );
    const { alpha } = await openContacts(world);
    await until(alpha, alpha.runtime, Contacts, (s) => s.list.status === "Loaded" && s.rows === 50 && s.more);
    await press("More contacts");
    await until(alpha, alpha.runtime, Contacts, (s) => s.list.status === "Loaded" && s.rows === 53 && !s.more);
    const accented = button("Émile Amari")?.parentElement;
    const last = accented?.parentElement?.lastElementChild;
    expect([accented?.querySelector("h2")?.textContent, last?.querySelector("h2")?.textContent, last?.querySelector("button")?.getAttribute("aria-label")])
      .toEqual(["E", "#", "7 Studio"]);
    await press("Émile Amari");
    await until(alpha, alpha.runtime, Contacts, (s) => s.opened && s.card.status === "Loaded" && s.contact === "60");
  });

  it("Approve what the agent asked: a text, a change, a new contact (spec/app/contacts/agent.md, \"Story: Let the agent ask for a call or a contact change\"; spec/app/contacts/agent.md, \"Story: Approve what the agent asked\"; spec/app/contacts/agent.md, \"Story: Learn how the request ended\")", async () => {
    const world = image();
    const { alpha } = await open(world);
    await until(alpha, alpha.runtime, Phone, (s) => s.telecom === "NoCall");
    const ask = (operation: Asking, written = false) => alpha.runtime.runPromise(propose(operation, written));

    // spec/app/contacts/agent.md, "A call or a text to a number reaches only a number the owner wrote"
    await ask({ type: "sms_send", recipients: ["+14155550199"], body: "Hi", subscriptionId: 1 });
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Ended" && s.ending === "NotWritten");

    // spec/app/contacts/agent.md, "The agent never calls an emergency number, and is told why"
    await ask({ type: "phone_call", target: { kind: "number", number: "911" } }, true);
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Ended" && s.ending === "EmergencyRefused");
    expect(world.telephony.dialed).toEqual([]);

    // spec/app/contacts/agent.md, "Only the phone answers the newest search, and the request goes on by what it found": a text to a contact lets the owner pick the number, even the only one.
    await ask({ type: "sms_compose", query: "Maya", body: "Running late" });
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Choosing" && s.matches === 1);
    expect(world.telephony.sent).toEqual([]);

    // spec/app/contacts/agent.md, "The owner picks the exact number or the one contact, and that one is shown"
    await drawn(() => {
      const found = [...document.querySelectorAll("[role=dialog] button")].find((one) => one.querySelector("span > span")?.textContent === "Maya Chen");
      if (!(found instanceof HTMLButtonElement)) throw new Error("no button Maya Chen");
      found.click();
    });
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Shown" && s.number === "+14155550100" && !s.addressed);

    // spec/app/contacts/agent.md, "Only the owner approves, only what is shown as it is now, and only when the phone has ruled out an emergency call"
    await press("Send this text");
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Ended" && s.ending === "Done");
    expect(world.telephony.sent.map(({ recipients, body }) => ({ recipients, body }))).toEqual([{ recipients: ["+14155550100"], body: "Running late" }]);

    // spec/app/contacts/agent.md, "The owner can decline, and a review Alpha stops showing is withdrawn"
    await ask({ type: "phone_call", target: { kind: "contact", query: "Ben" } });
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Choosing");
    await press("Not now");
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Ended" && s.ending === "Declined");
    await ask({ type: "phone_call", target: { kind: "contact", query: "Ben" } });
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Choosing");
    expect(await alpha.runtime.runPromise(withdrawn())).toBe(true);
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Ended" && s.ending === "Withdrawn");
    expect(document.querySelector("[role=dialog]")).toBeNull();

    // spec/app/contacts/agent.md, "A text's review says when it likely goes as several linked texts"
    const said = () => [...document.querySelectorAll("[role=dialog] p")].map((one) => one.textContent);
    await ask({ type: "sms_send", recipients: ["+14155550199"], body: "a".repeat(160), subscriptionId: 1 }, true);
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Shown" && s.ask === "Text");
    const card = document.querySelector<HTMLElement>("[role=dialog]");
    const shown = await alpha.runtime.runPromise(Agent.use((machine) => machine.get()));
    expect([card?.dataset.alphaReview, card?.dataset.alphaReviewVersion]).toEqual([String(shown.request), String(shown.review.shown)]);
    expect(said().some((line) => line?.includes("linked texts"))).toBe(false);
    await press("Not now");
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Ended" && s.ending === "Declined");
    await ask({ type: "sms_send", recipients: ["+14155550199"], body: `${"a".repeat(158)}{}`, subscriptionId: 1 }, true);
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Shown" && s.ask === "Text");
    expect(said()).toContain("It likely goes as 2 linked texts");
    await press("Not now");
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Ended" && s.ending === "Declined");
    await ask({ type: "sms_send", recipients: ["+14155550199"], body: `${"a".repeat(140)}😀`, subscriptionId: 1 }, true);
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Shown" && s.ask === "Text");
    expect(said()).toContain("It likely goes as 3 linked texts");
    await press("Not now");
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Ended" && s.ending === "Declined");
    expect(world.telephony.sent).toHaveLength(1);

    // spec/app/contacts/agent.md, "A change that would leave the contact as it is is never offered"
    await ask({ type: "contact_update", query: "Ben", add: { phoneNumbers: ["+14155550122"] } });
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Ended" && s.ending === "Unchanged");

    // spec/app/contacts/agent.md, "A change is shown line by line, and a removed value never reads as kept"
    await ask({ type: "contact_update", query: "Ben", add: { phoneNumbers: ["+14155550123"] } });
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Shown" && s.contact === "8");
    await press("Save changes to Ben Ortiz");
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Ended" && s.ending === "Done");
    expect(world.telephony.people.find((one) => one.id === "8")).toMatchObject({ displayName: "Ben Ortiz", givenName: "Ben", phoneNumbers: [{ number: "+14155550122", type: "mobile" }, { number: "+14155550123", type: "mobile" }] });

    // spec/app/contacts/agent.md, "Only the phone answers the newest search, and the request goes on by what it found": a new contact whose name is already in Contacts is shown with that contact.
    await ask({ type: "contact_create", contact: { displayName: "Maya Chen", phoneNumbers: ["+14155550177"], emailAddresses: [] } });
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Shown" && s.ask === "AddContact" && s.twins === 1);
    await press("Add anyway: Maya Chen is already in Contacts");
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Ended" && s.ending === "Done");
    expect(world.telephony.people.filter((one) => one.displayName === "Maya Chen").length).toBe(2);

    // spec/app/contacts/agent.md, "Nothing is done but what the owner approved, as it was shown, once": a changed native version invalidates the identified review.
    await ask({ type: "contact_delete", query: "Ben" });
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Shown" && s.contact === "8");
    const ben = world.telephony.people.find((one) => one.id === "8");
    if (!ben) throw new Error("the phone has no reviewed contact");
    ben.revision += 1;
    await press("Delete Ben Ortiz");
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Ended" && s.ending === "NotDone");
    expect(world.telephony.people).toContain(ben);

    // spec/app/contacts/agent.md, "Only the phone answers the action, and the request ends as that answer says"
    await ask({ type: "contact_delete", query: "Ben" });
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Shown" && s.contact === "8");
    await press("Delete Ben Ortiz");
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Ended" && s.ending === "Done");
    expect(world.telephony.people).not.toContain(ben);
  });

  it("Let the agent read what I have open, and draft a reply that never sends (spec/app/contacts/agent.md, \"Story: Let the agent read what I have open\"; spec/app/messages/composer.md, \"Story: Let Alpha suggest a draft\")", async () => {
    const world = image();
    const { alpha } = await open(world);
    await until(alpha, alpha.runtime, Shell, (s) => s.image);
    const read = async (operation: Reading) => {
      let result: unknown;
      await drawn(async () => { result = await alpha.runtime.runPromise(answerReading(operation)); });
      return result;
    };

    // spec/app/contacts/agent.md, "The agent reads only the conversation, voicemail or contact open on screen, as the phone last read it"
    expect([await read({ type: "messages_read_selected" }), await read({ type: "voicemail_read_selected" }), await read({ type: "contact_read_selected" }), await read({ type: "sms_reply_selected", body: "On my way" })]).toEqual([
      { kind: "messages-read", status: "none-selected" }, { kind: "voicemail-read", status: "none-selected" }, { kind: "contact-read", status: "none-selected" }, { kind: "sms-reply", status: "none-selected" },
    ]);

    // spec/app/contacts/agent.md, "The latest text's sender is named by its number alone, and the whole number only where the agent asked for it"
    expect([await read({ type: "sms_latest_sender" }), await read({ type: "sms_latest_sender", includeAddress: true })]).toEqual([
      { kind: "sms-latest-sender", status: "found", numberEnding: "0100" }, { kind: "sms-latest-sender", status: "found", address: "+14155550100", threadId: "thread:1" },
    ]);

    await launch("Messages");
    await until(alpha, alpha.runtime, Messages, (s) => s.list.status === "Loaded" && s.threads === 1);
    await press("Maya Chen");
    await until(alpha, alpha.runtime, Messages, (s) => s.pane === "Conversation" && s.page.status === "Loaded");
    await until(alpha, alpha.runtime, MessageComposer, (s) => s.thread > 0);
    expect(await read({ type: "messages_read_selected" })).toEqual({ kind: "messages-read", status: "read", participant: "Maya Chen", messages: [{ direction: "in", date: 1_700_000_050_000, body: "See you at five" }], truncated: false });

    // spec/app/messages/composer.md, "The agent's draft goes into the open conversation's draft only while it is empty, and never sends"
    expect(await read({ type: "sms_reply_selected", body: "On my way" })).toEqual({ kind: "sms-reply", status: "drafted" });
    await until(alpha, alpha.runtime, MessageComposer, (s) => s.slot.author === "AlphaWrote");
    expect([await read({ type: "sms_reply_selected", body: "Running late" }), (document.querySelector("textarea[aria-label='Text Maya']") as HTMLTextAreaElement).value, world.telephony.sent]).toEqual([
      { kind: "sms-reply", status: "occupied" }, "On my way", [],
    ]);

    // spec/app/phone/index.md, "A number handed to Phone opens the keypad with it filled in, and never dials"
    expect(await read({ type: "phone_keypad", number: "+14155550122" })).toEqual({ kind: "phone-keypad", status: "opened" });
    await filledPhoneKeypad(alpha, 12);
    expect([world.telephony.placed, world.telephony.dialed]).toEqual([[], []]);

    // spec/app/contacts/index.md, "Filtering or changing the filter chip starts a new list"
    expect(await read({ type: "contact_show", query: "Ben" })).toEqual({ kind: "contact-show", status: "shown" });
    await until(alpha, alpha.runtime, Contacts, (s) => s.front && s.sought && s.list.status === "Loaded" && s.rows === 1);
    await drawn(() => vi.waitFor(() => expect(button("Ben Ortiz")).toBeDefined()));
    await press("Ben Ortiz");
    await until(alpha, alpha.runtime, Contacts, (s) => s.opened && s.card.status === "Loaded");
    expect(await read({ type: "contact_read_selected" })).toEqual({ kind: "contact-read", status: "read", contact: { displayName: "Ben Ortiz", phoneNumbers: ["+14155550122"], emailAddresses: [] } });
  });

  it('Clamps >32 phone numbers in sheetOf and renders agent reviews inside a dialog (spec/app/contacts/index.md, "Opening a contact reads it from the phone afresh"; spec/app/contacts/agent.md, "Nothing is done but what the owner approved, as it was shown, once")', async () => {
    const oversized = sheetOf({
      givenName: "Maya",
      familyName: "Chen",
      phones: Array.from({ length: 35 }, (_, index) => `+14155550${String(index).padStart(3, "0")}`),
      emails: [],
      notes: "",
    });
    expect(oversized.phones).toBe(32);

    const world = image();
    const { alpha } = await open(world);
    await until(alpha, alpha.runtime, Shell, (s) => s.contacts);
    await until(alpha, alpha.runtime, Phone, (s) => s.telecom === "NoCall");

    await alpha.runtime.runPromise(propose({ type: "contact_delete", query: "Ben" }, true));
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Shown" && s.contact === "8");
    const reviewDialog = document.querySelector("[role=dialog][data-alpha-review]");
    expect(reviewDialog).not.toBeNull();
    expect(reviewDialog?.textContent).toContain("Ben Ortiz");
  });

  it(`Does not disclose full latest-sender address unless includeAddress is strictly true (spec/app/contacts/agent.md, "The latest text's sender is named by its number alone, and the whole number only where the agent asked for it")`, async () => {
    const world = image();
    const { alpha } = await open(world);
    await until(alpha, alpha.runtime, Shell, (s) => s.image && s.contacts);
    const masked = { type: "sms_latest_sender", includeAddress: undefined } as unknown as Reading;
    expect(await alpha.runtime.runPromise(answerReading(masked))).toEqual({ kind: "sms-latest-sender", status: "found", numberEnding: "0100" });
  });

  it('Offers review when a contact update replaces a distinct number with a duplicate (spec/app/contacts/agent.md, "A change that would leave the contact as it is is never offered")', async () => {
    const world = image();
    const maya = world.telephony.people.find((one) => one.id === "7");
    if (!maya) throw new Error("missing Maya fixture");
    maya.phoneNumbers = [{ number: "+14155550100", type: "mobile" }, { number: "+14155550199", type: "work" }];
    const { alpha } = await open(world);
    await until(alpha, alpha.runtime, Shell, (s) => s.image && s.contacts);
    expect(await alpha.runtime.runPromise(propose({
      type: "contact_update", query: "Maya", set: { phoneNumbers: ["+14155550100", "+14155550100"] },
    }, false))).toBe(true);
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Shown" || s.stage === "Ended");
    const agent = await alpha.runtime.runPromise(Effect.flatMap(Agent, (machine) => machine.get()));
    expect([agent.stage, agent.ending]).toEqual(["Shown", "Done"]);
  });

  it('Does not carry a refused edit banner onto a fresh New contact form (spec/app/contacts/index.md, "A new contact starts from a blank form, and a change from the contact as the phone holds it now")', async () => {
    const world = image();
    const maya = world.telephony.people.find((one) => one.id === "7");
    if (!maya) throw new Error("missing Maya fixture");
    const { alpha } = await open(world);
    await until(alpha, alpha.runtime, Shell, (s) => s.image && s.contacts);
    await launch("Contacts");
    await until(alpha, alpha.runtime, Contacts, (s) => s.front && s.list.status === "Loaded" && s.rows === 2);
    await press("Maya Chen");
    await until(alpha, alpha.runtime, Contacts, (s) => s.opened && s.card.status === "Loaded");
    await press("Edit contact");
    await until(alpha, alpha.runtime, Contacts, (s) => s.form === "Changing");
    await fill("First name", "Maya Updated");
    maya.revision += 1;
    await press("Save");
    await until(alpha, alpha.runtime, Contacts, (s) => s.write.outcome === "Refused");
    expect(document.body.textContent).toContain("This contact changed.");
    await press("Cancel");
    await until(alpha, alpha.runtime, Contacts, (s) => s.form === "Shut");
    await press("Back to contacts");
    await until(alpha, alpha.runtime, Contacts, (s) => !s.opened);
    await press("New contact");
    await until(alpha, alpha.runtime, Contacts, (s) => s.form === "Adding");
    expect(document.body.textContent).not.toContain("The phone did not save the contact");
  });
});

// spec/app/voice/index.md, "Story: Go where the conversation takes me"; spec/app/voice/index.md, "Voice keeps talking after a navigation only when it is the one the conversation asked for; any other ends it"
describe("Talk on an Alpha image", () => {
  it("Talk keeps listening as the agent opens the keypad, Contacts and Messages, and stops when the owner opens one himself", async () => {
    const world = { ...image(), signedIn: false };
    const { alpha } = await open(world);
    await until(alpha, alpha.runtime, Shell, (s) => s.image);
    const area = assistant.runtime(alpha);
    await until(alpha, area, Conversation, (s) => s.ready);
    await until(alpha, area, Composer, (s) => s.slot === "Open" && s.binding.owner > 0);
    await until(alpha, area, Voice.Machine, (s) => s.warmed);

    const voice = (event: Voice.Event) => area.runPromise(Effect.flatMap(Voice.Machine, (machine) => machine.send(event)));
    await voice({ type: "permissionChanged", grant: "Granted" });
    await voice({ type: "startTalking", now: untimed });
    await until(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On");

    for (const [turn, view] of [[1, "Phone"], [2, "Contacts"], [3, "Messages"]] as const) {
      world.ask.nextReplyChunks = [`Opening ${view}.`];
      world.ask.nextActions = (metadata) => [prepared(String((metadata as { viewClientId?: unknown }).viewClientId), view.toLowerCase(), false)];
      world.voice.emitLocal?.("liveCaptureTranscript", {
        captureId: world.voice.activeMicSession,
        final: { turnId: `comms-nav-${turn}`, text: `Open ${view}`, mode: "device" },
      });
      await until(alpha, area, Voice.Machine, (s) => s.sent === turn && s.phase === "Listening" && s.mic === "On" && s.followed === placeOf(view) && s.claim === 0);
      const state = await alpha.runtime.runPromise(Effect.flatMap(Shell, (machine) => machine.get()));
      expect(state.trail.at(-1)).toBe(view);
      if (view === "Phone") await until(alpha, alpha.runtime, Phone, (s) => s.front);
      if (view === "Contacts") await until(alpha, alpha.runtime, Contacts, (s) => s.front);
      if (view === "Messages") await until(alpha, alpha.runtime, Messages, (s) => s.front);
    }

    await drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell, (machine) => machine.send({ type: "openView", view: "Phone" }))));
    await until(alpha, area, Voice.Machine, (s) => s.phase === "Idle" && s.mic === "Off" && !s.engineHeld);
  });
});
