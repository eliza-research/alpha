// Workflows owns the Clock draft until departure. Opening a Clock app is not an alarm result.
module WorkflowClockAdmission {
  type State = {browser: bool, view: str, shown: bool, review: bool, selection: str, hidden: bool,
    mock: bool, phase: str, record: str, handoffs: int, shows: int, opener: bool, retired: bool}
  var s: State

  action initFor(browser: bool): bool = s' = {browser: browser, view: "workflows", shown: false,
    review: false, selection: "workflow", hidden: false, mock: false, phase: "idle", record: "none",
    handoffs: 0, shows: 0, opener: false, retired: false}
  action init = any {initFor(false), initFor(true)}

  action enter = all {
    s.view == "home",
    s' = {...s, view: "workflows", selection: "workflow"},
  }
  action leave = all {
    s.view == "workflows",
    s' = {...s, view: "home", shown: false, review: false, selection: "none", opener: false,
      retired: s.phase == "saving"},
  }
  action remember = all {s.view == "workflows", s' = {...s, opener: true}}
  action openClock(retained: bool): bool = {
    val current = s.view == "workflows" and not(s.hidden) and s.phase == "idle" and (not(retained) or s.opener)
    if (not(current)) s' = s
    else if (s.browser and not(s.mock)) all {s.shows < 2, s' = {...s, shows: s.shows + 1}}
    else s' = {...s, shown: true, review: false, selection: "clock-draft"}
  }
  action closeClock = all {
    s.shown,
    if (s.phase != "idle") s' = s
    else s' = {...s, shown: false, review: false, selection: "workflow"},
  }
  action setMock(value: bool): bool = s' = {...s, mock: value}
  action setVisibility(hidden: bool): bool = s' = {...s, hidden: hidden,
    review: s.review and not(hidden), retired: s.retired or (hidden and s.phase == "saving")}

  action prepare = all {s.shown, s.phase == "idle", s' = {...s, review: true}}
  action approve = all {
    s.review,
    if (s.hidden or s.mock) s' = {...s, review: false}
    else if (s.browser) s' = s
    else s' = {...s, review: false, phase: "saving"},
  }
  action openingSaved = all {
    s.phase == "saving",
    if (s.retired or s.hidden or s.mock)
      s' = {...s, phase: "idle", record: "failed", retired: false}
    else all {
      s.handoffs < 2,
      s' = {...s, phase: "dispatching", record: "opening", handoffs: s.handoffs + 1},
    },
  }
  action finish(status: str): bool = all {
    s.phase == "dispatching", status.in(Set("opened", "unknown")),
    s' = {...s, phase: "idle", record: status},
  }

  action step = any {
    enter, leave, remember, openClock(false), openClock(true), closeClock, prepare, approve, openingSaved,
    setMock(true), setMock(false), setVisibility(true), setVisibility(false), finish("opened"), finish("unknown"), s' = s,
  }

  val WorkflowsOwnsClockDraft = (s.shown implies s.view == "workflows") and
    s.selection == (if (s.shown) "clock-draft" else if (s.view == "workflows") "workflow" else "none")
  val ReviewNeedsVisibleIdleDraft = s.review implies (s.shown and s.phase == "idle")
  val DispatchHasOpeningReceipt = (s.phase == "dispatching") == (s.record == "opening")
  val RetiredOpeningCannotDispatch = s.retired implies s.phase == "saving"
  val BrowserShowCannotWriteAlarmReceipt = s.browser implies (s.record == "none" and s.handoffs == 0 and s.phase == "idle")
  val safety = WorkflowsOwnsClockDraft and ReviewNeedsVisibleIdleDraft and DispatchHasOpeningReceipt and
    RetiredOpeningCannotDispatch and BrowserShowCannotWriteAlarmReceipt

  run exactWorkflowsVisitTest = initFor(false).then(remember).then(leave).then(openClock(true)).then(enter)
    .then(openClock(true)).expect(not(s.shown) and safety).then(openClock(false)).expect(s.shown and safety)
  run contextReturnsOnCloseTest = initFor(false).then(openClock(false)).then(prepare).then(closeClock)
    .expect(not(s.review) and s.selection == "workflow" and safety)
  run departureRetiresOpeningTest = initFor(false).then(openClock(false)).then(prepare).then(approve)
    .then(leave).then(enter).then(openClock(false)).then(openingSaved)
    .expect(s.record == "failed" and s.handoffs == 0 and not(s.shown) and safety)
  run requestedMockModeRetiresOpeningTest = initFor(false).then(openClock(false)).then(prepare).then(approve)
    .then(setMock(true)).then(openingSaved).expect(s.record == "failed" and s.handoffs == 0 and safety)
  run hiddenVisitRetiresOpeningTest = initFor(false).then(openClock(false)).then(prepare).then(approve)
    .then(setVisibility(true)).then(setVisibility(false)).then(openingSaved)
    .expect(s.record == "failed" and s.handoffs == 0 and safety)
  run dispatchedReceiptSettlesAfterDepartureTest = initFor(false).then(openClock(false)).then(prepare).then(approve)
    .then(openingSaved).then(leave).then(finish("unknown")).expect(s.record == "unknown" and s.handoffs == 1 and safety)
  run browserOpensShowWithoutDraftTest = initFor(true).then(openClock(false)).then(remember).then(leave).then(enter)
    .then(openClock(true)).expect(s.shows == 1 and not(s.shown) and s.record == "none" and safety)
}
