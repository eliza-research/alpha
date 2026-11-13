/// The New/Edit password form of Settings → Password manager: how long the typed password is held,
/// what an unlock expiry keeps, the checks before a save, the one vault task at a time, the
/// two-tap delete, and the saved list following every completed save or delete.
module PasswordEntryDraft {
  // Bound on entries the vault holds.
  pure val MaxStored = 3
  pure val Drafts = Set("none", "new", "edit")
  pure val Errors = Set("none", "details", "retype", "password", "refused")
  pure val Tasks = Set("none", "save", "remove")
  pure val Sent = Set("none", "new-typed", "new-generated", "edit-typed", "edit-generated", "edit-kept")
  pure val Results = Set("ok", "refused", "locked")
  type State = {
    // Settings is on a password page; the pages are open (rendered while shown); the app is
    // shown; the page holds an unlocked listing.
    onPages: bool, active: bool, foreground: bool, unlocked: bool,
    draft: str,
    // The form has a name and a website; a password is typed; a typed password was dropped by an
    // unlock expiry; a generated password is chosen; Delete was tapped once.
    details: bool, typed: bool, dropped: bool, generate: bool, confirmDelete: bool,
    error: str,
    // The vault task the page shows as running, and the vault task not yet answered.
    busy: str, pending: str,
    // The unanswered task was started before the pages were last left or hidden.
    stale: bool,
    // An answer for an ended visit changed the vault under an unlocked listing.
    behind: bool,
    // What the latest save carried.
    sent: str,
    // Entries in the vault and entries in the listing the page holds.
    stored: int, listed: int
  }
  var s: State
  pure val start: State = { onPages: true, active: true, foreground: true, unlocked: true, draft: "none", details: false,
    typed: false, dropped: false, generate: false, confirmDelete: false, error: "none", busy: "none", pending: "none",
    stale: false, behind: false, sent: "none", stored: 1, listed: 1 }
  // The password pages are open and unlocked with one saved entry.
  action init = s' = start
  pure def noDraft(t: State): State = { ...t, draft: "none", details: false, typed: false, dropped: false,
    generate: false, confirmDelete: false, error: "none" }
  // The unlock window ended or the vault reported itself locked: the typed password is dropped
  // and remembered as dropped, the rest of the form is kept, hidden until a fresh unlock.
  pure def expired(t: State): State = { ...t, unlocked: false, typed: false,
    dropped: t.draft != "none" and (t.dropped or t.typed), confirmDelete: false }
  // Leaving, hiding and an explicit Lock forget the form. The page stops showing a running task;
  // an unanswered one now belongs to an ended visit.
  pure def left(t: State): State = { ...noDraft(t), unlocked: false, busy: "none", stale: t.pending != "none" }
  val editable = s.active and s.foreground and s.unlocked and s.draft != "none"

  action openNew = all { s.active, s.foreground, s.unlocked, s.busy == "none", s.stored < MaxStored,
    s' = { ...noDraft(s), draft: "new" } }
  action openEdit = all { s.active, s.foreground, s.unlocked, s.busy == "none", s.listed > 0, s.stored > 0,
    s' = { ...noDraft(s), draft: "edit", details: true } }
  // Every edit of a field clears the shown error.
  action setDetails(complete: bool): bool = all { editable, s' = { ...s, details: complete, error: "none" } }
  action typePassword(text: bool): bool = all { editable, not(s.generate),
    s' = { ...s, typed: text, dropped: s.dropped and not(text), error: "none" } }
  // The text fields stay editable while a task runs; the rows that switch between a typed and a
  // generated password do not.
  action chooseGenerated = all { editable, not(s.generate), s.busy == "none",
    s' = { ...s, generate: true, typed: false, dropped: false, error: "none" } }
  action chooseTyped = all { editable, s.generate, s.busy == "none", s' = { ...s, generate: false, error: "none" } }
  // Save checks the form, then starts the one vault task. The typed password stays in the form
  // until the vault accepts it. The model starts no task while an earlier answer is outstanding.
  action tapSave = all { editable, s.busy == "none", s.pending == "none",
    if (not(s.details)) s' = { ...s, error: "details" }
    else if (s.dropped and not(s.generate) and not(s.typed)) s' = { ...s, error: "retype" }
    else if (s.draft == "new" and not(s.generate) and not(s.typed)) s' = { ...s, error: "password" }
    else s' = { ...s, error: "none", busy: "save", pending: "save",
      sent: if (s.generate) (if (s.draft == "new") "new-generated" else "edit-generated")
        else if (s.typed) (if (s.draft == "new") "new-typed" else "edit-typed") else "edit-kept" } }
  // The vault answers the save. An accepted save is in the vault whether or not its form is
  // still open; while the visit that started it lasts, the page reads its listing again. An
  // answer for an ended visit changes nothing on the page.
  action saveSettles(result: str): bool = all { s.pending == "save", Results.contains(result), {
    val stored = if (result == "ok" and (s.sent == "new-typed" or s.sent == "new-generated")) s.stored + 1 else s.stored
    if (s.stale)
      s' = { ...s, pending: "none", stale: false, stored: stored, behind: s.behind or (s.unlocked and stored != s.stored) }
    else if (result == "ok")
      s' = { ...noDraft(s), busy: "none", pending: "none", stored: stored,
        listed: if (s.unlocked) stored else s.listed, behind: s.behind and not(s.unlocked) }
    else if (result == "locked") s' = { ...expired(s), busy: "none", pending: "none" }
    else s' = { ...s, busy: "none", pending: "none", error: if (s.draft != "none") "refused" else s.error }
  } }
  // Delete asks for a second tap, then removes the entry.
  action tapDelete = all { editable, s.draft == "edit", s.busy == "none",
    if (not(s.confirmDelete)) s' = { ...s, confirmDelete: true, error: "none" }
    else all { s.pending == "none", s' = { ...s, busy: "remove", pending: "remove" } } }
  action removeSettles(result: str): bool = all { s.pending == "remove", Results.contains(result), {
    val stored = if (result == "ok") s.stored - 1 else s.stored
    if (s.stale)
      s' = { ...s, pending: "none", stale: false, stored: stored, behind: s.behind or (s.unlocked and stored != s.stored) }
    else if (result == "ok")
      s' = { ...noDraft(s), busy: "none", pending: "none", stored: stored,
        listed: if (s.unlocked) stored else s.listed, behind: s.behind and not(s.unlocked) }
    else if (result == "locked") s' = { ...expired(s), busy: "none", pending: "none" }
    else s' = { ...s, busy: "none", pending: "none", error: if (s.draft != "none") "refused" else s.error }
  } }
  action expire = all { s.unlocked, s' = expired(s) }
  // A fresh unlock reads the listing and shows the kept form again.
  action unlock = all { s.active, s.foreground, not(s.unlocked), s.busy == "none",
    s' = { ...s, unlocked: true, listed: s.stored, behind: false } }
  // Back from the form to the list forgets the form; the list stays unlocked.
  action leaveEntry = all { s.active, s.draft != "none", s' = noDraft(s) }
  // Lock passwords, on the list.
  action lock = all { s.active, s.foreground, s.unlocked, s.draft == "none", s.busy == "none", s.pending == "none",
    s' = left(s) }
  action leavePages = all { s.onPages, s' = { ...left(s), onPages: false, active: false } }
  // The pages are rendered again; the vault was locked when they were left.
  action openPages = all { not(s.onPages), s' = { ...s, onPages: true, active: s.foreground } }
  action hide = all { s.foreground, s' = { ...left(s), active: false, foreground: false } }
  // Returning renders the password pages again if Settings is still on one.
  action show = all { not(s.foreground), s' = { ...s, foreground: true, active: s.onPages } }
  action step = {
    nondet flag = Set(true, false).oneOf()
    nondet result = Results.oneOf()
    any { openNew, openEdit, setDetails(flag), typePassword(flag), chooseGenerated, chooseTyped, tapSave,
      saveSettles(result), tapDelete, removeSettles(result), expire, unlock, leaveEntry, lock, leavePages, openPages,
      hide, show, s' = s }
  }

  val TypeOK = Drafts.contains(s.draft) and Errors.contains(s.error) and Tasks.contains(s.busy) and
    Tasks.contains(s.pending) and Sent.contains(s.sent) and s.stored.in(0.to(MaxStored)) and s.listed.in(0.to(MaxStored))
  // A typed password is held only by an open form on an unlocked, open, foreground page.
  val TypedSecretNeedsUnlockedForm = s.typed implies (s.draft != "none" and s.unlocked and s.active and s.foreground)
  val UnlockedNeedsShownPages = s.unlocked implies (s.active and s.foreground)
  val OpenOnlyWhileShownOnPages = s.active == (s.onPages and s.foreground)
  val FormNeedsOpenPages = s.draft != "none" implies s.active
  // A dropped password is not also held, and is forgotten with its form.
  val DroppedIsNotHeld = s.dropped implies (s.draft != "none" and not(s.typed) and not(s.generate))
  val GeneratedHoldsNoTypedSecret = s.generate implies not(s.typed)
  val DeleteConfirmationNeedsUnlockedEdit = s.confirmDelete implies (s.draft == "edit" and s.unlocked)
  val RemoveWasConfirmed = s.busy == "remove" implies (s.draft == "none" or s.confirmDelete or not(s.unlocked))
  // A task the page shows as running is the unanswered one, started in this visit.
  val ShownTaskIsPending = (s.busy != "none" implies (s.pending == s.busy and not(s.stale))) and
    (s.stale implies s.pending != "none")
  // The unlocked list shows what the vault holds once every answer arrived, unless an answer for
  // an ended visit changed the vault since the listing was read.
  val ListFollowsVault = (s.unlocked and s.pending == "none" and not(s.behind)) implies s.listed == s.stored
  val safety = TypeOK and TypedSecretNeedsUnlockedForm and UnlockedNeedsShownPages and OpenOnlyWhileShownOnPages and FormNeedsOpenPages and
    DroppedIsNotHeld and GeneratedHoldsNoTypedSecret and DeleteConfirmationNeedsUnlockedEdit and RemoveWasConfirmed and
    ShownTaskIsPending and ListFollowsVault

  val KeptFormAfterExpiryWitness = s.draft == "edit" and not(s.unlocked) and s.dropped and s.active
  val SavedAfterLeavingFormWitness = s.draft == "none" and s.busy == "none" and s.stored == 2 and s.listed == 2 and
    s.sent == "new-typed" and s.unlocked
  val RefusedSaveKeepsSecretWitness = s.error == "refused" and s.typed
  val SaveInFlightWhileHiddenWitness = s.pending == "save" and not(s.foreground)

  run expiryDropsTypedPasswordTest = init.then(openEdit).then(typePassword(true)).then(expire)
    .expect(not(s.typed) and s.dropped and s.draft == "edit" and not(s.unlocked) and safety)
    .then(unlock).then(tapSave)
    .expect(s.error == "retype" and s.busy == "none" and safety)
    .then(typePassword(true)).then(tapSave)
    .expect(s.busy == "save" and s.sent == "edit-typed" and safety)
    .then(saveSettles("ok")).expect(s.draft == "none" and not(s.typed) and s.listed == 1 and safety)
  run newEntryNeedsDetailsAndPasswordTest = init.then(openNew).then(tapSave)
    .expect(s.error == "details" and s.busy == "none")
    .then(setDetails(true)).then(tapSave).expect(s.error == "password" and s.busy == "none")
    .then(chooseGenerated).then(tapSave).expect(s.busy == "save" and s.sent == "new-generated" and safety)
    .then(saveSettles("ok")).expect(s.stored == 2 and s.listed == 2 and s.draft == "none" and safety)
  run refusedSaveKeepsTypedPasswordTest = init.then(openNew).then(setDetails(true)).then(typePassword(true))
    .then(tapSave).then(saveSettles("refused"))
    .expect(s.error == "refused" and s.typed and s.draft == "new" and s.stored == 1 and safety)
    .then(tapSave).then(saveSettles("ok")).expect(s.stored == 2 and not(s.typed) and safety)
  run leavingFormDuringSaveStillListsItTest = init.then(openNew).then(setDetails(true)).then(typePassword(true))
    .then(tapSave).then(leaveEntry)
    .expect(s.draft == "none" and not(s.typed) and s.busy == "save" and safety)
    .then(saveSettles("ok")).expect(s.stored == 2 and s.listed == 2 and safety)
  run deleteNeedsSecondTapTest = init.then(openEdit).then(tapDelete)
    .expect(s.confirmDelete and s.busy == "none" and s.stored == 1)
    .then(expire).then(unlock).expect(not(s.confirmDelete) and safety)
    .then(tapDelete).then(tapDelete).expect(s.busy == "remove")
    .then(removeSettles("ok")).expect(s.stored == 0 and s.listed == 0 and s.draft == "none" and safety)
  // Current behaviour: a save accepted after its pages were left and opened again is not read
  // back, so the unlocked list misses it until the next read.
  run answerAfterReturnIsNotReadBackTest = init.then(openNew).then(setDetails(true)).then(typePassword(true))
    .then(tapSave).then(leavePages)
    .expect(s.busy == "none" and s.pending == "save" and s.stale and not(s.typed) and safety)
    .then(openPages).then(unlock).then(saveSettles("ok"))
    .expect(s.stored == 2 and s.listed == 1 and s.behind and s.unlocked and safety)
    .then(lock).then(unlock).expect(s.listed == 2 and not(s.behind) and safety)
  run hidingForgetsFormTest = init.then(openNew).then(typePassword(true)).then(hide)
    .expect(s.draft == "none" and not(s.typed) and not(s.unlocked) and not(s.active) and safety)
    .then(show).then(unlock).expect(s.draft == "none" and s.unlocked and safety)
  run lockedSaveAnswerDropsPasswordTest = init.then(openEdit).then(typePassword(true)).then(tapSave)
    .then(saveSettles("locked"))
    .expect(not(s.unlocked) and not(s.typed) and s.dropped and s.draft == "edit" and safety)
}
