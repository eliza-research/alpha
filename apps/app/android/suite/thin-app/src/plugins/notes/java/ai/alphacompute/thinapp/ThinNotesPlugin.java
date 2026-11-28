package ai.alphacompute.thinapp;

import ai.eliza.plugins.media.RecordingStore;
import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import org.json.JSONObject;

/** Standalone {@code AlphaNotes} plugin providing voice-note recording, encrypted audio storage, playback, and sharing. */
@CapacitorPlugin(name = "AlphaNotes", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public final class ThinNotesPlugin extends Plugin {
    private static final String AUDIO_PREFIX = "note-audio-metadata:v1:";
    private static final String PREFS_NAME = "alpha-thin-notes-audio";
    private static final String KEY_ALIAS = "alpha-thin-notes-audio-v1";
    private static final RecordingStore.Limits AUDIO_LIMITS =
        new RecordingStore.Limits(Long.MAX_VALUE, Long.MAX_VALUE, 150_000, 6L * 24 * 60 * 60 * 1000);

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private final ThinNoteRecorder.Listener recorderListener = this::recordingChanged;
    private volatile boolean front = true;
    private volatile boolean closed;
    private String lastRecordingState = "";
    private MediaPlayer player;
    private String playingId;
    private PluginCall playback;

    private interface Request {
        void run() throws Exception;
    }

    private void onMain(PluginCall call, Request request) {
        main.post(() -> {
            if (closed) {
                call.reject("Notes is closed");
                return;
            }
            try {
                request.run();
            } catch (Exception unavailable) {
                call.reject("The recording is unavailable");
            }
        });
    }

    private void onDisk(PluginCall call, Request request) {
        try {
            files.execute(() -> {
                if (closed) {
                    call.reject("Notes is closed");
                    return;
                }
                try {
                    request.run();
                } catch (Exception unavailable) {
                    call.reject("The saved content is unavailable");
                }
            });
        } catch (RejectedExecutionException stopped) {
            call.reject("Notes is closed");
        }
    }

    private ThinNoteRecorder recorder() {
        return ThinNoteRecorder.get(getContext());
    }

    private static String recordingId(PluginCall call) {
        String id = call.getString("recordingId");
        if (id == null || !id.matches(ThinNoteRecorder.ID)) throw new IllegalArgumentException();
        return id;
    }

    static boolean inCall(Context context) {
        AudioManager audio = context.getSystemService(AudioManager.class);
        if (audio == null) return false;
        int mode = audio.getMode();
        return mode == AudioManager.MODE_IN_CALL
            || mode == AudioManager.MODE_IN_COMMUNICATION
            || mode == AudioManager.MODE_RINGTONE;
    }

    private void recordingChanged(JSObject status) {
        String state = status.optString("state");
        if (!"recording".equals(state) && !"paused".equals(state)) {
            ThinNoteRecordingService.recordingClosed(getContext(), status.getString("recordingId"));
        } else if (!Objects.equals(lastRecordingState, state)) {
            ThinNoteRecordingService.refresh(getContext());
        }
        lastRecordingState = state;
        notifyListeners("recordingChanged", status);
    }

    @Override public void load() {
        super.load();
        try {
            recorder().setListener(recorderListener);
        } catch (RuntimeException unavailable) {
            lastRecordingState = "";
        }
    }

    @Override protected void handleOnResume() {
        front = true;
        super.handleOnResume();
    }

    @Override protected void handleOnPause() {
        front = false;
        main.post(() -> endedPlayback(false));
        super.handleOnPause();
    }

    @Override protected void handleOnNewIntent(Intent intent) {
        if (ThinNoteRecordingService.offerFromIntent(getContext(), intent)) {
            notifyListeners("openRequested", new JSObject());
        }
        super.handleOnNewIntent(intent);
    }

    @PluginMethod public void consumeOpen(PluginCall call) {
        call.resolve(new JSObject().put("open", ThinNoteRecordingService.consumeShowNotes()));
    }

    @PluginMethod public void permission(PluginCall call) {
        answeredPermission(call);
    }

    @PluginMethod public void requestMicrophone(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            answeredPermission(call);
            return;
        }
        requestPermissionForAlias("microphone", call, "microphoneAnswered");
    }

    @PermissionCallback private void microphoneAnswered(PluginCall call) {
        answeredPermission(call);
    }

    private void answeredPermission(PluginCall call) {
        call.resolve(new JSObject().put("grant", getPermissionState("microphone").toString()));
    }

    @PluginMethod public void status(PluginCall call) {
        onMain(call, () -> call.resolve(recorder().status()));
    }

    @PluginMethod public void start(PluginCall call) {
        onMain(call, () -> {
            if (!front || locked() || inCall(getContext()) || player != null
                || getPermissionState("microphone") != PermissionState.GRANTED) {
                call.reject("The microphone is unavailable");
                return;
            }
            JSObject status = recorder().start(call.getString("ownerDigest"), call.getString("folderId"));
            ThinNoteRecordingService.start(getContext(), status.getString("recordingId"));
            call.resolve(status);
        });
    }

    @PluginMethod public void command(PluginCall call) {
        onMain(call, () -> {
            String id = recordingId(call);
            String command = call.getString("command", "");
            switch (command) {
                case "Pause" -> call.resolve(recorder().pause(id));
                case "End" -> call.resolve(recorder().stop(id));
                case "Resume" -> {
                    if (!front || locked() || inCall(getContext()) || player != null
                        || getPermissionState("microphone") != PermissionState.GRANTED) {
                        call.reject("The microphone is unavailable");
                        return;
                    }
                    JSObject status = recorder().resume(id);
                    ThinNoteRecordingService.start(getContext(), id);
                    call.resolve(status);
                }
                default -> call.reject("No such recording control");
            }
        });
    }

    @PluginMethod public void discard(PluginCall call) {
        onMain(call, () -> {
            if (!recorder().owns(recordingId(call))) {
                call.reject("The recording changed");
                return;
            }
            recorder().discard();
            call.resolve();
        });
    }

    private RecordingStore recordings() {
        ThinEncryptedSlots slots = new ThinEncryptedSlots(getContext(), PREFS_NAME, KEY_ALIAS);
        return new RecordingStore(
            new File(getContext().getNoBackupFilesDir(), "note-audio"),
            AUDIO_PREFIX,
            "noteId",
            new RecordingStore.Slots() {
                @Override public String read(String key) throws Exception { return slots.read(key); }
                @Override public void write(String key, String value) throws Exception { slots.write(key, value); }
                @Override public void remove(String key) throws Exception { slots.remove(key); }
            },
            AUDIO_LIMITS
        );
    }

    @PluginMethod public void retain(PluginCall call) {
        onDisk(call, () -> {
            String audioId = recordingId(call);
            ThinNoteRecorder recorder = recorder();
            String noteId = call.getString("noteId");
            if (!recorder.beginCanonicalSave(audioId)) {
                call.reject("The recording changed");
                return;
            }
            try {
                File joined = recorder.joined(audioId);
                JSObject retained = JSObject.fromJSONObject(
                    recordings().retain(joined, audioId, noteId, recorder.totalMs(), "", true)
                );
                recorder.commitCanonicalSave(audioId);
                call.resolve(retained);
            } catch (Exception failure) {
                recorder.abortCanonicalSave(audioId);
                throw failure;
            }
        });
    }

    @PluginMethod public void describe(PluginCall call) {
        onDisk(call, () -> call.resolve(JSObject.fromJSONObject(recordings().describe(call.getString("audioId")))));
    }

    @PluginMethod public void play(PluginCall call) {
        onDisk(call, () -> {
            String id = RecordingStore.id(call.getString("audioId"));
            RecordingStore store = recordings();
            String note = call.getString("noteId");
            if (!Objects.equals(note, store.describe(id).optString("noteId"))) {
                call.reject("The recording changed");
                return;
            }
            File file = store.playable(id);
            onMain(call, () -> {
                if (!front || locked() || inCall(getContext())) {
                    call.reject("Playback is unavailable");
                    return;
                }
                endedPlayback(false);
                MediaPlayer next = new MediaPlayer();
                player = next;
                playingId = id;
                playback = call;
                try {
                    next.setDataSource(file.getAbsolutePath());
                    next.setOnPreparedListener(ready -> {
                        if (player != ready) return;
                        try {
                            int from = Math.max(0, call.getInt("offsetMs", 0));
                            if (from > 0) ready.seekTo(Math.min(ready.getDuration(), from));
                            ready.start();
                        } catch (RuntimeException unavailable) {
                            endedPlayback(false);
                        }
                    });
                    next.setOnCompletionListener(done -> {
                        if (player == done) endedPlayback(true);
                    });
                    next.setOnErrorListener((failed, code, detail) -> {
                        if (player == failed) endedPlayback(false);
                        return true;
                    });
                    next.prepareAsync();
                } catch (Exception unavailable) {
                    endedPlayback(false);
                }
            });
        });
    }

    private void endedPlayback(boolean ok) {
        if (player != null) {
            player.release();
            player = null;
        }
        if (playback != null) {
            playback.resolve(new JSObject().put("ok", ok));
            playback = null;
        }
        playingId = null;
    }

    @PluginMethod public void halt(PluginCall call) {
        onMain(call, () -> {
            endedPlayback(true);
            call.resolve(new JSObject().put("ok", true));
        });
    }

    @PluginMethod public void purge(PluginCall call) {
        onDisk(call, () -> {
            String audioId = RecordingStore.id(call.getString("audioId"));
            String noteId = RecordingStore.id(call.getString("noteId"));
            String operationId = call.getString("operationId");
            onMain(call, () -> {
                if (audioId.equals(playingId)) endedPlayback(false);
                onDisk(call, () -> {
                    RecordingStore store = recordings();
                    Runnable current = () -> {
                        if (closed) throw new IllegalStateException("Notes is closed");
                    };
                    current.run();
                    store.remove(audioId, noteId, operationId, current);
                    JSONObject purged = store.purge(audioId, noteId, operationId, current);
                    call.resolve(JSObject.fromJSONObject(purged));
                });
            });
        });
    }

    @PluginMethod public void share(PluginCall call) {
        onMain(call, () -> {
            Activity activity = getActivity();
            if (activity == null || !front || locked()) {
                call.reject("Open Notes to share a draft");
                return;
            }
            String title = call.getString("title", "");
            String text = call.getString("text", "");
            boolean mail = "Email".equals(call.getString("channel"));
            if (title.length() > 240 || text.length() > 80_000) {
                call.reject("This note is too long to share");
                return;
            }
            Intent draft = new Intent(Intent.ACTION_SENDTO, Uri.parse(mail ? "mailto:" : "smsto:"));
            if (mail) {
                draft.putExtra(Intent.EXTRA_SUBJECT, title).putExtra(Intent.EXTRA_TEXT, text);
            } else {
                draft.putExtra("sms_body", title.isBlank() ? text : title + "\n\n" + text);
            }
            draft.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(draft);
            call.resolve();
        });
    }

    private boolean locked() {
        KeyguardManager keyguard = getContext().getSystemService(KeyguardManager.class);
        return keyguard == null || keyguard.isDeviceLocked();
    }

    @PluginMethod public void settings(PluginCall call) {
        onMain(call, () -> {
            Activity activity = getActivity();
            if (activity == null) {
                call.reject("Settings are unavailable");
                return;
            }
            Intent page = new Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getContext().getPackageName())
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(page);
            call.resolve();
        });
    }

    @PluginMethod public void previousExists(PluginCall call) {
        call.resolve(new JSObject().put("present", false));
    }

    @PluginMethod public void readPrevious(PluginCall call) {
        String area = call.getString("area", "");
        if (!"records".equals(area) && !"trash".equals(area) && !"folders".equals(area)) {
            call.reject("The saved content is unavailable");
            return;
        }
        call.resolve(new JSObject().put("text", JSONObject.NULL));
    }

    @Override protected void handleOnDestroy() {
        closed = true;
        try {
            recorder().clearListener(recorderListener);
        } catch (RuntimeException unavailable) {
            lastRecordingState = "";
        }
        main.post(() -> endedPlayback(false));
        files.shutdownNow();
        super.handleOnDestroy();
    }
}
