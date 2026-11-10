package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.app.KeyguardManager;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.inputmethodservice.InputMethodService;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.ExtractedText;
import android.view.inputmethod.ExtractedTextRequest;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import ai.eliza.voice.LocalVoiceRecording;
import java.io.File;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** LatinIME's auxiliary voice target. Never submits a message or opens conversation voice. */
public final class AlphaKeyboardDictationService extends InputMethodService {
 private final Handler main = new Handler(Looper.getMainLooper());
 private final KeyboardDictationPolicy policy = new KeyboardDictationPolicy();
 private final ExecutorService worker = Executors.newSingleThreadExecutor();
 private LocalVoiceRecording capture;
 private KeyboardDictationCloud cloud;
 private InputConnection target;
 private EditorInfo editor;
 private String before, after, selected;
 private int selectionStart, selectionEnd;
 private long ticket, authority;
 private TextView status;
 private Button action;
 private volatile boolean destroyed;
 private boolean inputViewVisible;
 private final Runnable monitor = new Runnable() {
  public void run() {
   if (policy.state() != KeyboardDictationPolicy.State.RECORDING && policy.state() != KeyboardDictationPolicy.State.TRANSCRIBING) return;
   if (!allowedNow() || authority != AlphaLocalAgentPlugin.credentialAuthorityEpoch()) { fail("Dictation stopped. Tap Start to try again."); return; }
   main.postDelayed(this, 250);
  }
 };
 @Override public void onCreate() {
  super.onCreate();
  capture = new LocalVoiceRecording(this, "alpha-keyboard-dictation-", event -> main.post(() -> {
   if (!policy.ownsRecording(event.optString("recordingId"))) return;
   if ("recorded".equals(event.optString("status"))) transcribe(event.optString("recordingId"));
   else fail("Microphone stopped. Tap Start to try again.");
  }));
 }
 @Override public View onCreateInputView() {
  LinearLayout panel = new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL);
  int pad = (int)(20 * getResources().getDisplayMetrics().density); panel.setPadding(pad, pad, pad, pad);
  boolean dark = (getResources().getConfiguration().uiMode & 0x30) == 0x20;
  panel.setBackgroundColor(dark ? Color.rgb(20,20,20) : Color.WHITE);
  TextView title = new TextView(this); title.setText("Voice typing"); title.setTextSize(20);
  title.setTextColor(dark ? Color.WHITE : Color.BLACK); panel.addView(title);
  status = new TextView(this); status.setTextSize(15); status.setPadding(0,pad/2,0,pad/2);
  status.setTextColor(dark ? Color.LTGRAY : Color.DKGRAY); panel.addView(status);
  LinearLayout controls = new LinearLayout(this);
  action = new Button(this); action.setText("Start"); action.setOnClickListener(v -> {
   if (policy.state() == KeyboardDictationPolicy.State.RECORDING) {
    try { transcribe(capture.stop().getString("recordingId")); }
    catch (Exception error) { fail("Nothing was recorded. Tap Start to try again."); }
   } else start();
  });
  controls.addView(action, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
  Button cancel = new Button(this); cancel.setText("Cancel"); cancel.setOnClickListener(v -> { cancel(); keyboard(true); });
  controls.addView(cancel, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1)); panel.addView(controls);
  renderReady(); return panel;
 }
 @Override public boolean onEvaluateInputViewShown() {
  super.onEvaluateInputViewShown();
  // A deliberately selected voice panel must remain visible with a hardware keyboard too.
  return true;
 }
 @Override public void onStartInputView(EditorInfo info, boolean restarting) {
  super.onStartInputView(info, restarting);
  inputViewVisible = true;
 }
 @Override public void onWindowHidden() {
  boolean wasVisible = inputViewVisible; inputViewVisible = false;
  cancel();
  super.onWindowHidden();
  // Back closes dictation and restores the normal IME for the next tap. A switch caused by
  // Cancel already selected that keyboard and must keep its newly opening window visible.
  String selected = android.provider.Settings.Secure.getString(getContentResolver(), android.provider.Settings.Secure.DEFAULT_INPUT_METHOD);
  android.content.ComponentName component = selected == null ? null : android.content.ComponentName.unflattenFromString(selected);
  if (wasVisible && new android.content.ComponentName(this, AlphaKeyboardDictationService.class).equals(component)) {
   keyboard(false); requestHideSelf(0);
  }
  MainActivity.refreshKeyboardInsets();
 }
 @Override public void onStartInput(EditorInfo info, boolean restarting) {
  cancel(); super.onStartInput(info, restarting); editor = info; target = getCurrentInputConnection();
  selectionStart = info.initialSelStart; selectionEnd = info.initialSelEnd;
  policy.open(); renderReady();
 }
 private boolean fieldAllowed() { return editor != null && KeyboardDictationPolicy.permitted(editor.inputType, editor.imeOptions); }
 private boolean allowedNow() {
  KeyguardManager lock = getSystemService(KeyguardManager.class);
  AudioManager audio = getSystemService(AudioManager.class);
  PowerManager power = getSystemService(PowerManager.class);
  return "cloud".equals(BuildConfig.ELIZA_RUNTIME_PROFILE) && fieldAllowed() && !destroyed
   && getCurrentInputConnection() != null && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
   && lock != null && !lock.isKeyguardLocked() && power != null && power.isInteractive() && audio != null && audio.getMode() == AudioManager.MODE_NORMAL
   && !ai.eliza.plugins.passwords.PasswordSurfaces.visible();
 }
 private void renderReady() {
  if (status == null) return;
  boolean permitted = allowedNow();
  status.setText(!fieldAllowed() ? "Voice typing is unavailable in this field."
   : checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED ? "Allow microphone access in Alpha settings to use voice typing."
   : !permitted ? "Voice typing is unavailable right now."
   : "Uses your selected Alpha voice provider to transcribe audio. Stop inserts text; it never sends it.");
  action.setText("Start"); action.setEnabled(permitted);
 }
 private String text(CharSequence value) { return value == null ? "" : value.toString(); }
 private void start() {
  if (!allowedNow() || policy.state() != KeyboardDictationPolicy.State.READY) { renderReady(); return; }
  try {
   if (!getSystemService(AudioManager.class).getActiveRecordingConfigurations().isEmpty()) {
    fail("Stop the current recording before starting voice typing."); return;
   }
   target = getCurrentInputConnection();
   ExtractedText selection = target.getExtractedText(new ExtractedTextRequest(), 0);
   if (selection != null) { selectionStart = selection.startOffset + selection.selectionStart; selectionEnd = selection.startOffset + selection.selectionEnd; }
   before = text(target.getTextBeforeCursor(64, 0)); after = text(target.getTextAfterCursor(64, 0)); selected = text(target.getSelectedText(0));
   cloud = new KeyboardDictationCloud(this); authority = AlphaLocalAgentPlugin.credentialAuthorityEpoch();
   ticket = policy.start();
   String recordingId = capture.start(LocalVoiceRecording.LONG_LIMIT_MS).getString("recordingId");
   if (!policy.bindRecording(ticket, recordingId)) throw new IllegalStateException("Capture changed");
   status.setText("Listening…"); action.setText("Stop"); main.post(monitor);
  } catch (Exception error) { fail("Configure voice in Alpha and allow microphone access to use voice typing."); }
 }
 private boolean sameField() {
  InputConnection current = getCurrentInputConnection();
  return target != null && current == target && editor == getCurrentInputEditorInfo() && allowedNow()
   && Objects.equals(before, text(current.getTextBeforeCursor(64, 0)))
   && Objects.equals(after, text(current.getTextAfterCursor(64, 0)))
   && Objects.equals(selected, text(current.getSelectedText(0)));
 }
 private void transcribe(String recordingId) {
  if (!policy.stop(ticket)) return;
  final long owned = ticket; final KeyboardDictationCloud request = cloud;
  final File audio = capture.selected(recordingId);
  if (audio == null || request == null) { fail("Nothing was recorded. Tap Start to try again."); return; }
  status.setText("Transcribing…"); action.setEnabled(false);
  // A bound deadline cancels transport and fences late callbacks without blocking the keyboard.
  main.postDelayed(() -> { if (policy.is(owned, KeyboardDictationPolicy.State.TRANSCRIBING)) fail("Dictation timed out. Tap Start to try again."); }, 90000);
  try { worker.execute(() -> {
   try {
    String result = request.transcribe(audio);
    main.post(() -> {
     if (!policy.is(owned, KeyboardDictationPolicy.State.TRANSCRIBING)) return;
     try {
      request.check();
      if (!sameField()) { fail("The text field changed. Please dictate again."); return; }
      if (result.isBlank()) { fail("No speech was heard. Tap Start to try again."); return; }
      if (!policy.finish(owned, true, authority == AlphaLocalAgentPlugin.credentialAuthorityEpoch())) {
       fail("Your voice provider changed. Please start again."); return;
      }
      target.finishComposingText();
      if (!target.commitText(result, 1)) { fail("Text could not be inserted. Please try again."); return; }
      cancel(); keyboard(true);
     } catch (Exception error) { fail("Your voice provider changed. Please start again."); }
    });
   } catch (Exception error) { main.post(() -> { if (policy.is(owned, KeyboardDictationPolicy.State.TRANSCRIBING)) fail("Could not transcribe. Check your Alpha voice settings and try again."); }); }
   finally { capture.discard(recordingId); }
  }); } catch (java.util.concurrent.RejectedExecutionException closed) {
   request.cancel(); capture.discard(recordingId);
   if (policy.is(owned, KeyboardDictationPolicy.State.TRANSCRIBING)) fail("Voice typing closed. Please start again.");
  }
 }
 private void fail(String message) {
  cancel(); policy.open();
  if (status != null) { status.setText(message); action.setText("Start"); action.setEnabled(allowedNow()); }
 }
 private void cancel() {
  policy.close(); main.removeCallbacks(monitor);
  if (cloud != null) cloud.cancel(); cloud = null;
  if (capture != null) capture.cancel();
  before = null; after = null; selected = null;
 }
 private void keyboard(boolean keepTyping) {
  if (keepTyping && editor != null && getPackageName().equals(editor.packageName)) MainActivity.beginKeyboardReturn();
  if (!switchToPreviousInputMethod() && !switchToNextInputMethod(false)) requestHideSelf(0);
 }
 @Override public void onUpdateSelection(int oldStart, int oldEnd, int newStart, int newEnd, int candidateStart, int candidateEnd) {
  super.onUpdateSelection(oldStart,oldEnd,newStart,newEnd,candidateStart,candidateEnd);
  if ((policy.state() == KeyboardDictationPolicy.State.RECORDING || policy.state() == KeyboardDictationPolicy.State.TRANSCRIBING)
      && (newStart != selectionStart || newEnd != selectionEnd)) fail("The text field changed. Please dictate again.");
  selectionStart = newStart; selectionEnd = newEnd;
 }
 @Override public void onFinishInputView(boolean finishingInput) { cancel(); super.onFinishInputView(finishingInput); }
 @Override public void onFinishInput() { cancel(); target = null; editor = null; super.onFinishInput(); }
 @Override public void onDestroy() { destroyed = true; cancel(); worker.shutdownNow(); super.onDestroy(); }
}
