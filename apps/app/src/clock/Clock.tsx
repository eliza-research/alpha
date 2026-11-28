// spec/app/clock/index.md, "Story: Move between Clock tabs and sheets"
import { Alert, Button, Tabs, TabsContent, TabsList, TabsTrigger, cn, dockClearance } from "@repo/ui";
import { type ManagedRuntime, Option, Schema } from "effect";
import { initial } from "../../gen/app__clock.ts";
import type { Machine as ClockViewMachine, Tab } from "../../gen/app__clock.effect.vibe";
import { useMachine as useClockView } from "../../gen/app__clock.react.ts";
import type { Machine as StopwatchMachine } from "../../gen/app__clock__stopwatch.effect.vibe";
import type { Machine as ToastsMachine } from "../../gen/app__notices__toasts.effect.vibe";
import type { Said } from "../notices/index.vibe";
import { AlarmEditorSheet } from "./AlarmEditorSheet.tsx";
import { AlarmsTab } from "./AlarmsTab.tsx";
import { StopwatchTab } from "./StopwatchTab.tsx";
import type { ClockResident } from "./sync.vibe";
import { TimersTab } from "./TimersTab.tsx";
import { configureClockDelivery } from "./device.vibe";
import { useClockDelivery } from "./useClockStore.ts";
import { WorldClockTab } from "./WorldClockTab.tsx";

export interface ClockProps {
  /** Provides Clock's resident machines, stopwatch machine, and toast service. */
  runtime: ManagedRuntime.ManagedRuntime<ClockResident | ClockViewMachine | StopwatchMachine | ToastsMachine | Said, unknown>;
}

const TabSchema = Schema.Literals(["Alarms", "Timers", "Stopwatch", "World"]);
const decodeTab = Schema.decodeUnknownOption(TabSchema);

const TABS: ReadonlyArray<{ readonly value: Tab; readonly label: string }> = [
  { value: "Alarms", label: "Alarms" },
  { value: "Timers", label: "Timers" },
  { value: "Stopwatch", label: "Stopwatch" },
  { value: "World", label: "World" },
];

/**
 * Alpha's Clock screen: Alarms, Timers, Stopwatch, and World Clock tabs with modal editor sheets.
 * @model spec/app/clock/index.md
 */
export function Clock({ runtime }: ClockProps) {
  const view = useClockView(runtime);
  const state = view.state;
  const delivery = useClockDelivery(runtime);
  if (!state) return <div aria-busy className={cn("flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden px-4 pt-2", dockClearance)}><Tabs value={initial.tab}><ClockTabs /></Tabs></div>;

  const closeSheet = () => {
    if (view.can({ type: "closeSheet" })) void view.send({ type: "closeSheet" });
  };

  return (
    <div className={cn("flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden px-4 pt-2", dockClearance)}>
      {delivery ? (
        <Alert variant="warn">
          {delivery === "notifications" ? "Allow Clock notifications to hear background alerts." : delivery === "exact" ? "Allow alarms and reminders for Clock to receive alerts on time." : "Clock could not schedule background alerts."}
          {delivery === "notifications" || delivery === "exact" ? (
            <Button variant="ghost" size="sm" onClick={() => { void runtime.runPromise(configureClockDelivery(delivery)); }}>
              {delivery === "notifications" ? "Allow notifications" : "Open alarm settings"}
            </Button>
          ) : null}
        </Alert>
      ) : null}
      <Tabs
        value={state.tab}
        onValueChange={(next) => {
          const decoded = decodeTab(next);
          if (Option.isNone(decoded)) return;
          const tab = decoded.value;
          if (view.can({ type: "selectTab", tab })) void view.send({ type: "selectTab", tab });
        }}
      >
        <ClockTabs isDisabled={(tab) => tab !== state.tab && !view.can({ type: "selectTab", tab })} />

        <TabsContent value="Alarms">
          <AlarmsTab runtime={runtime} />
        </TabsContent>
        <TabsContent value="Timers">
          <TimersTab runtime={runtime} />
        </TabsContent>
        <TabsContent value="Stopwatch">
          <StopwatchTab runtime={runtime} />
        </TabsContent>
        <TabsContent value="World">
          <WorldClockTab runtime={runtime} />
        </TabsContent>
      </Tabs>

      {state.sheet.tag === "NewAlarm" && (
        <AlarmEditorSheet key="new" runtime={runtime} onClose={closeSheet} />
      )}
      {state.sheet.tag === "EditAlarm" && (
        <AlarmEditorSheet key={`edit-${state.sheet.alarmId}`} runtime={runtime} alarmId={state.sheet.alarmId} onClose={closeSheet} />
      )}
    </div>
  );
}

/** The row of Clock's tabs, drawn from the first frame so Clock opens with its frame in place. */
function ClockTabs({ isDisabled }: { isDisabled?: (tab: Tab) => boolean }) {
  return (
    <TabsList aria-label="Clock sections">
      {TABS.map((item) => (
        <TabsTrigger key={item.value} value={item.value} disabled={isDisabled?.(item.value)} className="px-2 text-xs sm:px-3 sm:text-sm">
          {item.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
