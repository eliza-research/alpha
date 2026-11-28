// @vitest-environment happy-dom
// spec/app/voice/index.md, "Story: Hold a spoken conversation"; spec/app/voice/index.md, "The speech pipeline warms on startup, foreground return and account readiness without opening the microphone"; spec/app/voice/index.md, "A reply that needs the owner's review in chat keeps voice listening with the microphone open"; spec/app/voice/index.md, "Story: Go where the conversation takes me"; spec/app/voice/index.md, "A spoken reply says a written date, clock time, range and percentage in words"; spec/app/voice/index.md, "A turn Cloud refuses because the account is out of funds ends voice quietly, as Stop does"
import { type Context, Effect, Fiber, Layer, ManagedRuntime, Stream } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import * as Shell from "../gen/app__shell.effect.vibe";
import * as Voice from "../gen/app__voice.effect.vibe";
import { VoiceBridge } from "../src/platform/voice.vibe";
import { CLOUD_TURN_GAP_MS } from "../src/platform/turnGap.ts";
import { together, untimed, whole } from "../src/runtime/reactor.vibe";
import { shell } from "../src/shell/shell.vibe";
import { placeOf, VoiceWords, voicing } from "../src/voice/voice.vibe";
import { DictationClock } from "../src/voice/dictation-clock.vibe";
import { Machine as Conversation } from "../gen/app__assistant.effect.vibe";
import { Machine as Toasts } from "../gen/app__notices__toasts.effect.vibe";
import { Machine as Chats } from "../gen/app__assistant__chats.effect.vibe";
import { Machine as Messages } from "../gen/app__messages.effect.vibe";
import { Machine as Phone } from "../gen/app__phone.effect.vibe";
import { Machine as Composer } from "../gen/app__assistant__composer.effect.vibe";
import { Machine as Dock } from "../gen/app__assistant__dock.effect.vibe";
import { Machine as Speaker } from "../gen/app__voice__output.effect.vibe";
import { Machine as Locator } from "../gen/app__assistant__context.effect.vibe";
import { Machine as Files } from "../gen/app__files.effect.vibe";
import { Machine as FilePreview } from "../gen/app__files__preview.effect.vibe";
import { Machine as Preferences } from "../gen/app__settings__preferences.effect.vibe";
import * as Timers from "../gen/app__clock__timers.effect.vibe";
import type { Mount } from "../src/areas.ts";
import { dictate } from "../src/assistant/dictation.vibe";
import assistant from "../src/assistant/index.tsx";
import files from "../src/files/index.tsx";
import type { Alpha } from "../src/runtime/area.tsx";
import { button, chatAction, closeAll, drawn, fill, later, only, open, press, seen, shownWords, underAct, until as drawnUntil } from "./alpha.tsx";
import { untoldStep } from "./fakes/ask.ts";
import { memoryIndexedDB } from "./fakes/indexeddb.ts";
import { publish } from "./fakes/platform.ts";
import { rejection } from "./fakes/phone.ts";
import { scene, type Scene } from "./fakes/scene.ts";
import { prepared } from "./fakes/notes.ts";
import { alsoPending, askedPage, textReview } from "./fakes/text-review.ts";
import { agentRequest } from "./fakes/calendar.ts";
import { fakeWorld } from "./fakes/world.vibe";

type VoiceRuntime = ManagedRuntime.ManagedRuntime<
  Voice.Machine | VoiceWords | VoiceBridge | Shell.Machine,
  unknown
>;

const opened: VoiceRuntime[] = [];

function bootVoice(world: Scene, saved?: string): VoiceRuntime {
  localStorage.clear();
  if (saved !== undefined) localStorage.setItem("alpha/app/voice/index@2", saved);
  const appLayer = Layer.provideMerge(
    whole(together(shell, voicing)),
    fakeWorld(world),
  ) as unknown as Layer.Layer<Voice.Machine | VoiceWords | VoiceBridge | Shell.Machine>;
  const runtime = ManagedRuntime.make(appLayer);
  opened.push(runtime);
  return runtime;
}

async function until<I, S>(
  runtime: VoiceRuntime,
  key: Context.Key<I, { readonly changes: Stream.Stream<S> }>,
  ok: (state: S) => boolean,
): Promise<void> {
  await runtime.runPromise(
    Effect.flatMap(key as unknown as Context.Key<Voice.Machine, { readonly changes: Stream.Stream<S> }>, (machine) =>
      Stream.runHead(Stream.filter(machine.changes, ok))),
  );
}

/** Let `ms` pass on the voice runtime's clock, then let what it woke settle. */
async function advance(runtime: VoiceRuntime, ms: number): Promise<void> {
  await (runtime as unknown as ManagedRuntime.ManagedRuntime<TestClock.TestClock, unknown>).runPromise(TestClock.adjust(ms));
  for (let i = 0; i < 50; i += 1) await runtime.runPromise(Effect.yieldNow);
}

async function untilCondition(runtime: VoiceRuntime, check: () => boolean, detail?: () => unknown): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (check()) return;
    await runtime.runPromise(Effect.yieldNow);
  }
  throw new Error(`Condition did not settle: ${JSON.stringify(detail?.())}`);
}

const readyToRecord = (state: Voice.Voice) => Voice.canStartRecording(state);

const getVoice = (runtime: VoiceRuntime) =>
  runtime.runPromise(Effect.flatMap(Voice.Machine, (m) => m.get()));

const sendVoice = (runtime: VoiceRuntime, event: Voice.Event) =>
  runtime.runPromise(Effect.flatMap(Voice.Machine, (m) => m.send(event)));

const getShell = (runtime: VoiceRuntime) =>
  runtime.runPromise(Effect.flatMap(Shell.Machine, (m) => m.get()));

/** The toasts of the Alpha a journey started from its composer: its area runtime shares the app's. */
const getToasts = (runtime: VoiceRuntime) =>
  (runtime as unknown as ManagedRuntime.ManagedRuntime<Toasts, unknown>).runPromise(Effect.flatMap(Toasts, (m) => m.get()));

const sendShell = (runtime: VoiceRuntime, event: Shell.Event) =>
  runtime.runPromise(Effect.flatMap(Shell.Machine, (m) => m.send(event)));

async function startListening(world: Scene): Promise<VoiceRuntime> {
  const { alpha, area: runtime } = await onComposer(world);
  await drawnUntil(alpha, runtime, Conversation, (s) => s.ready);
  await drawnUntil(alpha, runtime, Composer, (s) => s.slot === "Open" && s.binding.owner > 0);
  await until(runtime, Voice.Machine, (s) => s.warmed);
  await sendVoice(runtime, { type: "permissionChanged", grant: "Granted" });
  await sendVoice(runtime, { type: "startTalking", now: untimed });
  await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On");
  return runtime;
}

async function startComposerRecording(world: Scene): Promise<VoiceRuntime> {
  const runtime = bootVoice(world);
  await until(runtime, Voice.Machine, (s) => s.warmed);
  await sendVoice(runtime, { type: "permissionChanged", grant: "Granted" });
  await sendVoice(runtime, { type: "openRecorder", target: "ComposerField" });
  await until(runtime, Voice.Machine, readyToRecord);
  await sendVoice(runtime, { type: "startRecording" });
  await until(runtime, Voice.Machine, (s) => s.recorder.stage === "Recording");
  return runtime;
}

function speakUtterance(world: Scene, text: string): void {
  world.voice.emitLocal?.("liveCaptureTranscript", {
    captureId: world.voice.activeMicSession,
    final: { turnId: "test-turn", text, mode: "device" },
  });
}

underAct();
afterEach(closeAll);
afterEach(async () => {
  while (opened.length > 0) {
    const rt = opened.pop();
    if (rt !== undefined) await rt.dispose();
  }
  localStorage.clear();
});

describe("Voice Bug 1 & Bug 3 journeys", () => {
  // spec/app/voice/index.md, "After a restart only the account and the owner's answer to the disclosure remain"
  it("retains Voice settings from before the recorder kept its preparation state", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const previous = JSON.stringify({
      ...Voice.initial,
      recorder: { stage: "Ready", field: "ComposerField", ticket: 4, clip: false, failure: "NoFailure", words: false, filled: 0 },
      permission: { grant: "Granted", asked: true },
      route: { ...Voice.initial.route, consent: true },
    });
    const runtime = bootVoice(world, previous);
    await until(runtime, Voice.Machine, (state) => state.warmed);
    const state = await getVoice(runtime);
    expect([state.recorder.stage, state.permission.asked, state.route.consent]).toEqual(["Closed", true, true]);
    expect(localStorage.getItem("alpha/app/voice/index@2")).toBe(previous);
  });

  // spec/app/voice/index.md, "The speech pipeline warms on startup, foreground return and account readiness without opening the microphone"; spec/app/voice/index.md, "Starting asks for the microphone the first time, opens it once it is allowed, and holds the speech engine while talking"
  it("prewarms on startup and foreground, coalesces concurrent probes, holds the speech engine while talking, and warms cloud after consent", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    let releaseProbe: (() => void) | undefined;
    const probeWait = new Promise<void>((resolve) => { releaseProbe = resolve; });
    world.voice.probeGate = () => probeWait;

    const runtime = bootVoice(world);

    await until(runtime, Voice.Machine, (s) => s.warmed);
    await untilCondition(
      runtime,
      () => world.voice.warmSpeechOutputCalls === 1 && world.voice.localSpeechStatusCalls === 1 && world.voice.liveCaptureStatusCalls === 1,
      () => ({ warm: world.voice.warmSpeechOutputCalls, local: world.voice.localSpeechStatusCalls, live: world.voice.liveCaptureStatusCalls }),
    );
    const afterWarm = await getVoice(runtime);
    expect([afterWarm.phase, afterWarm.mic, afterWarm.prompting, world.voice.startLiveCaptureCalls, world.ask.warmUps, world.voice.relayWarmups]).toEqual([
      "Idle", "Off", false, 0, [], [],
    ]);

    const extraProbe = runtime.runPromise(Effect.flatMap(VoiceBridge, (b) => b.probeStatus(true)));
    releaseProbe?.();
    const probed = await extraProbe;
    expect(probed).toEqual({ ready: false, ttsReady: true, liveCapture: true });
    expect([world.voice.warmSpeechOutputCalls, world.voice.localSpeechStatusCalls, world.voice.liveCaptureStatusCalls]).toEqual([1, 1, 1]);

    const cached = await runtime.runPromise(Effect.flatMap(VoiceBridge, (b) => b.probeStatus(true)));
    expect(cached).toEqual({ ready: false, ttsReady: true, liveCapture: true });
    expect([world.voice.localSpeechStatusCalls, world.voice.liveCaptureStatusCalls]).toEqual([1, 1]);

    await sendVoice(runtime, { type: "permissionChanged", grant: "Granted" });
    await sendVoice(runtime, { type: "startTalking", now: untimed });
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On");
    const listening = await getVoice(runtime);
    // spec/app/voice/index.md, "On-device Talk audio stays in the current owner's native capture and resident recognizer": opening the microphone checks the resident route again, beside the warm-up's cached probe.
    expect([listening.engineHeld, world.voice.engineHeld, world.voice.holdEngineCalls, world.voice.liveCaptureStatusCalls, world.voice.startLiveCaptureCalls]).toEqual([
      true, true, 1, 2, 1,
    ]);

    await sendVoice(runtime, { type: "stop", keyboard: false });
    await until(runtime, Voice.Machine, (s) => s.phase === "Idle");
    const stopped = await getVoice(runtime);
    expect([stopped.engineHeld, world.voice.engineHeld, world.voice.releaseEngineHoldCalls]).toEqual([false, false, 1]);

    world.voice.probeGate = undefined;
    await seen(false);
    await seen(true);
    await untilCondition(runtime, () => world.voice.warmSpeechOutputCalls === 2 && world.voice.liveCaptureStatusCalls === 3);

    world.signedIn = true;
    world.voice.signedInHere?.();
    await until(runtime, Voice.Machine, (s) => s.route.account === "CloudAccount" && s.route.consent && s.warmed);
    await sendVoice(runtime, { type: "returned" });
    await untilCondition(runtime, () => world.voice.relayWarmups.length >= 1);
    expect([world.ask.warmUps, [...new Set(world.voice.relayWarmups)], world.voice.startCloudSpeechCalls]).toEqual([[], ["production"], 0]);
  });

  // spec/app/voice/index.md, "The speech pipeline warms on startup, foreground return and account readiness without opening the microphone"
  it("warms the Cloud speech relay for an own-key account that agreed to network speech, as talking on it uses the relay", async () => {
    const world = { ...scene(), phone: true };
    const runtime = bootVoice(world);
    await until(runtime, Voice.Machine, (s) => s.warmed);
    await untilCondition(runtime, () => world.voice.warmSpeechOutputCalls === 1);
    expect(world.voice.relayWarmups).toEqual([]);

    await sendVoice(runtime, { type: "accountChanged", account: "OwnKey", key: 2 });
    await sendVoice(runtime, { type: "chooseNetworkSpeech", agree: true });
    await sendVoice(runtime, { type: "returned" });
    await untilCondition(runtime, () => world.voice.relayWarmups.length >= 1, () => world.voice.relayWarmups);
    const warm = await getVoice(runtime);
    expect([[...new Set(world.voice.relayWarmups)], warm.mic, world.voice.startCloudSpeechCalls, world.voice.startLiveCaptureCalls]).toEqual([["production"], "Off", 0, 0]);
  });

  it('returns quietly to idle when local Talk is unavailable before opening the microphone (spec/app/voice/index.md, "The microphone opens for the current session only, and a microphone that cannot open fails the conversation"; spec/app/voice/index.md, "A failed conversation ends quietly: why it failed is kept only until voice returns to idle, and nothing is shown")', async () => {
    const world = { ...scene(), phone: true };
    world.voice.nativeTransport = false;
    const runtime = bootVoice(world);
    await until(runtime, Voice.Machine, (s) => s.warmed);
    await sendVoice(runtime, { type: "permissionChanged", grant: "Granted" });
    const before = (await getVoice(runtime)).session;
    await sendVoice(runtime, { type: "startTalking", now: untimed });
    await until(runtime, Voice.Machine, (s) => s.session > before && s.phase === "Idle");
    const stopped = await getVoice(runtime);
    expect([stopped.mic, stopped.failure, stopped.engineHeld, world.voice.activeMicSession, world.voice.startLiveCaptureCalls]).toEqual(["Off", "NoFailure", false, undefined, 0]);
  });

  it('recognizes the same recorded clip after a failed attempt (spec/app/voice/index.md, "Story: Dictate into a field")', async () => {
    const world = { ...scene(), phone: true };
    world.voice.transcriptionFailures = 1;
    const runtime = await startComposerRecording(world);
    await sendVoice(runtime, { type: "stopRecording", now: untimed });
    await until(runtime, Voice.Machine, (s) => s.recorder.stage === "Recorded");
    expect((await getVoice(runtime)).recorder.failure).toBe("Recognition");
    await sendVoice(runtime, { type: "transcribeAgain", now: untimed });
    await until(runtime, Voice.Machine, (s) => s.recorder.stage === "Review");
    const reviewed = await getVoice(runtime);
    expect([reviewed.recorder.words, reviewed.sent]).toEqual([true, 0]);
    expect(runtime.runSync(VoiceWords).memory.dictatedDurationMs).toBe(59_000);
  });

  // spec/app/voice/index.md, "A clip is transcribed on the route speech takes now"
  it("recognizes one native completion even when a stale recording ID follows it before Start returns", async () => {
    const world = { ...scene(), phone: true };
    const runtime = await startComposerRecording(world);
    await sendVoice(runtime, { type: "closeRecorder" });

    world.voice.recordingStartGate = () => {
      world.voice.finishRecording?.();
      world.voice.emitLocal?.("recordingStopped", { recordingId: "retired-native-id", status: "failed" });
      return Promise.resolve();
    };
    await sendVoice(runtime, { type: "openRecorder", target: "ComposerField" });
    await until(runtime, Voice.Machine, readyToRecord);
    await sendVoice(runtime, { type: "startRecording" });
    await until(runtime, Voice.Machine, (s) => s.recorder.stage === "Review");
    expect(world.voice.dictationClips).toEqual(["rec-2"]);
    expect((await getVoice(runtime)).sent).toBe(0);
  });

  // spec/app/voice/index.md, "A clip is transcribed on the route speech takes now"
  it("keeps a confirmed clip when obscured and never offers a recognition retry for a refused stop", async () => {
    const world = { ...scene(), phone: true };
    world.voice.dictationInFront = false;
    const runtime = await startComposerRecording(world);
    world.voice.finishRecording?.();
    await until(runtime, Voice.Machine, (s) => s.recorder.stage === "Recorded");
    expect(world.voice.dictationClips).toEqual([]);
    world.voice.dictationInFront = true;
    await sendVoice(runtime, { type: "transcribeAgain", now: untimed });
    await until(runtime, Voice.Machine, (s) => s.recorder.stage === "Review");
    expect(world.voice.dictationClips).toEqual(["rec-1"]);

    await sendVoice(runtime, { type: "recordAgain" });
    world.voice.refuseRecordingStop = true;
    await sendVoice(runtime, { type: "startRecording" });
    await until(runtime, Voice.Machine, (s) => s.recorder.stage === "Recording");
    await sendVoice(runtime, { type: "stopRecording", now: untimed });
    await until(runtime, Voice.Machine, (s) => s.recorder.stage === "Closed");
    const closed = await getVoice(runtime);
    expect([closed.recorder.clip, Voice.canTranscribeAgain(closed, untimed)]).toEqual([false, false]);
    expect(world.voice.dictationClips).toEqual(["rec-1"]);
  });

  // spec/app/voice/index.md, "Alpha's reply is spoken a sentence at a time, sentences streamed before the reply is complete included, and only for the current turn"; spec/app/voice/index.md, "A spoken reply says a written date, clock time, range and percentage in words"
  it("streams multi-sentence replies incrementally with append chaining, says dates and times in words, and returns to listening", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    world.ask.nextReplyChunks = [
      "First sentence is ready. ",
      "Second sentence follows immediately! ",
      "Final sentence wraps up.",
    ];
    const runtime = await startListening(world);
    expect(world.ask.opened).toBe(0);

    speakUtterance(world, "Give me an update");
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.sent === 1 && s.turn === 2);

    expect(world.voice.spoken.map((one) => ({ text: one.text, append: one.append }))).toEqual([
      { text: "First sentence is ready.", append: false },
      { text: "Second sentence follows immediately!", append: true },
      { text: "Final sentence wraps up.", append: true },
    ]);
    expect(world.voice.engineHeld).toBe(true);
    expect([...world.ask.kept.values()].map((chat) => chat.title)).toEqual(["Ask Alpha"]);

    world.ask.nextReplyChunks = [
      "Sun, Nov 22:\n",
      "Dentist Mon, Nov 23 at 3:30 pm, about 5–10 minutes. ",
      "Then 9:05 to 10:00, and lunch at 12 pm. Battery is at 80%.",
    ];
    speakUtterance(world, "What is on my calendar");
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.sent === 2 && s.turn === 3);
    expect(world.voice.spoken.slice(3).map((one) => one.text)).toEqual([
      "Sunday, November twenty-second.",
      "Dentist Monday, November twenty-third at three thirty P M, about 5 to 10 minutes.",
      "Then nine oh five to ten o'clock, and lunch at noon.",
      "Battery is at 80 percent.",
    ]);
    expect(world.ask.kept.get("c1")?.messages.at(-1)?.text).toBe("Sun, Nov 22:\nDentist Mon, Nov 23 at 3:30 pm, about 5–10 minutes. Then 9:05 to 10:00, and lunch at 12 pm. Battery is at 80%.");

    const withAbbreviations = ["Dentist Mon.", " Se", "pt. 0", "7 from 2 p.", " m. to", " 3 p.m. Bring 5–10.", " Call again at 4 P.M. ", "tomorrow!"];
    const spokenAbbreviations = ["Dentist Monday, September seventh from two P M to three P M.", "Bring 5 to 10.", "Call again at four P M tomorrow!"];
    for (const [index, provisional] of [false, true].entries()) {
      const from = world.voice.spoken.length;
      world.ask.nextReplyChunks = withAbbreviations;
      world.ask.nextReplyProvisional = provisional;
      speakUtterance(world, "Read me another day");
      await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.sent === 3 + index && s.turn === 4 + index);
      expect(world.voice.spoken.slice(from).map((one) => one.text)).toEqual(spokenAbbreviations);
      expect(world.ask.kept.get("c1")?.messages.at(-1)?.text).toBe(withAbbreviations.join(""));
    }

    const written = [
      "Ages 8-12 welcome. Pages 10-20.\n",
      "Standup at 9:00\n- 10:00 Review.\n",
      "Items 3\n- 5 left. ",
      "Call 555-123-4567 on 2026-11-24 at UTC+01:00, if you may 3 times.",
    ];
    const from = world.voice.spoken.length;
    world.ask.nextReplyChunks = written;
    speakUtterance(world, "Anything else");
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.sent === 5 && s.turn === 6);
    expect(world.voice.spoken.slice(from).map((one) => one.text)).toEqual([
      "Ages 8 to 12 welcome.",
      "Pages 10 to 20.",
      "Standup at nine o'clock - ten o'clock Review.",
      "Items 3 - 5 left.",
      "Call 555-123-4567 on 2026-11-24 at UTC+01:00, if you may 3 times.",
    ]);
    expect(world.ask.kept.get("c1")?.messages.at(-1)?.text).toBe(written.join(""));

    // spec/app/assistant/reply.md, "The agent's turn tag is never drawn, copied, quoted, emailed or spoken, and a reply still being written holds back what may become one"
    const tagged = [[["Sure.\n[answer] Paris"], ["Sure.", "Paris"]], [["Paris. [answer]"], ["Paris."]], [["<promise> One sec."], ["One sec."]], [["[ans", "wer] Paris"], ["Paris"]], [["[answer", "](https://example.com) is a link."], ["answer is a link."]]] as const;
    for (const [index, [chunks, heard]] of tagged.entries()) {
      const before = world.voice.spoken.length;
      world.ask.nextReplyChunks = chunks;
      speakUtterance(world, "Capital of France");
      await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.sent === 6 + index && s.turn === 7 + index);
      expect(world.voice.spoken.slice(before).map((one) => one.text)).toEqual(heard);
    }
  });

  // spec/app/assistant/reply.md, "The planning label shows until the first settled text, and provisional text is neither shown nor spoken"
  it("says the reply the agent decided as soon as it arrives, before the stored reply, never its provisional text, and each sentence once", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const ready = Promise.withResolvers<void>();
    const done = Promise.withResolvers<void>();
    world.ask.nextReplyChunks = ["You're clear tomorrow. ", "Nothing is booked."];
    world.ask.nextReplyProvisional = true;
    world.ask.nextReplySettled = true;
    world.ask.holdReady = ready.promise;
    world.ask.holdDoneAfterReady = done.promise;
    const runtime = await startListening(world);
    try {
      speakUtterance(world, "What's on tomorrow");
      await untilCondition(runtime, () => world.voice.spoken.length === 1, () => world.voice.spoken);
      expect(world.voice.spoken.map((one) => one.text)).toEqual(["You're clear tomorrow."]);
      ready.resolve();
      done.resolve();
      await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.sent === 1 && s.turn === 2);
      expect(world.voice.spoken.map((one) => one.text)).toEqual(["You're clear tomorrow.", "Nothing is booked."]);
    } finally {
      ready.resolve();
      done.resolve();
    }
  });

  // spec/app/assistant/reply.md, "Each step the agent marked untold draws Alpha's step notice under its reply, live and read again, and a reply with no text that marks one is answered, never declined"
  it("says nothing of a step the agent marked untold, never the provisional text it settled away from, and ends quietly while the chat shows the step's notice", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    world.ask.nextReplyChunks = ["Your table ", "is booked."];
    world.ask.nextReplyProvisional = true;
    world.ask.nextReplySettledAs = "";
    world.ask.nextActions = () => [untoldStep("BOOK_TABLE")];
    const runtime = await startListening(world);
    speakUtterance(world, "Book a table at Nopa");
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.sent === 1 && s.turn === 2);
    expect([world.voice.spoken, world.ask.kept.get("c1")?.messages.at(-1)]).toEqual([[], { id: "m1a", role: "assistant", text: "", untold: ["BOOK_TABLE"] }]);
    const bubbles = () => [...document.querySelectorAll("section[aria-label='Ask Alpha'] [role=log] article")].map((line) => line.textContent ?? "");
    await drawn(() => vi.waitFor(() => expect(bubbles()).toEqual(["Book a table at Nopa", "Book table did not complete"])));
    expect(document.body.textContent?.includes("booked")).toBe(false);
    // spec/app/assistant/reply.md, "Each step the agent marked untold draws Alpha's step notice under its reply, live and read again, and a reply with no text that marks one is answered, never declined": the notice draws once, in the transcript under its reply, and nothing of it shows on, near or under the message bar.
    const outsideTranscript = () => {
      const page = document.body.cloneNode(true) as HTMLElement;
      for (const log of page.querySelectorAll("[role=log]")) log.remove();
      return page.textContent ?? "";
    };
    expect([
      document.body.textContent?.split("did not complete").length,
      document.querySelector("section[aria-label='Ask Alpha'] [role=log]")?.textContent?.includes("Book table did not complete"),
      outsideTranscript().includes("did not complete"),
      [...document.querySelectorAll("textarea[data-alpha-composer]")].map((field) => Boolean(field.closest("[role=log]"))),
    ]).toEqual([2, true, false, [false]]);

    // spec/app/assistant/reply.md, "Each step the agent marked untold draws Alpha's step notice under its reply, live and read again, and a reply with no text that marks one is answered, never declined": the resend of a dropped spoken turn answers the stored reply's text alone, so the chat takes its untold step from its history row.
    world.ask.nextDropsWith = { text: "", untold: ["HOLD_SEAT"] };
    speakUtterance(world, "Hold me a seat");
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.sent === 2 && s.turn === 3);
    expect(world.voice.spoken).toEqual([]);
    await drawn(() => vi.waitFor(() => expect(bubbles()).toEqual(["Book a table at Nopa", "Book table did not complete", "Hold me a seat", "Hold seat did not complete"])));

    // spec/app/assistant/reply.md, "Each step the agent marked untold draws Alpha's step notice under its reply, live and read again, and a reply with no text that marks one is answered, never declined": a spoken reply streamed with words that marks nothing makes no read of its history row.
    const held = ["Book a table at Nopa", "Book table did not complete", "Hold me a seat", "Hold seat did not complete"];
    const plainReads = world.ask.pageReads;
    world.ask.nextReplyChunks = ["Nopa opens at five."];
    speakUtterance(world, "When does Nopa open");
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.sent === 3 && s.turn === 4);
    const opens = [...held, "When does Nopa open", "Nopa opens at five."];
    await drawn(() => vi.waitFor(() => expect(bubbles()).toEqual(opens)));
    expect([world.voice.spoken.map((one) => one.text), world.ask.pageReads]).toEqual([["Nopa opens at five."], plainReads]);

    // spec/app/assistant/reply.md, "Each step the agent marked untold draws Alpha's step notice under its reply, live and read again, and a reply with no text that marks one is answered, never declined": the resend of a dropped spoken turn whose stored reply has words answers those words alone; Talk speaks the words and nothing of the notice, which the chat takes from the reply's history row.
    world.ask.nextDropsWith = { text: "Here are two cafes near Nopa.", untold: ["BOOK_TABLE"] };
    speakUtterance(world, "Book Nopa and find cafes");
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.sent === 4 && s.turn === 5);
    await drawn(() => vi.waitFor(() => expect(bubbles()).toEqual([...opens, "Book Nopa and find cafes", "Here are two cafes near Nopa.Book table did not complete"])));
    expect(world.voice.spoken.map((one) => one.text)).toEqual(["Nopa opens at five.", "Here are two cafes near Nopa."]);
  });

  // spec/app/assistant/reply.md, "A spoken acknowledgment starts at once; a reply ready before it is audible drops it, and an audible one finishes before the reply, within 2.5 s"
  it("says the agent's acknowledgment at once, before the reply it was waiting for, and only once", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    world.ask.acknowledgment = "Let me check your calendar.";
    world.ask.holdAfterTools = true;
    world.ask.nextReplyChunks = ["You're clear tomorrow. ", "Nothing is booked."];
    const runtime = await startListening(world);

    speakUtterance(world, "What's on tomorrow");
    await untilCondition(runtime, () => world.voice.spoken.length === 1, () => world.voice.spoken);
    expect(world.voice.spoken.map((one) => ({ text: one.text, append: one.append }))).toEqual([{ text: "Let me check your calendar.", append: false }]);
    for (const release of [...world.ask.turns.values()]) release();
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.sent === 1 && s.turn === 2);
    expect(world.voice.spoken.map((one) => ({ text: one.text, append: one.append }))).toEqual([
      { text: "Let me check your calendar.", append: false },
      { text: "You're clear tomorrow.", append: false },
      { text: "Nothing is booked.", append: true },
    ]);
    expect(world.ask.kept.get("c1")?.messages.at(-1)?.text).toBe("You're clear tomorrow. Nothing is booked.");
  });

  // spec/app/assistant/reply.md, "A spoken acknowledgment starts at once; a reply ready before it is audible drops it, and an audible one finishes before the reply, within 2.5 s"; spec/app/voice/index.md, "When the whole reply has been heard, Alpha listens for the next turn"
  it("over the Cloud relay, says the acknowledgment, keeps the turn while its tools run, then says the reply and listens again", async () => {
    const world = { ...scene(), phone: true };
    world.voice.onDevice = false;
    world.ask.acknowledgment = "Let me check your calendar.";
    world.ask.holdAfterTools = true;
    world.ask.nextReplyChunks = ["You're clear tomorrow. ", "Nothing is booked."];
    const runtime = await startListening(world);
    expect([(await getVoice(runtime)).network, world.voice.startCloudSpeechCalls]).toEqual([true, 1]);

    const relay = world.voice.activeMicSession;
    world.voice.emitCloud?.({ type: "speech-start", sessionId: relay });
    world.voice.emitCloud?.({ type: "speech-end", sessionId: relay, text: "What's on tomorrow" });
    await advance(runtime, CLOUD_TURN_GAP_MS);
    await untilCondition(runtime, () => world.voice.spoken.length === 1, () => world.voice.spoken);
    // spec/app/voice/index.md, "Story: Hold a spoken conversation": The relay's microphone stays closed while Alpha speaks; v119 held its Cloud streaming input through the reply.
    await until(runtime, Voice.Machine, (s) => (s.mic === "Off" && s.played === 1) || !Voice.talking(s));
    expect([(await getVoice(runtime)).phase, world.voice.spoken.map((one) => one.text), world.ask.turns.size, world.voice.stopCloudSpeechCalls, world.voice.activeMicSession !== undefined]).toEqual([
      "Speaking", ["Let me check your calendar."], 1, 0, true,
    ]);
    for (const release of [...world.ask.turns.values()]) release();
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.sent === 1 && s.turn === 2);
    expect([world.voice.spoken.map((one) => one.text), world.ask.kept.get("c1")?.messages.at(-1)?.text, world.voice.activeMicSession !== undefined]).toEqual([
      ["Let me check your calendar.", "You're clear tomorrow.", "Nothing is booked."], "You're clear tomorrow. Nothing is booked.", true,
    ]);
  });

  // spec/app/assistant/reply.md, "A spoken acknowledgment starts at once; a reply ready before it is audible drops it, and an audible one finishes before the reply, within 2.5 s"
  it("drops an acknowledgment the reply overtakes before it is heard, and never says it after", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    world.ask.acknowledgment = "Let me check your calendar.";
    world.ask.holdAfterTools = true;
    world.ask.nextReplyChunks = ["You're clear tomorrow."];
    const runtime = await startListening(world);
    const synthesis = Promise.withResolvers<void>();
    let first = true;
    world.voice.synthesisGate = () => {
      if (!first) return Promise.resolve();
      first = false;
      return synthesis.promise;
    };
    const hushed = world.voice.hushCalls;

    speakUtterance(world, "What's on tomorrow");
    await untilCondition(runtime, () => world.voice.spoken.length === 1, () => world.voice.spoken);
    for (const release of [...world.ask.turns.values()]) release();
    await untilCondition(runtime, () => world.voice.played.length === 1, () => world.voice.played);
    synthesis.resolve();
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.sent === 1 && s.turn === 2);
    for (let i = 0; i < 50; i += 1) await runtime.runPromise(Effect.yieldNow);
    expect([world.voice.played.map((one) => one.text), world.voice.hushCalls > hushed, world.voice.spoken.map((one) => one.append)]).toEqual([
      ["You're clear tomorrow."], true, [false, false],
    ]);
  });

  // spec/app/assistant/reply.md, "A spoken acknowledgment starts at once; a reply ready before it is audible drops it, and an audible one finishes before the reply, within 2.5 s"
  it("lets a heard acknowledgment finish before the reply, and cuts it when the reply has waited 2.5 s", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    world.ask.acknowledgment = "Let me check your calendar.";
    const runtime = await startListening(world);
    const turn = async (asked: string, answer: string, sent: number, waits: (finish: () => void) => Promise<number>) => {
      const from = world.voice.played.length;
      const hushed = world.voice.hushCalls;
      world.ask.holdAfterTools = true;
      world.ask.nextReplyChunks = [answer];
      let finish = () => {};
      world.voice.playbackHold = () => new Promise<void>((resolve) => { finish = resolve; });
      speakUtterance(world, asked);
      await untilCondition(runtime, () => world.voice.played.length === from + 1, () => world.voice.played);
      world.voice.playbackHold = undefined;
      for (const release of [...world.ask.turns.values()]) release();
      await until(runtime, Voice.Machine, (s) => s.queued === 2 && s.replied);
      for (let i = 0; i < 50; i += 1) await runtime.runPromise(Effect.yieldNow);
      const held = await waits(finish);
      await untilCondition(runtime, () => world.voice.played.length === from + 2, () => world.voice.played);
      finish();
      await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.sent === sent && s.turn === sent + 1);
      return { said: world.voice.played.slice(from).map((one) => one.text), cut: world.voice.hushCalls > hushed, held };
    };

    const longCue = await turn("What's on tomorrow", "You're clear tomorrow.", 1, async () => {
      await advance(runtime, 2_400);
      const heldAtBound = world.voice.played.length;
      await advance(runtime, 100);
      return heldAtBound;
    });
    const shortCue = await turn("Am I free Sunday", "Sunday is open.", 2, async (finish) => {
      await advance(runtime, 300);
      const heldWhileAudible = world.voice.played.length;
      finish();
      return heldWhileAudible;
    });
    expect(longCue).toEqual({ said: ["Let me check your calendar.", "You're clear tomorrow."], cut: true, held: 1 });
    expect(shortCue).toEqual({ said: ["Let me check your calendar.", "Sunday is open."], cut: false, held: 3 });
  });

  // spec/app/assistant/reply.md, "One brief acknowledgment at most, only from the agent's acknowledgment frame, before any tool runs"
  it("says an acknowledgment that follows the agent's own streamed words, once, and then the reply from its start", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    world.ask.acknowledgment = "Let me check your calendar.";
    const runtime = await startListening(world);
    const turn = async (asked: string, streamed: string, sent: number) => {
      const from = world.voice.played.length;
      world.ask.streamedBeforeAcknowledgment = streamed;
      world.ask.holdAfterTools = true;
      world.ask.nextReplyChunks = ["You're clear tomorrow. ", "Nothing is booked."];
      speakUtterance(world, asked);
      await untilCondition(runtime, () => world.voice.played.length === from + 1, () => world.voice.played);
      for (const release of [...world.ask.turns.values()]) release();
      await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.sent === sent && s.turn === sent + 1);
      return world.voice.played.slice(from).map((one) => one.text);
    };

    expect(await turn("What's on tomorrow", "Checking", 1)).toEqual(["Let me check your calendar.", "You're clear tomorrow.", "Nothing is booked."]);
    expect(await turn("And Friday", "Let me check your calendar.", 2)).toEqual(["Let me check your calendar.", "You're clear tomorrow.", "Nothing is booked."]);
  });

  // spec/app/voice/index.md, "A turn Cloud refuses because the account is out of funds ends voice quietly, as Stop does"; spec/app/assistant/reply.md, "Out of funds is refused before any output, is never spoken, and offers only Manage plan"
  it("keeps listening after other refusals and ends quietly when Cloud refuses a spoken turn for spent funds, leaving its one line until the next turn", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const runtime = await startListening(world);

    world.ask.refusal = { failureKind: "provider_issue" };
    speakUtterance(world, "What's the weather");
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.sent === 1 && s.turn === 2);

    world.ask.refusal = { failureKind: "insufficient_credits", planAction: "funding" };
    speakUtterance(world, "And tomorrow");
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.sent === 2 && s.turn === 3);

    expect([fundingRows(), (await getShell(runtime)).assistant]).toEqual([0, "Bar"]);
    world.ask.refusal = { failureKind: "insufficient_credits", cloudCode: "allowance_exhausted", planAction: "funding" };
    speakUtterance(world, "And Friday");
    await until(runtime, Voice.Machine, (s) => s.phase === "Idle");
    const ended = await getVoice(runtime);
    expect([ended.phase, ended.mic, ended.failure, ended.engineHeld, ended.sent, world.voice.engineHeld, world.voice.activeMicSession, world.voice.startLiveCaptureCalls, world.voice.spoken]).toEqual([
      "Idle", "Off", "NoFailure", false, 3, false, undefined, 3, [],
    ]);
    for (let i = 0; i < 30; i += 1) await runtime.runPromise(Effect.yieldNow);
    const toasts = await getToasts(runtime);
    expect([fundingRows(), button("Manage plan") !== undefined, toasts.issued, toasts.showing, (await getShell(runtime)).assistant]).toEqual([1, true, 0, false, "Sheet"]);

    await sendVoice(runtime, { type: "startTalking", now: untimed });
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On");
    world.ask.refusal = undefined;
    speakUtterance(world, "And Saturday");
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.sent === 4);
    for (let i = 0; i < 30; i += 1) await runtime.runPromise(Effect.yieldNow);
    expect([fundingRows(), button("Manage plan")]).toEqual([0, undefined]);
  });

  // spec/app/voice/index.md, "A reply that needs the owner's review in chat keeps voice listening with the microphone open": a reply ready before its turn ends is not spoken while the proposal waits, even when a later tool's progress replaced the proposal's own
  it("keeps Talk listening during a confirmed chat review and its decision, and never speaks the reply ready beside it", async () => {
    const world = { ...scene(), phone: true, image: true, signedIn: false };
    const review = textReview(world.notes.owner, "spoken-folder", { type: "files_folder_create", parent: "Download", name: "Review folder" });
    world.telephony.textReview = review;
    const { alpha } = await open(world, talkMounts);
    const area = assistant.runtime(alpha);
    await drawnUntil(alpha, area, Conversation, (state) => state.ready && state.observing);
    await drawnUntil(alpha, area, Composer, (state) => state.slot === "Open" && state.binding.owner > 0);
    await drawnUntil(alpha, alpha.runtime, Preferences, (state) => state.document.read.status === "Loaded");
    await drawn(() => alpha.runtime.runPromise(Preferences.use((machine) => machine.send({ type: "setAskFirst", askFirst: true, at: untimed }, "Owner"))));
    await drawnUntil(alpha, alpha.runtime, Preferences, (state) => state.askFirst);
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.warmed);
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Listening" && state.mic === "On");
    world.ask.nextReplyChunks = ["Your Review folder is ready for you to look over."];
    world.ask.nextActions = () => [{ action: "PROPOSE_DEVICE_ACTION", data: {
      proposalId: review.proposal.id, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true,
    } }, { action: "VIEWS", data: {} }];
    world.ask.nextReplyProvisional = true;
    world.ask.nextNewestProgressOnly = true;
    world.ask.holdDoneAfterReady = Promise.resolve();

    speakUtterance(world, "Create a Review folder in Downloads");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Listening" && state.mic === "On" && state.reviewPending);
    expect(document.body.textContent).toContain("Review in chat");
    expect([world.voice.engineHeld, world.voice.activeMicSession !== undefined, world.voice.spoken]).toEqual([true, true, []]);
    expect(review.claims).toEqual([]);

    const decision = Promise.withResolvers<void>();
    review.decisionGate = decision.promise;
    try {
      await press("Decline");
      await drawn(() => vi.waitFor(() => expect(button("Decline")?.disabled).toBe(true)));
      expect(document.body.textContent).toContain("Review in chat");
    } finally {
      decision.resolve();
    }
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Listening" && state.mic === "On" && !state.reviewPending);
    expect([button("Decline"), review.proposal.state, review.claims, world.voice.activeMicSession !== undefined]).toEqual([undefined, "rejected", [], true]);
    expect(document.body.textContent).not.toContain("Review in chat");
  });

  // spec/app/voice/index.md, "An active voice conversation may ask the shell to open Home or any admitted screen"; spec/app/voice/index.md, "Voice keeps talking after a navigation only when it is the one the conversation asked for; any other ends it"; spec/app/shell/index.md, "Agent navigation shows an admitted app or Home, lowering Ask Alpha only where it would hide it"
  it("keeps voice and mic open across agent navigation to an app, to Home, and to Home again, keeping a raised Sheet where the view is in sight and lowering it or Full where they would hide it, while owner navigation stops voice", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const runtime = await startListening(world);
    // spec/app/assistant/context.md, "A spoken turn carries what a typed turn sent at that moment would, the view claim included"; spec/app/assistant/index.md, "A screen that changed takes a new revision and stops the turn in flight; an unchanged one is ignored": the turn is sent once this screen is told to an agent that takes it; raising the sheet tells nothing new, so its prepared view opens on that same screen.
    await until(runtime, Conversation, (s) => s.observing && !s.context.sensitive && s.context.revision > 0 && s.context.showing.tag === "Home");
    await sendShell(runtime, { type: "raise", detent: "Sheet" });
    const shows = (viewId: string) => (metadata: unknown) => [prepared(String((metadata as { viewClientId?: unknown }).viewClientId), viewId, false)];

    world.ask.nextReplyChunks = ["Opening Calendar."];
    world.ask.nextActions = shows("calendar");
    speakUtterance(world, "Open my calendar");
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.followed === placeOf("Calendar") && s.claim === 0);
    expect(await getShell(runtime)).toMatchObject({ trail: ["Calendar"], assistant: "Sheet" });

    world.ask.nextReplyChunks = ["Back on Home."];
    world.ask.nextActions = shows("home");
    speakUtterance(world, "Go home");
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.followed === placeOf(undefined) && s.claim === 0);
    expect(await getShell(runtime)).toMatchObject({ trail: [], assistant: "Sheet" });

    // spec/app/shell/index.md, "Agent navigation shows an admitted app or Home, lowering Ask Alpha only where it would hide it": asked for Home with the sheet over Home, Talk lowers it and keeps listening.
    const route = (await getShell(runtime)).route;
    world.ask.nextReplyChunks = ["Here is Home."];
    world.ask.nextActions = shows("home");
    speakUtterance(world, "Go home");
    await until(runtime, Shell.Machine, (s) => s.route === route + 1);
    await until(runtime, Voice.Machine, (s) => s.sent === 3 && s.phase === "Listening" && s.mic === "On" && s.claim === 0);
    expect(await getShell(runtime)).toMatchObject({ trail: [], assistant: "Bar", spokenRoute: route + 1 });

    // spec/app/shell/index.md, "Agent navigation shows an admitted app or Home, lowering Ask Alpha only where it would hide it": Full over Home hides any destination, so opening Calendar lowers it in the same move.
    await sendShell(runtime, { type: "raise", detent: "Full" });
    world.ask.nextReplyChunks = ["Opening Calendar."];
    world.ask.nextActions = shows("calendar");
    speakUtterance(world, "Open my calendar");
    await until(runtime, Voice.Machine, (s) => s.sent === 4 && s.phase === "Listening" && s.mic === "On" && s.followed === placeOf("Calendar") && s.claim === 0);
    expect(await getShell(runtime)).toMatchObject({ trail: ["Calendar"], assistant: "Bar" });

    // spec/app/voice/index.md, "An active voice conversation may ask the shell to open Home or any admitted screen": the words of a reply never move the shell, even ones shaped as an old navigation tag; only what its actions prepared does.
    world.ask.nextReplyChunks = ["[NAVIGATE:Home] Back on Home."];
    speakUtterance(world, "Go home");
    await until(runtime, Voice.Machine, (s) => s.sent === 5 && s.phase === "Listening" && s.mic === "On" && s.claim === 0);
    expect(await getShell(runtime)).toMatchObject({ trail: ["Calendar"] });

    await sendShell(runtime, { type: "openView", view: "Notes" });
    await until(runtime, Voice.Machine, (s) => s.phase === "Idle");
    const ended = await getVoice(runtime);
    expect([ended.phase, ended.mic, ended.engineHeld, world.voice.engineHeld, world.voice.releaseEngineHoldCalls]).toEqual([
      "Idle", "Off", false, false, 1,
    ]);
  });
  // spec/app/voice/index.md, "The speech pipeline warms on startup, foreground return and account readiness without opening the microphone"; spec/app/voice/index.md, "Starting asks for the microphone the first time, opens it once it is allowed, and holds the speech engine while talking"; spec/app/voice/route.md, "Story: Choose where speech is processed"
  it("talks over Cloud speech on a phone with only the relay, under the signed-in key read again after a refused start, and warms the relay without waiting on it", async () => {
    const world = { ...scene(), phone: true };
    world.voice.onDevice = false;
    world.voice.relayWarmupHangs = true;
    world.voice.credentialId = "cred-owner-7";
    const runtime = bootVoice(world);
    expect(await runtime.runPromise(Effect.flatMap(VoiceBridge, (bridge) => bridge.available()))).toBe(true);

    await until(runtime, Voice.Machine, (s) => s.route.account === "CloudAccount" && s.route.consent && s.warmed);
    await untilCondition(runtime, () => world.voice.relayWarmups.length === 1, () => world.voice.relayWarmups);
    await sendVoice(runtime, { type: "returned" });
    await untilCondition(runtime, () => world.voice.relayWarmups.length === 2, () => world.voice.relayWarmups);
    expect([world.voice.relayWarmups, world.ask.warmUps]).toEqual([["production", "production"], []]);

    await sendVoice(runtime, { type: "startTalking", now: untimed });
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.network);
    expect(world.voice.cloudStarts).toEqual([{ environment: "production", credentialId: "cred-owner-7" }]);
    await sendVoice(runtime, { type: "stop", keyboard: false });
    await until(runtime, Voice.Machine, (s) => s.phase === "Idle");

    world.voice.credentialId = "cred-owner-8";
    await sendVoice(runtime, { type: "startTalking", now: untimed });
    await until(runtime, Voice.Machine, (s) => s.session === 2 && s.phase === "Idle" && s.failure === "NoFailure" && s.mic === "Off");
    await sendVoice(runtime, { type: "startTalking", now: untimed });
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.network);
    expect(world.voice.cloudStarts.map((one) => one.credentialId)).toEqual(["cred-owner-7", "cred-owner-7", "cred-owner-8"]);
    await sendVoice(runtime, { type: "stop", keyboard: false });
    await until(runtime, Voice.Machine, (s) => s.phase === "Idle");

    world.signedIn = false;
    await sendVoice(runtime, { type: "returned" });
    await untilCondition(runtime, () => world.voice.relayWarmups.length === 3, () => world.voice.relayWarmups);
    await sendVoice(runtime, { type: "startTalking", now: untimed });
    await until(runtime, Voice.Machine, (s) => s.session === 4 && s.phase === "Idle");
    expect([(await getVoice(runtime)).mic, world.voice.cloudStarts.length]).toEqual(["Off", 3]);
  });
});

/** Ask Alpha alone: the screen a spoken conversation from the composer draws. */
const talkMounts: Mount[] = [{ at: "assistant", load: () => import("../src/assistant/index.tsx") }];

const fundingLine = "You’re out of plan allowance and credits, so I couldn’t reply.";

/** How many messages in Ask Alpha's conversation read as the one out-of-funds line. */
const fundingRows = () => [...document.querySelectorAll("section[aria-label='Ask Alpha'] [role=log] article")].filter((row) => row.textContent?.includes(fundingLine)).length;

async function onComposer(world: Scene, ...otherMounts: Mount[]) {
  const { alpha } = await open(world, [...talkMounts, ...otherMounts]);
  return { alpha, area: assistant.runtime(alpha) };
}

const listening = (state: Voice.Voice) => state.phase === "Listening" && state.mic === "On";

/** Ask Alpha alone on `world`, with Talk tapped from its composer and `ready`, listening unless it says otherwise. */
async function talkingOnComposer(world: Scene, ready: (state: Voice.Voice) => boolean = listening) {
  const { alpha, area } = await onComposer(world);
  await drawnUntil(alpha, area, Voice.Machine, (state) => state.warmed);
  await drawnUntil(alpha, area, Composer, (state) => state.slot === "Open");
  await press("Talk");
  await drawnUntil(alpha, area, Voice.Machine, ready);
  return { alpha, area };
}

async function talkingWithTextComposer(world: Scene) {
  const { alpha, area } = await onComposer(world);
  await drawnUntil(alpha, area, Conversation, (state) => state.ready && state.observing);
  await drawnUntil(alpha, area, Composer, (state) => state.slot === "Open" && state.binding.owner > 0);
  await drawnUntil(alpha, area, Voice.Machine, (state) => state.warmed);
  await press("Talk");
  await drawnUntil(alpha, area, Voice.Machine, listening);
  return { alpha, area };
}

async function interruptStory(world: Scene, alpha: Alpha, area: ReturnType<typeof assistant.runtime>) {
  world.ask.acknowledgment = "Let me think of one.";
  world.ask.holdAfterTools = true;
  world.ask.holdAborts = true;
  world.ask.nextReplyChunks = ["Once there was a lighthouse."];
  speakUtterance(world, "Tell me a story");
  await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Speaking" && state.mic === "On" && state.queued > 0);
  world.voice.emitLocal?.("liveCaptureBargeIn", { captureId: world.voice.activeMicSession });
  await drawnUntil(alpha, area, Voice.Machine, (state) => listening(state) && state.heard);
  world.ask.acknowledgment = undefined;
}

/** Talk on `world`, stopped from its conversation once `meanwhile` has changed the phone, and quiet again. */
async function stoppedOnComposer(world: Scene, meanwhile: (talking: Awaited<ReturnType<typeof talkingOnComposer>>) => void | Promise<void>) {
  const { alpha, area } = await talkingOnComposer(world);
  await meanwhile({ alpha, area });
  await press("Open conversation");
  await press("Stop voice conversation");
  await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Idle");
  return { alpha, area };
}

/** Whether voice is closed by a stop not yet confirmed off, with neither Talk nor a new capture offered. */
async function closedByStop(world: Scene, area: ReturnType<typeof assistant.runtime>, starts = world.voice.startLiveCaptureCalls) {
  const state = await area.runPromise(Effect.flatMap(Voice.Machine, (voice) => voice.get()));
  return [state.latched, Voice.canStartTalking(state, 0), button("Talk"), world.voice.startLiveCaptureCalls - starts];
}

/** With the microphone off, Talk is offered and enabled, and a tap on it listens again. */
async function talksAgain(world: Scene, alpha: Alpha, area: ReturnType<typeof assistant.runtime>) {
  expect([world.voice.activeMicSession, button("Talk")?.disabled]).toEqual([undefined, false]);
  await press("Talk");
  await drawnUntil(alpha, area, Voice.Machine, listening);
}

/** Raise Ask Alpha to its sheet. */
const raiseSheet = (alpha: Alpha) => drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell.Machine, (machine) => machine.send({ type: "raise", detent: "Sheet" }))));

/** Ask Alpha alone on `world`, raised to its sheet once its composer is open. */
async function onSheet(world: Scene, ...otherMounts: Mount[]) {
  const { alpha, area } = await onComposer(world, ...otherMounts);
  await drawnUntil(alpha, area, Conversation, (state) => state.context.revision > 0);
  await drawnUntil(alpha, area, Composer, (state) => state.slot === "Open");
  await raiseSheet(alpha);
  return { alpha, area };
}

/** Open dictation from the composer, and wait until it is ready to record. */
async function dictating(alpha: Alpha, area: ReturnType<typeof assistant.runtime>) {
  await drawn(() => area.runPromise(dictate()));
  await drawnUntil(alpha, area, Voice.Machine, readyToRecord);
}

/** Bring Notes forward, as the shell does. */
const openNotes = (alpha: Alpha) => drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell.Machine, (machine) => machine.send({ type: "openView", view: "Notes" }))));

/** Focus Switch to keyboard and press it, as the owner does. */
async function switchToKeyboard() {
  await drawn(() => button("Switch to keyboard")?.focus());
  await press("Switch to keyboard");
}

/** Let the startup cover lift, as it does at the latest 2.5 s after start where Home is not drawn under it, before a step that checks nothing is on screen. */
async function coverLifted(alpha: Alpha) {
  const cover = () => document.querySelector('[role="status"][aria-label="Loading Alpha"]');
  for (let waited = 0; waited < 2500 && cover(); waited += 500) await later(alpha, 500);
  expect(cover()).toBeNull();
}

async function settleComposer(alpha: Alpha, check: () => boolean) {
  for (let turn = 0; turn < 400 && !check(); turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
  expect(check()).toBe(true);
}

async function startTalkWithAskFirstOff({ alpha, area }: Awaited<ReturnType<typeof onComposer>>) {
  await drawnUntil(alpha, alpha.runtime, Preferences, (s) => s.document.read.status === "Loaded" && !s.askFirst);
  await press("Talk");
  await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On");
}

describe("Talk from Ask Alpha's composer (spec/app/voice/index.md, \"Story: Hold a spoken conversation\")", () => {
  it.each([
    { name: "Home", view: undefined },
    { name: "Calendar", view: "Calendar" },
    { name: "Browser", view: "Browser" },
  ] as const)("draws the compact Talk waveform over $name during on-device speech", async ({ view }) => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await onComposer(world);
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.warmed);
    if (view !== undefined) await drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell.Machine, (machine) => machine.send({ type: "openView", view }))));
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Listening" && state.mic === "On");
    const waveform = () => document.querySelector("[data-alpha-pill-voice] [data-alpha-voice-animation]");
    expect(waveform()?.getAttribute("data-phase")).toBe("Listening");
    expect(waveform()?.children.length).toBe(5);

    await press("Mute microphone");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.muted && state.mic === "Off");
    expect(waveform()?.getAttribute("data-phase")).toBe("Muted");
    expect(world.voice.activeMicSession).toBeUndefined();

    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Idle");
    expect(waveform()).toBeNull();
  });

  it("a timer the agent starts and cancels, typed or by Talk, shows on Home and leaves it at once (spec/app/clock/timers.md, \"Story: Run multiple countdown timers\")", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await onComposer(world, ...only("home", "home/cards"));
    await drawnUntil(alpha, area, Conversation, (s) => s.ready);
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.warmed);
    const chip = () => document.querySelector("[aria-label^='Clock timer:']")?.getAttribute("aria-label");
    const agentTimer = (label: string, act: () => void) => () => {
      act();
      world.clock.version += 1;
      return [{ action: "CLOCK_TIMER", data: { text: label } }];
    };
    const agentDoes = (reply: string, actions: () => readonly unknown[]) => {
      world.ask.nextReplyChunks = [reply];
      world.ask.nextActions = actions;
    };
    const starts = (id: string) => agentTimer("Started", () => {
      world.clock.timers.push({ id, label: "", durationMs: 300_000, remainingMs: 300_000, status: "running",
        startedAtMs: world.now, endAtMs: world.now + 300_000, ringStartedAtMs: null, revision: 1, updatedAtMs: world.now });
    });
    const cancels = (id: string) => agentTimer("Cancelled", () => {
      world.clock.timers = world.clock.timers.filter((timer) => timer.id !== id);
      world.clock.deletedTimerIds.push(id);
    });

    const timersRead = (count: number) => drawn(() => vi.waitFor(() => expect(alpha.runtime.runSync(Timers.Machine.use((m) => m.get())).items).toHaveLength(count), { timeout: 10_000 }));
    const typed = async (words: string, send: number) => {
      await fill("Message Alpha", words);
      await press("Send");
      await drawnUntil(alpha, area, Conversation, (s) => s.turn.send.id === send && s.turn.reply === "Complete");
    };

    agentDoes("Your 5-minute timer is running.", starts("timer-1"));
    await typed("Set a timer for 5 minutes.", 1);
    await timersRead(1);
    await drawn(() => vi.waitFor(() => expect(chip()).toBe("Clock timer: Timer 05:00")));
    agentDoes("The timer is cancelled.", cancels("timer-1"));
    await typed("Cancel the timer.", 2);
    await timersRead(0);
    await drawn(() => vi.waitFor(() => expect(chip()).toBeUndefined()));

    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On");
    agentDoes("Your 5-minute timer is running.", starts("timer-2"));
    speakUtterance(world, "Set a timer for 5 minutes.");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.sent === 1 && s.phase === "Listening");
    await timersRead(1);
    await drawn(() => vi.waitFor(() => expect(chip()).toBe("Clock timer: Timer 05:00")));
    agentDoes("The timer is cancelled.", cancels("timer-2"));
    speakUtterance(world, "Cancel the timer.");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.sent === 2 && s.phase === "Listening");
    await timersRead(0);
    await drawn(() => vi.waitFor(() => expect(chip()).toBeUndefined()));
  });

  it("a Calendar change asked by Talk shows its card in the sheet and is made on Approve (spec/app/calendar/agent.md, \"The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken\")", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await onSheet(world, ...only("assistant/calendar"));
    await drawnUntil(alpha, area, Conversation, (s) => s.ready);
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.warmed);
    const start = new Date(world.now + 86_400_000).toISOString();
    const end = new Date(world.now + 86_400_000 + 1_800_000).toISOString();
    world.ask.nextReplyChunks = ["I've proposed camera setup for tomorrow. It's waiting for your approval."];
    world.ask.nextActions = () => {
      world.calendar.approvals.push(agentRequest("approval-1", {
        action: "schedule_event", account: "owner", source: { calendarId: "eliza-calendar/primary" }, recurrence: null,
        fields: { title: "camera setup", description: "", location: "", startAt: start, endAt: end, isAllDay: false, timeZone: "UTC" },
      }));
      return [{ action: "CALENDAR", data: { subaction: "create_event", approvalRequestId: "approval-1" } }];
    };

    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On");
    speakUtterance(world, "Put a 30 minute event called camera setup in that slot.");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.sent === 1);
    await vi.waitFor(() => expect(button("Approve")).toBeDefined(), { timeout: 10_000 });
    expect(document.querySelector("section[aria-label='Calendar change']")?.textContent).toContain("camera setup");
    expect(world.calendar.writes).toEqual([]);
    await press("Approve");
    await drawn(() => vi.waitFor(() => expect(world.calendar.writes).toEqual(["approve approval-1", "create ev-camera-setup"]), { timeout: 10_000 }));
  });

  it("ends Talk for a call behind the call screen, quietly, and waits for the owner to start it again (spec/app/voice/index.md, \"A phone call ends Talk quietly, and only the owner starts it again\")", async () => {
    const world = { ...scene(), phone: true, image: true, signedIn: false };
    const { alpha, area } = await onComposer(world, ...only("notice"));
    await drawnUntil(alpha, alpha.runtime, Phone, (state) => state.telecom === "NoCall");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.warmed);
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Listening" && state.mic === "On");

    const issued = async () => (await alpha.runtime.runPromise(Effect.flatMap(Toasts, (toasts) => toasts.get()))).issued;
    const before = await issued();
    await seen(false);
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Idle" && state.mic === "Off" && state.callNotice === "AwaitingCallCause");
    world.telephony.live = [{ id: "talk-interrupted", state: "active", connectedAt: world.now }];
    await drawn(() => world.telephony.report());
    await drawnUntil(alpha, alpha.runtime, Phone, (state) => state.telecom === "OrdinaryCall");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.callNotice === "CallNoticeOnReturn");
    world.telephony.live = [];
    await drawn(() => world.telephony.report());
    await drawnUntil(alpha, alpha.runtime, Phone, (state) => state.telecom === "NoCall");
    await seen(true);
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Idle" && state.callNotice === "NoCallNotice");
    await drawn(() => undefined);
    expect([await issued() - before, document.body.textContent?.includes("phone call"), world.voice.startLiveCaptureCalls, world.voice.activeMicSession]).toEqual([0, false, 1, undefined]);

    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Listening" && state.mic === "On");
    expect(world.voice.startLiveCaptureCalls).toBe(2);

    const again = await issued();
    await seen(false);
    world.telephony.live = [{ id: "talk-shown-in-call", state: "active", connectedAt: world.now }];
    await drawn(() => world.telephony.report());
    await drawnUntil(alpha, alpha.runtime, Phone, (state) => state.telecom === "OrdinaryCall");
    await seen(true);
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Idle" && state.mic === "Off" && state.callNotice === "NoCallNotice");
    await drawn(() => undefined);
    expect([await issued() - again, world.voice.activeMicSession]).toEqual([0, undefined]);
    world.telephony.live = [];
    await drawn(() => world.telephony.report());
    await drawnUntil(alpha, alpha.runtime, Phone, (state) => state.telecom === "NoCall");
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Listening" && state.mic === "On");
    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Idle");
  });

  it("restores the local speaker before unrelated playback when Talk stops during a mute (spec/app/voice/index.md, \"Speaker mute is offered after the current speech bridge confirms gain control\")", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await onComposer(world);
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.warmed);
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.speaker === "SpeakerOn");
    expect(world.voice.speakerGainRequests).toEqual([false]);

    await press("Mute speaker");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.speaker === "SpeakerOff");
    expect(button("Unmute speaker")?.getAttribute("aria-pressed")).toBe("true");
    expect(world.voice.speakerMuted).toBe(true);
    expect(world.voice.activeMicSession).toBeDefined();
    await press("Unmute speaker");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.speaker === "SpeakerOn");

    const pending = Promise.withResolvers<void>();
    const began = Promise.withResolvers<void>();
    world.voice.speakerGainGate = async (muted) => {
      if (muted) {
        began.resolve();
        await pending.promise;
      }
    };
    try {
      await press("Mute speaker");
      await began.promise;
      expect(button("Mute speaker")?.disabled).toBe(true);
      await press("Stop voice conversation");
      await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Stopping");
      expect(world.voice.speakerGainRequests).toEqual([false, true, false, true]);
    } finally {
      pending.resolve();
    }
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Idle");
    expect(world.voice.speakerGainRequests).toEqual([false, true, false, true, false]);

    await area.runPromise(Effect.flatMap(VoiceBridge, (bridge) => Stream.runCollect(bridge.readAloud(1, "Another reading."))));
    expect(world.voice.speakerMutedAtPlayback).toEqual([false]);
  });

  // spec/app/voice/index.md, "Stop shuts the conversation down, and a stop asked for the keyboard then hands it over"
  it("offers Stop and no keyboard control in Talk, as the Sunday demo build did, and Stop releases the microphone and speaker", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await talkingOnComposer(world, (state) => listening(state) && state.speaker === "SpeakerOn");
    await press("Open conversation");
    const row = document.querySelector<HTMLElement>('section[aria-label="Voice conversation"]');
    expect(row).not.toBeNull();
    expect(button("Switch to keyboard")).toBeUndefined();
    expect([...row!.querySelectorAll("button")].map((control) => control.getAttribute("aria-label"))).toEqual(["Mute speaker", "Mute microphone", "Stop voice conversation"]);
    expect(row!.textContent?.trim()).toBe("Listening");
    expect(row!.querySelector('[role="status"]')?.className).toContain("sr-only");
    await press("Mute speaker");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.speaker === "SpeakerOff");
    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Idle");
    expect(world.voice.activeMicSession).toBeUndefined();
    expect(document.querySelector('section[aria-label="Voice conversation"]')).toBeNull();
  });

  // spec/app/voice/index.md, "Stop shuts the conversation down, and a stop asked for the keyboard then hands it over"
  it("offers Talk again after a stop whose speech session the agent could not close, once the microphone and speech are off", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await stoppedOnComposer(world, () => { world.voice.agentClosesLiveCapture = false; });
    await talksAgain(world, alpha, area);
  });

  // spec/app/voice/index.md, "A stop that could not be confirmed keeps voice closed until the microphone and speech are confirmed off"
  it("keeps Talk and the microphone closed while the microphone is still held, and offers Talk again once a later ask confirms it off", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await stoppedOnComposer(world, () => { world.voice.liveCaptureReleaseFails = true; });
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.latched);
    const starts = world.voice.startLiveCaptureCalls;
    expect(await closedByStop(world, area, starts)).toEqual([true, false, undefined, 0]);

    await drawn(() => advance(area, Voice.releaseAgainMs));
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.latched);
    expect(await closedByStop(world, area, starts)).toEqual([true, false, undefined, 0]);

    world.voice.liveCaptureReleaseFails = false;
    await seen(false);
    await seen(true);
    await drawnUntil(alpha, area, Voice.Machine, (state) => !state.latched);
    await talksAgain(world, alpha, area);
  });

  // spec/app/voice/index.md, "A stop that could not be confirmed keeps voice closed until the microphone and speech are confirmed off"
  it("offers Talk again without a return to the foreground once a microphone that let go late is asked again, less often each time", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await stoppedOnComposer(world, () => { world.voice.liveCaptureReleaseFails = true; });
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.latched);
    const asked = world.voice.stopLiveCaptureCalls;
    await drawn(() => advance(area, Voice.releaseAgainMs));
    await untilCondition(area, () => world.voice.stopLiveCaptureCalls === asked + 2);
    await drawn(() => advance(area, 0));
    const second = Voice.againAfter(Voice.releaseAgainMs);
    expect(second).toBeGreaterThan(Voice.releaseAgainMs);
    world.voice.liveCaptureReleaseFails = false;
    await drawn(() => advance(area, second - 1));
    expect(await closedByStop(world, area)).toEqual([true, false, undefined, 0]);
    await drawn(() => advance(area, 1));
    await drawnUntil(alpha, area, Voice.Machine, (state) => !state.latched);
    await talksAgain(world, alpha, area);
  });

  // spec/app/voice/index.md, "A heard turn waits for the send in hand, is sent once after it, and is given up quietly only after 30 s"; spec/app/voice/index.md, "A stop that could not be confirmed keeps voice closed until the microphone and speech are confirmed off"
  it("sends the first turn heard after a stop in the middle of a turn that could not be confirmed, once voice recovers", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await talkingOnComposer(world);
    world.ask.acknowledgment = "Let me look.";
    world.ask.holdAfterTools = true;
    speakUtterance(world, "Take your time");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Speaking" && state.mic === "On");
    world.voice.liveCaptureReleaseFails = true;
    await press("Open conversation");
    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Idle");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.latched);
    world.ask.acknowledgment = undefined;
    world.voice.liveCaptureReleaseFails = false;
    await drawn(() => advance(area, Voice.releaseAgainMs));
    await drawnUntil(alpha, area, Voice.Machine, (state) => !state.latched);
    await talksAgain(world, alpha, area);
    const spokenBefore = world.voice.spoken.length;
    const { sent } = await area.runPromise(Effect.flatMap(Voice.Machine, (machine) => machine.get()));
    speakUtterance(world, "Are you there");
    await drawnUntil(alpha, area, Voice.Machine, (state) => listening(state) && state.sent > sent && state.turn > state.sent);
    expect([world.ask.said, world.voice.spoken.slice(spokenBefore).map(({ text }) => text)]).toEqual([["Take your time", "Are you there"], ["You said, Are you there"]]);
  });

  // spec/app/voice/index.md, "A heard turn waits for the send in hand, is sent once after it, and is given up quietly only after 30 s"; spec/app/voice/index.md, "The owner speaking over Alpha interrupts it and starts the next turn, but Alpha's own voice never does"
  it("sends a turn the owner says over Alpha once, after the turn it interrupted has let go of the agent", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await talkingOnComposer(world);
    await interruptStory(world, alpha, area);
    world.ask.nextReplyChunks = ["It is noon."];
    const spokenBefore = world.voice.spoken.length;
    speakUtterance(world, "What time is it");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Thinking" && state.sent === state.turn);
    for (let turn = 0; turn < 30; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    expect(world.ask.said).toEqual(["Tell me a story"]);

    world.ask.holdAborts = false;
    await drawn(() => { for (const release of world.ask.heldAborts.splice(0)) release(); });
    await drawnUntil(alpha, area, Voice.Machine, (state) => listening(state) && state.turn > state.sent && state.sent > 1);
    expect([world.ask.said, world.voice.spoken.slice(spokenBefore).map(({ text }) => text)]).toEqual([["Tell me a story", "What time is it"], ["It is noon."]]);
  });

  // spec/app/voice/index.md, "A heard turn waits for the send in hand, is sent once after it, and is given up quietly only after 30 s"
  it("sends a turn heard while a typed message is still reaching the agent once, after it, and gives one up quietly only after 30 s", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await talkingWithTextComposer(world);
    world.ask.holdAfterTools = true;
    await fill("Message Alpha", "Typed first");
    await press("Send");
    await settleComposer(alpha, () => world.ask.turns.size === 1);
    speakUtterance(world, "Spoken second");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Thinking" && state.sent === state.turn);
    for (let turn = 0; turn < 30; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    expect([world.ask.said, world.voice.spoken]).toEqual([["Typed first"], []]);

    await drawn(() => [...world.ask.turns.values()][0]?.());
    await drawnUntil(alpha, area, Voice.Machine, (state) => listening(state) && state.turn > state.sent && state.sent > 0);
    expect([world.ask.said, world.voice.spoken.map(({ text }) => text)]).toEqual([["Typed first", "Spoken second"], ["You said, Spoken second"]]);
    expect(world.ask.kept.get("c1")?.messages.filter(({ role }) => role === "user").map(({ text }) => text)).toEqual(["Typed first", "Spoken second"]);

    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Idle");
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, listening);
    world.ask.holdAfterTools = true;
    await fill("Message Alpha", "Typed again");
    await press("Send");
    await settleComposer(alpha, () => world.ask.turns.size === 1);
    speakUtterance(world, "Never sent");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Thinking");
    await drawn(() => advance(area, Voice.spokenTurnWaitMs - 1));
    expect((await area.runPromise(Effect.flatMap(Voice.Machine, (machine) => machine.get()))).phase).toBe("Thinking");
    await drawn(() => advance(area, 1));
    await drawnUntil(alpha, area, Voice.Machine, (state) => listening(state) && state.turn > state.sent);
    await drawn(() => [...world.ask.turns.values()][0]?.());
    await drawnUntil(alpha, area, Conversation, (state) => state.turn.reply === "Complete");
    for (let turn = 0; turn < 30; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    expect([world.ask.said.slice(2), world.voice.spoken.length, (await getToasts(area as unknown as VoiceRuntime)).issued, document.querySelector("[data-alpha-voice-said]")]).toEqual([["Typed again"], 1, 0, null]);
  });

  // spec/app/voice/index.md, "A heard turn waits for the send in hand, is sent once after it, and is given up quietly only after 30 s"
  it("sends a turn heard while a typed message waits for the conversation it asked for once, after the typed message", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await talkingWithTextComposer(world);
    world.ask.holdCreates = true;
    await fill("Message Alpha", "Typed first");
    await press("Send");
    await settleComposer(alpha, () => world.ask.heldCreates.length === 1);
    speakUtterance(world, "Spoken second");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Thinking" && state.sent === state.turn);
    for (let turn = 0; turn < 30; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    expect([world.ask.said, world.ask.heldCreates.length]).toEqual([[], 1]);

    world.ask.holdCreates = false;
    await drawn(() => { for (const release of world.ask.heldCreates.splice(0)) release(); });
    await drawnUntil(alpha, area, Voice.Machine, (state) => listening(state) && state.turn > state.sent && state.sent > 0);
    expect([world.ask.said, world.ask.opened, world.voice.spoken.map(({ text }) => text)]).toEqual([["Typed first", "Spoken second"], 1, ["You said, Spoken second"]]);
    expect(world.ask.kept.get("c1")?.messages.filter(({ role }) => role === "user").map(({ text }) => text)).toEqual(["Typed first", "Spoken second"]);
  });

  // spec/app/voice/index.md, "A heard turn waits for the send in hand, is sent once after it, and is given up quietly only after 30 s"; spec/app/assistant/index.md, "Stored attachments are posted with their message, and a message whose attachments could not be stored never left"
  it("sends a turn heard while a typed message's attachment is still being stored once, after the typed message, also when the owner spoke over Alpha and sent it before the interrupted turn let go", async () => {
    const memory = memoryIndexedDB();
    const storing = { held: false, waiting: [] as (() => void)[] };
    vi.stubGlobal("indexedDB", {
      open(name: string) {
        if (!storing.held) return memory.open(name);
        const outer: { result: unknown; error: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null; onupgradeneeded: (() => void) | null } =
          { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
        storing.waiting.push(() => {
          const inner = memory.open(name);
          inner.onupgradeneeded = () => { outer.result = inner.result; outer.onupgradeneeded?.(); };
          inner.onsuccess = () => { outer.result = inner.result; outer.onsuccess?.(); };
        });
        return outer;
      },
    });
    onTestFinished(() => { vi.unstubAllGlobals(); });
    const world = { ...scene(), phone: true, signedIn: false };
    world.ask.spokenFiles = [];
    world.files.texts["Documents/notes.txt"] = "Ten bytes.";
    const { alpha, area } = await onComposer(world, { at: "view:Files", load: () => import("../src/files/index.tsx") });
    const attachNotes = async () => {
      chatAction("Attach media");
      await expect.poll(() => document.querySelector('[aria-label="Attach files"]')).not.toBeNull();
      await drawn(() => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Attachment sources"] button')].find((item) => item.textContent === "Files")?.click());
      await expect.poll(() => button("Documents")).toBeDefined();
      await drawn(() => button("Documents")?.click());
      await expect.poll(() => button("notes.txt")?.disabled).toBe(false);
      await drawn(() => button("notes.txt")?.click());
      await expect.poll(() => button("Attach selected files")?.disabled).toBe(false);
      await drawn(() => button("Attach selected files")?.click());
      await drawnUntil(alpha, area, Composer, (state) => state.editor.files === 1);
    };
    await drawnUntil(alpha, area, Conversation, (state) => state.ready && state.observing);
    await drawnUntil(alpha, area, Composer, (state) => state.slot === "Open" && state.binding.owner > 0);
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.warmed);
    await fill("Message Alpha", "Opening a chat");
    await press("Send");
    await drawnUntil(alpha, area, Conversation, (state) => state.turn.send.id === 1 && state.turn.reply === "Complete");
    await drawnUntil(alpha, area, Composer, (state) => state.away === "Free" && state.binding.conversation > 0);
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, listening);
    await attachNotes();
    storing.held = true;
    await fill("Message Alpha", "Typed with a file");
    await press("Send");
    await settleComposer(alpha, () => storing.waiting.length > 0);
    speakUtterance(world, "Spoken after it");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Thinking" && state.sent === state.turn);
    for (let turn = 0; turn < 30; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    expect(world.ask.said).toEqual(["Opening a chat"]);

    storing.held = false;
    await drawn(() => { for (const release of storing.waiting.splice(0)) release(); });
    await drawnUntil(alpha, area, Voice.Machine, (state) => listening(state) && state.turn > state.sent && state.sent > 0);
    expect([world.ask.said, world.voice.spoken.map(({ text }) => text)]).toEqual([["Opening a chat", "Typed with a file", "Spoken after it"], ["You said, Spoken after it"]]);
    expect(world.ask.kept.get("c1")?.messages.filter(({ role }) => role === "user").map(({ text }) => text)).toEqual(["Opening a chat", "Typed with a file", "Spoken after it"]);
    expect(world.ask.spokenFiles?.map(({ images }) => images?.map((image) => (image as { name?: string }).name))).toEqual([undefined, ["notes.txt"], undefined]);

    await attachNotes();
    await interruptStory(world, alpha, area);
    world.ask.holdAfterTools = false;
    const spokenBefore = world.voice.spoken.length;
    speakUtterance(world, "What time is it");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Thinking" && state.sent === state.turn);
    storing.held = true;
    await fill("Message Alpha", "Second with a file");
    await press("Send");
    await settleComposer(alpha, () => storing.waiting.length > 0);
    world.ask.holdAborts = false;
    await drawn(() => { for (const release of world.ask.heldAborts.splice(0)) release(); });
    for (let turn = 0; turn < 30; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    expect(world.ask.said.slice(3)).toEqual(["Tell me a story"]);

    storing.held = false;
    await drawn(() => { for (const release of storing.waiting.splice(0)) release(); });
    await drawnUntil(alpha, area, Voice.Machine, (state) => listening(state) && state.turn > state.sent && world.ask.said.length === 6);
    expect([world.ask.said.slice(3), world.voice.spoken.slice(spokenBefore).map(({ text }) => text)]).toEqual([["Tell me a story", "Second with a file", "What time is it"], ["You said, What time is it"]]);
    expect(world.ask.spokenFiles?.slice(3).map(({ images }) => images?.map((image) => (image as { name?: string }).name))).toEqual([undefined, ["notes.txt"], undefined]);
  });

  // spec/app/voice/index.md, "A stop that could not be confirmed keeps voice closed until the microphone and speech are confirmed off"
  it("keeps voice closed when Alpha returns to the foreground while it is still asking whether the microphone is off", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await stoppedOnComposer(world, () => { world.voice.liveCaptureReleaseFails = true; });
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.latched);
    const slow = Promise.withResolvers<void>();
    world.voice.liveCaptureStopGate = () => slow.promise;
    const asked = world.voice.stopLiveCaptureCalls;
    await drawn(() => advance(area, Voice.releaseAgainMs));
    await untilCondition(area, () => world.voice.stopLiveCaptureCalls > asked);
    await seen(false);
    await seen(true);
    world.voice.liveCaptureStopGate = undefined;
    slow.resolve();
    await untilCondition(area, () => world.voice.stopLiveCaptureCalls > asked + 2);
    await drawn(() => advance(area, 0));
    expect([world.voice.activeMicSession === undefined, ...(await closedByStop(world, area))]).toEqual([false, true, false, undefined, 0]);
  });

  // spec/app/voice/index.md, "Stop shuts the conversation down, and a stop asked for the keyboard then hands it over"
  it("offers Talk again after a stop whose speaker volume could not be set back, and Talk listens once it can be", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await stoppedOnComposer(world, async (talking) => {
      await drawnUntil(talking.alpha, talking.area, Voice.Machine, (state) => state.speaker === "SpeakerOn");
      await press("Mute speaker");
      await drawnUntil(talking.alpha, talking.area, Voice.Machine, (state) => state.speaker === "SpeakerOff");
      world.voice.speakerGainGate = (muted) => muted ? Promise.resolve() : Promise.reject(new Error("Output gain unavailable"));
    });
    expect([world.voice.speakerMuted, (await getVoice(area)).latched, button("Talk")?.disabled]).toEqual([true, false, false]);
    world.voice.speakerGainGate = undefined;
    await talksAgain(world, alpha, area);
  });

  // spec/app/voice/index.md, "A stop that could not be confirmed keeps voice closed until the microphone and speech are confirmed off"
  it("never stops a reading the owner started while voice was closed by a speech stop, and offers Talk again once that stop is confirmed", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await stoppedOnComposer(world, () => { world.voice.playbackStopFails = true; });
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.latched);
    world.voice.playbackStopFails = false;
    const read = Promise.withResolvers<void>();
    world.voice.playbackHold = () => read.promise;
    const reading = area.runPromise(Effect.flatMap(VoiceBridge, (bridge) => Stream.runCollect(bridge.readAloud(1, "A page read aloud."))));
    await untilCondition(area, () => world.voice.played.some((one) => one.text === "A page read aloud."));
    const stops = world.voice.playbackStops.length;
    await drawn(() => advance(area, Voice.releaseAgainMs));
    expect([world.voice.playbackStops.slice(stops), ...(await closedByStop(world, area))]).toEqual([[], true, false, undefined, 0]);

    world.voice.playbackHold = undefined;
    read.resolve();
    await reading;
    await drawn(() => advance(area, Voice.againAfter(Voice.releaseAgainMs)));
    await drawnUntil(alpha, area, Voice.Machine, (state) => !state.latched);
    expect(world.voice.playbackStops.slice(stops)).toEqual([undefined]);
    await talksAgain(world, alpha, area);
  });

  // spec/app/voice/index.md, "Stop shuts the conversation down, and a stop asked for the keyboard then hands it over"
  it("offers Talk again after a stop the relay rejected while it was starting a session it then refused, and keeps voice closed for one it opened", async () => {
    const { world, alpha, area } = await openCloudVoiceSheet(false);
    const starting = Promise.withResolvers<void>();
    world.voice.cloudStartGate = () => starting.promise;
    world.voice.cloudStopFails = true;
    const starts = world.voice.startCloudSpeechCalls;
    await press("Talk");
    await untilCondition(area, () => world.voice.startCloudSpeechCalls > starts);
    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Idle" && state.latched);
    starting.reject(rejection("Cloud speech could not connect", "connect"));
    world.voice.cloudStartGate = undefined;
    await drawn(() => advance(area, Voice.releaseAgainMs));
    await drawnUntil(alpha, area, Voice.Machine, (state) => !state.latched);

    world.voice.cloudStopFails = false;
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (state) => listening(state) && state.network);
    world.voice.cloudStopFails = true;
    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Idle" && state.latched);
    await drawn(() => advance(area, Voice.releaseAgainMs));
    expect([(await getVoice(area)).latched, button("Talk")]).toEqual([true, undefined]);
  });

  it("keeps the speaker control hidden when the live bridge refuses gain (spec/app/voice/index.md, \"Speaker mute is offered after the current speech bridge confirms gain control\")", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    world.voice.speakerGainGate = () => Promise.reject(new Error("Output gain unavailable"));
    const { alpha, area } = await onComposer(world);
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.warmed);
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.speaker === "SpeakerUnavailable");
    expect(button("Mute speaker")).toBeUndefined();
    expect(button("Mute microphone")).toBeDefined();
    expect(world.voice.activeMicSession).toBeDefined();
  });

  it("keeps the resting Talk control visible but unavailable on a browser without speech", async () => {
    const world = scene();
    const { alpha } = await open(world, talkMounts);
    await drawnUntil(alpha, assistant.runtime(alpha), Voice.Machine, (state) => state.warmed);
    const talk = button("Talk");
    expect(talk?.disabled).toBe(true);
    await drawn(() => talk?.click());
    expect([world.voice.startLiveCaptureCalls, world.voice.startCloudSpeechCalls]).toEqual([0, 0]);
  });

  async function openCloudVoiceSheet(waitWarmup = false) {
    const world = { ...scene(), phone: true };
    world.voice.onDevice = false;
    world.voice.credentialId = "cred-owner-9";
    const { alpha, area } = await onComposer(world);
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.route.account === "CloudAccount" && s.route.consent && s.warmed);
    if (waitWarmup) await settleComposer(alpha, () => world.voice.relayWarmups.length === 1);
    await drawnUntil(alpha, area, Conversation, (s) => s.ready && s.observing && s.context.revision > 0);
    await drawnUntil(alpha, area, Composer, (state) => state.slot === "Open");
    await raiseSheet(alpha);
    return { world, alpha, area };
  }

  // spec/app/voice/index.md, "Starting asks for the microphone the first time, opens it once it is allowed, and holds the speech engine while talking"; spec/app/voice/index.md, "Signing in, out or to another account changes the route, invalidates warmup, and ends a running conversation"; spec/app/voice/index.md, "Stop shuts the conversation down, and a stop asked for the keyboard then hands it over"; spec/app/assistant/dock.md, "While voice owns Ask Alpha nothing drags it, a drag under way is let go, and it is dragged again once voice ends"
  it("a signed-in owner taps Talk and talks over the relay under the account's key, Stop ends it, and after signing in to another account the first Talk speaks under the new key", async () => {
    const { world, alpha, area } = await openCloudVoiceSheet(true);

    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.network);
    await drawnUntil(alpha, area, Dock, (s) => s.voice);
    expect([world.voice.cloudStarts, world.voice.activeMicSession !== undefined, button("Talk")]).toEqual([
      [{ environment: "production", credentialId: "cred-owner-9" }], true, undefined,
    ]);

    // spec/app/voice/index.md, "What the owner says is shown as it is heard"
    const preview = () => document.querySelector('[aria-label="Heard so far, not sent"]')?.textContent;
    const sessionId = world.voice.activeMicSession;
    await drawn(() => {
      world.voice.emitCloud?.({ type: "speech-start", sessionId });
      world.voice.emitCloud?.({ type: "transcript", sessionId, text: "Looking up my calendar", final: false });
    });
    await settleComposer(alpha, () => preview() === "Looking up my calendar");
    expect(world.ask.said).toEqual([]);
    await press("Mute microphone");
    await settleComposer(alpha, () => preview() === undefined);
    await drawn(() => {
      world.voice.emitCloud?.({ type: "transcript", sessionId, text: "A retired capture", final: false });
      world.voice.emitCloud?.({ type: "speech-end", sessionId, text: "" });
    });
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.muted && state.mic === "Off");
    expect(preview()).toBeUndefined();

    // spec/app/voice/index.md, "Mute turns the microphone off, and unmuting opens it again only where Alpha listens"; spec/app/voice/index.md, "When the whole reply has been heard, Alpha listens for the next turn"
    await press("Unmute microphone");
    await drawnUntil(alpha, area, Voice.Machine, (state) => !state.muted && state.phase === "Listening" && state.mic === "On");
    expect(world.voice.activeMicSession).toBe(sessionId);
    const words = ["What is on my calendar?", "And tomorrow?"];
    for (const [index, text] of words.entries()) {
      await drawn(() => {
        world.voice.emitCloud?.({ type: "speech-start", sessionId });
        world.voice.emitCloud?.({ type: "speech-end", sessionId, text });
      });
      await later(alpha, CLOUD_TURN_GAP_MS);
      await drawnUntil(alpha, area, Voice.Machine, (state) =>
        state.sent === index + 1 && state.turn === index + 2 && state.phase === "Listening" && state.mic === "On");
    }
    expect(world.ask.said).toEqual(words);
    expect([world.voice.activeMicSession, world.voice.startCloudSpeechCalls]).toEqual([sessionId, 1]);

    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Idle" && s.mic === "Off");
    await drawnUntil(alpha, area, Dock, (s) => !s.voice);
    expect([world.voice.activeMicSession, world.voice.stopCloudSpeechCalls > 0, button("Talk") !== undefined]).toEqual([undefined, true, true]);

    world.voice.credentialId = "cred-owner-10";
    const before = (await area.runPromise(Effect.flatMap(Voice.Machine, (m) => m.get()))).route.key;
    await drawn(() => world.voice.signedInHere?.());
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.route.key !== before && s.route.consent && s.warmed);
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.network);
    expect(world.voice.cloudStarts.map((one) => one.credentialId)).toEqual(["cred-owner-9", "cred-owner-10"]);
    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Idle");

    world.signedIn = false;
    await seen(false);
    await seen(true);
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.route.account === "SignedOut" && !s.route.consent);
  });

  // spec/app/voice/index.md, "What the owner said shows at once as their message, with Alpha's working dots and then its reply under it, until the conversation records it"; spec/app/voice/index.md, "Mute turns the microphone off, and unmuting opens it again only where Alpha listens"; spec/app/voice/index.md, "Speaker mute is offered after the current speech bridge confirms gain control"
  it("draws a Talk turn as the Sunday demo build did: the speaker dimmed while connecting, what was said with working dots at once, and the relay microphone really closed, and shown paused, while Alpha answers", async () => {
    const { world, alpha, area } = await openCloudVoiceSheet(false);

    const connected = Promise.withResolvers<void>();
    world.voice.cloudStartGate = () => connected.promise;
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Starting");
    const row = () => [...document.querySelectorAll<HTMLButtonElement>('section[aria-label="Voice conversation"] button')]
      .map((control) => `${control.getAttribute("aria-label")}${control.disabled ? " (dimmed)" : ""}`);
    expect(row()).toEqual(["Mute speaker (dimmed)", "Microphone status unconfirmed (dimmed)", "Stop voice conversation"]);
    connected.resolve();
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.speaker === "SpeakerOn");
    expect(row()).toEqual(["Mute speaker", "Mute microphone", "Stop voice conversation"]);

    const said = () => document.querySelector("[data-alpha-voice-said]")?.textContent;
    const dots = () => document.querySelector('[role="status"][aria-label="Sending"]');
    const asked = "What is on my calendar?";
    const recorded = () => [...document.querySelectorAll("[data-alpha-message-id]")].filter((one) => one.textContent?.includes(asked)).length;
    const done = Promise.withResolvers<void>();
    world.ask.holdAfterTools = true;
    world.ask.nextReplyChunks = ["Nothing is on your calendar today."];
    world.ask.holdDoneAfterReady = done.promise;
    // spec/app/assistant/chats.md, "A conversation made new here shows what it holds while its page is read": what was said and the dots stay in place, never loading rows, while the page of the conversation made for the first turn is read.
    world.ask.holdPages = true;
    const loadingRows = () => document.querySelector("section[aria-label='Ask Alpha'] [role=log] [aria-busy]");
    const sessionId = world.voice.activeMicSession;
    await drawn(() => {
      world.voice.emitCloud?.({ type: "speech-start", sessionId });
      world.voice.emitCloud?.({ type: "speech-end", sessionId, text: asked });
    });
    await later(alpha, CLOUD_TURN_GAP_MS);
    const mic = async () => {
      const control = button(/^(Mute microphone|Microphone paused while Alpha responds)$/);
      return { closed: (await area.runPromise(Effect.flatMap(Voice.Machine, (m) => m.get()))).mic !== "On", pressed: control?.getAttribute("aria-pressed") };
    };
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Thinking" && s.sent === 1);
    await settleComposer(alpha, () => world.ask.turns.size === 1);
    await drawnUntil(alpha, area, Chats, (s) => s.chosen > 0 && s.page.status === "Loading");
    expect([said(), dots() !== null, recorded(), loadingRows()]).toEqual([asked, true, 0, null]);
    world.ask.holdPages = false;
    for (const release of world.ask.heldPages.splice(0)) release();
    await drawnUntil(alpha, area, Chats, (s) => s.page.status === "Loaded");
    expect([said(), dots() !== null, recorded()]).toEqual([asked, true, 0]);
    expect(row()).toEqual(["Mute speaker", "Microphone paused while Alpha responds (dimmed)", "Stop voice conversation"]);

    expect(await mic()).toEqual({ closed: true, pressed: "true" });

    // spec/app/voice/index.md, "Story: Hold a spoken conversation": The relay keeps the microphone closed through the whole reply, as v119 held it, so paused is true there.
    await drawn(() => [...world.ask.turns.values()][0]?.());
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Speaking" && s.network);
    for (let turn = 0; turn < 15; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    // spec/app/voice/index.md, "What the owner said shows at once as their message, with Alpha's working dots and then its reply under it, until the conversation records it": once Alpha speaks, its reply's text has taken the dots' place, before the conversation records it (v119 45f6bed30 agent-adapter.ts:2253-2254).
    const replying = () => document.querySelector("[data-alpha-voice-reply]")?.textContent;
    expect([said(), dots() !== null, replying(), recorded()]).toEqual([asked, false, "Nothing is on your calendar today.", 0]);
    expect(row()).toEqual(["Mute speaker", "Microphone paused while Alpha responds (dimmed)", "Stop voice conversation"]);
    expect([await mic(), (await area.runPromise(Effect.flatMap(Voice.Machine, (m) => m.get()))).mic]).toEqual([{ closed: true, pressed: "true" }, "Off"]);

    done.resolve();
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.turn === 2 && s.mic === "On");
    await settleComposer(alpha, () => recorded() === 1);
    expect([said(), dots(), replying(), world.ask.said]).toEqual([undefined, null, undefined, [asked]]);
    expect(row()).toEqual(["Mute speaker", "Mute microphone", "Stop voice conversation"]);

    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Idle");
  });

  // spec/app/voice/index.md, "What the owner said shows at once as their message, with Alpha's working dots and then its reply under it, until the conversation records it"; spec/app/assistant/reply.md, "A spoken acknowledgment starts at once; a reply ready before it is audible drops it, and an audible one finishes before the reply, within 2.5 s"
  it("keeps the working dots while Alpha says its acknowledgment, which is only spoken, then shows the reply it says in their place, before the conversation records them", async () => {
    const { world, alpha, area } = await openCloudVoiceSheet(false);
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.network);
    const done = Promise.withResolvers<void>();
    world.ask.acknowledgment = "Let me check your calendar.";
    world.ask.holdAfterTools = true;
    world.ask.nextReplyChunks = ["Nothing is on your calendar today."];
    world.ask.holdDoneAfterReady = done.promise;
    const sessionId = world.voice.activeMicSession;
    await drawn(() => {
      world.voice.emitCloud?.({ type: "speech-start", sessionId });
      world.voice.emitCloud?.({ type: "speech-end", sessionId, text: "What is on my calendar?" });
    });
    await later(alpha, CLOUD_TURN_GAP_MS);
    const tail = () => ({
      dots: document.querySelector('[role="status"][aria-label="Sending"]') !== null,
      written: document.body.textContent?.includes("Let me check your calendar.") ?? false,
      reply: document.querySelector("[data-alpha-voice-reply]")?.textContent,
    });
    await settleComposer(alpha, () => world.voice.spoken.length === 1);
    for (let turn = 0; turn < 15; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    // spec/app/voice/index.md, "What the owner said shows at once as their message, with Alpha's working dots and then its reply under it, until the conversation records it": v119 45f6bed30 voice-adapter.ts:778 only spoke the acknowledgment in Talk, and model.js:6443 kept the dots until reply text came.
    expect([world.voice.spoken.map((one) => one.text), tail()]).toEqual([["Let me check your calendar."], { dots: true, written: false, reply: undefined }]);
    await drawn(() => [...world.ask.turns.values()][0]?.());
    await settleComposer(alpha, () => tail().reply !== undefined);
    expect(tail()).toEqual({ dots: false, written: false, reply: "Nothing is on your calendar today." });
    done.resolve();
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.turn === 2 && s.mic === "On");
    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Idle");
  });

  // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically"; spec/app/voice/index.md, "What the owner says is shown as it is heard"
  it("over the Cloud relay, a pause inside a sentence keeps it one turn, as v119's long gap did, and a finished sentence is sent once the gap passes", async () => {
    const { world, alpha, area } = await openCloudVoiceSheet(false);
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.network);
    const sessionId = world.voice.activeMicSession;
    const preview = () => document.querySelector('[aria-label="Heard so far, not sent"]')?.textContent;
    const state = () => area.runPromise(Effect.flatMap(Voice.Machine, (m) => m.get()));
    const heard = (text: string) => drawn(() => {
      world.voice.emitCloud?.({ type: "speech-start", sessionId });
      world.voice.emitCloud?.({ type: "speech-end", sessionId, text });
    });

    // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically": the demo's D07 take, where the relay ends its turn at the pause after the checklist's name and the owner goes on.
    const name = "Make a checklist called shoot day checklist.";
    const items = "Pixel, pack the tripod plate, bring the blue notebook.";
    await heard(name);
    await later(alpha, CLOUD_TURN_GAP_MS - 100);
    await settleComposer(alpha, () => preview() === name);
    expect([(await state()).sent, (await state()).phase, (await state()).mic, world.ask.said]).toEqual([0, "Listening", "On", []]);
    await heard(items);
    await later(alpha, CLOUD_TURN_GAP_MS - 100);
    expect([(await state()).sent, world.ask.said]).toEqual([0, []]);
    await later(alpha, 100);
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.sent === 1 && s.turn === 2 && s.phase === "Listening" && s.mic === "On");
    expect(world.ask.said).toEqual([`${name} ${items}`]);

    // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically": a finished sentence is sent once the gap passes, and not before.
    const asked = "What is on my calendar tomorrow?";
    await heard(asked);
    await later(alpha, CLOUD_TURN_GAP_MS - 1);
    expect([(await state()).sent, world.ask.said.length]).toEqual([1, 1]);
    await later(alpha, 1);
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.sent === 2 && s.turn === 3 && s.phase === "Listening");
    expect(world.ask.said).toEqual([`${name} ${items}`, asked]);

    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Idle");
  });

  async function startCloudTalk() {
    const opened = await openCloudVoiceSheet(false);
    await press("Talk");
    await drawnUntil(opened.alpha, opened.area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.network);
    const sessionId = opened.world.voice.activeMicSession;
    const state = () => opened.area.runPromise(Effect.flatMap(Voice.Machine, (m) => m.get()));
    const heard = (text: string) => drawn(() => {
      opened.world.voice.emitCloud?.({ type: "speech-start", sessionId });
      opened.world.voice.emitCloud?.({ type: "speech-end", sessionId, text });
    });
    return { ...opened, sessionId, state, heard };
  }

  // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically"
  it("over the Cloud relay, speech that starts again within the gap holds the turn open until its own words end, then sends both as one turn", async () => {
    const { world, alpha, area, sessionId, state, heard } = await startCloudTalk();
    const name = "Make a checklist called shoot day checklist.";
    const items = "Pixel, pack the tripod plate, bring the blue notebook.";
    await heard(name);
    await later(alpha, CLOUD_TURN_GAP_MS - 200);
    // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically": the owner goes on before the gap ends, and is still speaking long after it would have ended; v119 cleared its timers on new speech (voice-assistant-session.ts:827-830).
    await drawn(() => world.voice.emitCloud?.({ type: "speech-start", sessionId }));
    await later(alpha, 2000);
    expect([(await state()).sent, (await state()).phase, world.ask.said]).toEqual([0, "Listening", []]);
    await finishJoinedCloudTurn(alpha, area, world, sessionId, `${name} ${items}`, items);
  });

  async function muteThenUnmute(
    alpha: Awaited<ReturnType<typeof startCloudTalk>>["alpha"],
    area: Awaited<ReturnType<typeof startCloudTalk>>["area"],
    targetMic: "On" | "Opening" = "On",
  ) {
    await later(alpha, 100);
    await press("Mute microphone");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.muted && s.mic === "Off");
    await press("Unmute microphone");
    await drawnUntil(alpha, area, Voice.Machine, (s) => !s.muted && s.mic === targetMic);
  }

  async function expectSentOnceWhileMuted(
    alpha: Awaited<ReturnType<typeof startCloudTalk>>["alpha"],
    area: Awaited<ReturnType<typeof startCloudTalk>>["area"],
    world: Awaited<ReturnType<typeof startCloudTalk>>["world"],
    state: Awaited<ReturnType<typeof startCloudTalk>>["state"],
    asked: string,
    afterSent: () => void = () => {},
  ) {
    expect([(await state()).sent, world.ask.said]).toEqual([0, []]);
    await later(alpha, CLOUD_TURN_GAP_MS);
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.sent === 1 && s.muted && s.mic === "Off" && s.phase === "Listening");
    expect(world.ask.said).toEqual([asked]);
    await drawn(afterSent);
    await later(alpha, 2000);
    expect([(await state()).sent, world.ask.said]).toEqual([1, [asked]]);
    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Idle");
  }

  // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically"; spec/app/voice/index.md, "Mute turns the microphone off, and unmuting opens it again only where Alpha listens"
  it("over the Cloud relay, Mute within the gap shuts the microphone at once and still sends the finished sentence when the gap ends, as v119 did", async () => {
    const { world, alpha, area, state, heard } = await startCloudTalk();
    const asked = "What is on my calendar tomorrow?";
    await heard(asked);
    await later(alpha, 200);
    await press("Mute microphone");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.muted && s.mic === "Off");
    // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically": v119 setMuted closed the capture, then still sent the utterance at its long gap (voice-assistant-session.ts:596-611).
    await expectSentOnceWhileMuted(alpha, area, world, state, asked);
  });

  async function finishJoinedCloudTurn(
    alpha: Awaited<ReturnType<typeof startCloudTalk>>["alpha"],
    area: Awaited<ReturnType<typeof startCloudTalk>>["area"],
    world: Awaited<ReturnType<typeof startCloudTalk>>["world"],
    sessionId: Awaited<ReturnType<typeof startCloudTalk>>["sessionId"],
    expected: string,
    items: string,
  ) {
    await drawn(() => world.voice.emitCloud?.({ type: "speech-end", sessionId, text: items }));
    await later(alpha, CLOUD_TURN_GAP_MS);
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.sent === 1 && s.turn === 2 && s.phase === "Listening");
    expect(world.ask.said).toEqual([expected]);
    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Idle");
  }

  // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically"; spec/app/voice/index.md, "Mute turns the microphone off, and unmuting opens it again only where Alpha listens"
  it("over the Cloud relay, Mute and then Unmute within the gap keep the finished sentence, and it is sent once when the gap ends, as v119 did", async () => {
    const { world, alpha, area, state, heard } = await startCloudTalk();
    const asked = "What is on my calendar tomorrow?";
    await heard(asked);
    await later(alpha, 100);
    await press("Mute microphone");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.muted && s.mic === "Off");
    await later(alpha, 50);
    // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically": v119 kept the utterance and its timer across the capture Unmute opened (voice-assistant-session.ts:612-622 and 722-735).
    await press("Unmute microphone");
    await drawnUntil(alpha, area, Voice.Machine, (s) => !s.muted && s.mic === "On");
    expect([(await state()).sent, world.ask.said]).toEqual([0, []]);
    await later(alpha, CLOUD_TURN_GAP_MS - 150);
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.sent === 1 && s.turn === 2 && s.phase === "Listening" && s.mic === "On" && !s.muted);
    expect(world.ask.said).toEqual([asked]);
    await later(alpha, 2000);
    expect([(await state()).sent, world.ask.said]).toEqual([1, [asked]]);

    // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically": a gap that ends while the reopened microphone is still opening ends the turn as soon as it is open.
    const next = "And the day after?";
    let opens = () => {};
    world.voice.cloudUnmuteGate = () => new Promise<void>((resolve) => { opens = resolve; });
    await heard(next);
    await muteThenUnmute(alpha, area, "Opening");
    await later(alpha, CLOUD_TURN_GAP_MS);
    expect([(await state()).sent, (await state()).mic, world.ask.said]).toEqual([1, "Opening", [asked]]);
    await drawn(() => opens());
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.sent === 2 && s.turn === 3 && s.phase === "Listening");
    expect(world.ask.said).toEqual([asked, next]);

    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Idle");
  });

  // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically"; spec/app/voice/index.md, "Mute turns the microphone off, and unmuting opens it again only where Alpha listens"
  it("over the Cloud relay, Mute pressed again while the microphone Unmute reopened within the gap is still opening keeps the finished sentence, and it is sent once when the gap ends, as v119 did", async () => {
    const { world, alpha, area, state, heard } = await startCloudTalk();
    const asked = "What is on my calendar tomorrow?";
    let opens = () => {};
    world.voice.cloudUnmuteGate = () => new Promise<void>((resolve) => { opens = resolve; });
    await heard(asked);
    await muteThenUnmute(alpha, area, "Opening");
    // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically": v119's Mute kept the utterance whether or not its capture had opened (voice-assistant-session.ts:593-622).
    await press("Mute microphone");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.muted && s.mic === "Off");
    await expectSentOnceWhileMuted(alpha, area, world, state, asked, () => opens());
  });

  // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically"; spec/app/voice/index.md, "Mute turns the microphone off, and unmuting opens it again only where Alpha listens"
  it("over the Cloud relay, speech on the microphone Unmute reopened within the gap joins the words held for it, and both are sent as one turn", async () => {
    const { world, alpha, area, sessionId, state, heard } = await startCloudTalk();
    const name = "Make a checklist called shoot day checklist.";
    const items = "Pixel, pack the tripod plate, bring the blue notebook.";
    await heard(name);
    await muteThenUnmute(alpha, area, "On");
    await later(alpha, 100);
    // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically": speech before the gap ends holds it open, as v119 cleared its timers on new speech (voice-assistant-session.ts:827-830).
    await drawn(() => world.voice.emitCloud?.({ type: "speech-start", sessionId }));
    await later(alpha, 1000);
    expect([(await state()).sent, world.ask.said]).toEqual([0, []]);
    await finishJoinedCloudTurn(alpha, area, world, sessionId, `${name} ${items}`, items);
  });

  // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically"; spec/app/voice/index.md, "Mute turns the microphone off, and unmuting opens it again only where Alpha listens"
  it("over the Cloud relay, Mute pressed while the owner is still speaking keeps what they said, and sends it once when the gap after its final ends, as v119 did", async () => {
    const { world, alpha, area, sessionId, state } = await startCloudTalk();
    const asked = "What is on my calendar tomorrow?";
    await drawn(() => world.voice.emitCloud?.({ type: "speech-start", sessionId }));
    await later(alpha, 300);
    // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically": v119's Mute finalized the speech up to then and sent it (voice-assistant-session.ts:593-611); the relay gives its final as the microphone shuts.
    await press("Mute microphone");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.muted && s.mic === "Closing");
    await drawn(() => world.voice.emitCloud?.({ type: "speech-end", sessionId, text: asked }));
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.muted && s.mic === "Off");
    await expectSentOnceWhileMuted(alpha, area, world, state, asked);
  });

  // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically"; spec/app/voice/index.md, "Stop shuts the conversation down, and a stop asked for the keyboard then hands it over"
  it("over the Cloud relay, Stop within the gap sends nothing, as v119's stop dropped an utterance not yet sent", async () => {
    const { world, alpha, area } = await openCloudVoiceSheet(false);
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.network);
    const sessionId = world.voice.activeMicSession;
    const state = () => area.runPromise(Effect.flatMap(Voice.Machine, (m) => m.get()));
    await drawn(() => {
      world.voice.emitCloud?.({ type: "speech-start", sessionId });
      world.voice.emitCloud?.({ type: "speech-end", sessionId, text: "What is on my calendar tomorrow?" });
    });
    await later(alpha, 200);
    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Idle");
    await later(alpha, 2000);
    expect([(await state()).sent, (await state()).phase, world.ask.said, document.querySelector("[data-alpha-voice-said]")]).toEqual([0, "Idle", [], null]);
  });

  // spec/app/voice/index.md, "Mute turns the microphone off, and unmuting opens it again only where Alpha listens"
  it("lets the owner shut the microphone the phone's recognizer keeps open while Alpha speaks, without ending Talk or the reply", async () => {
    const { world, alpha, area } = await openPhoneTalk(true);
    world.ask.acknowledgment = "Checking.";
    world.ask.holdAfterTools = true;
    world.ask.nextReplyChunks = ["Nothing is on your calendar today."];
    speakUtterance(world, "What is on my calendar?");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Speaking" && !s.network && s.mic === "On");
    expect(button("Mute microphone")?.getAttribute("aria-pressed")).toBe("false");

    await press("Mute microphone");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.muted && s.mic !== "On" && s.mic !== "Opening");
    const state = await area.runPromise(Effect.flatMap(Voice.Machine, (m) => m.get()));
    expect([state.phase, button("Unmute microphone")?.getAttribute("aria-pressed")]).toEqual(["Speaking", "true"]);
    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Idle");
  });

  const openPhoneTalk = async (talking: boolean) => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await onComposer(world);
    await drawnUntil(alpha, area, Conversation, (s) => s.ready && s.observing);
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.warmed);
    if (talking) {
      await press("Talk");
      await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On");
    }
    return { world, alpha, area };
  };

  // spec/app/assistant/context.md, "A spoken turn carries what a typed turn sent at that moment would, the view claim included"
  it("a spoken turn tells the agent the same screen a typed turn sent at that moment does, location and view claim included", async () => {
    const { world, alpha, area } = await openPhoneTalk(false);
    world.ask.metadata = [];

    await fill("Message Alpha", "What is on my screen?");
    await press("Send");
    await drawnUntil(alpha, area, Conversation, (s) => s.turn.send.id === 1 && s.turn.reply === "Complete");
    await drawnUntil(alpha, area, Locator, (s) => s.gpsAt >= 0);
    await fill("Message Alpha", "And now?");
    await press("Send");
    await drawnUntil(alpha, area, Conversation, (s) => s.turn.send.id === 2 && s.turn.reply === "Complete");
    const typed = world.ask.metadata.at(-1);
    expect(typed).toMatchObject({ observation: { view: "home", sensitive: false, location: { latitude: 43.73, longitude: 7.42 } }, viewDelivery: "completed-action" });

    // spec/app/assistant/dock.md, "Sending from the bar opens the sheet, where the reply shows"
    await drawnUntil(alpha, area, Shell.Machine, (s) => s.assistant === "Sheet");
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On");
    await drawn(() => vi.waitFor(() => expect([...world.platform.listening].some(({ topic }) => topic === "voice")).toBe(true)));
    const seenInterim = () => document.querySelector("[data-alpha-voice-interim]")?.textContent;
    const capture = world.voice.activeMicSession;
    const say = (sessionId: string | undefined, phase: string, extra = {}) => publish(world.platform, "voice", {
      type: "agent_event", stream: "voice-transcript",
      payload: { type: "voice-transcript", sessionId, turnId: "spoken-now", phase, ...extra },
    });
    const previousPosts = world.ask.said.length;
    await drawn(() => {
      say(capture, "speech-start");
      say(capture, "partial", { seq: 1, text: "And then" });
      say(capture, "partial", { seq: 1, text: "Duplicate partial" });
      say("an-earlier-capture", "partial", { seq: 2, text: "Outside the capture" });
    });
    await drawn(() => vi.waitFor(() => expect(seenInterim()).toBe("And then")));
    expect(world.ask.said).toHaveLength(previousPosts);
    speakUtterance(world, "And now?");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.sent === 1 && s.phase === "Listening");
    expect(seenInterim()).toBeUndefined();
    expect([world.ask.said.at(-1), world.ask.metadata.length, world.ask.metadata.at(-1)]).toEqual(["And now?", 3, typed]);
    // spec/app/voice/index.md, "Talk keeps what it sends in the selected Ask Alpha conversation"
    expect(world.ask.opened).toBe(1);
    expect(world.ask.kept.get("c1")?.messages.slice(-2).map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "user", text: "And now?" },
      { role: "assistant", text: "You said: And now?" },
    ]);

    // spec/app/voice/index.md, "An active voice conversation may ask the shell to open Home or any admitted screen"
    const shellState = () => alpha.runtime.runSync(Shell.Machine.use((machine) => machine.get()));
    const preparedFor = (view: string) => (metadata: unknown) => [
      prepared(String((metadata as { viewClientId?: unknown }).viewClientId), view, false),
    ];
    const client = (typed as { viewClientId: string }).viewClientId;
    const binding = (viewId: string) => ({ requestId: `request-${viewId}`, clientId: client, viewId, viewType: "gui", installationId: "alpha" });
    world.ask.nextReplyChunks = ["Opening Calendar."];
    world.ask.nextActions = preparedFor("calendar");
    speakUtterance(world, "Open my calendar");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.sent === 2 && s.phase === "Listening" && s.mic === "On");
    expect(shellState().trail).toEqual(["Calendar"]);
    expect(world.notes.views).toEqual([
      { path: "claim", body: binding("calendar") },
      { path: "result", body: { ...binding("calendar"), claimId: "claim-1", success: true, result: { switched: true } } },
    ]);

    // spec/app/voice/index.md, "Voice keeps talking after a navigation only when it is the one the conversation asked for; any other ends it"
    const gate = Promise.withResolvers<void>();
    world.notes.viewClaimGate = gate.promise;
    try {
      await drawnUntil(alpha, area, Conversation, (s) => s.observing && s.context.showing.tag === "App" && s.context.showing.view === "Calendar");
      world.ask.nextReplyChunks = ["Opening Notes."];
      world.ask.nextActions = preparedFor("notes");
      speakUtterance(world, "Open Notes");
      await drawn(() => vi.waitFor(() => expect(world.notes.views.at(-1)).toEqual({ path: "claim", body: binding("notes") }), { timeout: 10_000 }));
      await drawn(() => alpha.runtime.runPromise(Shell.Machine.use((machine) => machine.send({ type: "openView", view: "Notes" }))));
      await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Idle");
    } finally {
      gate.resolve();
    }
    await drawn(() => vi.waitFor(() => expect(world.notes.views.at(-1)).toEqual({
      path: "result", body: { ...binding("notes"), claimId: "claim-3", success: false, result: { switched: false } },
    }), { timeout: 10_000 }));
    expect(shellState()).toMatchObject({ trail: ["Calendar", "Notes"], assistant: "Bar" });
  });

  async function openMessagesTalk(world: ReturnType<typeof scene>, extraMounts: readonly Mount[] = []) {
    world.ask.metadata = [];
    const { alpha, area } = await onComposer(world, { at: "view:Messages", load: () => import("../src/messages/index.tsx") }, ...extraMounts);
    await drawnUntil(alpha, area, Conversation, (state) => state.ready && state.observing);
    await drawnUntil(alpha, alpha.runtime, Preferences, (state) => state.document.read.status === "Loaded" && !state.askFirst);
    await fill("Message Alpha", "Start this chat");
    await press("Send");
    await drawnUntil(alpha, area, Conversation, (state) => state.turn.reply === "Complete");
    await drawnUntil(alpha, area, Chats, (state) => state.chosen > 0 && state.page.status === "Loaded");
    await drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell.Machine, (machine) => machine.send({ type: "openView", view: "Messages" }))));
    await drawnUntil(alpha, alpha.runtime, Messages, (state) => state.front && state.sms.grant === "Granted" && state.list.status === "Loaded");
    await drawnUntil(alpha, alpha.runtime, Phone, (state) => state.telecom === "NoCall");
    await raiseSheet(alpha);
    await drawnUntil(alpha, area, Conversation, (state) => state.context.showing.tag === "App" && state.context.showing.view === "Messages");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.warmed);
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Listening" && state.mic === "On");
    return { alpha, area };
  }

  /** Talk listening over a Messages chat with SIM 1 chosen, and the agent's text proposal from `sim` waiting to be named. */
  async function talkOnMessages(sim = 1, extra: { readonly extraCapabilities?: readonly string[]; readonly mounts?: readonly Mount[] } = {}) {
    const world = { ...scene(), phone: true, image: true, signedIn: false };
    const operation = { type: "sms_send", recipients: ["+14155550100"], body: "Meet upstairs.\nBring the keys.", subscriptionId: sim } as const;
    const review = textReview(world.notes.owner, "spoken-reviewed-sms", operation);
    review.extraCapabilities.push(...(extra.extraCapabilities ?? []));
    world.telephony.textReview = review;
    const { alpha, area } = await openMessagesTalk(world, extra.mounts);
    const room = [...world.ask.kept.values()].find((one) => one.messages.some((line) => line.text === "Start this chat"));
    if (room === undefined) throw new Error("The visible chat was not saved");
    return { world, operation, review, alpha, area, room };
  }

  function watchReviewPending(area: Awaited<ReturnType<typeof onComposer>>["area"]) {
    const observedReviewPending: boolean[] = [];
    const watch = area.runFork(
      Stream.runForEach(
        Stream.unwrap(Effect.map(Voice.Machine, (machine) => machine.changes)),
        (state) => Effect.sync(() => { observedReviewPending.push(state.reviewPending); }),
      ),
    );
    return { observedReviewPending, stopWatch: () => area.runPromise(Fiber.interrupt(watch)) };
  }

  const kept = (proposalId: string) => ({ action: "PROPOSE_DEVICE_ACTION", data: { proposalId, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true } });

  const proposeText = (review: ReturnType<typeof textReview>) => () => [kept(review.proposal.id)];

  // spec/app/voice/index.md, "A reply that needs the owner's review in chat keeps voice listening with the microphone open"
  it.each([
    { utterance: "Could you let +1 415 555 0100 know to meet upstairs and bring the keys?", sim: 1, shown: true },
    { utterance: "Text +14155550100 saying Meet upstairs. Bring the keys.", sim: 2, shown: false },
  ])("takes a text review from what the agent proposed, never from my words, and says nothing of its own when it cannot show one: $utterance", async ({ utterance, sim, shown }) => {
    const { world, operation, review, alpha, area } = await talkOnMessages(sim, {
      extraCapabilities: ["files.browser.v1", "files.shown-target.v1", "browser.open-direct.v1"],
    });
    const declared: string[][] = [];
    const { observedReviewPending, stopWatch } = watchReviewPending(area);
    world.ask.nextReplyChunks = ["Review the text on your phone."];
    world.ask.nextActions = (_, capabilities) => {
      declared.push([...capabilities]);
      return capabilities.includes("sms.send.v1") ? proposeText(review)() : [];
    };
    const from = world.voice.spoken.length;
    try {
      await drawn(() => speakUtterance(world, utterance));
      await drawnUntil(alpha, area, Voice.Machine, (state) => state.sent === 1 && state.reviewPending === shown && state.phase === "Listening" && state.mic === "On");
    } finally {
      await stopWatch();
    }
    expect(declared.at(-1)).toContain("sms.send.v1");
    expect(world.ask.said.at(-1)).toBe(utterance);
    expect(button("Send this text") !== undefined).toBe(shown);
    if (shown) expect(document.body.textContent).toContain(operation.body);
    else expect(observedReviewPending).not.toContain(true);
    expect(world.voice.spoken.slice(from).map((one) => one.text)).toEqual([]);
    expect([review.decisions, review.claims, world.telephony.sent]).toEqual([[], [], []]);
  });

  async function openMessagesFilterTalk(setup?: (review: ReturnType<typeof textReview>) => void) {
    const world = { ...scene(), phone: true, image: true, signedIn: false };
    const filter = { type: "files_filter", kind: "pdf", folder: "Download" } as const;
    const review = textReview(world.notes.owner, "messages-filter", filter);
    review.extraCapabilities.push("sms.send.v1");
    setup?.(review);
    world.telephony.textReview = review;
    const { alpha, area } = await openMessagesTalk(world, [{ at: "view:Files", load: () => import("../src/files/index.tsx") }]);
    return { world, review, alpha, area };
  }

  // spec/app/voice/index.md, "A reply that needs the owner's review in chat keeps voice listening with the microphone open"
  it("from Talk over Messages with a chosen SIM, speaks a direct Files result while keeping sms.send.v1 declared", async () => {
    const { world, review, alpha, area } = await openMessagesFilterTalk();

    const declared: string[][] = [];
    review.proposal.payload.requestMessageId = `m${world.ask.said.length + 1}u`;
    world.ask.nextReplyChunks = ["There is a Files request."];
    world.ask.nextActions = (_, capabilities) => {
      declared.push([...capabilities]);
      return [{ action: "PROPOSE_DEVICE_ACTION", data: {
        proposalId: "messages-filter", state: "pending", executed: false, awaitingDeviceExecution: true, directRequest: true, approvalRequired: false,
      } }];
    };
    const from = world.voice.spoken.length;
    await drawn(() => speakUtterance(world, "Show PDFs in Download"));
    await drawn(() => vi.waitFor(() => expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied", operationId: "messages-filter" })]), { timeout: 10_000 }));
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.sent === 1 && state.phase === "Listening" && state.mic === "On" && !state.reviewPending);
    expect(declared.at(-1)).toEqual(expect.arrayContaining(["sms.send.v1", "files.browser.v1", "files.shown-target.v1"]));
    expect(alpha.runtime.runSync(Shell.Machine.use((machine) => machine.get()))).toMatchObject({ trail: ["Messages", "Files"], assistant: "Sheet" });
    expect(world.voice.spoken.slice(from).some((said) => said.text.includes("Showing 1 item in Files"))).toBe(true);
  });

  // spec/app/voice/index.md, "A reply that needs the owner's review in chat keeps voice listening with the microphone open"
  it("from Talk over Messages with direct Files enabled, still shows non-Files review cards while omitting Files review cards", async () => {
    const { world, review, alpha, area } = await talkOnMessages(1, {
      extraCapabilities: ["sms.compose.v1", "sms.compose.v2", "files.browser.v1", "files.shown-target.v1"],
    });
    alsoPending(review, "kept-compose", { type: "sms_compose", query: "Maya", body: "Running late" });
    alsoPending(review, "kept-folder", { type: "files_folder_create", parent: "Download", name: "Review folder" });
    const declared: string[][] = [];
    world.ask.nextReplyChunks = ["Review this text on your phone."];
    world.ask.nextActions = (_, capabilities) => {
      declared.push([...capabilities]);
      return [kept("kept-compose"), kept("kept-folder")];
    };
    await drawn(() => speakUtterance(world, "Text Maya I am running late and make a folder."));
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.sent === 1 && state.reviewPending && state.phase === "Listening" && state.mic === "On");
    expect(declared.at(-1)).toEqual(expect.arrayContaining(["sms.send.v1", "sms.compose.v1", "sms.compose.v2", "files.browser.v1"]));
    expect(document.body.textContent).toContain("Review this text on your phone");
    expect(document.body.textContent).not.toContain("Create a folder");
  });

  // spec/app/voice/index.md, "A reply that needs the owner's review in chat keeps voice listening with the microphone open"
  it("from Talk over Messages, hushes an agent-flagged direct sms_send that never ran instead of speaking its claim", async () => {
    const { world, review, alpha, area } = await talkOnMessages(1, {
      extraCapabilities: ["files.browser.v1", "files.shown-target.v1", "browser.open-direct.v1"],
    });
    const { observedReviewPending, stopWatch } = watchReviewPending(area);
    review.proposal.payload.requestMessageId = `m${world.ask.said.length + 1}u`;
    world.ask.nextReplyChunks = ["Sending it now."];
    world.ask.nextActions = () => [{ action: "PROPOSE_DEVICE_ACTION", data: {
      proposalId: review.proposal.id, state: "pending", executed: false, awaitingDeviceExecution: true, directRequest: true, approvalRequired: false,
    } }];
    const from = world.voice.spoken.length;
    try {
      await drawn(() => speakUtterance(world, "Text +14155550100 saying Meet upstairs."));
      await drawnUntil(alpha, area, Voice.Machine, (state) => state.sent === 1 && !state.reviewPending && state.phase === "Listening" && state.mic === "On");
    } finally {
      await stopWatch();
    }
    expect(button("Send this text")).toBeUndefined();
    expect(observedReviewPending).not.toContain(true);
    expect(world.voice.spoken.slice(from).map((one) => one.text)).toEqual([]);
    expect([review.decisions, review.claims, review.confirmations, review.receipts, world.telephony.sent]).toEqual([[], [], [], [], []]);

    world.ask.nextReplyChunks = ["They usually meet upstairs."];
    world.ask.nextActions = () => [];
    await drawn(() => speakUtterance(world, "Where do they usually meet?"));
    await drawn(() => vi.waitFor(() => expect(world.voice.spoken.slice(from).map((one) => one.text)).toEqual(["They usually meet upstairs."])));
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.sent === 2 && state.phase === "Listening" && state.mic === "On" && !state.reviewPending);
  });

  // spec/app/voice/index.md, "A reply that needs the owner's review in chat keeps voice listening with the microphone open"
  it("from Talk over Messages with a chosen SIM, speaks a direct Files result even when the reply also proposes an unshowable SMS review", async () => {
    const { world, review, alpha, area } = await openMessagesFilterTalk((r) => {
      alsoPending(r, "unshowable-sms", { type: "sms_send", recipients: ["+14155550100"], body: "Meet upstairs.", subscriptionId: 2 });
    });

    review.proposal.payload.requestMessageId = `m${world.ask.said.length + 1}u`;
    world.ask.nextReplyChunks = ["There is a Files request and a text."];
    world.ask.nextActions = () => [{ action: "PROPOSE_DEVICE_ACTION", data: {
      proposalId: "messages-filter", state: "pending", executed: false, awaitingDeviceExecution: true, directRequest: true, approvalRequired: false,
    } }, kept("unshowable-sms")];
    const from = world.voice.spoken.length;
    await drawn(() => speakUtterance(world, "Show PDFs in Download and text +14155550100."));
    await drawn(() => vi.waitFor(() => expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied", operationId: "messages-filter" })]), { timeout: 10_000 }));
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.sent === 1 && state.phase === "Listening" && state.mic === "On" && !state.reviewPending);
    expect(world.voice.spoken.slice(from).some((said) => said.text.includes("Showing 1 item in Files"))).toBe(true);
    expect(button("Send this text")).toBeUndefined();
    expect(review.decisions).not.toContain("unshowable-sms");
    expect(review.claims).not.toContain("unshowable-sms");
    expect(world.telephony.sent).toEqual([]);
  });

  // spec/app/browser/index.md, "A page the owner's whole message asked for opens at once, typed or spoken, and any other page waits for the owner's Open"; spec/app/voice/index.md, "A reply that needs the owner's review in chat keeps voice listening with the microphone open"
  it("from Talk over Messages, includes browser.open-direct.v1 only while Ask before Alpha acts is off", async () => {
    const { world, alpha, area } = await talkOnMessages(1, {
      extraCapabilities: ["files.browser.v1", "files.shown-target.v1", "browser.open-direct.v1"],
    });
    const declared: string[][] = [];
    world.ask.nextReplyChunks = ["Ready."];
    world.ask.nextActions = (_, capabilities) => {
      declared.push([...capabilities]);
      return [];
    };
    await drawn(() => speakUtterance(world, "Check the page."));
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.sent === 1 && state.phase === "Listening" && state.mic === "On");
    expect(declared[0]).toContain("browser.open-direct.v1");
    expect(declared[0]).toContain("sms.send.v1");

    await drawn(() => alpha.runtime.runPromise(Preferences.use((machine) => machine.send({ type: "setAskFirst", askFirst: true, at: untimed }, "Owner"))));
    await drawnUntil(alpha, alpha.runtime, Preferences, (state) => state.askFirst);
    world.ask.nextReplyChunks = ["Ready again."];
    world.ask.nextActions = (_, capabilities) => {
      declared.push([...capabilities]);
      return [];
    };
    await drawn(() => speakUtterance(world, "Check the page again."));
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.sent === 2 && state.phase === "Listening" && state.mic === "On");
    expect(declared[1]).not.toContain("browser.open-direct.v1");
    expect(declared[1]).toContain("sms.send.v1");
  });

  // spec/app/voice/index.md, "A reply that needs the owner's review in chat keeps voice listening with the microphone open"; spec/app/contacts/agent.md, "Only the owner approves, only what is shown as it is now, and only when the phone has ruled out an emergency call"
  it.each([
    { answer: "Send this text.", by: "voice", again: true, outcome: "send" },
    { answer: "I think I want to send it.", by: "voice", again: true, outcome: "shown" },
    { answer: "Yep, go ahead and send the message to +1 (415) 555-0100.", by: "voice", again: true, outcome: "shown" },
    { answer: "No, don't send it.", by: "voice", again: false, outcome: "withdrawn" },
    { answer: "Send this text", by: "touch", again: false, outcome: "send" },
    { answer: "Decline Keep things as they are.", by: "touch", again: false, outcome: "decline" },
  ] as const)("decides the displayed text review only by touch, never by matching what I say: $by $answer", async ({ answer, by, again, outcome }) => {
    const { world, operation, review, alpha, area, room } = await talkOnMessages();
    world.ask.nextReplyChunks = ["Review the text on your phone."];
    world.ask.nextActions = () => [{ action: "PROPOSE_DEVICE_ACTION", data: {
      proposalId: review.proposal.id, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true,
    } }];
    const text = "Text +14155550100 saying Meet upstairs. Bring the keys.";
    await drawn(() => speakUtterance(world, text));
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.sent === 1 && state.reviewPending && state.phase === "Listening" && state.mic === "On");
    expect(room.messages.some((line) => line.role === "user" && line.text === text)).toBe(true);
    expect(world.ask.metadata?.at(-1)).toMatchObject({ observation: { selectedObject: { kind: "sms-subscription", id: "1" } } });
    expect(button("Send this text")).toBeDefined();
    expect(document.body.textContent).toContain(operation.body);
    // spec/app/voice/index.md, "A reply that needs the owner's review in chat keeps voice listening with the microphone open": the recipient by the name Messages gives its number, with the number.
    expect(document.body.textContent).toContain("To: Maya Chen (415) 555-0100");
    expect([review.decisions, review.claims, world.telephony.sent]).toEqual([[], [], []]);

    const propose = () => [{ action: "PROPOSE_DEVICE_ACTION", data: {
      proposalId: review.proposal.id, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true,
    } }];
    const tapSend = () => confirmSentText(review);
    try {
      if (by === "voice") {
        // spec/app/voice/index.md, "A reply that needs the owner's review in chat keeps voice listening with the microphone open": the agent reads the words; when its reply names the same pending text again, that review is drawn again with its Send.
        world.ask.nextReplyChunks = ["Tap Send when you are ready."];
        world.ask.nextActions = again ? propose : () => [];
        await drawn(() => speakUtterance(world, answer));
        await drawnUntil(alpha, area, Voice.Machine, (state) =>
          state.sent === 2 && state.reviewPending === again && state.phase === "Listening" && state.mic === "On");
        expect([review.decisions, review.rejections, review.claims, review.confirmations, world.telephony.sent]).toEqual([[], [], [], [], []]);
        expect(button("Send this text") !== undefined).toBe(again);
        if (outcome === "send") {
          await tapSend();
          await drawnUntil(alpha, area, Voice.Machine, (state) =>
            state.sent === 2 && !state.reviewPending && state.phase === "Listening" && state.mic === "On");
        }
      } else {
        if (outcome === "send") await tapSend();
        else {
          await press(answer);
          await vi.waitFor(() => expect(review.proposal.state).toBe("rejected"));
        }
        await drawnUntil(alpha, area, Voice.Machine, (state) =>
          state.sent === 1 && !state.reviewPending && state.phase === "Listening" && state.mic === "On");
      }
    } finally {
      for (const confirmation of review.confirmations) confirmation.confirm();
    }
    expect(world.ask.said).toEqual(by === "voice" ? ["Start this chat", text, answer] : ["Start this chat", text]);
    expect(button("Send this text") !== undefined).toBe(outcome === "shown");
    expect([review.decisions, review.rejections, review.claims, world.telephony.sent]).toEqual(outcome === "send" ? [
      [review.proposal.id], [], [review.proposal.id], [{ operationId: review.proposal.id, recipients: [...operation.recipients], body: operation.body }],
    ] : outcome === "decline" ? [[], [review.proposal.id], [], []] : [[], [], [], []]);
    // spec/app/voice/index.md, "A reply that needs the owner's review in chat keeps voice listening with the microphone open": the decision shows as v119's result chip under the review, and is never spoken.
    await drawn(() => vi.waitFor(() => expect(document.querySelector("[data-alpha-device-receipt]")?.textContent)
      .toBe(outcome === "send" ? "Android accepted the text request." : outcome === "decline" ? "Declined" : undefined)));
  });

  async function confirmSentText(review: ReturnType<typeof textReview>) {
    await press("Send this text");
    await vi.waitFor(() => expect(review.confirmations).toHaveLength(1), { timeout: 12_000 });
    await drawn(() => review.confirmations[0]?.confirm());
    await vi.waitFor(() => expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied", operationId: review.proposal.id })]));
  }

  // spec/app/voice/index.md, "A reply that needs the owner's review in chat keeps voice listening with the microphone open"; spec/app/settings/preferences.md, "Ask before Alpha acts covers the agent's actions on the web, with the camera, in Photos and Files, its reading of the latest texter's number and its text drafts"
  it("with Ask before Alpha acts on, sends nothing for what I say and exactly one text for my tap on Send", async () => {
    const { world, operation, review, alpha, area } = await talkOnMessages();
    await drawn(() => alpha.runtime.runPromise(Preferences.use((machine) => machine.send({ type: "setAskFirst", askFirst: true, at: untimed }, "Owner"))));
    await drawnUntil(alpha, alpha.runtime, Preferences, (state) => state.askFirst);
    const propose = () => [kept(review.proposal.id)];
    world.ask.nextReplyChunks = ["Review the text on your phone."];
    world.ask.nextActions = propose;
    await drawn(() => speakUtterance(world, "Text +14155550100 saying Meet upstairs. Bring the keys."));
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.sent === 1 && state.reviewPending && state.phase === "Listening" && state.mic === "On");
    for (const [at, answer] of ["Yes.", "Send it.", "Yes, send it now."].entries()) {
      world.ask.nextReplyChunks = ["Tap Send when you are ready."];
      world.ask.nextActions = propose;
      await drawn(() => speakUtterance(world, answer));
      await drawnUntil(alpha, area, Voice.Machine, (state) => state.sent === at + 2 && state.reviewPending && state.phase === "Listening" && state.mic === "On");
      expect([review.decisions, review.rejections, review.claims, review.confirmations, world.telephony.sent]).toEqual([[], [], [], [], []]);
      expect(button("Send this text")).toBeDefined();
    }
    try {
      await confirmSentText(review);
    } finally {
      for (const confirmation of review.confirmations) confirmation.confirm();
    }
    expect(world.telephony.sent).toEqual([{ operationId: review.proposal.id, recipients: [...operation.recipients], body: operation.body }]);
  });

  async function openSpokenBrowserWorld(url: string) {
    const world = { ...scene(), phone: true, image: true, signedIn: false };
    const review = textReview(world.notes.owner, "spoken-page", { type: "browser_navigate", url });
    world.telephony.textReview = review;
    const { alpha, area } = await onComposer(world, { at: "view:Browser", load: () => import("../src/browser/index.tsx") });
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.warmed);
    return { world, review, alpha, area };
  }

  async function openFilesVoiceSession(world: ReturnType<typeof scene>) {
    const { alpha, area } = await onComposer(world, { at: "view:Files", load: () => import("../src/files/index.tsx") });
    await drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell.Machine, (machine) => machine.send({ type: "openView", view: "Files" }))));
    await drawnUntil(alpha, area, Conversation, (s) => s.ready && s.observing && s.context.showing.tag === "App" && s.context.showing.view === "Files");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.warmed);
    await drawnUntil(alpha, files.runtime(alpha), Files, (s) => s.access === "Granted" && s.storage.status === "Loaded");
    await startTalkWithAskFirstOff({ alpha, area });
    return { alpha, area };
  }

  // spec/app/browser/index.md, "A page the owner's whole message asked for opens at once, typed or spoken, and any other page waits for the owner's Open"
  it("opens from Talk, with no card, a page the spoken request asked for whole, and lowers Ask Alpha over it", async () => {
    const url = "https://www.alphacompute.ai/";
    const { world, review, alpha, area } = await openSpokenBrowserWorld(url);
    await startTalkWithAskFirstOff({ alpha, area });
    world.ask.nextReplyChunks = ["Opening alphacompute.ai."];
    world.ask.nextActions = (_, capabilities) => askedPage(review, `m${world.ask.said.length}u`, capabilities);
    speakUtterance(world, "Visit alphacompute.ai.");
    await drawnUntil(alpha, alpha.runtime, Shell.Machine, (s) => Shell.showing(s, "Browser") && s.assistant === "Bar");
    expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied", operationId: "spoken-page" })]);
    await vi.waitFor(() => expect([...world.browser.tabs.values()].some((tab) => tab.history[tab.at] === url)).toBe(true), { timeout: 10_000 });
    expect(button("Open")).toBeUndefined();
  });

  // spec/app/voice/index.md, "A reply that needs the owner's review in chat keeps voice listening with the microphone open"
  it.each([false, true])("away from Messages, says nothing of a text the agent prepared that Talk shows no card for (askFirst: %s)", async (askFirst) => {
    const world = { ...scene(), phone: true, image: true, signedIn: false };
    const operation = { type: "sms_send", recipients: ["+14155550100"], body: "Meet upstairs.", subscriptionId: 1 } as const;
    const review = textReview(world.notes.owner, "unshown-text", operation);
    world.telephony.textReview = review;
    const { alpha, area } = await onComposer(world, { at: "view:Browser", load: () => import("../src/browser/index.tsx") });
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.warmed);
    await drawnUntil(alpha, alpha.runtime, Preferences, (s) => s.document.read.status === "Loaded");
    if (askFirst) {
      await drawn(() => alpha.runtime.runPromise(Preferences.use((machine) => machine.send({ type: "setAskFirst", askFirst: true, at: untimed }, "Owner"))));
      await drawnUntil(alpha, alpha.runtime, Preferences, (s) => s.askFirst);
    }
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On");
    world.ask.nextReplyChunks = ["I've prepared the text. Tap Send to send it."];
    world.ask.nextActions = () => [kept("unshown-text")];
    const from = world.voice.spoken.length;
    await drawn(() => speakUtterance(world, "Text +1 415 555 0100 to meet upstairs."));
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.sent === 1 && s.phase === "Listening" && s.mic === "On" && !s.reviewPending);
    await later(alpha, 500);
    expect(world.voice.spoken.slice(from).map((one) => one.text)).toEqual([]);
    expect(button("Send this text")).toBeUndefined();
    expect([review.decisions, review.claims, world.telephony.sent]).toEqual([[], [], []]);
    expect([...world.ask.kept.values()].some((room) => room.messages.some((line) => line.text === "I've prepared the text. Tap Send to send it."))).toBe(true);
    await drawn(() => vi.waitFor(() => expect(document.body.textContent).toContain("I've prepared the text. Tap Send to send it.")));

    world.ask.nextReplyChunks = ["It is sunny today."];
    world.ask.nextActions = () => [];
    await drawn(() => speakUtterance(world, "What is the weather?"));
    await drawn(() => vi.waitFor(() => expect(world.voice.spoken.slice(from).map((one) => one.text)).toEqual(["It is sunny today."])));

    world.ask.nextReplyChunks = ["Maya lands at six."];
    world.ask.nextActions = () => [kept("not-a-text")];
    await drawn(() => speakUtterance(world, "When does Maya land?"));
    await drawn(() => vi.waitFor(() => expect(world.voice.spoken.slice(from).map((one) => one.text)).toEqual(["It is sunny today.", "Maya lands at six."])));

    // spec/app/voice/index.md, "A reply that needs the owner's review in chat keeps voice listening with the microphone open": a listed review of this phone that is not a text, shown as no card, is said in full.
    alsoPending(review, "listed-note", { type: "create_note", title: "Maya's flight", body: "Lands at six." });
    world.ask.nextReplyChunks = ["I've drafted a note about Maya's flight."];
    world.ask.nextActions = () => [kept("listed-note")];
    await drawn(() => speakUtterance(world, "Make a note of Maya's flight."));
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.sent === 4 && s.phase === "Listening" && s.mic === "On" && !s.reviewPending);
    await drawn(() => vi.waitFor(() => expect(world.voice.spoken.slice(from).map((one) => one.text)).toEqual(["It is sunny today.", "Maya lands at six.", "I've drafted a note about Maya's flight."])));
    expect([button("Approve"), review.decisions, review.claims]).toEqual([undefined, [], []]);
  });

  async function openAskFirstPageCard(url: string) {
    const { world, review, alpha, area } = await openSpokenBrowserWorld(url);
    await drawnUntil(alpha, alpha.runtime, Preferences, (s) => s.document.read.status === "Loaded");
    await drawn(() => alpha.runtime.runPromise(Preferences.use((machine) => machine.send({ type: "setAskFirst", askFirst: true, at: untimed }, "Owner"))));
    await drawnUntil(alpha, alpha.runtime, Preferences, (s) => s.askFirst);
    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On");
    world.ask.nextReplyChunks = ["Opening alphacompute.ai."];
    world.ask.nextActions = (_, capabilities) => askedPage(review, `m${world.ask.said.length}u`, capabilities);
    speakUtterance(world, "Visit alphacompute.ai.");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.reviewPending);
    await drawn(() => vi.waitFor(() => expect(button("Open")).toBeDefined()));
    return { world, review, alpha, area };
  }

  // spec/app/assistant/cards.md, "A phone step's result chip stands under the reply that offered it, and a reply that only offered the review gives way to it"; spec/app/settings/preferences.md, "Ask before Alpha acts covers the agent's actions on the web, with the camera, in Photos and Files, its reading of the latest texter's number and its text drafts"
  it("declines a page's card from its last row: nothing opens, nothing is claimed, and the result chip says Declined", async () => {
    const url = "https://www.alphacompute.ai/";
    const { world, review, alpha } = await openAskFirstPageCard(url);
    const row = decline();
    expect(row).toHaveLength(1);
    expect(row[0]?.parentElement?.textContent).toBe("Keep things as they are.Decline");
    const from = world.voice.spoken.length;
    await drawn(() => row[0]?.click());
    await drawn(() => vi.waitFor(() => expect(review.proposal.state).toBe("rejected")));
    await drawn(() => vi.waitFor(() => expect(document.querySelector("[data-alpha-device-receipt]")?.textContent).toBe("Declined")));
    await later(alpha, 500);
    expect([review.claims, review.receipts]).toEqual([[], []]);
    expect([...world.browser.tabs.values()].some((tab) => tab.history[tab.at] === url)).toBe(false);
    expect(button("Open")).toBeUndefined();
    expect(world.voice.spoken.slice(from)).toEqual([]);
  });

  // spec/app/browser/index.md, "A page the owner's whole message asked for opens at once, typed or spoken, and any other page waits for the owner's Open"; spec/app/settings/preferences.md, "Ask before Alpha acts covers the agent's actions on the web, with the camera, in Photos and Files, its reading of the latest texter's number and its text drafts"
  it("while Ask before Alpha acts is on, keeps a page the spoken request asked for whole on its card in chat until I choose Open", async () => {
    const url = "https://www.alphacompute.ai/";
    const { world, review, alpha } = await openAskFirstPageCard(url);
    await later(alpha, 500);
    expect([review.claims, review.receipts]).toEqual([[], []]);
    expect([...world.browser.tabs.values()].some((tab) => tab.history[tab.at] === url)).toBe(false);

    await press("Open");
    await vi.waitFor(() => expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied", operationId: "spoken-page" })]), { timeout: 10_000 });
    await vi.waitFor(() => expect([...world.browser.tabs.values()].some((tab) => tab.history[tab.at] === url)).toBe(true), { timeout: 10_000 });
  });

  async function awaitFilesPageCard(world: ReturnType<typeof scene>, alpha: Awaited<ReturnType<typeof onComposer>>["alpha"], area: Awaited<ReturnType<typeof onComposer>>["area"], phrase: string) {
    speakUtterance(world, phrase);
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.reviewPending);
    expect(world.ask.metadata?.at(-1)).toMatchObject({ voiceUi: { agentActionMode: "direct-files-only-v1" } });
    await drawn(() => vi.waitFor(() => expect(button("Open")).toBeDefined()));
    await later(alpha, 500);
  }

  // spec/app/files/index.md, "An explicit request to open or filter Files may act directly on the same idle Files view"; spec/app/browser/index.md, "A page the owner's whole message asked for opens at once, typed or spoken, and any other page waits for the owner's Open"
  it("from Talk over Files, shows the card of a page the agent keeps for my review, and opens it only on Open", async () => {
    const world = { ...scene(), phone: true, image: true, signedIn: false };
    world.ask.metadata = [];
    const url = "https://www.alphacompute.ai/";
    const review = textReview(world.notes.owner, "spoken-page", { type: "browser_navigate", url });
    world.telephony.textReview = review;
    const { alpha, area } = await openFilesVoiceSession(world);
    world.ask.nextReplyChunks = ["Here is a page for you to open."];
    world.ask.nextActions = () => askedPage(review, `m${world.ask.said.length}u`, []);
    await awaitFilesPageCard(world, alpha, area, "Find me a page about Alpha.");
    expect([review.claims, review.receipts]).toEqual([[], []]);

    await press("Open");
    await vi.waitFor(() => expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied", operationId: "spoken-page" })]), { timeout: 10_000 });
  });

  const decline = () => [...document.querySelectorAll("button")].filter((one) => one.textContent === "Decline");

  // spec/app/files/index.md, "An explicit request to open or filter Files may act directly on the same idle Files view"
  it("from Talk over Files, offers only the page's card: no Files, text or other card the reply kept for review", async () => {
    const world = { ...scene(), phone: true, image: true, signedIn: false };
    world.ask.metadata = [];
    const review = textReview(world.notes.owner, "kept-folder", { type: "files_folder_create", parent: "Download", name: "Review folder" });
    alsoPending(review, "kept-text", { type: "sms_compose", query: "Maya", body: "Running late" });
    alsoPending(review, "kept-page", { type: "browser_navigate", url: "https://www.alphacompute.ai/" });
    world.telephony.textReview = review;
    const { alpha, area } = await openFilesVoiceSession(world);
    world.ask.nextReplyChunks = ["Here is what I found for you to look over."];
    world.ask.nextActions = () => [kept("kept-folder"), kept("kept-text"), kept("kept-page")];
    await awaitFilesPageCard(world, alpha, area, "Make a Review folder, text Maya I am running late, and find me a page about Alpha.");
    expect(decline()).toHaveLength(1);
    expect(document.body.textContent).toContain("Open this page?");
    for (const title of ["Create a folder", "Review this text on your phone", "Open an editable text draft"]) expect(document.body.textContent).not.toContain(title);
    expect([review.decisions, review.claims]).toEqual([[], []]);
  });

  // spec/app/files/index.md, "An explicit request to open or filter Files may act directly on the same idle Files view"
  it("from Talk over Files, still says the Files result when the reply also offers a page's card", async () => {
    const world = { ...scene(), phone: true, image: true, signedIn: false };
    world.ask.metadata = [];
    const review = textReview(world.notes.owner, "asked-filter", { type: "files_filter", kind: "pdf", folder: "Download" });
    alsoPending(review, "kept-page", { type: "browser_navigate", url: "https://www.alphacompute.ai/" });
    world.telephony.textReview = review;
    const { alpha, area } = await openFilesVoiceSession(world);
    review.proposal.payload.requestMessageId = `m${world.ask.said.length + 1}u`;
    world.ask.nextReplyChunks = ["There is a Files action for this turn."];
    world.ask.nextActions = () => [{ action: "PROPOSE_DEVICE_ACTION", data: {
      proposalId: "asked-filter", state: "pending", executed: false, awaitingDeviceExecution: true, directRequest: true, approvalRequired: false,
    } }, kept("kept-page")];
    speakUtterance(world, "only the pdfs in my downloads, and find me a page about Alpha");
    await drawn(() => vi.waitFor(() => expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied", operationId: "asked-filter" })]), { timeout: 10_000 }));
    await drawn(() => vi.waitFor(() => expect(button("Open")).toBeDefined()));
    await drawn(() => vi.waitFor(() => expect(world.voice.spoken.some((said) => said.text.includes("Showing 1 item in Files"))).toBe(true)));
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.reviewPending);
    expect(document.body.textContent).toContain("Review in chat");
    expect(button("Open")).toBeDefined();
    expect(decline()).toHaveLength(1);
  });

  // spec/app/files/index.md, "An explicit request to open or filter Files may act directly on the same idle Files view"
  it("runs the agent's own terminal Files action from compact Talk, and nothing for a turn that proposes none", async () => {
    const world = { ...scene(), phone: true, image: true, signedIn: false };
    world.ask.metadata = [];
    world.ask.spokenFiles = [];
    const filter = { type: "files_filter", kind: "pdf", folder: "Download" } as const;
    const review = textReview(world.notes.owner, "other-filter", filter);
    world.telephony.textReview = review;
    const { alpha, area } = await openFilesVoiceSession(world);

    const speak = async (id: string, text: string, sent: number, proposes = true) => {
      review.proposal.id = id;
      review.proposal.state = "pending";
      review.proposal.payload.requestMessageId = `m${world.ask.said.length + 1}u`;
      world.ask.nextReplyChunks = [proposes ? "There is a Files action for this turn." : "It is a quarter past two."];
      world.ask.nextActions = () => proposes ? [{ action: "PROPOSE_DEVICE_ACTION", data: {
        proposalId: id, state: "pending", executed: false, awaitingDeviceExecution: true, directRequest: true, approvalRequired: false,
      } }] : [];
      speakUtterance(world, text);
      await drawnUntil(alpha, area, Voice.Machine, (s) => s.sent === sent && s.phase === "Listening" && s.mic === "On");
    };

    await speak("no-files-request", "What time is it?", 1, false);
    expect([review.claims, world.files.calls.includes("storageQuery")]).toEqual([[], false]);
    expect(world.ask.metadata?.at(-1)).toMatchObject({ voiceUi: { agentActionMode: "direct-files-only-v1" } });
    expect(world.voice.spoken.some((said) => said.text.includes("quarter past two"))).toBe(true);
    await speak("asked-filter", "only the pdfs in my downloads", 2);
    expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied", operationId: "asked-filter" })]);
    expect(world.ask.spokenFiles.at(-1)).toEqual({ channel: "VOICE_DM", images: undefined });
    expect(world.voice.spoken.some((said) => said.text.includes("Showing 1 item in Files"))).toBe(true);

    // spec/app/assistant/context.md, "A turn an agent refuses whole for a direct-request mode it does not know is sent once more without it"
    world.ask.knowsNoActionMode = true;
    const posted = world.ask.metadata.length;
    await speak("older-agent", "What time is it now?", 3, false);
    expect(world.ask.metadata.slice(posted).map((one) => (one as { voiceUi?: { agentActionMode?: string } } | undefined)?.voiceUi?.agentActionMode)).toEqual(["direct-files-only-v1", undefined]);
    expect(world.voice.spoken.filter((said) => said.text.includes("quarter past two"))).toHaveLength(2);
    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Idle");
  });

  // spec/app/voice/index.md, "An exact spoken Files request may follow its own leased navigation once"
  it("follows a named Files request from Home and leaves an unpublished ordinal there", async () => {
    const world = { ...scene(), phone: true, image: true, signedIn: false };
    world.ask.metadata = [];
    const filter = { type: "files_filter", kind: "pdf", folder: "Download" } as const;
    const review = textReview(world.notes.owner, "ordinal", { type: "files_open", shown: 1 });
    world.telephony.textReview = review;
    const { alpha, area } = await onComposer(world, { at: "view:Files", load: () => import("../src/files/index.tsx") });
    await drawnUntil(alpha, area, Conversation, (s) => s.ready && s.observing && s.context.showing.tag === "Home");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.warmed);
    await startTalkWithAskFirstOff({ alpha, area });

    const speak = async (id: string, text: string, sent: number) => {
      review.proposal.id = id;
      review.proposal.state = "pending";
      review.proposal.payload.requestMessageId = `m${world.ask.said.length + 1}u`;
      world.ask.nextReplyChunks = ["There is a Files request."];
      world.ask.nextActions = () => [{ action: "PROPOSE_DEVICE_ACTION", data: {
        proposalId: id, state: "pending", executed: false, awaitingDeviceExecution: true, directRequest: true, approvalRequired: false,
      } }];
      speakUtterance(world, text);
      await drawnUntil(alpha, area, Voice.Machine, (s) => s.sent === sent && s.phase === "Listening" && s.mic === "On");
    };

    await speak("ordinal", "Open result 1", 1);
    expect(review.claims).toEqual([]);
    expect(alpha.runtime.runSync(Shell.Machine.use((machine) => machine.get())).trail).toEqual([]);
    expect(world.ask.metadata?.at(-1)).toMatchObject({ voiceUi: { agentActionMode: "direct-files-only-v1" } });

    review.proposal.payload.operation = filter;
    await speak("named-filter", "Show PDFs in Download", 2);
    expect(review.receipts).toEqual([expect.objectContaining({ outcome: "applied", operationId: "named-filter" })]);
    expect(alpha.runtime.runSync(Shell.Machine.use((machine) => machine.get()))).toMatchObject({ trail: ["Files"], assistant: "Bar" });
    expect(world.voice.spoken.some((said) => said.text.includes("Showing 1 item in Files"))).toBe(true);
    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Idle");
  });

  // spec/app/assistant/context.md, "A turn asked while Files shows a readable document attaches it for that turn"
  it.each([
    { text: "The shipment arrives on Wednesday", secret: false },
    { text: "Your verification code is 482913", secret: true },
  ])("attaches the open document's safe text to every spoken turn, whatever the words, and never its secret text ($secret)", async ({ text, secret }) => {
    const world = { ...scene(), phone: true, signedIn: false };
    world.ask.metadata = [];
    world.ask.spokenFiles = [];
    world.files.texts["Documents/notes.txt"] = text;
    const at = world.files.stored.findIndex((file) => file.path === "Documents/notes.txt");
    const record = world.files.stored[at];
    if (record === undefined) throw new Error("no text document");
    world.files.stored[at] = { ...record, size: text.length };
    const { alpha, area } = await onComposer(world, { at: "view:Files", load: () => import("../src/files/index.tsx") });
    const storage = files.runtime(alpha);
    await drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell.Machine, (machine) => machine.send({ type: "openView", view: "Files" }))));
    await drawnUntil(alpha, area, Conversation, (state) => state.ready && state.observing && state.context.showing.tag === "App" && state.context.showing.view === "Files");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.warmed);
    await drawnUntil(alpha, storage, Files, (state) => state.storage.status === "Loaded");
    await press("Internal storage");
    await drawnUntil(alpha, storage, Files, (state) => state.listing.status === "Loaded" && state.trail.length === 1);
    await press("Documents");
    await drawnUntil(alpha, storage, Files, (state) => state.listing.status === "Loaded" && state.trail.length === 2);
    await press("notes.txt");
    await drawnUntil(alpha, storage, FilePreview, (state) => state.content.status === "Loaded" && state.secret === secret);

    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Listening" && state.mic === "On");
    const attached = { channel: "VOICE_DM", images: secret ? undefined : [{ data: btoa(text), mimeType: "text/plain", name: "notes.txt" }] };
    speakUtterance(world, "What should I do now?");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.sent === 1 && state.phase === "Listening" && state.mic === "On");
    expect(world.ask.spokenFiles?.at(-1)).toEqual(attached);
    if (!secret) expect(world.ask.metadata.at(-1)).toMatchObject({ observation: { view: "files", selectedObject: { kind: "document" } } });
    if (!secret) expect(world.ask.metadata.at(-1)).not.toMatchObject({ voiceUi: { agentActionMode: "direct-files-only-v1" } });

    speakUtterance(world, "Please summarize this file");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.sent === 2 && state.phase === "Listening");
    expect(world.ask.spokenFiles?.at(-1)).toEqual(attached);
    expect(JSON.stringify(world.ask.metadata)).not.toContain(text);
    await press("Stop voice conversation");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.phase === "Idle");
  });

  // spec/app/voice/index.md, "Starting asks for the microphone the first time, opens it once it is allowed, and holds the speech engine while talking"; spec/app/voice/index.md, "Audio leaves the phone only on a route the owner agreed to"; spec/app/voice/index.md, "A failed conversation ends quietly: why it failed is kept only until voice returns to idle, and nothing is shown"
  it("a signed-out owner's Talk ends quietly: voice returns to idle, nothing leaves the phone, nothing is shown, and Talk is offered again", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    world.voice.onDevice = false;
    const { alpha, area } = await onComposer(world);
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.warmed);
    await coverLifted(alpha);

    await press("Talk");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.session > 0 && s.phase === "Idle");
    const after = await area.runPromise(Effect.flatMap(Voice.Machine, (m) => m.get()));
    expect([after.mic, after.network, world.voice.cloudStarts, world.voice.relayWarmups, document.querySelector("[role=alertdialog], [role=alert], [role=note], [role=status]"), button("Talk") !== undefined]).toEqual([
      "Off", false, [], [], null, true,
    ]);
  });

  // spec/app/voice/dictation.md, "Recording starts from ready, and only the answer to that start opens it"; spec/app/voice/dictation.md, "A transcript with words is shown for review; no speech, an unavailable agent or a failed recognition keeps the clip"
  it("times the admitted composer recording and keeps the confirmed clip's length through a failed transcription", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await onSheet(world);
    await dictating(alpha, area);

    const confirmed = Promise.withResolvers<void>();
    world.voice.recordingStartGate = () => confirmed.promise;
    const clock = () => document.querySelector('[aria-label="Voice transcription"] .tabular-nums')?.textContent;
    const marks = () => document.querySelector('[aria-label="Recording activity"]')?.children.length ?? 0;
    try {
      await press("Start recording");
      await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Starting");
      await later(alpha, 1000);
      expect([clock(), marks()]).toEqual(["0:00", 0]);
    } finally {
      confirmed.resolve();
    }

    await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Recording");
    await drawn(async () => {
      const observed = area.runSync(DictationClock);
      for (let turn = 0; turn < 400 && observed.snapshot().ticket === undefined; turn += 1) await area.runPromise(Effect.yieldNow);
      expect(observed.snapshot().ticket).toBeDefined();
    });
    expect(marks()).toBe(44);
    await later(alpha, 2000);
    expect(clock()).toBe("0:02");

    world.voice.transcriptionFailures = 1;
    await press("Stop recording");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Recorded");
    expect([clock(), marks()]).toEqual(["0:59", 0]);
    await press("Discard transcription");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Closed");
    await dictating(alpha, area);
    expect([clock(), marks()]).toEqual(["0:00", 0]);
    await press("Start recording");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Recording");
    expect(area.runSync(VoiceWords).memory.dictatedDurationMs).toBeUndefined();
    await press("Discard transcription");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Closed");
    expect(world.ask.said).toEqual([]);
  });

  // spec/app/voice/dictation.md, "Ask Alpha names recognition preparation and can start only after its recognition check succeeds"
  it.each([false, true])("names the actual on-device recognition readiness without opening capture (ready: %s)", async (ready) => {
    const world = { ...scene(), phone: true, signedIn: false };
    world.voice.recognitionReady = ready;
    const reachedProbe = Promise.withResolvers<void>();
    const finishedProbe = Promise.withResolvers<void>();
    world.voice.recognitionProbeGate = () => { reachedProbe.resolve(); return finishedProbe.promise; };
    let recordings = 0;
    world.voice.recordingStartGate = () => { recordings += 1; return Promise.resolve(); };
    const { alpha } = await open(world, talkMounts);
    const area = assistant.runtime(alpha);
    await drawnUntil(alpha, area, Composer, (state) => state.slot === "Open");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.warmed);
    await raiseSheet(alpha);
    await fill("Message Alpha", "Original draft");
    await drawn(() => area.runPromise(dictate()));
    try {
      await reachedProbe.promise;
      await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.preparation === "Preparing");
      const { recorder } = await getVoice(area);
      await expect(sendVoice(area, { type: "recognitionChecked", ticket: recorder.ticket - 1, ready: true })).rejects.toBeDefined();
      expect(button("Preparing on-device speech")?.disabled).toBe(true);
      // spec/app/voice/dictation.md, "Ask Alpha names recognition preparation and can start only after its recognition check succeeds": the button shows no words while preparing
      expect(shownWords(button("Preparing on-device speech"))).toBe("");
      await press("Preparing on-device speech");
      expect(recordings).toBe(0);
    } finally {
      finishedProbe.resolve();
    }
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.preparation === (ready ? "Prepared" : "Unavailable"));
    if (ready) {
      expect(button("Start recording")?.disabled).toBe(false);
      expect(recordings).toBe(0);
      const opening = Promise.withResolvers<void>();
      world.voice.recordingStartGate = () => { recordings += 1; return opening.promise; };
      await press("Start recording");
      await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Starting");
      // spec/app/voice/dictation.md, "Ask Alpha names recognition preparation and can start only after its recognition check succeeds": nor while the microphone starts
      expect([button("Starting microphone")?.disabled, shownWords(button("Starting microphone"))]).toEqual([true, ""]);
      opening.resolve();
      await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Recording");
      expect(recordings).toBe(1);
      await press("Discard transcription");
    } else {
      // spec/app/voice/dictation.md, "Ask Alpha names recognition preparation and can start only after its recognition check succeeds": nor once on-device speech is unavailable
      expect([button("On-device speech unavailable")?.disabled, shownWords(button("On-device speech unavailable"))]).toEqual([true, ""]);
      await press("On-device speech unavailable");
      expect(recordings).toBe(0);
      await switchToKeyboard();
    }
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Closed");
    expect(document.querySelector<HTMLTextAreaElement>("textarea[data-alpha-composer]")?.value).toBe("Original draft");
    expect(world.ask.said).toEqual([]);
  });

  // spec/app/voice/index.md, "Story: Dictate into a field"; spec/app/voice/index.md, "Recording asks for the microphone the first time, like a conversation"; spec/app/voice/dictation.md, "A microphone failure ends dictation quietly and a failed transcription keeps its clip"
  it("a dictation the microphone refuses closes quietly and restores the composer's microphone control", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    world.voice.permission = "prompt";
    world.voice.grantOnRequest = false;
    const { alpha, area } = await onComposer(world);
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.warmed);
    await coverLifted(alpha);
    await settleComposer(alpha, () => button("Talk") !== undefined);

    await drawn(() => document.querySelector<HTMLTextAreaElement>("textarea[data-alpha-composer]")?.focus());
    await drawn(() => area.runPromise(dictate()));
    await settleComposer(alpha, () => button("Start recording") !== undefined);
    await press("Start recording");
    await settleComposer(alpha, () => button("Talk") !== undefined);
    const after = await area.runPromise(Effect.flatMap(Voice.Machine, (m) => m.get()));
    expect([after.recorder.stage, after.permission.asked]).toEqual(["Closed", true]);
    expect([document.querySelector("[role=alertdialog], [role=alert], [role=note], [role=status], section[aria-label='Voice transcription']"), world.voice.permission]).toEqual([null, "denied"]);
  });

  // spec/app/voice/index.md, "A network failure before Alpha has spoken moves the conversation to the phone at once, and the failed turn is not sent again"
  it("falls back to on-device speech when Cloud speech fails during an active session", async () => {
    const world = { ...scene(), phone: true, signedIn: true };
    world.voice.onDevice = true;
    const runtime = bootVoice(world);
    await until(runtime, Voice.Machine, (s) => s.route.account === "CloudAccount" && s.route.consent && s.warmed);

    await sendVoice(runtime, { type: "startTalking", now: untimed });
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.network);
    const sessionId = world.voice.activeMicSession;
    expect(sessionId).toBeDefined();
    world.voice.emitCloud?.({ sessionId: sessionId ?? "", type: "error", code: "network_timeout" });

    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && !s.network && s.route.holdUntil > 0);
    expect(world.voice.startLiveCaptureCalls).toBeGreaterThanOrEqual(1);
    await sendVoice(runtime, { type: "stop", keyboard: false });
    await until(runtime, Voice.Machine, (s) => s.phase === "Idle");
  });

  // spec/app/voice/index.md, "Android's answer to the prompt opens the microphone, or ends the start quietly when it was denied"
  it("re-syncs microphone permission grant on foreground return after OS settings change", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    world.voice.permission = "denied";
    const { alpha, area } = await onComposer(world);
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.permission.grant === "Denied");

    await seen(false);
    world.voice.permission = "granted";
    await seen(true);
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.permission.grant === "Granted");
  });

  // spec/app/voice/index.md, "Stop shuts the conversation down, and a stop asked for the keyboard then hands it over"
  it("aborts a stalled voice turn and clears heard transcript when stopped", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    world.ask.stalled = true;
    const runtime = await startListening(world);
    world.voice.emitLocal?.("liveCaptureTranscript", {
      captureId: world.voice.activeMicSession,
      partial: "Halfway",
    });
    await untilCondition(runtime, () => true);
    speakUtterance(world, "Take your time");
    await until(runtime, Voice.Machine, (s) => s.phase === "Thinking");
    await untilCondition(runtime, () => world.ask.turns.size === 1, () => world.ask.turns.size);

    await sendVoice(runtime, { type: "stop", keyboard: false });
    await until(runtime, Voice.Machine, (s) => s.phase === "Idle");
    const words = await runtime.runPromise(Effect.flatMap(VoiceWords, (w) => Effect.sync(() => w.snapshot())));
    expect([world.ask.turns.size, words.heardText]).toEqual([0, ""]);
  });

  // spec/app/assistant/reply.md, "A spoken acknowledgment starts at once; a reply ready before it is audible drops it, and an audible one finishes before the reply, within 2.5 s"
  it("speaks acknowledgment cues at once and begins speaking the reply on reply_ready before done without duplicating on done", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const runtime = await startListening(world);

    let releaseDone: (() => void) | undefined;
    world.ask.acknowledgment = "Let me check.";
    world.ask.nextReplyChunks = ["You have no alarms set."];
    world.ask.nextReplyProvisional = true;
    world.ask.holdDoneAfterReady = new Promise<void>((resolve) => { releaseDone = resolve; });

    speakUtterance(world, "Check my alarms");
    await untilCondition(
      runtime,
      () => world.voice.spoken.some((entry) => entry.text.includes("You have no alarms set.")),
      () => world.voice.spoken,
    );
    expect(world.voice.spoken.map((entry) => ({ text: entry.text, append: entry.append }))).toEqual([
      { text: "Let me check.", append: false },
      { text: "You have no alarms set.", append: false },
    ]);

    releaseDone?.();
    await until(runtime, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.sent === 1 && s.turn === 2);
    expect(world.voice.spoken.filter((entry) => entry.text.includes("You have no alarms set.")).length).toBe(1);
    world.ask.acknowledgment = undefined;
  });

  // spec/app/voice/index.md, "Closing the recorder abandons any recording or transcription it was waiting for"
  it.each(["ready", "confirmed", "view changed", "unconfirmed"] as const)("switches from dictation to the owning keyboard after closure (%s)", async (outcome) => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await onSheet(world);
    const editor = document.querySelector<HTMLTextAreaElement>("textarea[data-alpha-composer]");
    expect(editor).not.toBeNull();
    await fill("Message Alpha", "Draft stays here");
    await dictating(alpha, area);

    if (outcome !== "ready") {
      await press("Start recording");
      await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Recording");
    }
    const canceling = Promise.withResolvers<void>();
    const settled = Promise.withResolvers<void>();
    let called = false;
    world.voice.recordingCancelGate = async () => {
      called = true;
      canceling.resolve();
      await settled.promise;
      if (outcome === "unconfirmed") throw new Error("Microphone cleanup did not settle");
    };
    try {
      await switchToKeyboard();
      if (outcome !== "ready") {
        await canceling.promise;
        const state = await area.runPromise(Effect.flatMap(Voice.Machine, (machine) => machine.get()));
        expect(state.recorder.stage).toBe("Recording");
        expect(document.activeElement).not.toBe(editor);
        if (outcome === "view changed") {
          await openNotes(alpha);
        }
      }
    } finally {
      settled.resolve();
    }

    expect(called).toBe(outcome !== "ready");
    if (outcome === "unconfirmed") {
      await drawn(async () => { for (let turn = 0; turn < 20; turn += 1) await area.runPromise(Effect.yieldNow); });
      expect(button("Stop recording")).toBeDefined();
    } else {
      await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Closed");
    }
    if (outcome === "confirmed" || outcome === "ready") {
      expect(document.activeElement).toBe(editor);
      expect(editor?.value).toBe("Draft stays here");
    } else {
      expect(document.activeElement).not.toBe(editor);
    }
    expect(world.ask.said).toEqual([]);
  });

  // spec/app/voice/output.md, "Stopping, or losing what is read (another conversation, another screen, a hidden page, a closed chat), stops the reading"
  it("listens to the current reviewed words on the phone and never plays words edited during preparation", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await onSheet(world);
    await dictating(alpha, area);
    await press("Start recording");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Recording");
    await press("Stop recording");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Review");

    const preparing = Promise.withResolvers<void>();
    const settled = Promise.withResolvers<void>();
    world.voice.synthesisGate = async () => {
      preparing.resolve();
      await settled.promise;
    };
    try {
      await press("Listen to transcript");
      await preparing.promise;
      await drawnUntil(alpha, area, Speaker, (state) => state.stage === "Preparing");
      expect(button("Stop audio")).toBeDefined();
      await fill("Review transcript", "My revised words");
      await drawnUntil(alpha, area, Speaker, (state) => state.stage === "Silent" && state.outcome === "Stopped");
    } finally {
      world.voice.synthesisGate = undefined;
      settled.resolve();
    }
    expect(world.voice.speakerMutedAtPlayback).toEqual([]);
    await press("Listen to transcript");
    await drawnUntil(alpha, area, Speaker, (state) => state.stage === "Silent" && state.outcome === "Finished");
    expect(world.voice.spoken.map(({ text, channel }) => ({ text, channel }))).toEqual([
      { text: "Dictated note", channel: "local" }, { text: "My revised words", channel: "local" },
    ]);
    expect(world.voice.speakerMutedAtPlayback).toEqual([false]);
    expect(world.ask.said).toEqual([]);
  });

  // spec/app/voice/dictation.md, "After an unsuccessful recognition, the owner may type the transcript in Ask Alpha"
  it("types a kept clip's transcript after recognition fails and adds only the reviewed words to the draft", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, area } = await onSheet(world);
    await fill("Message Alpha", "Original draft");
    await dictating(alpha, area);
    await press("Start recording");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Recording");
    world.voice.transcriptionFailures = 1;
    await press("Stop recording");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Recorded");
    expect(button("Transcribe on this phone")).toBeDefined();
    expect(button("Record again")).toBeUndefined();
    await press("Type transcript instead");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Review");
    const review = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Review transcript"]');
    expect(review?.value).toBe("");
    expect(button("Use in draft")?.disabled).toBe(true);
    await fill("Review transcript", "Typed transcript");
    await press("Use in draft");
    await drawnUntil(alpha, area, Voice.Machine, (state) => state.recorder.stage === "Closed");
    expect(document.querySelector<HTMLTextAreaElement>("textarea[data-alpha-composer]")?.value).toBe("Original draft\nTyped transcript");
    expect(world.voice.dictationClips).toHaveLength(1);
    expect(world.ask.said).toEqual([]);
  });

  // spec/app/assistant/context.md, "A spoken turn carries what a typed turn sent at that moment would, the view claim included"; spec/app/voice/index.md, "An active voice conversation may ask the shell to open Home or any admitted screen"; spec/app/voice/index.md, "Voice keeps talking after a navigation only when it is the one the conversation asked for; any other ends it"
  it("opens a spoken reply's prepared view through voice without ending the active conversation", async () => {
    const { world, alpha, area } = await openPhoneTalk(true);

    world.ask.nextReplyChunks = ["Opening Calendar."];
    world.ask.nextActions = (metadata) => {
      const clientId = typeof metadata === "object" && metadata !== null && "viewClientId" in metadata && typeof metadata.viewClientId === "string"
        ? metadata.viewClientId : "";
      return [{ action: "VIEWS", data: { values: { navigationBinding: { requestId: "req-cal", clientId, viewId: "Calendar", viewType: "gui", installationId: "inst-1" } } } }];
    };
    speakUtterance(world, "Open Calendar");
    await drawnUntil(alpha, alpha.runtime, Shell.Machine, (s) => s.trail.at(-1) === "Calendar");
    for (let turn = 0; turn < 40; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));

    const after = await area.runPromise(Effect.flatMap(Voice.Machine, (m) => m.get()));
    expect([after.phase, after.followed]).toEqual(["Listening", placeOf("Calendar")]);
    expect(world.notes.views.some((entry) => entry.path === "result" && entry.body.success === true)).toBe(true);
  });

  // spec/app/voice/index.md, "When the owner finishes speaking, the microphone closes, and only then is the turn sent, once and automatically"; spec/app/voice/index.md, "Alpha is speaking exactly while sentences of the current turn are queued"; spec/app/voice/index.md, "Interrupt stops Alpha speaking and listens for the next turn"
  it("ignores stale transcripts outside listening and prevents an interrupted turn from corrupting the next turn", async () => {
    const { world, alpha, area } = await openPhoneTalk(true);

    world.ask.acknowledgment = "Checking.";
    world.ask.holdAfterTools = true;
    world.ask.nextReplyChunks = ["Late turn one sentence."];
    speakUtterance(world, "First question");
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Speaking" && s.mic === "On");
    expect(world.ask.turns.size).toBe(1);

    world.voice.emitLocal?.("liveCaptureTranscript", { captureId: world.voice.activeMicSession, final: { text: "STALE SPEAKING ECHO" } });
    for (let turn = 0; turn < 15; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    const { memory } = area.runSync(VoiceWords);
    expect(memory.heardText).toBeUndefined();

    await area.runPromise(Effect.flatMap(Voice.Machine, (m) => m.send({ type: "interrupt" })));
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.turn === 2);
    for (let turn = 0; turn < 25; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
    expect(world.ask.turns.size).toBe(0);

    memory.enqueueSentence(2, "Turn two sentence.");
    memory.enqueueSentence(1, "Late turn one sentence.");
    expect(memory.dequeueSentence(2)?.text).toBe("Turn two sentence.");
  });

  // spec/app/voice/index.md, "A turn Cloud refuses because the account is out of funds ends voice quietly, as Stop does"; spec/app/voice/index.md, "A failed conversation ends quietly: why it failed is kept only until voice returns to idle, and nothing is shown"; spec/app/assistant/reply.md, "Out of funds is refused before any output, is never spoken, and offers only Manage plan"
  it("ends real-time Talk quietly when Cloud asks for sign-in or refuses its stream or start for spent funds: no toast, one funds line in the chat until the next turn, and Talk is offered again", async () => {
    const world = { ...scene(), phone: true };
    world.voice.onDevice = false;
    world.voice.localReady = false;
    world.voice.liveCaptureAvailable = false;
    const { alpha, area } = await onComposer(world, ...only("notice"));
    await drawnUntil(alpha, area, Voice.Machine, (s) => s.route.account === "CloudAccount" && s.route.consent && s.warmed);
    const toasts = () => alpha.runtime.runPromise(Effect.flatMap(Toasts, (m) => m.get()));
    const raised = (await toasts()).issued;
    const endsQuietly = async (step: string, lines: number) => {
      await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Idle" && s.mic === "Off");
      for (let turn = 0; turn < 10; turn += 1) await drawn(() => alpha.runtime.runPromise(Effect.yieldNow));
      const after = await area.runPromise(Effect.flatMap(Voice.Machine, (m) => m.get()));
      const shown = await toasts();
      expect([step, after.failure, after.retries, shown.issued - raised, shown.showing, world.voice.activeMicSession, button("Talk") !== undefined, fundingRows(), button("Manage plan") !== undefined]).toEqual([
        step, "NoFailure", 0, 0, false, undefined, true, lines, lines > 0,
      ]);
    };
    const streamRefused = async (code: string, lines: number) => {
      await press("Talk");
      await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase === "Listening" && s.mic === "On" && s.network);
      const sessionId = world.voice.activeMicSession;
      expect(sessionId).toBeDefined();
      await drawn(() => world.voice.emitCloud?.({ sessionId: sessionId ?? "", type: "error", code }));
      await endsQuietly(code, lines);
    };
    const startRefused = async (code = "insufficient_credits", lines = 1) => {
      const starts = world.voice.startCloudSpeechCalls;
      world.voice.cloudStartGate = () => Promise.reject(rejection("Cloud refused Talk", code));
      await press("Talk");
      await drawnUntil(alpha, area, Voice.Machine, (s) => s.phase !== "Idle" || world.voice.startCloudSpeechCalls > starts);
      await endsQuietly(`start ${code}`, lines);
      world.voice.cloudStartGate = undefined;
      expect(world.voice.startCloudSpeechCalls).toBe(starts + 1);
    };

    await startRefused("unauthorized", 0);
    await streamRefused("unauthorized", 0);
    await startRefused();
    await fill("Message Alpha", "Hello");
    await press("Send");
    await drawnUntil(alpha, area, Conversation, (s) => s.turn.send.id === 1 && s.turn.reply === "Complete");
    expect(fundingRows()).toBe(0);
    await streamRefused("insufficient_credits", 1);
    await startRefused();
  });
});
