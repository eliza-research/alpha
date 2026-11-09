// Gzip protection and byte-preserving packaging for one selected web asset.
module AndroidGzipAssetStage {
  type State = {web: int, raw: int, wrapper: int, packaged: int, plain: bool,
    protection: str, audit: str}
  var s: State

  pure val Generations = Set(1, 2)
  action initFor(raw: int): bool = all {
    raw.in(Set(0, 1)),
    s' = {web: 1, raw: raw, wrapper: 0, packaged: 0, plain: false, protection: "none", audit: "none"},
  }
  action init = initFor(1)

  action syncWeb(version: int): bool = all {
    version.in(Generations),
    s' = {...s, web: version, raw: version, wrapper: 0, protection: "none", audit: "none"},
  }
  action malformedInput = s' = {...s, raw: 3, wrapper: 0, protection: "none"}

  action protect(removalRefused: bool): bool = {
    val valid = s.raw.in(Generations) and s.wrapper == 0
    val protection = if (s.raw == 0) "unchanged" else if (not(valid)) "refused"
      else if (removalRefused) "partial" else "wrapped"
    all {
      removalRefused implies valid,
      s' = {...s, wrapper: if (valid) s.raw else s.wrapper,
        raw: if (protection == "wrapped") 0 else s.raw, protection: protection},
    }
  }

  action merge = all {
    s.raw != 3, s.raw == 0 or s.wrapper == 0,
    s' = {...s, packaged: s.wrapper, plain: s.raw != 0, audit: "none"},
  }
  action audit = s' = {...s, audit: if (s.packaged == 0) "missing" else if (s.packaged == s.web) "matches" else "differs"}
  action step = any {
    { nondet version = Generations.oneOf(); syncWeb(version) },
    malformedInput, protect(false), protect(true), merge, audit, s' = s,
  }

  val ProtectedAssetHasSingleStagedRepresentation = s.protection == "wrapped" implies (s.raw == 0 and s.wrapper.in(Generations))
  val RefusedRemovalRetainsExactInput = s.protection == "partial" implies (s.raw.in(Generations) and s.raw == s.wrapper)
  val PublishedAssetHasSingleRepresentation = s.plain implies s.packaged == 0
  val SuccessfulAuditRequiresExactBytes = s.audit == "matches" implies s.packaged == s.web
  val safety = ProtectedAssetHasSingleStagedRepresentation and RefusedRemovalRetainsExactInput and PublishedAssetHasSingleRepresentation and SuccessfulAuditRequiresExactBytes

  run unprotectedLosesPublishedNameTest = init.then(merge).then(audit).expect(s.plain and s.audit == "missing" and safety)
  run wrappedAssetRoundTripsTest = init.then(protect(false)).then(protect(false)).then(merge).then(audit)
    .expect(s.packaged == 1 and s.audit == "matches" and safety)
  run previousPackageFailsAfterWebSyncTest = init.then(protect(false)).then(merge).then(syncWeb(2)).then(audit)
    .expect(s.packaged == 1 and s.audit == "differs" and safety)
  run refusedRemovalRequiresFreshSyncTest = init.then(protect(true)).expect(s.protection == "partial" and safety)
    .then(protect(false)).expect(s.protection == "refused" and safety).then(syncWeb(1)).then(protect(false))
    .then(merge).then(audit).expect(s.audit == "matches" and safety)
  run invalidInputIsNotWrappedTest = init.then(malformedInput).then(protect(false)).expect(s.raw == 3 and s.wrapper == 0 and safety)
  run absentStageIsUnchangedTest = initFor(0).then(protect(false)).then(merge).then(audit)
    .expect(s.protection == "unchanged" and s.audit == "missing" and safety)
}
