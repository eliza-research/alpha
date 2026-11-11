# Native Google access file

`AlphaLocalAgentPlugin.setGoogleAgentAccess` accepts two booleans. It invokes
`GoogleAgentAccessFile.write` at the same private `.eliza` path that the
resident passes to the Google host as `ALPHA_GOOGLE_AGENT_ACCESS_FILE`. The
writer creates a private temporary file, forces its bytes, atomically renames
it and cleans up the staging name. It does not use Android's `AtomicFile`
backup protocol. A leftover sibling cannot authorize a request.

The [model](../../services/NativeGoogleAccessFile.qnt) separates the canonical
record, an opened reader's snapshot and each private request's admission.
The JVM writer and host used to disagree about links. The writer refused a
linked file or immediate directory while the reader accepted the referenced
record. A FIFO also blocked the reader. The reader now opens the final
component without following a link, uses nonblocking open, checks that the
descriptor belongs to a regular file and parses bytes through that same
descriptor. Missing, unreadable, malformed or wrong-version records leave both
switches off.

The [replay](native-google-access-file.mjs) compiles the actual Java writer and
runs the actual native host. A controlled descriptor hook places a real atomic
replacement between the reader's open and read. The old descriptor yields the
complete old record and the next read yields the complete new one. A separate
loopback schedule holds a request at synthetic verification, writes off and
checks that the next request receives `changes-off` without transport. The
previous request retains its admission to verification. Its provider effect
is outside this test. A new host with the same path reads the existing record.

The immediate private parent is checked as a directory. The model assumes its
ancestors stay under product control and does not prove confinement through a
concurrent ancestor swap. The evidence uses disposable host POSIX files, one
JVM write at a time, synthetic verification and host recreation. Android
device behavior, power loss, renderer acknowledgement and already admitted
provider effects need separate evidence.

Run `bun test test/quint-native-google-access-file.test.mjs`.
