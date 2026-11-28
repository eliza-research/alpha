// @vitest-environment happy-dom
import { Effect } from "effect";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Machine as Conversation } from "../gen/app__assistant.effect.vibe";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import { Machine as Toasts } from "../gen/app__notices__toasts.effect.vibe";
import { Machine as Home } from "../gen/app__home.effect.vibe";
import { Machine as Phone, type Phone as PhoneState } from "../gen/app__phone.effect.vibe";
import { Machine as Strip } from "../gen/app__phone__call.effect.vibe";
import { Machine as Comms } from "../gen/app__phone__comms.effect.vibe";
import { Machine as Voicemail } from "../gen/app__phone__voicemail.effect.vibe";
import { Machine as Contacts } from "../gen/app__contacts.effect.vibe";
import { Machine as Agent } from "../gen/app__contacts__agent.effect.vibe";
import { at } from "../src/areas.ts";
import { propose } from "../src/contacts/requests.vibe";
import assistant from "../src/assistant/index.tsx";
import home from "../src/home/index.tsx";
import { phoneAction } from "../src/phone/agent.vibe";
import { phoneContactChoices, pickPhoneContact } from "../src/phone/named-review.vibe";
import type { Alpha } from "../src/runtime/area.tsx";
import { button, closeAll, drawn, fill, filledPhoneKeypad, hardware, only, open, press, underAct, until } from "./alpha.tsx";
import { alphaImage, scene } from "./fakes/scene.ts";
import { textReview } from "./fakes/text-review.ts";

underAct();
afterEach(closeAll);

/** An Alpha image at a fixed time. */
const image = () => ({ ...alphaImage(), now: 1_700_000_400_000 });
const mounts = [
  ...only("home", "assistant", "notice", "phone/stage", "view:Phone", "view:Contacts", "view:Messages"),
  at("overlay", () => import("../src/phone/strip.tsx")),
  at("overlay", () => import("../src/contacts/requestCard.tsx")),
];
const openPhoneWorld = (world = image()) => open(world, mounts);
async function mountedImage(world: ReturnType<typeof image>) {
  const { alpha } = await openPhoneWorld(world);
  await until(alpha, alpha.runtime, Shell, (state) => state.image);
  return alpha;
}

const phoneTile = () => document.querySelector<HTMLButtonElement>("[data-home-tile='view:Phone']");

async function openPhone(alpha: Alpha) {
  await until(alpha, home.runtime(alpha), Home, (state) => state.tiles.load.status === "Loaded");
  await drawn(() => {
    const tile = phoneTile();
    if (!tile) throw new Error("no Phone tile on Home");
    tile.click();
  });
  await until(alpha, alpha.runtime, Phone, (state) => state.front);
}

async function bootPhone(world = image()) {
  const { alpha } = await openPhoneWorld(world);
  await until(alpha, alpha.runtime, Shell, (s) => s.image);
  return { world, alpha };
}

async function enterPhone(world = image()) {
  const started = await bootPhone(world);
  await openPhone(started.alpha);
  return started;
}

async function enterKeypad(world = image()) {
  const started = await enterPhone(world);
  await tab("Keypad");
  return started;
}

async function enterVoicemail(world = image(), requireUnheard = false) {
  const started = await enterPhone(world);
  await until(started.alpha, started.alpha.runtime, Phone, (s) => s.front && s.voicemail);
  await tab("Voicemail");
  await until(started.alpha, started.alpha.runtime, Voicemail, (s) => s.list.status === "Loaded" && s.items === 1 && (!requireUnheard || s.unheard === 1));
  return started;
}

async function openReadyRecents(alpha: Alpha, matches: (state: PhoneState) => boolean = () => true) {
  await openPhone(alpha);
  await until(alpha, alpha.runtime, Phone, (state) => state.carrier === "CarrierReady" && state.recents.status === "Loaded" && matches(state));
}

const pressPhoneCard = () => drawn(() => {
  const cards = document.querySelectorAll<HTMLButtonElement>("[aria-label='Your day'] button");
  const card = [...cards].find((item) => item.getAttribute("aria-label")?.startsWith("Open Phone"));
  if (!card) throw new Error("no call card on Home");
  card.click();
});

const pressVoicemailRow = (expanded = false) => drawn(() => {
  const row = document.querySelector<HTMLButtonElement>(`button[aria-expanded='${expanded}'][aria-label^='Voicemail from']`);
  if (!row) throw new Error(`no ${expanded ? "open" : "closed"} voicemail row`);
  row.click();
});

/** Press a tab, as a finger does: Radix's tabs choose on the press, before the click. */
const tab = (name: string) => drawn(() => {
  const found = [...document.querySelectorAll("[role=tab]")].find((one) => one.textContent === name);
  if (!found) throw new Error(`no tab ${name}`);
  found.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
});

async function openVoicemail(alpha: Alpha, matches: (state: PhoneState) => boolean = () => true) {
  await openPhone(alpha);
  await until(alpha, alpha.runtime, Phone, (state) => state.voicemail && matches(state));
  await tab("Voicemail");
}

async function openReviewedVoicemail(
  world: ReturnType<typeof image>,
  review: ReturnType<typeof textReview>,
  matches?: (state: PhoneState) => boolean,
) {
  world.telephony.textReview = review;
  const alpha = await mountedImage(world);
  const runtime = assistant.runtime(alpha);
  await openVoicemail(alpha, matches);
  return { alpha, runtime };
}

async function askOverPhone(alpha: Alpha, runtime: ReturnType<typeof assistant.runtime>) {
  await until(alpha, runtime, Conversation, (state) => state.ready && state.context.showing.tag === "App" && state.context.showing.view === "Phone");
  await press("Open Alpha");
  await until(alpha, alpha.runtime, Shell, (state) => state.assistant === "Sheet");
}

/** The button named `name` in the agent's request, if it offers one. */
const inReview = (name: string) => [...document.querySelectorAll("[role=dialog] button")].find((one) => one.textContent === name);

/** Press `name` in the open confirmation. */
const confirm = (name: string) => drawn(() => {
  const found = [...document.querySelectorAll("[role=alertdialog] button, [aria-label='Delete voicemail'] button")].find((one) => one.textContent === name);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no ${name} in the confirmation`);
  found.click();
});

describe("Phone on an Alpha image", () => {
  it("See my recent calls, and call a number (spec/app/phone/index.md, \"Story: See my recent calls\"; spec/app/phone/index.md, \"Story: Call a number\")", async () => {
    const world = image();
    const alpha = await mountedImage(world);

    // spec/app/phone/index.md, "Phone reads the call log whenever Recents comes to the front"
    await openReadyRecents(alpha, (state) => state.telecom === "NoCall" && state.rows === 2);
    expect(world.telephony.dialed).toEqual([]);
    expect(button("Missed")).toBeUndefined();

    // spec/app/phone/index.md, "Tapping a recent call hands its number to the dialer"; spec/app/phone/index.md, "With the dialer role a call is placed through Telecom, and counts as started only when Telecom accepted it"
    await press("Call Maya Chen");
    await until(alpha, alpha.runtime, Phone, (s) => s.dialled && s.dial.status === "Loaded");
    expect([world.telephony.dialed, world.telephony.placed]).toEqual([[], ["+14155550100"]]);
  });

  it("Type a number, and call it only when the phone can dial it (spec/app/phone/index.md, \"Story: Type a number\"; spec/app/phone/index.md, \"Story: Call a number\")", async () => {
    const { world, alpha } = await enterKeypad();
    await until(alpha, alpha.runtime, Phone, (s) => s.tab === "Keypad");

    // spec/app/phone/index.md, "With the dialer role a call is placed through Telecom, and counts as started only when Telecom accepted it": without the role the dial screen opens with the number.
    world.telephony.dialer = false;

    // spec/app/phone/index.md, "Call hands the typed number to the dialer, only if the phone says it is a number it can dial": a partial number is never handed over.
    await press("1");
    await until(alpha, alpha.runtime, Phone, (s) => s.digits === 1 && s.typed === "Partial");
    expect(button("Call")?.disabled).toBe(true);

    // spec/app/phone/index.md, "Each digit, or each digit taken back, is judged by the phone and looked up among the contacts on the phone"
    for (const key of ["4", "1", "5", "5", "5", "5", "0", "1", "0", "0"]) await press(key);
    await until(alpha, alpha.runtime, Phone, (s) => s.typed === "Dialable" && s.matched && s.carrier === "CarrierReady" && s.telecom === "NoCall");
    await press("Call");
    await until(alpha, alpha.runtime, Phone, (s) => s.dialled && s.dial.status === "Loaded");
    expect([world.telephony.dialed, world.telephony.placed]).toEqual([["14155550100"], []]);

    // spec/app/phone/index.md, "Phone reads the call log whenever Recents comes to the front"; spec/app/phone/index.md, "Leaving Phone, or leaving Recents, forgets the rows"
    world.telephony.calls.push({ id: 4, number: "+14155550123", name: "New caller", date: 1_700_000_350_000, type: "incoming" });
    await tab("Recents");
    await until(alpha, alpha.runtime, Phone, (s) => s.tab === "Recents" && s.recents.status === "Loaded" && s.rows === 3);
    expect(button("Call New caller")).toBeDefined();
    await tab("Keypad");
    await until(alpha, alpha.runtime, Phone, (s) => s.tab === "Keypad");
    world.telephony.callLog = "denied";
    await tab("Recents");
    await until(alpha, alpha.runtime, Phone, (s) => s.tab === "Recents" && s.recents.status === "Failed" && s.log.grant === "Denied" && s.rows === 0);
    expect(button("Call New caller")).toBeUndefined();
    expect(button("Retry call history")).toBeUndefined();
    await hardware("home");
    await until(alpha, alpha.runtime, Phone, (s) => !s.front && s.rows === 0);
  });

  it("Switches out of Phone's Contacts tab without closing Phone or Ask Alpha", async () => {
    const { alpha } = await openPhoneWorld();
    await until(alpha, alpha.runtime, Shell, (state) => state.image && state.contacts);
    await openPhone(alpha);
    await until(alpha, alpha.runtime, Phone, (state) => state.voicemail);
    await tab("Voicemail");
    await until(alpha, alpha.runtime, Phone, (state) => state.tab === "Voicemail");
    const contactsFront = () => until(alpha, alpha.runtime, Shell, (state) => state.trail.join(",") === "Phone,Contacts");
    await tab("Contacts");
    await contactsFront();
    expect(document.querySelector('[data-alpha-phone-tab="contacts"]')?.getAttribute("aria-selected")).toBe("true");

    await until(alpha, alpha.runtime, Phone, (state) => !state.front);
    await drawn(() => {
      for (const name of ["keypad", "recents"]) {
        const target = document.querySelector<HTMLButtonElement>(`[data-alpha-phone-tab="${name}"]`);
        if (!target) throw new Error(`no Phone tab ${name}`);
        target.focus();
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      }
    });
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.join(",") === "Phone");
    await until(alpha, alpha.runtime, Phone, (state) => state.front && state.tab === "Recents" && state.recents.status === "Loaded");
    expect(button("Call Maya Chen")).toBeDefined();

    // spec/app/contacts/index.md, "Filtering or changing the filter chip starts a new list"
    await tab("Contacts");
    await contactsFront();
    const contactsListed = () => until(alpha, alpha.runtime, Contacts, (state) =>
      state.front && !state.sought && state.list.status === "Loaded" && state.rows === 2);
    await contactsListed();
    expect(button("Search contacts")).toBeUndefined();
    const contactsHeader = document.querySelector("[data-alpha-phone-header]");
    expect([
      Boolean(contactsHeader?.querySelector('[role="tablist"][aria-label="Phone"]')),
      Boolean(contactsHeader?.querySelector('button[aria-label="New contact"]')),
    ]).toEqual([true, true]);
    expect(button("Maya Chen")).toBeDefined();
    await tab("Voicemail");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.join(",") === "Phone");
    await until(alpha, alpha.runtime, Phone, (state) => state.front && state.tab === "Voicemail");
    await until(alpha, alpha.runtime, Comms, (state) => state.app === "PhoneApp" && state.key === "phone:recents:");
    await tab("Contacts");
    await contactsFront();
    await contactsListed();
    expect(button("Ben Ortiz")).toBeDefined();
    await press("Open Alpha");
    await until(alpha, alpha.runtime, Shell, (state) => state.assistant === "Sheet");
    await fill("Ask Alpha", "Keep the Contacts draft");
    const draftKept = () => until(alpha, alpha.runtime, Comms, (state) => state.requests.some((draft) => draft.request === "Keep the Contacts draft"));
    await draftKept();
    await press("Expand chat");
    await until(alpha, alpha.runtime, Shell, (state) => state.assistant === "Full");
    expect(document.querySelector("[data-alpha-shell-page]")?.hasAttribute("inert")).toBe(true);
    await press("Shrink chat");
    await until(alpha, alpha.runtime, Shell, (state) => state.assistant === "Sheet");
    // spec/app/phone/comms.md, "Returning through an embedded Contacts tab follows the Phone stage without adding history"
    await until(alpha, alpha.runtime, Comms, (state) => state.app === "ContactsApp" && state.stage.length === 0);
    await tab("Voicemail");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.join(",") === "Phone" && state.assistant === "Sheet");
    await until(alpha, alpha.runtime, Phone, (state) => state.front && state.tab === "Voicemail");
    await until(alpha, alpha.runtime, Comms, (state) => state.app === "PhoneApp" && state.key === "phone:recents:" && state.stage.length === 0);
    await tab("Keypad");
    await until(alpha, alpha.runtime, Phone, (state) => state.front && state.tab === "Keypad");
    await until(alpha, alpha.runtime, Comms, (state) => state.app === "PhoneApp" && state.key === "phone:keypad:" && state.stage.length === 0);
    expect(document.querySelector('[data-alpha-phone-tab="keypad"]')?.getAttribute("aria-selected")).toBe("true");
    await draftKept();

    // spec/app/shell/index.md, "Opening another communications app from the stage keeps Ask Alpha open"
    await tab("Contacts");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.join(",") === "Phone,Contacts" && state.assistant === "Sheet");
    await contactsListed();
    await until(alpha, alpha.runtime, Comms, (state) => state.app === "ContactsApp" && state.stage.at(-1)?.app === "PhoneApp");
    await tab("Keypad");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.join(",") === "Phone" && state.assistant === "Sheet");
    await until(alpha, alpha.runtime, Phone, (state) => state.front && state.tab === "Keypad");
    await until(alpha, alpha.runtime, Comms, (state) => state.app === "PhoneApp" && state.key === "phone:keypad:" && state.stage.length === 0);
    await draftKept();

    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.join(",") === "Phone" && state.assistant === "Bar");
    await tab("Contacts");
    await contactsFront();
    await press("Back");
    await until(alpha, alpha.runtime, Phone, (state) => state.front && state.tab === "Keypad");

    await hardware("home");
    await until(alpha, home.runtime(alpha), Home, (state) => state.tiles.load.status === "Loaded");
    await drawn(() => {
      const tile = document.querySelector<HTMLButtonElement>("[data-home-tile='view:Contacts']");
      if (!tile) throw new Error("no Contacts tile on Home");
      tile.click();
    });
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.join(",") === "Contacts");
    expect(document.querySelector('[role="tablist"][aria-label="Phone"]')).toBeNull();
    await press("Back to apps");
    await until(alpha, alpha.runtime, Shell, (state) => state.trail.length === 0);
  });

  it(`Editing a contact opened from Phone's Contacts tab keeps the card and the list under the form (spec/app/contacts/index.md, "Story: Add or change a contact")`, async () => {
    const { alpha } = await openPhoneWorld();
    await until(alpha, alpha.runtime, Shell, (state) => state.image && state.contacts);
    await openPhone(alpha);
    await tab("Contacts");
    await until(alpha, alpha.runtime, Contacts, (state) => state.front && state.list.status === "Loaded" && state.rows === 2);
    const row = button("Ben Ortiz");
    await press("Maya Chen");
    await until(alpha, alpha.runtime, Contacts, (state) => state.opened && state.card.status === "Loaded");
    const card = document.querySelector("[data-alpha-contact-detail]");
    await press("Edit contact");
    await until(alpha, alpha.runtime, Contacts, (state) => state.form === "Changing");
    await vi.waitFor(() => expect(button("Cancel")).toBeDefined());
    expect([card?.isConnected, row?.isConnected]).toEqual([true, true]);
    await press("Cancel");
    await until(alpha, alpha.runtime, Contacts, (state) => state.form === "Shut" && state.opened);
    expect([document.querySelector("[data-alpha-contact-detail]") === card, row?.isConnected]).toEqual([true, true]);
  });

  it(`Opens the reviewed keypad without dialing (spec/app/phone/index.md, "A number handed to Phone opens the keypad with it filled in, and never dials")`, async () => {
    const world = image();
    const alpha = await mountedImage(world);
    const operation = { type: "phone_keypad", number: "+14155550100" } as const;
    await act(async () => {
      expect(await alpha.runtime.runPromise(phoneAction(operation, () => Promise.resolve(true)))).toEqual({
        kind: "applied", result: { kind: "phone-keypad", status: "opened" },
      });
    });
    await filledPhoneKeypad(alpha, 12);
    expect([world.telephony.placed, world.telephony.dialed]).toEqual([[], []]);
  });

  it(`Does not dispatch an expired call approval (spec/app/contacts/agent.md, "Only the owner approves, only what is shown as it is now, and only when the phone has ruled out an emergency call")`, async () => {
    const world = image();
    const alpha = await mountedImage(world);
    const operation = { type: "phone_call", target: { kind: "number", number: "+14155550100" } } as const;
    await act(async () => {
      expect(await alpha.runtime.runPromise(phoneAction(operation, () => Promise.resolve(false)))).toMatchObject({ kind: "refused" });
    });
    expect([world.telephony.placed, world.telephony.dialed]).toEqual([[], []]);
  });

  it(`Calls the chosen current contact number once (spec/app/contacts/agent.md, "The owner picks the exact number or the one contact, and that one is shown"; spec/app/contacts/agent.md, "Nothing is done but what the owner approved, as it was shown, once")`, async () => {
    const world = image();
    const { alpha } = await openPhoneWorld(world);
    await until(alpha, alpha.runtime, Shell, (state) => state.image);
    await until(alpha, alpha.runtime, Phone, (state) => state.telecom === "NoCall" && state.carrier === "CarrierReady");
    const query = "Maya Chen";
    const operation = { type: "phone_call", target: { kind: "contact", query } } as const;
    const current = () => Promise.resolve(true);

    const choices = await alpha.runtime.runPromise(phoneContactChoices(query));
    const choice = choices.tag === "Choices" && choices.options.length === 1 ? choices.options.at(0) : undefined;
    if (choice === undefined) throw new Error("expected one exact choice");
    expect(choice.number).toBe("+14155550100");
    expect(await alpha.runtime.runPromise(phoneAction(operation, current))).toMatchObject({ kind: "refused" });
    const reviewed = await alpha.runtime.runPromise(pickPhoneContact(query, choice));
    if (reviewed.tag !== "Exact") throw new Error("expected the chosen number's review");
    expect([world.telephony.placed, world.telephony.dialed]).toEqual([[], []]);

    const provider = world.telephony.people.find((person) => person.id === reviewed.selected.contact);
    const phone = provider?.phoneNumbers.at(0);
    if (provider === undefined || phone === undefined) throw new Error("expected the native contact's number");
    phone.number = "+14155550122";
    provider.revision += 1;
    expect(await alpha.runtime.runPromise(phoneAction(operation, current, reviewed.selected))).toMatchObject({ kind: "refused" });
    expect([world.telephony.placed, world.telephony.dialed]).toEqual([[], []]);

    const revised = await alpha.runtime.runPromise(phoneContactChoices(query));
    if (revised.tag !== "Choices" || !revised.options[0]) throw new Error("expected the replacement number as a fresh choice");
    const exact = await alpha.runtime.runPromise(pickPhoneContact(query, revised.options[0]));
    if (exact.tag !== "Exact") throw new Error("expected a fresh number review");
    expect(await alpha.runtime.runPromise(phoneAction(operation, current, exact.selected))).toEqual({
      kind: "applied", result: { kind: "phone-call", status: "placed", contact: true },
    });
    expect([world.telephony.placed, world.telephony.dialed]).toEqual([["+14155550122"], []]);
  });

  it(`Gates ordinary calls on Android's carrier and emergency readings (spec/app/phone/index.md, "Story: Know when a call is live")`, async () => {
    const world = image();
    const alpha = await mountedImage(world);
    await openReadyRecents(alpha);
    expect(button("Call Maya Chen")?.disabled).toBe(false);

    world.telephony.mobileService = false;
    act(() => world.telephony.report());
    await until(alpha, alpha.runtime, Phone, (s) => s.carrier === "CarrierUnavailable");
    expect(button("Call Maya Chen")?.disabled).toBe(true);

    world.telephony.mobileService = true;
    world.telephony.live = [{ id: "possible-emergency", state: "active", connectedAt: world.now }];
    world.telephony.emergency = null;
    act(() => world.telephony.report());
    await until(alpha, alpha.runtime, Phone, (s) => s.carrier === "CarrierReady" && s.telecom === "MaybeEmergencyCall");
    expect(button("Call Maya Chen")?.disabled).toBe(true);
    expect([world.telephony.placed, world.telephony.dialed]).toEqual([[], []]);
  });

  it('Hands off to the system dialer when cell service or call state is unknown (spec/app/phone/index.md, "Story: Call a number")', async () => {
    const world = image();
    world.telephony.mobileService = undefined;
    const { alpha } = await enterPhone(world);
    await until(alpha, alpha.runtime, Phone, (s) => s.carrier === "CarrierUnknown" && s.telecom === "NoCall" && s.recents.status === "Loaded");
    await press("Call Maya Chen");
    await until(alpha, alpha.runtime, Phone, (s) => s.dial.status === "Loaded");
    expect([world.telephony.dialed, world.telephony.placed]).toEqual([["+14155550100"], []]);

    await hardware("home");
    await until(alpha, alpha.runtime, Phone, (s) => !s.front);
    world.telephony.mobileService = true;
    world.telephony.callStateKnown = false;
    act(() => world.telephony.report());
    await openPhone(alpha);
    await until(alpha, alpha.runtime, Phone, (s) => s.carrier === "CarrierReady" && s.telecom === "CallUnknown" && s.recents.status === "Loaded");
    const operation = { type: "phone_call", target: { kind: "number", number: "+14155550100" } } as const;
    await act(async () => {
      expect(await alpha.runtime.runPromise(phoneAction(operation, () => Promise.resolve(true)))).toMatchObject({ kind: "refused" });
    });
    await press("Call Maya Chen");
    await until(alpha, alpha.runtime, Phone, (s) => s.dial.status === "Loaded");
    expect([world.telephony.dialed, world.telephony.placed]).toEqual([["+14155550100", "+14155550100"], []]);

    // spec/app/voice/index.md, "A phone call ends Talk quietly, and only the owner starts it again": a call state the phone has not told is no call, so Talk from the bar starts
    await until(alpha, alpha.runtime, Phone, (s) => s.front && s.telecom === "CallUnknown");
    await press("Talk");
    await vi.waitFor(async () => {
      await drawn(() => undefined);
      expect([world.voice.startLiveCaptureCalls + world.voice.startCloudSpeechCalls, Boolean(button("Stop voice conversation"))]).toEqual([1, true]);
    }, { timeout: 12_000 });
    await press("Stop voice conversation");
    await vi.waitFor(async () => {
      await drawn(() => undefined);
      expect(button("Stop voice conversation")).toBeUndefined();
    }, { timeout: 12_000 });
  });

  it('Lets Android determine which emergency numbers can open the dialer without service (spec/app/phone/index.md, "Story: Call a number")', async () => {
    const world = image();
    world.telephony.mobileService = false;
    world.telephony.emergencyNumbers.add("09");
    const { alpha } = await enterKeypad(world);
    await until(alpha, alpha.runtime, Phone, (s) => s.tab === "Keypad" && s.carrier === "CarrierUnavailable");
    await press("0");
    await press("9");
    await until(alpha, alpha.runtime, Phone, (s) => s.numberKind === "EmergencyNumber");
    await press("Call");
    await until(alpha, alpha.runtime, Phone, (s) => s.dial.status === "Loaded");
    expect([world.telephony.dialed, world.telephony.placed]).toEqual([["09"], []]);
  });

  it("See missed calls on Home, then unheard voicemail (spec/app/phone/index.md, \"Story: See missed calls on Home\"; spec/app/phone/voicemail.md, \"Story: See my voicemail\")", async () => {
    const { world, alpha } = await bootPhone();

    // spec/app/phone/index.md, "Home shows the missed-calls card while there are missed calls not yet seen"; spec/app/phone/index.md, "One tap on the card opens Recents with the missed calls, and otherwise the Voicemail tab while a voicemail is unheard"
    await until(alpha, alpha.runtime, Phone, (s) => s.missed === 1 && s.voicemail);
    await pressPhoneCard();
    await until(alpha, alpha.runtime, Phone, (s) => s.front && s.tab === "Recents" && s.chip === "MissedCalls" && s.recents.status === "Loaded" && s.rows === 1 && s.missed === 0);
    // spec/app/phone/index.md, "The filter and \"Retry call history\" read the log again"
    await press("Show all calls");
    await until(alpha, alpha.runtime, Phone, (s) => s.chip === "AllCalls" && s.recents.status === "Loaded" && s.rows === 2);

    // spec/app/phone/voicemail.md, "The phone reports how many voicemails are unheard, for Home and the tab"
    world.telephony.calls = world.telephony.calls.filter((one) => one.type !== "missed");
    await hardware("home");
    await until(alpha, alpha.runtime, Phone, (s) => !s.front && s.missed === 0);
    await until(alpha, alpha.runtime, Voicemail, (s) => s.unheard === 1);
    await pressPhoneCard();
    await until(alpha, alpha.runtime, Voicemail, (s) => s.front && s.list.status === "Loaded" && s.items === 1);

    // spec/app/phone/comms.md, "A subject is briefed once, only with the conversation open, and never from fixtures"
    await press("Open Alpha");
    await until(alpha, alpha.runtime, Comms, (state) => state.height === "SheetOpen" && state.briefed === state.key);
    const briefing = [...document.querySelectorAll('[aria-label="Ask Alpha"] [role="note"]')].filter((card) => card.textContent?.includes("You have 1 new voicemail."));
    expect(briefing).toHaveLength(1);
    expect(briefing[0]?.textContent).toContain("Phone");
    const signed = [...document.querySelectorAll('[aria-label="Ask Alpha"] article')].filter((row) => row.textContent?.includes("You have 1 new voicemail."));
    expect(signed).toHaveLength(0);

    // spec/app/phone/index.md, "The Voicemail tab is offered only while the carrier's visual voicemail is ready"
    world.telephony.carrier = "unconfigured";
    await hardware("home");
    await until(alpha, alpha.runtime, Phone, (s) => !s.voicemail && s.tab === "Recents");
    await openPhone(alpha);
    await until(alpha, alpha.runtime, Phone, (s) => s.front && s.recents.status === "Loaded");
    const tabs = [...document.querySelectorAll("[role=tab]")].map((one) => one.textContent);
    expect(tabs).toContain("Recents");
    expect(tabs).toContain("Keypad");
    expect(tabs).not.toContain("Voicemail");
  });

  it("See my voicemail, listen to one, and delete it (spec/app/phone/voicemail.md, \"Story: See my voicemail\"; spec/app/phone/voicemail.md, \"Story: Listen to a voicemail\"; spec/app/phone/voicemail.md, \"Story: Delete a voicemail\")", async () => {
    const world = image();
    world.voice.onDevice = false;
    // spec/app/phone/voicemail.md, "Voicemail reads the list each time its tab comes to the front"
    const { alpha } = await enterVoicemail(world, true);

    // spec/app/phone/voicemail.md, "Opening a voicemail asks for its audio under a new ticket"
    await pressVoicemailRow();
    await until(alpha, alpha.runtime, Voicemail, (s) => s.open && s.audio.status === "Loaded");

    // spec/app/phone/voicemail.md, "Only the open voicemail's newest audio is taken, and with it a transcript is asked of the phone's own recognizer": this phone has no recognizer, and nothing else is asked.
    await until(alpha, alpha.runtime, Voicemail, (s) => s.noRecognizer);

    // spec/app/phone/voicemail.md, "Play needs the audio, and never plays during a call"
    await press("Play");
    await until(alpha, alpha.runtime, Voicemail, (s) => s.playback === "Playing" && s.heard);
    await until(alpha, alpha.runtime, Voicemail, () => world.telephony.voicemails.at(0)?.heard === true);

    // spec/app/phone/voicemail.md, "Delete asks first, stops playback, and Keep closes the question"
    await press("Delete");
    await until(alpha, alpha.runtime, Voicemail, (s) => s.confirming && s.playback === "Stopped");
    expect(world.telephony.voicemails.at(0)?.deleted).toBe(false);

    // spec/app/phone/voicemail.md, "Confirming removes the open voicemail under a new number, never during a call that may be an emergency call"
    await confirm("Delete");
    await until(alpha, alpha.runtime, Voicemail, (s) => s.removal.outcome === "Confirmed" && s.list.status === "Loaded" && s.items === 0);
    expect(world.telephony.voicemails.at(0)?.deleted).toBe(true);
  });

  it(`Open a New message for the caller without sending (spec/app/phone/voicemail.md, "Call back hands the caller's number to Phone and Message opens Messages with it")`, async ({ onTestFinished }) => {
    vi.stubEnv("ELIZA_DEV_ALLOW_TEST_MOCKS", "1");
    onTestFinished(() => { vi.unstubAllEnvs(); });
    const world = image();
    const alpha = await mountedImage(world);
    await openVoicemail(alpha);
    await until(alpha, alpha.runtime, Voicemail, (state) => state.list.status === "Loaded" && state.items === 1);
    await pressVoicemailRow();
    await until(alpha, alpha.runtime, Voicemail, (state) => state.open && state.audio.status === "Loaded");

    await press("Message");
    const to = () => document.querySelector<HTMLInputElement>('input[aria-label="To"]')?.value;
    await vi.waitFor(() => expect(to()).toBe("+14155550100"), { timeout: 12_000 });
    expect(world.telephony.sent).toEqual([]);
  });

  it(`Shares only the reviewed open voicemail’s existing transcript (spec/app/contacts/agent.md, "The agent reads only the conversation, voicemail or contact open on screen, as the phone last read it")`, async () => {
    const world = image();
    const heard = { id: 11, number: "+14155550199", date: 1_700_000_100_000, seconds: 18, heard: false, deleted: false, transcript: "The carrier left these words." };
    world.telephony.voicemails = [heard];
    const transcribe = vi.fn(() => Promise.resolve("Unrequested on-device transcript"));
    world.voice.voicemailTranscription = transcribe;
    const review = textReview(world.notes.owner, "reviewed-voicemail", { type: "voicemail_read_selected" });
    const { alpha, runtime } = await openReviewedVoicemail(world, review);
    await until(alpha, alpha.runtime, Voicemail, (state) => state.list.status === "Loaded" && state.items === 1);
    await pressVoicemailRow();
    await until(alpha, alpha.runtime, Voicemail, (state) => state.open && state.carrierText && state.audio.status === "Loaded");
    await askOverPhone(alpha, runtime);

    const ask = async (prompt: string) => {
      const reads = review.pendingReads;
      world.ask.nextReplyChunks = ["Review the open voicemail on your phone."];
      world.ask.nextActions = () => {
        const chat = [...world.ask.kept].at(-1);
        const owner = chat?.[1].messages.at(-1);
        if (!chat || owner?.role !== "user" || !("clientMessageId" in owner) || typeof owner.clientMessageId !== "string") throw new Error("The fake resident lost the owner turn");
        review.readOrigin = { version: 1, requestId: owner.clientMessageId, conversationId: chat[0], inReplyTo: owner.id };
        return [{ action: "PROPOSE_DEVICE_ACTION", data: { proposalId: review.proposal.id, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true } }];
      };
      await fill("Ask Alpha", prompt);
      await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
      await press("Send");
      await until(alpha, runtime, Conversation, (state) => review.pendingReads > reads && state.turn.reply === "Complete");
      await vi.waitFor(() => expect(button("Approve")).toBeDefined());
    };
    await ask("Please read the voicemail I have open.");
    expect(review.receipts).toEqual([]);
    await pressVoicemailRow(true);
    await until(alpha, alpha.runtime, Voicemail, (state) => !state.open);
    await pressVoicemailRow();
    await until(alpha, alpha.runtime, Voicemail, (state) => state.open && state.carrierText && state.audio.status === "Loaded");
    await press("Approve");
    await vi.waitFor(() => expect(document.body.textContent).toContain("That review expired. Ask again from the current screen."));
    expect([review.decisions, review.receipts, review.completions]).toEqual([[], [], []]);

    await ask("Read what this voicemail says.");
    await press("Approve");
    await vi.waitFor(() => expect(review.completions).toHaveLength(1));
    expect(review.receipts).toEqual([{ outcome: "applied", operationId: review.proposal.id, result: {
      kind: "voicemail-read", status: "read", caller: null, date: heard.date, durationSeconds: heard.seconds,
      transcriptState: "ready", engine: "carrier", transcript: heard.transcript,
    } }]);
    expect(transcribe).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.body.textContent).toContain("The reviewed read answered the original request."));
  });

  it(`Deletes the reviewed voicemail only after Phone confirms the same provider row (spec/app/phone/voicemail.md, "Story: Delete a voicemail")`, async () => {
    const world = image();
    const original = { id: 11, number: "+14155550100", date: 1_700_000_100_000, heard: false, deleted: false,
      name: "Ada", transcript: "Original voicemail", deletionWitness: `v1:${"a".repeat(64)}` };
    const replacement = { ...original, transcript: "Replacement voicemail", deletionWitness: `v1:${"b".repeat(64)}` };
    world.telephony.voicemails = [original];
    const review = textReview(world.notes.owner, "delete-voicemail-original", { type: "voicemail_delete_selected" });
    const { alpha, runtime } = await openReviewedVoicemail(world, review, (state) => state.telecom === "NoCall");

    const ask = async (request: string) => {
      await until(alpha, alpha.runtime, Voicemail, (state) => state.open && state.audio.status === "Loaded");
      await askOverPhone(alpha, runtime);
      world.ask.nextReplyChunks = ["Review the deletion in Phone."];
      world.ask.nextActions = () => [{ action: "PROPOSE_DEVICE_ACTION", data: {
        proposalId: review.proposal.id, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true,
      } }];
      await fill("Ask Alpha", request);
      await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
      await press("Send");
      await vi.waitFor(() => expect(button("Approve")).toBeDefined());
      await press("Approve");
      await until(alpha, alpha.runtime, Shell, (state) => state.assistant === "Bar");
      await until(alpha, alpha.runtime, Voicemail, (state) => state.confirming);
    };

    await until(alpha, alpha.runtime, Voicemail, (state) => state.list.status === "Loaded" && state.items === 1);
    await pressVoicemailRow();
    await ask("Delete the voicemail I have open.");
    expect(world.telephony.deletionAttempts).toEqual([]);
    world.telephony.voicemails = [replacement];
    await confirm("Delete");
    await until(alpha, alpha.runtime, Voicemail, (state) => state.removal.outcome === "Refused");
    await vi.waitFor(() => expect(review.receipts).toHaveLength(1));
    expect([world.telephony.staged, replacement.deleted]).toEqual([[], false]);

    await pressVoicemailRow(true);
    await until(alpha, alpha.runtime, Voicemail, (state) => !state.open);
    await tab("Recents");
    await tab("Voicemail");
    await until(alpha, alpha.runtime, Voicemail, (state) => state.list.status === "Loaded" && state.items === 1);
    await pressVoicemailRow();
    review.proposal.id = "delete-voicemail-replacement";
    review.proposal.state = "pending";
    await ask("Delete this voicemail now.");
    await confirm("Delete");
    await until(alpha, alpha.runtime, Voicemail, (state) => state.removal.outcome === "Confirmed");
    await vi.waitFor(() => expect(review.receipts.at(-1)).toMatchObject({ outcome: "applied", operationId: review.proposal.id,
      result: { kind: "voicemail-delete", status: "deleted" } }));
    expect(world.telephony.staged).toMatchObject([{ target: { id: "11", witness: replacement.deletionWitness } }]);
    expect(replacement.deleted).toBe(true);
  });

  it(`Shows only the transcript of the current opening (spec/app/phone/voicemail.md, "Only the open voicemail's newest transcript is shown")`, async () => {
    const world = image();
    const first = Promise.withResolvers<string>();
    const reopened = Promise.withResolvers<string>();
    const requests: { id: string; requestId: string }[] = [];
    world.voice.voicemailTranscription = (id, requestId) => {
      requests.push({ id, requestId });
      return requests.length === 1 ? first.promise : reopened.promise;
    };
    const { alpha } = await enterVoicemail(world);

    await pressVoicemailRow();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await pressVoicemailRow(true);
    await vi.waitFor(() => expect(world.voice.canceledVoicemailTranscriptions).toEqual([requests[0]?.requestId]));

    await pressVoicemailRow();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map(({ id }) => id)).toEqual(["11", "11"]);
    expect(requests[0]?.requestId).not.toBe(requests[1]?.requestId);
    await drawn(() => first.resolve("A late transcript"));
    expect(document.querySelector("[data-alpha-phone-transcript]")).toBeNull();

    await drawn(() => reopened.resolve("The current transcript"));
    await until(alpha, alpha.runtime, Voicemail, (s) => s.transcript.status === "Loaded");
    expect(document.querySelector("[data-alpha-phone-transcript]")?.textContent).toBe("The current transcript");
  });

  it(`Waits for Android to retire the old voicemail observer before watching again (spec/app/phone/voicemail.md, "A carrier notice refreshes the visible list from the phone's latest read")`, async () => {
    const world = image();
    const { alpha } = await openPhoneWorld(world);
    await until(alpha, alpha.runtime, Shell, (state) => state.image);
    await openPhone(alpha);
    await vi.waitFor(() => expect(world.telephony.voicemailObservations).toEqual([true]));

    world.telephony.voicemailRetirementRefused = true;
    await hardware("home");
    await until(alpha, alpha.runtime, Phone, (state) => !state.front);
    await vi.waitFor(() => expect(world.telephony.voicemailObservations).toEqual([true, false]));
    await openPhone(alpha);
    await vi.waitFor(() => expect(world.telephony.voicemailObservations).toEqual([true, false, false]));

    world.telephony.voicemailRetirementRefused = false;
    await hardware("home");
    await until(alpha, alpha.runtime, Phone, (state) => !state.front);
    await openPhone(alpha);
    await vi.waitFor(() => expect(world.telephony.voicemailObservations).toEqual([true, false, false, false, true]));
    await until(alpha, alpha.runtime, Phone, (state) => state.voicemail);
  });

  it(`Shows an unknown outcome when Android returns a malformed voicemail deletion acknowledgment (spec/app/phone/voicemail.md, "The phone's answer ends the removal it names")`, async () => {
    const world = image();
    world.telephony.deletionReply = "malformed";
    world.telephony.holdVoicemailDeletion = true;
    const { alpha } = await openPhoneWorld(world);
    await until(alpha, alpha.runtime, Shell, (state) => state.image);
    await openPhone(alpha);
    await until(alpha, alpha.runtime, Phone, (state) => state.front && state.voicemail);
    await tab("Voicemail");
    await until(alpha, alpha.runtime, Voicemail, (state) => state.list.status === "Loaded" && state.items === 1);
    await pressVoicemailRow();
    await until(alpha, alpha.runtime, Voicemail, (state) => state.open);
    await press("Delete");
    await until(alpha, alpha.runtime, Voicemail, (state) => state.confirming);
    await confirm("Delete");
    await until(alpha, alpha.runtime, Voicemail, (state) => state.removal.outcome === "Unknown");
    expect(document.body.textContent).toContain("Alpha cannot tell whether the voicemail was deleted");
    expect(button("Undo")).toBeUndefined();
    expect(world.telephony.staged).toMatchObject([{ kind: "voicemail", phase: "queued", target: { id: "11" } }]);
    expect(world.telephony.deletionAttempts).toEqual(["voicemail:11"]);
  });

  it(`Keeps a voicemail only when Android confirms Undo (spec/app/phone/voicemail.md, "Undo can keep a voicemail while Android's deletion window is open")`, async () => {
    const world = image();
    world.telephony.holdVoicemailDeletion = true;
    const { alpha } = await enterVoicemail(world);
    await pressVoicemailRow();
    await until(alpha, alpha.runtime, Voicemail, (s) => s.open);
    await press("Delete");
    await until(alpha, alpha.runtime, Voicemail, (s) => s.confirming);
    await confirm("Delete");
    await until(alpha, alpha.runtime, Voicemail, (s) => s.undo === "CanUndo" && s.removal.outcome === "Sent");
    expect(world.telephony.voicemails.at(0)?.deleted).toBe(false);
    await press("Undo");
    await until(alpha, alpha.runtime, Voicemail, (s) => s.undo === "Kept" && s.list.status === "Loaded" && s.items === 1);
    expect(world.telephony.staged[0]?.phase).toBe("undone");
    expect(world.telephony.voicemails.at(0)?.deleted).toBe(false);
  });
});

describe("The call strip on an Alpha image", () => {
  it("See my live call over every view, and end it (spec/app/phone/call.md, \"Story: See my live call over every view\"; spec/app/phone/index.md, \"Story: Know when a call is live\")", async () => {
    const world = image();
    const alpha = await mountedImage(world);

    // spec/app/phone/call.md, "While a call rings, Android's incoming alert is the only call bar"
    world.telephony.live = [{ id: "c1", state: "ringing", connectedAt: null }];
    world.telephony.report();
    await until(alpha, alpha.runtime, Strip, (s) => s.calls.length === 1);
    expect(button("End call")).toBeUndefined();
    await openPhone(alpha);
    expect(document.querySelector("[data-alpha-call-strip]")).toBeNull();
    expect(button("End call")).toBeUndefined();

    // spec/app/phone/index.md, "The phone says whether a call is live, whether it may be an emergency call, and whether the carrier is ready"
    world.telephony.live = [{ id: "c1", state: "active", connectedAt: world.now }];
    world.telephony.report();
    await until(alpha, alpha.runtime, Phone, (s) => s.telecom === "OrdinaryCall");
    await until(alpha, alpha.runtime, Strip, (s) => s.shown && s.calls[0]?.phase === "Active");
    const topStrip = () => document.querySelector('[data-alpha-call-strip="over"]');
    const dock = () => document.querySelector('[data-alpha-comms-dock]');
    await vi.waitFor(async () => {
      await drawn(() => undefined);
      expect(topStrip()?.querySelector('button[aria-label="End call"]')).toBeInstanceOf(HTMLButtonElement);
      expect(dock()?.querySelector('[aria-label="Call or ask"]')).toBeInstanceOf(HTMLInputElement);
      expect(dock()?.querySelector('[aria-label="End call"]')).toBeNull();
    });
    // spec/app/voice/index.md, "A failed conversation ends quietly: why it failed is kept only until voice returns to idle, and nothing is shown": Talk asked for from the bar during a call does nothing and shows no words
    const issued = async () => (await alpha.runtime.runPromise(Effect.flatMap(Toasts, (toasts) => toasts.get()))).issued;
    const before = await issued();
    await press("Talk");
    await drawn(() => undefined);
    await until(alpha, alpha.runtime, Shell, (s) => s.assistant === "Bar");
    expect([await issued() - before, document.body.textContent?.includes("Talk is unavailable"), world.voice.startLiveCaptureCalls]).toEqual([0, false, 0]);

    // spec/app/phone/call.md, "Return and End act only on the call the bar shows, and End is asked once"
    await drawn(() => {
      const bar = topStrip()?.querySelector('button[aria-label^="Return to call, On call"]');
      if (!(bar instanceof HTMLButtonElement)) throw new Error("no call bar");
      bar.click();
    });
    await until(alpha, alpha.runtime, Strip, () => world.telephony.returned.length === 1);
    expect(world.telephony.returned).toEqual(["c1"]);
    await press("End call");
    await until(alpha, alpha.runtime, Strip, (s) => !s.shown);
    expect(world.telephony.ended).toEqual(["c1"]);
    expect(topStrip()?.querySelector("button")?.getAttribute("aria-label")).toBe("Call ended");
    expect((topStrip()?.querySelector("button") as HTMLButtonElement | null)?.disabled).toBe(true);

    // spec/app/phone/index.md, "Alpha acts outside only when the phone has ruled out an emergency call"
    world.telephony.live = [{ id: "c2", state: "active", connectedAt: world.now }];
    world.telephony.emergency = null;
    world.telephony.report();
    await until(alpha, alpha.runtime, Phone, (s) => s.telecom === "MaybeEmergencyCall");
    await vi.waitFor(async () => {
      await drawn(() => undefined);
      expect(document.querySelector('[data-alpha-call-strip="stage"] button[aria-label="End call"]')).not.toBeNull();
    });
    await alpha.runtime.runPromise(propose({ type: "phone_call", target: { kind: "number", number: "+14155550122" } }, true));
    await until(alpha, alpha.runtime, Agent, (s) => s.stage === "Shown" && s.ask === "Dial");
    expect([inReview("Call"), world.telephony.dialed]).toEqual([undefined, []]);
  });

  it('Off an Alpha image there is no call strip and no Phone, Messages or Contacts (spec/app/shell/index.md, "Phone and Messages exist only on an Alpha image, and Contacts only where that image admits it")', async () => {
    const world = { ...scene(), phone: true };
    const { alpha } = await openPhoneWorld(world);
    await until(alpha, alpha.runtime, Strip, (s) => s.eligible);
    await until(alpha, home.runtime(alpha), Home, (state) => state.tiles.load.status === "Loaded");
    expect(document.querySelector("[data-home-tile='view:Phone'], [data-home-tile='view:Messages'], [data-home-tile='view:Contacts']")).toBeNull();
    expect(button("End call")).toBeUndefined();
  });

  it('Refuses emergency numbers in phone_dial and remembers seen missed calls across Home returns (spec/app/contacts/agent.md, "The agent never calls an emergency number, and is told why"; spec/app/phone/index.md, "Home shows the missed-calls card while there are missed calls not yet seen")', async () => {
    const { world, alpha } = await bootPhone();
    await until(alpha, alpha.runtime, Phone, (s) => s.missed === 1);

    await act(async () => {
      expect(await alpha.runtime.runPromise(phoneAction({ type: "phone_dial", target: { kind: "number", number: "911" } }, () => Promise.resolve(true)))).toMatchObject({ kind: "refused" });
    });
    expect([world.telephony.dialed, world.telephony.placed]).toEqual([[], []]);

    await pressPhoneCard();
    await until(alpha, alpha.runtime, Phone, (s) => s.front && s.tab === "Recents" && s.recents.status === "Loaded" && s.missed === 0);
    await hardware("home");
    await until(alpha, alpha.runtime, Phone, (s) => !s.front && s.missed === 0);
    expect(world.telephony.calls.some((one) => one.type === "missed")).toBe(true);
  });

  const openRecents = async (world = image()) => {
    const running = await openPhoneWorld(world);
    await until(running.alpha, running.alpha.runtime, Shell, (s) => s.image && s.contacts);
    await openPhone(running.alpha);
    await until(running.alpha, running.alpha.runtime, Phone, (s) => s.front && s.tab === "Recents" && s.recents.status === "Loaded" && s.rows === 2);
    return running;
  };

  it(`Resyncs Comms subject when returning to the same Phone tab from Contacts (spec/app/phone/comms.md, "A view change while the conversation is open keeps the sheet's height and remembers the view it left")`, async () => {
    const { alpha } = await openRecents();
    await until(alpha, alpha.runtime, Comms, (s) => s.app === "PhoneApp" && s.key === "phone:recents:");
    await tab("Contacts");
    await until(alpha, alpha.runtime, Comms, (s) => s.app === "ContactsApp");
    await drawn(() => {
      const target = document.querySelector<HTMLButtonElement>('[data-alpha-phone-tab="recents"]');
      if (!target) throw new Error("no Phone recents tab");
      target.focus();
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    await until(alpha, alpha.runtime, Phone, (s) => s.front && s.tab === "Recents" && s.recents.status === "Loaded");
    await vi.waitFor(async () => {
      const state = await alpha.runtime.runPromise(Comms.use((m) => m.get()));
      expect([state.app, state.key]).toEqual(["PhoneApp", "phone:recents:"]);
    }, { timeout: 3_000 });
  });

  it('Clears stale Recents search filter when opening Missed (spec/app/phone/index.md, "Story: See my recent calls")', async () => {
    const { alpha } = await openRecents();
    await fill("Call or ask", "0111");
    await until(alpha, alpha.runtime, Phone, (s) => s.sought && s.recents.status === "Loaded" && s.rows === 1);
    await drawn(() => alpha.runtime.runPromise(Phone.use((m) => m.send({ type: "missedReported", count: 1 }))));
    await drawn(() => alpha.runtime.runPromise(Phone.use((m) => m.send({ type: "openMissed" }))));
    await until(alpha, alpha.runtime, Phone, (s) => s.front && s.chip === "MissedCalls" && s.recents.status === "Loaded");
    const missedState = await alpha.runtime.runPromise(Phone.use((m) => m.get()));
    const queryField = document.querySelector<HTMLInputElement>('input[aria-label="Call or ask"]');
    expect([missedState.sought, missedState.rows, queryField?.value ?? ""]).toEqual([false, 1, ""]);
  });
});
