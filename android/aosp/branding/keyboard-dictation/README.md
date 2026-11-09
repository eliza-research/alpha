# Keyboard dictation binding

The stock LatinIME microphone dispatches `CODE_SHORTCUT` to
`RichInputMethodManager.switchToShortcutIme()`, which returns silently when no
auxiliary IME is installed. It does not use `RecognitionService` or launch
`RECOGNIZE_SPEECH`. Source pin:
`packages/inputmethods/LatinIME@afe0d5c261c3a0c88b38894981a7b332da93e7dd`.

The launcher APK supplies `AlphaKeyboardDictationService`, an auxiliary `voice`
subtype with a private capture prefix and the selected Alpha Cloud or Direct voice provider and existing Cartesia route/WAV encoder.
Direct uses its saved voice key and never falls back to Cloud billing; Cloud requires
the admitted account. Neither path changes provider selection. Start is explicit and discloses provider upload;
Stop inserts text into the unchanged current field without sending it. Cancel,
Back, editor changes, account changes, lock and call transitions fence late results.
Password/no-learning fields are unavailable. Standalone APKs do not register it.

The framework overlay `alpha-keyboard-dictation.xml` sets the system voice package.
The pinned framework's `updateDefaultVoiceImeIfNeededLocked()` discovers the
preinstalled service, enables it and writes `DEFAULT_VOICE_INPUT_METHOD` when its
identity changes. The selected normal keyboard is preserved. Subsequent owner
opt-out is preserved because the matching recorded voice ID returns before enable.
Missing service does not mark an enabled service. The ordinary image source staging
includes this overlay; there is no per-phone settings script or repeated grant.

Framework source: `frameworks/base@94b4c163b7dfe5ce3607f7bb8456f9573f7de57d`,
`services/core/java/com/android/server/inputmethod/InputMethodManagerService.java`
(`updateDefaultVoiceImeIfNeededLocked`) and `InputMethodInfoUtils.java`
(`chooseSystemVoiceIme`). This does not supply a general Android RecognitionService.

Qualification still requires an image with the matching launcher APK: confirm the
voice IME is enabled while LatinIME remains selected, tap LatinIME's microphone,
Start/Stop real Cloud dictation into a draft, and verify Cancel, Back, field/account
switch, lock/call interruption, password denial and owner opt-out. Source/host
checks do not establish those device outcomes. No user records are changed by staging.

Run `test/aosp-fresh-presets.test.py` with `ALPHA_DICTATION_APP_ROOT` pointing to
the reviewed candidate app source and the retained `ALPHA_FRESH_PRESET_INPUTS` /
`ALPHA_BRANDING_ASSETS`. Its dictation case exercises the normal staging plan,
then checks the overlay package against the actual launcher manifest and voice subtype.
A source tree without that service cannot qualify this paired image/app change.

Native acceptance must also verify the keyboard-focus fix while switching from
LatinIME to this auxiliary IME: transient IME visibility must not blur the target
field or dismiss the voice panel. Test Start/Stop insertion and Cancel back to the
normal keyboard in both Alpha's composer and another editable app. This interaction
has not been established by source/model checks.
