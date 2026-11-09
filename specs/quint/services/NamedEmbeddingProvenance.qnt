// Current BaseDrizzleAdapter named-space fence. Widths, source texts and
// provider markers are finite classes. One target row and one delayed request
// share one adapter. The pre-fence dimension translation is separate.
module NamedEmbeddingProvenance {
  type Pending = { kind: str, vector: str, text: str, current: bool, width: int }
  type State = {
    space: str,
    width: int,
    text: str,
    rowSpace: str,
    rowWidth: int,
    rowInput: str,
    pending: Pending,
    result: str
  }
  var s: State

  pure val noPending: Pending = {
    kind: "none", vector: "absent", text: "missing", current: false, width: 0
  }
  action init = s' = {
    space: "legacy", width: 384, text: "missing", rowSpace: "none",
    rowWidth: 0, rowInput: "absent", pending: noPending, result: "none"
  }

  action startActivation = all {
    s.space == "legacy",
    s' = { ...s, space: "activating" }
  }
  action finishActivation(ok: bool): bool = all {
    s.space == "activating",
    s' = { ...s, space: if (ok) "named" else "legacy" }
  }

  pure def refusal(state: State, vector: str): str =
    if (vector == "absent") "none"
    else if (state.space == "activating") "uninitialized"
    else if (state.space == "legacy") "none"
    else if (vector == "unmarked" or vector == "other") "space"
    else if (vector == "bad-width") "dimension"
    else if (vector == "bad-value") "vector"
    else "none"

  pure def complete(state: State, kind: str, vector: str, text: str, current: bool): State = {
    val denied = refusal(state, vector)
    if (kind == "cas" and (not(current) or state.text == "missing"))
      { ...state, result: "stale" }
    else if (denied != "none") { ...state, result: denied }
    else if (kind == "search" or kind == "document-search")
      { ...state, result: if (
        (vector == "absent" and state.text != "missing") or
        (state.rowSpace == state.space and state.rowWidth == state.width)
      ) "hit" else "miss" }
    else if (vector == "absent")
      { ...state, text: text, result: "written" }
    else
      { ...state, text: text, rowSpace: state.space, rowWidth: state.width, rowInput: vector, result: "written" }
  }

  val operations = Set("insert", "batch", "update", "cas", "search", "document-search")
  val vectors = Set("absent", "unmarked", "other", "marked", "bad-width", "bad-value")

  action write(kind: str, vector: str, text: str, current: bool): bool = all {
    operations.contains(kind),
    vectors.contains(vector),
    Set("old", "new").contains(text),
    (not(Set("cas", "search").contains(kind)) or vector != "absent"),
    (s.space != "legacy" or Set("absent", "marked", "unmarked", "other").contains(vector)),
    (kind != "insert" or s.text == "missing"),
    (kind != "batch" or s.text == "missing"),
    (kind != "update" or s.text != "missing"),
    s' = complete(s, kind, vector, if (kind == "cas") s.text else text,
      current and (kind != "cas" or text == s.text))
  }

  action holdWrite(kind: str, vector: str, text: str, current: bool): bool = all {
    s.pending == noPending,
    Set("cas", "update").contains(kind),
    s.text != "missing",
    Set("unmarked", "marked", "other").contains(vector),
    Set("old", "new").contains(text),
    s' = { ...s, pending: { kind: kind, vector: vector, text: text, current: current, width: 0 } }
  }
  action finishWrite = all {
    Set("cas", "update").contains(s.pending.kind),
    s' = { ...complete(s, s.pending.kind, s.pending.vector,
      if (s.pending.kind == "cas") s.text else s.pending.text,
      s.pending.current and (s.pending.kind != "cas" or s.pending.text == s.text)),
      pending: noPending }
  }

  pure def resizeResult(state: State, width: int): State =
    if (state.space != "legacy" and width != state.width) { ...state, result: "resize-refused" }
    else { ...state, width: width, result: "resized" }

  action resize(width: int): bool = all {
    Set(384, 768).contains(width),
    s' = resizeResult(s, width)
  }
  action holdResize(width: int): bool = all {
    s.pending == noPending,
    Set(384, 768).contains(width),
    s' = { ...s, pending: { ...noPending, kind: "resize", width: width } }
  }
  action finishResize = all {
    s.pending.kind == "resize",
    s' = { ...resizeResult(s, s.pending.width), pending: noPending }
  }

  action step = any {
    startActivation,
    nondet ok = Bool.oneOf()
    finishActivation(ok),
    nondet kind = operations.oneOf()
    nondet vector = vectors.oneOf()
    nondet text = Set("old", "new").oneOf()
    nondet current = Bool.oneOf()
    write(kind, vector, text, current),
    nondet kind = Set("cas", "update").oneOf()
    nondet vector = Set("unmarked", "marked", "other").oneOf()
    nondet text = Set("old", "new").oneOf()
    nondet current = Bool.oneOf()
    holdWrite(kind, vector, text, current),
    finishWrite,
    nondet width = Set(384, 768).oneOf()
    resize(width),
    nondet width = Set(384, 768).oneOf()
    holdResize(width),
    finishResize,
    s' = s
  }

  val NamedRowUsesPinnedWidth =
    s.rowSpace != "named" or (s.space == "named" and s.rowWidth == s.width)
  val NamedRowRequiresExactMarker = s.rowSpace != "named" or s.rowInput == "marked"
  val VectorRequiresMemory = s.rowSpace == "none" or s.text != "missing"
  val safety = NamedRowUsesPinnedWidth and NamedRowRequiresExactMarker and VectorRequiresMemory

  run delayedCasRefusalTest = init
    .then(write("insert", "absent", "old", true))
    .then(holdWrite("cas", "unmarked", "old", true))
    .then(startActivation)
    .then(finishActivation(true))
    .then(finishWrite)
    .expect(s.result == "space" and s.rowSpace == "none" and s.text == "old")

  run delayedTextRollbackTest = init
    .then(write("insert", "unmarked", "old", true))
    .then(holdWrite("update", "unmarked", "new", true))
    .then(startActivation)
    .then(finishActivation(true))
    .then(finishWrite)
    .expect(s.result == "space" and s.rowSpace == "legacy" and s.text == "old")

  run heldCasLosesToTextEditTest = init
    .then(startActivation)
    .then(finishActivation(true))
    .then(write("insert", "marked", "old", true))
    .then(holdWrite("cas", "marked", "old", true))
    .then(write("update", "marked", "new", true))
    .then(finishWrite)
    .expect(s.result == "stale" and s.rowSpace == "named" and s.text == "new")

  run delayedResizeRefusalTest = init
    .then(holdResize(768))
    .then(startActivation)
    .then(finishActivation(true))
    .then(finishResize)
    .expect(s.width == 384 and s.result == "resize-refused")

  run namedQueriesRequireMarkerTest = init
    .then(startActivation)
    .then(finishActivation(true))
    .then(write("batch", "marked", "old", true))
    .then(write("search", "unmarked", "old", true))
    .expect(s.result == "space")
    .then(write("document-search", "marked", "old", true))
    .expect(s.result == "hit")

  run pendingActivationKeepsTextOnlyTest = init
    .then(startActivation)
    .then(write("batch", "unmarked", "old", true))
    .expect(s.result == "uninitialized" and s.text == "missing")
    .then(write("insert", "absent", "old", true))
    .expect(s.result == "written" and s.rowSpace == "none")
    .then(finishActivation(false))
    .then(write("cas", "unmarked", "old", true))
    .expect(s.rowSpace == "legacy")

  run staleCasPreservesRowTest = init
    .then(startActivation)
    .then(finishActivation(true))
    .then(write("insert", "marked", "old", true))
    .then(write("cas", "marked", "old", false))
    .expect(s.result == "stale" and s.rowSpace == "named" and s.text == "old")
}
