# Browser Read aloud: proposed bounded flow

This is source review and implementation planning only. The live browser adapter currently maps Read aloud to an honest unavailable message. The prototype model only closes the menu and toasts “Reading aloud”; it has no article extraction, audio or consent flow. No page content is currently sent by that control.

Existing reusable transport is `apps/app/src/runtime/paired-voice.ts`: it captures the selected paired origin/owner/session/expiry, probes readiness and calls native `AlphaVoiceCloud.synthesizePaired`, then actual private MediaPlayer playback. Native `AlphaVoiceCloudPlugin` reads encrypted credentials, validates binding, bounds text to5000characters and audio size, refuses redirects/insecure production origins, and cancels network/playback on Activity pause/destruction. Connection chooser opening, account changes and explicit abort also cancel through the adapter. These mechanisms should be reused rather than adding a browser fetch or exposing a bearer to the child WebView.

## Proposed user flow

1. User selects the existing Menu → Read aloud control on a committed visible HTTPS page. As with sharing, close the menu and require the same native session/tab/navigation/current URL before proceeding. Loading, errors, hidden tabs, media/PDF and missing paired TTS capability produce a truthful unavailable reason.
2. Native code evaluates a fixed extractor in that exact child document, without installing a JavaScript bridge. Extract plain rendered article/main text, falling back to bounded visible body text. Exclude script/style/template, form/input/textarea/select, password fields, contenteditable, hidden/aria-hidden content, nested browsing contexts and navigation controls. Walk with node-count and character bounds; do not read cookies, localStorage, HTML markup or fetch another URL. DOM text is untrusted content, never agent instructions.
3. Hold a bounded immutable text snapshot in the native browser owner with an opaque token. Recheck tab/navigation/current URL after the asynchronous extraction callback. Reject stale results and discard text. A same-document dynamic change does not authorize a different payload: the eventual request must use the exact reviewed snapshot.
4. Present an explicit local review showing source origin/title, selected agent destination, the complete text to be sent (scrollable, plain text), character count and any truncation. Say that pressing **Read with selected agent** sends this text to that agent for speech. Initial extraction and Cancel send nothing. Never claim an arbitrary remote paired agent processes locally merely because its endpoint calls the provider “local.” At most5000characters initially; no silent continuation/chunk uploads.
5. Only confirmation sends the immutable snapshot through the existing paired TTS transport. Bind approval to the same owner/session, source tab/navigation and extraction token. Hide/cancel review on navigation, tab switch, account/chooser change, leaving Browser, mock entry, host reload or app background. Reject replay of an expired token. Reading availability probes send no article content.
6. During synthesis/playback the same reference menu control becomes Stop reading, with a concise visible status and actual stop/cancellation. Completion retires the snapshot/audio and returns to normal state. Errors retain no background retry and make an explicit retry require fresh review. No article text enters chat history, agent context, analytics or logs.

A native review sheet/dialog is appropriate for the explicit data transfer boundary; preserve existing browser chrome and menu geometry. Cloud and Android system TTS can be separate future capabilities. Do not silently switch providers or route private text to Cloud when the selected paired agent is unavailable.

## Meaningful acceptance plan

Use a real native child document with synthetic visible article text and distinct hidden/form/password/storage canaries. An owned fixture HTTPS origin or instrumentation-injected public-document DOM is acceptable if clearly labeled; do not claim it is publisher-provided content. Require actual extracted snapshot content, exclusions and bounded truncation, exact displayed consent text, zero requests before confirmation/after Cancel, then an actual paired endpoint receipt containing exactly the approved synthetic text and real decoded playback completion. A synthetic transport fixture can prove request isolation, but a separate combined-host run must prove real Kokoro audio; intelligibility remains separately measured by the host roundtrip.

Exercise navigation between extraction callback and review, DOM text mutation after review, account replacement before confirmation, tab switch during synthesis, Stop during playback, Activity pause, host reload, stale token replay and provider503. Require actual transport abort and private audio/snapshot cleanup, not just ignored renderer results. Confirm original page/form state unchanged and `typeof Capacitor==='undefined'` in the child. Restore/remove exact owned fixture canaries. Run standalone and launcher against matching archived APKs; no native execution or implementation is claimed by this plan.

## Source implementation checkpoint (2026-09-30; native execution pending)

`BrowserReading.java` now implements the fixed bounded extractor, an immutable
native snapshot, a two-minute approval lifetime and a native review showing the
complete plain text, source host, paired origin and owner. Traversal prunes forms,
editable/hidden controls and nested browsing surfaces before reading text. It
never reads storage, field values, HTML markup or another URL. A native **Stop
reading** dialog remains available during synthesis/playback. This is an added
review/transfer boundary; the prototype browser menu geometry is unchanged.

The renderer receives only an opaque, single-use approval token. The narrow
`AlphaVoiceCloud.synthesizeBrowserReading` path consumes it on the main thread
against the exact native document and selected paired binding before the existing
native credential lookup and bounded HTTP/audio pipeline. Navigation, hidden
surface, tab disposal, host replacement, pause, expiry, selected-agent change and
explicit Stop cancel the review/request/playback. Article text never enters the
renderer, chat or agent context. A same-document mutation cannot substitute new
text after the review. Errors require a fresh review; there is no auto retry.

`BrowserReadingInstrumentedTest`, gated by `browserReading=1`, is ready for the
root-owned APK campaign. It uses a disclosed synthetic article injected into a
real HTTPS child and an ephemeral authenticated local HTTP fixture returning a
synthetic WAV. It checks explicit preview, excluded canaries, zero transfer on
Cancel, immutable approved text after DOM mutation, exact one POST, actual
MediaPlayer completion, single-use rejection and exact fixture cleanup. It does
**not** establish Kokoro intelligibility, current combined-host receipt, production
Cloud service, physical-device acceptance or universal extraction quality.

A bounded TypeScript check passed after the source addition. Native build and
execution have not been run for this checkpoint. Remaining qualification must
cover a real combined-host request and cancellation during a delayed response,
wrong owner/session, navigation while extraction is pending, background/host
reload, truncation, unusual CSS visibility and failure recovery in both variants.

### Prepared combined-host campaign

`BrowserReadingLiveInstrumentedTest` and
`scripts/android-browser-reading-live.ts` are a separate **unexecuted** campaign.
The wrapper requires `ANDROID_SERIAL`, `ALPHA_BUILD_ARCHIVE`,
`ALPHA_COMBINED_OWNER_SESSION` and `ALPHA_COMBINED_SOURCE_MANIFEST`; it verifies
archived APK hashes and the running combined source manifest before opening a
bounded proxy at port 47861 for host 47858. It neither starts nor restarts an
agent. Root owns execution and must serialize this with other native/voice work.

The test normally pairs via the chooser, invokes the actual browser Menu → Read
aloud adapter, cancels once without a speech POST, approves one immutable
synthetic article and awaits real Kokoro MediaPlayer completion. For a second
approved request the proxy buffers the actual successful WAV response. The test
presses the native Stop reading control, requires the HTTP connection to close,
and verifies no late playback and no retained private playback file/player. The
proxy records bounded audio hashes/lengths, exact synthetic text equality and a
late response attempt after cancellation. Pairing/enrollment are isolated to the
proxy origin; the prior phone selection and exact injected document are restored.
The wrapper stops on the first failed variant and keeps failure logs.

This prepared campaign does not establish passing results, extracted publisher
content, navigation/account-switch acceptance, ASR, production Cloud voice or
physical-device behavior. Its Node syntax check passed; root must compile and
execute it before recording acceptance.


### October 2 — browser-local reviewed excerpt speech

Browser Menu → Read aloud now works without agent pairing through an explicit excerpt review. The sandboxed frame retains its opaque origin; it does not expose an extraction bridge or fetch a second copy of the page. The user pastes up to 5,000 characters, reviews the source origin and processing disclosure, then presses Read locally. The existing browser voice port selects only voices declaring `localService`; absence of a local voice is an actionable error, with no remote fallback. The exact trimmed reviewed excerpt is passed to speech. Text is not persisted or sent to the agent. Android keeps its existing native extraction/paired-speech route.

The review supports Stop, retry, completion/error state, Close/Escape/Back and page lifecycle cancellation. Adapter ownership also binds it to the tab, document revision and active Browser view; lock, simulated background, chooser and assistant overlays retire reading. Light and compact dark layouts use the active phone theme, scrolling without horizontal overflow. This is a safe manual excerpt fallback, not automatic cross-origin article extraction.

On fixed base `a4bc62b`, 82 repository tests plus TypeScript/build pass. Fifteen focused browser cases pass, including five new speech/review cases and ten existing device/browser parity cases. The rendered Browser-menu journey works while the connection is offline and Home closes the review. Voice and website fixtures are synthetic: exact text, explicit confirmation, remote-voice rejection, stale callbacks, cancellation, compact layout and page-hide cleanup are verified; audible output quality and physical device acceptance are not. An earlier combined run timed out clicking the existing Resume control; that case passed separately and all 15 passed in the final serial run. Evidence: `test-results/browser-reading/`. No Android build ran. Automatic extraction, actual installed-voice quality and the broader MVP ledger remain open.
