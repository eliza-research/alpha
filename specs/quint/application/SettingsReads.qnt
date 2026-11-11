/// Settings' asynchronous reads: the device facts read and its generation fence, the facts a
/// resume behind another view leaves unread, the capability read with its abort identity and
/// ten-second limit, and the shipped licence notices that load once.
module SettingsReads {
  type State = {
    // Settings has been opened in this shell, so Back can bring it in front again.
    mounted: bool, view: str, visited: bool,
    // Device facts: the read generation, reads in flight, and the read whose answer is shown (0: none).
    generation: int, reads: Set[int], factsFrom: int, resumedUnread: bool,
    // Capability reads: the newest issued, the current one (0: none), those still answering and
    // those whose ten-second limit is still armed.
    capSequence: int, capCurrent: int, capReads: Set[int], capTimers: Set[int], capExpired: Set[int],
    gmail: str, gmailFrom: int, hiddenDiscoveries: int,
    licenses: str, licenseLoads: int
  }
  var s: State
  pure val TOKENS = 1.to(6)
  action init = s' = {
    mounted: false, view: "other", visited: false, generation: 0, reads: Set(), factsFrom: 0, resumedUnread: false,
    capSequence: 0, capCurrent: 0, capReads: Set(), capTimers: Set(), capExpired: Set(),
    gmail: "not-checked", gmailFrom: 0, hiddenDiscoveries: 0, licenses: "idle", licenseLoads: 0
  }
  /// A device facts read: every call starts a new generation, and a mounted shell reads.
  pure def deviceRead(v: State): State =
    if (v.mounted) { ...v, generation: v.generation + 1, reads: v.reads.union(Set(v.generation + 1)), resumedUnread: false }
    else { ...v, generation: v.generation + 1 }
  /// A capability read ends the one before it. Outside Settings it only resets what is shown,
  /// unless Settings is being entered; otherwise it starts one read under a new abort identity.
  pure def capabilityRead(v: State, entering: bool): State =
    if (not(entering) and v.view != "settings") { ...v, capCurrent: 0, gmail: "not-checked", gmailFrom: 0 }
    else { ...v, capSequence: v.capSequence + 1, capCurrent: v.capSequence + 1,
      capReads: v.capReads.union(Set(v.capSequence + 1)), capTimers: v.capTimers.union(Set(v.capSequence + 1)),
      gmail: "checking", gmailFrom: v.capSequence + 1,
      hiddenDiscoveries: if (v.view != "settings" and not(entering)) v.hiddenDiscoveries + 1 else v.hiddenDiscoveries }
  pure def bounded(v: State): bool = v.generation < 6 and v.capSequence < 6
  /// A new shell starts away from Settings, with no Settings behind it.
  action mount = all { not(s.mounted), s' = { ...s, mounted: true, view: "other", visited: false } }
  /// Unmounting ends the capability read and the facts' generation, and forgets the facts.
  action unmount = all {
    s.mounted, s.generation < 6,
    s' = { ...s, mounted: false, capCurrent: 0, generation: s.generation + 1, factsFrom: 0 }
  }
  /// Opening Settings reads the device and the capabilities.
  action openSettings = all {
    s.mounted, s.view != "settings", bounded(s),
    s' = capabilityRead(deviceRead({ ...s, view: "settings", visited: true, resumedUnread: false }), true)
  }
  action leaveSettings = all { s.mounted, s.view == "settings", s' = { ...s, view: "other" } }
  /// Settings comes back in front without being opened (Back from another view): the shell
  /// update reads only what a resume behind the other view left unread.
  action returnToSettings = all {
    s.mounted, s.view != "settings", s.visited, bounded(s),
    s' = if (s.resumedUnread) capabilityRead(deviceRead({ ...s, view: "settings" }), false) else { ...s, view: "settings" }
  }
  /// The app resumes: Settings in front reads now; behind another view the facts wait.
  action appResumed = all {
    s.mounted, bounded(s),
    s' = if (s.view == "settings") capabilityRead(deviceRead(s), false)
      else capabilityRead({ ...s, resumedUnread: true }, false)
  }
  /// The connection's account binding or the linked Google accounts change.
  action accountChanged = all { s.mounted, bounded(s), s' = capabilityRead(s, false) }
  /// The device answers. Only the newest read of the mounted shell is shown.
  action deviceReadCompletes(token: int): bool = all {
    token.in(s.reads),
    s' = if (s.mounted and token == s.generation) { ...s, reads: s.reads.exclude(Set(token)), factsFrom: token }
      else { ...s, reads: s.reads.exclude(Set(token)) }
  }
  /// The capability read answers and disarms its limit. Only the current read is shown; one that
  /// already ran out stays unverified.
  action capabilityCompletes(token: int, verified: bool): bool = all {
    token.in(s.capReads),
    val current = s.mounted and token == s.capCurrent
    s' = { ...s, capReads: s.capReads.exclude(Set(token)), capTimers: s.capTimers.exclude(Set(token)),
      gmail: if (not(current)) s.gmail else if (verified and not(token.in(s.capExpired))) "verified" else "not-verified" }
  }
  /// Ten seconds pass: the read is aborted, and a current one still checking is unverified.
  action capabilityLimit(token: int): bool = all {
    token.in(s.capTimers),
    s' = { ...s, capTimers: s.capTimers.exclude(Set(token)), capExpired: s.capExpired.union(Set(token)),
      gmail: if (s.mounted and token == s.capCurrent and s.gmail == "checking") "not-verified" else s.gmail }
  }
  /// The licence page loads the shipped notices once; a load in flight or done is not repeated.
  action openLicenses = all {
    s.mounted, s.view == "settings", s.licenseLoads < 3,
    s' = if (s.licenses.in(Set("loading", "ready"))) s else { ...s, licenses: "loading", licenseLoads: s.licenseLoads + 1 }
  }
  action licensesAnswer(ok: bool): bool = all {
    s.licenses == "loading", s' = { ...s, licenses: if (ok) "ready" else "unavailable" }
  }
  action step = {
    nondet token = TOKENS.oneOf()
    nondet flag = Set(true, false).oneOf()
    any { mount, unmount, openSettings, leaveSettings, returnToSettings, appResumed, accountChanged,
      deviceReadCompletes(token), capabilityCompletes(token, flag), capabilityLimit(token), openLicenses,
      licensesAnswer(flag), s' = s }
  }
  /// Facts on screen came from a read of this mounted shell, and nothing newer has been shown over them.
  val FactsFromThisShell = s.factsFrom != 0 implies s.mounted and s.factsFrom <= s.generation
  /// Settings in front never holds facts a resume left unread.
  val ResumeReadWhenShown = (s.mounted and s.view == "settings") implies not(s.resumedUnread)
  /// A check on screen is the current read, and its ten-second limit is still armed.
  val CheckingEnds = (s.mounted and s.view == "settings" and s.gmail == "checking") implies s.capCurrent != 0 and s.capCurrent.in(s.capTimers)
  val VerifiedIsNewest = s.gmail == "verified" implies s.gmailFrom == s.capSequence
  /// Nothing behind another view starts account discovery.
  val NoHiddenDiscovery = s.hiddenDiscoveries == 0
  val UnmountedHoldsNoRead = not(s.mounted) implies s.capCurrent == 0 and s.factsFrom == 0
  val LicensesLoadOnce = s.licenses == "idle" or s.licenseLoads > 0
  val TypeOK = s.view.in(Set("settings", "other")) and s.generation.in(0.to(7)) and s.capSequence.in(0.to(6))
    and s.reads.subseteq(1.to(7)) and s.capReads.subseteq(TOKENS) and s.capTimers.subseteq(s.capReads)
    and s.gmail.in(Set("not-checked", "checking", "verified", "not-verified"))
    and s.licenses.in(Set("idle", "loading", "ready", "unavailable")) and s.licenseLoads.in(0.to(3))
  val safety = TypeOK and FactsFromThisShell and ResumeReadWhenShown and CheckingEnds and VerifiedIsNewest and
    NoHiddenDiscovery and UnmountedHoldsNoRead and LicensesLoadOnce

  val ResumeLeftUnreadWitness = s.resumedUnread and s.mounted and s.view == "other"
  val SupersededFactsReadWitness = s.mounted and s.reads.exists(token => token < s.generation) and s.factsFrom == s.generation
  val LimitEndedCheckWitness = s.gmail == "not-verified" and s.capCurrent.in(s.capExpired) and s.capCurrent.in(s.capReads)
  val HiddenResetWitness = s.gmail == "not-checked" and s.capSequence > 0 and s.capReads != Set()
  /// Settings brought back in front by Back after an account change behind another view shows the
  /// reset value until the next resume or reopening.
  val ResetShownAfterBackWitness = s.mounted and s.view == "settings" and s.gmail == "not-checked" and s.capSequence > 0
  val LicensesRetryWitness = s.licenses == "loading" and s.licenseLoads == 2

  /// A resume behind another view marks the facts unread; coming back to Settings reads them.
  run resumeBehindViewTest = init.then(mount).then(openSettings).then(deviceReadCompletes(1)).then(leaveSettings)
    .then(appResumed).expect(ResumeLeftUnreadWitness and s.generation == 1 and s.gmail == "not-checked" and safety)
    .then(returnToSettings).expect(not(s.resumedUnread) and s.generation == 2 and s.gmail == "checking" and safety)
    .then(deviceReadCompletes(2)).expect(s.factsFrom == 2 and safety)
  /// An older device read that answers after a newer one changes nothing.
  run olderFactsDroppedTest = init.then(mount).then(openSettings).then(appResumed).then(deviceReadCompletes(2))
    .expect(SupersededFactsReadWitness).then(deviceReadCompletes(1)).expect(s.factsFrom == 2 and safety)
  /// The capability read runs out: the check ends unverified, and its late answer does not verify it.
  run capabilityLimitTest = init.then(mount).then(openSettings).then(capabilityLimit(1))
    .expect(LimitEndedCheckWitness and safety)
    .then(capabilityCompletes(1, true)).expect(s.gmail == "not-verified" and safety)
  /// An account change behind another view resets what is shown and starts no discovery; the read
  /// it replaced is ignored when it answers.
  run hiddenAccountChangeTest = init.then(mount).then(openSettings).then(leaveSettings).then(accountChanged)
    .expect(HiddenResetWitness and s.capCurrent == 0 and safety)
    .then(capabilityCompletes(1, true)).expect(s.gmail == "not-checked" and safety)
  run backAfterHiddenResetTest = init.then(mount).then(openSettings).then(capabilityCompletes(1, true)).then(leaveSettings)
    .then(accountChanged).then(returnToSettings).expect(ResetShownAfterBackWitness and s.capCurrent == 0 and safety)
    .then(appResumed).expect(s.gmail == "checking" and s.capCurrent == 2 and safety)
  run unmountDropsReadsTest = init.then(mount).then(openSettings).then(unmount).then(deviceReadCompletes(1))
    .then(capabilityCompletes(1, true)).expect(s.factsFrom == 0 and s.gmail == "checking" and safety)
    .then(mount).then(openSettings).then(capabilityCompletes(2, true)).expect(s.gmail == "verified" and safety)
  run licensesLoadOnceTest = init.then(mount).then(openSettings).then(openLicenses).then(openLicenses)
    .expect(s.licenseLoads == 1).then(licensesAnswer(false)).then(openLicenses).expect(LicensesRetryWitness and safety)
    .then(licensesAnswer(true)).then(openLicenses).expect(s.licenses == "ready" and s.licenseLoads == 2 and safety)
}
