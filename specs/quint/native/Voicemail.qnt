// Carrier visual voicemail: provider sync, audio fetch, playback and transcription under the speech setting.
module Voicemail {
  type State = {
    ready: bool, carrier: str,
    item: str, generation: int, heard: bool,
    audio: str, audioTicket: int,
    transcript: str, transcriptTicket: int, engine: str,
    stt: str, localStt: bool,
    playback: str, inCall: bool,
    cloudUploads: int, confirmDelete: bool
  }
  var s: State
  action check(condition: bool): bool = all { assert(condition), s' = s }
  action init = s' = {
    ready: false, carrier: "unknown",
    item: "absent", generation: 0, heard: false,
    audio: "none", audioTicket: -1,
    transcript: "none", transcriptTicket: -1, engine: "none",
    stt: "local", localStt: true,
    playback: "idle", inCall: false,
    cloudUploads: 0, confirmDelete: false
  }
  def cleared(x: State): State = {item: "absent", heard: false, audio: "none", audioTicket: -1, transcript: "none",
    transcriptTicket: -1, engine: "none", playback: "idle", confirmDelete: false, ...x}
  // ready = verified image, dialer role, voicemail access, unlocked and in front.
  action becomeReady = s' = {ready: true, ...s}
  action loseReady = s' = {ready: false, playback: "idle", confirmDelete: false, ...s}
  action carrierStatus(status: str): bool = all {
    status.in(Set("unsupported", "unconfigured", "ready")),
    s' = if (status == "ready") {carrier: status, ...s} else cleared({carrier: status, ...s})
  }
  // The provider gains a message; a replacement is a new generation.
  action arrive = all {
    s.carrier == "ready", s.generation < 3,
    s' = {item: "present", generation: s.generation + 1, ...cleared(s)}
  }
  action setStt(mode: str): bool = all { mode.in(Set("local", "cloud")), s' = {stt: mode, ...s} }
  action localSttChanges(available: bool): bool = s' = {localStt: available, ...s}
  action fetchAudio = all {
    s.ready, s.item == "present", s.audio.in(Set("none", "failed")),
    s' = {audio: "fetching", audioTicket: s.generation, ...s}
  }
  action audioReply(ticket: int, ok: bool): bool =
    if (s.audio == "fetching" and ticket == s.audioTicket and ticket == s.generation and s.item == "present")
      s' = {audio: if (ok) "ready" else "failed", ...s}
    else s' = s
  // Transcription follows the owner's speech setting; an unavailable local recognizer never falls back to cloud.
  action transcribe = all {
    s.ready, s.item == "present", s.audio == "ready", s.transcript.in(Set("none", "failed", "unavailable")),
    if (s.stt == "local" and not(s.localStt)) s' = {transcript: "unavailable", engine: "none", ...s}
    else s' = {transcript: "running", transcriptTicket: s.generation, engine: s.stt,
      cloudUploads: if (s.stt == "cloud") s.cloudUploads + 1 else s.cloudUploads, ...s}
  }
  action transcriptReply(ticket: int, ok: bool): bool =
    if (s.transcript == "running" and ticket == s.transcriptTicket and ticket == s.generation and s.item == "present")
      s' = {transcript: if (ok) "done" else "failed", engine: if (ok) s.engine else "none", ...s}
    else s' = s
  action play = all {
    s.ready, s.item == "present", s.audio == "ready", not(s.inCall), s.playback != "playing",
    s' = {playback: "playing", heard: true, ...s}
  }
  action pausePlayback = all { s.playback == "playing", s' = {playback: "paused", ...s} }
  action playbackEnds = all { s.playback == "playing", s' = {playback: "idle", ...s} }
  action callStarts = s' = {inCall: true, playback: if (s.playback == "playing") "paused" else s.playback, ...s}
  action callEnds = s' = {inCall: false, ...s}
  action markHeard = all { s.ready, s.item == "present", s' = {heard: true, ...s} }
  action askDelete = all { s.ready, s.item == "present", s' = {confirmDelete: true, ...s} }
  action cancelDelete = all { s.confirmDelete, s' = {confirmDelete: false, ...s} }
  action confirmDeleteNow(ok: bool): bool = all {
    s.ready, s.confirmDelete, s.item == "present",
    s' = if (ok) cleared(s) else {confirmDelete: false, ...s}
  }
  // The carrier or another client removes the message.
  action remoteDelete = all { s.item == "present", s' = cleared(s) }
  action step = {
    nondet flag = Set(false, true).oneOf()
    nondet ticket = Set(-1, 0, 1, 2, 3).oneOf()
    nondet status = Set("unsupported", "unconfigured", "ready").oneOf()
    nondet mode = Set("local", "cloud").oneOf()
    any { becomeReady, loseReady, carrierStatus(status), arrive, setStt(mode), localSttChanges(flag), fetchAudio,
      audioReply(ticket, flag), transcribe, transcriptReply(ticket, flag), play, pausePlayback, playbackEnds,
      callStarts, callEnds, markHeard, askDelete, cancelDelete, confirmDeleteNow(flag), remoteDelete }
  }
  val isNew = s.item == "present" and not(s.heard)
  val NothingWithoutCarrier = s.carrier != "ready" implies s.item == "absent"
  val AbsentIsClean = s.item == "absent" implies
    s.audio == "none" and s.transcript == "none" and s.playback == "idle" and not(s.heard) and not(s.confirmDelete)
  val PlaybackNeedsAudio = s.playback != "idle" implies s.audio == "ready" and s.item == "present"
  val NoPlaybackDuringCall = s.inCall implies s.playback != "playing"
  val PlayingIsHeard = s.playback != "idle" implies s.heard
  val TranscriptMatchesMessage = s.transcript.in(Set("running", "done", "failed")) implies
    s.transcriptTicket == s.generation and s.audio == "ready"
  val CloudOnlyWhenChosen = s.transcript.in(Set("running", "done")) implies s.engine.in(Set("local", "cloud"))
  val PlayingNeedsFront = s.playback == "playing" implies s.ready
  val safety = NothingWithoutCarrier and AbsentIsClean and PlaybackNeedsAudio and NoPlaybackDuringCall and
    PlayingIsHeard and TranscriptMatchesMessage and CloudOnlyWhenChosen and PlayingNeedsFront

  run transcribedLocallyTest = init.then(becomeReady).then(carrierStatus("ready")).then(arrive).then(fetchAudio)
    .then(audioReply(1, true)).then(transcribe).then(transcriptReply(1, true))
    .then(check(safety and s.transcript == "done" and s.engine == "local" and s.cloudUploads == 0 and isNew))
  run noSilentCloudFallbackTest = init.then(becomeReady).then(carrierStatus("ready")).then(arrive).then(fetchAudio)
    .then(audioReply(1, true)).then(localSttChanges(false)).then(transcribe)
    .then(check(safety and s.transcript == "unavailable" and s.cloudUploads == 0))
  run cloudSettingUploadsOnceTest = init.then(becomeReady).then(carrierStatus("ready")).then(arrive).then(setStt("cloud"))
    .then(fetchAudio).then(audioReply(1, true)).then(transcribe).then(transcriptReply(1, true))
    .then(check(safety and s.engine == "cloud" and s.cloudUploads == 1))
  run staleTranscriptAfterReplacementTest = init.then(becomeReady).then(carrierStatus("ready")).then(arrive)
    .then(fetchAudio).then(audioReply(1, true)).then(transcribe).then(arrive).then(transcriptReply(1, true))
    .then(check(safety and s.transcript == "none" and s.generation == 2))
  run staleAudioAfterDeleteTest = init.then(becomeReady).then(carrierStatus("ready")).then(arrive).then(fetchAudio)
    .then(remoteDelete).then(audioReply(1, true)).then(check(safety and s.audio == "none"))
  run playMarksHeardTest = init.then(becomeReady).then(carrierStatus("ready")).then(arrive).then(fetchAudio)
    .then(audioReply(1, true)).then(play).then(check(safety and s.heard and not(isNew)))
  run callPausesPlaybackTest = init.then(becomeReady).then(carrierStatus("ready")).then(arrive).then(fetchAudio)
    .then(audioReply(1, true)).then(play).then(callStarts).then(check(safety and s.playback == "paused"))
  run unsupportedCarrierIsEmptyTest = init.then(becomeReady).then(carrierStatus("ready")).then(arrive)
    .then(carrierStatus("unsupported")).then(check(safety and s.item == "absent"))
  run failedAudioCanRetryTest = init.then(becomeReady).then(carrierStatus("ready")).then(arrive).then(fetchAudio)
    .then(audioReply(1, false)).then(check(s.audio == "failed")).then(fetchAudio).then(audioReply(1, true))
    .then(check(safety and s.audio == "ready"))
  run deleteNeedsConfirmTest = init.then(becomeReady).then(carrierStatus("ready")).then(arrive).then(askDelete)
    .then(check(s.item == "present")).then(confirmDeleteNow(true)).then(check(safety and s.item == "absent"))
  run lockStopsPlaybackTest = init.then(becomeReady).then(carrierStatus("ready")).then(arrive).then(fetchAudio)
    .then(audioReply(1, true)).then(play).then(loseReady).then(check(safety and s.playback == "idle"))
}
