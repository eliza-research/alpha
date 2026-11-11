/// The reference shell's screen (boot, lock, off, home), its P-23 refusal to expose Camera on
/// the lock frame, scripted voice and the timer groups each of them owns. Android owns Keyguard.
module ShellScreen {
  type State = {
    screen: str, bootPending: bool,
    // The open view ("" is Home) and the view whose own timers are armed ("" is none).
    view: str, viewTimers: str,
    secure: bool,
    voice: str, voiceTimers: bool,
    // The view on screen was reopened as it was left (kept state, or Back's stack pop).
    kept: bool
  }
  var s: State

  pure val Views = Set("camera", "photos", "notes")
  pure val SecureViews = Set("camera", "photos")
  /// Leaving a view clears the timers it armed.
  pure def left(v: State, target: str): State = if (v.view != target) { ...v, viewTimers: "" } else v

  action init = s' = { screen: "boot", bootPending: true, view: "", viewTimers: "", secure: false,
    voice: "off", voiceTimers: false, kept: false }
  /// The boot animation ends on the lock screen whatever was opened meanwhile.
  action bootTick = all { s.bootPending, s' = { ...s, bootPending: false, screen: "lock" } }
  action unlock = all { s.screen == "lock", s' = { ...s, screen: "home", secure: false, kept: false } }
  action power = all { s.screen != "boot",
    s' = if (s.screen == "off") { ...s, screen: "lock", voiceTimers: false }
      else if (s.screen == "lock") { ...s, screen: "off", voice: "off", voiceTimers: false }
      else { ...s, screen: "lock", voice: "off", voiceTimers: false } }
  /// There is no Alpha Camera control on the lock frame; an attempted activation cannot
  /// dispatch openView or change the locked state. The user first activates Unlock.
  action tryLockedCamera = all { s.screen == "lock", s' = s }
  /// A secure session opens only its own views; anything else returns to the lock screen.
  action openView(view: str): bool = all { view.in(Views),
    s' = if (s.secure and not(view.in(SecureViews)))
        { ...left(s, ""), view: "", secure: false, screen: "lock", kept: false }
      else { ...left(s, view), view: view, screen: "home", kept: false } }
  /// Returning to a view exactly as it was left, or to the previous view on the Back stack, is
  /// held to the secure session like any other open.
  action openKept(view: str): bool = all { view.in(Views),
    s' = if (s.secure and not(view.in(SecureViews)))
        { ...left(s, ""), view: "", secure: false, screen: "lock", kept: false }
      else { ...left(s, view), view: view, screen: "home", kept: true } }
  action goHome = s' = if (s.secure) { ...left(s, ""), view: "", secure: false, screen: "lock", kept: false }
    else { ...left(s, ""), view: "", kept: false }
  action armViewTimer = all { s.view != "", s' = { ...s, viewTimers: s.view } }
  /// Voice wakes a dark screen to the lock screen and never starts during boot.
  action startVoice = all { s.screen != "boot",
    s' = { ...s, screen: if (s.screen == "off") "lock" else s.screen, voice: "listening",
      voiceTimers: true } }
  action voiceAdvance = all { s.voiceTimers, s.voice != "off",
    s' = if (s.voice == "listening") { ...s, voice: "thinking" }
      else if (s.voice == "thinking") { ...s, voice: "speaking" }
      else { ...s, voice: "off", voiceTimers: false } }
  action stopVoice = all { s.voice != "off", s' = { ...s, voice: "off", voiceTimers: false } }
  action step = {
    nondet view = Views.oneOf()
    any { bootTick, unlock, power, tryLockedCamera, openView(view), openKept(view), goHome, armViewTimer,
      startVoice, voiceAdvance, stopVoice, s' = s }
  }

  val VoiceNeedsLitScreen = s.voice != "off" implies s.screen == "lock" or s.screen == "home"
  val VoiceTimersOwned = s.voiceTimers implies s.voice != "off"
  val ViewTimersOwned = s.viewTimers != "" implies s.viewTimers == s.view
  /// A secure session shows only its own views, by every route into a view.
  val SecureConfinement = s.secure implies s.view.in(SecureViews)
  /// Alpha has no secure-camera entry: none of its user controls creates a secure session.
  val NoAlphaSecureSession = not(s.secure)
  /// A kept reopen always leaves a view open, and nothing returns the screen to boot under it.
  val KeptShowsView = s.kept implies s.view != "" and s.screen != "boot"
  val safety = VoiceNeedsLitScreen and VoiceTimersOwned and ViewTimersOwned and
    SecureConfinement and NoAlphaSecureSession and KeptShowsView

  val UnlockedKeptCameraWitness = not(s.secure) and s.kept and s.screen == "home" and s.view == "camera"
  val LockedViewWitness = s.screen == "lock" and s.view != "" and not(s.secure)
  val VoiceOnLockWitness = s.voice == "speaking" and s.screen == "lock"
  val LateBootLockWitness = not(s.bootPending) and s.screen == "lock" and s.view == "notes" and s.viewTimers == "notes"

  run lockedCameraRefusedTest = init.then(bootTick).then(tryLockedCamera)
    .expect(s.screen == "lock" and s.view == "" and not(s.secure) and safety)
  run unlockThenCameraTest = init.then(bootTick).then(tryLockedCamera).then(unlock).then(openView("camera"))
    .expect(s.screen == "home" and s.view == "camera" and not(s.secure) and safety)
    .then(goHome).expect(s.screen == "home" and s.view == "" and safety)
  // After Unlock, kept state and Back's stack pop remain ordinary app navigation.
  run keptReopenAfterUnlockTest = init.then(bootTick).then(tryLockedCamera).then(unlock)
    .then(openView("camera")).then(openKept("notes"))
    .expect(s.screen == "home" and s.view == "notes" and s.kept and not(s.secure) and safety)
  run backToCameraAfterUnlockTest = init.then(bootTick).then(unlock).then(openView("camera")).then(openView("photos"))
    .expect(not(s.secure) and s.view == "photos" and not(s.kept))
    .then(openKept("camera")).expect(not(s.secure) and s.view == "camera" and s.kept and s.screen == "home" and safety)
  run powerStopsVoiceTest = init.then(bootTick).then(unlock).then(startVoice).then(voiceAdvance).then(power)
    .expect(s.screen == "lock" and s.voice == "off" and not(s.voiceTimers) and safety)
    .then(voiceAdvance.fail())
  run voiceWakesDarkScreenTest = init.then(bootTick).then(power).then(startVoice)
    .expect(s.screen == "lock" and s.voice == "listening" and safety)
  run leaveClearsViewTimersTest = init.then(bootTick).then(unlock).then(openView("notes")).then(armViewTimer)
    .then(openView("camera")).expect(s.viewTimers == "" and safety)
  run lockKeepsViewTimersTest = init.then(bootTick).then(unlock).then(openView("notes")).then(armViewTimer)
    .then(power).expect(s.screen == "lock" and s.viewTimers == "notes" and safety)
  run voiceRefusedDuringBootTest = init.then(startVoice.fail())
  run lateBootTimerLocksTest = init.then(openView("notes")).expect(s.screen == "home")
    .then(bootTick).expect(s.screen == "lock" and s.view == "notes" and safety)
}
