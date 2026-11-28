lemma ScaleKeepsOrder(hi: int, lo: int, scale: int)
  requires hi >= lo >= 0 && scale >= 0
  ensures hi * scale >= lo * scale >= 0
  ensures JSFloorDiv(hi * scale, 100) >= JSFloorDiv(lo * scale, 100)
{
  assert (hi - lo) * scale >= 0;
  assert hi * scale - lo * scale == (hi - lo) * scale;
}

lemma lawUndoStaysLonger_ensures(chars: int, scale: int)
  ensures (lawUndoStaysLonger(chars, scale) == true)
{
  if scale >= 100 {
    var reading := (chars * 50) + 500;
    var capped := if reading > 12000 then 12000 else reading;
    var hi := if capped > 10000 then capped else 10000;
    var lo := if capped > 1900 then capped else 1900;
    ScaleKeepsOrder(hi, lo, scale);
    ScaleKeepsOrder(hi, 10000, scale);
    ScaleKeepsOrder(scale, 100, 10000);
    assert duration(chars, true, scale) == quotient_app__notices__toasts(hi * scale, 100);
    assert duration(chars, false, scale) == quotient_app__notices__toasts(lo * scale, 100);
    assert JSFloorDiv(1000000, 100) == 10000;
  }
}

lemma RetractKeepsTheRest(s: Toasts, area: string, about: int)
  ensures !(s.showing && offers(s.current, area, about)) ==> retract(s, area, about) == s.(undos := ProofLib.Filter((t: Toast) => !(offers(t, area, about)), s.undos))
{
}

lemma retract_ensures(s: Toasts, area: string, about: int)
  ensures (inv(s) ==> canRetract(s, area, about) ==> alwaysTheScaleNeverShortens(retract(s, area, about)))
  ensures (inv(s) ==> canRetract(s, area, about) ==> alwaysAToastStaysItsTime(retract(s, area, about)))
  ensures (inv(s) ==> canRetract(s, area, about) ==> alwaysOnlyBehindAnUndoToastsWait(retract(s, area, about)))
  ensures (inv(s) ==> canRetract(s, area, about) ==> alwaysToastsAreNumbered(retract(s, area, about)))
  ensures (inv(s) ==> canRetract(s, area, about) ==> alwaysAToastIsShownOnTop(retract(s, area, about)))
  ensures (inv(s) ==> canRetract(s, area, about) ==> alwaysFewNoticesAreKept(retract(s, area, about)))
  ensures (inv(s) ==> canRetract(s, area, about) ==> stepAToastGoesOnlyInItsTime(s, "retract", retract(s, area, about)))
  ensures (inv(s) ==> canRetract(s, area, about) ==> stepNoToastIsRefused(s, "retract", retract(s, area, about)))
  ensures (inv(s) ==> canRetract(s, area, about) ==> stepAnUndoIsNeverPushedAside(s, "retract", retract(s, area, about)))
  ensures (inv(s) ==> canRetract(s, area, about) ==> stepUndoIsPassedOnOnce(s, "retract", retract(s, area, about), []))
  ensures (inv(s) ==> canRetract(s, area, about) ==> stepAKeptNoticeLeavesOnlyWhenDismissedOrPushedOut(s, "retract", retract(s, area, about)))
{
  if inv(s) && canRetract(s, area, about) && !(s.showing && offers(s.current, area, about)) {
    RetractKeepsTheRest(s, area, about);
    var p := (t: Toast) => !(offers(t, area, about));
    var after := retract(s, area, about);
    assert after.undos == ProofLib.Filter(p, s.undos);
    forall t | t in after.undos ensures t in s.undos {
      ProofLib.FilterMember(p, s.undos, t);
    }
    if |s.undos| == 0 {
      ProofLib.FilterNil(p, s.undos);
    }
  }
}

lemma FilterNeverGrows<T>(p: T -> bool, xs: seq<T>)
  ensures |ProofLib.Filter(p, xs)| <= |xs|
{
  if |xs| > 0 {
    FilterNeverGrows(p, xs[1..]);
  }
}

lemma dismiss_ensures(s: Toasts, area: string, about: int)
  ensures (inv(s) ==> canDismiss(s, area, about) ==> alwaysTheScaleNeverShortens(dismiss(s, area, about)))
  ensures (inv(s) ==> canDismiss(s, area, about) ==> alwaysAToastStaysItsTime(dismiss(s, area, about)))
  ensures (inv(s) ==> canDismiss(s, area, about) ==> alwaysOnlyBehindAnUndoToastsWait(dismiss(s, area, about)))
  ensures (inv(s) ==> canDismiss(s, area, about) ==> alwaysToastsAreNumbered(dismiss(s, area, about)))
  ensures (inv(s) ==> canDismiss(s, area, about) ==> alwaysAToastIsShownOnTop(dismiss(s, area, about)))
  ensures (inv(s) ==> canDismiss(s, area, about) ==> alwaysFewNoticesAreKept(dismiss(s, area, about)))
  ensures (inv(s) ==> canDismiss(s, area, about) ==> stepAToastGoesOnlyInItsTime(s, "dismiss", dismiss(s, area, about)))
  ensures (inv(s) ==> canDismiss(s, area, about) ==> stepNoToastIsRefused(s, "dismiss", dismiss(s, area, about)))
  ensures (inv(s) ==> canDismiss(s, area, about) ==> stepAnUndoIsNeverPushedAside(s, "dismiss", dismiss(s, area, about)))
  ensures (inv(s) ==> canDismiss(s, area, about) ==> stepUndoIsPassedOnOnce(s, "dismiss", dismiss(s, area, about), []))
  ensures (inv(s) ==> canDismiss(s, area, about) ==> stepAKeptNoticeLeavesOnlyWhenDismissedOrPushedOut(s, "dismiss", dismiss(s, area, about)))
{
  if inv(s) && canDismiss(s, area, about) {
    var target := Kept(area := area, about := about);
    var p := (k: Kept) => (k != target);
    var after := dismiss(s, area, about);
    assert after.kept == ProofLib.Filter(p, s.kept);
    FilterNeverGrows(p, s.kept);
    forall k | k in after.kept ensures k in s.kept {
      ProofLib.FilterMember(p, s.kept, k);
    }
  }
}

lemma lawExtendedTimeoutsStayLonger_ensures(chars: int, undo: bool, scale: int)
  ensures (lawExtendedTimeoutsStayLonger(chars, undo, scale) == true)
{
  if scale >= 100 {
    var base := if undo then 10000 else 1900;
    var reading := (chars * 50) + 500;
    var capped := if reading > 12000 then 12000 else reading;
    var longest := if capped > base then capped else base;
    ScaleKeepsOrder(scale, 100, longest);
    assert longest * scale == scale * longest;
    assert duration(chars, undo, scale) == quotient_app__notices__toasts(longest * scale, 100);
    assert duration(chars, undo, 100) == quotient_app__notices__toasts(longest * 100, 100);
    assert JSFloorDiv(100 * longest, 100) == longest;
  }
}
