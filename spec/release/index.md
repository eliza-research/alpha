# Release

How a new version of Alpha reaches phones. A main push builds an unsigned
candidate; it is mirrored privately, signed under a reviewed plan in a
protected environment, qualified for voice, and published on the update
channel that [Updates](../app/update/) reads: the APK first, its anonymous
download verified, and only then the manifest moved. A pilot phone can
also be updated by cable, [Pilot](./pilot.md). The OS image has its own
channel, [OS](./os.md).

## Story: Build a candidate

> As the release owner, I want every candidate numbered so that phones only
> ever move forward, and built without any signing authority.

### A release in flight is built, mirrored, planned, signed, delivered, qualified, uploaded, verified, published and recorded, or abandoned

A candidate's version is its build's workflow run number plus the fixed
launcher version base. Rerunning the build keeps that version. The floor is the last
recorded release, which starts at the retired channel's version 75 and
rises with every APK any writer retains on the channel. `pointer` is the
version the stable manifest was last read back to name, and `pointerRead`
says it was read back naming this release. Time is in hours.

```quint
type Stage =
  | NoCandidate | Built | Mirrored | Planned | Signed | Delivered | Qualified
  | Uploaded | Verified | Published | Recorded | Abandoned
type Channel = {
  stage: Stage, number: int, attempt: int, lastNumber: int, floor: int, pointer: int,
  plan: int, reviewed: bool, signers: int, rotation: bool,
  deliveredAt: int, qualifiedAt: int, uploadedAt: int, reused: bool, apkVerified: bool, pointerRead: bool,
}

pure val legacyFloor = 75
pure val receiptHours = 24
pure val initial: Channel = {
  stage: NoCandidate, number: 0, attempt: 0, lastNumber: 0, floor: legacyFloor, pointer: 0,
  plan: 0, reviewed: false, signers: 0, rotation: false,
  deliveredAt: 0, qualifiedAt: 0, uploadedAt: 0, reused: false, apkVerified: false, pointerRead: false,
}

pure def rank(stage: Stage): int =
  if (stage == Built) 1 else if (stage == Mirrored) 2 else if (stage == Planned) 3 else if (stage == Signed) 4
  else if (stage == Delivered) 5 else if (stage == Qualified) 6 else if (stage == Uploaded) 7
  else if (stage == Verified) 8 else if (stage == Published) 9 else if (stage == Recorded) 10 else 0

pure def inFlight(s: Channel): bool = rank(s.stage) >= 1 and rank(s.stage) <= 9
```

### A candidate is built only when none is in flight, numbered by a run above every run before it, the floor and the published version

A failed or cancelled run consumes its number, and so does a build its
verification found not distributable.

```quint
pure def canBuild(s: Channel, number: int, attempt: int, blockers: Blockers): bool =
  not(inFlight(s)) and number > s.lastNumber and number > s.floor and number > s.pointer and attempt >= 1
    and distributable(blockers)

pure def build(s: Channel, number: int, attempt: int, blockers: Blockers): Channel =
  { ...s, stage: Built, number: number, attempt: attempt, lastNumber: number, plan: 0, reviewed: false, signers: 0,
    rotation: false, deliveredAt: 0, qualifiedAt: 0, uploadedAt: 0, reused: false, apkVerified: false, pointerRead: false }
```

### A build its verification found not distributable is no candidate, and its run number is spent

```quint
pure def canRefuseBuild(s: Channel, number: int, blockers: Blockers): bool =
  not(inFlight(s)) and number > s.lastNumber and not(distributable(blockers))

pure def refuseBuild(s: Channel, number: int, blockers: Blockers): Channel = { ...s, lastNumber: number }
```

### A refused build can spend its number

```quint
pure def sometimesARefusedBuildSpentItsNumber(s: Channel): bool = s.stage == NoCandidate and s.lastNumber > 0
```

### A build is a candidate only when its verification recorded it distributable: no test mocks, the production bundle audit passed, Alpha's one signer, the runtime packaged with its notices, an on-device voice slot, and for an image its platform certificate

The verification of the APKs records, for each one, why it may not be
distributed. A build with any such reason is never mirrored, signed or
published. A candidate is built unsigned, so a signer other than Alpha's
one key blocks it but the missing signature does not; once it is signed,
its verification must record it signed by that key and distributable
before it is delivered.

```quint
type Blockers = {
  mocks: bool, audit: bool, signer: bool, runtime: bool, notices: bool, voice: bool, platform: bool, upstream: bool,
}

pure val clear: Blockers = {
  mocks: false, audit: false, signer: false, runtime: false, notices: false, voice: false, platform: false, upstream: false,
}

pure def distributable(b: Blockers): bool = b == clear
```

### Any one blocker keeps a build from being a candidate

```quint
pure def lawAnyBlockerKeepsTheBuildBack(blockers: Blockers): bool =
  (blockers.mocks or blockers.audit or blockers.signer or blockers.runtime or blockers.notices or blockers.voice or blockers.platform
    or blockers.upstream) implies not(distributable(blockers))
```

### A candidate is built only from an eliza pin that the branch its lock names reaches, by a compare made for exactly that pin

The build reads eliza from the commit `eliza.lock.json` pins. Before the
build becomes a candidate, the release owner's compare of that commit with
the lock's branch is recorded: the pin must be the compare's base, on the
same remote and branch, and the branch must contain it. A compare made for
another commit or branch blocks the build as an unreached pin does.

```quint
type Compare = { forThePin: bool, reached: bool }

pure def upstreamBlocks(compare: Compare): bool = not(compare.forThePin and compare.reached)

pure def lawAnUnreachedPinIsNoCandidate(compare: Compare): bool =
  upstreamBlocks(compare) implies not(distributable({ ...clear, upstream: upstreamBlocks(compare) }))
```

### A rerun keeps its number and takes a new attempt, before signing only

```quint
pure def canRerun(s: Channel): bool = s.stage == Built or s.stage == Mirrored or s.stage == Planned

pure def rerun(s: Channel): Channel = { ...s, attempt: s.attempt + 1 }
```

### A run number is never used twice

```quint
pure def stepARunIsNeverReused(before: Channel, via: str, after: Channel): bool =
  after.lastNumber >= before.lastNumber and (via == "build" implies after.number > before.lastNumber)
```

### A candidate can be abandoned before it is published

```quint
pure def canAbandon(s: Channel): bool = inFlight(s) and s.stage != Published

pure def abandon(s: Channel): Channel = { ...s, stage: Abandoned }
```

## Story: Sign a release

> As the release owner, I want a release signed only from a plan I
> reviewed, for the exact build I reviewed, with Alpha's one key.

### The candidate is mirrored privately, creating the object only if it is absent, or reusing one whose bytes read back the same

```quint
pure def canMirror(s: Channel, existing: bool, sameBytes: bool): bool =
  s.stage == Built and (not(existing) or sameBytes)

pure def mirror(s: Channel, existing: bool, sameBytes: bool): Channel = { ...s, stage: Mirrored }
```

### A signing plan names the attempt it was made from, and is reviewed before use

```quint
pure def canMakePlan(s: Channel, attempt: int): bool = s.stage == Mirrored and attempt >= 1

pure def makePlan(s: Channel, attempt: int): Channel = { ...s, stage: Planned, plan: attempt, reviewed: false }

pure def canReview(s: Channel): bool = s.stage == Planned and not(s.reviewed)

pure def review(s: Channel): Channel = { ...s, reviewed: true }
```

### Signing happens only in the protected environment, from the reviewed plan of the same attempt, with one signer and no key rotation

```quint
pure def canSign(s: Channel, guarded: bool, signers: int, rotation: bool): bool =
  s.stage == Planned and s.reviewed and guarded and s.plan == s.attempt

pure def oneKey(signers: int, rotation: bool): bool = signers == 1 and not(rotation)

pure def sign(s: Channel, guarded: bool, signers: int, rotation: bool): Channel =
  if (oneKey(signers, rotation)) { ...s, stage: Signed, signers: signers, rotation: rotation }
  else { ...s, stage: Abandoned }
```

### A signed release came from a reviewed plan of its own attempt

```quint
pure def alwaysSignedFromTheReviewedPlan(s: Channel): bool =
  rank(s.stage) >= 4 implies (s.reviewed and s.plan == s.attempt)
```

### A signed release has one signer and no rotation

Phones still on the retired signer are wiped and installed again, never
upgraded in place.

```quint
pure def alwaysOneSignerNoRotation(s: Channel): bool =
  rank(s.stage) >= 4 implies oneKey(s.signers, s.rotation)
```

### The protected keys are proven to be the enrolled ones: each of the nine OS certificates, the two verified-boot keys and Alpha's app key pairs with its committed public identity, none is a test key, and no two are the same

The release owner runs the proof in the protected environment, on memory
that never reaches a disk, before the keys sign anything; it reads only the
key archive and Alpha's keystore, and writes only what is already public.

```quint
type Custody = { pairs: int, matching: int, distinct: bool, testKeys: bool }

pure val custodyKeys = 12

pure def custodyProven(c: Custody): bool =
  c.pairs == custodyKeys and c.matching == custodyKeys and c.distinct and not(c.testKeys)

pure def lawARepeatedKeyIsNoCustody(custody: Custody): bool = not(custodyProven({ ...custody, distinct: false }))
```

### A plan can name a stale attempt after a rerun

```quint
pure def sometimesAStalePlan(s: Channel): bool = s.stage == Planned and s.reviewed and s.plan != s.attempt
```

## Story: Qualify and publish a release

> As the release owner, I want a release published only after its signed
> bytes passed voice qualification, and phones told about it only once
> anyone can download exactly those bytes.

### Signing delivers the release privately with a receipt that expires after a day

```quint
pure def canDeliver(s: Channel): bool = s.stage == Signed

pure def deliver(s: Channel, now: int): Channel = { ...s, stage: Delivered, deliveredAt: now }

pure def receiptValid(s: Channel, now: int): bool = now >= s.deliveredAt and now < s.deliveredAt + receiptHours
```

### Voice qualification of the exact signed APK is recorded while the receipt is valid; a failure abandons the release

```quint
pure def canQualify(s: Channel, now: int): bool = s.stage == Delivered and receiptValid(s, now)

pure def qualify(s: Channel, now: int, passed: bool): Channel =
  if (passed) { ...s, stage: Qualified, qualifiedAt: now } else { ...s, stage: Abandoned }
```

### An APK is admitted to the channel only as Alpha's launcher, first signed by Alpha's one key, at the candidate's version, not debuggable, of at most 2 GiB, and with only the entries a release may hold

```quint
type Apk = { launcher: bool, signer: bool, version: int, debuggable: bool, bytes: int, entries: bool }

pure val maxApkBytes = 2147483648

pure def admitted(a: Apk, number: int): bool =
  a.launcher and a.signer and a.version == number and not(a.debuggable) and a.bytes > 0 and a.bytes <= maxApkBytes and a.entries
```

### A debuggable APK is never admitted

```quint
pure def lawADebuggableApkIsRefused(apk: Apk, number: int): bool = apk.debuggable implies not(admitted(apk, number))
```

### The APK is uploaded while the receipt is valid, above the floor and the published version; one already on the channel is never overwritten, only reused

A delivery that failed half way is retried with the same candidate: the APK
it left is reused, never uploaded again or replaced, and read back like a
new one, so a damaged one never verifies and that release is abandoned for
a higher version. Only an admitted APK is uploaded.

```quint
pure def canUpload(s: Channel, now: int, existing: bool, apk: Apk): bool =
  s.stage == Qualified and receiptValid(s, now) and s.number > s.floor and s.number > s.pointer and admitted(apk, s.number)

pure def upload(s: Channel, now: int, existing: bool, apk: Apk): Channel = { ...s, stage: Uploaded, uploadedAt: now, reused: existing }
```

### An APK the channel already kept is verified like a new upload before the manifest names it

```quint
pure def alwaysAReusedApkIsVerifiedFirst(s: Channel): bool = (s.reused and rank(s.stage) >= 9) implies s.apkVerified
```

### Qualification and upload both happen before the receipt expires

```quint
pure def alwaysWithinTheReceipt(s: Channel): bool =
  (rank(s.stage) >= 6 implies (s.qualifiedAt >= s.deliveredAt and s.qualifiedAt < s.deliveredAt + receiptHours))
    and (rank(s.stage) >= 7 implies (s.uploadedAt >= s.deliveredAt and s.uploadedAt < s.deliveredAt + receiptHours))
```

### The anonymous download must return the exact size and digest before anything else moves

Every read of the channel is anonymous, over HTTPS: a redirect to plain
HTTP or to an address that carries credentials is refused, and no answer is
read past its bound, 64 KiB for a manifest and 2 GiB for an APK.

```quint
pure def canVerifyDownload(s: Channel): bool = s.stage == Uploaded

pure def verifyDownload(s: Channel, exact: bool): Channel =
  if (exact) { ...s, stage: Verified, apkVerified: true } else s
```

### Another writer can retain a newer APK or move the manifest at any time, and the manifest never names an older version

```quint
pure def canRetainElsewhere(s: Channel, version: int): bool = version > s.floor

pure def retainElsewhere(s: Channel, version: int): Channel = { ...s, floor: version }
```

### The manifest is moved only after the download was verified, with the APK still in the channel's final inventory, the channel unchanged since publishing began, and the version above the floor and the published version as they are then

```quint
pure def canMovePointer(s: Channel, present: bool, unchanged: bool): bool =
  s.stage == Verified and present and unchanged and s.number > s.floor and s.number > s.pointer

pure def movePointer(s: Channel, present: bool, unchanged: bool): Channel = { ...s, stage: Published, pointerRead: false }
```

### Reading the manifest back settles it: naming this release confirms it, naming an older one sends the same candidate back to repair it, and naming a newer one means another release overtook this one

The version the manifest names only ever rises.

```quint
pure def canReadBack(s: Channel, named: int): bool = s.stage == Published and not(s.pointerRead) and named >= s.pointer

pure def readBack(s: Channel, named: int): Channel =
  if (named == s.number) { ...s, pointer: named, pointerRead: true }
  else if (named < s.number) { ...s, stage: Verified, pointer: named }
  else { ...s, stage: Abandoned, pointer: named, floor: if (named > s.floor) named else s.floor }
```

### The manifest names a version only once its APK was verified

```quint
pure def alwaysThePointerFollowsTheDownload(s: Channel): bool =
  rank(s.stage) >= 8 implies s.apkVerified
```

### The published version only advances, and this release moves it only from above the floor and the published version

```quint
pure def stepThePublishedVersionOnlyAdvances(before: Channel, via: str, after: Channel): bool =
  after.pointer >= before.pointer
    and (via == "movePointer" implies (before.number > before.floor and before.number > before.pointer))
```

### The channel's retained APKs raise the floor: a candidate is numbered, and a release published, only above every APK any writer keeps there

`alpha-phone-<version>.apk` names each APK the channel keeps, whoever
uploaded it; the highest is read before a candidate is built and again
before an upload, as `retainElsewhere`.

```quint
pure def retainedFloor(versions: List[int]): int = versions.foldl(0, (top, v) => if (v > top) v else top)

pure def lawTheFloorIsAtLeastEveryRetainedApk(versions: List[int]): bool =
  versions.every(v => v <= retainedFloor(versions))
```

### The floor never falls

```quint
pure def stepTheFloorNeverFalls(before: Channel, after: Channel): bool = after.floor >= before.floor
```

### Recording the release raises the floor to its version, only once the manifest was read back naming it

```quint
pure def canRecord(s: Channel): bool = s.stage == Published and s.pointerRead

pure def record(s: Channel): Channel = { ...s, stage: Recorded, floor: if (s.number > s.floor) s.number else s.floor }

pure def alwaysRecordedAfterReadBack(s: Channel): bool =
  s.stage == Recorded implies (s.pointerRead and s.floor >= s.number and s.pointer == s.number)
```

### A manifest names the release by a version name of 1 to 64 characters with no control character, and by notes of at most 500, as phones show them

A name or notes a phone would not show are refused when the manifest is
written, not published for phones to drop.

```quint
pure val maxName = 64
pure val maxNotes = 500

pure def manifestNamed(name: int, control: bool, notes: int): bool = name >= 1 and name <= maxName and not(control) and notes <= maxNotes

pure def lawOverlongNotesAreRefused(name: int, notes: int): bool = notes > maxNotes implies not(manifestNamed(name, false, notes))
```

### The channel is healthy only while its manifest names a launcher of Alpha's one key, above the retired channel and the last recorded release, at an address it keeps, served with exactly its size and digest

`pnpm release status` reads the channel anonymously, as a phone does.

```quint
type Served = { launcher: bool, signer: bool, version: int, recorded: int, kept: bool, exact: bool }

pure def channelHealthy(c: Served): bool =
  c.launcher and c.signer and c.version > legacyFloor and c.version >= c.recorded and c.kept and c.exact

pure def lawAnotherSignerIsUnhealthy(served: Served): bool = not(channelHealthy({ ...served, signer: false }))
```

### Phones read the launcher channel from the stable release of Alpha's repository, eliza-research/alpha, known by its permanent id; APKs kept under the repository's earlier names stay valid

The manifest is `alpha-update-stable.json` under the release tagged
`app-stable-alphacompute`, and each APK is `alpha-phone-<version>.apk`
beside it. A manifest still names an APK by an address of
eliza-research/alphaphone, alphacompute/alpha or alphacompute/alphaphone
where an earlier writer kept one, and the retired `app-stable` tag is read
for those phones only.

```quint
pure val channelRepository = "eliza-research/alpha"
pure val channelRepositoryId = 1396333361
pure val channelTag = "app-stable-alphacompute"
pure val retiredTag = "app-stable"
pure val channelManifest = "alpha-update-stable.json"
pure val earlierRepositories = Set("eliza-research/alphaphone", "alphacompute/alpha", "alphacompute/alphaphone")

pure def keptBy(repository: str): bool = repository == channelRepository or earlierRepositories.contains(repository)
```

### A manifest read back as naming this release names exactly it

Discovered by the proof: without it, a release could be recorded while the
manifest named another version.

```quint
pure def alwaysAReadBackNamesThisRelease(s: Channel): bool =
  s.pointerRead implies (s.pointer == s.number and (s.stage == Published or s.stage == Recorded))
```

### A release can be recorded

```quint
pure def sometimesRecorded(s: Channel): bool = s.stage == Recorded
```

### A published release can wait for its read-back

```quint
pure def sometimesAwaitingReadBack(s: Channel): bool = s.stage == Published and not(s.pointerRead)
```

### A manifest that did not take can be repaired by the same candidate

```quint
pure def sometimesRepaired(s: Channel): bool = s.stage == Verified and s.pointer > 0 and s.pointer < s.number
```

### Another release can overtake this one

```quint
pure def sometimesOvertaken(s: Channel): bool = s.stage == Abandoned and s.pointer > s.number
```

## Story: Read back a phone that updated itself

> As the release owner, I want proof that a phone took the published
> release over the air by itself, in place, without losing Home.

### A phone updated itself only when it kept its install, runs the offered version with the offered APK's exact bytes, Alpha started the install, and Home and the offer did not change

The release owner reads the phone by cable, without changing it, before and
after it takes the release the channel offers: the same install (its app id
and first install time), the version advanced to the offer's, the installed
APK's digest the offer's, Android naming Alpha as the install's initiator,
Alpha still Home, and the public offer the same at both reads.

```quint
type Readback = { sameInstall: bool, advanced: bool, exact: bool, selfInitiated: bool, homeKept: bool, offerKept: bool }

pure def updatedItself(r: Readback): bool =
  r.sameInstall and r.advanced and r.exact and r.selfInitiated and r.homeKept and r.offerKept

pure def lawAnInstallAnotherProgramStartedIsNoSelfUpdate(readback: Readback): bool =
  not(updatedItself({ ...readback, selfInitiated: false }))
```

### What the simulator tries

```quint
pure val numberValues = Set(70, 76, 77, 78)
pure val blockersValues = Set(clear).union(Set({ ...clear, mocks: true })).union(Set({ ...clear, voice: true }))
pure val apkValues =
  Set({ launcher: true, signer: true, version: 77, debuggable: false, bytes: 4096, entries: true })
    .union(Set({ launcher: true, signer: true, version: 78, debuggable: false, bytes: 4096, entries: true }))
    .union(Set({ launcher: true, signer: true, version: 77, debuggable: true, bytes: 4096, entries: true }))
pure val attemptValues = Set(1, 2)
pure val signersValues = Set(1, 2)
pure val nowValues = Set(0, 10, 23, 24, 30)
pure val versionValues = Set(76, 77, 79)
pure val namedValues = Set(0, 76, 77, 78, 80)
pure val versionsValues = Set(List(), List(76, 80), List(80, 76, 79))
pure val servedValues = Set({ launcher: true, signer: true, version: 80, recorded: 79, kept: true, exact: true }, { launcher: true, signer: false, version: 80, recorded: 79, kept: true, exact: true })
pure val tookIt: Readback = { sameInstall: true, advanced: true, exact: true, selfInitiated: true, homeKept: true, offerKept: true }
pure val compareValues = Set({ forThePin: true, reached: true }, { forThePin: true, reached: false }, { forThePin: false, reached: true })
pure val custodyValues = Set({ pairs: 12, matching: 12, distinct: true, testKeys: false }, { pairs: 12, matching: 11, distinct: true, testKeys: false })
pure val readbackValues = Set(tookIt).union(Set({ ...tookIt, selfInitiated: false })).union(Set({ ...tookIt, sameInstall: false }))
pure val weight_build = 3
pure val weight_mirror = 4
pure val weight_makePlan = 4
pure val weight_review = 4
pure val weight_sign = 6
pure val weight_deliver = 4
pure val weight_qualify = 6
pure val weight_upload = 6
pure val weight_verifyDownload = 4
pure val weight_movePointer = 4
pure val weight_readBack = 4
pure val weight_record = 3
```
