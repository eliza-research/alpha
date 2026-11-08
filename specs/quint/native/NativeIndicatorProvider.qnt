/// Actual provider admission, generation/death-link pairing and caller restoration.
module NativeIndicatorProvider {
  type State = {generation: int, live: bool, acknowledged: bool, expiresAt: int,
    leaseBoot: int, surface: bool, chip: bool, recording: bool, display: str, reason: str,
    lastLoss: str, linkedToken: int, linkedGeneration: int, now: int, boot: int,
    reply: str, returnedGeneration: int, accepted: bool, identities: int}
  var s: State
  pure def ended(st: State, loss: str): State = {...st, live: false, acknowledged: false,
    surface: false, chip: false, recording: false, display: "on", reason: "none", lastLoss: loss}
  pure def checked(st: State): State =
    if (st.live and st.boot != st.leaseBoot) ended(st, "other_boot")
    else if (st.live and st.acknowledged and st.now >= st.expiresAt) ended(st, "expired") else st
  pure def response(st: State, reply: str): State = {...st, reply: reply, returnedGeneration: 0, accepted: false}
  action init = s' = {generation: 0, live: false, acknowledged: false, expiresAt: 0,
    leaseBoot: -1, surface: false, chip: false, recording: false, display: "on", reason: "none",
    lastLoss: "never_acquired", linkedToken: 0, linkedGeneration: 0, now: 100, boot: 1,
    reply: "none", returnedGeneration: 0, accepted: false, identities: 0}
  action acquire(token: int, alive: bool): bool = all {
    token.in(1.to(3)), s.generation < 3,
    val before = checked(s)
    val generation = before.generation + 1
    val acquired = {...response(before, "acquire"), generation: generation, live: true,
      acknowledged: false, leaseBoot: s.boot, surface: false, chip: false, recording: false,
      display: "on", reason: "none", lastLoss: if (before.live) "replaced" else before.lastLoss,
      linkedToken: if (alive) token else 0, linkedGeneration: if (alive) generation else 0,
      returnedGeneration: generation}
    s' = if (alive) acquired else ended(acquired, "binder_died")
  }
  action renew(generation: int, report: str): bool = all {
    generation.in(0.to(3)), report.in(Set("visible", "hidden", "chip_hidden", "off", "aod", "fullscreen", "shade", "transition", "unknown")),
    val before = response(checked(s), "refused")
    val surface = report.in(Set("visible", "chip_hidden"))
    val display = if (report == "off") "off" else if (report == "aod") "doze" else if (report == "unknown") "unknown" else "on"
    val reason = if (report.in(Set("fullscreen", "shade", "transition"))) report else "none"
    val extends = surface or display != "on" or reason != "none"
    s' = if (before.live and generation == before.generation)
      {...before, reply: "accepted", accepted: true, surface: surface,
       chip: report == "visible", recording: report.in(Set("visible", "chip_hidden")),
       display: display, reason: reason, acknowledged: before.acknowledged or extends,
       expiresAt: if (extends) s.now + 3000 else before.expiresAt} else before
  }
  action revoke(generation: int): bool = all {
    generation.in(0.to(3)),
    val before = response(checked(s), "empty")
    s' = if (before.live and generation == before.generation) ended(before, "revoked") else before
  }
  action binderDeath(generation: int): bool = all {
    generation.in(1.to(s.generation)),
    s' = if (s.live and generation == s.generation) ended(s, "binder_died") else s
  }
  action failedCall(kind: str): bool = all {
    kind.in(Set("security", "argument")),
    s' = response(if (kind == "argument") checked(s) else s, kind)
  }
  action environment(now: int, boot: int): bool = all {
    now.in(Set(100, 3099, 3100, 6200)), now >= s.now, boot.in(Set(1, 2)),
    s' = {...s, now: now, boot: boot}
  }
  action step = any {
    all {s.generation < 3, {
      nondet token = 1.to(3).oneOf()
      nondet alive = Bool.oneOf()
      acquire(token, alive)
    }},
    {
      nondet generation = 0.to(3).oneOf()
      nondet report = Set("visible", "hidden", "chip_hidden", "off", "aod", "fullscreen", "shade", "transition", "unknown").oneOf()
      renew(generation, report)
    },
    {nondet generation = 0.to(3).oneOf()
     revoke(generation)},
    all {s.generation > 0, {nondet generation = 1.to(s.generation).oneOf()
      binderDeath(generation)}},
    {nondet kind = Set("security", "argument").oneOf()
     failedCall(kind)},
    {nondet now = Set(100, 3099, 3100, 6200).oneOf()
     nondet boot = Set(1, 2).oneOf()
     environment(now, boot)},
    s' = s
  }
  val LiveGenerationOwnsDeathLink = s.live implies s.linkedToken != 0 and s.linkedGeneration == s.generation
  val CallerIdentityRestored = s.identities == 0
  val Bounded = s.generation.in(0.to(3)) and s.linkedGeneration.in(0.to(3)) and s.linkedToken.in(0.to(3))
  val AcceptedReplyHasGeneration = s.accepted implies s.reply == "accepted" and s.generation > 0
  val safety = LiveGenerationOwnsDeathLink and CallerIdentityRestored and Bounded and AcceptedReplyHasGeneration
  run replacementKeepsMatchingDeathLinkTest = init.then(acquire(1, true)).then(acquire(2, true))
    .then(binderDeath(1)).expect(safety and s.live and s.linkedGeneration == 2)
  run deadTokenCannotOwnLiveLeaseTest = init.then(acquire(1, false)).expect(safety and not(s.live) and s.linkedToken == 0)
  run revokeKeepsDeathRegistrationTest = init.then(acquire(1, true)).then(revoke(1))
    .expect(safety and not(s.live) and s.linkedToken == 1)
  run securityFailurePreservesLeaseTest = init.then(acquire(1, true)).then(failedCall("security"))
    .expect(safety and s.live and s.identities == 0)
  run expiryCheckedBeforeMissingArgumentTest = init.then(acquire(1, true)).then(renew(1, "visible"))
    .then(environment(3100, 1)).then(failedCall("argument"))
    .expect(safety and not(s.live) and s.lastLoss == "expired")
  run otherBootRefusesRenewalTest = init.then(acquire(1, true)).then(environment(100, 2)).then(renew(1, "visible"))
    .expect(safety and not(s.live) and not(s.accepted))
}
