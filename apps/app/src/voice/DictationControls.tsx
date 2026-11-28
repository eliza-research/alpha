// spec/app/voice/index.md, "Story: Dictate into a field"; spec/app/voice/dictation.md, "A microphone failure ends dictation quietly and a failed transcription keeps its clip"
import { Button, cn, Textarea } from "@repo/ui";
import type { ManagedRuntime } from "effect";
import { Check, Mic, Settings, X } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { Machine as Voice } from "../../gen/app__voice.effect.vibe";
import { useMachine } from "../../gen/app__voice.react.ts";
import type { Machine as Speaker } from "../../gen/app__voice__output.effect.vibe";
import { closeDictationForKeyboard, dictationReturnedToKeyboard, editDictation } from "../assistant/dictation.vibe";
import type { VoiceBridge } from "../platform/index.vibe";
import { untimed } from "../runtime/index.vibe";
import { DictationClock } from "./dictation-clock.vibe";
import { VoiceStopIcon } from "./VoiceStopIcon.tsx";
import { VoiceWords } from "./voice.vibe";
import type { DictationKeyboard } from "./useTalkKeyboard.ts";

const recordingMarks = Array.from({ length: 44 }, (_, index) => index);

function KeyboardIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8" />
    </svg>
  );
}

/** The controls and confirmed time of the current composer recording, including transcript review. */
export function DictationControls({ runtime, onKeyboard, playback }: {
  runtime: ManagedRuntime.ManagedRuntime<Voice | VoiceWords | DictationClock | VoiceBridge | Speaker, unknown>;
  onKeyboard: DictationKeyboard;
  playback?: { readonly playing: boolean; toggle(ticket: number): void };
}) {
  const { state, can, send } = useMachine(runtime);
  const words = useMemo(() => runtime.runSync(VoiceWords), [runtime]);
  const store = useMemo(() => ({ subscribe: (listener: () => void) => words.subscribe(listener), snapshot: () => words.snapshot() }), [words]);
  const { dictatedText, dictatedDurationMs } = useSyncExternalStore(store.subscribe, store.snapshot);
  const clock = runtime.runSync(DictationClock);
  const elapsed = useSyncExternalStore(clock.subscribe, clock.snapshot, clock.snapshot);
  const [leaving, setLeaving] = useState<number>();
  if (!state) return null;
  const { recorder } = state;
  if (recorder.field !== "ComposerField" || recorder.stage === "Closed") return null;
  const pending = leaving === recorder.ticket;
  const start = { type: "startRecording" } as const;
  const stop = { type: "stopRecording", now: untimed } as const;
  const retry = { type: "transcribeAgain", now: untimed } as const;
  const type = { type: "typeTranscript", ticket: recorder.ticket } as const;
  const another = { type: "recordAgain" } as const;
  const use = { type: "fill" } as const;
  const close = { type: "closeRecorder" } as const;
  const settings = { type: "openSettings" } as const;
  const recording = recorder.stage === "Recording";
  const review = recorder.stage === "Review";
  const waitingForRecognition = recorder.stage === "Ready" && recorder.preparation !== "Prepared";
  const retired = recorder.stage === "Recorded" || recorder.stage === "Review" || recorder.stage === "Transcribing";
  const seconds = recording && elapsed.ticket === recorder.ticket ? elapsed.seconds
    : retired ? (dictatedDurationMs === undefined ? undefined : Math.floor(dictatedDurationMs / 1000))
      : 0;
  const primary = {
    Ready: can(settings)
      ? { label: "Open Settings", icon: Settings, event: settings, enabled: true }
      : {
        label: recorder.preparation === "Preparing" ? "Preparing on-device speech"
          : recorder.preparation === "Unavailable" ? "On-device speech unavailable" : "Start recording",
        icon: Mic, event: start, enabled: can(start), unseen: recorder.preparation === "Preparing" || recorder.preparation === "Unavailable",
      },
    Starting: { label: "Starting microphone", icon: Mic, event: start, enabled: false, unseen: true },
    Recording: { label: "Stop recording", icon: VoiceStopIcon, event: stop, enabled: can(stop) },
    Transcribing: { label: "Cancel transcription", icon: VoiceStopIcon, event: close, enabled: can(close) },
    Recorded: { label: "Transcribe on this phone", icon: Mic, event: retry, enabled: can(retry) },
    Review: { label: "Use in draft", icon: Check, event: use, enabled: can(use) },
  }[recorder.stage];
  const PrimaryIcon = primary.icon;
  return (
    <section aria-label="Voice transcription" aria-busy={pending} className={cn("flex flex-col gap-3 px-5 pt-2 pb-5", review ? "shrink-0" : "min-h-fit flex-1")}>
      <div className="flex shrink-0 items-center gap-3">
        <span className="flex-1 font-display text-recorder-clock font-light tabular-nums">
          {seconds === undefined ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}
        </span>
        <Button variant="ghost" size="icon" aria-label="Switch to keyboard" disabled={pending} onClick={(event) => {
          const { ticket } = recorder;
          onKeyboard(event.currentTarget, ticket, async () => {
            setLeaving(ticket);
            try {
              const closed = await runtime.runPromiseExit(closeDictationForKeyboard(ticket));
              return closed._tag === "Success" && closed.value;
            } finally {
              setLeaving((current) => current === ticket ? undefined : current);
            }
          }, () => {
            const closed = runtime.runSyncExit(dictationReturnedToKeyboard(ticket));
            return closed._tag === "Success" && closed.value;
          });
        }}><KeyboardIcon /></Button>
        {can(close) && <Button variant="ghost" size="icon" aria-label="Discard transcription" disabled={pending} onClick={() => void send(close)}><X /></Button>}
      </div>
      {review ? <Textarea aria-label="Review transcript" value={dictatedText} disabled={pending} onChange={(event) => void runtime.runPromise(editDictation(event.target.value))}
        className="min-h-28 resize-y rounded-lg border-0 bg-secondary p-3 text-base leading-transcript" /> : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {recording && <div role="img" aria-label="Recording activity" className="flex min-h-10 shrink-0 items-center gap-0.75">
            {recordingMarks.map((mark) => <span key={mark} aria-hidden className="h-1 flex-1 rounded-full bg-primary" />)}
          </div>}
          {can(type) && <Button variant="secondary" aria-label="Type transcript instead" disabled={pending}
            className="h-11 justify-start gap-1.5 rounded-dictation-type px-3 font-normal" onClick={() => void send(type)}>
            <KeyboardIcon className="size-4.5" />Type
          </Button>}
        </div>
      )}
      <Button className={cn("min-h-14 gap-2.5 rounded-sheet px-4", waitingForRecognition && "disabled:opacity-100")}
        disabled={pending || !primary.enabled} onClick={() => void send(primary.event)}>
        <PrimaryIcon aria-hidden="true" className="size-6" /><span className={"unseen" in primary && primary.unseen ? "sr-only" : undefined}>{primary.label}</span>
      </Button>
      {review && (playback || can(another)) && <Button variant="secondary" className={cn("h-11 px-4 font-normal", playback && dictatedText.trim() === "" && !pending && "disabled:opacity-100")}
        disabled={pending || (playback !== undefined && dictatedText.trim() === "")}
        onClick={() => playback ? playback.toggle(recorder.ticket) : void send(another)}>
        {playback?.playing ? <><VoiceStopIcon className="size-5" />Stop audio</> : playback ? <>
          <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M8 5l11 7-11 7z" /></svg>
          Listen to transcript
        </> : <><Mic aria-hidden className="size-5" />Record again</>}
      </Button>}
    </section>
  );
}
