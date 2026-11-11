/// Explicit test-mocks device/prototype actions. Every transition changes prototype state only.
module DevelopmentDevice {
  type State = { mocks: bool, screen: str, call: str, callGeneration: int,
    timerGeneration: int, microphoneMuted: bool, speaker: bool, hold: bool, voicemails: int,
    unread: int, notifications: int, position: int, navigation: bool,
    foreground: bool, fakePayment: str }
  var s: State
  action init = s' = { mocks: true, screen: "home", call: "idle", callGeneration: 0,
    timerGeneration: 0, microphoneMuted: false, speaker: false, hold: false, voicemails: 0,
    unread: 0, notifications: 0, position: 0, navigation: false,
    foreground: true, fakePayment: "idle" }
  action productionInit = s' = { mocks: false, screen: "home", call: "idle", callGeneration: 0,
    timerGeneration: 0, microphoneMuted: false, speaker: false, hold: false, voicemails: 0,
    unread: 0, notifications: 0, position: 0, navigation: false,
    foreground: true, fakePayment: "idle" }
  action incomingCall = all { s.mocks, s.call == "idle", s.callGeneration < 2,
    s' = { ...s, call: "ringing", callGeneration: s.callGeneration + 1,
      timerGeneration: s.callGeneration + 1 } }
  action screenCall = all { s.mocks, s.call == "ringing", s' = { ...s, call: "screening" } }
  action answer = all { s.mocks, s.call.in(Set("ringing", "screening")), s' = { ...s, call: "active" } }
  action dial = all { s.mocks, s.call == "idle", s.callGeneration < 2,
    s' = { ...s, call: "dialing", callGeneration: s.callGeneration + 1, timerGeneration: s.callGeneration + 1 } }
  action connected(ticket: int): bool = all { s.mocks,
    s' = if (s.call == "dialing" and ticket == s.callGeneration and ticket == s.timerGeneration)
      { ...s, call: "active" } else s }
  action hangup = all { s.mocks, s.call != "idle",
    s' = { ...s, call: "idle", timerGeneration: -1, microphoneMuted: false, speaker: false, hold: false } }
  /// A decline with a quick reply leaves no voicemail; a plain decline leaves one.
  action decline(reason: bool): bool = all { s.mocks, s.call.in(Set("ringing", "screening")),
    s' = { ...s, call: "idle", timerGeneration: -1,
      voicemails: if (not(reason) and s.voicemails < 2) s.voicemails + 1 else s.voicemails } }
  /// The in-call controls are shown from the moment the call screen opens, before the call is live.
  val inCall = s.call.in(Set("dialing", "active"))
  action mute = all { s.mocks, inCall, s' = { ...s, microphoneMuted: not(s.microphoneMuted) } }
  action speaker = all { s.mocks, inCall, s' = { ...s, speaker: not(s.speaker) } }
  action hold = all { s.mocks, inCall, s' = { ...s, hold: not(s.hold) } }
  action incomingMessage = all { s.mocks, s.unread < 2, s.notifications < 2,
    s' = { ...s, unread: s.unread + 1, notifications: s.notifications + 1 } }
  action readMessage = all { s.mocks, s' = { ...s, unread: 0 } }
  action dismissNotice = all { s.mocks, s.notifications > 0, s' = { ...s, notifications: s.notifications - 1 } }
  action navigate = all { s.mocks, s' = { ...s, navigation: true } }
  action location = all { s.mocks, s.position < 2, s' = { ...s, position: s.position + 1 } }
  action lock = all { s.mocks, s' = { ...s, screen: "lock", foreground: false } }
  action unlock = all { s.mocks, s' = { ...s, screen: "home", foreground: true } }
  action fakeReview = all { s.mocks, s' = { ...s, fakePayment: "review" } }
  action fakeConfirm = all { s.mocks, s.fakePayment == "review", s' = { ...s, fakePayment: "simulated" } }
  action step = {
    nondet ticket = Set(0, 1, 2).oneOf()
    any { incomingCall, screenCall, answer, dial, connected(ticket), hangup, decline(false), decline(true),
      mute, speaker, hold, incomingMessage, readMessage, dismissNotice, navigate, location,
      lock, unlock, fakeReview, fakeConfirm, s' = s }
  }
  val CallControlsRequireCall = (s.microphoneMuted or s.speaker or s.hold) implies inCall
  val ProductionInert = not(s.mocks) implies s.call == "idle" and s.unread == 0 and s.fakePayment == "idle"
    and s.voicemails == 0 and s.notifications == 0 and not(s.navigation)
  val LiveCallOwnsTimer = s.call == "dialing" implies s.timerGeneration == s.callGeneration
  val safety = CallControlsRequireCall and ProductionInert and LiveCallOwnsTimer
  val MutedWhileDialingWitness = s.call == "dialing" and s.microphoneMuted
  val DeclinedWithoutVoicemailWitness = s.call == "idle" and s.callGeneration > 0 and s.voicemails == 0 and s.timerGeneration == -1
  val VoicemailWitness = s.voicemails > 0
  run screenedCallTest = init.then(incomingCall).then(screenCall).then(answer).then(mute).then(hangup)
    .expect(s.call == "idle" and safety)
  run staleCallTimerTest = init.then(dial).then(hangup).then(connected(1))
    .expect(s.call == "idle" and safety)
  run missedCallTest = init.then(incomingCall).then(decline(false)).expect(s.voicemails == 1 and safety)
  run declineWithReplyTest = init.then(incomingCall).then(decline(true)).expect(s.voicemails == 0 and safety)
  /// Mute and speaker toggle while the call is still dialing, and are cleared when it ends.
  run controlsWhileDialingTest = init.then(dial).then(mute).then(speaker)
    .expect(MutedWhileDialingWitness and s.speaker and safety)
    .then(hangup).expect(not(s.microphoneMuted or s.speaker) and safety)
  run notificationTest = init.then(incomingMessage).then(readMessage).then(dismissNotice)
    .expect(s.unread == 0 and s.notifications == 0 and safety)
  run simulatedPaymentTest = init.then(fakeReview).then(fakeConfirm).expect(s.fakePayment == "simulated" and safety)
  run productionInertTest = productionInit.expect(safety and not(s.mocks))
}
