// Home overview cards for Messages and Phone: shown from live sources, one tap opens the view, reading clears.
module TelephonyAttention {
  type State = {
    image: bool, sources: bool,
    texts: int, missed: int, voicemail: int,
    opened: str
  }
  var s: State
  action check(condition: bool): bool = all { assert(condition), s' = s }
  action init = s' = {image: false, sources: false, texts: 0, missed: 0, voicemail: 0, opened: "home"}
  // Like the agenda and mail cards, a card exists only while its source has rows; there is no dismissal.
  val messagesCard = s.image and s.sources and s.texts > 0
  val phoneCard = s.image and s.sources and s.missed + s.voicemail > 0
  action admitImage = s' = {image: true, ...s}
  // A source report is accepted in any distribution; only an admitted image can show a card.
  action sourcesLoad(ok: bool): bool = s' = {sources: ok, ...s}
  action textArrives = all { s.image, s.texts < 3, s' = {texts: s.texts + 1, ...s} }
  action callMissed = all { s.image, s.missed < 3, s' = {missed: s.missed + 1, ...s} }
  action voicemailArrives = all { s.image, s.voicemail < 3, s' = {voicemail: s.voicemail + 1, ...s} }
  // The whole card is one target. One unread thread opens that thread; several open the list.
  action openMessages = all {
    messagesCard, s.opened == "home",
    s' = if (s.texts == 1) {opened: "thread", texts: 0, ...s} else {opened: "threads", ...s}
  }
  action readThread = all { s.opened == "threads", s.texts > 0, s' = {texts: s.texts - 1, ...s} }
  // Missed calls lead to Recents, which marks them seen; otherwise the card leads to Voicemail.
  action openPhone = all {
    phoneCard, s.opened == "home",
    s' = if (s.missed > 0) {opened: "recents", missed: 0, ...s} else {opened: "voicemail", ...s}
  }
  action hearVoicemail = all { s.opened == "voicemail", s.voicemail > 0, s' = {voicemail: s.voicemail - 1, ...s} }
  action goHome = s' = {opened: "home", ...s}
  // Read, returned or deleted from a notification or another client.
  action clearedElsewhere(kind: str): bool =
    if (kind == "texts") s' = {texts: 0, ...s}
    else if (kind == "missed") s' = {missed: 0, ...s}
    else s' = {voicemail: 0, ...s}
  action step = {
    nondet flag = Set(false, true).oneOf()
    nondet kind = Set("texts", "missed", "voicemail").oneOf()
    any { admitImage, sourcesLoad(flag), textArrives, callMissed, voicemailArrives, openMessages, readThread,
      openPhone, hearVoicemail, goHome, clearedElsewhere(kind) }
  }
  val NoCardWithoutImage = not(s.image) implies not(messagesCard) and not(phoneCard)
  val NoCardWithoutSource = not(s.sources) implies not(messagesCard) and not(phoneCard)
  val CardNeedsItems = (messagesCard implies s.texts > 0) and (phoneCard implies s.missed + s.voicemail > 0)
  val CountsBounded = s.texts >= 0 and s.missed >= 0 and s.voicemail >= 0
  val OpenedIsAView = s.opened.in(Set("home", "thread", "threads", "recents", "voicemail"))
  val safety = NoCardWithoutImage and NoCardWithoutSource and CardNeedsItems and CountsBounded and OpenedIsAView

  run oneUnreadOpensThreadTest = init.then(admitImage).then(sourcesLoad(true)).then(textArrives).then(openMessages)
    .then(check(safety and s.opened == "thread" and not(messagesCard)))
  run severalUnreadOpenListTest = init.then(admitImage).then(sourcesLoad(true)).then(textArrives).then(textArrives)
    .then(openMessages).then(check(s.opened == "threads" and s.texts == 2)).then(readThread).then(goHome)
    .then(check(safety and messagesCard and s.texts == 1))
  run missedLeadsToRecentsTest = init.then(admitImage).then(sourcesLoad(true)).then(callMissed).then(voicemailArrives)
    .then(openPhone).then(check(s.opened == "recents" and s.missed == 0)).then(goHome)
    .then(check(safety and phoneCard)).then(openPhone).then(check(s.opened == "voicemail"))
    .then(hearVoicemail).then(goHome).then(check(safety and not(phoneCard)))
  run failedSourceHidesCardsTest = init.then(admitImage).then(sourcesLoad(true)).then(textArrives).then(callMissed)
    .then(sourcesLoad(false)).then(check(safety and not(messagesCard) and not(phoneCard)))
  run readElsewhereClearsCardTest = init.then(admitImage).then(sourcesLoad(true)).then(textArrives)
    .then(clearedElsewhere("texts")).then(check(safety and not(messagesCard)))
  run standaloneHasNoCardsTest = init.then(sourcesLoad(true)).then(check(safety and not(messagesCard) and not(phoneCard)))
  run arrivalWhileInViewKeepsCardForLaterTest = init.then(admitImage).then(sourcesLoad(true)).then(textArrives)
    .then(openMessages).then(textArrives).then(goHome).then(check(safety and messagesCard))
}
