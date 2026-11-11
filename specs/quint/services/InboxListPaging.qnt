/// The Inbox message list: one read in flight, page cursors used once, and results applied
/// only to the account and folder they were requested for.
module InboxListPaging {
  type Flight = { pending: bool, account: int, query: int, more: bool }
  type Saved = { present: bool, account: int, query: int, pages: int, cursor: int, seen: Set[int] }
  type Paging = {
    account: int, query: int, generation: int, busy: bool, flights: int -> Flight,
    pages: int, shownAccount: int, shownQuery: int, loadedQuery: int,
    cursor: int, seenCursors: Set[int], usedCursors: Set[int],
    newerMail: bool, failure: bool, cachedShown: bool, saved: Saved
  }
  var s: Paging
  pure val idle: Flight = { pending: false, account: 0, query: 0, more: false }
  pure val nothingSaved: Saved = { present: false, account: 0, query: 0, pages: 0, cursor: 0, seen: Set() }
  pure val tokens = 1.to(5)
  action init = s' = {
    account: 1, query: 1, generation: 0, busy: false, flights: tokens.mapBy(t => idle),
    pages: 0, shownAccount: 0, shownQuery: 0, loadedQuery: 0,
    cursor: 0, seenCursors: Set(), usedCursors: Set(),
    newerMail: false, failure: false, cachedShown: false, saved: nothingSaved }
  pure def cleared(v: Paging): Paging = { ...v, busy: false, pages: 0, shownAccount: 0, shownQuery: 0,
    loadedQuery: 0, cursor: 0, seenCursors: Set(), usedCursors: Set(), newerMail: false,
    failure: false, cachedShown: false }
  pure def current(v: Paging, t: int): bool =
    t == v.generation and v.flights.get(t).account == v.account and v.flights.get(t).query == v.query
  /// A first-page read replaces the list. It drops the saved copy of this folder.
  action loadFirst = all {
    not(s.busy), s.generation < 5,
    s' = { ...s, generation: s.generation + 1, busy: true, failure: false, cachedShown: false,
      flights: s.flights.set(s.generation + 1, { pending: true, account: s.account, query: s.query, more: false }),
      saved: if (s.saved.account == s.account and s.saved.query == s.query) nothingSaved else s.saved }
  }
  /// The cursor is given up when its page is requested, whether or not the page arrives.
  action loadMore = all {
    not(s.busy), s.generation < 5, s.cursor != 0, s.query == s.loadedQuery,
    s' = { ...s, generation: s.generation + 1, busy: true, failure: false, cursor: 0,
      usedCursors: s.usedCursors.union(Set(s.cursor)),
      flights: s.flights.set(s.generation + 1, { pending: true, account: s.account, query: s.query, more: true }) }
  }
  /// `following` is the provider's cursor for the following page (0 for none). `shifted` says the
  /// mailbox changed between pages.
  action reply(t: int, following: int, shifted: bool): bool = all {
    s.flights.get(t).pending,
    val landed = { ...s, flights: s.flights.set(t, idle) }
    if (not(current(s, t))) s' = landed
    else if (not(s.flights.get(t).more))
      s' = { ...landed, busy: false, pages: 1, shownAccount: s.account, shownQuery: s.query,
        loadedQuery: s.query, cursor: following, seenCursors: if (following == 0) Set() else Set(following),
        usedCursors: Set(), newerMail: false, cachedShown: false }
    else {
      val fresh = following != 0 and not(s.seenCursors.contains(following))
      s' = { ...landed, busy: false, pages: if (s.pages < 3) s.pages + 1 else 3,
        cursor: if (fresh) following else 0,
        seenCursors: if (fresh) s.seenCursors.union(Set(following)) else s.seenCursors,
        newerMail: s.newerMail or shifted, cachedShown: false }
    }
  }
  /// A failed page keeps the messages already shown. Retry starts again from the first page.
  action pageFailed(t: int): bool = all {
    s.flights.get(t).pending,
    val landed = { ...s, flights: s.flights.set(t, idle) }
    if (current(s, t)) s' = { ...landed, busy: false, failure: true } else s' = landed
  }
  action changeFolder = all {
    s.generation < 5,
    s' = { ...cleared(s), generation: s.generation + 1, query: if (s.query == 1) 2 else 1 }
  }
  action selectAccount = all {
    s.generation < 5,
    s' = { ...cleared(s), generation: if (s.busy) s.generation + 1 else s.generation,
      account: if (s.account == 1) 2 else 1 }
  }
  /// A settled list is kept so that returning to its folder shows it at once.
  action remember = all {
    not(s.busy), not(s.failure), s.pages > 0,
    s' = { ...s, saved: { present: true, account: s.account, query: s.loadedQuery, pages: s.pages,
      cursor: s.cursor, seen: s.seenCursors } }
  }
  action restoreSaved = all {
    not(s.busy), s.pages == 0, s.saved.present, s.saved.account == s.account, s.saved.query == s.query,
    s' = { ...s, pages: s.saved.pages, shownAccount: s.account, shownQuery: s.query,
      loadedQuery: s.query, cursor: s.saved.cursor, seenCursors: s.saved.seen,
      usedCursors: s.saved.seen.exclude(Set(s.saved.cursor)), cachedShown: true }
  }
  /// A changed grant or session drops every saved list.
  action invalidate = s' = { ...s, saved: nothingSaved }
  action step = any {
    loadFirst, loadMore, changeFolder, selectAccount, remember, restoreSaved, invalidate,
    { nondet t = tokens.oneOf()
      nondet following = Set(0, 1, 2).oneOf()
      nondet shifted = Bool.oneOf()
      reply(t, following, shifted) },
    { nondet t = tokens.oneOf()
      pageFailed(t) },
    s' = s
  }
  val ShownBelongsToSelection = s.pages > 0 implies s.shownAccount == s.account
    and s.shownQuery == s.query and s.loadedQuery == s.query
  val SingleFlight = tokens.filter(t => s.flights.get(t).pending and t == s.generation).size()
    == (if (s.busy) 1 else 0)
  val CursorUsedOnce = s.cursor != 0 implies not(s.usedCursors.contains(s.cursor))
  val CursorNeedsList = s.cursor != 0 implies s.pages > 0 and s.loadedQuery == s.query
  val SavedListMarked = s.cachedShown implies s.pages > 0
  val TypeOK = s.generation.in(0.to(5)) and s.pages.in(0.to(3)) and s.cursor.in(0.to(2))
    and s.account.in(Set(1, 2)) and s.query.in(Set(1, 2))
  val safety = TypeOK and ShownBelongsToSelection and SingleFlight and CursorUsedOnce
    and CursorNeedsList and SavedListMarked
  val StaleFlightWitness = tokens.exists(t => s.flights.get(t).pending and t != s.generation) and s.pages > 0
  val SavedListShownWitness = s.cachedShown and s.cursor != 0
  val ChangedMailboxWitness = s.newerMail and s.pages == 2
  val RepeatedCursorWitness = s.pages == 2 and s.cursor == 0 and s.seenCursors.size() == 1 and not(s.failure)
  /// A reply for the folder that was left is dropped, even though it arrives after the change.
  run staleReplyDroppedTest = init.then(loadFirst).then(changeFolder)
    .expect(not(s.busy) and s.flights.get(1).pending and safety)
    .then(reply(1, 1, false)).expect(s.pages == 0 and s.cursor == 0 and safety)
  run replyForOtherAccountDroppedTest = init.then(loadFirst).then(selectAccount).then(loadFirst)
    .then(reply(1, 1, false)).expect(s.pages == 0 and s.busy and safety)
    .then(reply(3, 0, false)).expect(s.pages == 1 and s.shownAccount == 2 and safety)
  /// A provider cursor that repeats would page forever. It ends the list instead.
  run repeatedCursorEndsPagingTest = init.then(loadFirst).then(reply(1, 1, false))
    .expect(s.cursor == 1).then(loadMore).then(reply(2, 1, false))
    .expect(s.pages == 2 and s.cursor == 0 and safety)
    .then(loadMore.fail())
  run failedPageKeepsListTest = init.then(loadFirst).then(reply(1, 1, false)).then(loadMore)
    .then(pageFailed(2)).expect(s.pages == 1 and s.cursor == 0 and s.failure and safety)
    .then(loadFirst).then(reply(3, 2, false)).expect(s.pages == 1 and s.cursor == 2 and safety)
  run singleFlightTest = init.then(loadFirst).expect(s.busy and safety)
    .then(loadFirst.fail())
  run savedListRestoredTest = init.then(loadFirst).then(reply(1, 2, false)).then(remember)
    .then(changeFolder).then(changeFolder).then(restoreSaved)
    .expect(s.pages == 1 and s.cursor == 2 and s.cachedShown and safety)
    .then(loadMore).then(reply(4, 0, true)).expect(s.pages == 2 and s.newerMail and not(s.cachedShown) and safety)
}
