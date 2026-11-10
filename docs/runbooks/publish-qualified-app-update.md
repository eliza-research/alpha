# Publish an exact qualified launcher update

The `Publish qualified launcher update` workflow closes the private signed-output
to public OTA publication step. It is available only by dispatch from reviewed
Alpha `main`, with the exact workflow commit, and uses the existing protected
`release` environment. It has not been dispatched by the implementation campaign.

This route supports the existing **Cloud, public-channel, privateStorage** signing
plan from `release-cloud-app-signing.yml`. It reuses that plan's reviewed private
producer receipt and exact unsigned input object generation. It also binds the
exact successful signing workflow commit, run, attempt, delivery-artifact ID and
digest, and the signed output's object generation and digest. CMS envelopes are
rejected; the recipient private key never enters this workflow.

The bridge preserves the current Cloud producer limits (400 MB per APK, 512 MiB
producer evidence, 1.5 GB archive), so it is not a native speech-model release
path. The application updater's separate 2 GiB APK limit does not change these
producer/signing limits.

## Prepare the reviewed record

Finish signing and real Cloud voice qualification first. Keep the original
`signing-plan.json`, `private-storage-receipt.json` and content-free voice receipt
outside source control. Obtain the delivery artifact ID, archive digest and byte
length from the exact signing run. Its name is
`private-cloud-apk-delivery-<run-id>-<run-attempt>`; the bridge accepts only the
private storage receipt from that artifact, not arbitrary workflow files.

Create one JSON object with these exact fields:

| Field | Required value |
| --- | --- |
| `schema` | `alpha-qualified-app-update/v1` |
| `signingWorkflowCommit` | Exact reviewed main commit used by the signing workflow |
| `signingRunId`, `deliveryArtifactId` | Decimal GitHub IDs as strings |
| `signingRunAttempt` | Exact positive integer attempt |
| `deliveryArtifactSHA256`, `deliveryArtifactBytes` | GitHub delivery ZIP archive digest and byte count |
| `signingPlanBase64`, `signingPlanSHA256` | Base64 and SHA-256 of the original signing-plan bytes |
| `signedBundle` | Exact parsed `private-storage-receipt.json`: `bucket`, `object`, `generation`, `bytes`, `sha256`, `public: false` |
| `signedApkSHA256` | Exactly `launcher` and `standalone`, naming the post-signing APK hashes from `signed.sha256` |
| `cloudVoiceEvidenceBase64`, `cloudVoiceEvidenceSHA256` | Base64 and SHA-256 of the original voice-receipt bytes |

The existing voice receipt uses `format: alpha-cloud-voice-qualification-v1` and
one result per exact signed APK. Each result has only `apkSha256`,
`provider: cartesia`, `outcome: passed` and `checks`; every existing check must
actually pass: consent, session, acousticInput, blueBar, transcript,
audibleSpeakerReply, mute, unmute and stopReleased. The bridge refuses extra
fields, including transcripts, credentials, identities and recorded audio.
Never change a failed result to make admission pass.

The embedded receipt is an external qualification assertion selected by the
reviewer. Hash binding prevents substitution; it does not authenticate a
microphone recording or prove that someone performed the checks. Protected
environment review remains the qualification authority for this route.

The protected job requests a short-lived storage token through the reviewed
[private artifact identity](private-artifact-identity.md). No storage token is
copied into an environment secret or qualification record. The identity can read
the private unsigned and signed object prefixes; only the signing job creates a
new signed output. Exact generation and digest checks still select the reviewed
objects. Preserve those generations until publication finishes; the signing
delivery artifact currently expires after one day.

## Dispatch and review

Dispatch `publish-qualified-app-update.yml` on `main`, supplying
`workflow_commit` equal to that exact checked-out main SHA and the reviewed JSON
as `qualification`. The unprotected admission job uses read-only GitHub access
to check source ancestry, signing-run identity and the pinned receipt artifact.
It does not read private APK objects or receive release keys.

Before approving `release`, compare the record's source, signed APK hashes,
private delivery receipt and actual voice results. The protected job repeats
admission, restores the exact producer inputs and signed APKs into the exact
source checkout, and runs:

```sh
node scripts/verify-apks.mjs --runtime-profile=cloud \
  --cloud-voice-evidence=<restored-original-receipt.json>
```

Both release rows must be distributable and match the reviewed APK and voice
digests. The reviewed publication code then runs
`node scripts/deliver-app-update.mjs --variant launcher --apk-manifest <verified-manifest>`.
Its independent archive/channel/signer/version checks remain active. It uploads
the APK first, verifies anonymous bytes, moves the manifest last, and records
readback. Only the protected job has repository write permission; it receives no
signing key or CMS decryption key.

The workflow serializes `app-stable` publication. Do not run a local publisher
concurrently. GitHub asset replacement is not atomic; a failed pointer write is
an uncertain publication, not success. Inspect the retained versioned assets and
retry the exact same candidate. Do not lower versions or replace an existing APK.

The public artifact `qualified-launcher-publication-<run>-<attempt>` retains only
the content-free qualification summary and delivery receipt for 30 days. A
qualification summary explicitly says `published: false`; only a successful
delivery receipt establishes anonymous public readback.

This does not automatically turn every source push into a release: current Cloud
producer and signing admission still require reviewed dispatches, and each exact
signed APK still needs voice qualification. Automatic candidate builds or
machine-authenticated device QA would be separate changes. Actual phone update,
retained data, HOME, runtime and user acceptance remain the handoff checks after
publication.
