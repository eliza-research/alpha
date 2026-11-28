// spec/app/notes/recording.md, "Story: Record a voice note"; spec/app/notes/recording.md, "Story: Discard a recording"; spec/app/notes/microphone.md, "The owner's screen reader hears Mic unavailable after asking to record while the browser denies the microphone"
import { Button } from "@repo/ui";
import { Check, Mic, Pause, Square } from "lucide-react";
import { type ReactNode, type Ref, useCallback, useRef, useSyncExternalStore } from "react";
import { useMachine as useMic } from "../../gen/app__notes__microphone.react.ts";
import { useMachine } from "../../gen/app__notes__recording.react.ts";
import type { Event } from "../../gen/app__notes__recording.ts";
import { useMachine as useVoice } from "../../gen/app__notes__voice.react.ts";
import { NoteDevice } from "../platform/index.vibe";
import type { Alpha } from "../runtime/ui.tsx";
import { RecordingDisplay, control, levelCount } from "./recording.vibe";

function elapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  const remainder = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

const actionClass = "h-auto min-h-14 min-w-0 flex-1 whitespace-normal rounded-lg px-4 py-3 text-md in-data-[alpha-title-row]:flex-none";

type RecorderFrameProps = {
  readonly seconds: number;
  readonly levels: readonly number[];
  readonly measuring: boolean;
  /** The status word drawn under the levels: only the words the v119 demo build showed. */
  readonly status: string;
  /** What a screen reader hears for the status, where it says more than the drawn word. */
  readonly spoken?: string | undefined;
  readonly onDiscard?: (() => void) | undefined;
  readonly discardRef?: Ref<HTMLButtonElement>;
  readonly details?: ReactNode;
  readonly review?: ReactNode;
  readonly actions: ReactNode;
};

function RecorderFrame({ seconds, levels, measuring, status, spoken = status, onDiscard, discardRef, details, review, actions }: RecorderFrameProps) {
  return (
    <section aria-label="Voice recording" className="@container flex min-h-0 flex-1 flex-col px-6" data-alpha-subview="notes-recording">
      <header className="flex min-h-14 shrink-0 items-center gap-4">
        <h2 className="flex-1 font-display text-title leading-serif font-light">Voice note</h2>
        <Button ref={discardRef} variant="ghost" className="min-w-0 px-1 font-normal text-muted-foreground" aria-label="Discard recording"
          disabled={onDiscard === undefined} onClick={onDiscard}>Discard</Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto py-6">
        <span role="timer" className="whitespace-nowrap font-display text-recorder-timer font-light tabular-nums" aria-label="Recording duration" style={{ fontSize: "min(var(--text-recorder-timer), 20cqw)" }}>{elapsed(seconds)}</span>
        <div role="img" aria-label="Microphone levels" className="mt-6.5 flex h-24 shrink-0 items-center gap-0.75">
          {Array.from({ length: levelCount }, (_, index) => {
            const raw = levels[levels.length - levelCount + index] ?? 0;
            const peak = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
            return <span key={index} aria-hidden className="flex-1 rounded-clip bg-alpha motion-safe:transition-[height] motion-safe:duration-fast"
              style={{ height: Math.max(4, Math.round(Math.sqrt(peak) * 92)), opacity: measuring ? 1 : 0.35 }} />;
          })}
        </div>
        <p role="status" className="mt-3 min-h-5.5 text-sm text-muted-foreground">
          {spoken === status ? status : <><span aria-hidden>{status}</span><span className="sr-only">{spoken}</span></>}
        </p>
        {details}
      </div>
      {review}
      <div className="flex shrink-0 items-center gap-3 pt-5 pb-[calc(max(6.75rem,var(--alpha-dock-overlap,0px),env(safe-area-inset-bottom))+--spacing(4))] in-data-[alpha-title-row]:flex-col in-data-[alpha-title-row]:items-stretch">
        {actions}
      </div>
    </section>
  );
}

export function MicrophoneUnavailable({ onRecord, onDiscard }: { readonly onRecord: () => void; readonly onDiscard: () => void }) {
  return <RecorderFrame seconds={0} levels={[]} measuring={false} status="" onDiscard={onDiscard}
    details={<p role="alert" className="sr-only">Mic unavailable</p>} actions={<>
    <Button variant="secondary" className={actionClass} onClick={onRecord}><Mic className="size-5" /> Record</Button>
    <Button className={actionClass} disabled><Square className="size-5" /> Stop recording</Button>
  </>} />;
}

export function Recording({ runtime }: { readonly runtime: Alpha["runtime"] }) {
  const recording = useMachine(runtime);
  const mic = useMic(runtime);
  const voice = useVoice(runtime);
  const device = runtime.runSync(NoteDevice);
  const display = runtime.runSync(RecordingDisplay);
  const meters = useSyncExternalStore(display.subscribe, display.snapshot, display.snapshot);
  const state = recording.state;
  const confirming = state?.ask === "AskDiscard";
  const restoreDiscardRef = useRef(false);
  const keepRef = useCallback((button: HTMLButtonElement | null) => {
    if (button === null) return;
    button.focus({ preventScroll: true });
    return () => { restoreDiscardRef.current = true; };
  }, []);
  const discardRef = (button: HTMLButtonElement | null) => {
    if (button === null || button.disabled || !restoreDiscardRef.current) return;
    restoreDiscardRef.current = false;
    if (button.ownerDocument.activeElement === button.ownerDocument.body) button.focus({ preventScroll: true });
  };
  if (state === undefined) return null;
  const send = (event: Event) => void recording.send(event, "Owner");
  const can = (event: Event) => recording.can(event, "Owner");
  const run = (action: "pause" | "resume" | "stop") => void runtime.runPromise(control(action, state.take));
  const room = {
    allowed: mic.state?.mic.grant === "Granted",
    free: device.available,
    front: true,
    silent: voice.state?.play.status !== "Loading",
  } as const;
  const resume = { type: "resume", take: state.take, room } as const;
  const active = state.phase === "Recording";
  const paused = state.phase === "Paused";
  const turning = state.phase === "Stopping" || (state.phase === "Keeping" && state.keeping.outcome !== "Unknown");
  const matchingTake = meters.owner === state.owner && meters.take === state.take;
  const measuring = active && matchingTake;
  const seconds = matchingTake ? meters.seconds : 0;
  const levels = matchingTake ? meters.levels : [];
  const canStop = can({ type: "stop", take: state.take });
  const canSave = can({ type: "keepPartial" });
  const askDiscard = { type: "askDiscard", take: state.take, captureReady: measuring } as const;
  const cancelDiscard = { type: "cancelDiscard", take: state.take } as const;
  const confirmDiscard = { type: "confirmDiscard", take: state.take } as const;
  const canCancel = can(cancelDiscard);
  const status = active ? (measuring ? "Recording" : "Starting…") : paused ? "Paused" : turning ? "Saving…" : "";

  return <RecorderFrame seconds={seconds} levels={levels} measuring={measuring} status={status}
    spoken={paused && state.recovered ? "Recovered recording" : status}
    onDiscard={can(askDiscard) ? () => send(askDiscard) : undefined}
    discardRef={discardRef}
    details={state.phase === "Failed" && <p role="alert" className="sr-only">
      {state.damaged ? "Only part of this recording could be recovered" : "Recording stopped. The saved audio is still here."}
    </p>}
    review={confirming && <div role="group" aria-label="Discard this recording?" className="my-3 flex shrink-0 flex-wrap items-center gap-3"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !canCancel) return;
        event.preventDefault();
        event.stopPropagation();
        send(cancelDiscard);
      }}>
      <span className="flex-1">Discard?</span>
      {canCancel && <Button ref={keepRef} variant="secondary" className="rounded-dictation-type px-4" onClick={() => send(cancelDiscard)}>Keep</Button>}
      {can(confirmDiscard) && <Button className="rounded-dictation-type bg-foreground px-4 text-background hover:bg-foreground/90" onClick={() => send(confirmDiscard)}>Discard</Button>}
      </div>}
    actions={<>
      {(active || paused || turning) && (
        active
          ? <Button variant="secondary" className={actionClass} disabled={!can({ type: "pause", take: state.take })} onClick={() => run("pause")}><Pause className="size-5" /> Pause</Button>
          : <Button variant="secondary" className={actionClass} disabled={!can(resume)} onClick={() => run("resume")}><Mic className="size-5" /> Resume</Button>
      )}
      {can({ type: "lookUp" }) && <Button variant="secondary" className={actionClass} onClick={() => send({ type: "lookUp" })}>Check again</Button>}
      {canSave
        ? <Button className={actionClass} onClick={() => send({ type: "keepPartial" })}><Check className="size-5" /> Save recording</Button>
        : <Button className={actionClass} disabled={!canStop} onClick={() => run("stop")}><Square className="size-5" /> {turning ? "Saving…" : "Stop recording"}</Button>}
    </>}
  />;
}
