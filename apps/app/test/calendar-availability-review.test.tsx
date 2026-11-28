// @vitest-environment happy-dom
import { deviceTimeZone } from "@elizaos/plugin-calendar-client";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Machine as Conversation } from "../gen/app__assistant.effect.vibe";
import { Machine as View } from "../gen/app__calendar.effect.vibe";
import * as Pages from "../gen/app__settings.effect.vibe";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import assistant from "../src/assistant/index.tsx";
import { MediaReview } from "../src/assistant/media-review.vibe";
import type { Mount } from "../src/areas.ts";
import calendar from "../src/calendar/index.tsx";
import { civilDay, dayStart } from "../src/calendar/time.ts";
import { button, closeAll, drawn, fill, only, open, press, underAct, until } from "./alpha.tsx";
import { alphaImage } from "./fakes/scene.ts";
import { textReview, type TextReviewScene } from "./fakes/text-review.ts";

underAct();
afterEach(async () => {
  await closeAll();
});

const HOUR_MS = 3_600_000;
const AVAILABILITY_SHEET: Mount = { at: "overlay", load: () => import("../src/calendar/availability.tsx") };

type OriginMode = "exact" | "none" | "mismatch";
type ActionMode = "review" | "direct" | "missing";

function availabilityWorld() {
  const world = alphaImage();
  world.now = new Date(2026, 10, 24, 9).getTime();
  const today = civilDay(world.now);
  const at = (hours: number) => dayStart(today) + hours * HOUR_MS;
  world.calendar.granted = true;
  world.calendar.phoneEvents.push({
    id: "busy-1",
    calendarId: "local",
    title: "Dentist appointment",
    begin: at(13),
    end: at(14),
    allDay: false,
    recurring: false,
  });
  const operation = {
    type: "calendar_availability" as const,
    start: new Date(at(13)).toISOString(),
    end: new Date(at(13.5)).toISOString(),
    timeZone: deviceTimeZone(),
  };
  return { world, operation };
}

const tickBox = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("[role=checkbox]")].find(
    (found) => found.getAttribute("aria-label") === name,
  );

const dialogNamed = (label: string) =>
  vi.waitFor(() => expect(document.querySelector(`[role=dialog][aria-label="${label}"]`)).not.toBeNull());

async function launchAndAsk(options: {
  screen: "home" | "calendar";
  originMode: OriginMode;
  actionMode?: ActionMode;
  foreignEnrollment?: boolean;
}) {
  const { world, operation } = availabilityWorld();
  const review: TextReviewScene = textReview(world.notes.owner, "cal-avail-review-1", operation);
  if (options.foreignEnrollment === true) {
    review.proposal.payload.enrollmentId = "another-phones-enrollment";
  }
  world.telephony.textReview = review;
  const mounts = [
    ...only("home", "assistant", "view:Calendar", "view:Settings"),
    AVAILABILITY_SHEET,
  ];
  const { alpha } = await open(world, mounts);
  const runtime = assistant.runtime(alpha);
  await until(alpha, alpha.runtime, Shell, (state) => state.image);

  if (options.screen === "calendar") {
    await alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "openView", view: "Calendar" })));
    await until(alpha, calendar.runtime(alpha), View, (state) => state.front && state.phoneRows >= 1);
    await until(alpha, runtime, Conversation, (state) =>
      state.ready && state.context.showing.tag === "App" && state.context.showing.view === "Calendar",
    );
    await vi.waitFor(() => expect(button("Open conversation")).toBeDefined());
    await press("Open conversation");
  } else {
    await until(alpha, runtime, Conversation, (state) => state.ready && state.context.showing.tag === "Home");
    await vi.waitFor(() => expect(button("Open conversation")).toBeDefined());
    await press("Open conversation");
  }
  await until(alpha, alpha.runtime, Shell, (state) => state.assistant === "Sheet");

  const earlierReads = review.pendingReads;
  world.ask.nextReplyChunks = ["Choose which calendars to check on your phone. Only busy times are shared."];
  world.ask.nextActions = () => {
    const chat = [...world.ask.kept].at(-1);
    const owner = chat?.[1].messages.at(-1);
    if (!chat || owner?.role !== "user" || !("clientMessageId" in owner) || typeof owner.clientMessageId !== "string") {
      throw new Error("The fake resident did not retain the owner turn");
    }
    if (options.originMode === "exact") {
      review.readOrigin = { version: 1, requestId: owner.clientMessageId, conversationId: chat[0], inReplyTo: owner.id };
    } else if (options.originMode === "mismatch") {
      review.readOrigin = { version: 1, requestId: owner.clientMessageId, conversationId: chat[0], inReplyTo: "earlier-owner-message" };
    } else {
      review.readOrigin = undefined;
    }
    if (options.actionMode === "missing") return [];
    if (options.actionMode === "direct") {
      return [{
        action: "PROPOSE_DEVICE_ACTION",
        data: { proposalId: review.proposal.id, state: "pending", executed: false, approvalRequired: false, directRequest: true, awaitingDeviceExecution: true },
      }];
    }
    return [{
      action: "PROPOSE_DEVICE_ACTION",
      data: { proposalId: review.proposal.id, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true },
    }];
  };

  await vi.waitFor(() => expect(document.querySelector('textarea[aria-label="Message Alpha"]')).not.toBeNull());
  await fill("Message Alpha", "Am I free today from 1pm to 1:30pm?");
  await vi.waitFor(() => expect(button("Send")?.disabled).toBe(false));
  await press("Send");
  await until(alpha, runtime, Conversation, (state) => review.pendingReads > earlierReads && state.turn.reply === "Complete");

  return { alpha, runtime, world, review, operation };
}

async function approveAndCompleteShare(review: TextReviewScene) {
  await vi.waitFor(() => expect(button("Approve")).toBeDefined());
  expect(document.body.textContent ?? "").toContain("Check availability");
  await press("Approve");
  await dialogNamed("Calendars");
  await drawn(() => tickBox("Phone · On this phone")?.click());
  await press("Check");
  await dialogNamed("Share availability");
  const shareText = document.querySelector("[role=dialog][aria-label='Share availability']")?.textContent ?? "";
  expect(shareText).toContain("Busy");
  expect(shareText).toContain("Shares times only");
  await press("Share with agent");
  await vi.waitFor(() => expect(review.receipts).toHaveLength(1));
}

describe("Calendar availability review card in Ask Alpha", () => {
  it(`renders Check availability from Home when requestMessageId is omitted, shares via sheet, and completes read reply (spec/app/calendar/sharing.md, "Story: Choose the calendars and see the answer before it is shared")`, async () => {
    const { review, operation } = await launchAndAsk({ screen: "home", originMode: "exact" });
    expect(review.proposal.payload.requestMessageId).toBeUndefined();

    await approveAndCompleteShare(review);
    await vi.waitFor(() => expect(review.completions).toHaveLength(1));
    await vi.waitFor(() => expect(document.body.textContent ?? "").toContain("The reviewed read answered the original request."));
    expect(document.body.textContent ?? "").toContain("Shared your availability.");
    expect(review.decisions).toEqual([review.proposal.id]);
    expect(review.claims).toEqual([review.proposal.id]);
    expect(review.receipts[0]).toMatchObject({
      outcome: "applied",
      operationId: review.proposal.id,
      result: {
        version: 1,
        kind: "calendar_availability",
        window: { start: operation.start, end: operation.end, timeZone: operation.timeZone },
        calendarCount: 1,
        status: "busy",
      },
    });
  });

  it(`renders Check availability from Calendar view and completes the reviewed share (spec/app/calendar/sharing.md, "A check is asked only on Home or Calendar, while Alpha can be seen, on a screen that is not sensitive"; spec/app/calendar/sharing.md, "Story: Choose the calendars and see the answer before it is shared")`, async () => {
    const { review } = await launchAndAsk({ screen: "calendar", originMode: "exact" });
    await approveAndCompleteShare(review);
    await vi.waitFor(() => expect(review.completions).toHaveLength(1));
    expect(review.receipts[0]).toMatchObject({ outcome: "applied", operationId: review.proposal.id });
  });

  it(`still renders and settles availability review without matching readReplyOrigin (repeat or mismatched origin) (spec/app/assistant/cards.md, "A phone step's result chip stands under the reply that offered it, and a reply that only offered the review gives way to it")`, async () => {
    for (const originMode of ["none", "mismatch"] as const) {
      const { review } = await launchAndAsk({ screen: "home", originMode });
      await approveAndCompleteShare(review);
      await vi.waitFor(() => expect(document.body.textContent ?? "").toContain("Shared your availability."));
      expect(review.completions).toHaveLength(0);
      await closeAll();
    }
  });

  it(`reports Nothing was shared and skips read-completion when the owner cancels the availability sheet (spec/app/calendar/sharing.md, "The sheet offers the phone's calendars with none ticked, reads only the ticked ones, and shares only a free or busy answer it showed")`, async () => {
    for (const originMode of ["exact", "none"] as const) {
      const { review } = await launchAndAsk({ screen: "home", originMode });
      await vi.waitFor(() => expect(button("Approve")).toBeDefined());
      await press("Approve");
      await dialogNamed("Calendars");
      await press("Cancel");
      await vi.waitFor(() => expect(review.receipts).toHaveLength(1));
      await vi.waitFor(() => expect(document.body.textContent ?? "").toContain("Nothing was shared."));
      expect(document.body.textContent ?? "").not.toContain("Alpha couldn’t complete that read.");
      expect(review.completions).toHaveLength(0);
      expect(review.receipts[0]).toMatchObject({ outcome: "failed", code: "not_shared", operationId: review.proposal.id });
      await closeAll();
    }
  });

  it(`drops the availability card for foreign enrollment, non-Review actions, or a sensitive screen (spec/app/calendar/sharing.md, "A check is asked only on Home or Calendar, while Alpha can be seen, on a screen that is not sensitive"; spec/app/approvals/proposal.md, "An approval that ran out, a protected screen, another owner, and review first for a direct run each let nothing be sent")`, async () => {
    const cases = [
      { screen: "home" as const, originMode: "exact" as const, foreignEnrollment: true },
      { screen: "home" as const, originMode: "exact" as const, actionMode: "direct" as const },
      { screen: "home" as const, originMode: "exact" as const, actionMode: "missing" as const },
    ];
    for (const testCase of cases) {
      const { review } = await launchAndAsk(testCase);
      expect(button("Approve")).toBeUndefined();
      expect(review.decisions).toHaveLength(0);
      expect(review.receipts).toHaveLength(0);
      expect(review.completions).toHaveLength(0);
      await closeAll();
    }

    const { alpha, runtime, world, review } = await launchAndAsk({ screen: "home", originMode: "exact" });
    await vi.waitFor(() => expect(button("Approve")).toBeDefined());
    await alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "openView", view: "Settings" })));
    await alpha.runtime.runPromise(Effect.flatMap(Pages.Machine, (pages) => pages.send({ type: "open", page: "General" })));
    await alpha.runtime.runPromise(Effect.flatMap(Pages.Machine, (pages) => pages.send({ type: "open", page: "CarrierPage" })));
    await until(alpha, runtime, Conversation, (state) => state.context.sensitive);
    await vi.waitFor(() => expect(button("Approve")).toBeUndefined());

    const sensitiveState = await runtime.runPromise(Effect.flatMap(Conversation, (machine) => machine.get()));
    const chat = [...world.ask.kept].at(-1);
    const owner = chat?.[1].messages.find((msg) => msg.role === "user");
    const session = await runtime.runPromise(Effect.flatMap(MediaReview, (media) => media.session()));
    if (!session || !chat || !owner) throw new Error("Expected active session and owner turn");
    const cards = await runtime.runPromise(
      Effect.flatMap(MediaReview, (media) =>
        media.pending(session, owner.id, 1, sensitiveState.context.revision, undefined, {
          clientMessageId: review.readOrigin?.requestId ?? "req-1",
          conversationId: chat[0],
          pageTicket: 1,
          actionResults: [{
            action: "PROPOSE_DEVICE_ACTION",
            data: { proposalId: review.proposal.id, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true },
          }],
        }),
      ),
    );
    expect(cards).toEqual([]);
  });
});
