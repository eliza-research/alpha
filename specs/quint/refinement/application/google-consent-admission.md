# Google consent admission

`GoogleConsentAdmission` follows the mounted Google connections panel from an
account read to a consent dispatch. A readback belongs to the current Cloud
binding and the latest list or revoke request. Settings consent preserves the
held Gmail grant tier with a send floor. Calendar consent uses a read floor
and checks that its captured readback still owns admission after the device
permission continuation.

Sixteen source schedules compare 100 checkpoints. They run the actual panel,
return watcher and shared Gmail grant rules with deferred account and
preference ports. The observations come from actual list requests, returned
row identities, panel state, permission calls and provider arguments. They
cover failed and superseded lists, owner replacement, close and reopen,
unknown revoke readback, and an explicit Allow after a saved-off choice.

The model bounds two Cloud bindings, six reads, three grant tiers, four
consent dispatches and one held permission continuation. It covers consent
admission and the synthetic browser handoff. Real OAuth, native callback
persistence, linked Calendar writes, permission persistence failures and
overlapping permission requests remain separate obligations.

```sh
node --test test/quint-google-consent-admission.test.mjs
```
