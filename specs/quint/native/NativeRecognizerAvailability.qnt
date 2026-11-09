/// Per-language recognition availability, probe tickets and demotion deadlines.
module NativeRecognizerAvailability {
  type Entry = {kind: str, until: int, ticket: int}
  type State = {entries: str -> Entry, pending: int -> str, tickets: int, now: int,
    demotedAll: bool, reply: str}
  var s: State
  pure val languages = Set("en", "es")
  pure val answers = Set("installed", "absent", "unanswered")
  pure val times = Set(0, 1, 29999, 30000, 59999, 60000, 90000)
  pure val empty = {kind: "unknown", until: 0, ticket: 0}
  pure def live(entry: Entry, now: int): bool = entry.until == -1 or now < entry.until
  pure def known(st: State, language: str): str =
    if (st.demotedAll) "demoted"
    else if (live(st.entries.get(language), st.now)) st.entries.get(language).kind else "unknown"
  pure def authoritative(entry: Entry): bool = entry.kind.in(Set("installed", "absent"))
  pure def kept(st: State, language: str, result: str, ticket: int): Entry = {
    val current = st.entries.get(language)
    val currentLive = live(current, st.now)
    if (currentLive and current.kind == "demoted") current
    else if (current.ticket > ticket and authoritative(current)) current
    else if (currentLive and result == "unanswered" and current.kind != "unanswered") current
    else {kind: result, ticket: ticket,
      until: if (result == "installed") -1 else st.now + (if (result == "absent") 60000 else 30000)}
  }
  pure def record(st: State, language: str, result: str, ticket: int): State = {
    val entry = kept(st, language, result, ticket)
    {...st, entries: st.entries.set(language, entry), reply: if (st.demotedAll) "demoted" else entry.kind}
  }
  pure def availability(known: str): str = if (known == "installed") "available" else "unavailable"
  action init = s' = {entries: Map("en" -> empty, "es" -> empty),
    pending: 1.to(4).mapBy(_ => "none"), tickets: 0, now: 0, demotedAll: false, reply: "none"}
  action advance(now: int): bool = all {now >= s.now, now.in(times), s' = {...s, now: now}}
  action beginProbe(language: str): bool = all {
    language.in(languages), known(s, language) == "unknown", s.tickets < 4,
    s' = {...s, tickets: s.tickets + 1, pending: s.pending.set(s.tickets + 1, language)}
  }
  action completeProbe(ticket: int, result: str): bool = all {
    ticket.in(1.to(4)), s.pending.get(ticket) != "none", result.in(answers),
    val saved = record(s, s.pending.get(ticket), result, ticket)
    s' = {...saved, pending: saved.pending.set(ticket, "none"), reply: availability(saved.reply)}
  }
  action cached(language: str): bool = all {
    language.in(languages), known(s, language) != "unknown",
    s' = {...s, reply: availability(known(s, language))}
  }
  action recordNow(language: str, result: str): bool = all {
    language.in(languages), result.in(answers), s.tickets < 4,
    s' = record({...s, tickets: s.tickets + 1}, language, result, s.tickets + 1)
  }
  action lateAnswer(language: str, result: str, ticket: int): bool = all {
    language.in(languages), result.in(answers), ticket.in(1.to(s.tickets)),
    s' = record(s, language, result, ticket)
  }
  action demote(language: str, duration: int): bool = all {
    language.in(languages), duration.in(Set(-1, 1, 30000, 60000)),
    val current = s.entries.get(language)
    val until = if (duration == -1) -1 else s.now + duration
    val entry = if (current.kind == "demoted" and (current.until == -1 or until != -1 and current.until >= until)) current
      else {kind: "demoted", until: until, ticket: 0}
    s' = {...s, entries: s.entries.set(language, entry)}
  }
  action demoteAll = s' = {...s, demotedAll: true}
  action step = {
    nondet language = languages.oneOf()
    nondet result = answers.oneOf()
    nondet ticket = 1.to(4).oneOf()
    nondet now = times.oneOf()
    nondet duration = Set(-1, 1, 30000, 60000).oneOf()
    any {advance(now), beginProbe(language), completeProbe(ticket, result), cached(language),
      recordNow(language, result), lateAnswer(language, result, ticket), demote(language, duration), demoteAll, s' = s}
  }
  val knownEn = known(s, "en")
  val knownEs = known(s, "es")
  val AllLanguageDemotion = s.demotedAll implies languages.forall(l => known(s, l) == "demoted")
  val RecordedTicketBounded = languages.forall(l => s.entries.get(l).ticket.in(0.to(s.tickets)))
  val PendingTicketAdmitted = 1.to(4).forall(t => s.pending.get(t) == "none" or t <= s.tickets)
  val PermanentEntriesHaveNoDeadline = languages.forall(l =>
    s.entries.get(l).kind == "installed" implies s.entries.get(l).until == -1)
  val DemotionHasNoProbeTicket = languages.forall(l =>
    s.entries.get(l).kind == "demoted" implies s.entries.get(l).ticket == 0)
  val safety = AllLanguageDemotion and RecordedTicketBounded and PendingTicketAdmitted and
    PermanentEntriesHaveNoDeadline and DemotionHasNoProbeTicket
  run newerAnswerKeepsAuthorityTest = init.then(beginProbe("en")).then(beginProbe("en"))
    .then(completeProbe(2, "absent")).then(completeProbe(1, "installed"))
    .expect(safety and known(s, "en") == "absent" and s.entries.get("en").ticket == 2)
  run lateInstalledReplacesUnansweredTest = init.then(beginProbe("en")).then(completeProbe(1, "unanswered"))
    .then(advance(30000)).then(beginProbe("en")).then(completeProbe(2, "unanswered"))
    .then(lateAnswer("en", "installed", 1)).expect(safety and known(s, "en") == "installed")
  run temporaryDemotionCannotBeShortenedTest = init.then(beginProbe("en")).then(demote("en", 60000))
    .then(demote("en", 1)).then(completeProbe(1, "installed")).then(advance(59999))
    .expect(safety and known(s, "en") == "demoted").then(advance(60000)).expect(known(s, "en") == "unknown")
  run globalDemotionSurvivesInFlightAnswerTest = init.then(beginProbe("es")).then(demoteAll)
    .then(completeProbe(1, "installed")).expect(safety and s.reply == "unavailable" and known(s, "es") == "demoted")
}
