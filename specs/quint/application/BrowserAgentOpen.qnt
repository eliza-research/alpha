/// What the agent can do in Browser: open one HTTPS address (a device-action proposal, shown only
/// after its journal and receipt attempt) and send back/forward/reload to the exact visible tab
/// (a view command: claimed, never journaled, never repeated). Custody of the proposal itself is
/// DeviceActionReview; this module adds the Browser-specific admission and presentation rules.
module BrowserAgentOpen {
  type State = {
    // proposed destination and the owner's typed message
    scheme: str, typed: bool, reviewFirst: str, card: bool, authority: str,
    autoUsed: bool, autoOpens: int,
    // executor, journal, receipt attempt and presentation
    tab: bool, journal: str, receiptTried: bool, synced: bool, foreground: bool,
    presented: bool, claimedOpened: bool,
    // view command (back / forward / reload)
    command: str, native: bool, inBrowser: bool, overlay: bool, tabRevision: int,
    boundRevision: int, sentRevision: int, commandAsked: bool, claims: int, sends: int, acks: int}
  var s: State
  pure val schemes = Set("https", "http", "userinfo")
  action init = s' = {scheme: "https", typed: false, reviewFirst: "off", card: false, authority: "none",
    autoUsed: false, autoOpens: 0, tab: false, journal: "empty", receiptTried: false, synced: false,
    foreground: true, presented: false, claimedOpened: false,
    command: "none", native: true, inBrowser: true, overlay: false, tabRevision: 0,
    boundRevision: -1, sentRevision: -1, commandAsked: false, claims: 0, sends: 0, acks: 0}
  val asks = s.reviewFirst != "off"
  val idle = s.authority == "none"
  action prefer(value: str): bool = all {value.in(Set("off", "on", "unreadable")),
    s' = {...s, reviewFirst: value}}
  /// A new proposal of the same message. Only HTTPS without credentials parses into a card.
  action propose(scheme: str, typed: bool): bool = all {idle or s.journal == "terminal", scheme.in(schemes),
    s' = {...s, scheme: scheme, typed: typed, card: scheme == "https", authority: "none",
      tab: false, journal: "empty", receiptTried: false, synced: false, presented: false, claimedOpened: false}}
  action newMessage = all {idle or s.journal == "terminal",
    s' = {...s, card: false, authority: "none", autoUsed: false, autoOpens: 0, typed: false}}
  /// The direct pass: the typed address must match, once per message, with the preference off.
  action openDirect = all {s.card, idle, not(asks), s.typed, not(s.autoUsed),
    s' = {...s, card: false, authority: "request", autoUsed: true}}
  action openReviewed = all {s.card, idle, s' = {...s, card: false, authority: "review"}}
  /// The executor re-checks the scheme, creates the tab without selecting it, and answers
  /// "Opened <host>." before anything is shown.
  action execute = all {not(idle), s.journal == "empty", not(s.tab), s.scheme == "https",
    s' = {...s, tab: true, claimedOpened: true,
      autoOpens: s.autoOpens + (if (s.authority == "request") 1 else 0)}}
  action journalFinish = all {s.tab, s.journal == "empty", s' = {...s, journal: "terminal"}}
  action receipt(ok: bool): bool = all {s.journal == "terminal", not(s.receiptTried),
    s' = {...s, receiptTried: true, synced: ok}}
  action leaveForeground = s' = {...s, foreground: false}
  /// Shown only after the receipt attempt, and only while the same foreground is current.
  action present = all {s.tab, s.receiptTried, not(s.presented), s.foreground,
    s' = {...s, presented: true}}
  action presentSkipped = all {s.tab, s.receiptTried, not(s.presented), not(s.foreground), s' = s}

  action tabNavigates = all {s.tabRevision < 3, s' = {...s, tabRevision: s.tabRevision + 1}}
  action place(native: bool, inBrowser: bool, overlay: bool): bool = all {s.command.in(Set("none", "done")),
    s' = {...s, native: native, inBrowser: inBrowser, overlay: overlay}}
  /// An interact frame for the current view is claimed once.
  action claim = all {s.command.in(Set("none", "done")), s.inBrowser, s.claims < 3,
    s' = {...s, command: "claimed", claims: s.claims + 1, boundRevision: -1, sentRevision: -1, commandAsked: false}}
  /// "Review phone actions first" (or an unreadable choice) refuses the command after its claim.
  action commandRefused = all {s.command == "claimed", asks, s' = {...s, command: "refused"}}
  action commandBind = all {s.command == "claimed", not(asks), s.native, s.inBrowser, not(s.overlay),
    s' = {...s, command: "bound", boundRevision: s.tabRevision, commandAsked: asks}}
  action commandUnavailable = all {s.command == "claimed", not(asks),
    not(s.native) or not(s.inBrowser) or s.overlay, s' = {...s, command: "refused"}}
  /// The native call names the admitted navigation; a tab that moved on refuses it.
  action commandSend = all {s.command == "bound", s.boundRevision == s.tabRevision,
    s' = {...s, command: "sent", sentRevision: s.tabRevision, sends: s.sends + 1}}
  action commandStale = all {s.command == "bound", s.boundRevision != s.tabRevision,
    s' = {...s, command: "refused"}}
  /// One result per claim, delivered or lost; the command is never sent again for an acknowledgment.
  action acknowledge(delivered: bool): bool = all {s.command.in(Set("sent", "refused")),
    s' = {...s, command: "done", acks: s.acks + (if (delivered) 1 else 0)}}
  action step = any {
    prefer("off"), prefer("on"), prefer("unreadable"),
    propose("https", true), propose("https", false), propose("http", true), propose("userinfo", true),
    newMessage, openDirect, openReviewed, execute, journalFinish, receipt(true), receipt(false),
    leaveForeground, present, presentSkipped, tabNavigates,
    place(true, true, false), place(false, true, false), place(true, false, false), place(true, true, true),
    claim, commandRefused, commandBind, commandUnavailable, commandSend, commandStale,
    acknowledge(true), acknowledge(false)}

  val HttpsNoUserinfo = (s.card or s.tab) implies s.scheme == "https"
  val AutoOpenMatchesTypedAddress = (s.authority == "request") implies s.typed
  val OneAutoOpenPerMessage = s.autoOpens <= 1
  val PresentationAfterReceiptAttempt = s.presented implies
    (s.tab and s.journal == "terminal" and s.receiptTried)
  val ViewCommandNeedsToggleOff = s.command.in(Set("bound", "sent")) implies not(s.commandAsked)
  val ViewCommandBoundToExactTabRevision = s.command == "sent" implies
    (s.sentRevision == s.boundRevision and s.boundRevision >= 0)
  val ViewCommandNativeForegroundOnly = s.command.in(Set("bound", "sent")) implies
    (s.native and s.inBrowser and not(s.overlay))
  val ViewCommandNeverRepeated = s.sends <= s.claims and s.acks <= s.claims
  val safety = HttpsNoUserinfo and AutoOpenMatchesTypedAddress and OneAutoOpenPerMessage and
    PresentationAfterReceiptAttempt and ViewCommandNeedsToggleOff and
    ViewCommandBoundToExactTabRevision and ViewCommandNativeForegroundOnly and ViewCommandNeverRepeated

  /// KNOWN DIVERGENCE (app review AGENT-10): the receipt says "Opened <host>." when the tab was
  /// created, whether or not Browser was then shown. Registered as an expected violation.
  val OpenedClaimMeansShown = (s.claimedOpened and s.receiptTried and not(s.foreground)) implies s.presented
  val OpenedButNotShown = s.claimedOpened and s.receiptTried and not(s.foreground) and not(s.presented)

  run typedAddressOpensOnceTest = init.then(propose("https", true)).then(openDirect).then(execute)
    .then(journalFinish).then(receipt(true)).then(present)
    .then(propose("https", true))
    .expect(safety and s.card and s.autoUsed and s.autoOpens == 1)
  run untypedAddressNeedsReviewTest = init.then(propose("https", false))
    .expect(safety and s.card and not(s.typed)).then(openReviewed).then(execute)
    .expect(safety and s.authority == "review" and s.autoOpens == 0)
  run insecureAddressHasNoCardTest = init.then(propose("http", true))
    .expect(safety and not(s.card)).then(propose("userinfo", true)).expect(safety and not(s.card))
  run reviewFirstKeepsCardTest = init.then(prefer("unreadable")).then(propose("https", true))
    .expect(safety and s.card and asks)
  run presentationWaitsForReceiptTest = init.then(propose("https", true)).then(openDirect).then(execute)
    .then(journalFinish).expect(safety and not(s.receiptTried) and not(s.presented))
    .then(receipt(false)).then(present).expect(safety and s.presented and not(s.synced))
  run openedButNotShownTest = init.then(propose("https", true)).then(openDirect).then(execute)
    .then(journalFinish).then(leaveForeground).then(receipt(true)).then(presentSkipped)
    .expect(safety and OpenedButNotShown and not(OpenedClaimMeansShown))
  run commandRefusedUnderReviewFirstTest = init.then(prefer("on")).then(claim).then(commandRefused)
    .then(acknowledge(true)).expect(safety and s.sends == 0 and s.acks == 1)
  run commandBoundToTabTest = init.then(claim).then(commandBind).then(tabNavigates).then(commandStale)
    .then(acknowledge(true)).expect(safety and s.sends == 0)
  run commandSentOnceTest = init.then(claim).then(commandBind).then(commandSend).then(acknowledge(false))
    .expect(safety and s.sends == 1 and s.acks == 0 and s.command == "done")
  run browserBuildHasNoCommandTest = init.then(place(false, true, false)).then(claim)
    .then(commandUnavailable).then(acknowledge(true)).expect(safety and s.sends == 0)
}
