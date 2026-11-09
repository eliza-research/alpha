// Appearance preference startup, listener custody and committed React state.
module AppearancePreferenceAdmission {
  type Patch = {theme: str, marker: int}
  type State = {
    testMocks: bool, native: bool, query: str, phase: str,
    boot: str, system: str, stored: str, blocked: bool,
    theme: str, marker: int, markerTheme: str, serial: int, pending: List[Patch],
    storageListener: bool, resumeListener: bool, schemeListener: bool,
    attempts: List[str], failures: int, displayed: str, selection: str
  }
  var s: State

  val Themes = Set("light", "dark")
  val Choices = Themes.union(Set("system"))
  val Stored = Choices.union(Set("", "invalid"))
  val Queries = Themes.union(Set("none", "other"))
  val StorageEvents = Set("key", "clear", "other", "silent")
  pure def resolve(choice: str, system: str): str =
    if (choice == "system") system else if (choice == "dark") "dark" else "light"
  pure def preference(stored: str): str = if (Choices.contains(stored)) stored else "light"
  pure def preview(testMocks: bool, query: str): bool = testMocks and query != "none"
  pure def previewTheme(query: str): str = if (query == "dark") "dark" else "light"
  pure def display(state: State): str = if (state.theme == "") state.boot else state.theme
  pure def selected(state: State): str = {
    val choice = preference(state.stored)
    if (resolve(choice, state.system) == display(state)) choice else display(state)
  }
  pure def present(state: State): State =
    {...state, displayed: display(state), selection: selected(state)}
  pure def enqueueMarked(state: State, theme: str): State =
    {...state, serial: state.serial + 1, pending: state.pending.append({theme: theme, marker: state.serial + 1})}
  pure def readback(state: State): State =
    enqueueMarked(state, resolve(preference(state.stored), state.system))
  pure def write(state: State, choice: str): State =
    {...state, attempts: state.attempts.append(choice),
      stored: if (state.blocked) state.stored else choice,
      failures: if (state.blocked) state.failures + 1 else state.failures}

  action initFor(testMocks: bool, native: bool, query: str, stored: str, system: str): bool = all {
    Queries.contains(query), Stored.contains(stored), Themes.contains(system),
    s' = present({testMocks: testMocks, native: native, query: query, phase: "new",
      boot: if (preview(testMocks, query)) previewTheme(query) else resolve(preference(stored), system),
      system: system, stored: stored, blocked: false,
      theme: "", marker: 0, markerTheme: "", serial: 0, pending: List(),
      storageListener: false, resumeListener: false, schemeListener: false,
      attempts: List(), failures: 0, displayed: "", selection: ""}),
  }
  action init = {
    nondet testMocks = Bool.oneOf()
    nondet native = Bool.oneOf()
    nondet query = Queries.oneOf()
    nondet stored = Stored.oneOf()
    nondet system = Themes.oneOf()
    initFor(testMocks, native, query, stored, system)
  }

  val canQueue = s.pending.length() < 3 and s.serial < 8
  action mount = all {
    s.phase == "new",
    val followPreference = not(preview(s.testMocks, s.query))
    val browser = followPreference and not(s.native)
    val wired = {...s, phase: "mounted", schemeListener: followPreference, storageListener: browser, resumeListener: browser}
    s' = if (browser) readback(wired) else wired,
  }
  action storage(choice: str, event: str): bool = all {
    s.phase != "new", Stored.contains(choice), StorageEvents.contains(event),
    val deliver = s.storageListener and (event == "key" or event == "clear")
    val updated = present({...s, stored: choice})
    all {
      not(deliver) or canQueue,
      s' = if (deliver) readback(updated) else updated,
    },
  }
  action changeScheme(theme: str): bool = all {
    s.phase != "new", Themes.contains(theme), theme != s.system,
    val deliver = s.schemeListener and s.stored == "system"
    val updated = present({...s, system: theme})
    all {
      not(deliver) or canQueue,
      s' = if (deliver) readback(updated) else updated,
    },
  }
  action pageshow = all {
    s.phase != "new", not(s.resumeListener) or canQueue,
    s' = if (s.resumeListener) readback(s) else s,
  }
  action choose(choice: str): bool = all {
    s.phase == "mounted", canQueue, Choices.contains(choice), s.attempts.length() < 4,
    s' = enqueueMarked(present(write(s, choice)), resolve(choice, s.system)),
  }
  action explicit(theme: str): bool = all {
    s.phase == "mounted", canQueue, Themes.contains(theme),
    s' = {...s, pending: s.pending.append({theme: theme, marker: 0})},
  }
  action failWrites = all {
    s.phase == "mounted", not(s.blocked),
    s' = {...s, blocked: true},
  }
  action commit = all {
    s.phase == "mounted", s.pending.length() > 0,
    val latest = s.pending.nth(s.pending.length() - 1)
    val marked = s.pending.foldl({theme: s.markerTheme, marker: s.marker},
      (previous, patch) => if (patch.marker == 0) previous else patch)
    val external = marked.marker != s.marker and marked.theme == latest.theme
    val save = not(external) and latest.theme != s.theme
    val committed = {...s, theme: latest.theme, marker: marked.marker, markerTheme: marked.theme, pending: List()}
    all {
      not(save) or s.attempts.length() < 4,
      s' = present(if (save) write(committed, latest.theme) else committed),
    },
  }
  action unmount = all {
    s.phase == "mounted", s.pending.length() == 0,
    s' = {...s, phase: "retired", storageListener: false, resumeListener: false, schemeListener: false},
  }
  action step = any {
    mount, pageshow, failWrites, commit, unmount,
    {nondet choice = Stored.oneOf(); nondet event = StorageEvents.oneOf(); storage(choice, event)},
    {nondet theme = Themes.oneOf(); changeScheme(theme)},
    {nondet choice = Choices.oneOf(); choose(choice)},
    {nondet theme = Themes.oneOf(); explicit(theme)},
    s' = s,
  }

  val ListenerAdmission = s.schemeListener == (s.phase == "mounted" and not(preview(s.testMocks, s.query)))
    and s.storageListener == (s.schemeListener and not(s.native)) and s.resumeListener == s.storageListener
  val PreviewBoot = preview(s.testMocks, s.query) implies s.boot == previewTheme(s.query)
  val ReadMarkerIdentity = s.marker >= 0 and s.marker <= s.serial and s.pending.indices().forall(i => {
    val patch = s.pending.nth(i)
    Themes.contains(patch.theme) and (patch.marker == 0 or (s.marker < patch.marker and patch.marker <= s.serial))
  })
  val Presentation = s.displayed == display(s) and Themes.contains(s.displayed) and s.selection == selected(s)
  val BoundedWrites = s.failures >= 0 and s.failures <= s.attempts.length() and s.attempts.length() <= 4
  val safety = ListenerAdmission and PreviewBoot and ReadMarkerIdentity and Presentation and BoundedWrites

  run productionQueryCannotSuppressSystemTest =
    initFor(false, true, "light", "system", "dark").expect(s.displayed == "dark")
      .then(mount).then(changeScheme("light")).then(commit)
      .expect(s.displayed == "light" and s.stored == "system" and s.attempts == List() and safety)
  run explicitDevelopmentPreviewTest =
    initFor(true, false, "dark", "light", "light").then(mount)
      .then(storage("system", "key")).then(changeScheme("dark")).then(pageshow)
      .expect(s.pending == List() and s.displayed == "dark" and safety)
  run queuedReadCannotEchoTest =
    initFor(false, false, "none", "light", "light").then(mount)
      .then(storage("dark", "key")).then(storage("system", "silent")).then(commit)
      .expect(s.displayed == "dark" and s.stored == "system" and s.attempts == List() and safety)
  run settingsPickWritesOnceTest =
    initFor(false, false, "none", "light", "dark").then(mount).then(commit)
      .then(choose("system")).then(commit)
      .expect(s.displayed == "dark" and s.selection == "system" and s.attempts == List("system") and safety)
  run failedWritePreservesStoredChoiceTest =
    initFor(false, true, "none", "light", "light").then(mount).then(failWrites)
      .then(explicit("dark")).then(commit)
      .expect(s.displayed == "dark" and s.stored == "light" and s.failures == 1 and safety)
  run retiredListenersIgnoreEventsTest =
    initFor(false, false, "none", "system", "light").then(mount).then(commit).then(unmount)
      .then(storage("dark", "clear")).then(changeScheme("dark")).then(pageshow)
      .expect(s.displayed == "light" and s.pending == List() and s.attempts == List() and safety)
}
