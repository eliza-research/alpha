// spec/app/camera/index.md: a preview started joins the starts the phone may still answer, and
// one answered leaves them; an answer to the agent is added exactly when its request ends; a
// capture on the lock screen joins its session.

lemma Joined(xs: seq<int>, ys: seq<int>)
  ensures forall x :: x in xs + ProofLib.Filter((set_x: int) => !((set_x in xs)), ys) <==> (x in xs || x in ys)
{
  forall x
    ensures x in xs + ProofLib.Filter((set_x: int) => !((set_x in xs)), ys) <==> (x in xs || x in ys)
  {
    ProofLib.FilterMember((set_x: int) => !((set_x in xs)), ys, x);
  }
}

lemma Dropped(xs: seq<int>, ys: seq<int>)
  ensures forall x :: x in ProofLib.Filter((set_x: int) => !((set_x in ys)), xs) <==> (x in xs && x !in ys)
{
  forall x
    ensures x in ProofLib.Filter((set_x: int) => !((set_x in ys)), xs) <==> (x in xs && x !in ys)
  {
    ProofLib.FilterMember((set_x: int) => !((set_x in ys)), xs, x);
  }
}

lemma StartingAccounted()
  ensures forall out: seq<Effect>, c: Camera {:trigger starting(out, c)} :: (c.preview >= 0 && (forall t :: t in c.pending ==> t > 0 && t <= c.preview) && c.showing) ==> alwaysStartsAccounted(starting(out, c).state)
{
  forall out: seq<Effect>, c: Camera | c.preview >= 0 && (forall t :: t in c.pending ==> t > 0 && t <= c.preview) && c.showing
    ensures alwaysStartsAccounted(starting(out, c).state)
  {
    var n := c.preview + 1;
    var after := starting(out, c).state;
    assert after.pending == c.pending + ProofLib.Filter((set_x: int) => !((set_x in c.pending)), [n]);
    Joined(c.pending, [n]);
    assert n in after.pending;
    forall t | t in after.pending ensures t > 0 && t <= after.preview {
    }
  }
}

lemma RetiringOut()
  ensures forall now: int, out: seq<Effect>, c: Camera {:trigger retiring(now, out, c)} :: (forall e :: e in out ==> !e.Answer?) ==> (forall e :: e in retiring(now, out, c).out ==> !e.Answer?)
{
}

lemma AnsweringAll()
  ensures forall d: Done, before: Camera {:trigger answering(d, before)} :: (forall e :: e in d.out ==> !e.Answer?) ==> (((!before.agent.stage.Over?) && answering(d, before).state.agent.stage.Over?) == (exists e :: e in answering(d, before).out && e.Answer?))
{
  forall d: Done, before: Camera | (forall e :: e in d.out ==> !e.Answer?)
    ensures (((!before.agent.stage.Over?) && answering(d, before).state.agent.stage.Over?) == (exists e :: e in answering(d, before).out && e.Answer?))
  {
    var r := answering(d, before);
    if (!before.agent.stage.Over?) && d.state.agent.stage.Over? {
      assert r.out[|r.out| - 1] in r.out;
      assert r.out[|r.out| - 1].Answer?;
    } else {
      assert r.out == d.out;
    }
  }
}


lemma PermissionPreview(s: Camera, grant: kit__permission_Grant)
  requires alwaysStartsAccounted(s)
  requires mayStart(s.(permission := kit__permission_observe(s.permission, grant)))
  ensures alwaysStartsAccounted(starting([], s.(permission := kit__permission_observe(s.permission, grant))).state)
{
  var told := s.(permission := kit__permission_observe(s.permission, grant));
  var ticket := s.preview + 1;
  var after := starting([], told).state;
  Joined(s.pending, [ticket]);
  assert after.pending == s.pending + ProofLib.Filter((set_x: int) => !((set_x in s.pending)), [ticket]);
  assert ticket in after.pending;
  forall t | t in after.pending ensures t > 0 && t <= after.preview {
    assert t in s.pending || t == ticket;
  }
}

lemma RetiredForPermission(s: Camera, blocked: Camera, now: int)
  requires alwaysStartsAccounted(s)
  requires blocked.showing == s.showing && blocked.phase == s.phase
  requires blocked.pending == s.pending && blocked.preview == s.preview
  ensures alwaysStartsAccounted(retiring(now, [], blocked).state)
  ensures retiring(now, [], blocked).out == []
    || retiring(now, [], blocked).out == [Effect.StopRecording]
    || (s.preview > 0 && retiring(now, [], blocked).out == [StopPreview(s.preview)])
{
  var retired := retiring(now, [], blocked);
  if recording(blocked) {
    assert retired.state.phase == s.phase && retired.state.preview == s.preview;
  } else {
    assert retired.state.phase.Off? && retired.state.preview == s.preview + 1;
    assert retired.state.preview !in s.pending;
  }
  if !recording(blocked) && s.phase.Ready? {
    assert s.preview > 0;
    assert retired.out == [StopPreview(s.preview)];
  } else if blocked.film.stage.Running? {
    assert retired.out == [Effect.StopRecording];
  } else {
    assert retired.out == [];
  }
}

lemma PermissionEffects(before: Camera, after: Done)
  requires after.state.film.stage.Saved? ==> before.film.stage.Saved?
  requires forall e :: e in after.out ==>
    e.StartPreview? || e.StopRecording? || e.Answer? || (e.StopPreview? && 0 < e.ticket <= before.preview)
  ensures stepALostPreviewFails(before, "accessIs", after.state)
  ensures stepARetiredPreviewIsReleased(before, "accessIs", after.state, after.out)
  ensures stepOneFocusWriteAtATime(before, "accessIs", after.state, after.out)
  ensures stepSoundOnlyWithTheMicrophone(before, after.state, after.out)
  ensures stepASavedVideoIsTheLast(before, after.state)
  ensures stepTheShutterNeverFiresCovered(before, after.state, after.out)
{
  hide *;
  reveal stepALostPreviewFails, stepARetiredPreviewIsReleased, stepOneFocusWriteAtATime,
    stepSoundOnlyWithTheMicrophone, stepASavedVideoIsTheLast, stepTheShutterNeverFiresCovered;
}

lemma PermissionCamera(s: Camera, grant: kit__permission_Grant, now: int, by_: app__photos__actor_Actor)
  requires alwaysNothingHeldAway(s)
  requires alwaysRecordingHoldsThePreview(s)
  ensures alwaysNoCameraWithoutAccess(accessIs(s, grant, now, by_).state)
  ensures alwaysNothingHeldAway(accessIs(s, grant, now, by_).state)
  ensures alwaysRecordingHoldsThePreview(accessIs(s, grant, now, by_).state)
  ensures accessIs(s, grant, now, by_).state.film.stage.Saved? ==> s.film.stage.Saved?
{
  hide *;
  reveal accessIs, kit__permission_observe, kit__permission_allows, mayStart, starting, blocking,
    retiring, answering, holds, emit, recording;
  reveal alwaysNoCameraWithoutAccess, alwaysNothingHeldAway, alwaysRecordingHoldsThePreview,
    app__camera__recording_recording, app__camera__recording_opening, app__camera__recording_stop,
    app__camera__recording_stopping, app__camera__recording_alwaysWithinLimits,
    app__camera__recording_alwaysSavedIsWhole;
}

lemma PermissionLensSettings(s: Camera, grant: kit__permission_Grant, now: int, by_: app__photos__actor_Actor)
  requires alwaysLensSettingsValid(s)
  ensures alwaysLensSettingsValid(accessIs(s, grant, now, by_).state)
{
  hide *;
  var after := accessIs(s, grant, now, by_).state;
  assert after.zoom == s.zoom && after.lens == s.lens && after.flash == s.flash by {
    reveal accessIs, kit__permission_observe, kit__permission_allows, starting,
      retiring, blocking, answering, emit;
    var told := s.(permission := kit__permission_observe(s.permission, grant));
    if !kit__permission_allows(told.permission) {
      var blocked := blocking(Cause.Denied, told);
      assert after == retiring(now, [], blocked).state;
    } else if mayStart(told) {
      assert after == starting([], told).state;
    } else {
      assert after == told;
    }
  }
  reveal alwaysLensSettingsValid;
}

lemma PermissionFocusSettings(s: Camera, grant: kit__permission_Grant, now: int, by_: app__photos__actor_Actor)
  requires alwaysFocusFollowsTheNewestTap(s)
  ensures alwaysFocusFollowsTheNewestTap(accessIs(s, grant, now, by_).state)
{
  hide *;
  var after := accessIs(s, grant, now, by_).state;
  assert after.taps == s.taps && after.waited == s.waited
    && ((after.focus == 0 && after.writing == 0 && after.confirmed == 0)
      || (after.focus == s.focus && after.writing == s.writing && after.confirmed == s.confirmed)) by {
    reveal accessIs, kit__permission_observe, kit__permission_allows, starting,
      retiring, blocking, answering, emit;
    var told := s.(permission := kit__permission_observe(s.permission, grant));
    if !kit__permission_allows(told.permission) {
      var blocked := blocking(Cause.Denied, told);
      assert after == retiring(now, [], blocked).state;
    } else if mayStart(told) {
      assert after == starting([], told).state;
    } else {
      assert after == told;
    }
  }
  reveal alwaysFocusFollowsTheNewestTap;
}

lemma PermissionTorchSettings(s: Camera, grant: kit__permission_Grant, now: int, by_: app__photos__actor_Actor)
  requires alwaysTorchBelongsToItsPreview(s)
  ensures alwaysTorchBelongsToItsPreview(accessIs(s, grant, now, by_).state)
{
  hide *;
  var after := accessIs(s, grant, now, by_).state;
  assert after.lens == s.lens && (after.torch == extinguished(s.torch)
      || (after.torch == s.torch && after.phase == s.phase)) by {
    reveal accessIs, kit__permission_observe, kit__permission_allows, starting,
      retiring, blocking, answering, emit;
    var told := s.(permission := kit__permission_observe(s.permission, grant));
    if !kit__permission_allows(told.permission) {
      var blocked := blocking(Cause.Denied, told);
      assert after == retiring(now, [], blocked).state;
    } else if mayStart(told) {
      assert after == starting([], told).state;
    } else {
      assert after == told;
    }
  }
  reveal alwaysTorchBelongsToItsPreview, extinguished;
}


lemma PermissionStableState(s: Camera, grant: kit__permission_Grant, now: int, by_: app__photos__actor_Actor)
  requires alwaysTorchBelongsToItsPreview(s)
  requires alwaysLensSettingsValid(s)
  requires alwaysFocusFollowsTheNewestTap(s)
  ensures alwaysTorchBelongsToItsPreview(accessIs(s, grant, now, by_).state)
  ensures alwaysLensSettingsValid(accessIs(s, grant, now, by_).state)
  ensures alwaysFocusFollowsTheNewestTap(accessIs(s, grant, now, by_).state)
{
  hide *;
  PermissionLensSettings(s, grant, now, by_);
  PermissionFocusSettings(s, grant, now, by_);
  PermissionTorchSettings(s, grant, now, by_);
}

lemma PermissionAccounted(s: Camera, grant: kit__permission_Grant, now: int, by_: app__photos__actor_Actor)
  requires alwaysStartsAccounted(s)
  ensures alwaysStartsAccounted(accessIs(s, grant, now, by_).state)
{
  hide *;
  reveal accessIs, kit__permission_observe, kit__permission_allows, mayStart,
    blocking, answering, emit, alwaysStartsAccounted;
  var told := s.(permission := kit__permission_observe(s.permission, grant));
  var after := accessIs(s, grant, now, by_);
  if !kit__permission_allows(told.permission) {
    var blocked := blocking(Cause.Denied, told);
    RetiredForPermission(s, blocked, now);
    assert after.state == retiring(now, [], blocked).state;
  } else if mayStart(told) {
    PermissionPreview(s, grant);
  }
}

lemma PermissionAgent(s: Camera, grant: kit__permission_Grant, now: int, by_: app__photos__actor_Actor)
  requires alwaysStartsAccounted(s)
  requires alwaysOneShutterOnTheCamera(s)
  requires alwaysTheRequestWaitsOnTheCamera(s)
  ensures alwaysOneShutterOnTheCamera(accessIs(s, grant, now, by_).state)
  ensures alwaysTheRequestWaitsOnTheCamera(accessIs(s, grant, now, by_).state)
  ensures stepEachRequestIsAnsweredOnce(s, accessIs(s, grant, now, by_).state, accessIs(s, grant, now, by_).out)
  ensures stepTheAgentFailsOnlyForCause(s, "accessIs", accessIs(s, grant, now, by_).state)
  ensures forall e :: e in accessIs(s, grant, now, by_).out ==>
    e.StartPreview? || e.StopRecording? || e.Answer? || (e.StopPreview? && 0 < e.ticket <= s.preview)
{
  hide *;
  reveal accessIs, kit__permission_observe, kit__permission_allows, mayStart,
    starting, blocking, retiring, answering, holds, emit, ready, recording;
  reveal alwaysOneShutterOnTheCamera, alwaysTheRequestWaitsOnTheCamera,
    stepEachRequestIsAnsweredOnce, stepTheAgentFailsOnlyForCause;
  reveal seen, app__camera__agent_open, app__camera__agent_viewChanged, app__camera__agent_block,
    app__camera__agent_finishing, app__camera__agent_lost, app__camera__agent_alwaysResultsAreHonest,
    app__camera__agent_alwaysApprovedViewIsShown, app__camera__agent_alwaysApprovedByTheOwner,
    kit__attempt_canRecord, kit__attempt_conclude;
  var told := s.(permission := kit__permission_observe(s.permission, grant));
  var after := accessIs(s, grant, now, by_);
  if !kit__permission_allows(told.permission) {
    var blocked := blocking(Cause.Denied, told);
    var retired := retiring(now, [], blocked);
    assert after == answering(retired, s);
    assert !app__camera__agent_open(blocked.agent);
    assert !app__camera__agent_open(retired.state.agent);
    RetiredForPermission(s, blocked, now);
    if !s.agent.stage.Over? && retired.state.agent.stage.Over? {
      assert retired.state.agent.result.Blocked? || retired.state.agent.result.Uncertain?;
      var answer := Answer(after.state.agent.request, after.state.agent.result, after.state.cause, after.state.agent.photo);
      assert after.out == retired.out + [answer];
      assert answer in after.out;
    } else {
      assert after.out == retired.out;
    }
    assert stepEachRequestIsAnsweredOnce(s, after.state, after.out);
  } else if mayStart(told) {
    assert after.out == [StartPreview(s.preview + 1, s.lens)];
    assert !after.state.agent.stage.Approved?;
    assert after.state.agent.stage.Over? == s.agent.stage.Over?;
  } else {
    assert after.state == told && after.out == [];
  }
}

lemma accessIs_ensures(s: Camera, grant: kit__permission_Grant, now: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysNoCameraWithoutAccess(accessIs(s, grant, now, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysNothingHeldAway(accessIs(s, grant, now, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysStartsAccounted(accessIs(s, grant, now, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysTorchBelongsToItsPreview(accessIs(s, grant, now, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysLensSettingsValid(accessIs(s, grant, now, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysFocusFollowsTheNewestTap(accessIs(s, grant, now, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysRecordingHoldsThePreview(accessIs(s, grant, now, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysOneShutterOnTheCamera(accessIs(s, grant, now, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysTheRequestWaitsOnTheCamera(accessIs(s, grant, now, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> stepALostPreviewFails(s, "accessIs", accessIs(s, grant, now, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> stepARetiredPreviewIsReleased(s, "accessIs", accessIs(s, grant, now, by_).state, accessIs(s, grant, now, by_).out))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> stepOneFocusWriteAtATime(s, "accessIs", accessIs(s, grant, now, by_).state, accessIs(s, grant, now, by_).out))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> stepSoundOnlyWithTheMicrophone(s, accessIs(s, grant, now, by_).state, accessIs(s, grant, now, by_).out))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> stepASavedVideoIsTheLast(s, accessIs(s, grant, now, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> stepTheShutterNeverFiresCovered(s, accessIs(s, grant, now, by_).state, accessIs(s, grant, now, by_).out))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> stepEachRequestIsAnsweredOnce(s, accessIs(s, grant, now, by_).state, accessIs(s, grant, now, by_).out))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> stepTheAgentFailsOnlyForCause(s, "accessIs", accessIs(s, grant, now, by_).state))
{
  hide *;
  reveal inv;
  if inv(s) && canAccessIs(s, by_) {
    PermissionCamera(s, grant, now, by_);
    PermissionAccounted(s, grant, now, by_);
    PermissionStableState(s, grant, now, by_);
    PermissionAgent(s, grant, now, by_);
    PermissionEffects(s, accessIs(s, grant, now, by_));
  }
}

lemma agentAsk_ensures(s: Camera, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> alwaysNoCameraWithoutAccess(agentAsk(s, by_).state))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> alwaysNothingHeldAway(agentAsk(s, by_).state))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> alwaysStartsAccounted(agentAsk(s, by_).state))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> alwaysTorchBelongsToItsPreview(agentAsk(s, by_).state))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> alwaysLensSettingsValid(agentAsk(s, by_).state))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> alwaysFocusFollowsTheNewestTap(agentAsk(s, by_).state))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> alwaysRecordingHoldsThePreview(agentAsk(s, by_).state))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> alwaysOneShutterOnTheCamera(agentAsk(s, by_).state))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> alwaysTheRequestWaitsOnTheCamera(agentAsk(s, by_).state))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> stepALostPreviewFails(s, "agentAsk", agentAsk(s, by_).state))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> stepARetiredPreviewIsReleased(s, "agentAsk", agentAsk(s, by_).state, agentAsk(s, by_).out))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> stepOneFocusWriteAtATime(s, "agentAsk", agentAsk(s, by_).state, agentAsk(s, by_).out))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> stepSoundOnlyWithTheMicrophone(s, agentAsk(s, by_).state, agentAsk(s, by_).out))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> stepASavedVideoIsTheLast(s, agentAsk(s, by_).state))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> stepTheShutterNeverFiresCovered(s, agentAsk(s, by_).state, agentAsk(s, by_).out))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> stepEachRequestIsAnsweredOnce(s, agentAsk(s, by_).state, agentAsk(s, by_).out))
  ensures (inv(s) ==> canAgentAsk(s, by_) ==> stepTheAgentFailsOnlyForCause(s, "agentAsk", agentAsk(s, by_).state))
{
  StartingAccounted();
}

lemma agentDecline_ensures(s: Camera, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> alwaysNoCameraWithoutAccess(agentDecline(s, by_).state))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> alwaysNothingHeldAway(agentDecline(s, by_).state))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> alwaysStartsAccounted(agentDecline(s, by_).state))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> alwaysTorchBelongsToItsPreview(agentDecline(s, by_).state))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> alwaysLensSettingsValid(agentDecline(s, by_).state))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> alwaysFocusFollowsTheNewestTap(agentDecline(s, by_).state))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> alwaysRecordingHoldsThePreview(agentDecline(s, by_).state))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> alwaysOneShutterOnTheCamera(agentDecline(s, by_).state))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> alwaysTheRequestWaitsOnTheCamera(agentDecline(s, by_).state))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> stepALostPreviewFails(s, "agentDecline", agentDecline(s, by_).state))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> stepARetiredPreviewIsReleased(s, "agentDecline", agentDecline(s, by_).state, agentDecline(s, by_).out))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> stepOneFocusWriteAtATime(s, "agentDecline", agentDecline(s, by_).state, agentDecline(s, by_).out))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> stepSoundOnlyWithTheMicrophone(s, agentDecline(s, by_).state, agentDecline(s, by_).out))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> stepASavedVideoIsTheLast(s, agentDecline(s, by_).state))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> stepTheShutterNeverFiresCovered(s, agentDecline(s, by_).state, agentDecline(s, by_).out))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> stepEachRequestIsAnsweredOnce(s, agentDecline(s, by_).state, agentDecline(s, by_).out))
  ensures (inv(s) ==> canAgentDecline(s, by_) ==> stepTheAgentFailsOnlyForCause(s, "agentDecline", agentDecline(s, by_).state))
{
  AnsweringAll();
}

lemma agentExpired_ensures(s: Camera, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> alwaysNoCameraWithoutAccess(agentExpired(s, by_).state))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> alwaysNothingHeldAway(agentExpired(s, by_).state))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> alwaysStartsAccounted(agentExpired(s, by_).state))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> alwaysTorchBelongsToItsPreview(agentExpired(s, by_).state))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> alwaysLensSettingsValid(agentExpired(s, by_).state))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> alwaysFocusFollowsTheNewestTap(agentExpired(s, by_).state))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> alwaysRecordingHoldsThePreview(agentExpired(s, by_).state))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> alwaysOneShutterOnTheCamera(agentExpired(s, by_).state))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> alwaysTheRequestWaitsOnTheCamera(agentExpired(s, by_).state))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> stepALostPreviewFails(s, "agentExpired", agentExpired(s, by_).state))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> stepARetiredPreviewIsReleased(s, "agentExpired", agentExpired(s, by_).state, agentExpired(s, by_).out))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> stepOneFocusWriteAtATime(s, "agentExpired", agentExpired(s, by_).state, agentExpired(s, by_).out))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> stepSoundOnlyWithTheMicrophone(s, agentExpired(s, by_).state, agentExpired(s, by_).out))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> stepASavedVideoIsTheLast(s, agentExpired(s, by_).state))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> stepTheShutterNeverFiresCovered(s, agentExpired(s, by_).state, agentExpired(s, by_).out))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> stepEachRequestIsAnsweredOnce(s, agentExpired(s, by_).state, agentExpired(s, by_).out))
  ensures (inv(s) ==> canAgentExpired(s, by_) ==> stepTheAgentFailsOnlyForCause(s, "agentExpired", agentExpired(s, by_).state))
{
  AnsweringAll();
}

lemma agentWithdraw_ensures(s: Camera, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> alwaysNoCameraWithoutAccess(agentWithdraw(s, by_).state))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> alwaysNothingHeldAway(agentWithdraw(s, by_).state))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> alwaysStartsAccounted(agentWithdraw(s, by_).state))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> alwaysTorchBelongsToItsPreview(agentWithdraw(s, by_).state))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> alwaysLensSettingsValid(agentWithdraw(s, by_).state))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> alwaysFocusFollowsTheNewestTap(agentWithdraw(s, by_).state))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> alwaysRecordingHoldsThePreview(agentWithdraw(s, by_).state))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> alwaysOneShutterOnTheCamera(agentWithdraw(s, by_).state))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> alwaysTheRequestWaitsOnTheCamera(agentWithdraw(s, by_).state))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> stepALostPreviewFails(s, "agentWithdraw", agentWithdraw(s, by_).state))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> stepARetiredPreviewIsReleased(s, "agentWithdraw", agentWithdraw(s, by_).state, agentWithdraw(s, by_).out))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> stepOneFocusWriteAtATime(s, "agentWithdraw", agentWithdraw(s, by_).state, agentWithdraw(s, by_).out))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> stepSoundOnlyWithTheMicrophone(s, agentWithdraw(s, by_).state, agentWithdraw(s, by_).out))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> stepASavedVideoIsTheLast(s, agentWithdraw(s, by_).state))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> stepTheShutterNeverFiresCovered(s, agentWithdraw(s, by_).state, agentWithdraw(s, by_).out))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> stepEachRequestIsAnsweredOnce(s, agentWithdraw(s, by_).state, agentWithdraw(s, by_).out))
  ensures (inv(s) ==> canAgentWithdraw(s, by_) ==> stepTheAgentFailsOnlyForCause(s, "agentWithdraw", agentWithdraw(s, by_).state))
{
  AnsweringAll();
}

lemma agentShoot_ensures(s: Camera, sensitive: bool, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> alwaysNoCameraWithoutAccess(agentShoot(s, sensitive, by_).state))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> alwaysNothingHeldAway(agentShoot(s, sensitive, by_).state))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> alwaysStartsAccounted(agentShoot(s, sensitive, by_).state))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> alwaysTorchBelongsToItsPreview(agentShoot(s, sensitive, by_).state))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> alwaysLensSettingsValid(agentShoot(s, sensitive, by_).state))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> alwaysFocusFollowsTheNewestTap(agentShoot(s, sensitive, by_).state))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> alwaysRecordingHoldsThePreview(agentShoot(s, sensitive, by_).state))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> alwaysOneShutterOnTheCamera(agentShoot(s, sensitive, by_).state))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> alwaysTheRequestWaitsOnTheCamera(agentShoot(s, sensitive, by_).state))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> stepALostPreviewFails(s, "agentShoot", agentShoot(s, sensitive, by_).state))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> stepARetiredPreviewIsReleased(s, "agentShoot", agentShoot(s, sensitive, by_).state, agentShoot(s, sensitive, by_).out))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> stepOneFocusWriteAtATime(s, "agentShoot", agentShoot(s, sensitive, by_).state, agentShoot(s, sensitive, by_).out))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> stepSoundOnlyWithTheMicrophone(s, agentShoot(s, sensitive, by_).state, agentShoot(s, sensitive, by_).out))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> stepASavedVideoIsTheLast(s, agentShoot(s, sensitive, by_).state))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> stepTheShutterNeverFiresCovered(s, agentShoot(s, sensitive, by_).state, agentShoot(s, sensitive, by_).out))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> stepEachRequestIsAnsweredOnce(s, agentShoot(s, sensitive, by_).state, agentShoot(s, sensitive, by_).out))
  ensures (inv(s) ==> canAgentShoot(s, sensitive, by_) ==> stepTheAgentFailsOnlyForCause(s, "agentShoot", agentShoot(s, sensitive, by_).state))
{
  AnsweringAll();
}

lemma captured_ensures(s: Camera, ticket: int, photo: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> alwaysNoCameraWithoutAccess(captured(s, ticket, photo, by_).state))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> alwaysNothingHeldAway(captured(s, ticket, photo, by_).state))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> alwaysStartsAccounted(captured(s, ticket, photo, by_).state))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> alwaysTorchBelongsToItsPreview(captured(s, ticket, photo, by_).state))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> alwaysLensSettingsValid(captured(s, ticket, photo, by_).state))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> alwaysFocusFollowsTheNewestTap(captured(s, ticket, photo, by_).state))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> alwaysRecordingHoldsThePreview(captured(s, ticket, photo, by_).state))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> alwaysOneShutterOnTheCamera(captured(s, ticket, photo, by_).state))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> alwaysTheRequestWaitsOnTheCamera(captured(s, ticket, photo, by_).state))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> stepALostPreviewFails(s, "captured", captured(s, ticket, photo, by_).state))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> stepARetiredPreviewIsReleased(s, "captured", captured(s, ticket, photo, by_).state, captured(s, ticket, photo, by_).out))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> stepOneFocusWriteAtATime(s, "captured", captured(s, ticket, photo, by_).state, captured(s, ticket, photo, by_).out))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> stepSoundOnlyWithTheMicrophone(s, captured(s, ticket, photo, by_).state, captured(s, ticket, photo, by_).out))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> stepASavedVideoIsTheLast(s, captured(s, ticket, photo, by_).state))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> stepTheShutterNeverFiresCovered(s, captured(s, ticket, photo, by_).state, captured(s, ticket, photo, by_).out))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> stepEachRequestIsAnsweredOnce(s, captured(s, ticket, photo, by_).state, captured(s, ticket, photo, by_).out))
  ensures (inv(s) ==> canCaptured(s, ticket, by_) ==> stepTheAgentFailsOnlyForCause(s, "captured", captured(s, ticket, photo, by_).state))
{
  AnsweringAll();
}

lemma close_ensures(s: Camera, now: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canClose(s, by_) ==> alwaysNoCameraWithoutAccess(close(s, now, by_).state))
  ensures (inv(s) ==> canClose(s, by_) ==> alwaysNothingHeldAway(close(s, now, by_).state))
  ensures (inv(s) ==> canClose(s, by_) ==> alwaysStartsAccounted(close(s, now, by_).state))
  ensures (inv(s) ==> canClose(s, by_) ==> alwaysTorchBelongsToItsPreview(close(s, now, by_).state))
  ensures (inv(s) ==> canClose(s, by_) ==> alwaysLensSettingsValid(close(s, now, by_).state))
  ensures (inv(s) ==> canClose(s, by_) ==> alwaysFocusFollowsTheNewestTap(close(s, now, by_).state))
  ensures (inv(s) ==> canClose(s, by_) ==> alwaysRecordingHoldsThePreview(close(s, now, by_).state))
  ensures (inv(s) ==> canClose(s, by_) ==> alwaysOneShutterOnTheCamera(close(s, now, by_).state))
  ensures (inv(s) ==> canClose(s, by_) ==> alwaysTheRequestWaitsOnTheCamera(close(s, now, by_).state))
  ensures (inv(s) ==> canClose(s, by_) ==> stepALostPreviewFails(s, "close", close(s, now, by_).state))
  ensures (inv(s) ==> canClose(s, by_) ==> stepARetiredPreviewIsReleased(s, "close", close(s, now, by_).state, close(s, now, by_).out))
  ensures (inv(s) ==> canClose(s, by_) ==> stepOneFocusWriteAtATime(s, "close", close(s, now, by_).state, close(s, now, by_).out))
  ensures (inv(s) ==> canClose(s, by_) ==> stepSoundOnlyWithTheMicrophone(s, close(s, now, by_).state, close(s, now, by_).out))
  ensures (inv(s) ==> canClose(s, by_) ==> stepASavedVideoIsTheLast(s, close(s, now, by_).state))
  ensures (inv(s) ==> canClose(s, by_) ==> stepTheShutterNeverFiresCovered(s, close(s, now, by_).state, close(s, now, by_).out))
  ensures (inv(s) ==> canClose(s, by_) ==> stepEachRequestIsAnsweredOnce(s, close(s, now, by_).state, close(s, now, by_).out))
  ensures (inv(s) ==> canClose(s, by_) ==> stepTheAgentFailsOnlyForCause(s, "close", close(s, now, by_).state))
{
  AnsweringAll();
  RetiringOut();
}

lemma flip_ensures(s: Camera, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canFlip(s, by_) ==> alwaysNoCameraWithoutAccess(flip(s, by_).state))
  ensures (inv(s) ==> canFlip(s, by_) ==> alwaysNothingHeldAway(flip(s, by_).state))
  ensures (inv(s) ==> canFlip(s, by_) ==> alwaysStartsAccounted(flip(s, by_).state))
  ensures (inv(s) ==> canFlip(s, by_) ==> alwaysTorchBelongsToItsPreview(flip(s, by_).state))
  ensures (inv(s) ==> canFlip(s, by_) ==> alwaysLensSettingsValid(flip(s, by_).state))
  ensures (inv(s) ==> canFlip(s, by_) ==> alwaysFocusFollowsTheNewestTap(flip(s, by_).state))
  ensures (inv(s) ==> canFlip(s, by_) ==> alwaysRecordingHoldsThePreview(flip(s, by_).state))
  ensures (inv(s) ==> canFlip(s, by_) ==> alwaysOneShutterOnTheCamera(flip(s, by_).state))
  ensures (inv(s) ==> canFlip(s, by_) ==> alwaysTheRequestWaitsOnTheCamera(flip(s, by_).state))
  ensures (inv(s) ==> canFlip(s, by_) ==> stepALostPreviewFails(s, "flip", flip(s, by_).state))
  ensures (inv(s) ==> canFlip(s, by_) ==> stepARetiredPreviewIsReleased(s, "flip", flip(s, by_).state, flip(s, by_).out))
  ensures (inv(s) ==> canFlip(s, by_) ==> stepOneFocusWriteAtATime(s, "flip", flip(s, by_).state, flip(s, by_).out))
  ensures (inv(s) ==> canFlip(s, by_) ==> stepSoundOnlyWithTheMicrophone(s, flip(s, by_).state, flip(s, by_).out))
  ensures (inv(s) ==> canFlip(s, by_) ==> stepASavedVideoIsTheLast(s, flip(s, by_).state))
  ensures (inv(s) ==> canFlip(s, by_) ==> stepTheShutterNeverFiresCovered(s, flip(s, by_).state, flip(s, by_).out))
  ensures (inv(s) ==> canFlip(s, by_) ==> stepEachRequestIsAnsweredOnce(s, flip(s, by_).state, flip(s, by_).out))
  ensures (inv(s) ==> canFlip(s, by_) ==> stepTheAgentFailsOnlyForCause(s, "flip", flip(s, by_).state))
{
  StartingAccounted();
}

lemma open_ensures(s: Camera, newest: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canOpen(s, by_) ==> alwaysNoCameraWithoutAccess(open(s, newest, by_).state))
  ensures (inv(s) ==> canOpen(s, by_) ==> alwaysNothingHeldAway(open(s, newest, by_).state))
  ensures (inv(s) ==> canOpen(s, by_) ==> alwaysStartsAccounted(open(s, newest, by_).state))
  ensures (inv(s) ==> canOpen(s, by_) ==> alwaysTorchBelongsToItsPreview(open(s, newest, by_).state))
  ensures (inv(s) ==> canOpen(s, by_) ==> alwaysLensSettingsValid(open(s, newest, by_).state))
  ensures (inv(s) ==> canOpen(s, by_) ==> alwaysFocusFollowsTheNewestTap(open(s, newest, by_).state))
  ensures (inv(s) ==> canOpen(s, by_) ==> alwaysRecordingHoldsThePreview(open(s, newest, by_).state))
  ensures (inv(s) ==> canOpen(s, by_) ==> alwaysOneShutterOnTheCamera(open(s, newest, by_).state))
  ensures (inv(s) ==> canOpen(s, by_) ==> alwaysTheRequestWaitsOnTheCamera(open(s, newest, by_).state))
  ensures (inv(s) ==> canOpen(s, by_) ==> stepALostPreviewFails(s, "open", open(s, newest, by_).state))
  ensures (inv(s) ==> canOpen(s, by_) ==> stepARetiredPreviewIsReleased(s, "open", open(s, newest, by_).state, open(s, newest, by_).out))
  ensures (inv(s) ==> canOpen(s, by_) ==> stepOneFocusWriteAtATime(s, "open", open(s, newest, by_).state, open(s, newest, by_).out))
  ensures (inv(s) ==> canOpen(s, by_) ==> stepSoundOnlyWithTheMicrophone(s, open(s, newest, by_).state, open(s, newest, by_).out))
  ensures (inv(s) ==> canOpen(s, by_) ==> stepASavedVideoIsTheLast(s, open(s, newest, by_).state))
  ensures (inv(s) ==> canOpen(s, by_) ==> stepTheShutterNeverFiresCovered(s, open(s, newest, by_).state, open(s, newest, by_).out))
  ensures (inv(s) ==> canOpen(s, by_) ==> stepEachRequestIsAnsweredOnce(s, open(s, newest, by_).state, open(s, newest, by_).out))
  ensures (inv(s) ==> canOpen(s, by_) ==> stepTheAgentFailsOnlyForCause(s, "open", open(s, newest, by_).state))
{
  StartingAccounted();
}

lemma retry_ensures(s: Camera, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canRetry(s, by_) ==> alwaysNoCameraWithoutAccess(retry(s, by_).state))
  ensures (inv(s) ==> canRetry(s, by_) ==> alwaysNothingHeldAway(retry(s, by_).state))
  ensures (inv(s) ==> canRetry(s, by_) ==> alwaysStartsAccounted(retry(s, by_).state))
  ensures (inv(s) ==> canRetry(s, by_) ==> alwaysTorchBelongsToItsPreview(retry(s, by_).state))
  ensures (inv(s) ==> canRetry(s, by_) ==> alwaysLensSettingsValid(retry(s, by_).state))
  ensures (inv(s) ==> canRetry(s, by_) ==> alwaysFocusFollowsTheNewestTap(retry(s, by_).state))
  ensures (inv(s) ==> canRetry(s, by_) ==> alwaysRecordingHoldsThePreview(retry(s, by_).state))
  ensures (inv(s) ==> canRetry(s, by_) ==> alwaysOneShutterOnTheCamera(retry(s, by_).state))
  ensures (inv(s) ==> canRetry(s, by_) ==> alwaysTheRequestWaitsOnTheCamera(retry(s, by_).state))
  ensures (inv(s) ==> canRetry(s, by_) ==> stepALostPreviewFails(s, "retry", retry(s, by_).state))
  ensures (inv(s) ==> canRetry(s, by_) ==> stepARetiredPreviewIsReleased(s, "retry", retry(s, by_).state, retry(s, by_).out))
  ensures (inv(s) ==> canRetry(s, by_) ==> stepOneFocusWriteAtATime(s, "retry", retry(s, by_).state, retry(s, by_).out))
  ensures (inv(s) ==> canRetry(s, by_) ==> stepSoundOnlyWithTheMicrophone(s, retry(s, by_).state, retry(s, by_).out))
  ensures (inv(s) ==> canRetry(s, by_) ==> stepASavedVideoIsTheLast(s, retry(s, by_).state))
  ensures (inv(s) ==> canRetry(s, by_) ==> stepTheShutterNeverFiresCovered(s, retry(s, by_).state, retry(s, by_).out))
  ensures (inv(s) ==> canRetry(s, by_) ==> stepEachRequestIsAnsweredOnce(s, retry(s, by_).state, retry(s, by_).out))
  ensures (inv(s) ==> canRetry(s, by_) ==> stepTheAgentFailsOnlyForCause(s, "retry", retry(s, by_).state))
{
  StartingAccounted();
}

lemma uncovered_ensures(s: Camera, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canUncovered(s, by_) ==> alwaysNoCameraWithoutAccess(uncovered(s, by_).state))
  ensures (inv(s) ==> canUncovered(s, by_) ==> alwaysNothingHeldAway(uncovered(s, by_).state))
  ensures (inv(s) ==> canUncovered(s, by_) ==> alwaysStartsAccounted(uncovered(s, by_).state))
  ensures (inv(s) ==> canUncovered(s, by_) ==> alwaysTorchBelongsToItsPreview(uncovered(s, by_).state))
  ensures (inv(s) ==> canUncovered(s, by_) ==> alwaysLensSettingsValid(uncovered(s, by_).state))
  ensures (inv(s) ==> canUncovered(s, by_) ==> alwaysFocusFollowsTheNewestTap(uncovered(s, by_).state))
  ensures (inv(s) ==> canUncovered(s, by_) ==> alwaysRecordingHoldsThePreview(uncovered(s, by_).state))
  ensures (inv(s) ==> canUncovered(s, by_) ==> alwaysOneShutterOnTheCamera(uncovered(s, by_).state))
  ensures (inv(s) ==> canUncovered(s, by_) ==> alwaysTheRequestWaitsOnTheCamera(uncovered(s, by_).state))
  ensures (inv(s) ==> canUncovered(s, by_) ==> stepALostPreviewFails(s, "uncovered", uncovered(s, by_).state))
  ensures (inv(s) ==> canUncovered(s, by_) ==> stepARetiredPreviewIsReleased(s, "uncovered", uncovered(s, by_).state, uncovered(s, by_).out))
  ensures (inv(s) ==> canUncovered(s, by_) ==> stepOneFocusWriteAtATime(s, "uncovered", uncovered(s, by_).state, uncovered(s, by_).out))
  ensures (inv(s) ==> canUncovered(s, by_) ==> stepSoundOnlyWithTheMicrophone(s, uncovered(s, by_).state, uncovered(s, by_).out))
  ensures (inv(s) ==> canUncovered(s, by_) ==> stepASavedVideoIsTheLast(s, uncovered(s, by_).state))
  ensures (inv(s) ==> canUncovered(s, by_) ==> stepTheShutterNeverFiresCovered(s, uncovered(s, by_).state, uncovered(s, by_).out))
  ensures (inv(s) ==> canUncovered(s, by_) ==> stepEachRequestIsAnsweredOnce(s, uncovered(s, by_).state, uncovered(s, by_).out))
  ensures (inv(s) ==> canUncovered(s, by_) ==> stepTheAgentFailsOnlyForCause(s, "uncovered", uncovered(s, by_).state))
{
  StartingAccounted();
}

lemma previewLost_ensures(s: Camera, ticket: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> alwaysNoCameraWithoutAccess(previewLost(s, ticket, by_).state))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> alwaysNothingHeldAway(previewLost(s, ticket, by_).state))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> alwaysStartsAccounted(previewLost(s, ticket, by_).state))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> alwaysTorchBelongsToItsPreview(previewLost(s, ticket, by_).state))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> alwaysLensSettingsValid(previewLost(s, ticket, by_).state))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> alwaysFocusFollowsTheNewestTap(previewLost(s, ticket, by_).state))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> alwaysRecordingHoldsThePreview(previewLost(s, ticket, by_).state))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> alwaysOneShutterOnTheCamera(previewLost(s, ticket, by_).state))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> alwaysTheRequestWaitsOnTheCamera(previewLost(s, ticket, by_).state))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> stepALostPreviewFails(s, "previewLost", previewLost(s, ticket, by_).state))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> stepARetiredPreviewIsReleased(s, "previewLost", previewLost(s, ticket, by_).state, previewLost(s, ticket, by_).out))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> stepOneFocusWriteAtATime(s, "previewLost", previewLost(s, ticket, by_).state, previewLost(s, ticket, by_).out))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> stepSoundOnlyWithTheMicrophone(s, previewLost(s, ticket, by_).state, previewLost(s, ticket, by_).out))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> stepASavedVideoIsTheLast(s, previewLost(s, ticket, by_).state))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> stepTheShutterNeverFiresCovered(s, previewLost(s, ticket, by_).state, previewLost(s, ticket, by_).out))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> stepEachRequestIsAnsweredOnce(s, previewLost(s, ticket, by_).state, previewLost(s, ticket, by_).out))
  ensures (inv(s) ==> canPreviewLost(s, ticket, by_) ==> stepTheAgentFailsOnlyForCause(s, "previewLost", previewLost(s, ticket, by_).state))
{
  AnsweringAll();
}

lemma previewStarted_ensures(s: Camera, ticket: int, ok: bool, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> alwaysNoCameraWithoutAccess(previewStarted(s, ticket, ok, by_).state))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> alwaysNothingHeldAway(previewStarted(s, ticket, ok, by_).state))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> alwaysStartsAccounted(previewStarted(s, ticket, ok, by_).state))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> alwaysTorchBelongsToItsPreview(previewStarted(s, ticket, ok, by_).state))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> alwaysLensSettingsValid(previewStarted(s, ticket, ok, by_).state))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> alwaysFocusFollowsTheNewestTap(previewStarted(s, ticket, ok, by_).state))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> alwaysRecordingHoldsThePreview(previewStarted(s, ticket, ok, by_).state))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> alwaysOneShutterOnTheCamera(previewStarted(s, ticket, ok, by_).state))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> alwaysTheRequestWaitsOnTheCamera(previewStarted(s, ticket, ok, by_).state))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> stepALostPreviewFails(s, "previewStarted", previewStarted(s, ticket, ok, by_).state))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> stepARetiredPreviewIsReleased(s, "previewStarted", previewStarted(s, ticket, ok, by_).state, previewStarted(s, ticket, ok, by_).out))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> stepOneFocusWriteAtATime(s, "previewStarted", previewStarted(s, ticket, ok, by_).state, previewStarted(s, ticket, ok, by_).out))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> stepSoundOnlyWithTheMicrophone(s, previewStarted(s, ticket, ok, by_).state, previewStarted(s, ticket, ok, by_).out))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> stepASavedVideoIsTheLast(s, previewStarted(s, ticket, ok, by_).state))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> stepTheShutterNeverFiresCovered(s, previewStarted(s, ticket, ok, by_).state, previewStarted(s, ticket, ok, by_).out))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> stepEachRequestIsAnsweredOnce(s, previewStarted(s, ticket, ok, by_).state, previewStarted(s, ticket, ok, by_).out))
  ensures (inv(s) ==> canPreviewStarted(s, ticket, by_) ==> stepTheAgentFailsOnlyForCause(s, "previewStarted", previewStarted(s, ticket, ok, by_).state))
{
  AnsweringAll();
  assert previewStarted(s, ticket, ok, by_).state.pending == ProofLib.Filter((set_x: int) => !((set_x in [ticket])), s.pending);
  Dropped(s.pending, [ticket]);
}

lemma staleOpened_ensures(s: Camera, ticket: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> alwaysNoCameraWithoutAccess(staleOpened(s, ticket, by_).state))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> alwaysNothingHeldAway(staleOpened(s, ticket, by_).state))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> alwaysStartsAccounted(staleOpened(s, ticket, by_).state))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> alwaysTorchBelongsToItsPreview(staleOpened(s, ticket, by_).state))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> alwaysLensSettingsValid(staleOpened(s, ticket, by_).state))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> alwaysFocusFollowsTheNewestTap(staleOpened(s, ticket, by_).state))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> alwaysRecordingHoldsThePreview(staleOpened(s, ticket, by_).state))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> alwaysOneShutterOnTheCamera(staleOpened(s, ticket, by_).state))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> alwaysTheRequestWaitsOnTheCamera(staleOpened(s, ticket, by_).state))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> stepALostPreviewFails(s, "staleOpened", staleOpened(s, ticket, by_).state))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> stepARetiredPreviewIsReleased(s, "staleOpened", staleOpened(s, ticket, by_).state, staleOpened(s, ticket, by_).out))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> stepOneFocusWriteAtATime(s, "staleOpened", staleOpened(s, ticket, by_).state, staleOpened(s, ticket, by_).out))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> stepSoundOnlyWithTheMicrophone(s, staleOpened(s, ticket, by_).state, staleOpened(s, ticket, by_).out))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> stepASavedVideoIsTheLast(s, staleOpened(s, ticket, by_).state))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> stepTheShutterNeverFiresCovered(s, staleOpened(s, ticket, by_).state, staleOpened(s, ticket, by_).out))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> stepEachRequestIsAnsweredOnce(s, staleOpened(s, ticket, by_).state, staleOpened(s, ticket, by_).out))
  ensures (inv(s) ==> canStaleOpened(s, ticket, by_) ==> stepTheAgentFailsOnlyForCause(s, "staleOpened", staleOpened(s, ticket, by_).state))
{
  assert staleOpened(s, ticket, by_).state.pending == ProofLib.Filter((set_x: int) => !((set_x in [ticket])), s.pending);
  Dropped(s.pending, [ticket]);
}

lemma staleFailed_ensures(s: Camera, ticket: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> alwaysNoCameraWithoutAccess(staleFailed(s, ticket, by_)))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> alwaysNothingHeldAway(staleFailed(s, ticket, by_)))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> alwaysStartsAccounted(staleFailed(s, ticket, by_)))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> alwaysTorchBelongsToItsPreview(staleFailed(s, ticket, by_)))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> alwaysLensSettingsValid(staleFailed(s, ticket, by_)))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> alwaysFocusFollowsTheNewestTap(staleFailed(s, ticket, by_)))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> alwaysRecordingHoldsThePreview(staleFailed(s, ticket, by_)))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> alwaysOneShutterOnTheCamera(staleFailed(s, ticket, by_)))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> alwaysTheRequestWaitsOnTheCamera(staleFailed(s, ticket, by_)))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> stepALostPreviewFails(s, "staleFailed", staleFailed(s, ticket, by_)))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> stepARetiredPreviewIsReleased(s, "staleFailed", staleFailed(s, ticket, by_), []))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> stepOneFocusWriteAtATime(s, "staleFailed", staleFailed(s, ticket, by_), []))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> stepSoundOnlyWithTheMicrophone(s, staleFailed(s, ticket, by_), []))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> stepASavedVideoIsTheLast(s, staleFailed(s, ticket, by_)))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> stepTheShutterNeverFiresCovered(s, staleFailed(s, ticket, by_), []))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> stepEachRequestIsAnsweredOnce(s, staleFailed(s, ticket, by_), []))
  ensures (inv(s) ==> canStaleFailed(s, ticket, by_) ==> stepTheAgentFailsOnlyForCause(s, "staleFailed", staleFailed(s, ticket, by_)))
{
  assert staleFailed(s, ticket, by_).pending == ProofLib.Filter((set_x: int) => !((set_x in [ticket])), s.pending);
  Dropped(s.pending, [ticket]);
}

lemma recordingEnded_ensures(s: Camera, ok: bool, video: int, now: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> alwaysNoCameraWithoutAccess(recordingEnded(s, ok, video, now, by_).state))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> alwaysNothingHeldAway(recordingEnded(s, ok, video, now, by_).state))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> alwaysStartsAccounted(recordingEnded(s, ok, video, now, by_).state))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> alwaysTorchBelongsToItsPreview(recordingEnded(s, ok, video, now, by_).state))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> alwaysLensSettingsValid(recordingEnded(s, ok, video, now, by_).state))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> alwaysFocusFollowsTheNewestTap(recordingEnded(s, ok, video, now, by_).state))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> alwaysRecordingHoldsThePreview(recordingEnded(s, ok, video, now, by_).state))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> alwaysOneShutterOnTheCamera(recordingEnded(s, ok, video, now, by_).state))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> alwaysTheRequestWaitsOnTheCamera(recordingEnded(s, ok, video, now, by_).state))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> stepALostPreviewFails(s, "recordingEnded", recordingEnded(s, ok, video, now, by_).state))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> stepARetiredPreviewIsReleased(s, "recordingEnded", recordingEnded(s, ok, video, now, by_).state, recordingEnded(s, ok, video, now, by_).out))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> stepOneFocusWriteAtATime(s, "recordingEnded", recordingEnded(s, ok, video, now, by_).state, recordingEnded(s, ok, video, now, by_).out))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> stepSoundOnlyWithTheMicrophone(s, recordingEnded(s, ok, video, now, by_).state, recordingEnded(s, ok, video, now, by_).out))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> stepASavedVideoIsTheLast(s, recordingEnded(s, ok, video, now, by_).state))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> stepTheShutterNeverFiresCovered(s, recordingEnded(s, ok, video, now, by_).state, recordingEnded(s, ok, video, now, by_).out))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> stepEachRequestIsAnsweredOnce(s, recordingEnded(s, ok, video, now, by_).state, recordingEnded(s, ok, video, now, by_).out))
  ensures (inv(s) ==> canRecordingEnded(s, by_) ==> stepTheAgentFailsOnlyForCause(s, "recordingEnded", recordingEnded(s, ok, video, now, by_).state))
{
  hide *;
  if inv(s) && canRecordingEnded(s, by_) {
    var ended := app__camera__recording_ended(s.film, ok, video);
    assert recordingEnded(s, ok, video, now, by_) == filming(ended, now, s) by {
      reveal recordingEnded;
    }
    assert !app__camera__recording_recording(ended) && !ended.stage.Running?
      && app__camera__recording_alwaysWithinLimits(ended) && app__camera__recording_alwaysSavedIsWhole(ended) by {
      reveal inv, canRecordingEnded, alwaysRecordingHoldsThePreview,
        app__camera__recording_canEnded, app__camera__recording_ended,
        app__camera__recording_recording, app__camera__recording_opening,
        app__camera__recording_alwaysWithinLimits, app__camera__recording_alwaysSavedIsWhole;
    }
    FilmingPreserves(s, ended, now, "recordingEnded");
  }
}

lemma recordingVerified_ensures(s: Camera, ok: bool, now: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> alwaysNoCameraWithoutAccess(recordingVerified(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> alwaysNothingHeldAway(recordingVerified(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> alwaysStartsAccounted(recordingVerified(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> alwaysTorchBelongsToItsPreview(recordingVerified(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> alwaysLensSettingsValid(recordingVerified(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> alwaysFocusFollowsTheNewestTap(recordingVerified(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> alwaysRecordingHoldsThePreview(recordingVerified(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> alwaysOneShutterOnTheCamera(recordingVerified(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> alwaysTheRequestWaitsOnTheCamera(recordingVerified(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> stepALostPreviewFails(s, "recordingVerified", recordingVerified(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> stepARetiredPreviewIsReleased(s, "recordingVerified", recordingVerified(s, ok, now, by_).state, recordingVerified(s, ok, now, by_).out))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> stepOneFocusWriteAtATime(s, "recordingVerified", recordingVerified(s, ok, now, by_).state, recordingVerified(s, ok, now, by_).out))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> stepSoundOnlyWithTheMicrophone(s, recordingVerified(s, ok, now, by_).state, recordingVerified(s, ok, now, by_).out))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> stepASavedVideoIsTheLast(s, recordingVerified(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> stepTheShutterNeverFiresCovered(s, recordingVerified(s, ok, now, by_).state, recordingVerified(s, ok, now, by_).out))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> stepEachRequestIsAnsweredOnce(s, recordingVerified(s, ok, now, by_).state, recordingVerified(s, ok, now, by_).out))
  ensures (inv(s) ==> canRecordingVerified(s, by_) ==> stepTheAgentFailsOnlyForCause(s, "recordingVerified", recordingVerified(s, ok, now, by_).state))
{
  hide *;
  if inv(s) && canRecordingVerified(s, by_) {
    var ended := app__camera__recording_verified(s.film, ok);
    assert recordingVerified(s, ok, now, by_) == filming(ended, now, s) by {
      reveal recordingVerified;
    }
    assert !app__camera__recording_recording(ended) && !ended.stage.Running?
      && app__camera__recording_alwaysWithinLimits(ended) && app__camera__recording_alwaysSavedIsWhole(ended) by {
      reveal inv, canRecordingVerified, alwaysRecordingHoldsThePreview,
        app__camera__recording_canVerified, app__camera__recording_verified,
        app__camera__recording_recording, app__camera__recording_opening,
        app__camera__recording_alwaysWithinLimits, app__camera__recording_alwaysSavedIsWhole;
    }
    FilmingPreserves(s, ended, now, "recordingVerified");
  }
}

lemma StartAccounted(out: seq<Effect>, c: Camera)
  requires c.preview >= 0 && c.showing
  requires forall t :: t in c.pending ==> t > 0 && t <= c.preview
  ensures alwaysStartsAccounted(starting(out, c).state)
{
  var n := c.preview + 1;
  var after := starting(out, c).state;
  Joined(c.pending, [n]);
  assert after.pending == c.pending + ProofLib.Filter((set_x: int) => !((set_x in c.pending)), [n]);
  assert n in after.pending;
  forall t | t in after.pending ensures t > 0 && t <= after.preview {
    assert t in c.pending || t == n;
  }
}

lemma tick_ensures(s: Camera, now: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canTick(s, now, by_) ==> alwaysNoCameraWithoutAccess(tick(s, now, by_).state))
  ensures (inv(s) ==> canTick(s, now, by_) ==> alwaysNothingHeldAway(tick(s, now, by_).state))
  ensures (inv(s) ==> canTick(s, now, by_) ==> alwaysStartsAccounted(tick(s, now, by_).state))
  ensures (inv(s) ==> canTick(s, now, by_) ==> alwaysTorchBelongsToItsPreview(tick(s, now, by_).state))
  ensures (inv(s) ==> canTick(s, now, by_) ==> alwaysLensSettingsValid(tick(s, now, by_).state))
  ensures (inv(s) ==> canTick(s, now, by_) ==> alwaysFocusFollowsTheNewestTap(tick(s, now, by_).state))
  ensures (inv(s) ==> canTick(s, now, by_) ==> alwaysRecordingHoldsThePreview(tick(s, now, by_).state))
  ensures (inv(s) ==> canTick(s, now, by_) ==> alwaysOneShutterOnTheCamera(tick(s, now, by_).state))
  ensures (inv(s) ==> canTick(s, now, by_) ==> alwaysTheRequestWaitsOnTheCamera(tick(s, now, by_).state))
  ensures (inv(s) ==> canTick(s, now, by_) ==> stepALostPreviewFails(s, "tick", tick(s, now, by_).state))
  ensures (inv(s) ==> canTick(s, now, by_) ==> stepARetiredPreviewIsReleased(s, "tick", tick(s, now, by_).state, tick(s, now, by_).out))
  ensures (inv(s) ==> canTick(s, now, by_) ==> stepOneFocusWriteAtATime(s, "tick", tick(s, now, by_).state, tick(s, now, by_).out))
  ensures (inv(s) ==> canTick(s, now, by_) ==> stepSoundOnlyWithTheMicrophone(s, tick(s, now, by_).state, tick(s, now, by_).out))
  ensures (inv(s) ==> canTick(s, now, by_) ==> stepASavedVideoIsTheLast(s, tick(s, now, by_).state))
  ensures (inv(s) ==> canTick(s, now, by_) ==> stepTheShutterNeverFiresCovered(s, tick(s, now, by_).state, tick(s, now, by_).out))
  ensures (inv(s) ==> canTick(s, now, by_) ==> stepEachRequestIsAnsweredOnce(s, tick(s, now, by_).state, tick(s, now, by_).out))
  ensures (inv(s) ==> canTick(s, now, by_) ==> stepTheAgentFailsOnlyForCause(s, "tick", tick(s, now, by_).state))
{
  hide *;
  if inv(s) && canTick(s, now, by_) {
    var f := app__camera__recording_tick(s.film, now);
    assert tick(s, now, by_) == filming(f, now, s) by {
      reveal tick;
    }
    assert app__camera__recording_alwaysWithinLimits(f) && app__camera__recording_alwaysSavedIsWhole(f)
      && (app__camera__recording_recording(f) ==> recording(s))
      && (f.stage.Running? ==> holds(s)) by {
      reveal inv, canTick, alwaysRecordingHoldsThePreview, recording,
        app__camera__recording_canTick, app__camera__recording_tick,
        app__camera__recording_stopping, app__camera__recording_recording, app__camera__recording_opening,
        app__camera__recording_alwaysWithinLimits, app__camera__recording_alwaysSavedIsWhole,
        app__camera__recording_quotient_app__camera__recording, JSFloorDiv, MathAbs,
        app__camera__recording_second, app__camera__recording_maxSeconds;
    }
    FilmingPreserves(s, f, now, "tick");
  }
}

lemma chunk_ensures(s: Camera, piece: int, now: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> alwaysNoCameraWithoutAccess(chunk(s, piece, now, by_).state))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> alwaysNothingHeldAway(chunk(s, piece, now, by_).state))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> alwaysStartsAccounted(chunk(s, piece, now, by_).state))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> alwaysTorchBelongsToItsPreview(chunk(s, piece, now, by_).state))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> alwaysLensSettingsValid(chunk(s, piece, now, by_).state))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> alwaysFocusFollowsTheNewestTap(chunk(s, piece, now, by_).state))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> alwaysRecordingHoldsThePreview(chunk(s, piece, now, by_).state))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> alwaysOneShutterOnTheCamera(chunk(s, piece, now, by_).state))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> alwaysTheRequestWaitsOnTheCamera(chunk(s, piece, now, by_).state))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> stepALostPreviewFails(s, "chunk", chunk(s, piece, now, by_).state))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> stepARetiredPreviewIsReleased(s, "chunk", chunk(s, piece, now, by_).state, chunk(s, piece, now, by_).out))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> stepOneFocusWriteAtATime(s, "chunk", chunk(s, piece, now, by_).state, chunk(s, piece, now, by_).out))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> stepSoundOnlyWithTheMicrophone(s, chunk(s, piece, now, by_).state, chunk(s, piece, now, by_).out))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> stepASavedVideoIsTheLast(s, chunk(s, piece, now, by_).state))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> stepTheShutterNeverFiresCovered(s, chunk(s, piece, now, by_).state, chunk(s, piece, now, by_).out))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> stepEachRequestIsAnsweredOnce(s, chunk(s, piece, now, by_).state, chunk(s, piece, now, by_).out))
  ensures (inv(s) ==> canChunk(s, piece, by_) ==> stepTheAgentFailsOnlyForCause(s, "chunk", chunk(s, piece, now, by_).state))
{
  hide *;
  if inv(s) && canChunk(s, piece, by_) {
    var f := app__camera__recording_chunk(s.film, piece, now);
    assert chunk(s, piece, now, by_) == filming(f, now, s) by {
      reveal chunk;
    }
    assert app__camera__recording_alwaysWithinLimits(f) && app__camera__recording_alwaysSavedIsWhole(f)
      && (app__camera__recording_recording(f) ==> recording(s))
      && (f.stage.Running? ==> holds(s)) by {
      reveal inv, canChunk, alwaysRecordingHoldsThePreview, recording,
        app__camera__recording_canChunk, app__camera__recording_chunk,
        app__camera__recording_stopping, app__camera__recording_recording, app__camera__recording_opening,
        app__camera__recording_alwaysWithinLimits, app__camera__recording_alwaysSavedIsWhole;
    }
    FilmingPreserves(s, f, now, "chunk");
  }
}

lemma ChunkStepsAsRecordingSize(s: Camera, after: Done)
  ensures stepALostPreviewFails(s, "chunk", after.state) ==> stepALostPreviewFails(s, "recordingSize", after.state)
  ensures stepARetiredPreviewIsReleased(s, "chunk", after.state, after.out) ==> stepARetiredPreviewIsReleased(s, "recordingSize", after.state, after.out)
  ensures stepOneFocusWriteAtATime(s, "chunk", after.state, after.out) ==> stepOneFocusWriteAtATime(s, "recordingSize", after.state, after.out)
  ensures stepTheAgentFailsOnlyForCause(s, "chunk", after.state) ==> stepTheAgentFailsOnlyForCause(s, "recordingSize", after.state)
{
}

lemma recordingSize_ensures(s: Camera, total: int, now: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> alwaysNoCameraWithoutAccess(recordingSize(s, total, now, by_).state))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> alwaysNothingHeldAway(recordingSize(s, total, now, by_).state))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> alwaysStartsAccounted(recordingSize(s, total, now, by_).state))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> alwaysTorchBelongsToItsPreview(recordingSize(s, total, now, by_).state))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> alwaysLensSettingsValid(recordingSize(s, total, now, by_).state))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> alwaysFocusFollowsTheNewestTap(recordingSize(s, total, now, by_).state))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> alwaysRecordingHoldsThePreview(recordingSize(s, total, now, by_).state))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> alwaysOneShutterOnTheCamera(recordingSize(s, total, now, by_).state))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> alwaysTheRequestWaitsOnTheCamera(recordingSize(s, total, now, by_).state))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> stepALostPreviewFails(s, "recordingSize", recordingSize(s, total, now, by_).state))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> stepARetiredPreviewIsReleased(s, "recordingSize", recordingSize(s, total, now, by_).state, recordingSize(s, total, now, by_).out))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> stepOneFocusWriteAtATime(s, "recordingSize", recordingSize(s, total, now, by_).state, recordingSize(s, total, now, by_).out))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> stepSoundOnlyWithTheMicrophone(s, recordingSize(s, total, now, by_).state, recordingSize(s, total, now, by_).out))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> stepASavedVideoIsTheLast(s, recordingSize(s, total, now, by_).state))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> stepTheShutterNeverFiresCovered(s, recordingSize(s, total, now, by_).state, recordingSize(s, total, now, by_).out))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> stepEachRequestIsAnsweredOnce(s, recordingSize(s, total, now, by_).state, recordingSize(s, total, now, by_).out))
  ensures (inv(s) ==> canRecordingSize(s, total, by_) ==> stepTheAgentFailsOnlyForCause(s, "recordingSize", recordingSize(s, total, now, by_).state))
{
  hide *;
  reveal recordingSize, canRecordingSize, canChunk;
  chunk_ensures(s, total - s.film.bytes, now, by_);
  ChunkStepsAsRecordingSize(s, recordingSize(s, total, now, by_));
}

lemma agentLens_ensures(s: Camera, requested: RequestedLens, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> alwaysNoCameraWithoutAccess(agentLens(s, requested, by_).state))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> alwaysNothingHeldAway(agentLens(s, requested, by_).state))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> alwaysStartsAccounted(agentLens(s, requested, by_).state))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> alwaysTorchBelongsToItsPreview(agentLens(s, requested, by_).state))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> alwaysLensSettingsValid(agentLens(s, requested, by_).state))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> alwaysFocusFollowsTheNewestTap(agentLens(s, requested, by_).state))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> alwaysRecordingHoldsThePreview(agentLens(s, requested, by_).state))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> alwaysOneShutterOnTheCamera(agentLens(s, requested, by_).state))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> alwaysTheRequestWaitsOnTheCamera(agentLens(s, requested, by_).state))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> stepALostPreviewFails(s, "agentLens", agentLens(s, requested, by_).state))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> stepARetiredPreviewIsReleased(s, "agentLens", agentLens(s, requested, by_).state, agentLens(s, requested, by_).out))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> stepOneFocusWriteAtATime(s, "agentLens", agentLens(s, requested, by_).state, agentLens(s, requested, by_).out))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> stepSoundOnlyWithTheMicrophone(s, agentLens(s, requested, by_).state, agentLens(s, requested, by_).out))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> stepASavedVideoIsTheLast(s, agentLens(s, requested, by_).state))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> stepTheShutterNeverFiresCovered(s, agentLens(s, requested, by_).state, agentLens(s, requested, by_).out))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> stepEachRequestIsAnsweredOnce(s, agentLens(s, requested, by_).state, agentLens(s, requested, by_).out))
  ensures (inv(s) ==> canAgentLens(s, requested, by_) ==> stepTheAgentFailsOnlyForCause(s, "agentLens", agentLens(s, requested, by_).state))
{
  if inv(s) && canAgentLens(s, requested, by_) {
    var chosen := s.(requestedLens := requested);
    var lens := chosenLens(chosen);
    var switched := chosen.(lens := lens, zoom := oneTime, flash := false, flashAuto := false, torch := extinguished(s.torch));
    if lens != s.lens {
      if s.phase.Ready? {
        StartAccounted([StopPreview(s.preview)], switched);
      } else if s.phase.Starting? || mayStart(switched) {
        StartAccounted([], switched);
      }
    }
  }
}

lemma FilmPreviewAccounting(s: Camera, after: Camera)
  requires alwaysStartsAccounted(s)
  requires after.pending == s.pending && after.showing == s.showing
  requires (after.phase == s.phase && after.preview == s.preview) || (after.phase.Off? && after.preview == s.preview + 1)
  ensures alwaysStartsAccounted(after)
{
  assert forall t :: t in s.pending ==> t > 0 && t <= s.preview;
  if after.preview != s.preview {
    assert after.preview !in s.pending;
  }
}

lemma FilmSettlement(s: Camera, f: app__camera__recording_Film)
  ensures stepASavedVideoIsTheLast(s, settling(f, s))
  ensures settling(f, s).film == f
  ensures settling(f, s).phase == s.phase && settling(f, s).mode == s.mode
  ensures settling(f, s).pending == s.pending && settling(f, s).preview == s.preview
  ensures settling(f, s).showing == s.showing && settling(f, s).covered == s.covered
  ensures settling(f, s).agent == s.agent && settling(f, s).permission == s.permission
  ensures settling(f, s).visit == s.visit && settling(f, s).filmVisit == s.filmVisit
  ensures settling(f, s).shot == s.shot && settling(f, s).shots == s.shots && settling(f, s).shotFor == s.shotFor && settling(f, s).lens == s.lens
  ensures settling(f, s).torch == s.torch && settling(f, s).zoom == s.zoom && settling(f, s).flash == s.flash
  ensures settling(f, s).focus == s.focus && settling(f, s).taps == s.taps
  ensures settling(f, s).writing == s.writing && settling(f, s).confirmed == s.confirmed && settling(f, s).waited == s.waited
{

}

lemma FilmShape(s: Camera, f: app__camera__recording_Film, now: int)
  ensures var landed := settling(f, s);
    var prefix := if !s.film.stage.Stopping? && f.stage.Stopping? then [Effect.StopRecording]
      else if f.stage.Checking? && !s.film.stage.Checking? then [CheckRecording(f.video)] else [];
    filming(f, now, s) == afterRecording(prefix, landed)
      && (forall e :: e in prefix ==> !e.StopPreview?)
  ensures var landed := settling(f, s);
    var after := filming(f, now, s).state;
    after == (if landed.phase.Ready? && !holds(landed) && !recording(landed)
      then landed.(phase := Phase.Off, preview := landed.preview + 1, torch := extinguished(landed.torch))
      else landed)
  ensures forall e :: e in filming(f, now, s).out ==> e.StopRecording? || e.CheckRecording? || e.StopPreview?
{
}

lemma FilmReleased(s: Camera, f: app__camera__recording_Film, now: int, via: string)
  requires alwaysStartsAccounted(s)
  ensures alwaysStartsAccounted(filming(f, now, s).state)
  ensures stepARetiredPreviewIsReleased(s, via, filming(f, now, s).state, filming(f, now, s).out)
{
  FilmSettlement(s, f);
  FilmShape(s, f, now);
  var landed := settling(f, s);
  var after := filming(f, now, s);
  var prefix := if !s.film.stage.Stopping? && f.stage.Stopping? then [Effect.StopRecording]
    else if f.stage.Checking? && !s.film.stage.Checking? then [CheckRecording(f.video)] else [];
  FilmPreviewAccounting(s, after.state);
  if landed.phase.Ready? && !holds(landed) && !recording(landed) {
    assert s.phase.Ready? && s.preview > 0;
    assert after.out == prefix + [StopPreview(s.preview)];
  } else {
    assert after.out == prefix;
  }
}

lemma FilmKeepsAgent(s: Camera, f: app__camera__recording_Film, now: int)
  requires alwaysTheRequestWaitsOnTheCamera(s)
  ensures alwaysTheRequestWaitsOnTheCamera(filming(f, now, s).state)
{
  FilmSettlement(s, f);
  FilmShape(s, f, now);
  if s.agent.stage.Approved? {
    assert ready(s) && holds(settling(f, s));
    assert filming(f, now, s).state == settling(f, s);
  }
}

lemma FilmKeepsSession(s: Camera, f: app__camera__recording_Film, now: int, via: string)
  ensures stepASavedVideoIsTheLast(s, filming(f, now, s).state)
{
  FilmSettlement(s, f);
  FilmShape(s, f, now);
}

lemma FilmKeepsCameraSettings(s: Camera, f: app__camera__recording_Film, now: int)
  requires alwaysLensSettingsValid(s) && alwaysFocusFollowsTheNewestTap(s) && alwaysTorchBelongsToItsPreview(s)
  ensures alwaysLensSettingsValid(filming(f, now, s).state)
  ensures alwaysFocusFollowsTheNewestTap(filming(f, now, s).state)
  ensures alwaysTorchBelongsToItsPreview(filming(f, now, s).state)
{
  FilmSettlement(s, f);
  FilmShape(s, f, now);
}

lemma FilmKeepsRecording(s: Camera, f: app__camera__recording_Film, now: int)
  requires alwaysRecordingHoldsThePreview(s)
  requires app__camera__recording_alwaysWithinLimits(f) && app__camera__recording_alwaysSavedIsWhole(f)
  requires app__camera__recording_recording(f) ==> recording(s)
  requires f.stage.Running? ==> holds(s)
  ensures alwaysRecordingHoldsThePreview(filming(f, now, s).state)
{
  FilmSettlement(s, f);
  FilmShape(s, f, now);
  if app__camera__recording_recording(f) {
    assert filming(f, now, s).state == settling(f, s);
  }
}

lemma FilmKeepsRest(s: Camera, f: app__camera__recording_Film, now: int, via: string)
  requires alwaysNoCameraWithoutAccess(s) && alwaysNothingHeldAway(s) && alwaysOneShutterOnTheCamera(s)
  requires app__camera__recording_recording(f) ==> recording(s)
  requires via != "previewLost"
  ensures alwaysNoCameraWithoutAccess(filming(f, now, s).state)
  ensures alwaysNothingHeldAway(filming(f, now, s).state)
  ensures alwaysOneShutterOnTheCamera(filming(f, now, s).state)
  ensures stepALostPreviewFails(s, via, filming(f, now, s).state)
  ensures stepOneFocusWriteAtATime(s, via, filming(f, now, s).state, filming(f, now, s).out)
  ensures stepSoundOnlyWithTheMicrophone(s, filming(f, now, s).state, filming(f, now, s).out)
  ensures stepTheShutterNeverFiresCovered(s, filming(f, now, s).state, filming(f, now, s).out)
  ensures stepEachRequestIsAnsweredOnce(s, filming(f, now, s).state, filming(f, now, s).out)
  ensures stepTheAgentFailsOnlyForCause(s, via, filming(f, now, s).state)
{
  hide *;
  FilmSettlement(s, f);
  FilmShape(s, f, now);
  reveal holds, recording,
    alwaysNoCameraWithoutAccess, alwaysNothingHeldAway, alwaysOneShutterOnTheCamera,
    app__camera__agent_alwaysResultsAreHonest,
    stepALostPreviewFails, stepOneFocusWriteAtATime, stepSoundOnlyWithTheMicrophone,
    stepTheShutterNeverFiresCovered, stepEachRequestIsAnsweredOnce,
    stepTheAgentFailsOnlyForCause;
}

lemma FilmingPreserves(s: Camera, f: app__camera__recording_Film, now: int, via: string)
  requires inv(s)
  requires app__camera__recording_alwaysWithinLimits(f) && app__camera__recording_alwaysSavedIsWhole(f)
  requires app__camera__recording_recording(f) ==> recording(s)
  requires f.stage.Running? ==> holds(s)
  requires via != "previewLost"
  ensures alwaysNoCameraWithoutAccess(filming(f, now, s).state)
  ensures alwaysNothingHeldAway(filming(f, now, s).state)
  ensures alwaysStartsAccounted(filming(f, now, s).state)
  ensures alwaysTorchBelongsToItsPreview(filming(f, now, s).state)
  ensures alwaysLensSettingsValid(filming(f, now, s).state)
  ensures alwaysFocusFollowsTheNewestTap(filming(f, now, s).state)
  ensures alwaysRecordingHoldsThePreview(filming(f, now, s).state)
  ensures alwaysOneShutterOnTheCamera(filming(f, now, s).state)
  ensures alwaysTheRequestWaitsOnTheCamera(filming(f, now, s).state)
  ensures stepALostPreviewFails(s, via, filming(f, now, s).state)
  ensures stepARetiredPreviewIsReleased(s, via, filming(f, now, s).state, filming(f, now, s).out)
  ensures stepOneFocusWriteAtATime(s, via, filming(f, now, s).state, filming(f, now, s).out)
  ensures stepSoundOnlyWithTheMicrophone(s, filming(f, now, s).state, filming(f, now, s).out)
  ensures stepASavedVideoIsTheLast(s, filming(f, now, s).state)
  ensures stepTheShutterNeverFiresCovered(s, filming(f, now, s).state, filming(f, now, s).out)
  ensures stepEachRequestIsAnsweredOnce(s, filming(f, now, s).state, filming(f, now, s).out)
  ensures stepTheAgentFailsOnlyForCause(s, via, filming(f, now, s).state)
{
  hide *;
  reveal inv;
  FilmReleased(s, f, now, via);
  FilmKeepsAgent(s, f, now);
  FilmKeepsSession(s, f, now, via);
  FilmKeepsCameraSettings(s, f, now);
  FilmKeepsRecording(s, f, now);
  FilmKeepsRest(s, f, now, via);
}

lemma recordingStarted_ensures(s: Camera, ok: bool, now: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> alwaysNoCameraWithoutAccess(recordingStarted(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> alwaysNothingHeldAway(recordingStarted(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> alwaysStartsAccounted(recordingStarted(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> alwaysTorchBelongsToItsPreview(recordingStarted(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> alwaysLensSettingsValid(recordingStarted(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> alwaysFocusFollowsTheNewestTap(recordingStarted(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> alwaysRecordingHoldsThePreview(recordingStarted(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> alwaysOneShutterOnTheCamera(recordingStarted(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> alwaysTheRequestWaitsOnTheCamera(recordingStarted(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> stepALostPreviewFails(s, "recordingStarted", recordingStarted(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> stepARetiredPreviewIsReleased(s, "recordingStarted", recordingStarted(s, ok, now, by_).state, recordingStarted(s, ok, now, by_).out))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> stepOneFocusWriteAtATime(s, "recordingStarted", recordingStarted(s, ok, now, by_).state, recordingStarted(s, ok, now, by_).out))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> stepSoundOnlyWithTheMicrophone(s, recordingStarted(s, ok, now, by_).state, recordingStarted(s, ok, now, by_).out))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> stepASavedVideoIsTheLast(s, recordingStarted(s, ok, now, by_).state))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> stepTheShutterNeverFiresCovered(s, recordingStarted(s, ok, now, by_).state, recordingStarted(s, ok, now, by_).out))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> stepEachRequestIsAnsweredOnce(s, recordingStarted(s, ok, now, by_).state, recordingStarted(s, ok, now, by_).out))
  ensures (inv(s) ==> canRecordingStarted(s, by_) ==> stepTheAgentFailsOnlyForCause(s, "recordingStarted", recordingStarted(s, ok, now, by_).state))
{
  hide *;
  if inv(s) && canRecordingStarted(s, by_) {
    var begun := app__camera__recording_started(s.film, ok, now);
    var held := if begun.stage.Running? && !holds(s) then app__camera__recording_stop(begun, now) else begun;
    assert recordingStarted(s, ok, now, by_) == filming(held, now, s) by {
      reveal recordingStarted;
    }
    assert app__camera__recording_alwaysWithinLimits(held) && app__camera__recording_alwaysSavedIsWhole(held)
      && (app__camera__recording_recording(held) ==> recording(s))
      && (held.stage.Running? ==> holds(s)) by {
      reveal inv, canRecordingStarted, alwaysRecordingHoldsThePreview, recording,
        app__camera__recording_canStarted, app__camera__recording_started,
        app__camera__recording_stop, app__camera__recording_stopping,
        app__camera__recording_recording, app__camera__recording_opening,
        app__camera__recording_alwaysWithinLimits, app__camera__recording_alwaysSavedIsWhole,
        app__camera__recording_maxBytes, app__camera__recording_maxSeconds;
    }
    FilmingPreserves(s, held, now, "recordingStarted");
  }
}

lemma stopRecording_ensures(s: Camera, now: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canStopRecording(s, by_) ==> alwaysNoCameraWithoutAccess(stopRecording(s, now, by_).state))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> alwaysNothingHeldAway(stopRecording(s, now, by_).state))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> alwaysStartsAccounted(stopRecording(s, now, by_).state))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> alwaysTorchBelongsToItsPreview(stopRecording(s, now, by_).state))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> alwaysLensSettingsValid(stopRecording(s, now, by_).state))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> alwaysFocusFollowsTheNewestTap(stopRecording(s, now, by_).state))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> alwaysRecordingHoldsThePreview(stopRecording(s, now, by_).state))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> alwaysOneShutterOnTheCamera(stopRecording(s, now, by_).state))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> alwaysTheRequestWaitsOnTheCamera(stopRecording(s, now, by_).state))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> stepALostPreviewFails(s, "stopRecording", stopRecording(s, now, by_).state))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> stepARetiredPreviewIsReleased(s, "stopRecording", stopRecording(s, now, by_).state, stopRecording(s, now, by_).out))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> stepOneFocusWriteAtATime(s, "stopRecording", stopRecording(s, now, by_).state, stopRecording(s, now, by_).out))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> stepSoundOnlyWithTheMicrophone(s, stopRecording(s, now, by_).state, stopRecording(s, now, by_).out))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> stepASavedVideoIsTheLast(s, stopRecording(s, now, by_).state))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> stepTheShutterNeverFiresCovered(s, stopRecording(s, now, by_).state, stopRecording(s, now, by_).out))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> stepEachRequestIsAnsweredOnce(s, stopRecording(s, now, by_).state, stopRecording(s, now, by_).out))
  ensures (inv(s) ==> canStopRecording(s, by_) ==> stepTheAgentFailsOnlyForCause(s, "stopRecording", stopRecording(s, now, by_).state))
{
  hide *;
  if inv(s) && canStopRecording(s, by_) {
    var stopped := app__camera__recording_stop(s.film, now);
    assert stopRecording(s, now, by_) == filming(stopped, now, s) by {
      reveal stopRecording;
    }
    assert app__camera__recording_alwaysWithinLimits(stopped) && app__camera__recording_alwaysSavedIsWhole(stopped)
      && (app__camera__recording_recording(stopped) ==> recording(s))
      && !stopped.stage.Running? by {
      reveal inv, canStopRecording, alwaysRecordingHoldsThePreview, recording,
        app__camera__recording_canStop, app__camera__recording_stop,
        app__camera__recording_stopping, app__camera__recording_recording, app__camera__recording_opening,
        app__camera__recording_alwaysWithinLimits, app__camera__recording_alwaysSavedIsWhole;
    }
    FilmingPreserves(s, stopped, now, "stopRecording");
  }
}

lemma recordingInterrupted_ensures(s: Camera, now: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> alwaysNoCameraWithoutAccess(recordingInterrupted(s, now, by_).state))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> alwaysNothingHeldAway(recordingInterrupted(s, now, by_).state))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> alwaysStartsAccounted(recordingInterrupted(s, now, by_).state))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> alwaysTorchBelongsToItsPreview(recordingInterrupted(s, now, by_).state))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> alwaysLensSettingsValid(recordingInterrupted(s, now, by_).state))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> alwaysFocusFollowsTheNewestTap(recordingInterrupted(s, now, by_).state))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> alwaysRecordingHoldsThePreview(recordingInterrupted(s, now, by_).state))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> alwaysOneShutterOnTheCamera(recordingInterrupted(s, now, by_).state))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> alwaysTheRequestWaitsOnTheCamera(recordingInterrupted(s, now, by_).state))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> stepALostPreviewFails(s, "recordingInterrupted", recordingInterrupted(s, now, by_).state))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> stepARetiredPreviewIsReleased(s, "recordingInterrupted", recordingInterrupted(s, now, by_).state, recordingInterrupted(s, now, by_).out))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> stepOneFocusWriteAtATime(s, "recordingInterrupted", recordingInterrupted(s, now, by_).state, recordingInterrupted(s, now, by_).out))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> stepSoundOnlyWithTheMicrophone(s, recordingInterrupted(s, now, by_).state, recordingInterrupted(s, now, by_).out))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> stepASavedVideoIsTheLast(s, recordingInterrupted(s, now, by_).state))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> stepTheShutterNeverFiresCovered(s, recordingInterrupted(s, now, by_).state, recordingInterrupted(s, now, by_).out))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> stepEachRequestIsAnsweredOnce(s, recordingInterrupted(s, now, by_).state, recordingInterrupted(s, now, by_).out))
  ensures (inv(s) ==> canRecordingInterrupted(s, by_) ==> stepTheAgentFailsOnlyForCause(s, "recordingInterrupted", recordingInterrupted(s, now, by_).state))
{
  hide *;
  if inv(s) && canRecordingInterrupted(s, by_) {
    var stopped := app__camera__recording_interrupted(s.film, now);
    assert recordingInterrupted(s, now, by_) == filming(stopped, now, s) by {
      reveal recordingInterrupted;
    }
    assert app__camera__recording_alwaysWithinLimits(stopped) && app__camera__recording_alwaysSavedIsWhole(stopped)
      && (app__camera__recording_recording(stopped) ==> recording(s))
      && !stopped.stage.Running? by {
      reveal inv, canRecordingInterrupted, alwaysRecordingHoldsThePreview, recording,
        app__camera__recording_canInterrupted, app__camera__recording_interrupted,
        app__camera__recording_stopping, app__camera__recording_recording, app__camera__recording_opening,
        app__camera__recording_alwaysWithinLimits, app__camera__recording_alwaysSavedIsWhole;
    }
    FilmingPreserves(s, stopped, now, "recordingInterrupted");
  }
}

lemma stopTimedOut_ensures(s: Camera, now: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> alwaysNoCameraWithoutAccess(stopTimedOut(s, now, by_).state))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> alwaysNothingHeldAway(stopTimedOut(s, now, by_).state))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> alwaysStartsAccounted(stopTimedOut(s, now, by_).state))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> alwaysTorchBelongsToItsPreview(stopTimedOut(s, now, by_).state))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> alwaysLensSettingsValid(stopTimedOut(s, now, by_).state))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> alwaysFocusFollowsTheNewestTap(stopTimedOut(s, now, by_).state))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> alwaysRecordingHoldsThePreview(stopTimedOut(s, now, by_).state))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> alwaysOneShutterOnTheCamera(stopTimedOut(s, now, by_).state))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> alwaysTheRequestWaitsOnTheCamera(stopTimedOut(s, now, by_).state))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> stepALostPreviewFails(s, "stopTimedOut", stopTimedOut(s, now, by_).state))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> stepARetiredPreviewIsReleased(s, "stopTimedOut", stopTimedOut(s, now, by_).state, stopTimedOut(s, now, by_).out))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> stepOneFocusWriteAtATime(s, "stopTimedOut", stopTimedOut(s, now, by_).state, stopTimedOut(s, now, by_).out))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> stepSoundOnlyWithTheMicrophone(s, stopTimedOut(s, now, by_).state, stopTimedOut(s, now, by_).out))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> stepASavedVideoIsTheLast(s, stopTimedOut(s, now, by_).state))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> stepTheShutterNeverFiresCovered(s, stopTimedOut(s, now, by_).state, stopTimedOut(s, now, by_).out))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> stepEachRequestIsAnsweredOnce(s, stopTimedOut(s, now, by_).state, stopTimedOut(s, now, by_).out))
  ensures (inv(s) ==> canStopTimedOut(s, now, by_) ==> stepTheAgentFailsOnlyForCause(s, "stopTimedOut", stopTimedOut(s, now, by_).state))
{
  hide *;
  if inv(s) && canStopTimedOut(s, now, by_) {
    var ended := app__camera__recording_timedOut(s.film, now);
    assert stopTimedOut(s, now, by_) == filming(ended, now, s) by {
      reveal stopTimedOut;
    }
    assert !app__camera__recording_recording(ended) && !ended.stage.Running?
      && app__camera__recording_alwaysWithinLimits(ended) && app__camera__recording_alwaysSavedIsWhole(ended) by {
      reveal inv, canStopTimedOut, alwaysRecordingHoldsThePreview,
        app__camera__recording_canTimedOut, app__camera__recording_timedOut,
        app__camera__recording_recording, app__camera__recording_opening,
        app__camera__recording_alwaysWithinLimits, app__camera__recording_alwaysSavedIsWhole;
    }
    FilmingPreserves(s, ended, now, "stopTimedOut");
  }
}
