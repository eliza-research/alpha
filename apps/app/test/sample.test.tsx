// @vitest-environment happy-dom
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Ask from "../gen/app__ask.effect.vibe";
import * as Sample from "../gen/app__sample.effect.vibe";
import * as Size from "../gen/app__sample__size.effect.vibe";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import { at, mounts } from "../src/areas.ts";
import { area } from "../src/runtime/area.tsx";
import { type Job, answer, due, reacting, stop, tell, untimed } from "../src/runtime/reactor.vibe";
import { asleep, button, closeAll, hardware, later, open, press, seen, underAct, until } from "./alpha.tsx";
import { push } from "./fakes/sample.ts";
import { scene } from "./fakes/scene.ts";
import sample from "./sample/index.tsx";
import size from "./sample/size.tsx";

underAct();
afterEach(closeAll);

const Reminders = Sample.Machine;

/** A screen two steps deep: it takes Back once, and then leaves it to the shell. */
let depth = 0;
const deep = area(Layer.empty, () => <p>Files</p>, { back: Effect.sync(() => depth-- > 0) });
/** Alpha with the sample area at the Notes view, and that screen at Files, which only this journey mounts. */
const withSample = [...mounts.filter((m) => m.at !== "view:Notes" && m.at !== "view:Files"), at("view:Notes", () => import("./sample/index.tsx")), at("view:Files", () => Promise.resolve({ default: deep }))];
const kept = "alpha/app/sample/index@1";
const shown = () => [...document.querySelectorAll("section[aria-label=Reminders] li span")].map((title) => title.textContent);
const told = () => document.querySelector("section[aria-label=Reminders] [role=alert]")?.textContent;
const shellKept = "alpha/app/shell/index@5";
/** The key the store takes no write under, once: the phone's storage is full for a moment. */
let refusing = "";
vi.stubGlobal("localStorage", new Proxy(localStorage, {
  get(storage, name) {
    if (name === "setItem") {
      return (key: string, value: string) => {
        if (key !== refusing) return storage.setItem(key, value);
        refusing = "";
        throw new DOMException("full", "QuotaExceededError");
      };
    }
    const found: unknown = Reflect.get(storage, name);
    return typeof found === "function" ? (found as (...given: unknown[]) => unknown).bind(storage) : found;
  },
}));

describe.each([["a browser", false], ["a phone", true]])("in %s", (_where, phone) => {
  // spec/app/sample/index.md, "Story: See and dismiss reminders"
  it("See and dismiss reminders (spec/app/sample/index.md, \"Story: See and dismiss reminders\")", async () => {
    const world = { ...scene(), phone };
    const first = await open(world, withSample);
    const { alpha } = first;
    const reminders = sample.runtime(alpha);

    // spec/app/sample/index.md, "Shown, the list is read and its feed opened under the next tickets; hidden, the feed is closed"
    await press("Notes");
    await until(alpha, reminders, Reminders, (s) => s.list.status === "Loaded" && s.feed.open);
    expect([shown(), world.sample.feeds.size]).toEqual([["Water the plants", "Call the bank"], 1]);

    // spec/app/sample/index.md, "Only the open feed's pushes are taken, until it drops"
    push(world.sample, ["Water the plants", "Call the bank", "Buy bread"]);
    await until(alpha, reminders, Reminders, (s) => s.titles.length === 3);
    expect(shown()).toEqual(["Water the plants", "Call the bank", "Buy bread"]);

    // spec/app/sample/index.md, "Undo within the five seconds puts the reminder back"
    await press("Dismiss Water the plants");
    expect([shown(), document.activeElement?.textContent]).toEqual([["Call the bank", "Buy bread"], "Undo dismissing “Water the plants”"]);
    await later(alpha, 4_000);
    await press("Undo dismissing “Water the plants”");
    await until(alpha, reminders, Reminders, (s) => s.undo.holding === "Undone");
    expect([shown(), world.sample.asked]).toEqual([["Call the bank", "Buy bread", "Water the plants"], []]);

    // spec/app/sample/index.md, "Once the five seconds are over the deletion is recorded as sent, and only then asked of the agent"
    await press("Dismiss Water the plants");
    await later(alpha, 5_000);
    await until(alpha, reminders, Reminders, (s) => s.deletion.attempt.outcome === "Confirmed");
    expect([world.sample.deleted, Boolean(button("Undo dismissing “Water the plants”"))]).toEqual([["Water the plants"], false]);

    // spec/app/sample/index.md, "Only the newest asking's answer is taken: the titles, or a failure that keeps the titles last read": when the store rejects a write (QuotaExceededError), the machine retains the stepped state in memory without dying, and Refresh keeps working.
    let answer = () => {};
    world.sample.gate = new Promise<void>((done) => { answer = done; });
    await press("Refresh");
    await until(alpha, reminders, Reminders, (s) => s.list.status === "Loading");
    refusing = kept;
    answer();
    await until(alpha, reminders, Reminders, (s) => s.list.status === "Loaded");
    expect([refusing, Boolean(button("Refresh"))]).toEqual(["", true]);
    await press("Refresh");
    await until(alpha, reminders, Reminders, (s) => s.list.status === "Loaded");

    // spec/app/shell/index.md, "Back closes one layer: Ask Alpha by a step, then the app on top": when the store rejects a write, the shell retains the Back transition in memory and neither the buttons nor what follows the shell stop for it.
    refusing = shellKept;
    await hardware("back");
    await until(alpha, reminders, Reminders, (s) => !s.showing);
    await until(alpha, alpha.runtime, Shell, (s) => s.trail.length === 0);
    expect([refusing, world.sample.feeds.size]).toEqual(["", 0]);

    depth = 1;
    await press("Files");
    await until(alpha, alpha.runtime, Shell, (s) => s.trail.at(-1) === "Files");
    await hardware("back");
    expect([depth, (await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).trail]).toEqual([0, ["Files"]]);
    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (s) => s.trail.length === 0);

    // spec/app/sample/index.md, "When Alpha opens again, a read and a hold under way are taken up again, the feed is closed, and a deletion sent is unknown"
    await press("Notes");
    await until(alpha, reminders, Reminders, (s) => s.list.status === "Loaded");
    world.sample.stalled = true;
    await press("Dismiss Call the bank");
    await later(alpha, 5_000);
    await until(alpha, reminders, Reminders, (s) => s.deletion.attempt.outcome === "Sent");
    await vi.waitFor(() => expect(world.sample.asked).toEqual(["Water the plants", "Call the bank"]));
    await first.close();

    world.sample.stalled = false;
    const second = await open(world, withSample);
    const reopened = sample.runtime(second.alpha);
    await until(second.alpha, reopened, Reminders, (s) => s.deletion.attempt.outcome === "Unknown" && s.list.status === "Loaded");
    expect([told(), world.sample.asked]).toEqual(["Alpha cannot tell whether the agent deleted “Call the bank”", ["Water the plants", "Call the bank"]]);

    await press("Dismiss Buy bread");
    await second.close();
    asleep(world, 60_000);
    const third = await open(world, withSample);
    await until(third.alpha, sample.runtime(third.alpha), Reminders, (s) => s.deletion.attempt.outcome === "Confirmed");
    expect(world.sample.deleted).toEqual(["Water the plants", "Buy bread"]);
    await third.close();

    localStorage.setItem(kept, JSON.stringify({ titles: "of another shape" }));
    const fourth = await open(world, withSample);
    await until(fourth.alpha, sample.runtime(fourth.alpha), Reminders, (s) => s.list.status === "Loaded");
    // spec/app/sample/index.md, "When Alpha opens again, a read and a hold under way are taken up again, the feed is closed, and a deletion sent is unknown": the Notes view draws its own header, so the sample mounted there shows no title of the shell's; the shell is still at Notes.
    expect([
      localStorage.getItem(`${kept}.unreadable`),
      Boolean(document.querySelector("section[aria-label=Reminders]")),
      (await fourth.alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).trail.at(-1),
    ]).toEqual([JSON.stringify({ titles: "of another shape" }), true, "Notes"]);

    // spec/kit/attempt.md, "A sent attempt ends as its own answer says, or as unknown when no answer can be trusted": an agent that takes a deletion and never answers is waited on for ten seconds, and the deletion is then unknown, never refused.
    const last = sample.runtime(fourth.alpha);
    world.sample.stalled = true;
    await press("Dismiss Call the bank");
    await later(fourth.alpha, 5_000);
    await until(fourth.alpha, last, Reminders, (s) => s.deletion.attempt.outcome === "Sent");
    await vi.waitFor(() => expect(world.sample.asked).toEqual(["Water the plants", "Call the bank", "Buy bread", "Call the bank"]));
    await later(fourth.alpha, 10_000);
    await until(fourth.alpha, last, Reminders, (s) => s.deletion.attempt.outcome === "Unknown");
    expect(told()).toBe("Alpha cannot tell whether the agent deleted “Call the bank”");
  });
});

describe.each([["a browser", false], ["a phone", true]])("in %s", (_where, phone) => {
  // spec/app/sample/size.md, "Story: Read Alpha at my size"
  it("Read Alpha at my size (spec/app/sample/size.md, \"Story: Read Alpha at my size\")", async () => {
    const world = { ...scene(), phone };
    const withSize = [...mounts, at("overlay", () => import("./sample/size.tsx"))];
    const page = document.documentElement;
    const shown = () => [page.style.fontSize, page.hasAttribute("data-alpha-large-text"), localStorage.getItem("alpha.textScale")];
    const told = () => document.querySelector("section[aria-label='Text size'] [role=alert]")?.textContent;

    // spec/app/sample/size.md, "When Alpha opens, the phone says the size it kept, once, and a size it does not offer counts as none": the opening asks the phone first, and the page has the kept size before its first paint.
    localStorage.setItem("alpha.textScale", "130");
    const { alpha } = await open(world, withSize);
    const sizing = size.runtime(alpha);
    await until(alpha, sizing, Size.Machine, (s) => s.started && s.percent === 130);
    expect(shown()).toEqual(["130%", true, "130"]);

    // spec/app/sample/size.md, "The owner chooses another offered size once Alpha has started, one change at a time": the owner is the sender of the choice and the phone of its answer: the size the owner has is not offered.
    expect(Boolean(button("Text at 130%"))).toBe(false);
    await press("Text at 100%");
    await until(alpha, sizing, Size.Machine, (s) => s.percent === 100 && s.setting.status === "Loaded");
    expect(shown()).toEqual(["100%", false, "100"]);

    // spec/app/sample/size.md, "The phone answers the newest asking: the size is the one wanted, or it stays and the owner is told"
    refusing = "alpha.textScale";
    await press("Text at 150%");
    await until(alpha, sizing, Size.Machine, (s) => s.unkept);
    expect([shown(), told()]).toEqual([["100%", false, "100"], "The phone did not keep that size"]);

    // spec/app/sample/size.md, "Once the owner has left the page, a size that was not kept is no longer told"
    await seen(false);
    await until(alpha, sizing, Size.Machine, (s) => !s.unkept);
    await seen(true);
    expect(told()).toBeUndefined();

    // spec/app/sample/size.md, "An asking the phone has not answered after ten seconds is given up, and the size stays": a phone that never answers: the deadline is the state's, counted from the time the reactor gave the choice.
    const silent = alpha.over(reacting(Size, {
      open: [{ type: "start", was: 115 }, "Phone"],
      carry: (fx): Job<Size.Event, never, [by: Size.Sender]> => answer("apply", Effect.never, { type: "applied", ticket: fx.ticket, kept: false }, "Phone"),
      timers: (state) => (state.setting.status === "Loading" ? [due<Size.Event, [by: Size.Sender]>("apply", state.due, { type: "giveUp", now: untimed }, "Phone")] : []),
    }));
    await silent.runPromise(Size.Machine.use((machine) => machine.send({ type: "choose", percent: 150, at: untimed }, "Owner")));
    await later(alpha, 9_999);
    expect((await silent.runPromise(Size.Machine.use((machine) => machine.get()))).setting.status).toBe("Loading");
    await later(alpha, 1);
    await until(alpha, silent, Size.Machine, (s) => s.unkept && s.percent === 115);
  });
});

// spec/kit/attempt.md, "A sent attempt ends as its own answer says, or as unknown when no answer can be trusted"
it("Two machines that tell each other are built in any order, and each hears how its telling went (spec/kit/read.md, \"Only the newest ticket's answer is taken, once\")", async () => {
  const { alpha } = await open(scene(), []);
  const asking = reacting(Ask, {
    open: [{ type: "begin" }],
    carry: (fx): Job<Ask.Event, Sample.Machine, []> => fx.tag === "Open"
      ? tell("open", Sample.Machine, [{ type: "refresh" }], { taken: { type: "opened", id: fx.id, conversation: "c", room: "r" }, refused: { type: "unopened", id: fx.id, known: true } })
      : stop("other"),
  });
  const reading = reacting(Sample, {
    carry: (fx): Job<Sample.Event, Ask.Machine, []> => fx.tag === "Fetch"
      ? tell("fetch", Ask.Machine, [{ type: "stopReply" }], { taken: { type: "loaded", ticket: fx.ticket, titles: [] }, refused: { type: "failed", ticket: fx.ticket } })
      : stop("other"),
  });
  const both = alpha.over(Layer.mergeAll(asking, reading));
  await until(alpha, both, Ask.Machine, (s) => s.conversation === "c");
  await until(alpha, both, Sample.Machine, (s) => s.list.status === "Failed");
  expect((await both.runPromise(Ask.Machine.use((machine) => machine.get()))).opening.outcome).toBe("Confirmed");
});
