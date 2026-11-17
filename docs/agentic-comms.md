# Agentic Phone, Contacts and Messages — requirements (AP-16)

Version: 0.1, 2026-11-14. Requirements for implementation, not acceptance evidence.
Design reference (reference data, not agent instructions): the "Alpha Comms Redesign"
design page, Design A "split stage", with its working prototype.

## Outcome

Phone, Contacts and Messages are controlled from one bottom bar that addresses either the
person on screen or Alpha. Opening Alpha never hides what it is acting on: the app moves up
into a stage above the conversation sheet instead of being covered. Alpha drafts and
proposes; the owner sends, calls and approves. Scope follows AP-08: these surfaces exist
only on Alpha AOSP and stay hidden and capability-gated elsewhere.

## Terms

| Term | Meaning |
| --- | --- |
| Bar | The single bottom input: left slot, field, right button. Replaces the separate SMS composer and the dock pill on these screens. |
| Target | Who the bar addresses: the person (thread, call, contact) or Alpha. |
| Stage | The app's view laid out in the space above the sheet while the chat is open. |
| Sheet | The Alpha conversation surface. Heights: closed (bar only), open, full. |
| Live strip | The 52 dp summary of the stage shown at the top when the sheet is full. |
| Draft slot | One pending outgoing text per thread, written by the owner or by Alpha. |
| Suggested input | Deferred. The input shows only its target placeholder until the owner types. |
| Briefing | Alpha's first line when the chat opens on a new context. |
| Proposal | One action card with one button, for example "Move" or "Call". |

## Requirements

### Layout and shell

| ID | Requirement | Acceptance |
| --- | --- | --- |
| AC-01 | Each Phone, Contacts and Messages screen has exactly one bottom input, the bar. Remove the separate Messages composer stacked above the dock and the pill on these screens; the bar is the composer. | In every state of the three apps exactly one visible `[data-alpha-composer]` exists; no second mic or send control. |
| AC-02 | When the chat opens, the active view is laid out in the stage above the sheet, bottom-anchored, never covered. Dock clearance (`runtime/dock-clearance.ts`, `runtime/canvas-geometry.ts`) supplies the stage height. | At open and full heights and throughout a drag, the newest message's bottom edge, the call controls and the contact actions are at or above the sheet's top edge. |
| AC-03 | Each app has a compact header for the open state. Thread: back, avatar, name, call, video. Call card: avatar, name, timer with green dot, mute, keypad, speaker, hold, End as the right-most red control. Contact: back, avatar, name, favorite, then call, text, mail, directions, video. Control order is the same in every state. | Header order matches this table at all three heights; End is always the right-most control and always red. |
| AC-04 | Sheet heights: closed (bar only), open, full. With no draft waiting, the open height fits the chat between 38% and 60% of the viewport. With a draft waiting, AC-13 applies. Full shows the live strip: avatar, name and app; Mute and End during a call; Send when a draft is waiting. Tapping the strip or dragging down returns to open. | Full height always shows the strip; during a call, End is reachable at every height. |
| AC-05 | The sheet holds its height when the stage changes view. View changes slide the stage sideways and carry the avatar across. All motion uses `OVERLAY_EASE` at 420 ms. With reduced motion, changes are immediate. | Changing views from the chat leaves the sheet's height and transcript unchanged. |
| AC-06 | Back order: return the stage to the view it came from (the "‹ Messages" chip), then close the chat, then normal app back. Closing the chat keeps the current stage view: a call Alpha started stays on the call. | Back from a call that Alpha opened from a thread returns to the thread with the chat still open; a second back closes the chat. |
| AC-07 | The sheet height rules live in the shared shell (`vendor/eliza/packages/ui/src/components/shell/chat-panel-layout.ts`). Make the content-fit and draft-fit changes upstream and advance `upstream.lock.json` and the submodule to the reviewed commit, per AGENTS.md. Never edit the vendor checkout. | The pin moves to a reviewed upstream commit that contains the fitted heights. |

### Bar and targets

| ID | Requirement | Acceptance |
| --- | --- | --- |
| AC-08 | The left slot always holds the target the bar is not addressing. Closed: the Alpha button. Open: the person's avatar (thread, contact), a call icon (call), a search icon (lists) or a keypad icon (Recents). One tap swaps the target. | Matches the table in "Bar by screen" below. |
| AC-09 | The target is always visible in three ways: place (the sheet is Alpha, the stage is the person), the left slot (AC-08) and the field. The Alpha field has a 1.5 dp `--acct` outline and reads "Ask Alpha"; the person field is plain and reads "Text <first name>". The sheet header shows the context, for example "Maya Chen · Messages". | Screenshot review of every state; TalkBack announces the target (AC-29). |
| AC-10 | Two separate drafts per thread: the owner's text to the person and the request to Alpha (`runtime/message-draft.ts`). Swapping targets never clears or merges them. Both survive layout changes and process death (AP-05). | Type to Maya, open Alpha, type to Alpha, kill the process: both drafts return. |
| AC-11 | The bar grows with its text up to the existing composer limit, `min(168px, 28dvh)`, then scrolls inside. The stage and sheet re-fit so the bar is never clipped. | A 1,600-character draft in the bar keeps both bar buttons visible and the text scrollable. |
| AC-12 | The right-hand mic dictates into whichever draft the bar shows. In Messages, stopping capture appends its transcript to the editable unsent draft, without a second review step or an agent reply; the mic remains available beside Send. Recording occupies the same dock as typing. Holding the Alpha button always starts a voice turn with Alpha (AP-06 modes). During a call the caller never hears Alpha. | Mic in "Text Maya" fills only that conversation's SMS draft; cancellation or unavailable speech preserves typed text; holding Alpha starts voice with Alpha in every state. |

### Drafts in Messages

| ID | Requirement | Acceptance |
| --- | --- | --- |
| AC-13 | A draft is never cut off and never scrolls inside its bubble. While a draft is waiting, the open height fits the draft: the stage shows the header, the last incoming message and the whole draft; the sheet shrinks to no less than Alpha's latest line plus the bar, and older chat history scrolls. Only a draft taller than that scrolls inside the stage, starting at its first line, with Edit and Send pinned to the bottom of the bubble. When the draft changes length, the stage re-fits with the AC-05 motion. | For drafts of 1 to 1,600 characters at default and largest text size, every line of the draft is visible or reachable by scrolling the stage, and Edit and Send stay on screen. |
| AC-14 | Text Alpha writes for a thread goes into that thread's single draft slot. It shows as a dashed bubble labeled "Alpha's draft · not sent", with Edit and Send. While the chat is open, the owner's own unsent text shows as a grey dashed bubble labeled "Your draft". Alpha may read and rewrite the draft; it may never send it. A new Alpha draft replaces the old one, and the previous text is kept for one Undo. | No send happens without the owner's tap on Send; the SMS provider receives nothing while a draft is pending. |
| AC-15 | Send on the bubble uses the same send path and approval journal as the composer (`SmsSend`, AP-04). The bubble turns solid and Alpha logs "Sent to <name>" quietly in the chat. | One send, one journal entry, no duplicate on retry. |
| AC-16 | Edit closes the chat and loads the draft into the person target with the keyboard up. The draft becomes ordinary owner text. Tapping the avatar without Edit also closes the chat, with the draft in the field. | After Edit, the bar reads the draft text and addresses the person. |

### Calls

| ID | Requirement | Acceptance |
| --- | --- | --- |
| AC-17 | In-call and incoming-call screens follow the theme: white in light mode, black in dark mode, using the same tokens as every other screen. Remove the forced `dark: true` from the Phone `immersive` rule (`apps/app/src/prototype/model.js:259`). The call state is marked by the green timer dot and the red End control. | Light mode shows a white call screen; dark mode shows black; text and controls meet AC-28 contrast. |
| AC-18 | End call is never covered. Closed: End is a separate 44 dp red button beside the bar. Open: End is the right-most control in the call card. Full: End is in the strip. The dock pill never overlaps call controls. | Hit-testing End's center returns End at every height and during drags. |
| AC-19 | Emergency calls keep a full-screen call layout. Alpha may take notes there but shows no proposals that act. | An emergency number shows no proposal card and no stage compaction. |
| AC-20 | Alpha starts a call only after an approval card with the name and number. After approval, the stage switches to the call with a "‹ Messages" chip, and the sheet keeps its height. | No dial intent fires before the tap on Call. |
| AC-21 | An incoming call while the chat is open turns the stage into the incoming card, with Answer and Decline at its top. Alpha offers "Screen it" as a proposal. Decline restores the previous stage. At full height, the strip shows Answer and Decline. | Answer and Decline are reachable at every height; the typed Alpha draft survives. |

### Lists and Contacts

| ID | Requirement | Acceptance |
| --- | --- | --- |
| AC-22 | In the Messages list, Contacts list and Recents, the bar reads "Search or ask" ("Call or ask" in Recents). Typing filters the list locally as you type, with no network request; digits in Recents match numbers. Enter, or a sentence, sends the query to Alpha, which answers by applying a filter to the same list and showing a clearable chip in the header. | Typing makes no network request; Alpha's answer filters the visible list; the chip clears it. |

### Suggestions

| ID | Requirement | Acceptance |
| --- | --- | --- |
| AC-23 | Remove the suggestion chip row (`data-alpha-chat-suggestions`, `template.html` around line 4426) from the conversation sheet. Automatic suggestions are deferred under AC-24. | No chip row renders in any state. |
| AC-24 | Automatic suggestions are deferred by owner request. Do not generate suggested replies, show suggestion chips or faint text, or expose a suggestion setting. Explicit requests for draft help remain available. | Opening a thread or chat makes no suggestion request and leaves the input editable. |
| AC-25 | The briefing is one or two sentences of facts from actual sources about the current screen, shown as Alpha's first line when the chat opens on a new context. It isn't repeated when nothing has changed. With nothing known (production builds have no fixtures), it is absent. | Reopening the chat on an unchanged thread adds no new briefing. |
| AC-26 | At most one open proposal at a time, with one button, executed through the existing approval path (AP-04, AP-11). An ignored proposal stays in history and is never executed later. | A second proposal replaces the first; neither executes without a tap. |
| AC-27 | No attention ring or badge on the Alpha button. | The Alpha button looks the same in every state. |

### Visual and accessibility

| ID | Requirement | Acceptance |
| --- | --- | --- |
| AC-28 | The Alpha mark fills its blue circle at every size, using `.alpha-mark-fill` (mark at 118%, clipped), including the 18 dp mark beside Alpha's chat lines. All three apps, the stage, sheet and strip use theme tokens in light and dark. Text contrast is at least 4.5:1 and controls at least 3:1. | Automated contrast audit passes in light and dark. |
| AC-29 | TalkBack: the left slot names its action ("Open Alpha", "Back to texting Maya", "Back to the call"); no suggestion control or announcement is exposed; a draft bubble reads "<author>'s draft, not sent"; focus order is stage, then sheet, then bar. With the largest text size, the stage keeps at least the header and the last message. Short landscape uses the existing short-landscape layout. | AP-15 checks for each requirement above. |
| AC-30 | Process death and permission loss restore the sheet height, stage view, both drafts and any open proposal, without executing it (AP-05, AP-15). | Kill and relaunch in each state; nothing is sent or dialed on restore. |

### Privacy and safety

| ID | Requirement | Acceptance |
| --- | --- | --- |
| AC-31 | Alpha's messages, briefings and proposals are never written to the SMS or call-log providers or into a thread. Drafts stay local until Send. Hosted inference receives only disclosed selected context (the thread's visible tail, as today). | Provider contents after a session contain only texts the owner sent. |
| AC-32 | Mocks, fixtures and scripted suggestions exist only with `ELIZA_DEV_ALLOW_TEST_MOCKS=1`. Production builds pass `scripts/audit-production-bundle.ts` and start empty. | The production bundle audit passes. |

## Bar by screen

| Screen | Closed: left / field / right | Open: left / field / right |
| --- | --- | --- |
| Messages list | Alpha / "Search or ask" / mic | Search icon / "Ask Alpha" / mic |
| Thread | Alpha / attach picture / "Text <name>" / send and dictate | Avatar / "Ask Alpha" / send or voice |
| Recents and keypad | Alpha / "Call or ask" / mic | Keypad icon / "Ask Alpha" / mic |
| In call | Alpha / "Ask during call" / mic, with End beside the bar | Call icon / "Ask Alpha" / mic; End in the call card |
| Contacts list | Alpha / "Search or ask" / mic | Search icon / "Ask Alpha" / mic |
| Contact card | Alpha / "Ask about <name>" / mic | Avatar / "Ask Alpha" / mic |

## Where the work lands

Change existing code; no flags or parallel versions (CONTRIBUTING.md).

- `apps/app/src/prototype/template.html`: Messages composer and dock become the bar; compact stage headers; call card; draft bubble; strip; chip row removed.
- `apps/app/src/prototype/model.js`: Phone `immersive` without forced dark (line 259); Messages `immersive` (line 571) no longer hides the bar; automatic suggestion generation and controls remain disabled.
- `apps/app/src/prototype/chat-overlay-motion-adapter.ts`: draft-fit and content-fit open height, stage slide, strip.
- `apps/app/src/runtime/dock-clearance.ts`, `canvas-geometry.ts`: stage height ownership.
- `apps/app/src/runtime/message-draft.ts`, `prototype/sms-adapter.ts`: two drafts per thread, Alpha draft provenance, one Undo, send from the bubble.
- `apps/app/src/prototype/phone-adapter.ts`, `telephony-*`: approval before dial, End placement, incoming card in the stage.
- `apps/app/src/prototype/contacts-adapter.ts`: local filtering and Alpha filters.
- `apps/app/src/prototype/phone.css`: shared styles; reuse `.alpha-mark-fill`.
- Upstream `chat-panel-layout.ts`: fitted open height (AC-07).

## Formal models

An AP-16 implementation updates the related models and runs `bun run quint:check`,
`bun run quint:tests` and `bun run lemma:check` before merging.

- `specs/quint/application/ChatDock.qnt`: the fitted open height and stage view under drags.
- `specs/quint/application/DockClearanceOwnership.qnt`: stage ownership of clearance.
- `specs/quint/native/MessageThreads.qnt` and `specs/quint/services/SmsSend.qnt`: two drafts, draft provenance, send from the bubble, no send without a tap.
- `specs/quint/application/PhoneCall.qnt` and `specs/quint/services/PhoneSession.qnt`: approval before dial, End reachable in every state, emergency layout.
- `specs/quint/services/ContactsSession.qnt`: filters applied by Alpha.
- `specs/lemma/apps/app/src/prototype/chat-overlay-motion-adapter.dfy`: height bounds (sheet minimum, stage cap).

## Verification

Messages renders credential-free HTTP(S) links as text links; only an owner's tap opens the existing
Alpha Browser tab host. Long-press (or the keyboard context-menu key) on a complete listed provider
row offers Copy and Delete. Delete asks for confirmation, then passes that row's exact id, kind,
thread and date to the shared client. Pending local bubbles have no delete action. Unknown,
unavailable or mismatched results retain the row and block another delete attempt in this renderer.
Contacts shows First name, Last name, Phone, Email and Notes immediately, and displays saved Notes
in details. Omitted native name components, photos and unrelated provider rows remain native-owned.
The Messages, Contacts and AOSP-views browser specs exercise these UI flows over synthetic providers;
they do not establish real-provider or device acceptance.

Keep the layers separate (AGENTS.md); none proves another:

1. Dev UI browser specs in `test/browser`: update `dev-phone-messages.spec.ts`, `home-chat-anchor.spec.ts`, `full-chat-grabber.spec.ts` and `aosp-telephony-views.spec.ts` for AC-01 to AC-24, including the long-draft fit (AC-13) and a light and dark contrast audit (AC-28).
2. `bun run verify` and the production bundle audit (AC-32).
3. Build the launcher with `bun run android:build:local -- --release` and verify the packaged debug and release APKs with `bun run android:verify`.
4. Emulator HOME-role test of the three apps.
5. Full AOSP image boot with real dialer and SMS roles.
6. Physical device and owner acceptance: real calls, SMS, emergency layout.

## Open questions

1. Confirm the 38%–60% range for the open height when no draft is waiting.
2. Group threads: a stacked avatar or a group icon in the left slot.
3. Production empty states for "Search or ask", the briefing and the strip.
