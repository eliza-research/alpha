/// Account presentation and owner-bound sign-out. Does not model billing-provider internals.
module AccountSheet {
  type State = { owner: int, open: bool, section: str, review: int, mode: str,
    keys: Set[int], dataRevision: int, removed: Set[int], authorized: Set[int] }
  var s: State
  action init = s' = { owner: 0, open: false, section: "account", review: -1,
    mode: "cloud", keys: Set(0, 1), dataRevision: 1, removed: Set(), authorized: Set() }
  action show = s' = {...s, open: true, section: "account", review: -1}
  action provider = all { s.open, s.review == -1, s' = {...s, section: "provider"} }
  action back = s' = {...s, section: "account", review: -1}
  action close = s' = {...s, open: false, section: "account", review: -1}
  action askSignOut = all { s.open, s.section == "account", s' = {...s, review: s.owner} }
  action cancel = s' = {...s, review: -1}
  action switchOwner = s' = {...s, owner: 1 - s.owner, review: -1}
  action confirm = all { s.open, s.review == s.owner,
    s' = {...s, review: -1, removed: s.removed.union(Set(s.owner)),
      authorized: s.authorized.union(Set(s.review))} }
  action switchMode = s' = {...s, mode: if (s.mode == "cloud") "direct" else "cloud"}
  action step = any { show, provider, back, close, askSignOut, cancel, switchOwner,
    confirm, switchMode, s' = s }
  val safety = s.removed == s.authorized and s.keys == Set(0, 1) and s.dataRevision == 1
    and (s.review == -1 or (s.open and s.review == s.owner))
  run settingsAndStartupShareAccount = init.then(show).expect(s.section == "account")
    .then(provider).then(back).expect(s.section == "account" and safety)
  run switchedOwnerCannotConfirm = init.then(show).then(askSignOut).then(switchOwner)
    .expect(s.review == -1 and s.removed == Set() and safety)
  run dismissPreservesData = init.then(show).then(askSignOut).then(close)
    .expect(s.removed == Set() and safety)
  run modeAndSignOutPreserveKeys = init.then(show).then(switchMode).then(askSignOut)
    .then(confirm).expect(s.removed == Set(0) and safety)
  run selectionKeepsProviderSheetOpen = init.then(show).then(provider).then(switchMode)
    .expect(s.open and s.section == "provider" and safety)
    .then(close).expect(not(s.open) and safety)
}
