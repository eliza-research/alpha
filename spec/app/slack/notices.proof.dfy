lemma RemovedViews(s: Notices, workspace: int)
  ensures workspaceRemoved(s, workspace).state.connected == ProofLib.Filter((set_x: int) => !((set_x in [workspace])), s.connected)
  ensures workspaceRemoved(s, workspace).state.up == ProofLib.Filter((p: Posted) => (p.target.workspace != workspace), s.up)
{
}

lemma PolledUpView(s: Notices, ticket: int, ok: bool, point: int, incoming: Incoming)
  requires s.notifyAllowed && ok && sinceOf(s.checkingWorkspace, s.watermarks) != 0 && incoming.channel > 0 && incoming.ts > 0
  requires shouldNotify(incoming.isOwn, incoming.channel in s.mutedChannels, s.front, Target(s.checkingWorkspace, incoming.channel, incoming.threadTs), incoming.kind, incoming.mentioned, incoming.inThread)
  ensures polled(s, ticket, ok, point, incoming).state.up == (ProofLib.Filter((p: Posted) => (p.target != Target(s.checkingWorkspace, incoming.channel, incoming.threadTs)), s.up) + [Posted(Target(s.checkingWorkspace, incoming.channel, incoming.threadTs), incoming.ts)])
{
}

lemma FrontUpView(s: Notices, workspace: int, channel: int, threadTs: int)
  ensures frontChanged(s, workspace, channel, threadTs).state.up == ProofLib.Filter((p: Posted) => (p.target != Target(workspace, channel, threadTs)), s.up)
{
}

lemma workspaceRemoved_ensures(s: Notices, workspace: int)
  ensures (inv(s) ==> canWorkspaceRemoved(s, workspace) ==> alwaysNoticesIsolated(workspaceRemoved(s, workspace).state))
  ensures (inv(s) ==> canWorkspaceRemoved(s, workspace) ==> stepNoNoticeBeforeBaseline(s, "workspaceRemoved", workspaceRemoved(s, workspace).state, workspaceRemoved(s, workspace).out))
  ensures (inv(s) ==> canWorkspaceRemoved(s, workspace) ==> stepWorkspaceRevokeWithdrawsOnlyThatWorkspace(s, "workspaceRemoved", workspaceRemoved(s, workspace).state, workspaceRemoved(s, workspace).out))
  ensures (inv(s) ==> canWorkspaceRemoved(s, workspace) ==> stepReadingWithdrawsNotices(s, "workspaceRemoved", workspaceRemoved(s, workspace).state, workspaceRemoved(s, workspace).out))
{
  if inv(s) && canWorkspaceRemoved(s, workspace) {
    var moved := workspaceRemoved(s, workspace);
    var after := moved.state;
    RemovedViews(s, workspace);
    ProofLib.FilterMember((set_x: int) => !((set_x in [workspace])), s.connected, workspace);
    if after.checkingWorkspace > 0 {
      ProofLib.FilterMember((set_x: int) => !((set_x in [workspace])), s.connected, after.checkingWorkspace);
    }
    if after.front != noTarget {
      ProofLib.FilterMember((set_x: int) => !((set_x in [workspace])), s.connected, after.front.workspace);
    }
    forall p | p in after.up ensures p in s.up && watching(after, p.target.workspace) && p.target.channel > 0 && p.ts > 0 && p.target != after.front {
      ProofLib.FilterMember((p: Posted) => (p.target.workspace != workspace), s.up, p);
      ProofLib.FilterMember((set_x: int) => !((set_x in [workspace])), s.connected, p.target.workspace);
    }
    assert moved.out[0] in moved.out && moved.out[1] in moved.out;
  }
}

lemma polled_ensures(s: Notices, ticket: int, ok: bool, point: int, incoming: Incoming)
  ensures (inv(s) ==> canPolled(s, ticket, ok, point, incoming) ==> alwaysNoticesIsolated(polled(s, ticket, ok, point, incoming).state))
  ensures (inv(s) ==> canPolled(s, ticket, ok, point, incoming) ==> stepNoNoticeBeforeBaseline(s, "polled", polled(s, ticket, ok, point, incoming).state, polled(s, ticket, ok, point, incoming).out))
  ensures (inv(s) ==> canPolled(s, ticket, ok, point, incoming) ==> stepWorkspaceRevokeWithdrawsOnlyThatWorkspace(s, "polled", polled(s, ticket, ok, point, incoming).state, polled(s, ticket, ok, point, incoming).out))
  ensures (inv(s) ==> canPolled(s, ticket, ok, point, incoming) ==> stepReadingWithdrawsNotices(s, "polled", polled(s, ticket, ok, point, incoming).state, polled(s, ticket, ok, point, incoming).out))
{
  if inv(s) && canPolled(s, ticket, ok, point, incoming) {
    var target := Target(s.checkingWorkspace, incoming.channel, incoming.threadTs);
    if s.notifyAllowed && ok && sinceOf(s.checkingWorkspace, s.watermarks) != 0 && incoming.channel > 0 && incoming.ts > 0 && shouldNotify(incoming.isOwn, incoming.channel in s.mutedChannels, s.front, target, incoming.kind, incoming.mentioned, incoming.inThread) {
      PolledUpView(s, ticket, ok, point, incoming);
      var filtered := ProofLib.Filter((p: Posted) => (p.target != target), s.up);
      forall p | p in filtered ensures p in s.up {
        ProofLib.FilterMember((p: Posted) => (p.target != target), s.up, p);
      }
    }
  }
}

lemma frontChanged_ensures(s: Notices, workspace: int, channel: int, threadTs: int)
  ensures (inv(s) ==> canFrontChanged(s, workspace, channel, threadTs) ==> alwaysNoticesIsolated(frontChanged(s, workspace, channel, threadTs).state))
  ensures (inv(s) ==> canFrontChanged(s, workspace, channel, threadTs) ==> stepNoNoticeBeforeBaseline(s, "frontChanged", frontChanged(s, workspace, channel, threadTs).state, frontChanged(s, workspace, channel, threadTs).out))
  ensures (inv(s) ==> canFrontChanged(s, workspace, channel, threadTs) ==> stepWorkspaceRevokeWithdrawsOnlyThatWorkspace(s, "frontChanged", frontChanged(s, workspace, channel, threadTs).state, frontChanged(s, workspace, channel, threadTs).out))
  ensures (inv(s) ==> canFrontChanged(s, workspace, channel, threadTs) ==> stepReadingWithdrawsNotices(s, "frontChanged", frontChanged(s, workspace, channel, threadTs).state, frontChanged(s, workspace, channel, threadTs).out))
{
  if inv(s) && canFrontChanged(s, workspace, channel, threadTs) {
    var target := Target(workspace, channel, threadTs);
    FrontUpView(s, workspace, channel, threadTs);
    var after := frontChanged(s, workspace, channel, threadTs).state;
    forall p | p in after.up ensures p in s.up && p.target != target {
      ProofLib.FilterMember((p: Posted) => (p.target != target), s.up, p);
    }
  }
}
