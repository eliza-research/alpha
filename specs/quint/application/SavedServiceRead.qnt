// Read-only cache projection. Freshness and authorization are independent.
module SavedServiceRead {
  type State = {owner: int, credential: int, query: int, epoch: int, readEpoch: int,
    reading: bool, settled: bool, shown: str, now: int, refusedAt: int,
    savedOwner: int, savedCredential: int, savedQuery: int, savedAt: int}
  var s: State
  action init = s' = {owner:0,credential:0,query:0,epoch:0,readEpoch:0,
    reading:false,settled:false,shown:"none",now:1,refusedAt:0,
    savedOwner:0,savedCredential:0,savedQuery:0,savedAt:1}
  val sameSaved = s.owner == s.savedOwner and s.credential == s.savedCredential and s.query == s.savedQuery
  val liveRead = s.reading and s.readEpoch == s.epoch
  val canMutate = s.shown == "fresh"
  action start = all {s.epoch < 8,s' = {...s,epoch:s.epoch+1,readEpoch:s.epoch+1,reading:true,settled:false,shown:"none"}}
  action restore = s' = if (liveRead and not(s.settled) and sameSaved and s.savedAt > s.refusedAt)
    {...s,shown:"saved"} else s
  action fresh = all {liveRead,s' = {...s,reading:false,settled:true,shown:"fresh",
    savedOwner:s.owner,savedCredential:s.credential,savedQuery:s.query,savedAt:s.now}}
  action refuse = all {liveRead,s.epoch < 8,s' = {...s,epoch:s.epoch+1,reading:false,settled:true,shown:"none",refusedAt:s.now}}
  action otherOwner = all {s.epoch < 8,s' = {...s,epoch:s.epoch+1,owner:1-s.owner,reading:false,shown:"none"}}
  action otherCredential = all {s.epoch < 8,s' = {...s,epoch:s.epoch+1,credential:1-s.credential,reading:false,shown:"none"}}
  action otherQuery = all {s.epoch < 8,s' = {...s,epoch:s.epoch+1,query:1-s.query,reading:false,shown:"none"}}
  action tick = all {s.now < 3,s' = {...s,now:s.now+1}}
  action step = any {start,restore,fresh,refuse,otherOwner,otherCredential,otherQuery,tick,s'=s}
  val safety = (s.shown == "saved" implies sameSaved and s.savedAt > s.refusedAt and not(canMutate))
    and (s.shown == "fresh" implies s.settled)
  run savedThenFreshTest = init.then(start).then(restore).expect(s.shown == "saved" and not(canMutate))
    .then(fresh).expect(canMutate and safety)
  run lateSavedCannotReplaceLiveTest = init.then(start).then(fresh).then(restore).expect(s.shown == "fresh" and safety)
  run refusedOldWindowStaysHiddenTest = init.then(start).then(restore).then(refuse).then(otherQuery).then(otherQuery).then(start).then(restore).expect(s.shown == "none" and safety)
  run changedOwnerStaysHiddenTest = init.then(otherOwner).then(start).then(restore).expect(s.shown == "none" and safety)
  run changedCredentialStaysHiddenTest = init.then(otherCredential).then(start).then(restore).expect(s.shown == "none" and safety)
}
