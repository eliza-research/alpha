// Ordered Home favorites, migration and storage publication in the shared launcher.
module LauncherFavorites {
  type Stored = {schema: str, entries: List[str], policy: bool, hasPrevious: bool, previous: List[str]}
  type State = {disk: Stored, captured: List[str], capturedMissing: bool, favorites: List[str],
    views: List[str], apps: List[str], migration: str, renamed: int, defaultsPending: bool,
    v1Pending: bool, barePending: bool, status: str, reading: bool, error: str, readable: bool,
    writable: bool, writes: int}
  var s: State

  pure val Notes = "alpha:notes"
  pure val Automations = "alpha:automations"
  pure val OldWorkflows = "alpha:workflows"
  pure val Clock = "org.fixture.clock"
  pure val WorkClock = "org.fixture.clock/org.fixture.clock.Main#10"
  pure val Camera = "org.fixture.camera"
  pure val Uninstalled = "org.fixture.gone"
  pure val ViewKeys = Set(Notes, Automations)
  pure val AppKeys = Set(Clock, WorkClock, Camera)
  pure val AllKeys = ViewKeys.union(AppKeys).union(Set(OldWorkflows, Uninstalled))
  pure val ViewOrders = Set(List(), List(Notes), List(Automations), List(Notes, Automations))
  pure val AppLists = Set(List(), List(Clock), List(Clock, WorkClock), List(Camera, Clock), List(Clock, WorkClock, Camera))
  pure def record(schema: str, entries: List[str], policy: bool): Stored =
    {schema: schema, entries: entries, policy: policy, hasPrevious: false, previous: List()}
  pure val Missing = record("missing", List(), false)
  pure val Malformed = record("malformed", List(), false)
  pure val Records = Set(Missing, Malformed, record("v1", List(Notes, OldWorkflows), false),
    record("v2", List(), true), record("v2", List(Notes, Automations, Clock), false),
    record("v2", List(Notes, OldWorkflows, Automations, Uninstalled), true),
    record("v2", List(Notes, Uninstalled, WorkClock, Clock), true),
    {...record("v2", List(Notes, Clock), true), hasPrevious: true, previous: List(OldWorkflows, Camera)})

  pure def includes(entries: List[str], key: str): bool = entries.indices().exists(i => entries.nth(i) == key)
  pure def only(entries: List[str], allowed: List[str]): List[str] = entries.select(key => includes(allowed, key))
  pure def unique(entries: List[str]): List[str] =
    entries.foldl(List(), (result, key) => if (includes(result, key)) result else result.append(key))
  pure def canonical(entries: List[str]): List[str] =
    entries.foldl(List(), (result, key) => result.append(if (key == OldWorkflows) Automations else key))
  pure def versioned(value: Stored): bool = value.schema == "v1" or value.schema == "v2"
  pure def absent(value: Stored, readable: bool): bool = not(readable) or value.schema == "missing"
  pure def storedKeys(value: Stored, readable: bool): List[str] =
    if (readable and versioned(value)) canonical(unique(value.entries)) else List()
  pure def legacyBare(value: Stored, readable: bool): bool =
    readable and value.schema == "v2" and not(value.policy or value.hasPrevious) and value.entries == unique(value.entries)

  pure def start(value: Stored, readable: bool, writable: bool, writes: int): State = {
    val count = value.entries.select(key => key == OldWorkflows).length()
      + value.previous.select(key => key == OldWorkflows).length()
    val migrate = readable and writable and versioned(value) and count > 0
    val disk = if (migrate) {...value, entries: unique(canonical(value.entries)), previous: unique(canonical(value.previous))} else value
    val raw = storedKeys(disk, readable)
    {disk: disk, captured: raw, capturedMissing: absent(disk, readable), favorites: unique(raw),
      views: List(), apps: List(), migration: if (not(readable)) "failed"
        else if (value.schema == "missing") "absent" else if (not(versioned(value))) "unreadable"
        else if (count == 0) "unchanged" else if (migrate) "migrated" else "failed",
      renamed: if (migrate) count else 0, defaultsPending: absent(disk, readable),
      v1Pending: readable and disk.schema == "v1", barePending: legacyBare(disk, readable),
      status: "idle", reading: false, error: "", readable: readable, writable: writable,
      writes: writes + (if (migrate) 1 else 0)}
  }
  action initWith(value: Stored, readable: bool, writable: bool): bool = s' = start(value, readable, writable, 0)
  action init = {
    nondet value = Records.oneOf(); nondet readable = Bool.oneOf(); nondet writable = Bool.oneOf();
    initWith(value, readable, writable)
  }
  action restart = all {not(s.reading), s.writes < 12, s' = start(s.disk, s.readable, s.writable, s.writes)}
  action storage(readable: bool, writable: bool): bool = s' = {...s, readable: readable, writable: writable}
  action externalWrite(value: Stored): bool = s' = {...s, disk: value}

  pure def available(views: List[str], apps: List[str]): List[str] = views.concat(apps)
  pure def defaults(views: List[str], apps: List[str]): List[str] = if (views.length() > 0) views else apps
  action syncViews(views: List[str]): bool = all {ViewOrders.contains(views),
    s' = {...s, views: views, favorites: if (s.defaultsPending) defaults(views, s.apps)
      else if (s.v1Pending) unique(s.favorites.concat(views)) else s.favorites}}
  pure def readStart(value: State): State = {...value, reading: true, status: "loading", error: ""}
  action request = all {not(s.reading), s' = readStart(s)}
  action prepareHome = s' = if (s.status == "idle"
    and s.favorites.indices().exists(i => not(ViewKeys.contains(s.favorites.nth(i))))) readStart(s) else s

  pure def write(value: State, entries: List[str]): State = {
    val keepPrevious = value.readable and value.disk.hasPrevious
    val keepBare = legacyBare(value.disk, value.readable)
    {...value, disk: {...record("v2", entries, true), hasPrevious: keepPrevious or keepBare,
      previous: if (keepPrevious) unique(value.disk.previous) else if (keepBare) value.disk.entries else List()},
      favorites: entries, defaultsPending: false, v1Pending: false, barePending: false,
      writes: value.writes + 1}
  }
  pure def afterLoad(value: State, apps: List[str]): State = {
    val ready = {...value, reading: false, status: "ready", apps: apps}
    if (not(value.defaultsPending or value.v1Pending or value.barePending)) ready
    else {
      val live = storedKeys(value.disk, value.readable)
      val choiceChanged = value.capturedMissing != absent(value.disk, value.readable)
        or live != value.captured or value.barePending and not(legacyBare(value.disk, value.readable))
        or value.v1Pending and not(value.readable and value.disk.schema == "v1")
      if (choiceChanged) {...ready, favorites: unique(live), defaultsPending: false, v1Pending: false, barePending: false}
      else {
        val loaded = available(value.views, apps)
        val preferred = if (value.defaultsPending) defaults(value.views, apps) else value.favorites
        val trim = value.barePending and value.views.length() > 0 and only(preferred, loaded) == loaded
        val entries = if (trim) preferred.select(key => includes(value.views, key) or not(includes(loaded, key))) else preferred
        if (value.writable) write(ready, entries) else {...ready, favorites: entries, error: "automatic-save"}
      }
    }
  }
  action settle(ok: bool, apps: List[str]): bool = all {s.reading, s.writes < 12,
    AppLists.contains(apps), ok or apps == List(),
    s' = if (ok) afterLoad(s, apps) else {...s, status: "failed", reading: false, apps: List()}}

  pure def save(value: State, entries: List[str]): State =
    if (value.writable) {...write(value, entries), error: ""} else {...value, error: "explicit-save"}
  action toggle(key: str): bool = all {AllKeys.contains(key), s.writes < 12,
    s' = if (includes(s.favorites, key)) save(s, s.favorites.select(value => value != key))
      else if (includes(available(s.views, s.apps), key)) save(s, s.favorites.append(key))
      else s}
  pure def swapped(entries: List[str], key: str, other: str): List[str] =
    entries.foldl(List(), (result, value) => result.append(if (value == key) other else if (value == other) key else value))
  action move(key: str, direction: int, limited: bool, visibleKeys: List[str]): bool = all {
    AllKeys.contains(key), Set(-1, 1).contains(direction), s.writes < 12,
    val installed = only(s.favorites, available(s.views, s.apps))
    val visible = if (limited) only(installed, visibleKeys) else installed
    val from = visible.indices().filter(i => visible.nth(i) == key)
    val target = visible.indices().filter(i => from.contains(i - direction))
    s' = if (target.size() == 1) save(s, swapped(s.favorites, key, visible.nth(target.fold(-1, (_, index) => index)))) else s}
  action clearError = s' = {...s, error: ""}

  action step = any {
    request, prepareHome, restart, clearError,
    {nondet read = Bool.oneOf(); nondet write = Bool.oneOf(); storage(read, write)},
    {nondet record = Records.oneOf(); externalWrite(record)},
    {nondet views = ViewOrders.oneOf(); syncViews(views)},
    {nondet ok = Bool.oneOf(); nondet apps = AppLists.oneOf(); settle(ok, apps)},
    {nondet key = AllKeys.oneOf(); toggle(key)},
    {nondet key = AllKeys.oneOf(); nondet direction = Set(-1, 1).oneOf();
      nondet limited = Bool.oneOf(); nondet visibleKeys = Set(List(), List(Notes, WorkClock), List(Notes, Clock)).oneOf();
      move(key, direction, limited, visibleKeys)},
    s' = s,
  }

  val visible = only(s.favorites, available(s.views, s.apps))
  val CanonicalFavorites = s.favorites == unique(s.favorites) and not(includes(s.favorites, OldWorkflows))
  val ReadOwnership = s.reading iff s.status == "loading"
  val Bounded = s.writes.in(0.to(12)) and ViewOrders.contains(s.views) and AppLists.contains(s.apps)
    and s.favorites.indices().forall(i => AllKeys.contains(s.favorites.nth(i)))
  val safety = CanonicalFavorites and ReadOwnership and Bounded

  run refusedMigrationKeepsCanonicalFavoriteTest = initWith(record("v2", List(OldWorkflows), true), true, false)
    .then(syncViews(List(Automations))).expect(visible == List(Automations) and s.disk.entries == List(OldWorkflows)
      and s.migration == "failed" and safety)
  run explicitEmptyNeverReceivesDefaultsTest = initWith(record("v2", List(), true), true, true)
    .then(syncViews(List(Notes, Automations))).then(request).then(settle(true, List(Clock)))
    .expect(s.favorites == List() and s.writes == 0 and safety)
  run oldDefaultRetainsRollbackRecordTest = initWith(record("v2", List(Notes, Automations, Clock), false), true, true)
    .then(syncViews(List(Notes, Automations))).then(request).then(settle(true, List(Clock)))
    .expect(s.favorites == List(Notes, Automations) and s.disk.previous == List(Notes, Automations, Clock) and safety)
  run externalChoiceWinsHeldDefaultLoadTest = initWith(Missing, true, true)
    .then(syncViews(List(Notes))).then(request).then(externalWrite(record("v2", List(Clock), true)))
    .then(settle(true, List(Clock))).expect(s.favorites == List(Clock) and s.writes == 0 and safety)
  run hiddenSlotsSurviveVisibleMoveTest = initWith(record("v2", List(Notes, Uninstalled, WorkClock, Clock), true), true, true)
    .then(syncViews(List(Notes))).then(request).then(settle(true, List(Clock, WorkClock)))
    .then(move(Notes, 1, false, List())).expect(s.favorites == List(WorkClock, Uninstalled, Notes, Clock) and safety)
  run rejectedExplicitEditPreservesDurableAndVisibleTest = initWith(record("v2", List(Notes), true), true, false)
    .then(syncViews(List(Notes, Automations))).then(toggle(Notes))
    .expect(s.favorites == List(Notes) and s.disk.entries == List(Notes) and s.error == "explicit-save" and safety)
}
