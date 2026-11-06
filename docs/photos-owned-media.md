# Owned Photos collections and trash

Ownership (October 2026): the owned collection, its favorite/trash fences, batches,
counts and two-step permanent removal are elizaOS `OwnedMediaLibrary`, and custom
albums are `OwnedAlbums` (`plugins/plugin-native-media`). The Capacitor binding is the
shared `PhotosPlugin` of the same module; `AlphaPhotosPlugin` only registers it as the
`AlphaPhotos` plugin with Alpha's `alpha` namespace (`AlphaMediaConfig`), its playback
path, debug QA markers and late-launch wording, so the installed preferences
`alpha-owned-media-versions` and `alpha-owned-albums` keep resolving after an upgrade.
The behaviour below is unchanged by that move.

The owned collection operations below manage this package's published images and
videos. The #408 branch additionally requests photo/video library access only from
the explicit Photos control. Android 14 selected-only access is reported separately
from full image and full video access; denial retains the owned collection.

The new catalog queries the current user's MediaStore in 24-item pages. Keys include
the storage volume, media kind and row ID; revisions also bind the provider version
and available generation columns. Filename queries run against the provider,
not only loaded thumbnails. Cursors expire after two minutes and are invalidated
by library changes or app backgrounding. Images and videos of a volume are merged
below one `_id` cursor, so the grid is newest first across both kinds. The renderer
keeps the newest 2000 rows (a reload re-reads at most 240) and groups them by day;
library access does not create a cloud upload or background pixel index.
Selected reads recheck permission, lock state and revision. A reviewed native-source
patch lets the existing copy editor read a host-validated permitted still image;
saved copies remain owned PNGs with the existing operation receipt journal.

The permitted-library branch also queries Favorites, Videos and Recently deleted
through typed collections. Custom album membership retains volume-qualified identities
and withholds inaccessible members. Album responses recheck the whole access/version
snapshot, including the live provider generation on Android 11+; subsequent pages
bind that snapshot as well as the album revision. This detects ordinary mutations
before the asynchronous observer callback runs. A new native fixture exercises
that case with one exact owned synthetic image while main-thread callbacks are
blocked; it is registered for execution, not yet claimed as passing.

Favorite, trash and restore requests over permitted rows require a native review
and Android's write-access prompt. Approval is consumed once; the provider update
still compares the selected row's generation and original identity. A stale row is
skipped, an uncertain result is not replayed, and a batch can report partial success.
These grants are not persisted. Permanent deletion of the full library is left to
Android's expiration/management surface; the owned-only permanent-delete path does
not silently delete a different scope.

This is work in progress, not #408 acceptance. Local-agent operations and installed
large-catalog, foreign-media, permission-downgrade, reboot and reviewed-mutation
campaigns remain required. The initial catalog checkpoint built all four developer
APKs and passed lint; subsequent organization code has SDK compilation and renderer
checks but still needs new exact-source APK and native qualification. Repository
verification passed 755 tests (751 passed, four existing TODOs) at organization checkpoint `07570e62`, including the final
album-response snapshot tightening; the provider-generation follow-up is pending
full verification. Existing browser album/batch/delete journeys
passed all 12 cases. These checks do not prove native provider outcomes. Android's permission
contract is documented in [selected photo/video access](https://developer.android.com/about/versions/14/changes/partial-photo-video-access).


Favorites (Android 11+) sets `IS_FAVORITE` on an active owned row and verifies the
returned generation and value. Videos and Favorites are native query predicates
applied before the 24-item page limit. The existing prototype album tiles, album
grid and viewer controls remain the UI. Custom albums are separate local metadata described below. Image analysis is not
implemented by these collections.

Recently deleted uses `IS_TRASHED`, with Android's actual expiration metadata.
Restore and Undo retain the original bytes. Mutations change the selected-object
revision; trash removes active read/share access and revokes owned video grants.

Delete all first captures an immutable list of owned trashed row IDs and generation
numbers. The existing confirmation sheet displays that snapshot's count. Its
opaque single-use token expires after two minutes and is never persisted or
replayed after process restart. Confirmation deletes only rows still owned,
trashed, and at the same generation. Newly trashed rows are excluded; changed or
restored rows are skipped. The UI preserves a partial-result status and reloads
remaining rows. More than 500 rows is explicitly unsupported in one confirmation.
Cancel has no media side effect. Android trash/favorite operations require API 30.

Pending native verification for this source revision:

- `PhotosTrashInstrumentedTest` (5 tests): real trash/Undo/recreation/exact bytes;
  older-than-first-page favorite query, UI unfavorite and recreation; immutable
  permanent-delete snapshot, Cancel, changed-row receipt, single-use token, and
  newly trashed row exclusion. Permanent-delete test refuses to run its destructive
  flow if app-owned trash is not initially empty and cleans up only its own URIs.
- `VideoInstrumentedTest` retains real camera recording, decoded playback and
  exact byte-range checks; its recreation step now opens the exact recorded ID
  through the Videos album and plays it again.

TypeScript checking is source validation only. APK/lint checks and both-flavor
native execution are owned by the coordinating build/test run; these additions
have not yet been claimed as device-tested.

## Custom albums (source for build 63)

The reference has custom album tiles and detail grids, but its creation path is a
simulated agent command. Production does not execute that handler. Explicit local
Photo info → Add to album → New album creates an album with the selected owned
asset. The same sheet adds/removes membership; the custom album's Manage control
renames it or asks for confirmation before deleting only the album. These
conditional controls reuse prototype typography, spacing and sheet tokens; the
unopened reference layout is unchanged.

Native private preferences persist up to 24 albums with up to 200 members each.
Every write commits before returning a receipt and compares the album revision.
Adding an item also validates its exact current media mutation revision and
ownership. Membership stores ID, original creation time/size and MediaStore
GENERATION_ADDED; changing favorite/trash state does not change that original
identity. Queries revalidate ownership and identity before pagination, hide
trashed items, and reject deleted/replaced assets. Restore can reveal the same
original member again. Album deletion never deletes media. Names and member
contents are not added to agent context; no album proposal capability is claimed.
External picker items remain outside these owned-media albums.

The new full-flow test creates only unique fixture media/albums, uses actual
renderer controls to create/rename/remove/add/cancel/delete, recreates the Activity,
checks stale revision rejection, trash/restore membership and exact unchanged
media bytes. Cleanup filters only the unique test album names and exact fixture
URIs. Native execution remains pending for this source revision.

Build 62's permanent-delete test exposed a receipt-classification issue: a restored
snapshot row produced a failed receipt rather than a skipped receipt (zero rows
were deleted). Build 63 reads the exact owned row including trash before deletion
and classifies missing/restored/changed generations as skipped. The delete itself
still enforces the immutable generation predicate for races. The test now reports
receipt counts before indexing and retains its independent restoration checks.

## Cross-surface mutation audit (source for build 64)

Album read/modify/commit now holds one process-wide lock, because the main and
assistant Activities have separate plugin workers but share durable preferences.
The album revision comparison is inside that lock. A successful native mutation
still persists after explicit user approval, but its late renderer receipt may
close/update selection only if the original manager is still active. It cannot
dismiss a new manager opened after leaving Photos.

The additional native flow starts both real Activities and dispatches album
writes through their actual Capacitor bridges. A bounded test-owned hold of the
same lock proves both workers reached the serialization boundary before release;
both distinct albums must persist. The second phase sends a rename through the
actual UI, leaves/reenters while the real worker waits, opens a new info sheet,
and verifies the committed rename does not dismiss that new sheet. Cleanup uses
only unique fixture names/UUIDs under the same lock. No mocked native receipt,
renderer production hook, or model inference is used. Execution is pending.

Build 64 native execution reached two further pending-state issues. The UI cleared
its prepared trash snapshot before awaiting deletion, hiding confirmation before
receipt; build 65 retains the disabled confirmation until the native result. The
absence assertion remains unchanged. The concurrency test proved both Activity
writes persisted, then exposed Back being consumed indefinitely while an album
write was pending. Build 65 allows closing that management sheet and navigating
away while the approved write continues; it makes no cancellation claim and the
manager-identity check still protects a newly opened sheet from late completion.
These fixes require the next native run.

## Owned multi-selection and sharing (source for build 66)

Long-pressing an owned library/album thumbnail enters the existing prototype
selection state; tapping toggles items, up to 20. The existing single-item Android
picker remains the Select photos action. Share selected validates every unique
owned, active row and its mutation revision before opening Android's real
ACTION_SEND_MULTIPLE chooser with matching ClipData and read-only grants. A stale
item rejects the whole selection instead of silently sharing a subset. The chooser
is not a delivery receipt. Cancel selection and leaving Photos clear the local
selection; no media is uploaded to the agent. Batch favorite/delete controls state
that they are unavailable and have no side effect.

`PhotosMultiShareInstrumentedTest` uses actual native long-press/tap input on three
unique JPEG fixtures. It checks the real chooser intent contains exactly two
selected URIs and no write grant, cancels, verifies all original bytes, then picks
the test APK's separate-UID recipient and verifies both hashes/count and exclusion
of the neighboring fixture. It also changes one selected row's real generation
and requires sharing to reject before opening another chooser. The existing
single-item receiver behavior remains supported. Typecheck passed; native build
and both-variant execution are pending.

## Agent library bridge (source for issue 408)

The former Device library album is gone (2026-11 view refresh). Its agent proposal,
selection, review and receipt contract from #442 lives on in
`apps/app/src/prototype/photo-library-adapter.ts`, which no longer renders anything: reads
go to the native facade, and select, view requests and reviews act on the main Library.
The native facade (`AlphaPhotoLibraryPlugin`, a registration of the
shared `DeviceLibraryPlugin`) uses the
`AlphaPhotos` plugin's own `PermittedMediaCatalog` and `PermittedMediaReview`
instances (the shared engines in elizaOS `plugins/plugin-native-media`, configured
with Alpha's installed names in `AlphaMediaConfig`) rather than constructing its own: one read epoch, one grant-change
invalidation, one MediaStore observer and one Android review at a time across both
surfaces. Both use the same permission grants, typed per-volume collections,
volume-qualified identities, provider-version/generation revisions and exact
conditional mutations. There is no second media index. The observer is registered
only while the main Photos grid is open. Agent select, filter, open, album-create,
share and review requests act on the main Library grid (`setMainLibraryHost`); one
review waits at a time. Reviews validate the reviewed revisions with the provider
before they open and again before Android is asked.

Search supports kind, dates and favorites. Names remain local to owner searches;
the agent search accepts no text and its results omit filenames, albums, byte sizes,
modification times and pixels. Native revisions remain on the phone; model-facing
revisions are session-local opaque tokens. Reads require an unlocked profile and
current grants. Scope loss or locking clears the renderer catalog and selection.

Favorite, unfavorite and trash pass through owner review, Android write-access
approval, and a generation-conditional mutation. Revisions are checked again after
Android returns, so an edited item is skipped. Permanent deletion is deliberately
left to Android media management; the earlier URI-only deletion request could not
bind the effect to the revision reviewed in Alpha. Main Photos provides restore.
Sharing opens Android's chooser for the exact selected revisions; it is not a
receipt that anything was sent.

The Alpha action path supports `photo_library_search`, `photo_library_inspect`,
`photo_library_select` and `photo_library_review` behind `photos.library.v1` and a
Photos context check. The Photos view tools behind `photos.view.v1` are
`photos_filter` (read-only, a clearable chip over the grid), `photos_open` (opens one
item in the viewer), `photos_album_create` (reviewed in Photos) and `photos_share`
(reviewed in Photos, then Android's share sheet). Their contract is
`apps/app/src/runtime/photos-view-contract.ts`; the agent tools and the shared
coordinator changes are the proposed upstream patch `patches/eliza/photos-view-agent.patch`
(see its `.md`). Until the pin carries it the shared coordinator rejects these
operation types, so the phone code is inert and `photos.view.v1` is not offered. Upstream
Eliza still must emit the library operations and negotiate the capabilities, so source
registration does not establish live agent acceptance.

## Native Photos patch

`patches/eliza/photos-library.patch` (listed in `patches/eliza/native-manifest.json`,
replacing `photos-list-limit.patch`, which it contains) changes the shared
`plugin-native-media` Photos sources: list rows carry `folder`, `taken` and `size`;
`camera` and `screenshots` albums and counts; `changeMany` accepts `unfavorite`;
`shareMany` takes up to 100 items; permitted images and videos merge below one cursor;
and the editor's **Replace**. `beginEdit` reports `canReplace` (a JPEG, PNG or WebP
still whose revision and digest matched, owned by Alpha or on Android 11+).
`saveEdit({replace:true})` overwrites the original through the same Uri after
`MediaStore.createWriteRequest` consent (none for Alpha's own items or with all-files
access), bound to the reviewed revision; a changed item returns `stale` and nothing is
written. The browser library implements the same Replace for its own captures. None of
this has run on a device.

The host tests exercise the renderer contract, opaque outbound revisions, selection,
review expiry and shared catalog delegation. The instrumentation fixture is updated
for canonical volume-qualified identities and bounded refresh. Earlier foreign-media
campaign evidence belongs to #437's catalog; it does not qualify the newly reconciled
agent album. Exact-source APK, installed bridge, permission downgrade, reboot,
large personal libraries, battery and physical-device acceptance remain separate.
