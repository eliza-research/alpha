// Product assistant surfaces with process-local Sense receipts and controlled Android delivery.
module NativeAssistantEntry {
  type Grant = {present: bool, invalid: bool, focused: bool, bridge: int,
    bound: bool, at: int, account: int, epoch: int}
  type Surface = {kind: str, live: bool, bridge: bool, clean: bool, focus: bool,
    events: int, beforeLoad: str, beforeCold: int, retainedLoadIntent: bool, activityBinding: int, grant: Grant}
  type Invocation = {origin: str, locked: bool, at: int, coldOwner: int, adopted: bool}
  type Tile = {updates: int, subtitle: str, inactive: bool, awaitingUnlock: bool,
    launches: int, dispatch: str, clean: bool}
  type Reply = {kind: str, origin: str, assistant: bool, locked: bool}
  type State = {sdk: int, now: int, locked: bool, policy: str, account: int, epoch: int,
    signers: bool, protected: bool, latest: int, bound: int, invocation: Invocation,
    surfaces: int -> Surface, tile: Tile, reply: Reply}
  var s: State

  val ids = Set(1, 2)
  val callers = Set("none", "listener", "system", "foreign")
  val policies = Set("current", "no-mic", "stopping", "mutation", "shutdown", "unavailable", "nonproduction")
  val times = Set(100, 5100, 5101, 15100, 15101)
  val emptyGrant: Grant = {present:false,invalid:false,focused:false,bridge:0,bound:false,at:0,account:0,epoch:0}
  val emptySurface: Surface = {kind:"none",live:false,bridge:false,clean:false,focus:false,events:0,
    beforeLoad:"none",beforeCold:0,retainedLoadIntent:false,activityBinding:0,grant:emptyGrant}
  val emptyInvocation: Invocation = {origin:"none",locked:true,at:0,coldOwner:0,adopted:false}
  val emptyTile: Tile = {updates:0,subtitle:"none",inactive:false,awaitingUnlock:false,
    launches:0,dispatch:"none",clean:false}
  pure def reply(kind: str, origin: str, locked: bool): Reply =
    {kind:kind,origin:origin,assistant:origin!="none",locked:locked}
  action initWith(sdk: int): bool = all {
    sdk.in(Set(33, 34, 36)),
    s' = {sdk:sdk,now:100,locked:false,policy:"current",account:1,epoch:0,
      signers:true,protected:true,latest:0,bound:0,invocation:emptyInvocation,
      surfaces:Map((1,emptySurface),(2,emptySurface)),tile:emptyTile,reply:reply("none","none",true)}
  }
  action init = { nondet sdk = Set(33,34,36).oneOf(); initWith(sdk) }

  pure def startsVoice(origin: str): bool = origin.in(Set("listener","system"))
  pure def record(st: State, origin: str): Invocation = {origin:origin,locked:st.locked,at:st.now,
    coldOwner:if (startsVoice(origin) and st.bound==0 and not(st.locked)) st.account else 0,adopted:false}
  pure def classify(st: State, caller: str): str =
    if (st.signers and startsVoice(caller)) caller else "assist"
  action environment(locked: bool, policy: str, signers: bool, protected: bool): bool = all {
    policy.in(policies), s'={...s,locked:locked,policy:policy,signers:signers,protected:protected}
  }
  action replaceAuthority(account: int): bool = all {
    account.in(Set(1,2)), s.epoch<3, s'={...s,account:account,epoch:s.epoch+1}
  }
  action tick(now: int): bool = all { now.in(times), now>=s.now, s'={...s,now:now} }

  // Exact sanitized intent forwarding during Capacitor's load keeps the first origin.
  // An adversarial copied argument takes the ordinary Activity delivery path.
  action createWithLoad(id: int, kind: str, restored: bool, bridge: bool, caller: str, exactLoad: bool): bool = all {
    id.in(ids), s.surfaces.get(id).kind=="none",
    kind.in(Set("assist","power")), caller.in(callers),
    val origin = if (kind=="assist" and not(restored) and s.sdk>=34) classify(s,caller) else "assist"
    val first = record(s,origin)
    val grant = if (kind=="power" and not(restored) and s.protected and not(s.locked) and s.policy=="current")
      {...emptyGrant,present:true,at:s.now,account:s.account,epoch:s.epoch} else emptyGrant
    val surface = {...emptySurface,kind:kind,live:true,bridge:bridge,clean:true,events:if (bridge) 1 else 0,
      beforeLoad:if (bridge) first.origin else "none",beforeCold:if (bridge) first.coldOwner else 0,
      retainedLoadIntent:bridge and exactLoad,grant:grant}
    s'={...s,surfaces:s.surfaces.set(id,surface),
      invocation:if (bridge and kind=="assist" and not(exactLoad)) record(s,"assist") else first}
  }
  action create(id: int, kind: str, restored: bool, bridge: bool, caller: str): bool =
    createWithLoad(id,kind,restored,bridge,caller,true)
  action offer(id: int, caller: str, modern: bool): bool = all {
    id.in(ids), caller.in(callers), not(modern) or s.sdk>=35,
    val view = s.surfaces.get(id)
    val inv = if (view.kind=="power" and view.bridge)
      (if (s.protected and view.activityBinding!=0 and view.activityBinding==s.bound)
        record(s,"power") else s.invocation)
      else record(s,if (view.kind=="assist" and modern) classify(s,caller) else "assist")
    all { view.live, view.events<8, s'={...s,invocation:inv,surfaces:s.surfaces.set(id,{...view,clean:true,events:view.events+(if (view.bridge) 1 else 0)})} }
  }
  action bind(id: int): bool = all {
    id.in(ids),
    val view = s.surfaces.get(id)
    val grant = view.grant
    val exact = id>=s.latest
    val nextGrant = if (grant.present) {...grant,bridge:id,bound:grant.bound or exact} else grant
    val waiting = s.invocation.coldOwner!=0 and not(s.invocation.adopted)
    val nextInv = if (waiting and s.invocation.coldOwner==s.account and s.now-s.invocation.at<=15000)
      {...s.invocation,adopted:true}
      else if (waiting or id!=s.bound) emptyInvocation else s.invocation
    all { view.live and view.bridge, s'={...s,latest:if (exact) id else s.latest,bound:if (exact) id else s.bound,
      invocation:if (exact) nextInv else s.invocation,
      surfaces:s.surfaces.set(id,{...view,activityBinding:if (exact) id else view.activityBinding,grant:nextGrant})} }
  }
  action focus(id: int, focused: bool): bool = all {
    id.in(ids),
    val view = s.surfaces.get(id)
    val grant = view.grant
    val nextGrant = if (grant.present)
      {...grant,focused:grant.focused or focused,invalid:grant.invalid or (grant.focused and not(focused))} else grant
    all { view.live, s'={...s,surfaces:s.surfaces.set(id,{...view,focus:focused,grant:nextGrant})} }
  }
  action retire(id: int, destroyed: bool): bool = all {
    id.in(ids),
    val view=s.surfaces.get(id)
    val grant=if (view.grant.present) {...view.grant,invalid:true} else view.grant
    all { view.live, s'={...s,surfaces:s.surfaces.set(id,{...view,live:not(destroyed),grant:grant})} }
  }
  action release(id: int): bool = all {
    id.in(ids),
    val view=s.surfaces.get(id)
    val grant=if (view.grant.present) {...view.grant,invalid:true} else view.grant
    all { view.kind!="none", s'={...s,bound:if (s.bound==id) 0 else s.bound,invocation:if (s.latest==id) emptyInvocation else s.invocation,
      surfaces:s.surfaces.set(id,{...view,activityBinding:0,grant:grant})} }
  }
  action readSurface(id: int): bool = all {
    id.in(ids),
    val view=s.surfaces.get(id)
    s'={...s,reply:reply("legacy",if (view.clean) "assist" else "none",s.locked)}
  }
  action take(id: int, foreground: bool, exact: bool): bool = all {
    id.in(ids), s.surfaces.get(id).live,
    val current = exact and id==s.bound
    val inv = s.invocation
    val consume = current and (foreground or inv.origin=="power")
    val voice = inv.origin!="assist" and not(inv.locked or s.locked) and
      s.now-inv.at<=(if (inv.adopted) 15000 else 5000) and
      (not(inv.adopted) or inv.coldOwner==s.account)
    val result = if (not(consume and foreground) or inv.origin=="none") "none" else if (voice) inv.origin else "assist"
    s'={...s,invocation:if (consume) emptyInvocation else inv,
      reply:reply("sense",result,not(foreground) or s.locked)}
  }
  action claim(id: int, account: int, foreground: bool, exact: bool): bool = all {
    id.in(ids), account.in(Set(1,2)),
    val view=s.surfaces.get(id)
    val grant=view.grant
    val spend=exact and grant.present and grant.bound
    val admitted=spend and not(grant.invalid) and grant.focused and view.focus and view.live and
      foreground and id==s.bound and not(s.locked) and s.protected and s.now-grant.at<=5000 and
      s.policy=="current" and grant.account==account and grant.account==s.account and grant.epoch==s.epoch
    all { view.kind!="none", s'={...s,reply:reply("claim",if (admitted) "power" else "none",not(admitted)),
      surfaces:s.surfaces.set(id,{...view,grant:if (spend) {...grant,invalid:true} else grant})} }
  }

  pure def launchTile(st: State): Tile = {...st.tile,launches:st.tile.launches+1,
    dispatch:if (st.sdk>=34) "pending-intent" else "intent",clean:true}
  action tileListen(present: bool): bool = all {
    s.tile.updates<6,
    s'={...s,tile:if (present) {...s.tile,updates:s.tile.updates+1,inactive:true,
      subtitle:if (s.locked) "locked" else "open"} else s.tile}
  }
  action tileClick: bool = all {
    not(s.tile.awaitingUnlock), s.tile.launches<6,
    s'={...s,tile:if (s.locked) {...s.tile,awaitingUnlock:true} else launchTile(s)}
  }
  action tileUnlock(delivered: bool): bool = all {
    s.tile.awaitingUnlock, s.tile.launches<6,
    s'={...s,locked:if (delivered) false else s.locked,
      tile:{...(if (delivered) launchTile(s) else s.tile),awaitingUnlock:false}}
  }

  val sanitizedSurface = ids.forall(id => s.surfaces.get(id).kind=="none" or s.surfaces.get(id).clean)
  val scopedGrant = ids.forall(id => {
    val view=s.surfaces.get(id)
    not(view.grant.present) or
      (view.kind=="power" and (view.live or view.grant.invalid) and view.grant.bridge.in(Set(0,id))
        and (not(view.grant.bound) or view.grant.bridge==id))
  })
  val monotoneBinding = s.bound==0 or s.bound==s.latest
  val legacyHasNoVoice = s.reply.kind!="legacy" or s.reply.origin.in(Set("none","assist"))
  val tileHasNoAuthority = (s.tile.updates==0 or s.tile.inactive) and
    (s.tile.launches==0 or (s.tile.clean and s.tile.dispatch==(if (s.sdk>=34) "pending-intent" else "intent")))
  val safety = all {sanitizedSurface,scopedGrant,monotoneBinding,legacyHasNoVoice,tileHasNoAuthority}

  action step = any {
    { nondet id=ids.oneOf(); nondet kind=Set("assist","power").oneOf();
      nondet restored=Bool.oneOf(); nondet bridge=Bool.oneOf(); nondet caller=callers.oneOf();
      nondet exactLoad=Bool.oneOf(); createWithLoad(id,kind,restored,bridge,caller,exactLoad) },
    { nondet id=ids.oneOf(); nondet caller=callers.oneOf(); nondet modern=Bool.oneOf(); offer(id,caller,modern) },
    { nondet id=ids.oneOf(); bind(id) },
    { nondet id=ids.oneOf(); nondet value=Bool.oneOf(); focus(id,value) },
    { nondet id=ids.oneOf(); nondet value=Bool.oneOf(); retire(id,value) },
    { nondet id=ids.oneOf(); release(id) },
    { nondet id=ids.oneOf(); readSurface(id) },
    { nondet id=ids.oneOf(); nondet front=Bool.oneOf(); nondet exact=Bool.oneOf(); take(id,front,exact) },
    { nondet id=ids.oneOf(); nondet account=Set(1,2).oneOf(); nondet front=Bool.oneOf(); nondet exact=Bool.oneOf(); claim(id,account,front,exact) },
    { nondet lock=Bool.oneOf(); nondet policy=policies.oneOf(); nondet signers=Bool.oneOf(); nondet protection=Bool.oneOf(); environment(lock,policy,signers,protection) },
    { nondet account=Set(1,2).oneOf(); replaceAuthority(account) },
    { nondet now=times.oneOf(); tick(now) },
    { nondet value=Bool.oneOf(); tileListen(value) },
    tileClick,
    { nondet value=Bool.oneOf(); tileUnlock(value) },
    s'=s,
  }

  run coldTrustedAttributionSurvivesBridgeLoadTest = initWith(36)
    .then(create(1,"assist",false,true,"listener"))
    .expect(s.surfaces.get(1).retainedLoadIntent and s.surfaces.get(1).beforeCold==1 and s.invocation.origin=="listener")
    .then(bind(1)).then(take(1,true,true)).expect(s.reply.origin=="listener")
    .then(take(1,true,true)).expect(s.reply.origin=="none")
  run distinctLoadArgumentStillRecordsTest = initWith(36)
    .then(createWithLoad(1,"assist",false,true,"listener",false))
    .expect(not(s.surfaces.get(1).retainedLoadIntent) and s.invocation.origin=="assist")
  run coldAttributionDoesNotTransferTest = initWith(36).then(create(1,"assist",false,true,"system"))
    .then(replaceAuthority(2)).then(bind(1)).then(take(1,true,true)).expect(s.reply.origin=="none")
  run modernWarmListenerReadOnceTest = initWith(36).then(create(1,"assist",false,true,"none")).then(bind(1))
    .then(offer(1,"listener",true)).then(readSurface(1)).expect(s.reply.origin=="assist" and s.invocation.origin=="listener")
    .then(take(1,true,false)).expect(s.reply.origin=="none" and s.invocation.origin=="listener")
    .then(take(1,true,true)).expect(s.reply.origin=="listener")
    .then(take(1,true,true)).expect(s.reply.origin=="none")
  run coldPowerExactOnceTest = initWith(36).then(create(1,"power",false,true,"none")).then(bind(1))
    .then(focus(1,true)).then(tick(5100)).then(claim(1,1,true,true)).expect(s.reply.origin=="power")
    .then(claim(1,1,true,true)).expect(s.reply.origin=="none")
  run coldPowerNeverReturnsAfterFocusLossTest = initWith(36).then(create(1,"power",false,true,"none")).then(bind(1))
    .then(focus(1,true)).then(focus(1,false)).then(focus(1,true)).then(claim(1,1,true,true))
    .expect(s.reply.origin=="none" and s.surfaces.get(1).grant.invalid)
  run newNativeOwnerRetiresColdPinTest = initWith(36).then(create(1,"power",false,true,"none")).then(bind(1))
    .then(focus(1,true)).then(replaceAuthority(2)).then(claim(1,1,true,true)).expect(s.reply.origin=="none")
  run stalePowerPreservesSuccessorTest = initWith(36).then(create(1,"power",false,true,"none")).then(bind(1))
    .then(create(2,"assist",false,true,"none")).then(bind(2)).then(offer(2,"system",true))
    .then(offer(1,"none",true)).then(retire(1,true)).then(release(1))
    .then(take(2,true,true)).expect(s.reply.origin=="system")
  run tileCancellationAndImmutableDispatchTest = initWith(34).then(environment(true,"current",true,true))
    .then(tileListen(true)).then(tileClick).expect(s.tile.inactive and s.tile.launches==0 and s.tile.awaitingUnlock)
    .then(tileUnlock(false)).expect(s.tile.launches==0)
    .then(tileClick).then(tileUnlock(true)).expect(s.tile.launches==1 and s.tile.dispatch=="pending-intent")
}
