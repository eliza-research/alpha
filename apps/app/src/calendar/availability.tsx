// spec/app/calendar/sharing.md, "Story: Choose the calendars and see the answer before it is shared"; spec/app/calendar/sharing.md, "Nothing is ticked at first, and Check is offered for one to sixteen ticked calendars"; spec/app/calendar/sharing.md, "The sheet offers the phone's calendars with none ticked, reads only the ticked ones, and shares only a free or busy answer it showed"
import { Button, Checkbox, Dialog, DialogContent, DialogTitle, StatusDot } from "@repo/ui";
import { Effect, type ManagedRuntime } from "effect";
import type { Machine } from "../../gen/app__calendar__sharing.effect.vibe";
import { maxChosen } from "../../gen/app__calendar__sharing.ts";
import { useMachine } from "../../gen/app__calendar__sharing.react.ts";
import { area } from "../runtime/ui.tsx";
import { CheckedCalendars, checkTime, checking, type Offered } from "./availability.vibe";

export interface AvailabilityReviewProps {
  /** Provides the availability sheet's machine and what it shows. */
  runtime: ManagedRuntime.ManagedRuntime<Machine | CheckedCalendars, unknown>;
}

const span = (start: string, end: string, timeZone: string) => `${checkTime(start, timeZone)} to ${checkTime(end, timeZone)}`;
const named = (one: Offered) => `${one.name} · ${one.account}`;

/**
 * The phone's own review of an availability check, over Home or Calendar: first the calendars to read, none ticked,
 * then the exact answer before it is shared. Closing it at any step shares nothing.
 * @model spec/app/calendar/sharing.md
 */
export function AvailabilityReview({ runtime }: AvailabilityReviewProps) {
  const { state, can, send } = useMachine(runtime);
  if (!state || (state.checking !== "Choosing" && state.checking !== "Answered")) return null;
  const shown = runtime.runSync(Effect.flatMap(CheckedCalendars, (checked) => checked.get()));
  const { operation, result } = shown;
  if (operation === undefined || (state.checking === "Answered" && result === undefined)) return null;
  const close = { type: "close" } as const;
  const dismiss = (open: boolean) => { if (!open && can(close)) void send(close); };
  const footer = (action: string, event: { readonly type: "check" | "share" }) => (
    <div className="flex shrink-0 justify-end gap-2">
      <Button variant="ghost" onClick={() => void send(close)}>Cancel</Button>
      <Button disabled={!can(event)} onClick={() => void send(event)}>{action}</Button>
    </div>
  );
  if (state.checking === "Choosing") {
    const count = state.ticked.length;
    return (
      <Dialog open onOpenChange={dismiss}>
        <DialogContent aria-label="Calendars" aria-describedby={undefined} className="flex max-h-[calc(var(--alpha-viewport-height,100dvh)-6rem)] flex-col gap-2.5 p-3.5">
          <DialogTitle>Check availability</DialogTitle>
          <p className="text-sm text-muted-foreground tabular-nums">{span(operation.start, operation.end, operation.timeZone)} ({operation.timeZone})</p>
          <p className="text-sm">Only ticked calendars are read</p>
          <fieldset aria-label="On phone" className="flex min-h-0 flex-col overflow-y-auto overscroll-contain">
            <legend className="text-sm font-semibold">On phone</legend>
            {shown.offered.map((one) => {
              const tick = { type: "tick", calendar: one.id } as const;
              return (
                <label key={one.id} className="flex min-h-11 items-center gap-3">
                  <Checkbox aria-label={named(one)} checked={state.ticked.includes(one.id)} disabled={!can(tick)} onCheckedChange={() => void send(tick)} />
                  <span className="min-w-0 wrap-anywhere">{named(one)}</span>
                </label>
              );
            })}
          </fieldset>
          <p role="status" className="text-sm text-muted-foreground">{count > maxChosen ? `Max ${maxChosen}` : count === 0 ? "Pick a calendar" : `${count} chosen`}</p>
          {footer("Check", { type: "check" })}
        </DialogContent>
      </Dialog>
    );
  }
  if (result === undefined) return null;
  const free = result.status === "free";
  return (
    <Dialog open onOpenChange={dismiss}>
      <DialogContent aria-label="Share availability" aria-describedby={undefined} className="flex max-h-[calc(var(--alpha-viewport-height,100dvh)-6rem)] flex-col gap-2.5 p-3.5">
        <DialogTitle><StatusDot status={free ? "ok" : "error"} label={free ? "Free" : "Busy"} showLabel className="text-md font-semibold" /></DialogTitle>
        <p className="text-sm text-muted-foreground tabular-nums">{span(result.window.start, result.window.end, result.window.timeZone)} ({result.window.timeZone})</p>
        {result.busy.length > 0 && (
          <div className="flex min-h-0 flex-col gap-1 overflow-y-auto overscroll-contain">
            <p className="text-sm font-semibold">Busy</p>
            <ul className="flex flex-col gap-1 text-sm tabular-nums">
              {result.busy.map((slot) => (
                <li key={`${slot.start} ${slot.end}`}>{span(slot.start, slot.end, result.window.timeZone)}{slot.allDay ? " · all day" : ""}{slot.tentative ? " · tentative" : ""}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-sm wrap-anywhere">Read from: {shown.chosen.map(named).join("; ")}.</p>
        <p className="text-sm text-muted-foreground">Shares times only</p>
        {footer("Share with agent", { type: "share" })}
      </DialogContent>
    </Dialog>
  );
}

/** The availability sheet over every view (areas.ts), on a runtime of its own: its machine and what it shows, and none of Calendar's, which a check from Home never starts. */
export default area(checking, AvailabilityReview);
