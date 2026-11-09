/// Device-protected settings, per-process consent and durable crash markers.
module NativeListenerStore {
  type Data = {consent: int, consentAt: int, enabled: bool, pause: int, pauseBoot: int,
    open: bool, markerBoot: int, markerInstall: int, exits: List[int], tripped: bool}
  type State = {memory: Data, disk: Data, generation: int, processConsent: bool,
    failed: bool, epoch: int, epochActive: bool, speechUnavailable: bool, indicatorLost: bool,
    stops: int, attempts: int, boot: int, install: int, reply: str}
  var s: State
  pure val empty = {consent: 0, consentAt: 0, enabled: false, pause: 0, pauseBoot: -1,
    open: false, markerBoot: -1, markerInstall: -1, exits: [], tripped: false}
  pure def fresh(st: State): bool = st.processConsent and not(st.failed)
  val visibleConsent = if (fresh(s)) s.memory.consent else 0
  val visibleEnabled = fresh(s) and s.memory.enabled
  val visiblePause = if (s.memory.pause != 0 and (s.memory.pauseBoot < 0 or s.boot < 0 or s.memory.pauseBoot != s.boot)) -1 else s.memory.pause
  pure def save(st: State, data: Data, result: str): State =
    if (st.failed) st else {
      val succeeded = result == "success"
      {...st, memory: if (result == "early-throw") st.memory else data,
       disk: if (result.in(Set("success", "durable-throw"))) data else st.disk,
       attempts: st.attempts + 1, failed: not(succeeded),
       processConsent: st.processConsent and succeeded,
       epoch: st.epoch + (if (succeeded) 0 else 1), epochActive: st.epochActive and succeeded,
       stops: st.stops + (if (succeeded) 0 else 1)}
    }
  pure def succeeds(st: State, result: str): bool = not(st.failed) and result == "success"
  pure def valid(result: str): bool = result.in(Set("success", "memory-failure", "early-throw", "durable-throw"))
  pure def answer(value: bool): str = if (value) "true" else "false"
  action init = s' = {memory: empty, disk: empty, generation: 0, processConsent: false,
    failed: false, epoch: 0, epochActive: false, speechUnavailable: false, indicatorLost: false,
    stops: 0, attempts: 0, boot: 1, install: 1, reply: "none"}
  action seed(open: bool, count: int, consent: bool, tripped: bool): bool = all {
    s.attempts == 0, s.generation == 0, count.in(0.to(8)),
    val data = {...empty, open: open, markerBoot: 1, markerInstall: 1,
      consent: if (consent) 1 else 0, enabled: consent,
      exits: [100, 100, 100, 100, 100, 100, 100, 100].slice(0, count), tripped: tripped}
    s' = {...s, memory: data, disk: data}
  }
  action grant(ticket: int, result: str): bool = all {
    valid(result), ticket.in(0.to(2)),
    if (ticket != s.generation) s' = {...s, reply: "false"} else {
      val saved = save(s, {...s.memory, consent: 1, consentAt: 100, enabled: true,
        pause: 0, exits: [], tripped: false}, result)
      val accepted = succeeds(s, result)
      s' = {...saved, processConsent: accepted, speechUnavailable: false,
        indicatorLost: s.indicatorLost and not(accepted), reply: answer(accepted)}
    }
  }
  action revoke(result: str): bool = all {
    valid(result),
    s' = {...save({...s, processConsent: false}, {...s.memory, consent: 0, consentAt: 0,
      enabled: false, pause: 0, exits: [], tripped: false, open: false}, result), reply: "void"}
  }
  action reset(result: str): bool = all {
    valid(result), s.generation < 2,
    s' = {...s, generation: s.generation + 1, processConsent: false,
      memory: if (result == "early-throw") s.memory else empty,
      disk: if (result.in(Set("success", "durable-throw"))) empty else s.disk,
      failed: result != "success", epoch: s.epoch + 1, epochActive: false,
      stops: s.stops + 1, attempts: s.attempts + 1, reply: answer(result == "success")}
  }
  action enable(active: bool, result: str): bool = all {
    valid(result),
    val data = {...s.memory, enabled: active, pause: 0,
      exits: if (active) [] else s.memory.exits, tripped: s.memory.tripped and not(active)}
    s' = {...save(s, data, result), speechUnavailable: s.speechUnavailable and not(active),
      indicatorLost: s.indicatorLost and not(active), reply: "void"}
  }
  action pause(until: int, result: str): bool = all {
    until.in(Set(-1, 200)), valid(result),
    s' = {...save(s, {...s.memory, pause: until, pauseBoot: s.boot}, result), reply: "void"}
  }
  action resume(result: str): bool = all {
    valid(result),
    s' = {...save(s, {...s.memory, pause: 0, exits: [], tripped: false}, result),
      speechUnavailable: false, indicatorLost: false, reply: "void"}
  }
  action session(open: bool, result: str): bool = all {
    valid(result),
    s' = {...save(s, {...s.memory, open: open, markerBoot: s.boot, markerInstall: s.install}, result),
      reply: answer(succeeds(s, result))}
  }
  action processStart(now: int, countOpen: bool, result: str): bool = all {
    now.in(Set(100, 200, 600100)), valid(result),
    val retained = s.memory.exits.select(time => time <= now and now - time < 600000)
    val unclean = countOpen and s.memory.open and s.memory.markerInstall == s.install and
      (s.memory.markerBoot < 0 or s.boot < 0 or s.memory.markerBoot == s.boot)
    val appended = if (unclean) retained.append(now) else retained
    val exits = if (appended.length() > 8) appended.slice(appended.length() - 8, appended.length()) else appended
    val tripped = s.memory.tripped or exits.length() >= 3
    s' = {...save(s, {...s.memory, exits: exits, tripped: tripped, open: false}, result), reply: answer(tripped)}
  }
  action environment(boot: int, install: int, unavailable: bool, lost: bool): bool = all {
    boot.in(Set(-1, 1, 2)), install.in(Set(-1, 1, 2)),
    s' = {...s, boot: boot, install: install, speechUnavailable: unavailable, indicatorLost: lost}
  }
  action arm = s' = {...s, epoch: s.epoch + 1, epochActive: true}
  action restart = s' = {...s, memory: s.disk, generation: 0, processConsent: false,
    failed: false, epoch: 0, epochActive: false, speechUnavailable: false, indicatorLost: false,
    stops: 0, attempts: 0, reply: "none"}
  action step = any {
    all {s.attempts < 4, s.epoch < 8, {
      nondet result = Set("success", "memory-failure", "early-throw", "durable-throw").oneOf()
      nondet flag = Bool.oneOf()
      nondet ticket = 0.to(2).oneOf()
      any {grant(ticket, result), revoke(result), reset(result), enable(flag, result), pause(-1, result),
        resume(result), session(flag, result), processStart(200, flag, result)}
    }},
    all {s.epoch < 8, arm},
    all {s.attempts == 0, s.generation == 0, {nondet open = Bool.oneOf()
      nondet count = 0.to(8).oneOf()
      nondet consent = Bool.oneOf()
      nondet tripped = Bool.oneOf()
      seed(open, count, consent, tripped)}},
    {nondet boot = Set(-1, 1, 2).oneOf()
     nondet install = Set(-1, 1, 2).oneOf()
     nondet unavailable = Bool.oneOf()
     nondet lost = Bool.oneOf()
     environment(boot, install, unavailable, lost)},
    restart, s' = s
  }
  val FailedStoreCannotAdmit = s.failed implies visibleConsent == 0 and not(visibleEnabled)
  val ConsentNeedsCurrentProcess = visibleConsent > 0 implies s.processConsent and not(s.failed)
  val WritesBounded = s.memory.exits.length() <= 8 and s.disk.exits.length() <= 8
  val safety = FailedStoreCannotAdmit and ConsentNeedsCurrentProcess and WritesBounded
  run failedCommitCannotRestoreConsentTest = init.then(grant(0, "memory-failure"))
    .then(grant(0, "success")).expect(safety and s.failed and visibleConsent == 0 and s.memory.consent == 1)
  run resetRecoversLatchButNeedsNewConsentTest = init.then(grant(0, "early-throw"))
    .then(reset("success")).then(grant(0, "success")).expect(safety and visibleConsent == 0)
    .then(grant(1, "success")).expect(safety and visibleConsent == 1)
  run durableLostAcknowledgementStillFailsClosedTest = init.then(grant(0, "durable-throw"))
    .expect(safety and s.disk.consent == 1 and visibleConsent == 0).then(restart)
    .expect(safety and s.memory.consent == 1 and visibleConsent == 0)
  run thirdUncleanStartTripsTest = init.then(seed(true, 2, true, false))
    .then(processStart(200, true, "success")).expect(safety and s.memory.tripped and s.reply == "true")
  run crashWindowExpiryDoesNotClearLatchTest = init.then(seed(false, 3, true, true))
    .then(processStart(600100, false, "success")).expect(safety and s.memory.tripped and s.memory.exits.length() == 0)
  run fullHistoryRetainsEightNewestTest = init.then(seed(true, 8, true, true))
    .then(processStart(200, true, "success")).expect(safety and s.memory.exits.length() == 8 and s.memory.exits.nth(7) == 200)
  run failedCloseRetainsDurableOpenMarkerTest = init.then(session(true, "success"))
    .then(session(false, "memory-failure")).then(restart)
    .expect(safety and s.memory.open and not(s.processConsent))
}
