# Reset orchestration refinement

The reset coordinator durably reserves each attempt before contacting the listener
or requesting Android package deletion. Main and recovery processes serialize the
reservation and effects with a device-protected file lock and a process mutex.
Contended locks defer immediately. Readback verifies the published bytes because
Android's atomic-file completion can log underlying write/rename failures without
throwing them. [AOSP AtomicFile](https://android.googlesource.com/platform/frameworks/base.git/+/master/core/java/android/util/AtomicFile.java)

A new authorized request writes its initial budget before committing its marker.
A repeated record preserves an existing request and its budget. Missing or corrupt
budgets behind legacy markers defer automatic attempts. Explicit recovery may
repair them, but it still requires a successful durable reservation. A readable
same-window budget is preserved by explicit retry. Crashing after reservation
consumes that slot. Failed reservation causes no listener or Android dispatch.
An exception after replacement preserves the observed committed state. If a
reservation committed before directory synchronization failed, its slot remains
consumed while the external action stays undispatched.

Authentication, budget initialization, marker commit, reservation, listener result,
Android result, recovery UI and process exit have distinct Quint transitions.
The `failures` field retains its legacy name and projects the admitted-attempt count
into zero, one, two and three-or-more. Raw source counters remain in trace evidence.
An already initialized process differs from admission of a subsequent process.
The pending marker blocks new initialization without rewriting that historical fact.

## Validation

```sh
node --test test/quint-reset-refinement.test.mjs
JAVA_HOME=/usr/lib/jvm/java-21-openjdk node --test test/reset-authorization.test.mjs test/reset-startup.test.mjs test/reset-cloud-revocation.test.mjs
node_modules/.bin/quint test specs/quint/native/ResetRecovery.qnt --backend=typescript --max-samples=1
```

The standalone runner compiles the actual `AlphaDataReset`, `AlphaApplication` and
`ResetAuthorization` sources. It reads literal Android ports from the existing
startup fixture without executing its test body. The file port supplies atomic
rename, failure before writing and interruption after commit. The trace adapter
observes every durable write and external callback and records before/after source
and driver hashes. A separate regression executes two real JVM processes racing for
one remaining durable attempt slot. It also covers legacy budgets, reservation
failure, crash recovery, overflow saturation, window boundaries and marker removal.

The final host campaign passed 20 source traces with 368 model checkpoints and 54
direct regression assertions. Every trace bound source and driver hashes before
execution and retained unchanged inputs. The existing reset tests and native
refinement/conformance suites passed. `ResetRecovery` has 15 scenario tests and
`ApplicationComposition` has 31. Both passed 1,000 simulation runs of 80 steps and
bounded symbolic safety through depth four. Reset safety also passed depth six.

The runner writes receipts and source traces under `test-results/quint-refinement`.
Those observations are bounded implementation correspondence. Real device
credentials, Binder identity, Android filesystem power-loss behavior and package
erasure remain platform evidence. Android acceptance never substitutes for an
external observation that package data was erased.
