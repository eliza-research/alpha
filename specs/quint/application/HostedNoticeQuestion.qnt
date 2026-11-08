// Retained Android result question review as driven by the renderer.
module HostedNoticeQuestion {
  type State = {owner: bool, sensitive: bool, composer: bool, phase: str, dialog: bool,
    proceed: bool, validation: str, interrupted: bool, closes: int, discards: int,
    rechecks: int, consumeCalls: int, consumed: int, composed: int, reports: int, fallback: int,
    resolving: bool, resolveCalls: int, resolveFailures: int}
  var s: State
  pure val Entry = Set("valid", "summary", "ordinary", "private")
  pure val Edits = Set("valid", "empty", "private")
  pure val Replies = Set("exact", "token", "body", "ordinary", "missing")
  pure def current(x: State): bool = x.owner and not(x.sensitive)
  pure def done(x: State): State = {...x, phase: "done", closes: 1}

  action init = s' = {owner: true, sensitive: false, composer: true, phase: "idle",
    dialog: false, proceed: false, validation: "", interrupted: false, closes: 0, discards: 0,
    rechecks: 0, consumeCalls: 0, consumed: 0, composed: 0, reports: 0, fallback: 0,
    resolving: false, resolveCalls: 0, resolveFailures: 0}
  action open(kind: str): bool = all {
    s.phase == "idle", Entry.contains(kind),
    s' = if (kind == "valid" and current(s))
      {...s, phase: "review", dialog: true, proceed: true}
      else {...s, phase: "fallback", fallback: 1},
  }
  action owner(value: bool): bool = s' = {...s, owner: value}
  action sensitive(value: bool): bool = s' = {...s, sensitive: value}
  action composerAllowed(value: bool): bool = s' = {...s, composer: value}
  action submit(edit: str): bool = all {
    s.phase == "review", Edits.contains(edit),
    s' = if (edit == "empty") {...s, proceed: false}
      else if (not(current(s))) {...s, proceed: false, validation: "stale"}
      else if (edit == "private") {...s, proceed: true, validation: "private"}
      else {...s, phase: "recheck", dialog: false, proceed: false, validation: "", rechecks: 1},
  }
  action dismiss(explicit: bool): bool = all {
    s.phase == "review",
    s' = done({...s, dialog: false, proceed: false, validation: "", interrupted: true,
      discards: if (explicit) 1 else 0}),
  }
  action interrupt = all {
    Set("recheck", "consume").contains(s.phase),
    s' = {...s, interrupted: true, closes: 1},
  }
  action recheck(reply: str): bool = all {
    s.phase == "recheck", Replies.contains(reply),
    s' = if (current(s) and not(s.interrupted) and s.composer and reply == "exact")
      {...s, phase: "consume", consumeCalls: 1}
      else done({...s, reports: s.reports + 1}),
  }
  action settleConsume(ok: bool): bool = all {
    s.phase == "consume",
    val publish = ok and current(s) and not(s.interrupted)
    s' = done({...s, consumed: if (ok) 1 else 0, composed: if (publish) 1 else 0,
      reports: if (publish) s.reports else s.reports + 1}),
  }
  action resolveTap =
    s' = if (s.resolving) s else {...s, resolving: true, resolveCalls: s.resolveCalls + 1}
  action finishResolve(ok: bool): bool = all {
    s.resolving, s' = {...s, resolving: false, resolveFailures: s.resolveFailures + if (ok) 0 else 1},
  }
  action step = any {
    { nondet kind = Entry.oneOf(); open(kind) },
    owner(true), owner(false), sensitive(true), sensitive(false),
    composerAllowed(true), composerAllowed(false),
    { nondet edit = Edits.oneOf(); submit(edit) },
    dismiss(true), dismiss(false), interrupt,
    { nondet reply = Replies.oneOf(); recheck(reply) },
    settleConsume(true), settleConsume(false), resolveTap, finishResolve(true), finishResolve(false),
  }
  val safety = all {
    s.dialog == (s.phase == "review"),
    s.proceed implies s.dialog,
    s.composed <= s.consumed and s.consumed <= s.consumeCalls,
    s.discards + s.consumeCalls <= 1,
    s.consumeCalls <= s.rechecks,
    s.resolveFailures <= s.resolveCalls,
  }
  run closedReviewLeavesNoticePendingTest = init.then(open("valid")).then(dismiss(false))
    .expect(s.closes == 1 and s.discards == 0 and s.consumeCalls == 0 and safety)
  run exactRecheckBeforeConsumptionTest = init.then(open("valid")).then(submit("valid"))
    .then(recheck("exact")).then(settleConsume(true))
    .expect(s.consumed == 1 and s.composed == 1 and safety)
  run consumptionCanOutliveAnInterruptedReviewTest = init.then(open("valid")).then(submit("valid"))
    .then(recheck("exact")).then(interrupt).then(settleConsume(true))
    .expect(s.consumed == 1 and s.composed == 0 and s.closes == 1 and safety)
  run resolverDropsOverlapAndCanRetryTest = init.then(resolveTap).then(resolveTap).then(finishResolve(false))
    .then(resolveTap).then(finishResolve(true))
    .expect(s.resolveCalls == 2 and s.resolveFailures == 1 and not(s.resolving) and safety)
}
