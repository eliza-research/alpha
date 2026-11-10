# Combined agent and phone process restart campaign

Historical design record. The restart wrapper described here was removed on October 8 with the other aggregate smoke runners, at the owner's request, and this campaign has no current repository runner. The instrumentation class remains; running it requires a new reviewed host-side runner. Prepared source only; not compiled or executed by that task. Since then the class has been compiled into both instrumentation APKs with the rest of the androidTest source (for example the round 8 developer builds and the Gradle compile of the MVP completion integration); it has never been executed. This is a separate opt-in campaign, preserving the existing CombinedAgentInstrumentedTest and production sources.

`CombinedAgentRestartInstrumentedTest` has three explicit methods, each gated by `combinedAgentRestart=1` and `restartPhase=prepare|verify|cleanup`. The runner invokes the exact method so skipped phases cannot masquerade as acceptance. The removed wrapper had passed `node --check`; Android compilation has happened since (see above) and real execution is still pending.

## Preparation

The separate test repeats the existing one-session campaign using a fresh, controlled fixture: normal owner pairing; actual Cerebras response; explicitly approved native note and durable journal; synthetic recording ingress through real paired Whisper/Kokoro; reviewed arithmetic execution; canonical workflow approval and one test-owned file effect; metadata response-loss reconciliation; removal/history/paused restore. No private microphone recording is used.

After these succeed it retains a private checkpoint containing process ID, credential/enrollment hashes, original nonsecret selection and fixture identity. It does not copy a credential/token into the checkpoint. It removes the consumed pairing code from its private fixture configuration. The previous connection is restored only in the final cleanup phase.

## Actual restart boundary

The wrapper requires `ALPHA_COMBINED_ALLOW_RESTART=1`, an explicit disposable emulator, exact archived app/test APKs, reviewed source manifest, private owner-session file, the same combined profile and all explicit launcher runtime/voice asset inputs. It checks source content, profile marker, target PID command, config/session hashes and pinned Node/Bun. It waits for all fixture effects to become terminal before restarting.

It force-stops only the target Android app, sends SIGTERM only to the manifest-bound47858 host, waits for that PID to exit and launches the same reviewed entrypoint/profile through `start-combined-agent.ts`. It never escalates to SIGKILL automatically. Existing40/44/46/48/50/54/56 services are untouched. It keeps proxy47859 for both phases and performs no reinstall or data clearing between preparation and verification. The restarted combined host remains available afterward.

The wrapper requires changed host and Android PIDs, identical source/config/owner-session/voice asset identities, normal owner session validation, and truthful Whisper/Kokoro readiness. This is graceful process restart proof, not crash-mid-effect, OS reboot, microphone quality, voice playback after restart, HOME-role, Cloud or enclave acceptance.

## Verification without replay

The second native process restores normally. It must preserve the exact paired credential and enrollment hashes, display the same note through the actual Notes UI, inspect its terminal native journal, restore the same canonical conversation through history controls, and display the same terminal execution and approved receipt. The host wrapper independently compares exact canonical execution, metadata mutation, lifecycle mutation and conversation payloads before and after restart. The owned effect file still contains exactly one line and the workflow still has exactly one run.

During verification the proxy records authenticated GET evidence and rejects/counts every attempted mutation except the normal idempotent `/api/client-devices/register` handshake. Any attempted replay fails the campaign, including pairing, chat, decisions, claims, receipts, synthesis/transcription, workflow runs or mutations. Repeated registration must preserve installation/key/enrollment identity; no new pairing is allowed.

## Run and cleanup

The removed wrapper took the reviewed launcher environment (`ALPHA_NODE_BIN`, `ALPHA_BUN`, `ALPHA_COMBINED_SOURCE`, `ALPHA_COMBINED_SOURCE_MANIFEST`, `ALPHA_COMBINED_PROFILE`, `ELIZA_INFERENCE_LIBRARY`, `ELIZA_KOKORO_MODEL_DIR`, `ELIZA_WHISPER_BINARY`, `ELIZA_WHISPER_MODEL`, `ELIZA_WHISPER_BINARY_SHA256`) plus `ANDROID_SERIAL`, `ALPHA_BUILD_ARCHIVE`, `ALPHA_COMBINED_OWNER_SESSION` and `ALPHA_COMBINED_ALLOW_RESTART=1`. Any replacement runner must keep the cleanup rules below.

The wrapper always requested native cleanup, which verifies ownership before removing its paired credential/enrollment and exact synthetic note, then restores the original selection. Host cleanup validates each exact fixture definition, cancels only its own unfinished executions and waits for terminal state before deleting the owned effect directory. Failed cleanup preserves evidence and marks acceptance failed. An interrupted runner may leave the private checkpoint for explicit cleanup; never overwrite it or clear app data to make the test pass.

Evidence is written under the selected archive's `combined-agent-restart` directory: prepare, verify and cleanup instrumentation outputs, source/APK hashes, process IDs, zero-replay assertions and final host cleanup status. No credentials or pairing codes are written to public artifacts.

## Initial campaign failure retained (Build76)

The original standalone combined campaign reached real chat, approved native note, real paired Whisper/Kokoro and reviewed workflow execution, then timed out waiting for approval UI confirmation. Launcher was not run. Its artifacts remain at `test-results/prototype-build76-unconfigured/combined-agent`. A read-only authenticated inspection found the exact approval fixture run `70a68e6e-0cf9-454b-9109-06435379430e` finished with canonical `write-fixture` iteration0 approved. Thus missing/expired approval is not supported by the evidence; a delayed/lost response leaving the existing unknown-decision state is plausible but was not directly captured in the old UI.

Build77 test source changes both campaigns to use the actual Refresh execution receipt control for bounded GET-only reconciliation after the single confirmation. Both wrappers count every incoming exact approval POST attempt and require exactly one. Live allowlisted progress labels identify review, confirmation and reconciliation separately. This is source/node-syntax evidence only until the new APKs and campaign run; it does not convert Build76 into a pass.
