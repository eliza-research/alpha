# Native sign-in coordinator refinement

The standalone adapter executes `AlphaCloudSignInPlugin`, `CloudSignInFlow`,
`CloudSignInReadiness`, `CloudEmailCode`, `CloudSmsCode`, `CloudKeyRevocation` and
`ConnectionRoutes` on a JVM. It uses the actual plugin constructor, executor,
public start/cancel methods, callback handler, completion routine and startup
acknowledgement recovery. Each schedule has a fresh JVM so its HTTPS URL factory
cannot affect another test. Unknown authorities and routes fail the fixture.

```sh
node --test test/quint-signin-refinement.test.mjs
node --import=tsx specs/quint/refinement/services/sign-in-coordinator.mjs
```

The adapter runs in the fourteen-model services aggregate and also has a standalone command. Its seventeen schedules
cover initial successful sign-in, successful replacement, retryable acknowledgement,
pre-commit cancellation, post-commit cancellation, acknowledgement after restart,
failed callback retirement with and without a waiting renderer, failed cancellation
followed by restart, owned cancellation racing with replacement, cancellation
without an active attempt racing with replacement, cancellation during callback consumption,
failed receipt persistence, stale callback reads followed by a new Google attempt,
queued cancellation followed by email or phone, and callback ownership conflicts.
Several schedules cover more than one of these transitions.

## Implementation and model mapping

| Observation | Quint projection |
| --- | --- |
| Serialized pending bytes read from the controlled store | `s.pending` |
| Actual callback handler accepts the matched state after durable CAS retirement | `callback`, `s.callbackAccepted` |
| Failed retirement retains the stored record and returns before exchange | `callbackBurnFailed` |
| Cancellation storage failure rejects the call and retains pending bytes | `cancelBurnFailed` |
| New plugin receives the retained callback and requests fresh native authorization | `restorePending`, then `callback` |
| Actual receipt write precedes credential write | `exchanged`, `writeReceipt`, then `writeKey` |
| Stored synthetic credential identity | `s.owner` and current attempt's `s.key` |
| HTTP acknowledgement count and receipt removal | `ack`, `s.ackTries`, `s.receipt` |
| Actual previous-key self-revocation result | `revokePrevious`, `s.revoked` |
| Finally-block Steward logout finishes | `releaseSteward` |

The current attempt's `key` projection distinguishes its new credential from the
previous credential represented by `owner`. A recovered acknowledgement has no
persisted previous-token capability. `restart` therefore clears `oldKey` while
keeping `revoked` false. Its recovered authenticated projection derives from the
matching stored key and retired acknowledgement receipt. Startup recovery does
not emit a new `signInCompleted` event.

Cold-return ownership is claimed under the cancellation lock, so a cancelled waiting callback cannot become a new cold attempt. A failed callback burn cannot reach the exchange endpoint. A failed cancellation
cannot report durable removal. It retains a process-local refusal fence and emits
a storage notice. Restart can recover the retained bytes, but the matching return
must still be durably retired and pass native authorization. The renderer test
executes its actual notice handler and checks delivery after an active operation
settles.

Cancellation captures the exact pending record at call admission. An owned Google
attempt already has its serialized record. With no owned record, cancellation
performs one bounded encrypted-slot read before queuing retirement. The worker
always retires that captured record through the existing
`AlphaCredentialStore.compareExchangeCredentialSlot` API, including when a new
email or phone attempt is active. A new record cannot be adopted or removed by an old queued cancellation. A callback
can attach only to the active attempt with the same serialized pending record.
A failed compare-and-exchange is ownership loss and leaves newer attempts alone.
This API uses `JsonCredentialSlots.LOCK` in the actual store. Its cross-instance guarantee
is process-local, as specified by the application architecture.

The current interactive attempt and a prior committed activation have separate
state. A held acknowledgement does not prevent the renderer from admitting the
next attempt after cancellation. That new Google record remains queued until the
serialized worker finishes the old acknowledgement and cleanup. `beginWork`
marks its durable write. Cancelled uncommitted workers retain a separate cleanup owner until their transient session is released. Old acknowledgement and cleanup transitions update only
the captured activation owner. `CurrentActivationProjection` checks the legacy
current-attempt fields whenever they refer to that same owner.

The two overlap schedules then cancel the new pending attempt, or receive its
callback and persist its receipt before cancelling its credential commit. Actual
restart preserves the first stored credential. One schedule also restarts while
the replacement pending record is still durable. These schedules observe the
old activation finishing without overwriting the new attempt or its receipt.

## Scope and remaining obligations

These are bounded orchestration traces and safety checks of a finite abstraction.
They do not prove universal refinement of the Android implementation. The adapter
binds all product, driver and support file hashes before execution and preserves
observations and selected transitions in its receipt.

Android activity presentation, App Link verification, primitive credential storage
and credential-intent tickets are controlled ports. The storage port models atomic
CAS and injected write/removal outcomes. The actual encrypted storage, Android
Keystore, process termination, cross-process writers and provider responses remain
separate integration obligations. No real credentials or network calls are used.

The native authorization routine executes with a controlled affirmative dialog
result. Arbitrary authorization timing, negative authorization, email/phone verification and MFA schedules,
acknowledged-but-failed receipt cleanup, expiry and all combinations of concurrent
callbacks remain outside these seventeen schedules. The existing finite model limits
attempts to two and acknowledgement rounds to three. The source fixture exercises
a full successful initial sign-in before every credential-replacement flow, so its stored
credential is produced by the implementation.
