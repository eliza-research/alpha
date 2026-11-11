/// The first access to a browser domain document. Opening an empty domain writes nothing; a
/// domain with legacy bytes is imported once and records what it imported; the first edit
/// creates the document. Legacy storage is never rewritten, and a legacy write seen after the
/// import stops normal access instead of being imported over newer edits.
module DomainDocumentCreation {
  type State = {
    present: bool, value: str, baseline: str, legacy: str,
    writes: int, readWrites: int, reads: int, blocked: bool, legacyWrites: int
  }
  var s: State
  pure val Legacy = Set("none", "old", "changed")
  action initFor(legacy: str): bool = all { Set("none", "old").contains(legacy),
    s' = { present: false, value: "none", baseline: "none", legacy: legacy,
      writes: 0, readWrites: 0, reads: 0, blocked: false, legacyWrites: 0 } }
  action init = {
    nondet legacy = Set("none", "old").oneOf()
    initFor(legacy)
  }
  pure def more(n: int): int = if (n < 3) n + 1 else 3
  /// A read of a stored document checks that legacy storage still holds what was imported.
  /// A read of an absent domain creates the document only from legacy bytes.
  action read = s' =
    if (s.present) { ...s, reads: more(s.reads), blocked: s.legacy != s.baseline }
    else if (s.legacy == "none") { ...s, reads: more(s.reads), blocked: false }
    else { ...s, reads: more(s.reads), present: true, value: "legacy", baseline: s.legacy,
      writes: more(s.writes), readWrites: s.readWrites + 1, blocked: false }
  /// An edit starts from the stored document, or from the legacy bytes when none exists, and
  /// commits only while legacy storage is unchanged.
  action edit = s' =
    if (s.present and s.legacy != s.baseline) { ...s, blocked: true }
    else { ...s, present: true, value: "edit", baseline: if (s.present) s.baseline else s.legacy,
      writes: more(s.writes), blocked: false }
  /// Older code or another writer changes legacy storage.
  action legacyWrite = all { s.legacyWrites < 2,
    s' = { ...s, legacy: if (s.legacy == "none") "old" else "changed", legacyWrites: s.legacyWrites + 1 } }
  action step = any { read, edit, legacyWrite, s' = s }
  val AbsentUntouched = not(s.present) implies (s.writes == 0 and s.value == "none")
  val ReadImportsOnce = s.readWrites <= 1 and (s.readWrites == 1 implies s.baseline != "none")
  val ImportRecordsItsSource = s.value == "legacy" implies (s.baseline != "none" and s.readWrites == 1)
  val ImportedLegacyRetained = s.baseline == "none" or s.legacy != "none"
  val BlockedMeansLegacyMoved = s.blocked implies (s.present and s.legacy != s.baseline)
  val safety = AbsentUntouched and ReadImportsOnce and ImportRecordsItsSource and ImportedLegacyRetained
    and BlockedMeansLegacyMoved
  val AbsentAfterReadWitness = not(s.present) and s.reads > 0
  val ImportedLegacyWitness = s.value == "legacy" and s.legacy == s.baseline
  val CreatedByEditWitness = s.present and s.readWrites == 0 and s.baseline == "none" and s.value == "edit"
  val LegacyMovedWitness = s.blocked and s.value == "edit"
  run emptyDomainReadWritesNothingTest = initFor("none").then(read).then(read)
    .expect(not(s.present) and s.writes == 0 and s.reads == 2 and not(s.blocked) and safety)
  run firstReadImportsLegacyTest = initFor("old").then(read)
    .expect(s.present and s.value == "legacy" and s.baseline == "old" and s.writes == 1 and safety)
    .then(read).expect(s.writes == 1 and s.readWrites == 1 and not(s.blocked) and safety)
  run firstEditCreatesTest = initFor("none").then(edit)
    .expect(s.present and s.value == "edit" and s.baseline == "none" and s.readWrites == 0 and safety)
  /// A legacy write after the import is not imported over the edit made since; access stops.
  run legacyWriteAfterImportStopsAccessTest = initFor("old").then(read).then(edit).then(legacyWrite).then(read)
    .expect(s.blocked and s.value == "edit" and s.baseline == "old" and s.legacy == "changed" and safety)
    .then(edit).expect(s.blocked and s.writes == 2 and safety)
  /// Legacy bytes that appear after an empty document was created are not adopted either.
  run legacyAppearsAfterCreationTest = initFor("none").then(edit).then(legacyWrite).then(read)
    .expect(s.blocked and s.value == "edit" and s.readWrites == 0 and safety)
}
