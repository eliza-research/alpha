// Literal conversion of packages/core/tla/EmbeddingDimension.tla at 4787d51a142.
module CoreEmbeddingDimensionTemplate {
  const Embedders: Set[str]
  const MaxProbes: int
  pure val Providers = Set("named", "plain", "wide")
  pure val None = "none"
  pure val Space = Providers.mapBy(p => if (p == "named") "S" else None)
  pure val Dim = Providers.mapBy(p => if (p == "wide") 3 else 2)
  type Vector = {space: str, dim: int, fromSpace: str}
  pure val Vectors = Set("S", None).fold(Set(), (vectors, space) =>
    vectors.union(Set(2, 3).fold(Set(), (widths, dim) =>
      widths.union(Set("S", None).map(fromSpace => ({space: space, dim: dim, fromSpace: fromSpace}))))))
  type State = {col: int, aspace: str, stored: Set[Vector], pinProv: str, pinSpace: str,
    pinDim: int, ppc: str, pprov: str, probes: int, epc: str -> str, eprov: str -> str, dropped: int,
    clearFailed: bool, stablePinSpace: bool}
  var s: State
  val vars = s
  val ProbeVars = (s.ppc, s.pprov, s.probes)
  val PinVars = (s.pinProv, s.pinSpace, s.pinDim)
  val EmbedVars = (s.epc, s.eprov, s.dropped, s.clearFailed)
  val TypeOK = s.col.in(Set(2, 3)) and s.aspace.in(Set("S", None)) and s.stored.subseteq(Vectors)
    and s.pinProv.in(Providers.union(Set(None))) and s.pinSpace.in(Set("S", None)) and s.pinDim.in(Set(0, 2, 3))
    and s.ppc.in(Set("idle", "called", "resized", "spaced", "pinned")) and s.pprov.in(Providers.union(Set(None)))
    and s.probes.in(0.to(MaxProbes)) and s.epc.keys() == Embedders and s.eprov.keys() == Embedders and s.dropped >= 0
    and Embedders.forall(e => s.epc.get(e).in(Set("idle", "called", "valid", "done")) and s.eprov.get(e).in(Providers.union(Set(None))))
  pure val initial = {col: 2, aspace: None, stored: Set(), pinProv: None, pinSpace: None, pinDim: 0,
    ppc: "idle", pprov: None, probes: 0, epc: Embedders.mapBy(_ => "idle"), eprov: Embedders.mapBy(_ => None),
    dropped: 0, clearFailed: false, stablePinSpace: true}
  action Init = s' = initial
  val Initial = s == initial
  action ProbeFails = s' = {...s, ppc: "idle", pprov: None}
  action ProbeStart(p: str): bool = all {
    s.ppc == "idle", s.probes < MaxProbes,
    s' = {...s, ppc: "called", pprov: p, probes: s.probes + 1}
  }
  action ProbeResize = all {
    s.ppc == "called",
    val p = s.pprov
    val expected = if (s.pinSpace != None) s.pinSpace else Space.get(p)
    val refused = expected != None and (Space.get(p) != expected or (s.pinDim != 0 and Dim.get(p) != s.pinDim))
    val guard = Space.get(p) != None and s.pinProv != None and s.pinSpace != Space.get(p)
    if (refused or guard or (s.aspace != None and Dim.get(p) != s.col)) ProbeFails
    else s' = {...s, col: Dim.get(p), ppc: "resized"}
  }
  action ProbeSpace = all {
    s.ppc == "resized",
    val space = Space.get(s.pprov)
    if (space != None and s.aspace != None and s.aspace != space) ProbeFails
    else s' = {...s, aspace: if (space != None) space else s.aspace, ppc: "spaced"}
  }
  // This monotonic monitor is equivalent to the source action property on the projected state.
  action ProbePin = all {
    s.ppc == "spaced",
    val space = Space.get(s.pprov)
    s' = {...s, pinProv: s.pprov, pinSpace: space, pinDim: Dim.get(s.pprov), ppc: "pinned",
      stablePinSpace: s.stablePinSpace and (s.pinProv == None or space == s.pinSpace)}
  }
  action ProbeClearAs(failed: bool): bool = all {
    s.ppc == "pinned",
    s' = {...s, stored: if (failed) s.stored else s.stored.filter(v => v.space != s.aspace or v.dim == s.col),
      clearFailed: failed, ppc: "idle", pprov: None}
  }
  action ProbeClear = any {ProbeClearAs(false), ProbeClearAs(true)}
  action EmbedCall(e: str, p: str): bool = all {
    s.epc.get(e) == "idle", s.pinProv != None implies p == s.pinProv,
    s' = {...s, epc: s.epc.set(e, "called"), eprov: s.eprov.set(e, p)}
  }
  action EmbedValidate(e: str): bool = all {
    s.epc.get(e) == "called",
    val named = Space.get(s.eprov.get(e))
    val expected = if (s.pinSpace != None) s.pinSpace else named
    all {
      (named != None and s.pinSpace == None) implies s.ppc == "idle",
      val valid = expected == None or (s.pinSpace != None and named == expected and Dim.get(s.eprov.get(e)) == s.pinDim)
      s' = {...s, epc: s.epc.set(e, if (valid) "valid" else "done")}
    }
  }
  action EmbedWrite(e: str): bool = all {
    s.epc.get(e) == "valid",
    val p = s.eprov.get(e)
    val v = {space: s.aspace, dim: Dim.get(p), fromSpace: Space.get(p)}
    s' = {...s, stored: if (v.dim == s.col) s.stored.union(Set(v)) else s.stored,
      dropped: s.dropped + (if (v.dim == s.col) 0 else 1), epc: s.epc.set(e, "done")}
  }
  val Finished = s.ppc == "idle" and Embedders.forall(e => s.epc.get(e) == "done")
  action Next = any {
    nondet p = Providers.oneOf()
    ProbeStart(p),
    ProbeResize, ProbeSpace, ProbePin, ProbeClear,
    nondet e = Embedders.oneOf()
    nondet p = Providers.oneOf()
    any {EmbedCall(e, p), EmbedValidate(e), EmbedWrite(e)},
    all {Finished, s' = s}
  }
  action Step = any {Next, s' = s}
  temporal Spec = Initial and always(Next.orKeep(vars))
  val StoredOneSpace = s.stored.forall(v => v.space == v.fromSpace)
  temporal PinSpaceStable = always(s.stablePinSpace)
  val PinMatchesStore = (s.ppc == "idle" and s.pinProv != None) implies
    (s.pinDim == s.col and (s.pinSpace != None implies s.aspace == s.pinSpace))
  val StoredInColumn = (s.ppc == "idle" and not(s.clearFailed)) implies s.stored.forall(v => v.dim == s.col)
}

module CoreEmbeddingDimension {
  import CoreEmbeddingDimensionTemplate(Embedders = Set("e1", "e2"), MaxProbes = 3) as M
  action init = M::Init
  action rawStep = M::Next
  action step = M::Step
  val safety = M::TypeOK and M::PinMatchesStore and M::StoredInColumn
  temporal CheckedTemporal = M::PinSpaceStable
  run pinRefusesDifferentProviderTest = init.then(M::ProbeStart("named")).then(M::ProbeResize).then(M::ProbeSpace)
    .then(M::ProbePin).then(M::ProbeClearAs(true)).then(M::ProbeStart("wide")).then(M::ProbeResize)
    .expect(safety and M::s.pinProv == "named" and M::s.ppc == "idle" and M::s.clearFailed)
  // Upstream documents this as a known failure of the unchecked StoredOneSpace property.
  run unpinnedWriteCanBeRetaggedTest = init.then(M::EmbedCall("e1", "plain")).then(M::ProbeStart("named"))
    .then(M::ProbeResize).then(M::ProbeSpace).then(M::EmbedValidate("e1")).then(M::EmbedWrite("e1"))
    .expect(safety and not(M::StoredOneSpace))
  run wrongWidthIsDroppedTest = init.then(M::EmbedCall("e1", "wide")).then(M::EmbedValidate("e1")).then(M::EmbedWrite("e1"))
    .expect(safety and M::s.dropped == 1 and M::s.stored == Set())
}
