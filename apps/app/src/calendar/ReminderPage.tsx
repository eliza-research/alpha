// spec/app/calendar/index.md, "Story: See reminders among my events"; spec/app/reminders/index.md, "Story: Create, update, flag, move, complete and delete reminders with Undo"
import type { ReminderCompletion, ReminderItemRecord } from "@repo/launcher-records";
import { Button, CalendarEventMenu, CalendarEventPage, CalendarEventRow, CalendarEventRows, cn } from "@repo/ui";
import { Effect } from "effect";
import { Bell, Repeat } from "lucide-react";
import { useRef } from "react";
import { Machine as Calendar } from "../../gen/app__calendar.effect.vibe";
import { useMachine as useCalendar } from "../../gen/app__calendar.react.ts";
import { useMachine as useReopen } from "../../gen/app__calendar__reminderReopen.react.ts";
import { snoozeSelectedReminder } from "../reminders/alerts.vibe";
import { deleteReminderItem, toggleReminderComplete } from "../reminders/reminders.vibe";
import { remindersStore } from "../reminders/store.ts";
import type { Alpha } from "../runtime/ui.tsx";
import { launcherTop } from "../shell/ui.tsx";
import type { CalendarProps } from "./Calendar.tsx";
import { startReminderEdit } from "./editor.vibe";
import { SourceNote } from "./SourceNote.tsx";
import { ReminderReview } from "./ReminderReview.tsx";
import { confirmReopening, reviewReopening } from "./reopen.vibe";
import type { DatedReminder } from "./reminders.ts";
import { zone } from "./time.ts";

const hour = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const date = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });

function noteFor(item: ReminderItemRecord): string {
  if (item.completed) return "Completed · no further alarm scheduled";
  if (item.alertMinutes === null) return "No alert · saved on this device";
  if (item.notifiedAtMs !== null) return "Notification posted";
  return "Scheduled. Alerts may arrive a few minutes late.";
}

function alertCaption(minutes: number): string {
  if (minutes === 0) return "Alert at start";
  if (minutes >= 60) return `Alert ${minutes / 60} hour before`;
  return `Alert ${minutes} min before`;
}

export function ReminderPage({ alpha, runtime, row, onBack }: { alpha: Alpha; runtime: CalendarProps["runtime"]; row: DatedReminder; onBack: () => void }) {
  const { record, begin } = row;
  const review = useReopen(runtime);
  const owner = useCalendar(runtime).state?.owner;
  const reviewTriggerRef = useRef<HTMLButtonElement>(null);
  const reviewing = review.state?.showing === true && review.state.reminderKey === record.id;
  const sending = review.state?.sending === true;
  const doCurrent = (change: (item: ReminderItemRecord) => void) => () => {
    const view = runtime.runSync(Effect.flatMap(Calendar, (calendar) => calendar.get()));
    const still = remindersStore.snapshot();
    const item = still.snapshot.items.find(({ id }) => id === record.id);
    if (!view.front || view.reminder !== row.id || still.hiddenIds.has(record.id) || item?.revision !== record.revision) return;
    change(item);
  };
  const edit = doCurrent((item) => { void runtime.runPromise(startReminderEdit(row.id, item, begin)); });
  const remove = doCurrent((item) => { void alpha.runtime.runPromise(deleteReminderItem(item.id, item.revision)); });
  const toggle = doCurrent((item) => { void alpha.runtime.runPromise(toggleReminderComplete(item.id, item.revision)); });
  const snooze = doCurrent((item) => { void alpha.runtime.runPromise(snoozeSelectedReminder(item.id, item.revision)); });
  const reopen = doCurrent((item) => { void runtime.runPromise(reviewReopening(row.id, item.id, item.revision, begin)); });
  const cancel = () => { if (review.can({ type: "cancel" })) void review.send({ type: "cancel" }); };
  const oneTime = record.recurrence === "none";
  const completion = record.completedAtMs;
  const kept = record.history ?? [];
  const occurrences: readonly ReminderCompletion[] = record.completed && completion !== null && !kept.some((item) => item.completedAtMs === completion && item.dueAtMs === begin)
    ? [...kept, { revision: record.revision, dueAtMs: begin, completedAtMs: completion }] : kept;
  const history = occurrences.map(({ revision, completedAtMs, dueAtMs, skippedDates }, at) => (
    <div key={revision} className={cn("text-caption text-muted-foreground", record.completed && at === 0 ? "mt-2.5" : "mt-2")}>
      {`Completed ${new Date(completedAtMs).toLocaleString()} · due ${new Date(dueAtMs).toLocaleString()}`}
      {skippedDates ? ` · ${skippedDates} elapsed repeat dates skipped` : null}
    </div>
  ));
  const snoozed = !record.completed && record.notifiedAtMs === null && record.alertMinutes !== null && record.snoozedUntilMs !== null
    ? `Snoozed until ${new Date(record.snoozedUntilMs).toLocaleString()}` : "";
  const repeats = oneTime ? "" : `${record.recurrence} · ${zone()}. ${record.alertMinutes === null
    ? "Next occurrence is saved with no alert after Done." : "Next occurrence is scheduled after Done."}`;
  const words = [record.notes, snoozed, repeats, noteFor(record)].filter(Boolean).join("\n");
  return (
    <CalendarEventPage className={launcherTop} title={record.title} when={`Due ${hour.format(begin)}`} day={date.format(begin)} source="Reminders" notes={words} onBack={onBack}
      actions={<CalendarEventMenu items={[{ label: "Edit", name: "Edit event", onSelect: edit }, { label: "Delete", name: "Delete event", onSelect: remove }]} />}>
      {owner !== undefined && <SourceNote runtime={runtime} account={owner} selection={row.id} target="Reminder" record={record.id} />}
      <div className={record.alertMinutes === null ? "mt-5 pb-5" : "mt-5"}>
        <span role="img" aria-label={oneTime ? record.completed ? "Completed." : "One-time reminder." : record.recurrence} className="block text-muted-foreground">
          <Repeat aria-hidden className="size-4.5" />
        </span>
        {record.completed ? history : null}
        {!record.completed || oneTime ? <div className={cn("flex flex-wrap gap-2", record.completed ? "mt-3" : "mt-3.5")}>
          <Button size="lg" variant={record.completed ? "secondary" : "primary"} className={record.completed ? "h-13 rounded-lg px-4 text-base font-normal" : "h-13 rounded-lg bg-foreground px-4 text-base font-normal text-background hover:bg-foreground/90"}
            ref={record.completed ? reviewTriggerRef : undefined} aria-label={record.completed ? "Reopen reminder" : "Complete reminder occurrence"}
            onClick={record.completed ? reopen : toggle}>{record.completed ? "Reopen" : "Done"}</Button>
          {!record.completed && record.alertMinutes !== null ? <Button size="lg" variant="secondary" className="h-13 rounded-lg px-4 text-base font-normal" aria-label="Snooze reminder 10 minutes" onClick={snooze}>10 min</Button> : null}
        </div> : null}
        {!record.completed ? history : null}
      </div>
      {record.alertMinutes !== null ? <CalendarEventRows><CalendarEventRow icon={<Bell />} text={alertCaption(record.alertMinutes)} /></CalendarEventRows> : null}
      <ReminderReview open={reviewing} title="Reopen?" details="No alert" action="Reopen" sending={sending}
        onApprove={() => void runtime.runPromise(confirmReopening())} onCancel={cancel} returnFocus={() => reviewTriggerRef.current} />
    </CalendarEventPage>
  );
}
