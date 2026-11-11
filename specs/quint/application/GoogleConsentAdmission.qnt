// Current Google account readback and consent admission in the mounted panel.
module GoogleConsentAdmission {
  type Read = {owner: int, kind: str}
  type PermissionWait = {owner: int, read: int, panel: int}
  type Dispatch = {owner: int, read: int, held: int, floor: int, tier: int}
  type State = {mode: str, panel: int, owner: int, latest: int, pending: Set[int], reads: int -> Read,
    verified: int, tier: int, unverified: bool, savedOn: bool, permission: PermissionWait,
    choice: bool, dispatches: List[Dispatch]}
  var s: State
  pure val ReadIds = 1.to(6)
  pure val Tiers = 1.to(3)
  pure val NoPermission: PermissionWait = {owner: 0, read: 0, panel: 0}
  action initWith(savedOn: bool): bool = s' = {mode: "closed", panel: 0, owner: 1, latest: 0,
    pending: Set(), reads: ReadIds.mapBy(_ => {owner: 0, kind: "none"}), verified: 0, tier: 0,
    unverified: false, savedOn: savedOn, permission: NoPermission, choice: false, dispatches: List()}
  action init = initWith(true)
  pure def beginRead(value: State, kind: str): State = {
    val id = value.latest + 1
    {...value, latest: id, pending: value.pending.union(Set(id)),
      reads: value.reads.set(id, {owner: value.owner, kind: kind}), verified: 0, tier: 0, unverified: false, choice: false}
  }
  val busy = s.mode != "closed" and s.pending.contains(s.latest)
  action open(mode: str): bool = all {s.mode == "closed", Set("settings", "calendar").contains(mode), s.latest < 6,
    s' = beginRead({...s, mode: mode, panel: s.panel + 1}, "load")}
  action close = all {s.mode != "closed",
    s' = {...s, mode: "closed", verified: 0, tier: 0, unverified: false, choice: false}}
  action reload = all {s.mode != "closed", s.latest < 6, s' = beginRead(s, "load")}
  action replaceOwner = all {s.owner == 1, s.mode == "closed" or s.latest < 6,
    s' = if (s.mode == "closed") {...s, owner: 2} else beginRead({...s, owner: 2}, "load")}
  action beginRevoke = all {s.mode != "closed", not(busy), s.verified != 0, s.latest < 6,
    s' = beginRead(s, "revoke")}
  action reply(id: int, verifiedTier: int): bool = all {
    s.pending.contains(id), verifiedTier.in(0.to(3)),
    val read = s.reads.get(id)
    val current = s.mode != "closed" and s.latest == id and read.owner == s.owner
    val settled = {...s, pending: s.pending.exclude(Set(id))}
    s' = if (current) {...settled, verified: if (verifiedTier == 0) 0 else id,
      tier: verifiedTier, unverified: verifiedTier == 0 and read.kind == "load"} else settled
  }
  pure def dispatch(value: State, floor: int): State = {
    val tier = if (value.tier >= floor) value.tier else floor
    {...value, unverified: false,
      dispatches: value.dispatches.append({owner: value.owner, read: value.verified, held: value.tier, floor: floor, tier: tier})}
  }
  action connectSettings = all {s.mode == "settings", not(busy), s.dispatches.length() < 4,
    s' = if (s.verified == 0) {...s, unverified: true} else dispatch(s, 3)}
  action connectCalendar = all {s.mode == "calendar", not(busy), s.permission == NoPermission, s.dispatches.length() < 4,
    s' = if (s.verified == 0) {...s, unverified: true}
      else {...s, permission: {owner: s.owner, read: s.verified, panel: s.panel}}}
  action permissionReply = all {s.permission != NoPermission, s.dispatches.length() < 4,
    val prior = s.permission
    val settled = {...s, permission: NoPermission}
    s' = if (s.mode != "calendar" or prior.panel != s.panel or prior.owner != s.owner) settled
      else if (prior.read != s.verified) {...settled, unverified: true}
      else if (not(s.savedOn)) {...settled, choice: true}
      else dispatch(settled, 1)}
  action allow = all {s.mode == "calendar", not(busy), s.choice, s.dispatches.length() < 4,
    val admitted = {...s, savedOn: true, choice: false}
    s' = if (s.verified == 0) {...admitted, unverified: true} else dispatch(admitted, 1)}
  action step = any {
    {nondet mode = Set("settings", "calendar").oneOf(); open(mode)},
    close, reload, replaceOwner, beginRevoke, connectSettings, connectCalendar, permissionReply, allow,
    {nondet id = ReadIds.oneOf(); nondet tier = 0.to(3).oneOf(); reply(id, tier)}, s' = s,
  }
  val TypeOK = s.mode.in(Set("closed", "settings", "calendar")) and s.owner.in(1.to(2))
    and s.panel.in(0.to(6)) and s.latest.in(0.to(6)) and s.pending.subseteq(ReadIds)
    and s.verified.in(0.to(6)) and s.tier.in(0.to(3)) and s.reads.keys() == ReadIds
    and s.dispatches.length() <= 4
  val CurrentVerification = if (s.verified == 0) s.tier == 0 else
    s.mode != "closed" and s.verified == s.latest and s.reads.get(s.verified).owner == s.owner and Tiers.contains(s.tier)
  val DispatchKeepsGrant = s.dispatches.indices().forall(i => {
    val request = s.dispatches.nth(i)
    ReadIds.contains(request.read) and s.reads.get(request.read).owner == request.owner
      and Tiers.contains(request.held) and Tiers.contains(request.tier) and request.floor.in(1.to(3))
      and request.tier >= request.floor and request.tier >= request.held
  })
  val ChoiceOwnsVerification = not(s.choice) or (s.mode == "calendar" and s.verified != 0)
  val safety = TypeOK and CurrentVerification and DispatchKeepsGrant and ChoiceOwnsVerification
  run unknownListBlocksConsentTest = init.then(open("calendar")).then(reply(1, 0)).then(connectCalendar)
    .expect(s.unverified and s.dispatches == List() and safety)
  run modifyTierSurvivesAddAccountTest = init.then(open("settings")).then(reply(1, 3)).then(connectSettings)
    .expect(s.dispatches.nth(0).tier == 3 and safety)
  run failedReadbackRetiresAwaitedConsentTest = init.then(open("calendar")).then(reply(1, 2)).then(connectCalendar)
    .then(reload).then(reply(2, 0)).then(permissionReply).expect(s.unverified and s.dispatches == List() and safety)
  run unknownRevokeReadbackBlocksConsentTest = init.then(open("settings")).then(reply(1, 3)).then(beginRevoke)
    .then(reply(2, 0)).then(connectSettings).expect(s.unverified and s.dispatches == List() and safety)
  run staleOwnerCannotRestoreReadTest = init.then(open("settings")).then(replaceOwner).then(reply(2, 1)).then(reply(1, 3))
    .then(connectSettings).expect(s.dispatches.nth(0).owner == 2 and s.dispatches.nth(0).tier == 3 and safety)
  run explicitAllowOpensCurrentTierTest = initWith(false).then(open("calendar")).then(reply(1, 3)).then(connectCalendar)
    .then(permissionReply).then(allow).expect(s.savedOn and not(s.choice) and s.dispatches.nth(0).tier == 3 and safety)
  run newerReadWithdrawsSavedOffChoiceTest = initWith(false).then(open("calendar")).then(reply(1, 2)).then(connectCalendar)
    .then(permissionReply).expect(s.choice).then(reload).then(reply(2, 1))
    .expect(not(s.choice) and s.dispatches == List() and safety)
}
