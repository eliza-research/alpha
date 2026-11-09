// Browser-owned album metadata and saved media are in separate IndexedDB databases.
module BrowserAlbumStorage {
  type State = {
    media: int -> int, trashed: Set[int], album: int, serial: int,
    name: str, members: Set[int], held: int, heldRevision: int, waiting: int,
    albumResult: str, mediaResult: str,
  }
  var s: State
  action init = s' = {media: Map(1 -> 1, 2 -> 1, 3 -> 1), trashed: Set(), album: 0,
    serial: 0, name: "", members: Set(), held: 0, heldRevision: 0, waiting: 0,
    albumResult: "none", mediaResult: "none"}

  pure def valid(st: State, id: int, revision: int): bool =
    st.media.keys().contains(id) and st.media.get(id) == revision and not(st.trashed.contains(id))
  pure def commit(st: State, name: str, members: Set[int]): State =
    {...st, album: st.serial + 1, serial: st.serial + 1,
      name: name, members: members, albumResult: "updated"}
  pure def edit(st: State, operation: str, expected: int, id: int, revision: int, name: str): State =
    if (id != 0 and not(valid(st, id, revision))) {...st, albumResult: "media-changed"}
    else if (operation == "create") commit(st, name, if (id == 0) Set() else Set(id))
    else if (st.album == 0 or st.album != expected) {...st, albumResult: "album-changed"}
    else if (operation == "rename") commit(st, name, st.members)
    else if (operation == "delete") {...st, album: 0, serial: st.serial + 1,
      name: "", members: Set(), albumResult: "updated"}
    else commit(st, st.name, if (operation == "add") st.members.union(Set(id))
      else st.members.exclude(Set(id)))

  action changeAlbum(operation: str, expected: int, id: int, revision: int, name: str): bool = all {
    s.held == 0, s.waiting == 0, s.serial < 8,
    operation.in(Set("create", "rename", "delete", "add", "remove")),
    operation == "create" implies s.album == 0,
    operation.in(Set("add", "remove")) implies id.in(Set(1, 2, 3)),
    s' = edit(s, operation, expected, id, revision, name),
  }

  action holdAdd(id: int, expected: int, revision: int): bool = all {
    s.held == 0, s.waiting == 0, s.album == expected, expected > 0, s.serial < 8,
    id.in(Set(1, 2, 3)), valid(s, id, revision),
    s' = {...s, held: id, heldRevision: revision},
  }

  action queueTrash(id: int): bool = all {
    id.in(Set(1, 2, 3)), s.held != 0, s.waiting == 0, s.media.get(id) < 5,
    s' = {...s, waiting: id},
  }

  action settleAdd = all {
    s.held != 0,
    s' = {...commit(s, s.name, s.members.union(Set(s.held))), held: 0, heldRevision: 0},
  }

  pure def trash(st: State, id: int): State =
    {...st, media: st.media.set(id, st.media.get(id) + 1),
      trashed: st.trashed.union(Set(id)), mediaResult: "updated", waiting: 0}

  action settleQueuedTrash = all {
    s.held == 0, s.waiting != 0,
    s' = trash(s, s.waiting),
  }

  action writeMedia(id: int, revision: int, remove: bool): bool = all {
    s.held == 0, s.waiting == 0, id.in(Set(1, 2, 3)), s.media.get(id) < 5,
    s' = if (s.media.get(id) != revision) {...s, mediaResult: "media-changed"}
      else if (remove) trash(s, id)
      else {...s, media: s.media.set(id, revision + 1), mediaResult: "updated"},
  }

  action step = any {
    { nondet id = Set(1, 2, 3).oneOf(); holdAdd(id, s.album, s.media.get(id)) },
    { nondet id = Set(1, 2, 3).oneOf(); queueTrash(id) },
    { nondet id = Set(1, 2, 3).oneOf(); nondet revision = Set(1, 2, 3, 4, 5).oneOf()
      any {writeMedia(id, revision, false), writeMedia(id, revision, true)} },
    { nondet id = Set(1, 2, 3).oneOf(); nondet expected = Set(0, 1, 2, 3, 4, 5, 6, 7, 8).oneOf()
      nondet revision = Set(1, 2, 3, 4, 5).oneOf()
      any {changeAlbum("add", expected, id, revision, ""), changeAlbum("remove", expected, id, revision, "")} },
    changeAlbum("create", 0, 0, 0, "Album"),
    changeAlbum("rename", s.album, 0, 0, "Renamed"),
    changeAlbum("delete", s.album, 0, 0, ""),
    settleAdd, settleQueuedTrash, s' = s,
  }

  val visibleCount = s.members.exclude(s.trashed).size()
  val HeldMediaIsCurrent = s.held == 0 or valid(s, s.held, s.heldRevision)
  val AlbumOwnsMembers = s.album != 0 or s.members == Set()
  val safety = HeldMediaIsCurrent and AlbumOwnsMembers

  run AlbumCommitOrdersBeforeQueuedTrashTest = init
    .then(changeAlbum("create", 0, 0, 0, "Album")).then(holdAdd(1, 1, 1)).then(queueTrash(1))
    .then(settleAdd).then(settleQueuedTrash)
    .expect(s.album == 2 and s.members == Set(1) and visibleCount == 0 and safety)
  run PriorMediaWriteRefusesStaleAddTest = init.then(changeAlbum("create", 0, 0, 0, "Album"))
    .then(writeMedia(1, 1, false)).then(changeAlbum("add", 1, 1, 1, ""))
    .expect(s.album == 1 and s.members == Set() and s.albumResult == "media-changed" and safety)
  run BatchContinuesAfterStaleMediaTest = init.then(changeAlbum("create", 0, 0, 0, "Album"))
    .then(writeMedia(2, 1, true)).then(changeAlbum("add", 1, 1, 1, ""))
    .then(changeAlbum("add", 2, 2, 1, "")).then(changeAlbum("add", 2, 3, 1, ""))
    .expect(s.album == 3 and s.members == Set(1, 3) and visibleCount == 2 and safety)
  run RenamedAlbumRejectsOldRevisionTest = init.then(changeAlbum("create", 0, 0, 0, "Album"))
    .then(changeAlbum("rename", 1, 0, 0, "Renamed")).then(changeAlbum("add", 1, 1, 1, ""))
    .expect(s.album == 2 and s.name == "Renamed" and s.albumResult == "album-changed" and safety)
}
