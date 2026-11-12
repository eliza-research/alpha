/// Source-owned OS defaults; serialized version-3 writes and finite retained layout classes.
module OSDefaults {
  type State = { saved: str, selected: str, version: int, pending: bool,
    written: bool, appop: str, eligible: bool, writeAuthorized: bool }
  var s: State
  pure def coreLauncher(name: str, active: bool, system: bool, home: bool): bool =
    name == "alpha" and active and system and home
  pure def initialState(layout: str, version: int): State = { saved: layout, selected: layout, version: version,
    pending: false, written: false, appop: "unset", eligible: true, writeAuthorized: true }
  action init = s' = initialState("stock", 0)
  action initReviewed(layout: str, version: int): bool = all {
    layout.in(Set("stock", "custom")), version.in(Set(2, 3)),
    s' = initialState(layout, version)
  }
  pure def migratedLayout(layout: str, version: int): str =
    if (version < 2 and layout == "stock") "alpha"
    else layout
  action load = s' = { ...s, selected: migratedLayout(s.saved, s.version),
    pending: s.version < 3, written: false }
  action storeLayout(ok: bool): bool = s' = if (ok)
    { ...s, saved: s.selected, written: true } else s
  action storeVersion(ok: bool): bool = s' = if (ok and s.pending and s.written)
    { ...s, version: 3, pending: false } else s
  action restart = s' = { ...s, pending: false, written: false, selected: s.saved }
  action ownerLayout(layout: str): bool = all {
    layout.in(Set("stock", "custom")), not(s.pending),
    s' = { ...s, saved: layout, selected: layout, written: false }
  }
  action context(eligible: bool): bool = s' = { ...s, eligible: eligible }
  action ownerAppop(value: str): bool = all {
    value.in(Set("allow", "deny")), s' = { ...s, appop: value }
  }
  action defaultAppop = s' = if (s.eligible and s.appop == "unset")
    { ...s, appop: "allow", writeAuthorized: s.eligible } else s
  action step = any { load, storeLayout(true), storeLayout(false), storeVersion(true),
    storeVersion(false), restart, ownerLayout("custom"), ownerLayout("stock"),
    context(true), context(false), ownerAppop("allow"), ownerAppop("deny"), defaultAppop }
  pure val layouts = Set("stock", "custom", "alpha")
  val safety = s.version.in(Set(0, 2, 3)) and s.saved.in(layouts)
    and s.selected.in(layouts) and s.writeAuthorized
  run coreLauncherScopeTest = init.expect(coreLauncher("alpha",true,true,true)
    and not(coreLauncher("other",true,true,true)) and not(coreLauncher("alpha",true,false,true))
    and not(coreLauncher("alpha",true,true,false)) and not(coreLauncher("alpha",false,true,true)))
  run layoutFailureCannotCommitVersionTest = init.then(load).then(storeLayout(false)).then(storeVersion(true))
    .expect(s.version == 0 and s.saved == "stock" and safety)
  run versionFailureRetriesStoredLayoutTest = init.then(load).then(storeLayout(true)).then(storeVersion(false))
    .then(restart).then(load).expect(s.saved == "alpha" and s.version == 0)
    .then(storeLayout(true)).then(storeVersion(true)).expect(s.version == 3 and safety)
  run completedMigrationPreservesLaterStockChoiceTest = init.then(load).then(storeLayout(true)).then(storeVersion(true))
    .then(ownerLayout("stock")).then(restart).then(load).expect(s.selected == "stock" and safety)
  run customLayoutRemainsCustomTest = init.then(ownerLayout("custom")).then(load)
    .then(storeLayout(true)).then(storeVersion(true)).expect(s.saved == "custom" and s.version == 3 and safety)
  run reviewedStockSurvivesIdentityMigrationTest = initReviewed("stock", 2).then(load)
    .expect(s.selected == "stock" and safety).then(storeLayout(true)).then(storeVersion(true))
    .expect(s.saved == "stock" and s.version == 3 and safety)
  run reviewedUnrelatedCustomRetainedTest = initReviewed("custom", 2).then(load)
    .then(storeLayout(true)).then(storeVersion(true)).expect(s.saved == "custom" and s.version == 3 and safety)
  run currentVersionLeavesRetainedLayoutTest = initReviewed("custom", 3).then(load)
    .expect(s.selected == "custom" and not(s.pending) and safety)
  run existingPermissionDenialRemainsTest = init.then(ownerAppop("deny")).then(defaultAppop)
    .expect(s.appop == "deny" and safety)
  run ineligiblePermissionDoesNotGrantTest = init.then(context(false)).then(defaultAppop)
    .expect(s.appop == "unset" and safety)
}
