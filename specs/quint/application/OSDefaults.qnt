/// Source-owned OS defaults; serialized settings writes and two finite layout classes.
module OSDefaults {
  type State = { saved: str, selected: str, version: int, pending: bool,
    written: bool, appop: str, eligible: bool, writeAuthorized: bool }
  var s: State
  pure def coreLauncher(name: str, active: bool, system: bool, home: bool): bool =
    name == "alpha" and active and system and home
  action init = s' = { saved: "stock", selected: "stock", version: 0,
    pending: false, written: false, appop: "unset", eligible: true, writeAuthorized: true }
  action load = s' = { ...s, selected: if (s.version < 2 and s.saved == "stock") "alpha" else s.saved,
    pending: s.version < 2, written: false }
  action storeLayout(ok: bool): bool = s' = if (ok)
    { ...s, saved: s.selected, written: true } else s
  action storeVersion(ok: bool): bool = s' = if (ok and s.pending and s.written)
    { ...s, version: 2, pending: false } else s
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
  val safety = s.version.in(Set(0, 2)) and s.saved.in(Set("stock", "custom", "alpha"))
    and s.selected.in(Set("stock", "custom", "alpha")) and s.writeAuthorized
  run coreLauncherScopeTest = init.expect(coreLauncher("alpha",true,true,true)
    and not(coreLauncher("other",true,true,true)) and not(coreLauncher("alpha",true,false,true))
    and not(coreLauncher("alpha",true,true,false)) and not(coreLauncher("alpha",false,true,true)))
  run layoutFailureCannotCommitVersionTest = init.then(load).then(storeLayout(false)).then(storeVersion(true))
    .expect(s.version == 0 and s.saved == "stock" and safety)
  run versionFailureRetriesStoredLayoutTest = init.then(load).then(storeLayout(true)).then(storeVersion(false))
    .then(restart).then(load).expect(s.saved == "alpha" and s.version == 0)
    .then(storeLayout(true)).then(storeVersion(true)).expect(s.version == 2 and safety)
  run completedMigrationPreservesLaterStockChoiceTest = init.then(load).then(storeLayout(true)).then(storeVersion(true))
    .then(ownerLayout("stock")).then(restart).then(load).expect(s.selected == "stock" and safety)
  run customLayoutRemainsCustomTest = init.then(ownerLayout("custom")).then(load)
    .then(storeLayout(true)).then(storeVersion(true)).expect(s.saved == "custom" and s.version == 2 and safety)
  run existingPermissionDenialRemainsTest = init.then(ownerAppop("deny")).then(defaultAppop)
    .expect(s.appop == "deny" and safety)
  run ineligiblePermissionDoesNotGrantTest = init.then(context(false)).then(defaultAppop)
    .expect(s.appop == "unset" and safety)
}
