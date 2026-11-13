// Read-only cache projection. Freshness and authorization are independent.
module SavedServiceRead {
  type State = {owner: int, credential: int, query: int, epoch: int, readEpoch: int,
    reading: bool, settled: bool, shown: str, now: int, refusedAt: int,
    checkFailed: bool, detail: str,
    savedOwner: int, savedCredential: int, savedQuery: int, savedAt: int}
  var s: State
  action init = s' = {owner:0,credential:0,query:0,epoch:0,readEpoch:0,
    reading:false,settled:false,shown:"none",now:1,refusedAt:0,
    checkFailed:false,detail:"closed",
    savedOwner:0,savedCredential:0,savedQuery:0,savedAt:1}
  val sameSaved = s.owner == s.savedOwner and s.credential == s.savedCredential and s.query == s.savedQuery
  val liveRead = s.reading and s.readEpoch == s.epoch
  val canMutate = s.shown == "fresh"
  val canUseDetail = canMutate and s.detail == "cached"
  action start = all {s.epoch < 8,s' = {...s,epoch:s.epoch+1,readEpoch:s.epoch+1,
    reading:true,settled:false,shown:"none",checkFailed:false,detail:"closed"}}
  action restore = s' = if (liveRead and not(s.settled) and sameSaved and s.savedAt > s.refusedAt)
    {...s,shown:"saved"} else s
  action fresh = all {liveRead,s' = {...s,reading:false,settled:true,shown:"fresh",checkFailed:false,detail:"closed",
    savedOwner:s.owner,savedCredential:s.credential,savedQuery:s.query,savedAt:s.now}}
  action refuse = all {liveRead,s.epoch < 8,s' = {...s,epoch:s.epoch+1,reading:false,settled:true,
    shown:"none",refusedAt:s.now,checkFailed:false,detail:"closed"}}
  action otherOwner = all {s.epoch < 8,s' = {...s,epoch:s.epoch+1,owner:1-s.owner,reading:false,
    shown:"none",checkFailed:false,detail:"closed"}}
  action otherCredential = all {s.epoch < 8,s' = {...s,epoch:s.epoch+1,credential:1-s.credential,
    reading:false,shown:"none",checkFailed:false,detail:"closed"}}
  action otherQuery = all {s.epoch < 8,s' = {...s,epoch:s.epoch+1,query:1-s.query,reading:false,
    shown:"none",checkFailed:false,detail:"closed"}}
  /// Inbox may retain the same local bytes after a transport failure. A retry checks the grant.
  action checkFailed = all {liveRead,s.shown == "saved",
    s' = {...s,reading:false,settled:true,checkFailed:true}}
  action recheck = all {s.shown == "saved",s.checkFailed,s.epoch < 8,
    s' = {...s,epoch:s.epoch+1,readEpoch:s.epoch+1,reading:true,settled:false,checkFailed:false}}
  /// Account readback authorizes the Inbox view without updating the saved page's read time.
  action acceptGrant = all {liveRead,s.shown == "saved",
    s' = {...s,reading:false,settled:true,shown:"fresh",checkFailed:false}}
  action openSavedDetail(found: bool): bool = all {s.shown == "saved",
    s' = {...s,detail:if (found) "cached" else "missing"}}
  action backFromDetail = all {s.detail != "closed",s' = {...s,detail:"closed"}}
  action leave = all {s.epoch < 8,s' = {...s,epoch:s.epoch+1,reading:false,
    shown:"none",checkFailed:false,detail:"closed"}}
  action tick = all {s.now < 3,s' = {...s,now:s.now+1}}
  action step = any {start,restore,fresh,refuse,otherOwner,otherCredential,otherQuery,
    checkFailed,recheck,acceptGrant,openSavedDetail(true),openSavedDetail(false),backFromDetail,leave,tick,s'=s}
  val safety = (s.shown == "saved" implies sameSaved and s.savedAt > s.refusedAt and not(canMutate))
    and (s.shown == "fresh" implies s.settled)
    and (s.checkFailed implies s.shown == "saved" and not(s.reading))
    and (s.detail != "closed" implies s.shown != "none")
  run savedThenFreshTest = init.then(start).then(restore).expect(s.shown == "saved" and not(canMutate))
    .then(fresh).expect(canMutate and safety)
  run lateSavedCannotReplaceLiveTest = init.then(start).then(fresh).then(restore).expect(s.shown == "fresh" and safety)
  run refusedOldWindowStaysHiddenTest = init.then(start).then(restore).then(refuse).then(otherQuery).then(otherQuery).then(start).then(restore).expect(s.shown == "none" and safety)
  run changedOwnerStaysHiddenTest = init.then(otherOwner).then(start).then(restore).expect(s.shown == "none" and safety)
  run changedCredentialStaysHiddenTest = init.then(otherCredential).then(start).then(restore).expect(s.shown == "none" and safety)
  run cachedDetailSurvivesRetryTest = init.then(start).then(restore).then(openSavedDetail(true))
    .then(checkFailed).expect(s.detail == "cached" and not(canMutate) and safety)
    .then(recheck).expect(s.reading and s.detail == "cached" and not(canMutate) and safety)
    .then(acceptGrant).expect(canMutate and canUseDetail and s.savedAt == 1 and safety)
  run savedMissingBodyBackKeepsCheckTest = init.then(start).then(restore).then(openSavedDetail(false))
    .expect(s.detail == "missing" and s.reading and not(canMutate) and safety)
    .then(backFromDetail).expect(s.reading and s.detail == "closed" and safety)
  run acceptedGrantStillNeedsMissingBodyTest = init.then(start).then(restore).then(openSavedDetail(false))
    .then(acceptGrant).expect(canMutate and not(canUseDetail) and s.detail == "missing" and safety)
  run refusedSavedDetailStaysHiddenTest = init.then(start).then(restore).then(openSavedDetail(true))
    .then(refuse).then(leave).then(start).then(restore)
    .expect(s.shown == "none" and s.detail == "closed" and not(canMutate) and safety)
}
