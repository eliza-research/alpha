# Durable Android runtime update pause

`AlphaApplication.attachBaseContext` configures update admission before
providers start in the normal process. `AlphaDevicePlugin.UpdatePause`
opens the shared journal under the no-backup directory. The update worker
records the baseline and successor identities before requesting a resident
stop, marks committing before the installer commit, then retires its
process-local owner. The installer owns package effects. The journal owns
the durable fence on subsequent runtime starts.

The [Quint component](../../native/RuntimeUpdatePause.qnt) and
[JVM replay](runtime-update-pause.mjs) track the binary journal and tombstone,
the retained service shutdown request, the installed and executing APK
identities and the package session evidence. The replay compiles the
pinned journal and the exact extracted product wrapper. It uses disposable
files and existing Android ports. Two separate JVMs reopen the same path
to check that a pending old process stays fenced and that the exact
executing successor can release the record.

| Observed source boundary | Release behavior |
| --- | --- |
| Exact baseline installed and executing | Requires an absent or proven uncommitted session, no live worker and matching signer. A held service stop also requires confirmation. |
| Exact target installed and executing | Can release with a pending session. A package read failure, signer mismatch or unconfirmed retained stop still refuses. |
| Known bound and unsealed session | Before committing, it can prove uncommitted. After committing, the same-boot proof requires zero reported progress on the supported release API ranges. A new boot has a separate uncommitted proof. |
| Stale owner, old executing code, different digest, sealed or foreign session | They do not provide baseline release authority. |
| Leftover regular staging file | Read ignores it. A successful old publication uses the fixed staging name and atomically replaces the primary. |
| Linked, oversized, malformed or trailing-byte primary | Actual read rejects the fixture and startup admission stays fenced. |

A real POSIX directory can allow search and write while refusing a read
handle. The source replay exercises that case when the host permissions
permit it. An acquire or committing write can become visible before
directory force fails. A terminal write can leave a visible tombstone
while the wrapper still holds the exact service shutdown request. Retrying
reconciliation then sees no record. The update journal's admission check
passes in that state, while the separate retained service lease still
blocks its own launch check. The model preserves that discrepancy and
does not treat a null read as release authority.

The campaign leaves APK installation, actual Android session guarantees,
power-loss recovery and end-to-end
resident startup to separate verification. The in-memory bridge activation
and renderer continuation own distinct state.

Run `node --test test/quint-runtime-update-pause-refinement.test.mjs`.
