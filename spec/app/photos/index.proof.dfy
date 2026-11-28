// spec/app/photos/index.md: sending a run's request takes items still to send; losing access
// asks the shell to close what shows the library; an answer lists only what the phone may show
// and pages on with older items; toggling keeps the selection within what is listed.

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

lemma Kept(xs: seq<int>, ys: seq<int>)
  ensures forall x :: x in ProofLib.Filter((set_x: int) => (set_x in ys), xs) <==> (x in xs && x in ys)
{
  forall x
    ensures x in ProofLib.Filter((set_x: int) => (set_x in ys), xs) <==> (x in xs && x in ys)
  {
    ProofLib.FilterMember((set_x: int) => (set_x in ys), xs, x);
  }
}

lemma SentBatch(r: app__photos__changes_Run, items: seq<int>)
  requires app__photos__changes_alwaysDecidedByTheOwner(r) && app__photos__changes_alwaysOneRequestAtATime(r) && app__photos__changes_alwaysUndoFollowsADeletion(r)
  requires app__photos__changes_canSend(r, items)
  ensures app__photos__changes_running(r) && r.by_.Owner?
  ensures forall x :: x in items ==> x in r.left
  ensures app__photos__changes_alwaysDecidedByTheOwner(app__photos__changes_send(r, items))
  ensures app__photos__changes_alwaysOneRequestAtATime(app__photos__changes_send(r, items))
  ensures app__photos__changes_alwaysUndoFollowsADeletion(app__photos__changes_send(r, items))
{
  assert !((exists set_x :: set_x in items && !((set_x in r.left))));
  assert items[0] in items;
  assert items[0] in r.left;
  assert |r.left| > 0;
  var after := app__photos__changes_send(r, items);
  assert after.left == ProofLib.Filter((set_x: int) => !((set_x in items)), r.left);
  if r.change.Share? {
    forall x | x in r.left ensures x in items {
      if x !in items {
        assert x in r.left && !(x in items);
      }
    }
    ProofLib.FilterNone((set_x: int) => !((set_x in items)), r.left);
    assert |after.left| == 0;
  }
}

lemma sendNext_ensures(s: Photos, items: seq<int>, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canSendNext(s, items, by_) ==> alwaysVideosNeedTheirAccess(sendNext(s, items, by_).state))
  ensures (inv(s) ==> canSendNext(s, items, by_) ==> alwaysOnlyOwnWithoutAccess(sendNext(s, items, by_).state))
  ensures (inv(s) ==> canSendNext(s, items, by_) ==> alwaysTheAlbumShowingIsListed(sendNext(s, items, by_).state))
  ensures (inv(s) ==> canSendNext(s, items, by_) ==> alwaysNothingShownWhileHidden(sendNext(s, items, by_).state))
  ensures (inv(s) ==> canSendNext(s, items, by_) ==> alwaysTheLockScreenListsOnlyItsSession(sendNext(s, items, by_).state))
  ensures (inv(s) ==> canSendNext(s, items, by_) ==> alwaysSelectionIsListed(sendNext(s, items, by_).state))
  ensures (inv(s) ==> canSendNext(s, items, by_) ==> alwaysRunsAreTheOwners(sendNext(s, items, by_).state))
  ensures (inv(s) ==> canSendNext(s, items, by_) ==> alwaysDialogNamesItsSubject(sendNext(s, items, by_).state))
  ensures (inv(s) ==> canSendNext(s, items, by_) ==> stepLosingAccessClosesWhatShowsTheLibrary(s, "sendNext", sendNext(s, items, by_).state, sendNext(s, items, by_).out))
  ensures (inv(s) ==> canSendNext(s, items, by_) ==> stepNothingChangesWithoutAccess(s, sendNext(s, items, by_).state, sendNext(s, items, by_).out))
  ensures (inv(s) ==> canSendNext(s, items, by_) ==> stepAPageKeepsWhatWasListed(s, "sendNext", sendNext(s, items, by_).state))
  ensures (inv(s) ==> canSendNext(s, items, by_) ==> stepChangesAreTheOwners(s, "sendNext", sendNext(s, items, by_).state, sendNext(s, items, by_).out))
  ensures (inv(s) ==> canSendNext(s, items, by_) ==> stepAFavouriteToggles(s, "sendNext", sendNext(s, items, by_).state))
  ensures (inv(s) ==> canSendNext(s, items, by_) ==> stepAlbumChangesCarryTheSelection(s, "sendNext", sendNext(s, items, by_).state, sendNext(s, items, by_).out))

{
  if inv(s) && canSendNext(s, items, by_) {
    SentBatch(s.job, items);
  }
}

lemma AccessRevoked(s: Photos, grant: kit__permission_Grant, videos: bool, by_: app__photos__actor_Actor)
  requires inv(s) && canAccessIs(s, by_)
  requires !kit__permission_allows(kit__permission_observe(s.access, grant))
  ensures alwaysVideosNeedTheirAccess(accessIs(s, grant, videos, by_).state)
  ensures alwaysOnlyOwnWithoutAccess(accessIs(s, grant, videos, by_).state)
  ensures alwaysTheAlbumShowingIsListed(accessIs(s, grant, videos, by_).state)
  ensures alwaysNothingShownWhileHidden(accessIs(s, grant, videos, by_).state)
  ensures alwaysTheLockScreenListsOnlyItsSession(accessIs(s, grant, videos, by_).state)
  ensures alwaysSelectionIsListed(accessIs(s, grant, videos, by_).state)
  ensures alwaysRunsAreTheOwners(accessIs(s, grant, videos, by_).state)
  ensures alwaysDialogNamesItsSubject(accessIs(s, grant, videos, by_).state)
  ensures stepLosingAccessClosesWhatShowsTheLibrary(s, "accessIs", accessIs(s, grant, videos, by_).state, accessIs(s, grant, videos, by_).out)
  ensures stepNothingChangesWithoutAccess(s, accessIs(s, grant, videos, by_).state, accessIs(s, grant, videos, by_).out)
  ensures stepAPageKeepsWhatWasListed(s, "accessIs", accessIs(s, grant, videos, by_).state)
  ensures stepChangesAreTheOwners(s, "accessIs", accessIs(s, grant, videos, by_).state, accessIs(s, grant, videos, by_).out)
  ensures stepAFavouriteToggles(s, "accessIs", accessIs(s, grant, videos, by_).state)
  ensures stepAlbumChangesCarryTheSelection(s, "accessIs", accessIs(s, grant, videos, by_).state, accessIs(s, grant, videos, by_).out)
{
  app__photos__changes_cancel_ensures(s.job);
  app__photos__albums_closeDialog_ensures(s.shelf);
  var d := accessIs(s, grant, videos, by_);
  assert d.out[0].Revoke?;
  assert d.out[0] in d.out;
  assert forall e :: e in d.out ==> e.Revoke? || e.Fetch? || e.DropCamera?;
}

lemma ListingKeeps(out: seq<Effect>, t: Photos)
  ensures listing(out, t).state.rows == t.rows && listing(out, t).state.mine == t.mine && listing(out, t).state.starred == t.starred && listing(out, t).state.only == t.only
  ensures listing(out, t).state.albums == t.albums && listing(out, t).state.album == t.album && listing(out, t).state.tab == t.tab
  ensures listing(out, t).state.selecting == t.selecting && listing(out, t).state.selected == t.selected && listing(out, t).state.job == t.job
  ensures listing(out, t).state.visible == t.visible && listing(out, t).state.secure == t.secure
  ensures listing(out, t).state.access == t.access && listing(out, t).state.videos == t.videos && listing(out, t).state.filter == t.filter
  ensures listing(out, t).state.cameraAlbum == (if t.visible then 0 else t.cameraAlbum)
  ensures listing(out, t).state.shelf == (if t.visible && t.cameraAlbum != 0 then app__photos__albums_closeDialog(t.shelf) else t.shelf)
  ensures forall e :: e in listing(out, t).out ==> e in out || e.Fetch? || e.DropCamera?
{
}

lemma AccessAllowedShape(s: Photos, grant: kit__permission_Grant, videos: bool, by_: app__photos__actor_Actor)
  requires inv(s) && canAccessIs(s, by_)
  requires kit__permission_allows(kit__permission_observe(s.access, grant))
  ensures accessIs(s, grant, videos, by_).state.rows == s.rows && accessIs(s, grant, videos, by_).state.mine == s.mine && accessIs(s, grant, videos, by_).state.starred == s.starred && accessIs(s, grant, videos, by_).state.only == s.only
  ensures accessIs(s, grant, videos, by_).state.albums == s.albums && accessIs(s, grant, videos, by_).state.album == s.album && accessIs(s, grant, videos, by_).state.tab == s.tab
  ensures accessIs(s, grant, videos, by_).state.selecting == s.selecting && accessIs(s, grant, videos, by_).state.selected == s.selected && accessIs(s, grant, videos, by_).state.job == s.job
  ensures accessIs(s, grant, videos, by_).state.visible == s.visible && accessIs(s, grant, videos, by_).state.secure == s.secure
  ensures accessIs(s, grant, videos, by_).state.access == kit__permission_observe(s.access, grant)
  ensures accessIs(s, grant, videos, by_).state.filter == (if (s.filter.Videos? && !(accessIs(s, grant, videos, by_).state.videos)) then Filter.Everything else s.filter)
  ensures accessIs(s, grant, videos, by_).state.cameraAlbum == 0
  ensures accessIs(s, grant, videos, by_).state.shelf == (if s.cameraAlbum == 0 then s.shelf else app__photos__albums_closeDialog(s.shelf))
  ensures forall e :: e in accessIs(s, grant, videos, by_).out ==> e.Fetch? || e.DropCamera?
{
  var granted := kit__permission_observe(s.access, grant);
  var shown := videos && kit__permission_allows(granted);
  var observed := s.(access := granted, videos := shown, filter := (if (s.filter.Videos? && !(shown)) then Filter.Everything else s.filter));
  var same := (granted.grant == s.access.grant) && (shown == s.videos);
  var kept := if same then observed else clearCameraVisit(observed);
  var dropped := if same then [] else dropCamera(s);
  assert accessIs(s, grant, videos, by_) == listing(dropped, kept);
  assert forall e :: e in dropped ==> e.DropCamera?;
  if !s.visible {
    assert s.cameraAlbum == 0;
  }
  ListingKeeps(dropped, kept);
}

lemma AccessAllowedKeeps(s: Photos, after: Photos, out: seq<Effect>)
  requires inv(s)
  requires after.rows == s.rows && after.mine == s.mine && after.starred == s.starred && after.only == s.only
  requires after.albums == s.albums && after.album == s.album && after.tab == s.tab
  requires after.selecting == s.selecting && after.selected == s.selected && after.job == s.job
  requires after.visible == s.visible && after.secure == s.secure
  requires kit__permission_allows(after.access)
  requires after.filter == (if (s.filter.Videos? && !(after.videos)) then Filter.Everything else s.filter)
  requires after.cameraAlbum == 0
  requires after.shelf == (if s.cameraAlbum == 0 then s.shelf else app__photos__albums_closeDialog(s.shelf))
  requires forall e :: e in out ==> e.Fetch? || e.DropCamera?
  ensures alwaysVideosNeedTheirAccess(after)
  ensures alwaysOnlyOwnWithoutAccess(after)
  ensures alwaysTheAlbumShowingIsListed(after)
  ensures alwaysNothingShownWhileHidden(after)
  ensures alwaysTheLockScreenListsOnlyItsSession(after)
  ensures alwaysSelectionIsListed(after)
  ensures alwaysRunsAreTheOwners(after)
  ensures alwaysDialogNamesItsSubject(after)
  ensures stepLosingAccessClosesWhatShowsTheLibrary(s, "accessIs", after, out)
  ensures stepNothingChangesWithoutAccess(s, after, out)
  ensures stepAPageKeepsWhatWasListed(s, "accessIs", after)
  ensures stepChangesAreTheOwners(s, "accessIs", after, out)
  ensures stepAFavouriteToggles(s, "accessIs", after)
  ensures stepAlbumChangesCarryTheSelection(s, "accessIs", after, out)
{
  app__photos__albums_closeDialog_ensures(s.shelf);
}

lemma AccessAllowed(s: Photos, grant: kit__permission_Grant, videos: bool, by_: app__photos__actor_Actor)
  requires inv(s) && canAccessIs(s, by_)
  requires kit__permission_allows(kit__permission_observe(s.access, grant))
  ensures alwaysVideosNeedTheirAccess(accessIs(s, grant, videos, by_).state)
  ensures alwaysOnlyOwnWithoutAccess(accessIs(s, grant, videos, by_).state)
  ensures alwaysTheAlbumShowingIsListed(accessIs(s, grant, videos, by_).state)
  ensures alwaysNothingShownWhileHidden(accessIs(s, grant, videos, by_).state)
  ensures alwaysTheLockScreenListsOnlyItsSession(accessIs(s, grant, videos, by_).state)
  ensures alwaysSelectionIsListed(accessIs(s, grant, videos, by_).state)
  ensures alwaysRunsAreTheOwners(accessIs(s, grant, videos, by_).state)
  ensures alwaysDialogNamesItsSubject(accessIs(s, grant, videos, by_).state)
  ensures stepLosingAccessClosesWhatShowsTheLibrary(s, "accessIs", accessIs(s, grant, videos, by_).state, accessIs(s, grant, videos, by_).out)
  ensures stepNothingChangesWithoutAccess(s, accessIs(s, grant, videos, by_).state, accessIs(s, grant, videos, by_).out)
  ensures stepAPageKeepsWhatWasListed(s, "accessIs", accessIs(s, grant, videos, by_).state)
  ensures stepChangesAreTheOwners(s, "accessIs", accessIs(s, grant, videos, by_).state, accessIs(s, grant, videos, by_).out)
  ensures stepAFavouriteToggles(s, "accessIs", accessIs(s, grant, videos, by_).state)
  ensures stepAlbumChangesCarryTheSelection(s, "accessIs", accessIs(s, grant, videos, by_).state, accessIs(s, grant, videos, by_).out)
{
  AccessAllowedShape(s, grant, videos, by_);
  var d := accessIs(s, grant, videos, by_);
  AccessAllowedKeeps(s, d.state, d.out);
}

lemma accessIs_ensures(s: Photos, grant: kit__permission_Grant, videos: bool, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysVideosNeedTheirAccess(accessIs(s, grant, videos, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysOnlyOwnWithoutAccess(accessIs(s, grant, videos, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysTheAlbumShowingIsListed(accessIs(s, grant, videos, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysNothingShownWhileHidden(accessIs(s, grant, videos, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysTheLockScreenListsOnlyItsSession(accessIs(s, grant, videos, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysSelectionIsListed(accessIs(s, grant, videos, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysRunsAreTheOwners(accessIs(s, grant, videos, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> alwaysDialogNamesItsSubject(accessIs(s, grant, videos, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> stepLosingAccessClosesWhatShowsTheLibrary(s, "accessIs", accessIs(s, grant, videos, by_).state, accessIs(s, grant, videos, by_).out))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> stepNothingChangesWithoutAccess(s, accessIs(s, grant, videos, by_).state, accessIs(s, grant, videos, by_).out))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> stepAPageKeepsWhatWasListed(s, "accessIs", accessIs(s, grant, videos, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> stepChangesAreTheOwners(s, "accessIs", accessIs(s, grant, videos, by_).state, accessIs(s, grant, videos, by_).out))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> stepAFavouriteToggles(s, "accessIs", accessIs(s, grant, videos, by_).state))
  ensures (inv(s) ==> canAccessIs(s, by_) ==> stepAlbumChangesCarryTheSelection(s, "accessIs", accessIs(s, grant, videos, by_).state, accessIs(s, grant, videos, by_).out))

{
  if inv(s) && canAccessIs(s, by_) {
    if !kit__permission_allows(kit__permission_observe(s.access, grant)) {
      AccessRevoked(s, grant, videos, by_);
    } else {
      AccessAllowed(s, grant, videos, by_);
    }
  }
}

lemma toggle_ensures(s: Photos, photo: int, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canToggle(s, photo, by_) ==> alwaysVideosNeedTheirAccess(toggle(s, photo, by_)))
  ensures (inv(s) ==> canToggle(s, photo, by_) ==> alwaysOnlyOwnWithoutAccess(toggle(s, photo, by_)))
  ensures (inv(s) ==> canToggle(s, photo, by_) ==> alwaysTheAlbumShowingIsListed(toggle(s, photo, by_)))
  ensures (inv(s) ==> canToggle(s, photo, by_) ==> alwaysNothingShownWhileHidden(toggle(s, photo, by_)))
  ensures (inv(s) ==> canToggle(s, photo, by_) ==> alwaysTheLockScreenListsOnlyItsSession(toggle(s, photo, by_)))
  ensures (inv(s) ==> canToggle(s, photo, by_) ==> alwaysSelectionIsListed(toggle(s, photo, by_)))
  ensures (inv(s) ==> canToggle(s, photo, by_) ==> alwaysRunsAreTheOwners(toggle(s, photo, by_)))
  ensures (inv(s) ==> canToggle(s, photo, by_) ==> alwaysDialogNamesItsSubject(toggle(s, photo, by_)))
  ensures (inv(s) ==> canToggle(s, photo, by_) ==> stepLosingAccessClosesWhatShowsTheLibrary(s, "toggle", toggle(s, photo, by_), []))
  ensures (inv(s) ==> canToggle(s, photo, by_) ==> stepNothingChangesWithoutAccess(s, toggle(s, photo, by_), []))
  ensures (inv(s) ==> canToggle(s, photo, by_) ==> stepAPageKeepsWhatWasListed(s, "toggle", toggle(s, photo, by_)))
  ensures (inv(s) ==> canToggle(s, photo, by_) ==> stepChangesAreTheOwners(s, "toggle", toggle(s, photo, by_), []))
  ensures (inv(s) ==> canToggle(s, photo, by_) ==> stepAFavouriteToggles(s, "toggle", toggle(s, photo, by_)))
  ensures (inv(s) ==> canToggle(s, photo, by_) ==> stepAlbumChangesCarryTheSelection(s, "toggle", toggle(s, photo, by_), []))

{
  if inv(s) && canToggle(s, photo, by_) {
    var after := toggle(s, photo, by_);
    if photo in s.selected {
      assert after.selected == ProofLib.Filter((set_x: int) => !((set_x in [photo])), s.selected);
      Dropped(s.selected, [photo]);
    } else {
      assert after.selected == s.selected + ProofLib.Filter((set_x: int) => !((set_x in s.selected)), [photo]);
      Joined(s.selected, [photo]);
    }
  }
}

lemma PageStep(before: Photos, via: string, after: Photos)
  ensures stepAPageKeepsWhatWasListed(before, via, after) == (!((((via == "listed") && before.paging) && after.library.status.Loaded?)) || (!((exists set_x :: set_x in before.rows && !((set_x in after.rows)))) && allOlder(ProofLib.Filter((set_x: int) => !((set_x in before.rows)), after.rows), before.rows)))
{
}

lemma ListedFailed(s: Photos, ticket: int, ok: bool, rows: seq<int>, owned: seq<int>, starred: seq<int>, cameraItem: int, revision: int, more: bool, by_: app__photos__actor_Actor)
  requires inv(s) && canListed(s, ticket, by_) && !ok
  ensures alwaysVideosNeedTheirAccess(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysOnlyOwnWithoutAccess(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysTheAlbumShowingIsListed(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysNothingShownWhileHidden(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysTheLockScreenListsOnlyItsSession(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysSelectionIsListed(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysRunsAreTheOwners(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysDialogNamesItsSubject(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures stepLosingAccessClosesWhatShowsTheLibrary(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out)
  ensures stepNothingChangesWithoutAccess(s, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out)
  ensures stepAPageKeepsWhatWasListed(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures stepChangesAreTheOwners(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out)
  ensures stepAFavouriteToggles(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures stepAlbumChangesCarryTheSelection(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out)
{
  assert s.cameraAlbum == 0;
  var d := listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_);
  assert forall e :: e in d.out ==> e.DropCamera?;
}

lemma ListedRestarted(s: Photos, ticket: int, ok: bool, rows: seq<int>, owned: seq<int>, starred: seq<int>, cameraItem: int, revision: int, more: bool, by_: app__photos__actor_Actor)
  requires inv(s) && canListed(s, ticket, by_) && ok && s.paging && ((revision != s.revision) || !(allOlder(rows, s.rows)))
  ensures alwaysVideosNeedTheirAccess(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysOnlyOwnWithoutAccess(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysTheAlbumShowingIsListed(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysNothingShownWhileHidden(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysTheLockScreenListsOnlyItsSession(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysSelectionIsListed(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysRunsAreTheOwners(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysDialogNamesItsSubject(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures stepLosingAccessClosesWhatShowsTheLibrary(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out)
  ensures stepNothingChangesWithoutAccess(s, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out)
  ensures stepAPageKeepsWhatWasListed(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures stepChangesAreTheOwners(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out)
  ensures stepAFavouriteToggles(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures stepAlbumChangesCarryTheSelection(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out)
{
  assert s.cameraAlbum == 0;
  var d := listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_);
  assert forall e :: e in d.out ==> e.Fetch? || e.DropCamera?;
}

lemma ListedLoaded(s: Photos, ticket: int, ok: bool, rows: seq<int>, owned: seq<int>, starred: seq<int>, cameraItem: int, revision: int, more: bool, by_: app__photos__actor_Actor)
  requires inv(s) && canListed(s, ticket, by_) && ok && !(s.paging && ((revision != s.revision) || !(allOlder(rows, s.rows))))
  ensures alwaysVideosNeedTheirAccess(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysOnlyOwnWithoutAccess(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysTheAlbumShowingIsListed(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysNothingShownWhileHidden(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysTheLockScreenListsOnlyItsSession(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysSelectionIsListed(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysRunsAreTheOwners(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures alwaysDialogNamesItsSubject(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures stepLosingAccessClosesWhatShowsTheLibrary(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out)
  ensures stepNothingChangesWithoutAccess(s, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out)
  ensures stepAPageKeepsWhatWasListed(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures stepChangesAreTheOwners(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out)
  ensures stepAFavouriteToggles(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state)
  ensures stepAlbumChangesCarryTheSelection(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out)
{
  assert s.cameraAlbum == 0;
  var d := listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_);
  var after := d.state;
  assert forall e :: e in d.out ==> e.DropCamera?;
  var sess := if s.secure then ProofLib.Filter((set_x: int) => (set_x in s.only), rows) else rows;
  var shown := if kit__permission_allows(s.access) then sess else ProofLib.Filter((set_x: int) => (set_x in owned), sess);
  var whole := if !showsItems(s) then [] else (if s.paging then (s.rows + ProofLib.Filter((set_x: int) => !((set_x in s.rows)), shown)) else shown);
  var ownedAll := if s.paging then (s.mine + ProofLib.Filter((set_x: int) => !((set_x in s.mine)), owned)) else owned;
  assert after.rows == whole;
  assert after.mine == ProofLib.Filter((set_x: int) => (set_x in whole), ownedAll);
  Kept(rows, s.only);
  Kept(sess, owned);
  Joined(s.rows, shown);
  Joined(s.mine, owned);
  Kept(ownedAll, whole);
  forall x | x in whole ensures x in shown || (s.paging && x in s.rows) {
  }
  forall x | x in shown ensures x in rows && (s.secure ==> x in s.only) && (!kit__permission_allows(s.access) ==> x in owned) {
  }
  if !kit__permission_allows(s.access) {
    forall x | x in whole ensures x in after.mine {
      if s.paging && x in s.rows {
        assert x in s.mine;
      }
    }
  }
  if s.secure {
    forall x | x in whole ensures x in s.only {
    }
  }
  if s.paging {
    PageStep(s, "listed", after);
    Dropped(whole, s.rows);
    forall x | x in ProofLib.Filter((set_x: int) => !((set_x in s.rows)), after.rows) ensures x in rows {
    }
    assert allOlder(ProofLib.Filter((set_x: int) => !((set_x in s.rows)), after.rows), s.rows);
  }
}

lemma listed_ensures(s: Photos, ticket: int, ok: bool, rows: seq<int>, owned: seq<int>, starred: seq<int>, cameraItem: int, revision: int, more: bool, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canListed(s, ticket, by_) ==> alwaysVideosNeedTheirAccess(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state))
  ensures (inv(s) ==> canListed(s, ticket, by_) ==> alwaysOnlyOwnWithoutAccess(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state))
  ensures (inv(s) ==> canListed(s, ticket, by_) ==> alwaysTheAlbumShowingIsListed(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state))
  ensures (inv(s) ==> canListed(s, ticket, by_) ==> alwaysNothingShownWhileHidden(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state))
  ensures (inv(s) ==> canListed(s, ticket, by_) ==> alwaysTheLockScreenListsOnlyItsSession(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state))
  ensures (inv(s) ==> canListed(s, ticket, by_) ==> alwaysSelectionIsListed(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state))
  ensures (inv(s) ==> canListed(s, ticket, by_) ==> alwaysRunsAreTheOwners(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state))
  ensures (inv(s) ==> canListed(s, ticket, by_) ==> alwaysDialogNamesItsSubject(listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state))
  ensures (inv(s) ==> canListed(s, ticket, by_) ==> stepLosingAccessClosesWhatShowsTheLibrary(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out))
  ensures (inv(s) ==> canListed(s, ticket, by_) ==> stepNothingChangesWithoutAccess(s, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out))
  ensures (inv(s) ==> canListed(s, ticket, by_) ==> stepAPageKeepsWhatWasListed(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state))
  ensures (inv(s) ==> canListed(s, ticket, by_) ==> stepChangesAreTheOwners(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out))
  ensures (inv(s) ==> canListed(s, ticket, by_) ==> stepAFavouriteToggles(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state))
  ensures (inv(s) ==> canListed(s, ticket, by_) ==> stepAlbumChangesCarryTheSelection(s, "listed", listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).state, listed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_).out))

{
  if inv(s) && canListed(s, ticket, by_) {
    if !ok {
      ListedFailed(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_);
    } else if s.paging && ((revision != s.revision) || !(allOlder(rows, s.rows))) {
      ListedRestarted(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_);
    } else {
      ListedLoaded(s, ticket, ok, rows, owned, starred, cameraItem, revision, more, by_);
    }
  }
}

lemma cameraAlbumsLoaded_ensures(s: Photos, photo: int, ticket: int, choices: seq<int>, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canCameraAlbumsLoaded(s, photo, ticket, by_) ==> alwaysVideosNeedTheirAccess(cameraAlbumsLoaded(s, photo, ticket, choices, by_)))
  ensures (inv(s) ==> canCameraAlbumsLoaded(s, photo, ticket, by_) ==> alwaysOnlyOwnWithoutAccess(cameraAlbumsLoaded(s, photo, ticket, choices, by_)))
  ensures (inv(s) ==> canCameraAlbumsLoaded(s, photo, ticket, by_) ==> alwaysTheAlbumShowingIsListed(cameraAlbumsLoaded(s, photo, ticket, choices, by_)))
  ensures (inv(s) ==> canCameraAlbumsLoaded(s, photo, ticket, by_) ==> alwaysNothingShownWhileHidden(cameraAlbumsLoaded(s, photo, ticket, choices, by_)))
  ensures (inv(s) ==> canCameraAlbumsLoaded(s, photo, ticket, by_) ==> alwaysTheLockScreenListsOnlyItsSession(cameraAlbumsLoaded(s, photo, ticket, choices, by_)))
  ensures (inv(s) ==> canCameraAlbumsLoaded(s, photo, ticket, by_) ==> alwaysSelectionIsListed(cameraAlbumsLoaded(s, photo, ticket, choices, by_)))
  ensures (inv(s) ==> canCameraAlbumsLoaded(s, photo, ticket, by_) ==> alwaysRunsAreTheOwners(cameraAlbumsLoaded(s, photo, ticket, choices, by_)))
  ensures (inv(s) ==> canCameraAlbumsLoaded(s, photo, ticket, by_) ==> alwaysDialogNamesItsSubject(cameraAlbumsLoaded(s, photo, ticket, choices, by_)))
  ensures (inv(s) ==> canCameraAlbumsLoaded(s, photo, ticket, by_) ==> stepLosingAccessClosesWhatShowsTheLibrary(s, "cameraAlbumsLoaded", cameraAlbumsLoaded(s, photo, ticket, choices, by_), []))
  ensures (inv(s) ==> canCameraAlbumsLoaded(s, photo, ticket, by_) ==> stepNothingChangesWithoutAccess(s, cameraAlbumsLoaded(s, photo, ticket, choices, by_), []))
  ensures (inv(s) ==> canCameraAlbumsLoaded(s, photo, ticket, by_) ==> stepAPageKeepsWhatWasListed(s, "cameraAlbumsLoaded", cameraAlbumsLoaded(s, photo, ticket, choices, by_)))
  ensures (inv(s) ==> canCameraAlbumsLoaded(s, photo, ticket, by_) ==> stepChangesAreTheOwners(s, "cameraAlbumsLoaded", cameraAlbumsLoaded(s, photo, ticket, choices, by_), []))
  ensures (inv(s) ==> canCameraAlbumsLoaded(s, photo, ticket, by_) ==> stepAFavouriteToggles(s, "cameraAlbumsLoaded", cameraAlbumsLoaded(s, photo, ticket, choices, by_)))
  ensures (inv(s) ==> canCameraAlbumsLoaded(s, photo, ticket, by_) ==> stepAlbumChangesCarryTheSelection(s, "cameraAlbumsLoaded", cameraAlbumsLoaded(s, photo, ticket, choices, by_), []))
{
  if inv(s) && canCameraAlbumsLoaded(s, photo, ticket, by_) {
    var after := cameraAlbumsLoaded(s, photo, ticket, choices, by_);
    if s.album != 0 {
      assert after.albums == choices + ProofLib.Filter((set_x: int) => !((set_x in choices)), [s.album]);
      Joined(choices, [s.album]);
      assert s.album in after.albums;
    }
  }
}

lemma changed_ensures(s: Photos, attempt: int, done: seq<int>, stale: seq<int>, declined: bool, known: bool, by_: app__photos__actor_Actor)
  ensures (inv(s) ==> canChanged(s, attempt, done, stale, by_) ==> alwaysVideosNeedTheirAccess(changed(s, attempt, done, stale, declined, known, by_).state))
  ensures (inv(s) ==> canChanged(s, attempt, done, stale, by_) ==> alwaysOnlyOwnWithoutAccess(changed(s, attempt, done, stale, declined, known, by_).state))
  ensures (inv(s) ==> canChanged(s, attempt, done, stale, by_) ==> alwaysTheAlbumShowingIsListed(changed(s, attempt, done, stale, declined, known, by_).state))
  ensures (inv(s) ==> canChanged(s, attempt, done, stale, by_) ==> alwaysNothingShownWhileHidden(changed(s, attempt, done, stale, declined, known, by_).state))
  ensures (inv(s) ==> canChanged(s, attempt, done, stale, by_) ==> alwaysTheLockScreenListsOnlyItsSession(changed(s, attempt, done, stale, declined, known, by_).state))
  ensures (inv(s) ==> canChanged(s, attempt, done, stale, by_) ==> alwaysSelectionIsListed(changed(s, attempt, done, stale, declined, known, by_).state))
  ensures (inv(s) ==> canChanged(s, attempt, done, stale, by_) ==> alwaysRunsAreTheOwners(changed(s, attempt, done, stale, declined, known, by_).state))
  ensures (inv(s) ==> canChanged(s, attempt, done, stale, by_) ==> alwaysDialogNamesItsSubject(changed(s, attempt, done, stale, declined, known, by_).state))
  ensures (inv(s) ==> canChanged(s, attempt, done, stale, by_) ==> stepLosingAccessClosesWhatShowsTheLibrary(s, "changed", changed(s, attempt, done, stale, declined, known, by_).state, changed(s, attempt, done, stale, declined, known, by_).out))
  ensures (inv(s) ==> canChanged(s, attempt, done, stale, by_) ==> stepNothingChangesWithoutAccess(s, changed(s, attempt, done, stale, declined, known, by_).state, changed(s, attempt, done, stale, declined, known, by_).out))
  ensures (inv(s) ==> canChanged(s, attempt, done, stale, by_) ==> stepAPageKeepsWhatWasListed(s, "changed", changed(s, attempt, done, stale, declined, known, by_).state))
  ensures (inv(s) ==> canChanged(s, attempt, done, stale, by_) ==> stepChangesAreTheOwners(s, "changed", changed(s, attempt, done, stale, declined, known, by_).state, changed(s, attempt, done, stale, declined, known, by_).out))
  ensures (inv(s) ==> canChanged(s, attempt, done, stale, by_) ==> stepAFavouriteToggles(s, "changed", changed(s, attempt, done, stale, declined, known, by_).state))
  ensures (inv(s) ==> canChanged(s, attempt, done, stale, by_) ==> stepAlbumChangesCarryTheSelection(s, "changed", changed(s, attempt, done, stale, declined, known, by_).state, changed(s, attempt, done, stale, declined, known, by_).out))

{
  if inv(s) && canChanged(s, attempt, done, stale, by_) {
    ChangedShape(s, attempt, done, stale, declined, known, by_);
    var d := changed(s, attempt, done, stale, declined, known, by_);
    ChangedKeeps(s, d.state, d.out);
  }
}

lemma ChangedShape(s: Photos, attempt: int, done: seq<int>, stale: seq<int>, declined: bool, known: bool, by_: app__photos__actor_Actor)
  requires inv(s) && canChanged(s, attempt, done, stale, by_)
  ensures changed(s, attempt, done, stale, declined, known, by_).state.rows == s.rows && changed(s, attempt, done, stale, declined, known, by_).state.mine == s.mine && changed(s, attempt, done, stale, declined, known, by_).state.starred == s.starred && changed(s, attempt, done, stale, declined, known, by_).state.only == s.only
  ensures changed(s, attempt, done, stale, declined, known, by_).state.albums == s.albums && changed(s, attempt, done, stale, declined, known, by_).state.album == s.album && changed(s, attempt, done, stale, declined, known, by_).state.tab == s.tab
  ensures changed(s, attempt, done, stale, declined, known, by_).state.selecting == s.selecting && changed(s, attempt, done, stale, declined, known, by_).state.selected == s.selected
  ensures changed(s, attempt, done, stale, declined, known, by_).state.visible == s.visible && changed(s, attempt, done, stale, declined, known, by_).state.secure == s.secure
  ensures changed(s, attempt, done, stale, declined, known, by_).state.access == s.access && changed(s, attempt, done, stale, declined, known, by_).state.videos == s.videos && changed(s, attempt, done, stale, declined, known, by_).state.filter == s.filter
  ensures app__photos__changes_running(s.job) && app__photos__changes_inv(changed(s, attempt, done, stale, declined, known, by_).state.job)
  ensures |changed(s, attempt, done, stale, declined, known, by_).state.job.left| == 0 || changed(s, attempt, done, stale, declined, known, by_).state.job.left == s.job.left
  ensures changed(s, attempt, done, stale, declined, known, by_).state.cameraAlbum == 0 || (changed(s, attempt, done, stale, declined, known, by_).state.cameraAlbum == s.cameraAlbum && changed(s, attempt, done, stale, declined, known, by_).state.cameraItem == s.cameraItem && changed(s, attempt, done, stale, declined, known, by_).state.library == s.library)
  ensures changed(s, attempt, done, stale, declined, known, by_).state.shelf == (if s.cameraAlbum != 0 && changed(s, attempt, done, stale, declined, known, by_).state.cameraAlbum == 0 then app__photos__albums_closeDialog(s.shelf) else s.shelf)
  ensures forall e :: e in changed(s, attempt, done, stale, declined, known, by_).out ==> e.Fetch? || e.DropCamera?
{
  app__photos__changes_answered_ensures(s.job, attempt, done, stale, declined, known);
  var r := app__photos__changes_answered(s.job, attempt, done, stale, declined, known);
  var res := if (known && s.job.change.Trash? && (s.cameraItem in done)) then clearCameraVisit(s) else s;
  var t := res.(job := r);
  if !s.visible {
    assert s.cameraAlbum == 0;
  }
  if app__photos__changes_running(r) {
    assert changed(s, attempt, done, stale, declined, known, by_) == emit([], t);
  } else {
    assert changed(s, attempt, done, stale, declined, known, by_) == listing([], t);
    ListingKeeps([], t);
  }
}

lemma ChangedKeeps(s: Photos, after: Photos, out: seq<Effect>)
  requires inv(s)
  requires after.rows == s.rows && after.mine == s.mine && after.starred == s.starred && after.only == s.only
  requires after.albums == s.albums && after.album == s.album && after.tab == s.tab
  requires after.selecting == s.selecting && after.selected == s.selected
  requires after.visible == s.visible && after.secure == s.secure
  requires after.access == s.access && after.videos == s.videos && after.filter == s.filter
  requires app__photos__changes_running(s.job) && app__photos__changes_inv(after.job)
  requires |after.job.left| == 0 || after.job.left == s.job.left
  requires after.cameraAlbum == 0 || (after.cameraAlbum == s.cameraAlbum && after.cameraItem == s.cameraItem && after.library == s.library)
  requires after.shelf == (if s.cameraAlbum != 0 && after.cameraAlbum == 0 then app__photos__albums_closeDialog(s.shelf) else s.shelf)
  requires forall e :: e in out ==> e.Fetch? || e.DropCamera?
  ensures alwaysVideosNeedTheirAccess(after)
  ensures alwaysOnlyOwnWithoutAccess(after)
  ensures alwaysTheAlbumShowingIsListed(after)
  ensures alwaysNothingShownWhileHidden(after)
  ensures alwaysTheLockScreenListsOnlyItsSession(after)
  ensures alwaysSelectionIsListed(after)
  ensures alwaysRunsAreTheOwners(after)
  ensures alwaysDialogNamesItsSubject(after)
  ensures stepLosingAccessClosesWhatShowsTheLibrary(s, "changed", after, out)
  ensures stepNothingChangesWithoutAccess(s, after, out)
  ensures stepAPageKeepsWhatWasListed(s, "changed", after)
  ensures stepChangesAreTheOwners(s, "changed", after, out)
  ensures stepAFavouriteToggles(s, "changed", after)
  ensures stepAlbumChangesCarryTheSelection(s, "changed", after, out)
{
  app__photos__albums_closeDialog_ensures(s.shelf);
}
