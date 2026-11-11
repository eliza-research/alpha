/// Read aloud in the renderer: Listen on one chat message (`listen`) and note read-aloud
/// (`readNoteAloud`). Starting either stops the other and any earlier reading, and no audio
/// starts until the audio it replaced has finished stopping. A reading that lost its message,
/// screen or connection stops, and only a reading that played to its end reports that it finished.
module ReadAloud {
  type State = { message: str, messageId: int, messagePlaying: bool, note: str, notePlaying: bool,
    retiring: bool, noteStarted: bool, noteOutcome: str, starts: int, stops: int }
  var s: State
  pure def messageActive(st: State): bool = st.message.in(Set("waiting", "preparing", "reading"))
  // stop(shell): the message reading is forgotten; audio it was playing still has to stop.
  pure def messageStopped(st: State, shown: str): State = { ...st, message: shown, messagePlaying: false,
    retiring: st.retiring or st.messagePlaying, stops: if (messageActive(st)) st.stops + 1 else st.stops }
  // stopSpeaking(): the same for the note reading, which then reports that it was stopped.
  pure def noteStopped(st: State): State =
    if (st.note == "none") st
    else { ...st, note: "none", notePlaying: false, retiring: st.retiring or st.notePlaying,
      noteOutcome: "stopped", stops: st.stops + 1 }

  action init = s' = { message: "none", messageId: 0, messagePlaying: false, note: "none", notePlaying: false,
    retiring: false, noteStarted: false, noteOutcome: "none", starts: 0, stops: 0 }
  // Listen on a message. The same message while it is being read stops it; anything else replaces
  // the current reading and waits for the previous audio to stop.
  action listenMessage(id: int): bool = all { s.starts < 5,
    s' = if (messageActive(s) and s.messageId == id) messageStopped(s, "none")
      else { ...messageStopped(noteStopped(s), "none"), message: "waiting", messageId: id, starts: s.starts + 1 } }
  // The chosen voice is prepared only once the earlier audio is confirmed stopped.
  action messagePrepares = all { s.message == "waiting", not(s.retiring), s' = { ...s, message: "preparing" } }
  action messageReady(ok: bool): bool = all { s.message == "preparing",
    s' = if (ok) { ...s, message: "reading", messagePlaying: true } else { ...s, message: "failed" } }
  action messagePlaybackEnds(ok: bool): bool = all { s.message == "reading", s.messagePlaying,
    s' = { ...s, message: if (ok) "finished" else "failed", messagePlaying: false } }
  // A new user message, another screen or conversation, a closed chat, a hidden page or the
  // connection chooser: the reading no longer belongs to what is shown.
  action messageContextLost = all { messageActive(s), s' = messageStopped(s, "none") }
  // Note read-aloud first stops whatever is being read.
  action readNote(available: bool): bool = all { s.starts < 5,
    s' = if (available)
        { ...messageStopped(noteStopped(s), "none"), note: "waiting", noteStarted: false, noteOutcome: "none", starts: s.starts + 1 }
      else { ...messageStopped(noteStopped(s), "none"), noteOutcome: "unavailable" } }
  action notePrepares = all { s.note == "waiting", not(s.retiring), s' = { ...s, note: "preparing" } }
  action noteReady(ok: bool): bool = all { s.note == "preparing",
    s' = if (ok) { ...s, note: "reading", notePlaying: true, noteStarted: true }
      else { ...s, note: "none", noteOutcome: "unavailable" } }
  action notePlaybackEnds(ok: bool): bool = all { s.note == "reading", s.notePlaying,
    s' = { ...s, note: "none", notePlaying: false, noteOutcome: if (ok) "finished" else "failed" } }
  // Leaving or editing the note.
  action stopNote = all { s.note != "none", s' = noteStopped(s) }
  action retirementSettles = all { s.retiring, s' = { ...s, retiring: false } }
  action step = {
    nondet id = Set(1, 2).oneOf()
    nondet ok = Set(false, true).oneOf()
    any { listenMessage(id), messagePrepares, messageReady(ok), messagePlaybackEnds(ok), messageContextLost,
      readNote(ok), notePrepares, noteReady(ok), notePlaybackEnds(ok), stopNote, retirementSettles, s' = s }
  }

  val OneReaderAudible = not(s.messagePlaying and s.notePlaying)
  val OneReadingAtATime = not(messageActive(s) and s.note != "none")
  val AudioWaitsForRetirement = (s.messagePlaying or s.notePlaying or s.message == "preparing" or s.note == "preparing")
    implies not(s.retiring)
  val PlayingMatchesPhase = (s.messagePlaying == (s.message == "reading")) and (s.notePlaying == (s.note == "reading"))
  val FinishedNotePlayed = s.noteOutcome == "finished" implies (s.noteStarted and s.note == "none")
  val StopsNeedStarts = s.stops <= s.starts
  val safety = OneReaderAudible and OneReadingAtATime and AudioWaitsForRetirement and PlayingMatchesPhase and
    FinishedNotePlayed and StopsNeedStarts

  val WaitingBehindRetirementWitness = s.message == "waiting" and s.retiring
  val NoteReplacesMessageWitness = s.note == "reading" and s.stops > 0 and s.messageId != 0
  val ToggledOffWitness = s.message == "none" and s.messageId == 1 and s.stops == 1 and s.starts == 1

  run messageReadToEndTest = init.then(listenMessage(1)).then(messagePrepares).then(messageReady(true))
    .expect(s.message == "reading" and s.messagePlaying).then(messagePlaybackEnds(true))
    .expect(s.message == "finished" and not(s.messagePlaying) and not(s.retiring) and safety)
  // A second message is chosen while the first is audible: its audio starts only after the
  // first has stopped, so the two are never heard together.
  run replacementWaitsForStoppedAudioTest = init.then(listenMessage(1)).then(messagePrepares).then(messageReady(true))
    .then(listenMessage(2)).expect(s.message == "waiting" and s.messageId == 2 and s.retiring and not(s.messagePlaying) and safety)
    .then(retirementSettles).then(messagePrepares).then(messageReady(true))
    .expect(s.message == "reading" and s.messagePlaying and s.stops == 1 and safety)
  run sameMessageTogglesOffTest = init.then(listenMessage(1)).then(messagePrepares).then(messageReady(true))
    .then(listenMessage(1)).expect(s.message == "none" and s.retiring and s.starts == 1 and safety)
  run noteReadingStopsMessageTest = init.then(listenMessage(1)).then(messagePrepares).then(messageReady(true))
    .then(readNote(true)).expect(s.message == "none" and s.note == "waiting" and s.retiring and safety)
    .then(retirementSettles).then(notePrepares).then(noteReady(true)).then(notePlaybackEnds(true))
    .expect(s.noteOutcome == "finished" and s.note == "none" and safety)
  run editedNoteStopsReadingTest = init.then(readNote(true)).then(notePrepares).then(noteReady(true)).then(stopNote)
    .expect(s.noteOutcome == "stopped" and s.retiring and not(s.notePlaying) and safety)
  run lostContextStopsMessageTest = init.then(listenMessage(1)).then(messagePrepares).then(messageContextLost)
    .expect(s.message == "none" and not(s.retiring) and s.stops == 1 and safety)
}
