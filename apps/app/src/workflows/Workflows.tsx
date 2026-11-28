// spec/app/workflows/list.md, "Story: Find a workflow"; spec/app/workflows/index.md, "Story: Open a workflow"; spec/app/shell/index.md, "On the launcher the first page of Settings and of Workflows draws no Back, and Android's Back still leaves it"
import { Button, EmptyState, ListRow, Screen, Spinner, Switch, WorkflowChoice, WorkflowRow as WorkflowRowView, cn, focusRing } from "@repo/ui";
import { Bell, Calendar, ChevronDown, ChevronRight, Clock as ClockIcon, Info, Phone, Plus, Repeat, Sparkles, Sun, Workflow } from "lucide-react";
import { type MouseEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMachine } from "../../gen/app__workflows__list.react.ts";
import { type Event, badge, passes } from "../../gen/app__workflows__list.ts";
import { canFile } from "../../gen/app__workflows__request.ts";
import type { Machine } from "../../gen/app__workflows__list.effect.vibe";
import type { Machine as RunSheet } from "../../gen/app__workflows__sheet.effect.vibe";
import type { Machine as WorkflowMachine } from "../../gen/app__workflows.effect.vibe";
import { useMachine as useWorkflow } from "../../gen/app__workflows.react.ts";
import type { Machine as RunsMachine } from "../../gen/app__workflows__runs.effect.vibe";
import type { Machine as ApprovalsMachine } from "../../gen/app__workflows__approvals.effect.vibe";
import { useMachine as useApprovals } from "../../gen/app__workflows__approvals.react.ts";
import type { Machine as BuilderMachine } from "../../gen/app__workflows__builder.effect.vibe";
import type { Machine as GenerateMachine } from "../../gen/app__workflows__generate.effect.vibe";
import { Authoring } from "./Authoring.tsx";
import type { DraftWords } from "./authoring.vibe";
import type { Machine as AutomationsMachine } from "../../gen/app__workflows__automations.effect.vibe";
import { useMachine as useAutomations } from "../../gen/app__workflows__automations.react.ts";
import { Automation, AutomationPower, automationSource } from "./Automation.tsx";
import type { AutomationWords } from "./automations.vibe";
import type { Machine as ClockMachine } from "../../gen/app__workflows__clock.effect.vibe";
import { useMachine as useClock } from "../../gen/app__workflows__clock.react.ts";
import { useMachine as useBuilder } from "../../gen/app__workflows__builder.react.ts";
import { type AlarmLabel, clockAvailable } from "./clock.vibe";
import { ClockPage } from "./Clock.tsx";
import { newPhoneReminder } from "./handoffs.vibe";
import type { Machine as DigestMachine } from "../../gen/app__digests__schedules.effect.vibe";
import { Digests } from "./Digests.tsx";
import type { DigestWords } from "./digests.vibe";
import { ApprovalWords } from "./approvals.vibe";
import type { Resident, Shown } from "../runtime/ui.tsx";
import { AppBack } from "../shell/ui.tsx";
import { Filters, kinds, statuses } from "./Filters.tsx";
import { History, WorkflowPower } from "./History.tsx";
import type { HistoryWordsPort } from "./history.vibe";
import { DefinitionWords, toggleListRow } from "./lifecycle.vibe";
import { Rows, type WorkflowRow, refresh, shownUnder } from "./list.vibe";

const remoteConnection = "Connect your remote agent in Settings.";
const signedOutChoices = [
  { name: "Automation", Icon: Repeat },
  { name: "Reminder", Icon: Bell },
];
const addRow = "min-h-16 rounded-segment bg-secondary px-3 disabled:opacity-100 aria-disabled:opacity-100 [&>span>span:first-child]:font-semibold [&>span>span:nth-child(2)]:text-sm";

const labels = { On: "Active", Off: "Paused", WaitingForYou: "Waiting for you", HistoryKept: "Removed" };
const icons = { Reminder: Bell, Prompt: Sparkles, Routine: Workflow, Schedule: Calendar };
const taskWords: Readonly<Record<string, string>> = {
  scheduled: "Scheduled", fired: "Sent", acknowledged: "Acknowledged", skipped: "Skipped", expired: "Expired",
  failed: "Failed", dismissed: "Dismissed", completed: "Completed",
};
const ended = ["completed", "dismissed", "skipped", "expired", "failed"];
const problemWords = {
  Workflows: "Workflows", "Removed workflows": "Removed workflows", Prompts: "Automations", "Scheduled tasks": "Scheduled items",
} as const;
/**
 * The header on the phone's launcher, as the Sunday v119 demo build drew it (Alpha 45f6bed30): 44px down and 56px tall
 * (prototype/template.html:3697), the list's title row 20px in with its 44px New button (template.html:3697,3700,
 * prototype.css:13), a page inside Workflows 12px in with a 44px Back right against its 26px bold sans title at 1.2
 * leading, leading-plain being the nearest token (automations.css:17,22, template.html:3744), and a routine's page 8px
 * in with no title in its header (template.html:3791-3793).
 */
const launcherFrame = "in-data-[alpha-launcher]:pt-[max(--spacing(11),var(--alpha-native-inset-top,0px),env(safe-area-inset-top))] in-data-[alpha-launcher]:[&>header]:min-h-14";
const launcherBack = "in-data-[alpha-launcher]:[&>header>button[aria-label=Back]]:size-11 in-data-[alpha-launcher]:[&>header>button[aria-label=Back]]:min-w-11 in-data-[alpha-launcher]:[&>header>button[aria-label=Back]]:rounded-full";
const launcherHeader = {
  list: cn(launcherFrame, "in-data-[alpha-launcher]:[&>header]:pl-5"),
  page: cn(launcherFrame, launcherBack, "in-data-[alpha-launcher]:[&>header]:gap-0 in-data-[alpha-launcher]:[&>header]:px-3 in-data-[alpha-launcher]:[&>header>h1]:font-sans in-data-[alpha-launcher]:[&>header>h1]:text-home-display in-data-[alpha-launcher]:[&>header>h1]:leading-plain in-data-[alpha-launcher]:[&>header>h1]:font-bold in-data-[alpha-launcher]:[&>header>h1]:tracking-tight in-data-[alpha-launcher]:[&>header>h1]:wrap-anywhere"),
  routine: cn(launcherFrame, launcherBack),
};
/** The body of a page inside Workflows, at develop's 24px sides. */
const inset = "-mx-4 -mt-1 flex flex-col px-6 pt-2";
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });

function listLabel(kind: keyof typeof kinds, status: keyof typeof statuses) {
  const type = kind === "AllKinds" ? "All workflows" : kinds[kind];
  return status === "AnyStatus" ? type : `${type} · ${statuses[status]}`;
}

function statusWord(row: WorkflowRow, waiting = false): string {
  if (row.kind === "Reminder" || row.kind === "Schedule") {
    const status = row.record.state.status;
    return row.record.trigger.kind === "manual" && !ended.includes(status) ? "Paused" : taskWords[status] ?? "Unknown";
  }
  return labels[badge(row.on, row.removed, waiting)];
}

/** When a detail page says it runs: a reminder's whole due date, otherwise the row's own line. */
function detailWhen(row: WorkflowRow): string {
  if (row.kind !== "Reminder" || row.record.trigger.kind !== "once") return row.line;
  const due = Date.parse(row.record.trigger.atIso ?? "");
  return Number.isFinite(due) ? fullDate.format(due) : row.line;
}

function WorkflowListRow({ row, waiting, canToggle, open, onToggle }: {
  row: WorkflowRow;
  waiting: boolean;
  canToggle: boolean;
  open: () => void;
  onToggle: () => void;
}) {
  const Icon = icons[row.kind];
  const canManage = !row.removed && (row.kind === "Routine" || row.kind === "Prompt");
  const failed = (row.kind === "Reminder" || row.kind === "Schedule") && row.record.state.status === "failed";
  return (
    <WorkflowRowView
      title={row.title}
      summary={row.line}
      failed={failed}
      status={statusWord(row, waiting)}
      icon={<Icon />}
      onClick={open}
      trailing={canManage ? (
        <Switch
          aria-label={`Turn ${row.title} ${row.on ? "off" : "on"}`}
          checked={row.on}
          disabled={!canToggle}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={onToggle}
        />
      ) : undefined}
    />
  );
}

/** The owner's workflows, prompts, reminders and schedules, with the last filter choices kept while looking at a row. */
export function Workflows({ runtime, alpha }: Shown<Resident | Rows | Machine | RunSheet | HistoryWordsPort | WorkflowMachine | DefinitionWords | RunsMachine | ApprovalsMachine | ApprovalWords | BuilderMachine | GenerateMachine | DraftWords | AutomationsMachine | AutomationWords | ClockMachine | AlarmLabel | DigestMachine | DigestWords>) {
  const { state, can, send } = useMachine(runtime);
  const rowsService = runtime.runSync(Rows);
  const rowsSnapshot = useSyncExternalStore(rowsService.subscribe, rowsService.snapshot, rowsService.snapshot);
  const approvalWords = runtime.runSync(ApprovalWords);
  const pendingApproval = useSyncExternalStore(approvalWords.subscribe, approvalWords.snapshot, approvalWords.snapshot);
  const definitionWords = runtime.runSync(DefinitionWords);
  const definitionSnapshot = useSyncExternalStore(definitionWords.subscribe, definitionWords.snapshot, definitionWords.snapshot);
  const [clockSurface, setClockSurface] = useState<HTMLDivElement | null>(null);
  const clockOpenerRef = useRef<HTMLButtonElement>(null);
  const filterOpenerRef = useRef<HTMLButtonElement>(null);
  const automations = useAutomations(runtime);
  const workflowModel = useWorkflow(runtime);
  const approvals = useApprovals(runtime);
  const editingAutomation = automations.state?.editing;
  const editingWorkflow = useBuilder(runtime).state?.open;
  const clock = useClock(runtime);
  const hasClock = clockAvailable();
  const openClock = { type: "openClock", available: hasClock } as const;
  const showClock = (event: MouseEvent<HTMLButtonElement>) => {
    if (!clock.can(openClock)) return;
    clockOpenerRef.current = event.currentTarget;
    void clock.send(openClock);
  };
  const [more, setMore] = useState(false);
  const read = () => void runtime.runPromiseExit(refresh());
  const owner = state?.owner;
  const kind = state?.kind;
  const status = state?.status;
  const snapshot = useMemo(
    () => owner !== undefined && status !== undefined && rowsSnapshot.owner === owner
      ? shownUnder(rowsSnapshot, status)
      : undefined,
    [rowsSnapshot, owner, status],
  );
  const rows = useMemo(
    () => kind !== undefined && status !== undefined && snapshot !== undefined
      ? snapshot.rows.filter((row) => passes(row.kind, row.on, row.removed, kind, status))
        .toSorted((one, other) => Number(other.on) - Number(one.on) || one.title.localeCompare(other.title))
      : [],
    [snapshot, kind, status],
  );
  const isWaiting = (row: WorkflowRow) =>
    state !== undefined &&
    approvals.state?.approval === "Waiting" &&
    approvals.state.owner === state.owner &&
    pendingApproval?.owner === state.owner &&
    pendingApproval.number === approvals.state.digest &&
    pendingApproval.run.workflowId === row.id;
  const canToggleRow = (row: WorkflowRow) =>
    state !== undefined &&
    state.list.status === "Loaded" &&
    !row.removed &&
    !definitionSnapshot.toggling.has(row.number) &&
    (row.kind === "Routine"
      ? workflowModel.state !== undefined && canFile(workflowModel.state.change)
      : row.kind === "Prompt"
        ? automations.state !== undefined && canFile(automations.state.change)
        : false);
  const dispatch = (event: Event) => { if (can(event)) void send(event); };
  const place = state?.place;
  const selected = place?.tag === "ListingDetail" ? snapshot?.rows.find((row) => row.number === place.row) : undefined;
  const title = selected?.title ?? (place?.tag === "ListingAdd" ? "Add to Workflows" : place?.tag === "ListingDigests"
    ? place.result === 0 ? "Scheduled digests" : "Digest" : "Workflows");
  const openDigests: Event = { type: "openDigests" };
  const filter = { type: "openFilters" } as const;
  const add = { type: "openAdd" } as const;
  const listing = place?.tag === "ListingRows" || place === undefined;
  const screen = (
    <Screen title={title} inert={clock.state?.open === true} leading={<AppBack alpha={alpha} firstPage={listing} />}
      className={listing ? launcherHeader.list : selected?.kind === "Routine" ? launcherHeader.routine : launcherHeader.page}
      actions={<>
      {place?.tag === "ListingRows" && <Button variant="ghost" size="icon" aria-label="Add to Workflows" className="in-data-[alpha-launcher]:size-11! in-data-[alpha-launcher]:min-w-11!" onClick={() => dispatch(add)}><Plus aria-hidden /></Button>}
      {selected?.kind === "Prompt" && state && <AutomationPower runtime={runtime} row={selected} owner={state.owner} />}
      {selected?.kind === "Routine" && state && <WorkflowPower runtime={runtime} row={selected} owner={state.owner} />}
    </>} {...(selected?.kind === "Routine" ? { titleControl: <span className="grow" /> } : {})}>
      {state === undefined && <Spinner aria-label="Refreshing workflows" />}
      {state !== undefined && place?.tag === "ListingRows" && <>
        <div className="mx-2 flex min-h-12 items-center justify-between gap-3">
          <Button ref={filterOpenerRef} variant="ghost" className="h-12 min-w-0 gap-1.5 rounded-lg px-0 text-sm font-normal" aria-label="Filter workflows"
            aria-haspopup="dialog" disabled={!can(filter)} onClick={() => dispatch(filter)}>
            {listLabel(state.kind, state.status)}<ChevronDown aria-hidden className="size-4" />
          </Button>
          {(state.list.status === "Loaded" || state.owner === 0) && <span className="shrink-0 text-label text-muted-foreground">{rows.length} {rows.length === 1 ? "item" : "items"}</span>}
        </div>
        {(state.list.status === "Loading" || (state.owner > 0 && state.list.status === "Idle")) && (
          <div role="status" className="mx-2 flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Spinner size="sm" aria-hidden /><span className="sr-only">Refreshing workflows…</span>
          </div>
        )}
        {state.owner === 0 && <p role="status" className="mx-2 flex items-center gap-2 px-1 text-sm leading-chat text-muted-foreground">
          <Info aria-hidden className="size-4 shrink-0" />{remoteConnection}
        </p>}
        {state.list.status === "Failed" && state.owner > 0 && (
          <div className="mx-2 flex items-center gap-2 px-1 text-sm text-muted-foreground" role="status">
            <Info aria-hidden className="size-4" /><span>Workflows couldn’t be read.</span>
            <Button variant="ghost" size="icon" aria-label="Retry workflows" onClick={read}><Repeat aria-hidden /></Button>
          </div>
        )}
        {snapshot?.problems.map((source) => <p key={source} role="alert" className="mx-2 px-1 text-sm leading-chat">
          {problemWords[source]} could not refresh. Retry to check the current records.
        </p>)}
        {state.list.status === "Loaded" && rows.length === 0 && (
          <p className="mx-2 flex items-center gap-2 px-1 text-sm leading-normal text-muted-foreground">
            <Repeat aria-hidden className="size-4.5" />
            {!state.complete ? "No workflows could be listed" : state.status === "Removed" ? "No removed workflows" : state.kind === "AllKinds" && state.status === "AnyStatus" ? "No workflows yet" : "No matches"}
          </p>
        )}
        {rows.length > 0 && <ul aria-label="Workflows" className="mx-2">
          {rows.map((row) => <WorkflowListRow
            key={row.number}
            row={row}
            waiting={isWaiting(row)}
            canToggle={canToggleRow(row)}
            open={() => dispatch({ type: "openRow", row: row.number })}
            onToggle={() => void runtime.runPromiseExit(toggleListRow(state.owner, row))}
          />)}
        </ul>}
        <Filters listing={state} can={can} send={dispatch} refresh={read} restoreFocus={() => filterOpenerRef.current?.focus()} />
      </>}
      {state?.owner === 0 && place?.tag === "ListingAdd" && (
        <div className="mx-2 flex flex-col gap-1.5 pt-1">
          {signedOutChoices.map(({ name, Icon }) => <ListRow key={name} className={addRow + " min-h-16.25"} title={name} detail={remoteConnection} leading={<Icon />} trailing={<ChevronRight aria-hidden className="size-4" />} asChild disabled><button type="button" disabled /></ListRow>)}
          <ListRow className={addRow} title="Scheduled digest" leading={<Sun />} trailing={<ChevronRight aria-hidden className="size-4" />} asChild disabled><button type="button" disabled /></ListRow>
          <ListRow className={addRow} title="Alarm" aria-label="Clock alarms" leading={<ClockIcon />} trailing={<ChevronRight aria-hidden className="size-4" />} disabled={!hasClock} aria-haspopup="dialog" onClick={showClock} />
          <details className="group rounded-lg">
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm text-muted-foreground">
              <span className="group-open:hidden">More options</span>
              <span className="hidden group-open:inline">Fewer options</span>
            </summary>
            <ListRow className={addRow} title="Steps" detail={remoteConnection} leading={<Workflow />} asChild disabled><button type="button" disabled /></ListRow>
            <ListRow className={addRow} title="Phone reminder" leading={<Bell />} trailing={<ChevronRight aria-hidden />} onClick={() => void runtime.runPromiseExit(newPhoneReminder())} />
          </details>
          <p role="status" className="mt-2.25 text-base leading-chat text-foreground">{remoteConnection}</p>
        </div>
      )}
      {state !== undefined && state.owner > 0 && place?.tag === "ListingAdd" && <div className={cn(inset, "gap-0.5")}>
        {!editingWorkflow && <Automation runtime={runtime} owner={state.owner} />}
        {!editingAutomation && !editingWorkflow && <>
          {can(openDigests) && <WorkflowChoice label="Scheduled digest" icon={<Sun />} onClick={() => dispatch(openDigests)} />}
          {hasClock && <WorkflowChoice label="Alarm" icon={<ClockIcon />} aria-label="Clock alarms" aria-haspopup="dialog" onClick={showClock} />}
          <button type="button" aria-expanded={more} onClick={() => setMore(!more)}
            className={cn(focusRing, "min-h-11 py-2.5 text-left text-lg text-muted-foreground")}>{more ? "Fewer options" : "More options"}</button>
        </>}
        {!editingAutomation && <Authoring runtime={runtime} owner={state.owner} offered={more} />}
        {!editingAutomation && !editingWorkflow && more && (
          <WorkflowChoice label="Phone reminder" icon={<Phone />} onClick={() => void runtime.runPromiseExit(newPhoneReminder())} />
        )}
      </div>}
      {state && place?.tag === "ListingDigests" && <Digests runtime={runtime} owner={state.owner} result={place.result}
        notice={place.notice.runId === "" ? undefined : place.notice}
        onResult={(result) => dispatch({ type: "openDigestResult", result })} />}
      {place?.tag === "ListingDetail" && (selected === undefined || state === undefined
        ? <EmptyState title="This item is no longer listed" />
        : selected.kind === "Routine"
          ? <History runtime={runtime} row={selected} owner={state.owner} />
          : <div className="-mx-4 -mt-1 px-6 pt-2">
            <p className="px-1 text-sm leading-chat text-muted-foreground">{automationSource(selected)} · {statusWord(selected, isWaiting(selected))}</p>
            {selected.line !== "" && <p className="my-3.75 leading-chat">{detailWhen(selected)}</p>}
            {selected.summary !== "" && <p className="my-3.75 leading-chat whitespace-pre-wrap break-words">{selected.summary}</p>}
            <Automation runtime={runtime} row={selected} owner={state.owner} />
            {selected.kind === "Prompt" && <History runtime={runtime} row={selected} owner={state.owner} />}
          </div>)}
    </Screen>
  );
  return (
    <div ref={setClockSurface} className="relative flex min-h-0 flex-1 flex-col">
      {screen}
      {clockSurface && clock.state?.open && <ClockPage runtime={runtime} container={clockSurface} restoreFocus={() => clockOpenerRef.current?.focus()} />}
    </div>
  );
}
