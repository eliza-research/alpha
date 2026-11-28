// spec/app/control/index.md, "The kill-switch halts immediately, and every dispatched effect honors exact live snapshot, lease, and screen safety"
lemma killSwitch_ensures(c: ControlState, by_: Actor)
  ensures (inv(c) ==> canKillSwitch(c, by_) ==> alwaysNoActionOnProtectedScreen(killSwitch(c, by_).state))
  ensures (inv(c) ==> canKillSwitch(c, by_) ==> alwaysBlockedPackagesProtected(killSwitch(c, by_).state))
  ensures (inv(c) ==> canKillSwitch(c, by_) ==> alwaysNoStaleSnapshotActuation(killSwitch(c, by_).state))
  ensures (inv(c) ==> canKillSwitch(c, by_) ==> alwaysLeaseBounded(killSwitch(c, by_).state))
  ensures (inv(c) ==> canKillSwitch(c, by_) ==> stepKillSwitchHaltsImmediately(c, "killSwitch", killSwitch(c, by_).state, killSwitch(c, by_).out))
{
  if inv(c) && canKillSwitch(c, by_) {
    var m := killSwitch(c, by_);
    assert m.out[0] in m.out;
  }
}
