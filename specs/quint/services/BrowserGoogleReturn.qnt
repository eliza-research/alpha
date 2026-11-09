/// A loopback callback is only a wakeup. The canonical account read grants access.
module BrowserGoogleReturn {
  type State = { credential: int, pendingCredential: int, pendingHost: int, nonce: int,
    consumed: bool, expired: bool, candidate: bool, verified: bool, panel: bool }
  var s: State
  action init = s' = {credential: 1, pendingCredential: 0, pendingHost: 0, nonce: 0,
    consumed: false, expired: false, candidate: false, verified: false, panel: true}
  action begin = all {s.nonce < 2, s' = {...s, pendingCredential: s.credential, pendingHost: 1,
    nonce: s.nonce + 1, consumed: false, expired: false, candidate: false, verified: false, panel: true}}
  action callback(nonce: int, host: int): bool = if (
    s.nonce > 0 and nonce == s.nonce and host == s.pendingHost and not(s.expired or s.consumed) and
    s.pendingCredential == s.credential)
    s' = {...s, consumed: true, candidate: true} else s' = s
  action readback(matches: bool): bool = all {s.candidate, s.pendingCredential == s.credential,
    s' = {...s, candidate: false, verified: matches, panel: not(matches)}}
  action expire = s' = {...s, expired: true}
  action switchOwner = all {s.credential < 3, s' = {...s, credential: s.credential + 1, candidate: false, verified: false, panel: true}}
  action spoofSignal = s' = s
  action step = any {begin,callback(1,1),callback(2,1),callback(1,2),readback(true),readback(false),expire,switchOwner,spoofSignal,s'=s}
  val ReadbackRequired = not(s.panel) implies s.verified and s.consumed and s.credential == s.pendingCredential
  val PendingDoesNotGrant = s.candidate implies not(s.verified)
  val safety = ReadbackRequired and PendingDoesNotGrant
  run normalReturnTest = init.then(begin).then(callback(1,1)).expect(s.panel and not(s.verified)).then(readback(true)).expect(not(s.panel) and safety)
  run wrongHostTest = init.then(begin).then(callback(1,2)).expect(not(s.verified) and safety)
  run replayTest = init.then(begin).then(callback(1,1)).then(callback(1,1)).then(readback(true)).expect(safety)
  run expiredTest = init.then(begin).then(expire).then(callback(1,1)).expect(safety)
  run changedOwnerTest = init.then(begin).then(switchOwner).then(callback(1,1)).expect(not(s.verified) and safety)
  run returnedOwnerDoesNotReviveAttemptTest = init.then(begin).then(switchOwner).then(switchOwner).then(callback(1,1)).expect(safety)
  run unverifiedConnectionTest = init.then(begin).then(callback(1,1)).then(readback(false)).expect(s.panel and not(s.verified) and safety)
}
