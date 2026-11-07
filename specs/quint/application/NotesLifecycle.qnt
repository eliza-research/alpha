/// One representative note and its write-ahead Trash copy. Content is an opaque identity.
module NotesLifecycle {
  type State = { live: bool, content: str, draft: str, revision: int, expected: int,
    trash: bool, trashContent: str, age: int, deleted: bool, locked: bool, fault: bool }
  var s: State
  action init = s' = { live: true, content: "original", draft: "original", revision: 0,
    expected: 0, trash: false, trashContent: "", age: 0, deleted: false, locked: false, fault: false }
  action edit = all { s.live, not(s.locked), s' = { ...s, draft: "edited", expected: s.revision } }
  action save = all { s.live, not(s.locked), not(s.fault), s.revision == s.expected, s.revision < 2,
    s' = { ...s, content: s.draft, revision: s.revision + 1, expected: s.revision + 1 } }
  action concurrentSave = all { s.live, s.revision < 2,
    s' = { ...s, content: "concurrent", revision: s.revision + 1 } }
  action storageFault = s' = { ...s, fault: true }
  action recoverStorage = s' = { ...s, fault: false }
  action prepareTrash = all { s.live, not(s.locked), not(s.fault),
    s' = { ...s, trash: true, trashContent: s.content, age: 0 } }
  action commitDeletion = all { s.live, s.trash, s.trashContent == s.content, not(s.fault),
    s' = { ...s, live: false, deleted: true } }
  action restore = all { not(s.live), s.trash, s.age < 3, not(s.fault),
    s' = { ...s, live: true, content: s.trashContent, draft: s.trashContent, trash: false,
      trashContent: "", deleted: false } }
  action age = all { s.trash, s.age < 3, s' = { ...s, age: s.age + 1 } }
  action maintenance = all { s.trash, not(s.fault), s.live or s.age >= 3,
    s' = { ...s, trash: false, trashContent: "" } }
  action lock = s' = { ...s, locked: true }
  action unlock = s' = { ...s, locked: false }
  action restart = s' = { ...s, draft: s.content, expected: s.revision, fault: false }
  action step = any { edit, save, concurrentSave, storageFault, recoverStorage, prepareTrash,
    commitDeletion, restore, age, maintenance, lock, unlock, restart, s' = s }
  val RestorableBytes = (s.deleted and s.age < 3) implies s.trash
  val TombstoneMeaning = s.deleted implies not(s.live)
  val TrashHasContent = s.trash implies s.trashContent != ""
  val safety = RestorableBytes and TombstoneMeaning and TrashHasContent
  run failedSaveKeepsDraftTest = init.then(edit).then(storageFault)
    .expect(s.draft == "edited" and s.content == "original" and safety)
  run deletionRestartRestoreTest = init.then(prepareTrash).then(commitDeletion).then(restart)
    .then(restore).expect(s.live and s.content == "original" and safety)
  run expiryTest = init.then(prepareTrash).then(commitDeletion).then(age).then(age).then(age)
    .then(maintenance).expect(not(s.live) and not(s.trash) and safety)
  run concurrentEditTest = init.then(edit).then(concurrentSave)
    .expect(s.expected != s.revision and s.draft == "edited" and safety)
}
