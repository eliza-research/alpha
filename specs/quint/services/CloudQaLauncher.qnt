// Isolated staging QA profile and one private child, with no readiness claim.
module CloudQaLauncher {
  type State = {
    kind: str, phase: str, profile: bool, marker: bool, token: bool, route: str,
    source: str, entry: bool, logOpen: bool, child: str, pid: bool, supervised: bool,
    receipt: str, fault: str, stop: str, cancelled: bool, childCode: int, childSignal: str,
    result: str, exitCode: int, tempClean: bool, foreignLogModeChanged: bool,
  }
  var s: State
  pure val InvalidLogs = Set("linkedLog", "hardlinkedLog", "fifoLog")
  pure val Kinds = Set("fresh", "personal", "saved", "wrongRoute", "badToken").union(InvalidLogs)
  pure val PreflightRefusals = Set("port", "key", "model", "personal", "path")
  pure val Signals = Set("SIGINT", "SIGTERM")
  pure val Codes = Set(0, 7, -1)

  action startState(kind: str, priorReceipt: bool): bool = all {
    Kinds.contains(kind), priorReceipt implies kind == "saved",
    s' = {kind: kind, phase: "checking", profile: kind != "fresh",
      marker: not(kind.in(Set("fresh", "personal"))), token: not(kind.in(Set("fresh", "personal"))),
      route: if (kind == "wrongRoute") "wrong" else if (kind.in(Set("fresh", "personal"))) "none" else "staging",
      source: "none", entry: false, logOpen: false, child: "none", pid: false, supervised: false,
      receipt: if (priorReceipt) "prior" else "none", fault: "none", stop: "none", cancelled: false,
      childCode: -1, childSignal: "none", result: "running", exitCode: -1, tempClean: true, foreignLogModeChanged: false},
  }
  action init = {
    nondet kind = Kinds.oneOf()
    nondet prior = (if (kind == "saved") Bool else Set(false)).oneOf()
    startState(kind, prior)
  }

  action checkEntry(source: str, present: bool): bool = all {
    s.phase == "checking", s.kind != "personal", source.in(Set("default", "explicit")),
    s' = {...s, phase: "entry", source: source, entry: present},
  }
  action prepareProfile: bool = all {
    s.phase == "entry", s.entry,
    s' = {...s, phase: "profile", profile: true, marker: true, token: true,
      route: if (s.kind == "wrongRoute") "wrong" else "staging"},
  }
  action openLog: bool = all {
    s.phase == "profile", s.route == "staging", s.kind != "badToken", not(InvalidLogs.contains(s.kind)),
    s' = {...s, phase: "log", logOpen: true},
  }
  action requestChild(pid: bool): bool = all {
    s.phase == "log",
    s' = {...s, phase: "requested", child: "requested", pid: pid},
  }
  action ownChild: bool = all {
    s.phase == "requested", s.child == "requested", not(s.supervised),
    s' = {...s, supervised: true},
  }
  action beginRecord: bool = all {
    s.phase == "requested", s.child == "requested", s.pid, s.supervised,
    s' = {...s, phase: "recording", child: "spawned"},
  }
  action stageReceipt: bool = all {
    s.phase == "recording", s.fault == "none", s.tempClean,
    s' = {...s, tempClean: false},
  }
  action discardReceipt: bool = all {
    s.phase == "recording", s.fault == "write", not(s.tempClean),
    s' = {...s, tempClean: true},
  }
  action refuseRecord(fault: str): bool = all {
    s.phase == "recording", s.fault == "none", fault == (if (s.tempClean) "revision" else "write"),
    s' = {...s, fault: fault},
  }
  action publishReceipt: bool = all {
    s.phase == "recording", s.fault == "none", not(s.tempClean),
    s' = {...s, phase: "published", receipt: "current", tempClean: true},
  }
  action activate: bool = all {
    s.phase == "published", not(s.cancelled),
    s' = {...s, phase: "running"},
  }
  action requestStop(signal: str, cancelled: bool): bool = all {
    s.supervised, s.stop == "none", Signals.contains(signal),
    not(cancelled) implies (signal == "SIGTERM" and (s.fault != "none" or not(s.pid))),
    s' = {...s, stop: signal, cancelled: cancelled},
  }
  action closeChild(code: int, signal: str): bool = all {
    s.child.in(Set("requested", "spawned")), s.supervised, Codes.contains(code),
    not(s.pid) implies (code == -1 and signal == "none"),
    s.pid implies (if (s.stop == "none") code.in(Set(0, 7)) and signal == "none"
      else code == -1 and signal == s.stop),
    s' = {...s, child: "closed", supervised: false, childCode: code, childSignal: signal},
  }
  action finish(result: str, exitCode: int): bool = all {
    s.phase != "done",
    any {
      s.phase == "checking" and PreflightRefusals.contains(result) and (result == "personal") == (s.kind == "personal") and exitCode == 1,
      s.phase == "entry" and not(s.entry) and result == "entry" and exitCode == 1,
      s.phase == "profile" and (
        (s.route == "wrong" and result == "route") or (s.kind == "badToken" and result == "token") or
        (s.route == "staging" and s.kind != "badToken" and result == "log")
      ) and exitCode == 1,
      s.phase == "requested" and s.child == "closed" and not(s.pid) and result == "spawn" and exitCode == 1,
      s.phase == "recording" and s.child == "closed" and s.fault != "none" and s.tempClean and result == s.fault and exitCode == 1,
      s.phase == "published" and s.child == "closed" and s.cancelled and result == "cancelled" and exitCode == 1,
      s.phase == "running" and s.child == "closed" and result == "child"
        and exitCode == (if (s.childCode == -1) 1 else s.childCode),
    },
    s' = {...s, phase: "done", logOpen: false, result: result, exitCode: exitCode},
  }

  val OwnedChildKeepsLog = s.supervised implies s.logOpen and s.child.in(Set("requested", "spawned"))
  val ReceiptRequiresSpawn = s.receipt == "current" implies s.pid and s.child.in(Set("spawned", "closed"))
  val AdmittedChildRequiresStagingProfile = s.child != "none" implies
    s.profile and s.marker and s.token and s.route == "staging" and s.entry
  val SettledOwnsNoLiveChild = s.phase == "done" implies
    not(s.supervised) and not(s.logOpen) and s.child.in(Set("none", "closed")) and s.tempClean
  val FailedRecordKeepsPriorReceipt = s.fault != "none" implies s.receipt != "current"
  val InvalidLogDoesNotAdmitChild = InvalidLogs.contains(s.kind) implies
    not(s.logOpen) and s.child == "none" and not(s.foreignLogModeChanged)
  val safety = OwnedChildKeepsLog and ReceiptRequiresSpawn and AdmittedChildRequiresStagingProfile
    and SettledOwnsNoLiveChild and FailedRecordKeepsPriorReceipt and InvalidLogDoesNotAdmitChild

  action step = any {
    { nondet source = Set("default", "explicit").oneOf()
      nondet present = Bool.oneOf()
      checkEntry(source, present) },
    prepareProfile, openLog,
    { nondet pid = Bool.oneOf()
      requestChild(pid) },
    ownChild, beginRecord, stageReceipt, discardReceipt,
    { nondet fault = Set("revision", "write").oneOf()
      refuseRecord(fault) },
    publishReceipt, activate,
    { nondet signal = Signals.oneOf()
      nondet cancelled = Bool.oneOf()
      requestStop(signal, cancelled) },
    { nondet code = Codes.oneOf()
      nondet signal = Signals.union(Set("none")).oneOf()
      closeChild(code, signal) },
    { nondet result = PreflightRefusals.union(Set("entry", "route", "token", "log", "spawn", "revision", "write", "child", "cancelled")).oneOf()
      nondet code = Set(0, 1, 7).oneOf()
      finish(result, code) },
    s' = s,
  }

  run successfulReceiptSurvivesChildExitTest = startState("fresh", false).then(checkEntry("default", true))
    .then(prepareProfile).then(openLog).then(requestChild(true)).then(ownChild).then(beginRecord).then(stageReceipt)
    .then(publishReceipt).then(activate).then(closeChild(7, "none")).then(finish("child", 7))
    .expect(s.receipt == "current" and safety)
  run badSavedRouteDoesNotLaunchTest = startState("wrongRoute", false).then(checkEntry("explicit", true))
    .then(prepareProfile).then(finish("route", 1)).expect(s.token and s.child == "none" and safety)
  run noPidErrorReleasesLogWithoutReceiptTest = startState("fresh", false).then(checkEntry("explicit", true))
    .then(prepareProfile).then(openLog).then(requestChild(false)).then(ownChild)
    .then(requestStop("SIGTERM", false)).then(closeChild(-1, "none")).then(finish("spawn", 1))
    .expect(s.receipt == "none" and safety)
  run failedRecordPreservesPriorReceiptAfterReapTest = startState("saved", true).then(checkEntry("explicit", true))
    .then(prepareProfile).then(openLog).then(requestChild(true)).then(ownChild).then(beginRecord).then(stageReceipt)
    .then(refuseRecord("write")).then(discardReceipt).then(requestStop("SIGTERM", false)).then(closeChild(-1, "SIGTERM"))
    .then(finish("write", 1)).expect(s.receipt == "prior" and safety)
  run cancelledPendingRecordCanStillPublishHistoricalReceiptTest = startState("fresh", false).then(checkEntry("explicit", true))
    .then(prepareProfile).then(openLog).then(requestChild(true)).then(ownChild).then(beginRecord).then(stageReceipt)
    .then(requestStop("SIGINT", true)).then(closeChild(-1, "SIGINT")).then(publishReceipt)
    .then(finish("cancelled", 1)).expect(s.receipt == "current" and safety)
  run linkedLogRefusesBeforeChildOrModeChangeTest = startState("linkedLog", false).then(checkEntry("explicit", true))
    .then(prepareProfile).then(finish("log", 1))
    .expect(s.child == "none" and not(s.foreignLogModeChanged) and safety)
  run hardlinkedLogRefusesBeforeChildOrModeChangeTest = startState("hardlinkedLog", false).then(checkEntry("explicit", true))
    .then(prepareProfile).then(finish("log", 1))
    .expect(s.child == "none" and not(s.foreignLogModeChanged) and safety)
  run fifoLogRefusesBeforeChildTest = startState("fifoLog", false).then(checkEntry("explicit", true))
    .then(prepareProfile).then(finish("log", 1))
    .expect(s.child == "none" and safety)
}
