package ai.alphacompute.thinapp;

import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.AtomicFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Segmented AAC voice-note recorder with crash recovery and lossless M4A joining for standalone Notes. */
final class ThinNoteRecorder {
    static final long SEGMENT_BYTES = 180_000L;
    static final long SEGMENT_MS = 27_000L;
    static final long MIN_FREE_BYTES = 64L * 1024 * 1024;
    private static final int MAX_JOURNAL_BYTES = 32 * 1024 * 1024;
    static final String ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

    private static ThinNoteRecorder instance;

    interface Listener {
        void changed(JSObject status);
    }

    private static final class Segment {
        final long durationMs;
        String text;

        Segment(long durationMs, String text) {
            this.durationMs = durationMs;
            this.text = text;
        }
    }

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile Listener listener;
    private MediaRecorder recorder;
    private String id;
    private File dir;
    private int index;
    private final List<Segment> finished = new ArrayList<>();
    private long segmentStarted;
    private long pausedAt;
    private long pausedTotal;
    private String state = "idle";
    private String stopReason;
    private boolean recovered;
    private String ownerDigest;
    private String folderId;
    private boolean canonicalSavePending;
    private boolean canonicalSaveInFlight;
    private boolean recoveryUnavailable;
    private final Runnable rollover = this::rollover;

    static synchronized ThinNoteRecorder get(Context context) {
        if (instance == null) {
            instance = new ThinNoteRecorder(context.getApplicationContext());
        }
        return instance;
    }

    private ThinNoteRecorder(Context context) {
        this.context = context;
        recover();
    }

    void setListener(Listener value) { listener = value; }

    void clearListener(Listener value) {
        if (listener == value) listener = null;
    }

    private File root() {
        File folder = new File(context.getNoBackupFilesDir(), "note-recording");
        if (!folder.isDirectory() && !folder.mkdirs()) {
            throw new IllegalStateException("Recording storage unavailable");
        }
        return folder;
    }

    private File segmentFile(int i) {
        return new File(dir, String.format(Locale.ROOT, "%05d.m4a", i));
    }

    private AtomicFile journal() {
        return new AtomicFile(new File(dir, "segments.json"));
    }

    private synchronized void recover() {
        File[] sessions;
        try {
            sessions = root().listFiles(File::isDirectory);
        } catch (RuntimeException unavailable) {
            recoveryUnavailable = true;
            return;
        }
        if (sessions == null) {
            recoveryUnavailable = true;
            return;
        }
        for (File session : sessions) {
            if (id != null || !session.getName().matches(ID)) continue;
            try {
                List<Segment> segments = new ArrayList<>();
                JSONObject record;
                try (InputStream in = new AtomicFile(new File(session, "segments.json")).openRead()) {
                    record = readJournal(in);
                    JSONArray list = record.getJSONArray("segments");
                    for (int i = 0; i < list.length(); i++) {
                        JSONObject item = list.getJSONObject(i);
                        segments.add(new Segment(Math.max(1L, item.getLong("d")), item.has("t") ? item.getString("t") : null));
                    }
                }
                if (segments.isEmpty()) throw new IOException("No finished audio");
                for (int i = 0; i < segments.size(); i++) {
                    if (!new File(session, String.format(Locale.ROOT, "%05d.m4a", i)).isFile()) {
                        throw new IOException("Segment missing");
                    }
                }
                File[] partial = session.listFiles((d, name) -> name.endsWith(".m4a") && parseIndex(name) >= segments.size());
                if (partial != null) {
                    for (File file : partial) file.delete();
                }
                id = session.getName();
                dir = session;
                finished.addAll(segments);
                index = segments.size();
                String recordedOwner = record.optString("ownerDigest", "");
                String recordedFolder = record.optString("folderId", "");
                ownerDigest = validOwner(recordedOwner) && validFolder(recordedFolder) ? recordedOwner : null;
                folderId = ownerDigest != null && !recordedFolder.isEmpty() ? recordedFolder : null;
                canonicalSavePending = record.optBoolean("canonicalSavePending", false);
                state = "paused";
                recovered = true;
                stopReason = null;
            } catch (Exception unreadable) {
                File[] audio = session.listFiles((d, name) -> name.endsWith(".m4a") && new File(d, name).length() > 0);
                if (audio == null || audio.length > 0) recoveryUnavailable = true;
            }
        }
    }

    private static JSONObject readJournal(InputStream in) throws IOException, JSONException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        for (int count; (count = in.read(buffer)) != -1; ) {
            if (count > MAX_JOURNAL_BYTES - bytes.size()) throw new IOException("Recording index is too large");
            bytes.write(buffer, 0, count);
        }
        return new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
    }

    private static int parseIndex(String name) {
        try {
            return Integer.parseInt(name.substring(0, name.length() - 4));
        } catch (RuntimeException invalid) {
            return -1;
        }
    }

    private long usableSpace() {
        try {
            return root().getUsableSpace();
        } catch (RuntimeException unavailable) {
            return 0L;
        }
    }

    private static boolean validOwner(String value) {
        return value != null && value.matches("[a-f0-9]{64}");
    }

    private static boolean validFolder(String value) {
        return value == null || value.isEmpty() || value.matches("f-[A-Za-z0-9_-]{1,64}");
    }

    synchronized JSObject start(String owner, String destination) throws IOException {
        if (id != null) throw new IllegalStateException("A recording is already open");
        if (recoveryUnavailable) throw new IOException("recovery");
        if (!validOwner(owner) || !validFolder(destination)) throw new IllegalArgumentException("Invalid recording ownership");
        if (usableSpace() < MIN_FREE_BYTES) throw new IOException("storage");
        String next = UUID.randomUUID().toString();
        File folder = new File(root(), next);
        if (!folder.mkdirs()) throw new IOException("Recording storage unavailable");
        id = next;
        dir = folder;
        finished.clear();
        index = 0;
        pausedTotal = 0L;
        stopReason = null;
        recovered = false;
        ownerDigest = owner;
        folderId = destination == null || destination.isEmpty() ? null : destination;
        canonicalSavePending = false;
        state = "recording";
        try {
            writeJournal();
            open(index);
        } catch (IOException | RuntimeException error) {
            discard();
            throw error;
        }
        publish();
        return status();
    }

    @SuppressWarnings("deprecation")
    private static MediaRecorder create(Context context) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? new MediaRecorder(context) : new MediaRecorder();
    }

    private void open(int segment) throws IOException {
        MediaRecorder next = create(context);
        try {
            next.setAudioSource(MediaRecorder.AudioSource.MIC);
            next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            next.setAudioChannels(1);
            next.setAudioSamplingRate(16_000);
            next.setAudioEncodingBitRate(64_000);
            next.setMaxFileSize(SEGMENT_BYTES);
            next.setOutputFile(segmentFile(segment));
            next.setOnInfoListener(this::info);
            next.setOnErrorListener((source, what, extra) -> {
                synchronized (this) {
                    if (recorder != source) return;
                    end("error", false);
                }
            });
            next.prepare();
            next.start();
        } catch (IOException | RuntimeException error) {
            next.release();
            throw error;
        }
        recorder = next;
        segmentStarted = SystemClock.elapsedRealtime();
        pausedTotal = 0L;
        pausedAt = 0L;
        scheduleRollover();
    }

    private void scheduleRollover() {
        main.removeCallbacks(rollover);
        if (recorder != null && "recording".equals(state)) {
            main.postDelayed(rollover, Math.max(1_000L, SEGMENT_MS - currentMs()));
        }
    }

    private long currentMs() {
        if (recorder == null) return 0L;
        long now = SystemClock.elapsedRealtime();
        return Math.max(0L, now - segmentStarted - pausedTotal - (pausedAt > 0 ? now - pausedAt : 0L));
    }

    private synchronized void rollover() {
        if (recorder == null || !"recording".equals(state)) return;
        if (currentMs() < SEGMENT_MS - 500L) {
            scheduleRollover();
            return;
        }
        finishCurrent();
        if (usableSpace() < MIN_FREE_BYTES) {
            state = "stopped";
            stopReason = "storage";
            publish();
            return;
        }
        try {
            open(index);
        } catch (IOException | RuntimeException error) {
            state = "stopped";
            stopReason = "error";
        }
        publish();
    }

    private synchronized void info(MediaRecorder source, int what, int extra) {
        if (recorder != source) return;
        try {
            if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_APPROACHING) {
                if (usableSpace() < MIN_FREE_BYTES) {
                    end("storage", true);
                    return;
                }
                source.setNextOutputFile(segmentFile(index + 1));
            } else if (what == MediaRecorder.MEDIA_RECORDER_INFO_NEXT_OUTPUT_FILE_STARTED) {
                long now = SystemClock.elapsedRealtime();
                finished.add(new Segment(Math.max(1L, now - segmentStarted - pausedTotal), null));
                index++;
                segmentStarted = now;
                pausedTotal = 0L;
                writeJournal();
                scheduleRollover();
                publish();
            } else if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) {
                finishCurrent();
                if (usableSpace() < MIN_FREE_BYTES) {
                    state = "stopped";
                    stopReason = "storage";
                    publish();
                    return;
                }
                open(index);
                publish();
            }
        } catch (IOException | RuntimeException error) {
            end("error", false);
        }
    }

    private void finishCurrent() {
        main.removeCallbacks(rollover);
        MediaRecorder active = recorder;
        recorder = null;
        if (active == null) return;
        long now = SystemClock.elapsedRealtime();
        long duration = Math.max(1L, now - segmentStarted - pausedTotal - (pausedAt > 0 ? now - pausedAt : 0L));
        boolean kept = false;
        try {
            active.stop();
            kept = true;
        } catch (RuntimeException ignored) {
        }
        active.release();
        File current = segmentFile(index);
        if (kept && current.isFile() && current.length() > 0) {
            finished.add(new Segment(duration, null));
            index++;
        } else {
            current.delete();
        }
        pausedTotal = 0L;
        pausedAt = 0L;
        try {
            writeJournal();
        } catch (IOException ignored) {
        }
    }

    private void end(String reason, boolean keepCurrent) {
        if (keepCurrent) {
            finishCurrent();
        } else {
            main.removeCallbacks(rollover);
            MediaRecorder active = recorder;
            recorder = null;
            if (active != null) {
                try {
                    active.stop();
                } catch (RuntimeException ignored) {
                }
                active.release();
                segmentFile(index).delete();
            }
        }
        pausedAt = 0L;
        pausedTotal = 0L;
        state = "stopped";
        stopReason = reason;
        publish();
    }

    synchronized JSObject pause(String recordingId) {
        owned(recordingId);
        if ("recording".equals(state) && recorder != null) {
            finishCurrent();
            state = "paused";
            publish();
        }
        return status();
    }

    synchronized JSObject resume(String recordingId) throws IOException {
        owned(recordingId);
        if (canonicalSavePending || canonicalSaveInFlight) throw new IOException("Note save is unconfirmed");
        if (!"paused".equals(state) && !"stopped".equals(state)) return status();
        if (usableSpace() < MIN_FREE_BYTES) throw new IOException("storage");
        if (recorder != null) {
            recorder.resume();
            pausedTotal += SystemClock.elapsedRealtime() - pausedAt;
            pausedAt = 0L;
            state = "recording";
            scheduleRollover();
        } else {
            String before = state;
            state = "recording";
            try {
                open(index);
            } catch (IOException | RuntimeException error) {
                state = before;
                throw error;
            }
        }
        stopReason = null;
        recovered = false;
        publish();
        return status();
    }

    synchronized JSObject stop(String recordingId) {
        owned(recordingId);
        if (recorder != null) finishCurrent();
        state = "stopped";
        if (stopReason == null) stopReason = "user";
        publish();
        return status();
    }

    synchronized boolean beginCanonicalSave(String recordingId) {
        owned(recordingId);
        if (canonicalSavePending || canonicalSaveInFlight || ownerDigest == null || !"stopped".equals(state) || finished.isEmpty()) {
            return false;
        }
        canonicalSaveInFlight = true;
        return true;
    }

    synchronized void commitCanonicalSave(String recordingId) throws IOException {
        owned(recordingId);
        canonicalSavePending = true;
        canonicalSaveInFlight = false;
        writeJournal();
    }

    synchronized void abortCanonicalSave(String recordingId) {
        if (owns(recordingId)) canonicalSaveInFlight = false;
    }

    synchronized void discard() {
        main.removeCallbacks(rollover);
        MediaRecorder active = recorder;
        recorder = null;
        if (active != null) {
            try {
                active.stop();
            } catch (RuntimeException ignored) {
            }
            active.release();
        }
        if (dir != null) deleteTree(dir);
        id = null;
        dir = null;
        ownerDigest = null;
        folderId = null;
        canonicalSavePending = false;
        canonicalSaveInFlight = false;
        finished.clear();
        index = 0;
        state = "idle";
        stopReason = null;
        recovered = false;
        pausedTotal = 0L;
        pausedAt = 0L;
        publish();
    }

    synchronized boolean owns(String recordingId) {
        return id != null && id.equals(recordingId);
    }

    private void owned(String recordingId) {
        if (!owns(recordingId)) throw new IllegalStateException("Recording changed");
    }

    synchronized boolean open() {
        return id != null;
    }

    synchronized JSObject status() {
        JSObject out = new JSObject().put("state", state);
        if (id == null) return out;
        out.put("recordingId", id);
        out.put("recovered", recovered);
        if (ownerDigest != null) {
            out.put("binding", new JSObject()
                .put("ownerDigest", ownerDigest)
                .put("folderId", folderId == null ? JSONObject.NULL : folderId));
        }
        if (canonicalSavePending) out.put("canonicalSavePending", true);
        if (stopReason != null) out.put("stopReason", stopReason);
        long total = 0L;
        JSArray segments = new JSArray();
        for (int i = 0; i < finished.size(); i++) {
            Segment segment = finished.get(i);
            total += segment.durationMs;
            JSObject entry = new JSObject()
                .put("segmentId", id + "-s" + i)
                .put("durationMs", segment.durationMs);
            if (segment.text != null) entry.put("text", segment.text);
            segments.put(entry);
        }
        total += currentMs();
        out.put("durationMs", total);
        out.put("segments", segments);
        double peak = 0.0;
        if (recorder != null && "recording".equals(state)) {
            try {
                peak = Math.max(0.0, Math.min(1.0, recorder.getMaxAmplitude() / 32767.0));
            } catch (RuntimeException ignored) {
            }
        }
        out.put("peak", peak);
        return out;
    }

    private void publish() {
        Listener target = listener;
        if (target != null) {
            try {
                target.changed(status());
            } catch (RuntimeException ignored) {
            }
        }
    }

    private void writeJournal() throws IOException {
        AtomicFile file = journal();
        FileOutputStream out = null;
        try {
            JSONArray list = new JSONArray();
            for (Segment segment : finished) {
                JSONObject item = new JSONObject().put("d", segment.durationMs);
                if (segment.text != null) item.put("t", segment.text);
                list.put(item);
            }
            JSONObject record = new JSONObject()
                .put("segments", list)
                .put("ownerDigest", ownerDigest)
                .put("folderId", folderId)
                .put("canonicalSavePending", canonicalSavePending);
            out = file.startWrite();
            out.write(record.toString().getBytes(StandardCharsets.UTF_8));
            file.finishWrite(out);
        } catch (JSONException | IOException error) {
            if (out != null) file.failWrite(out);
            throw new IOException("Recording index unavailable", error);
        }
    }

    synchronized File joined(String recordingId) throws IOException {
        owned(recordingId);
        if (recorder != null || finished.isEmpty()) throw new IOException("Stop the recording first");
        File out = new File(dir, "joined.m4a");
        out.delete();
        MediaMuxer muxer = new MediaMuxer(out.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
        int track = -1;
        long offset = 0L;
        boolean started = false;
        try {
            ByteBuffer buffer = ByteBuffer.allocate(64 * 1024);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            for (int i = 0; i < finished.size(); i++) {
                MediaExtractor extractor = new MediaExtractor();
                try {
                    extractor.setDataSource(segmentFile(i).getAbsolutePath());
                    int audio = -1;
                    MediaFormat format = null;
                    for (int t = 0; t < extractor.getTrackCount(); t++) {
                        MediaFormat candidate = extractor.getTrackFormat(t);
                        String mime = candidate.getString(MediaFormat.KEY_MIME);
                        if (mime != null && mime.startsWith("audio/")) {
                            audio = t;
                            format = candidate;
                            break;
                        }
                    }
                    if (audio < 0) throw new IOException("Segment has no audio");
                    extractor.selectTrack(audio);
                    if (!started) {
                        track = muxer.addTrack(format);
                        muxer.start();
                        started = true;
                    }
                    int rate = format.containsKey(MediaFormat.KEY_SAMPLE_RATE)
                        ? format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        : 16_000;
                    long last = -1L;
                    while (true) {
                        buffer.clear();
                        int size = extractor.readSampleData(buffer, 0);
                        if (size < 0) break;
                        long time = extractor.getSampleTime();
                        last = Math.max(last, time);
                        int flags = (extractor.getSampleFlags() & MediaExtractor.SAMPLE_FLAG_SYNC) != 0
                            ? MediaCodec.BUFFER_FLAG_KEY_FRAME
                            : 0;
                        info.set(0, size, offset + time, flags);
                        muxer.writeSampleData(track, buffer, info);
                        extractor.advance();
                    }
                    offset += Math.max(0L, last) + 1024L * 1_000_000L / Math.max(1, rate);
                } finally {
                    extractor.release();
                }
            }
            if (!started) throw new IOException("No audio");
            muxer.stop();
        } catch (IOException | RuntimeException error) {
            try {
                muxer.release();
            } catch (RuntimeException ignored) {
            }
            out.delete();
            throw error instanceof IOException io ? io : new IOException("Recording could not be joined", error);
        }
        muxer.release();
        return out;
    }

    synchronized long totalMs() {
        long total = 0L;
        for (Segment segment : finished) total += segment.durationMs;
        return total;
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteTree(child);
        }
        file.delete();
    }
}
