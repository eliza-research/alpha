# Canonical native notification tap custody

The native actor holds two distinct process-local slots. `captureTap` copies
a canonical intent into the latest waiting slot and strips route data from the
original intent. The verified slot is populated only after the current actor
passes its owner checks, the projector accepts the copied intent and the
shared route helper selects a supported view. An earlier verifier clears only
the exact waiting object it took. It can publish while a newer intent is
waiting, and a later verified tap then replaces the pending token.

`canonicalPending` copies the verified slot after owner, agent and time
checks. Reading leaves it available. At the exact five-minute deadline the
copy is still available. The next millisecond hides it without clearing it.
Restart suspension keeps both slots. Retiring the actor clears the verified
slot and leaves any waiting intent for a later actor to verify.

`acknowledgeCanonical` captures the active actor, rechecks foreground and
compares the exact unexpired token and actor under the slot lock. It clears
the token before invoking the read acknowledgement port. A newer token or
actor observed at the comparison refuses the old request. A lost reply,
non-success status or late foreground refusal cannot restore the consumed
token. The bridge wakeup contains no tap data. The caller has to read the slot
through the foreground bridge.

The [Quint component](../../native/CanonicalNotificationTap.qnt) and
[JVM replay](canonical-notification-tap.mjs) execute the exact selected actor
and bridge methods, pinned foreground gate and pinned route whitelist. The
fixture uses a synthetic owner, wall clock, Android intent and read port. It
holds the foreground check during the exact comparison and holds the fake
read port after consumption, so both a pre-comparison replacement and a
later replacement are observed.

The campaign covers one bridge and selected actor and foreground schedules.
Installed Android ingress, projector receipt provenance, resident read
effects, executor behavior and renderer navigation have separate owners.

Run `node --test test/quint-canonical-notification-tap-refinement.test.mjs`.
