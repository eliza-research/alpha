/// Explicit test-mocks device/prototype actions. No transition invokes a real service.
module DevelopmentDevice {
  type State = { mocks: bool, screen: str, call: str, callGeneration: int,
    timerGeneration: int, microphoneMuted: bool, speaker: bool, voicemail: bool,
    unread: int, notifications: int, position: int, navigation: bool,
    foreground: bool, fakePayment: str, realEffects: int }
  var s: State
  action init = s' = { mocks: true, screen: "home", call: "idle", callGeneration: 0,
    timerGeneration: 0, microphoneMuted: false, speaker: false, voicemail: false,
    unread: 0, notifications: 0, position: 0, navigation: false,
    foreground: true, fakePayment: "idle", realEffects: 0 }
  action productionInit = s' = { mocks: false, screen: "home", call: "idle", callGeneration: 0,
    timerGeneration: 0, microphoneMuted: false, speaker: false, voicemail: false,
    unread: 0, notifications: 0, position: 0, navigation: false,
    foreground: true, fakePayment: "idle", realEffects: 0 }
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
    s' = { ...s, call: "idle", timerGeneration: -1, microphoneMuted: false, speaker: false } }
  action decline = all { s.mocks, s.call.in(Set("ringing", "screening")),
    s' = { ...s, call: "idle", timerGeneration: -1, voicemail: true } }
  action mute = all { s.mocks, s.call == "active", s' = { ...s, microphoneMuted: not(s.microphoneMuted) } }
  action speaker = all { s.mocks, s.call == "active", s' = { ...s, speaker: not(s.speaker) } }
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
    any { incomingCall, screenCall, answer, dial, connected(ticket), hangup, decline,
      mute, speaker, incomingMessage, readMessage, dismissNotice, navigate, location,
      lock, unlock, fakeReview, fakeConfirm, s' = s }
  }
  val NoRealEffects = s.realEffects == 0
  val CallControlsRequireCall = (s.microphoneMuted or s.speaker) implies s.call == "active"
  val ProductionInert = not(s.mocks) implies s.call == "idle" and s.unread == 0 and s.fakePayment == "idle"
  val safety = NoRealEffects and CallControlsRequireCall and ProductionInert
  run screenedCallTest = init.then(incomingCall).then(screenCall).then(answer).then(mute).then(hangup)
    .expect(s.call == "idle" and safety)
  run staleCallTimerTest = init.then(dial).then(hangup).then(connected(1))
    .expect(s.call == "idle" and safety)
  run missedCallTest = init.then(incomingCall).then(decline).expect(s.voicemail and safety)
  run notificationTest = init.then(incomingMessage).then(readMessage).then(dismissNotice)
    .expect(s.unread == 0 and s.notifications == 0 and safety)
  run simulatedPaymentTest = init.then(fakeReview).then(fakeConfirm).expect(s.fakePayment == "simulated" and safety)
  run productionInertTest = productionInit.expect(safety and not(s.mocks))
}
