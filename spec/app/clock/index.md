# Clock

Alpha's built-in Clock: [Alarms](./alarms.md), [Timers](./timers.md),
[Stopwatch](./stopwatch.md) and [World Clock](./world.md). This spec owns the
screen's navigation between its four tabs, the editor or picker sheet over it,
Back priority, and the ringing alert priority between alarms and timers.

The alarms, timers and cities live with the resident agent, which the owner
can also ask to change them. Alpha reads them from the agent when it starts,
when it comes back to the front, and after each Ask Alpha turn, typed or
spoken, that ran a Clock action, so a timer cancelled in chat or by Talk
leaves Home and Clock at once.

Before Clock has its first answer, it shows its row of tabs, never a blank
screen.

## Story: Move between Clock tabs and sheets

> As the owner, I want to switch cleanly between Alarms, Timers, Stopwatch and
> World Clock, open one editor sheet at a time, and have Back close the sheet
> before leaving Clock.

### Clock holds its active tab, the sheet showing over it, any ringing alarm or timer, and whether alert audio is active

```quint
type Tab = Alarms | Timers | Stopwatch | World
type Sheet = NoSheet | NewAlarm | EditAlarm({ alarmId: int }) | NewTimer | AddCity
type AlertKind = NoAlert | AlarmRing({ id: int }) | TimerRing({ id: int })
type ClockView = {
  tab: Tab, sheet: Sheet, ringingAlarm: int, ringingTimer: int, soundOn: bool, muted: bool,
}

pure val initial: ClockView = {
  tab: Alarms, sheet: NoSheet, ringingAlarm: 0, ringingTimer: 0, soundOn: false, muted: false,
}

pure val tabValues = Set(Alarms, Timers, Stopwatch, World)
pure val sheetValues = Set(NoSheet, NewAlarm, EditAlarm({ alarmId: 1 }), NewTimer, AddCity)
pure val alarmIdValues = Set(0, 1, 2)
pure val timerIdValues = Set(0, 1, 2)
```

### Switching tabs happens when no sheet is open

```quint
pure def canSelectTab(s: ClockView, tab: Tab): bool = s.sheet == NoSheet and tab != s.tab

pure def selectTab(s: ClockView, tab: Tab): ClockView = { ...s, tab: tab }
```

### One sheet opens at a time, and editing an alarm requires a positive alarm id

```quint
pure def validSheet(sheet: Sheet): bool = match sheet {
  | EditAlarm(e) => e.alarmId > 0
  | _ => true
}

pure def canOpenSheet(s: ClockView, sheet: Sheet): bool =
  s.sheet == NoSheet and sheet != NoSheet and validSheet(sheet)

pure def openSheet(s: ClockView, sheet: Sheet): ClockView = { ...s, sheet: sheet }

pure def canCloseSheet(s: ClockView): bool = s.sheet != NoSheet

pure def closeSheet(s: ClockView): ClockView = { ...s, sheet: NoSheet }
```

### Back closes an open sheet before leaving Clock

```quint
pure def canBack(s: ClockView): bool = s.sheet != NoSheet

pure def back(s: ClockView): ClockView = { ...s, sheet: NoSheet }

pure def stepBackClosesSheet(before: ClockView, via: str, after: ClockView): bool =
  via == "back" implies (before.sheet != NoSheet and after.sheet == NoSheet)
```

### An edit-alarm sheet always names a positive alarm id

```quint
pure def alwaysValidEditAlarmSheet(s: ClockView): bool = validSheet(s.sheet)
```

## Story: Hear and prioritize ringing alerts

> As the owner, I want a ringing alarm to take priority over a ringing timer,
> alert audio to play only while something is ringing and unmuted, and muting
> to silence only the current ring.

Android keeps the next enabled alarm and each running timer while Clock is closed.
Pausing, editing, deleting and dismissing update those native deadlines. Tapping a
posted notification opens its Clock tab and selects the matching ringing alert within its kind. If an alarm has priority, a tapped timer opens after the alarm settles. Clock shows when Android notification
or exact alarm access limits delivery. When the standalone Clock is installed, the launcher opens it. Its scheduler takes over after it has loaded the resident agent’s Clock snapshot.

### A ringing alarm takes priority over a ringing timer

```quint
pure def activeAlert(s: ClockView): AlertKind =
  if (s.ringingAlarm > 0) AlarmRing({ id: s.ringingAlarm })
  else if (s.ringingTimer > 0) TimerRing({ id: s.ringingTimer })
  else NoAlert

pure def lawAlarmRingPriority(s: ClockView, alarmId: int, timerId: int): bool =
  alarmId > 0 implies activeAlert({ ...s, ringingAlarm: alarmId, ringingTimer: timerId }) == AlarmRing({ id: alarmId })
```

### Syncing ringing alerts updates playback and clears mute when a new ring starts or all rings end

```quint
pure def hasAlert(alarmId: int, timerId: int): bool = alarmId > 0 or timerId > 0

pure def canSyncAlerts(s: ClockView, alarmId: int, timerId: int): bool =
  alarmId >= 0 and timerId >= 0 and (alarmId != s.ringingAlarm or timerId != s.ringingTimer)

pure def syncAlerts(s: ClockView, alarmId: int, timerId: int): ClockView =
  val ringing = hasAlert(alarmId, timerId)
  val freshRing = (alarmId > 0 and alarmId != s.ringingAlarm) or (timerId > 0 and timerId != s.ringingTimer)
  val nextMuted = if (not(ringing) or freshRing) false else s.muted
  { ...s, ringingAlarm: alarmId, ringingTimer: timerId, muted: nextMuted, soundOn: ringing and not(nextMuted) }
```

### Muting silences alert audio while keeping the alert visible

```quint
pure def canMuteAlert(s: ClockView): bool = hasAlert(s.ringingAlarm, s.ringingTimer) and not(s.muted)

pure def muteAlert(s: ClockView): ClockView = { ...s, muted: true, soundOn: false }
```

### Alert ids are never negative, and audio or mute state holds only while an alert is ringing

```quint
pure def alwaysValidAlertIds(s: ClockView): bool = s.ringingAlarm >= 0 and s.ringingTimer >= 0

pure def alwaysSoundOnlyWhenRinging(s: ClockView): bool =
  s.soundOn implies (hasAlert(s.ringingAlarm, s.ringingTimer) and not(s.muted))

pure def alwaysMutedOnlyWhenRinging(s: ClockView): bool =
  s.muted implies hasAlert(s.ringingAlarm, s.ringingTimer)
```

### Every tab, sheet, ringing priority, and muted state is reachable

```quint
pure def sometimesWorldTab(s: ClockView): bool = s.tab == World

pure def sometimesEditingAlarm(s: ClockView): bool =
  val sh = s.sheet
  match sh {
    | EditAlarm(e) => e.alarmId > 0
    | _ => false
  }

pure def sometimesAlarmPriorityOverTimer(s: ClockView): bool =
  s.ringingAlarm > 0 and s.ringingTimer > 0 and activeAlert(s) == AlarmRing({ id: s.ringingAlarm })

pure def sometimesMutedAlert(s: ClockView): bool = s.muted and not(s.soundOn)
```
