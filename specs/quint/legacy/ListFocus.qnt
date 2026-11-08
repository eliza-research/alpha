// One helper instance, two retained render captures and two list-root identities.
// Node identity is distinct from logical row identity so reparenting can replace a node.
module ListFocus {
  type Capture = {
    valid: bool, root: int, key: int, node: int, moved: bool, committed: bool,
    listening: bool, captureQueued: bool, restoreQueued: bool, ticket: int
  }
  type State = {
    root: int, revision: int, present: Set[int], connectedRoots: Set[int],
    hiddenRoots: Set[int], hiddenNodes: Set[int], disabled: Set[int],
    documentHidden: bool, dialog: bool, focus: int, captures: int -> Capture,
    queue: List[int], lastRestored: int, lastIntended: int, preservedOtherFocus: bool
  }
  var s: State
  pure val Nodes = Set(1, 2, 3, 4, 5)
  pure val Roots = Set(1, 2)
  pure val Slots = Set(1, 2)
  pure val NodeRoot = Map(1 -> 1, 2 -> 1, 3 -> 1, 4 -> 2, 5 -> 1)
  pure val NodeKey = Map(1 -> 1, 2 -> 1, 3 -> 1, 4 -> 2, 5 -> 0)
  pure val EmptyCapture = { valid: false, root: 0, key: 0, node: 0, moved: false,
    committed: false, listening: false, captureQueued: false, restoreQueued: false, ticket: 0 }
  def connected(node: int): bool = s.present.contains(node) and
    (NodeRoot.get(node) == 0 or s.connectedRoots.contains(NodeRoot.get(node)))
  def visible(node: int): bool = connected(node) and not(s.hiddenNodes.contains(node)) and
    not(s.hiddenRoots.contains(NodeRoot.get(node)))
  def captureEligible: bool = s.connectedRoots.contains(s.root) and not(s.documentHidden) and
    not(s.hiddenRoots.contains(s.root)) and s.focus != 0 and connected(s.focus) and
    NodeRoot.get(s.focus) == s.root and NodeKey.get(s.focus) != 0
  def matching(c: Capture): Set[int] = s.present.filter(node => connected(node) and
    NodeRoot.get(node) == c.root and NodeKey.get(node) == c.key)
  action init = s' = { root: 0, revision: 0, present: Set(1, 4, 5),
    connectedRoots: Roots, hiddenRoots: Set(), hiddenNodes: Set(), disabled: Set(),
    documentHidden: false, dialog: false, focus: 0, captures: Slots.mapBy(_ => EmptyCapture),
    queue: List(), lastRestored: 0, lastIntended: 0, preservedOtherFocus: true }
  // Capture returns null on an ineligible surface. Such renders still have a ref callback.
  action capture(slot: int): bool = all { Slots.contains(slot),
    not(s.captures.get(slot).captureQueued), not(s.captures.get(slot).restoreQueued),
    s' = { ...s, queue: if (captureEligible) s.queue.append(slot) else s.queue, captures: s.captures.set(slot, if (captureEligible) {
      valid: true, root: s.root, key: NodeKey.get(s.focus), node: s.focus,
      moved: false, committed: false, listening: true, captureQueued: true,
      restoreQueued: false, ticket: 0 } else EmptyCapture) } }
  // Both ref detachment and attachment advance the generation. A null capture only sets root.
  action ref(slot: int, root: int): bool = all { Slots.contains(slot), root.in(0.to(2)), s.revision < 8,
    not(s.captures.get(slot).restoreQueued),
    { val c = s.captures.get(slot)
      val attach = root != 0 and c.valid and root == c.root
      s' = { ...s, root: root, revision: s.revision + 1, queue: if (attach) s.queue.append(slot + 2) else s.queue,
        captures: s.captures.set(slot, if (attach) { ...c, committed: true,
          restoreQueued: true, ticket: s.revision + 1 } else c) } } }
  action refWithoutCapture(root: int): bool = all { root.in(0.to(2)), s.revision < 8,
    s' = { ...s, root: root, revision: s.revision + 1 } }
  action expireCapture(slot: int): bool = all { Slots.contains(slot), s.captures.get(slot).captureQueued, s.queue.length() > 0, s.queue.head() == slot,
    { val c = s.captures.get(slot)
      s' = { ...s, queue: s.queue.tail(), captures: s.captures.set(slot, { ...c, captureQueued: false,
        moved: c.moved or not(c.committed), listening: c.listening and c.committed }) } } }
  action restore(slot: int): bool = all { Slots.contains(slot), s.captures.get(slot).restoreQueued, s.queue.length() > 0, s.queue.head() == slot + 2,
    { val c = s.captures.get(slot)
      val candidates = matching(c)
      val target = if (candidates.size() == 1) candidates.fold(0, (_, node) => node) else 0
      val allowed = not(c.moved) and s.revision == c.ticket and s.root == c.root and
        s.connectedRoots.contains(c.root) and not(s.documentHidden) and
        not(s.hiddenRoots.contains(c.root)) and not(s.dialog) and s.focus == 0 and
        target != 0 and visible(target) and not(s.disabled.contains(target))
      s' = { ...s, queue: s.queue.tail(), focus: if (allowed) target else s.focus,
        captures: Slots.mapBy(other => {
          val pending = s.captures.get(other)
          if (other == slot) { ...pending, restoreQueued: false, listening: false }
          else { ...pending, moved: pending.moved or
            (allowed and pending.listening and target != pending.node) } }),
        lastRestored: if (allowed) target else 0, lastIntended: c.key,
        preservedOtherFocus: s.focus == 0 or not(allowed) } } }
  // DOM removal drops focus to body without emitting a new element's focusin event.
  action renderNodes(nodes: Set[int]): bool = all { nodes.subseteq(Nodes),
    s' = { ...s, present: nodes, focus: if (nodes.contains(s.focus)) s.focus else 0 } }
  action focusNode(node: int): bool = all { Nodes.contains(node), visible(node), not(s.disabled.contains(node)),
    s' = { ...s, focus: node, captures: Slots.mapBy(slot => {
      val c = s.captures.get(slot)
      { ...c, moved: c.moved or (c.listening and node != c.node) } }) } }
  action blur = s' = { ...s, focus: 0 }
  action rootConnected(root: int, value: bool): bool = all { Roots.contains(root),
    s' = { ...s, connectedRoots: if (value) s.connectedRoots.union(Set(root)) else s.connectedRoots.exclude(Set(root)),
      focus: if (not(value) and s.focus != 0 and NodeRoot.get(s.focus) == root) 0 else s.focus } }
  action rootHidden(root: int, value: bool): bool = all { Roots.contains(root),
    s' = { ...s, hiddenRoots: if (value) s.hiddenRoots.union(Set(root)) else s.hiddenRoots.exclude(Set(root)) } }
  action nodeHidden(node: int, value: bool): bool = all { Nodes.contains(node),
    s' = { ...s, hiddenNodes: if (value) s.hiddenNodes.union(Set(node)) else s.hiddenNodes.exclude(Set(node)) } }
  action nodeDisabled(node: int, value: bool): bool = all { Nodes.contains(node),
    s' = { ...s, disabled: if (value) s.disabled.union(Set(node)) else s.disabled.exclude(Set(node)) } }
  action documentHidden(value: bool): bool = s' = { ...s, documentHidden: value }
  action dialog(value: bool): bool = s' = { ...s, dialog: value }
  action step = any {
    { nondet slot = Slots.oneOf(); capture(slot) },
    { nondet slot = Slots.oneOf(); nondet root = 0.to(2).oneOf(); ref(slot, root) },
    { nondet root = 0.to(2).oneOf(); refWithoutCapture(root) },
    { nondet slot = Slots.oneOf(); expireCapture(slot) },
    { nondet slot = Slots.oneOf(); restore(slot) },
    { nondet nodes = Set(Set(), Set(1, 4, 5), Set(2, 4, 5), Set(2, 3, 4, 5), Nodes).oneOf(); renderNodes(nodes) },
    { nondet node = Nodes.oneOf(); focusNode(node) },
    { nondet root = Roots.oneOf(); nondet value = Bool.oneOf(); rootConnected(root, value) },
    { nondet root = Roots.oneOf(); nondet value = Bool.oneOf(); rootHidden(root, value) },
    { nondet node = Nodes.oneOf(); nondet value = Bool.oneOf(); nodeHidden(node, value) },
    { nondet node = Nodes.oneOf(); nondet value = Bool.oneOf(); nodeDisabled(node, value) },
    { nondet value = Bool.oneOf(); documentHidden(value) },
    { nondet value = Bool.oneOf(); dialog(value) }, blur, s' = s
  }
  val RestoresCapturedIdentity = s.lastRestored == 0 or NodeKey.get(s.lastRestored) == s.lastIntended
  val ExistingOtherFocusPreserved = s.preservedOtherFocus
  val TypeOK = s.root.in(0.to(2)) and s.revision.in(0.to(8)) and s.present.subseteq(Nodes)
    and s.focus.in(0.to(5)) and s.captures.keys() == Slots
    and s.connectedRoots.subseteq(Roots) and s.hiddenRoots.subseteq(Roots)
    and s.hiddenNodes.subseteq(Nodes) and s.disabled.subseteq(Nodes)
    and s.queue.indices().forall(i => s.queue.nth(i).in(1.to(4)))
    and Slots.forall(slot => s.captures.get(slot).ticket.in(0.to(8)))
  val safety = TypeOK and RestoresCapturedIdentity and ExistingOtherFocusPreserved
  run unmountedCaptureTest = init.then(capture(1)).expect(not(s.captures.get(1).valid) and safety)
  run keylessCaptureTest = init.then(refWithoutCapture(1)).then(focusNode(5)).then(capture(1))
    .expect(not(s.captures.get(1).valid) and safety)
  run otherOwnerCaptureTest = init.then(refWithoutCapture(1)).then(focusNode(4)).then(capture(1))
    .expect(not(s.captures.get(1).valid) and safety)
  run setup = init.then(refWithoutCapture(1)).then(focusNode(1)).then(capture(1))
  run replacement = setup.then(renderNodes(Set(2, 4, 5))).then(ref(1, 1)).then(expireCapture(1))
  run crossParentRestoreTest = replacement.then(restore(1)).expect(s.focus == 2 and safety)
  run removedItemTest = setup.then(renderNodes(Set(4, 5))).then(ref(1, 1)).then(expireCapture(1)).then(restore(1)).expect(s.focus == 0 and safety)
  run duplicateCandidateTest = setup.then(renderNodes(Set(2, 3, 4, 5))).then(ref(1, 1)).then(expireCapture(1)).then(restore(1)).expect(s.focus == 0 and safety)
  run movedFocusTest = replacement.then(focusNode(5)).then(blur).then(restore(1)).expect(s.focus == 0 and safety)
  run hiddenRootTest = replacement.then(rootHidden(1, true)).then(restore(1)).expect(s.focus == 0 and safety)
  run hiddenNodeTest = replacement.then(nodeHidden(2, true)).then(restore(1)).expect(s.focus == 0 and safety)
  run disabledCandidateTest = replacement.then(nodeDisabled(2, true)).then(restore(1)).expect(s.focus == 0 and safety)
  run dialogTest = replacement.then(dialog(true)).then(restore(1)).expect(s.focus == 0 and safety)
  run hiddenDocumentTest = replacement.then(documentHidden(true)).then(restore(1)).expect(s.focus == 0 and safety)
  run disconnectedRootTest = replacement.then(rootConnected(1, false)).then(restore(1)).expect(s.focus == 0 and safety)
  run newerCommitTest = replacement.then(refWithoutCapture(1)).then(restore(1)).expect(s.focus == 0 and safety)
  run navigationTest = replacement.then(refWithoutCapture(2)).then(restore(1)).expect(s.focus == 0 and safety)
  run discardedRenderTest = setup.then(expireCapture(1)).then(renderNodes(Set(2, 4, 5)))
    .then(ref(1, 1)).then(restore(1)).expect(s.focus == 0 and safety)
  run restoringCancelsUncommittedCaptureTest = setup.then(ref(1, 1)).then(expireCapture(1))
    .then(capture(2)).then(renderNodes(Set(2, 4, 5))).then(restore(1))
    .expect(s.focus == 2 and s.captures.get(2).moved and safety).then(expireCapture(2))
  run twoCapturesLatestCommitTest = setup.then(capture(2)).then(renderNodes(Set(2, 4, 5)))
    .then(ref(1, 1)).then(ref(2, 1)).then(expireCapture(1)).then(expireCapture(2)).then(restore(1)).expect(s.focus == 0)
    .then(restore(2)).expect(s.focus == 2 and safety)
}
