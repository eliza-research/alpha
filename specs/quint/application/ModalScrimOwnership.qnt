module ModalScrimOwnership {
  pure val covers = Set("inline", "native", "native-only")
  pure val pointers = Set(1, 2, 7)
  type State = { chat: str, press: str, pointer: int, generation: int,
    modal: str, inputFocused: bool, draft: bool, activations: int }
  var s: State
  action init = s' = { chat: "input", press: "none", pointer: 0, generation: 0,
    modal: "none", inputFocused: true, draft: true, activations: 0 }

  val covered = s.modal.in(covers)
  val capture = s.press == "moved"
  val inlineInert = s.modal == "inline"
  val phoneInert = s.modal == "native"
  val topLayer = s.modal.in(Set("native", "native-only"))
  val cssPointer = s.chat == "input" and not(inlineInert)

  pure def retired(state: State): State = {...state, press: "none", pointer: 0}
  pure def lower(state: State): State = {...retired(state), chat: "hidden", inputFocused: false}

  action down(id: int): bool = all {
    id.in(pointers), s.chat == "input", not(covered), s.generation < 2,
    s' = {...s, press: "held", pointer: id, generation: s.generation + 1}
  }
  action move(id: int): bool = s' =
    if (s.press == "held" and s.pointer == id) {...s, press: "moved"} else s
  action up(id: int): bool = s' =
    if (s.pointer != id or covered) s
    else if (s.press == "moved") lower(s)
    else if (s.press == "held") {...s, press: "released"} else s
  action click(id: int): bool = s' =
    if (s.press == "released" and (id == 0 or id == s.pointer) and not(covered)) lower(s) else s
  action deadline(generation: int): bool = s' =
    if (s.press == "released" and generation == s.generation and not(covered)) lower(s) else s

  action open(kind: str): bool = all {
    kind.in(covers.union(Set("nonmodal"))), s.modal == "none", s.chat == "input",
    kind != "native-only" or s.inputFocused,
    s' = if (kind == "nonmodal") {...s, modal: kind, inputFocused: s.press != "none" and s.inputFocused}
      else {...retired(s), modal: kind, inputFocused: false}
  }
  action close = all {
    s.modal != "none",
    s' = {...s, modal: "none", inputFocused: s.modal == "native-only" or s.modal == "nonmodal" and s.inputFocused}
  }
  action sameTaskModal(kind: str): bool = all {
    kind.in(Set("inline", "native-only")), s.chat == "input", s.modal == "none", s.press != "none",
    kind != "native-only" or s.inputFocused,
    s' = {...retired(s), inputFocused: kind == "native-only"}
  }
  action step = any {
    { nondet id = pointers.oneOf(); any { down(id), move(id), up(id), click(id) } },
    { nondet generation = Set(1, 2).oneOf(); deadline(generation) },
    { nondet kind = covers.union(Set("nonmodal")).oneOf(); open(kind) },
    { nondet kind = Set("inline", "native-only").oneOf(); sameTaskModal(kind) },
    close, click(0), s' = s
  }

  val ExactPress = (s.press == "none") == (s.pointer == 0)
    and (s.press != "none" implies s.chat == "input" and not(covered))
  val ModalOwns = covered implies s.chat == "input" and s.press == "none" and not(s.inputFocused)
  val NoEscapedActivation = s.draft and s.activations == 0
  val safety = ExactPress and ModalOwns and NoEscapedActivation

  run inlineCoverageReleasesCapturedPointerTest = init.then(down(1)).then(move(1)).then(open("inline"))
    .then(up(1)).then(close).then(click(1)).expect(safety and s.chat == "input" and not(capture))
    .then(down(1)).then(up(1)).then(click(1)).expect(safety and s.chat == "hidden")
  run actualNativeModalRetiresDelayedReleaseTest = init.then(down(7)).then(up(7)).then(open("native-only"))
    .then(deadline(1)).then(close).expect(safety and s.chat == "input" and s.inputFocused)
  run sameTaskModalDoesNotRestoreOldPressTest = init.then(down(1)).then(sameTaskModal("inline")).then(up(1))
    .then(click(1)).expect(safety and s.press == "none" and s.chat == "input")
  run nonmodalAndUninterruptedCompatibilityTest = init.then(down(7)).then(up(7)).then(open("nonmodal"))
    .then(click(1)).expect(safety and s.press == "released").then(click(0)).expect(safety and s.chat == "hidden")
  run oldDeadlineCannotSettleANewPressTest = init.then(down(7)).then(up(7)).then(open("inline")).then(close)
    .then(down(7)).then(up(7)).then(deadline(1)).expect(safety and s.press == "released")
    .then(deadline(2)).expect(safety and s.chat == "hidden")
}
