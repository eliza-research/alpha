package ai.alphacompute.localllm;

import android.app.ActivityManager;
import android.content.ComponentCallbacks2;
import android.content.Context;
import android.net.ConnectivityManager;
import android.os.StatFs;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Manages resumable HTTP Range downloads, SHA-256 verification, Wi-Fi metered checks,
 * activation state, and memory-pressure eviction for local GGUF models.
 */
public final class AlphaLocalModelManager {
    /** Valid AI routing modes persisted by Alpha. */
    public static final Set<String> VALID_MODES = Set.of("local", "cloud", "own-key");
    /** Subdirectory inside {@code getNoBackupFilesDir()} that stores downloaded GGUF models. */
    public static final String MODELS_DIR_NAME = "local-models";
    /** Rejection code returned when a large model download is attempted on a metered cellular link without opt-in. */
    public static final String ERROR_METERED_NETWORK = "METERED_NETWORK_REQUIRED";
    private static final int TRIM_LEVEL_RUNNING_LOW = 10;
    private static final int TRIM_LEVEL_RUNNING_CRITICAL = 15;

    /** Download and verification progress update emitted during model installation. */
    public record DownloadProgress(
        String modelId,
        String phase,
        long downloadedBytes,
        long totalBytes,
        int percent,
        String error
    ) {
        /** Serializes this progress snapshot to JSON. */
        public JSONObject toJson() throws JSONException {
            JSONObject out = new JSONObject()
                .put("modelId", modelId)
                .put("phase", phase)
                .put("downloadedBytes", downloadedBytes)
                .put("totalBytes", totalBytes)
                .put("percent", percent);
            if (error != null) out.put("error", error);
            return out;
        }
    }

    /** Listener notified as a model download progresses or settles. */
    public interface ProgressListener {
        /** Receives a progress update. */
        void onProgress(DownloadProgress progress);
    }

    /** Supplies total device RAM and free storage in MiB. */
    public interface DeviceMetricsProvider {
        /** Total usable RAM in MiB. */
        long totalRamMb();
        /** Available storage in MiB on the model storage filesystem. */
        long freeDiskMb();
    }

    /** HTTP transfer abstraction supporting {@code Range} headers for resumable downloads. */
    public interface HttpRangeTransport {
        /** Response returned by one range-capable HTTP GET request. */
        interface Response extends AutoCloseable {
            /** HTTP status code (200, 206, 416, etc.). */
            int statusCode();
            /** Content-Length header if provided, or -1. */
            long contentLength();
            /** Body stream. */
            InputStream stream() throws IOException;
            @Override void close() throws IOException;
        }

        /** Executes an HTTP GET for {@code url}, sending {@code Range: bytes=<resumeFrom>-} when positive. */
        Response open(String url, long resumeFrom) throws IOException;
    }

    /** Exception raised when a download or activation is refused cleanly. */
    public static final class ModelRefusedException extends Exception {
        private static final long serialVersionUID = 1L;
        public final String code;

        /** Creates a refusal carrying a stable machine-readable {@code code}. */
        public ModelRefusedException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    private static final Object SINGLETON_LOCK = new Object();
    private static AlphaLocalModelManager sharedInstance;

    private final File modelsRoot;
    private final File stateFile;
    private final BooleanSupplier meteredChecker;
    private final DeviceMetricsProvider metricsProvider;
    private final HttpRangeTransport transport;
    private final ExecutorService downloadExecutor = Executors.newCachedThreadPool(task -> {
        Thread thread = new Thread(task, "AlphaLocalModelDownload");
        thread.setDaemon(true);
        return thread;
    });
    private final Map<String, ActiveDownload> activeDownloads = new ConcurrentHashMap<>();
    private final Map<String, DownloadProgress> lastProgress = new ConcurrentHashMap<>();
    private final Set<ProgressListener> progressListeners = new CopyOnWriteArraySet<>();
    private final Object stateLock = new Object();

    private volatile Runnable memoryReleaseHook;
    private String mode = "cloud";
    private String activeModelId = AlphaLocalLlmCatalog.DEFAULT_MODEL_ID;
    private String activeStatus = "idle";

    private static final class ActiveDownload {
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        volatile Future<?> future;
    }

    /** Returns the process-wide shared manager backed by {@code context.getNoBackupFilesDir()/local-models}. */
    public static AlphaLocalModelManager shared(Context context) {
        synchronized (SINGLETON_LOCK) {
            if (sharedInstance == null) {
                Context appContext = context.getApplicationContext();
                File root = new File(appContext.getNoBackupFilesDir(), MODELS_DIR_NAME);
                sharedInstance = new AlphaLocalModelManager(
                    root,
                    () -> isAndroidNetworkMetered(appContext),
                    androidMetricsProvider(appContext, root),
                    urlConnectionTransport()
                );
            }
            return sharedInstance;
        }
    }

    /** Creates a manager with explicit storage, network, device metrics, and HTTP transport hooks. */
    public AlphaLocalModelManager(
        File modelsRoot,
        BooleanSupplier meteredChecker,
        DeviceMetricsProvider metricsProvider,
        HttpRangeTransport transport
    ) {
        this.modelsRoot = modelsRoot;
        this.stateFile = new File(modelsRoot, "state.json");
        this.meteredChecker = meteredChecker;
        this.metricsProvider = metricsProvider;
        this.transport = transport;
        if (!modelsRoot.isDirectory()) {
            modelsRoot.mkdirs();
        }
        loadState();
    }

    /** Registers a callback invoked when memory pressure or model removal must release native state. */
    public void setMemoryReleaseHook(Runnable hook) {
        this.memoryReleaseHook = hook;
    }

    /** Subscribes to live download progress events across all model downloads until closed. */
    public AutoCloseable subscribeProgress(ProgressListener listener) {
        if (listener == null) return () -> {};
        progressListeners.add(listener);
        return () -> progressListeners.remove(listener);
    }

    /** Returns the canonical root directory where all local GGUF bundles live. */
    public File modelsRoot() {
        return modelsRoot;
    }

    /** Returns the bundle directory for {@code modelId}. */
    public File modelBundleDir(String modelId) {
        return new File(modelsRoot, modelId);
    }

    /** Returns the installed primary GGUF file path for {@code entry}. */
    public File modelFile(AlphaLocalLlmCatalog.ModelEntry entry) {
        return new File(modelBundleDir(entry.id()), entry.relativePath());
    }

    /** Returns the staging {@code .part} file path for resumable downloads of {@code entry}. */
    public File partialFile(AlphaLocalLlmCatalog.ModelEntry entry) {
        File target = modelFile(entry);
        return new File(target.getParentFile(), target.getName() + ".part");
    }

    /** Reports whether the active network is currently metered. */
    public boolean isNetworkMetered() {
        try {
            return meteredChecker.getAsBoolean();
        } catch (RuntimeException unavailable) {
            return false;
        }
    }

    /** Returns the current AI mode ({@code local}, {@code cloud}, or {@code own-key}). */
    public String mode() {
        synchronized (stateLock) {
            return mode;
        }
    }

    /** Returns the currently selected local model identifier. */
    public String activeModelId() {
        synchronized (stateLock) {
            return activeModelId;
        }
    }

    /** Returns the current active model load status ({@code idle}, {@code ready}, or {@code failed}). */
    public String activeStatus() {
        synchronized (stateLock) {
            return activeStatus;
        }
    }

    /** Updates the persisted AI mode and optional selected local model identifier. */
    public JSONObject setMode(String nextMode, String optionalModelId) throws ModelRefusedException, JSONException {
        if (nextMode == null || !VALID_MODES.contains(nextMode.trim())) {
            throw new ModelRefusedException("INVALID_MODE", "Mode must be local, cloud, or own-key");
        }
        String normalizedMode = nextMode.trim();
        synchronized (stateLock) {
            if (optionalModelId != null && !optionalModelId.isBlank()) {
                AlphaLocalLlmCatalog.ModelEntry entry = AlphaLocalLlmCatalog.byId(optionalModelId);
                if (entry == null) {
                    throw new ModelRefusedException("UNKNOWN_MODEL", "Unknown local model: " + optionalModelId);
                }
                activeModelId = entry.id();
            }
            mode = normalizedMode;
            if (!"local".equals(mode)) {
                activeStatus = "idle";
            }
            persistStateLocked();
        }
        if (!"local".equals(normalizedMode)) {
            triggerMemoryRelease();
        }
        return new JSONObject()
            .put("ok", true)
            .put("mode", mode())
            .put("activeModelId", activeModelId());
    }

    /** Returns true when {@code entry}'s GGUF exists on disk with the expected byte size. */
    public boolean isInstalled(AlphaLocalLlmCatalog.ModelEntry entry) {
        File file = modelFile(entry);
        return file.isFile() && file.length() == entry.sizeBytes();
    }

    /** Verifies {@code entry}'s installed GGUF against its pinned byte length and SHA-256 digest. */
    public boolean verifyInstalledDigest(AlphaLocalLlmCatalog.ModelEntry entry) throws IOException {
        File file = modelFile(entry);
        if (!file.isFile() || file.length() != entry.sizeBytes()) return false;
        return entry.sha256().equalsIgnoreCase(sha256Hex(file));
    }

    /** Starts an asynchronous resumable download for {@code modelId}. */
    public DownloadProgress startDownload(String modelId, boolean allowMetered, ProgressListener listener)
        throws ModelRefusedException {
        AlphaLocalLlmCatalog.ModelEntry entry = requireEntry(modelId);
        if (!allowMetered && isNetworkMetered()) {
            throw new ModelRefusedException(ERROR_METERED_NETWORK, "Connect to Wi-Fi or confirm cellular download");
        }
        AlphaLocalLlmCatalog.DeviceFit fit = AlphaLocalLlmCatalog.deviceFit(
            entry,
            metricsProvider.totalRamMb(),
            metricsProvider.freeDiskMb()
        );
        if (!fit.fitsDisk()) {
            throw new ModelRefusedException("INSUFFICIENT_STORAGE", fit.reason());
        }
        if (isInstalled(entry)) {
            DownloadProgress already = new DownloadProgress(entry.id(), "installed", entry.sizeBytes(), entry.sizeBytes(), 100, null);
            lastProgress.put(entry.id(), already);
            notifyProgress(listener, already);
            return already;
        }
        ActiveDownload task = new ActiveDownload();
        ActiveDownload existing = activeDownloads.putIfAbsent(entry.id(), task);
        if (existing != null) {
            return lastProgress.getOrDefault(
                entry.id(),
                new DownloadProgress(entry.id(), "downloading", existingPartialBytes(entry), entry.sizeBytes(), 0, null)
            );
        }
        long existingBytes = existingPartialBytes(entry);
        DownloadProgress started = new DownloadProgress(
            entry.id(),
            "downloading",
            existingBytes,
            entry.sizeBytes(),
            percentOf(existingBytes, entry.sizeBytes()),
            null
        );
        lastProgress.put(entry.id(), started);
        notifyProgress(listener, started);
        task.future = downloadExecutor.submit(() -> {
            try {
                downloadBlockingInternal(entry, entry.url(), entry.sizeBytes(), entry.sha256(), task.cancelled, listener);
            } finally {
                activeDownloads.remove(entry.id(), task);
            }
        });
        return started;
    }

    /** Synchronously downloads (resuming from any existing {@code .part} file) and verifies an artifact. */
    public DownloadProgress downloadBlocking(
        String modelId,
        boolean allowMetered,
        ProgressListener listener
    ) throws ModelRefusedException {
        AlphaLocalLlmCatalog.ModelEntry entry = requireEntry(modelId);
        if (!allowMetered && isNetworkMetered()) {
            throw new ModelRefusedException(ERROR_METERED_NETWORK, "Connect to Wi-Fi or confirm cellular download");
        }
        return downloadBlockingInternal(entry, entry.url(), entry.sizeBytes(), entry.sha256(), new AtomicBoolean(false), listener);
    }

    /** Synchronously downloads and verifies an explicit URL/size/digest into {@code modelId}'s bundle for testing. */
    DownloadProgress downloadBlockingForTest(
        AlphaLocalLlmCatalog.ModelEntry entry,
        String overrideUrl,
        long expectedBytes,
        String expectedSha256,
        boolean allowMetered,
        ProgressListener listener
    ) throws ModelRefusedException {
        if (!allowMetered && isNetworkMetered()) {
            throw new ModelRefusedException(ERROR_METERED_NETWORK, "Connect to Wi-Fi or confirm cellular download");
        }
        return downloadBlockingInternal(entry, overrideUrl, expectedBytes, expectedSha256, new AtomicBoolean(false), listener);
    }

    private DownloadProgress downloadBlockingInternal(
        AlphaLocalLlmCatalog.ModelEntry entry,
        String url,
        long expectedBytes,
        String expectedSha256,
        AtomicBoolean cancelled,
        ProgressListener listener
    ) {
        File target = modelFile(entry);
        File partial = partialFile(entry);
        File parent = target.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            return recordProgress(listener, new DownloadProgress(entry.id(), "failed", 0L, expectedBytes, 0, "Cannot create model directory"));
        }
        long existing = partial.isFile() ? partial.length() : 0L;
        if (existing > expectedBytes) {
            partial.delete();
            existing = 0L;
        }
        try {
            if (existing < expectedBytes) {
                try (HttpRangeTransport.Response response = transport.open(url, existing)) {
                    int status = response.statusCode();
                    boolean append;
                    if (status == 206 && existing > 0L) {
                        append = true;
                    } else if (status == 200) {
                        append = false;
                        existing = 0L;
                    } else if (status == 416 && existing == expectedBytes) {
                        append = true;
                    } else {
                        return recordProgress(listener, new DownloadProgress(
                            entry.id(),
                            "failed",
                            existing,
                            expectedBytes,
                            percentOf(existing, expectedBytes),
                            "HTTP " + status
                        ));
                    }
                    if (status != 416) {
                        long received = existing;
                        byte[] buffer = new byte[65536];
                        int lastReportedPercent = percentOf(received, expectedBytes);
                        try (InputStream in = response.stream();
                             FileOutputStream out = new FileOutputStream(partial, append)) {
                            int read;
                            while ((read = in.read(buffer)) != -1) {
                                if (cancelled.get() || Thread.currentThread().isInterrupted()) {
                                    return recordProgress(listener, new DownloadProgress(
                                        entry.id(),
                                        "cancelled",
                                        received,
                                        expectedBytes,
                                        percentOf(received, expectedBytes),
                                        null
                                    ));
                                }
                                out.write(buffer, 0, read);
                                received += read;
                                int nextPercent = percentOf(received, expectedBytes);
                                if (nextPercent != lastReportedPercent) {
                                    lastReportedPercent = nextPercent;
                                    recordProgress(listener, new DownloadProgress(
                                        entry.id(),
                                        "downloading",
                                        received,
                                        expectedBytes,
                                        nextPercent,
                                        null
                                    ));
                                }
                            }
                            out.getFD().sync();
                        }
                    }
                }
            }
            if (cancelled.get()) {
                long got = partial.isFile() ? partial.length() : 0L;
                return recordProgress(listener, new DownloadProgress(entry.id(), "cancelled", got, expectedBytes, percentOf(got, expectedBytes), null));
            }
            long finalLen = partial.length();
            recordProgress(listener, new DownloadProgress(entry.id(), "verifying", finalLen, expectedBytes, 100, null));
            if (finalLen != expectedBytes) {
                partial.delete();
                return recordProgress(listener, new DownloadProgress(
                    entry.id(),
                    "failed",
                    finalLen,
                    expectedBytes,
                    0,
                    "SIZE_MISMATCH"
                ));
            }
            String actualDigest = sha256Hex(partial);
            if (!expectedSha256.equalsIgnoreCase(actualDigest)) {
                partial.delete();
                return recordProgress(listener, new DownloadProgress(
                    entry.id(),
                    "failed",
                    finalLen,
                    expectedBytes,
                    0,
                    "DIGEST_MISMATCH"
                ));
            }
            Files.move(partial.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            return recordProgress(listener, new DownloadProgress(entry.id(), "installed", expectedBytes, expectedBytes, 100, null));
        } catch (IOException ioError) {
            long got = partial.isFile() ? partial.length() : 0L;
            return recordProgress(listener, new DownloadProgress(
                entry.id(),
                "failed",
                got,
                expectedBytes,
                percentOf(got, expectedBytes),
                ioError.getMessage() == null ? "IO_ERROR" : ioError.getMessage()
            ));
        }
    }

    /** Cancels an active download while preserving the {@code .part} file for future resume. */
    public boolean cancelDownload(String modelId) {
        ActiveDownload active = activeDownloads.remove(modelId);
        if (active == null) return false;
        active.cancelled.set(true);
        Future<?> future = active.future;
        if (future != null) future.cancel(true);
        AlphaLocalLlmCatalog.ModelEntry entry = AlphaLocalLlmCatalog.byId(modelId);
        if (entry != null) {
            long partialBytes = existingPartialBytes(entry);
            lastProgress.put(modelId, new DownloadProgress(modelId, "cancelled", partialBytes, entry.sizeBytes(), percentOf(partialBytes, entry.sizeBytes()), null));
        }
        return true;
    }

    /** Marks an installed, verified model as active and ready. */
    public JSONObject activate(String modelId) throws ModelRefusedException, IOException, JSONException {
        AlphaLocalLlmCatalog.ModelEntry entry = requireEntry(modelId);
        if (!verifyInstalledDigest(entry)) {
            throw new ModelRefusedException("MODEL_NOT_INSTALLED", "Model is missing or failed SHA-256 verification: " + entry.id());
        }
        synchronized (stateLock) {
            activeModelId = entry.id();
            activeStatus = "ready";
            persistStateLocked();
        }
        return new JSONObject()
            .put("ok", true)
            .put("activeModelId", entry.id())
            .put("activeStatus", "ready")
            .put("bundleDir", modelBundleDir(entry.id()).getAbsolutePath());
    }

    /** Unloads the active model from native memory without removing files from disk. */
    public JSONObject unload() throws JSONException {
        triggerMemoryRelease();
        synchronized (stateLock) {
            activeStatus = "idle";
            persistStateLocked();
        }
        return new JSONObject().put("ok", true).put("activeStatus", "idle");
    }

    /** Unloads and deletes all stored files for {@code modelId}. */
    public JSONObject delete(String modelId) throws ModelRefusedException, JSONException {
        AlphaLocalLlmCatalog.ModelEntry entry = requireEntry(modelId);
        cancelDownload(entry.id());
        boolean wasActive;
        synchronized (stateLock) {
            wasActive = entry.id().equals(activeModelId);
            if (wasActive) {
                activeStatus = "idle";
                persistStateLocked();
            }
        }
        if (wasActive) {
            triggerMemoryRelease();
        }
        deleteRecursively(modelBundleDir(entry.id()));
        lastProgress.remove(entry.id());
        return new JSONObject()
            .put("ok", true)
            .put("deletedModelId", entry.id())
            .put("activeModelId", activeModelId());
    }

    /** Handles Android {@code onTrimMemory(int)} callbacks by releasing native model weights under pressure. */
    public boolean onTrimMemory(int level) {
        if (level >= ComponentCallbacks2.TRIM_MEMORY_BACKGROUND
            || level == TRIM_LEVEL_RUNNING_CRITICAL
            || level == TRIM_LEVEL_RUNNING_LOW) {
            triggerMemoryRelease();
            synchronized (stateLock) {
                if ("ready".equals(activeStatus)) {
                    activeStatus = "idle";
                }
            }
            return true;
        }
        return false;
    }

    /** Builds a full status JSON payload for Settings and the resident agent. */
    public JSONObject statusJson(boolean engineAvailable, String socketPath) throws JSONException {
        long totalRamMb = metricsProvider.totalRamMb();
        long freeDiskMb = metricsProvider.freeDiskMb();
        JSONArray models = new JSONArray();
        String currentActiveId = activeModelId();
        String currentActiveStatus = activeStatus();
        for (AlphaLocalLlmCatalog.ModelEntry entry : AlphaLocalLlmCatalog.all()) {
            AlphaLocalLlmCatalog.DeviceFit fit = AlphaLocalLlmCatalog.deviceFit(entry, totalRamMb, freeDiskMb);
            JSONObject item = AlphaLocalLlmCatalog.toJson(entry, fit);
            boolean installed = isInstalled(entry);
            long partialBytes = installed ? entry.sizeBytes() : existingPartialBytes(entry);
            DownloadProgress progress = lastProgress.get(entry.id());
            String installPhase = activeDownloads.containsKey(entry.id())
                ? (progress != null ? progress.phase() : "downloading")
                : installed ? "installed"
                : partialBytes > 0L ? "partial"
                : progress != null && "failed".equals(progress.phase()) ? "failed"
                : "absent";
            item.put("installPhase", installPhase)
                .put("installed", installed)
                .put("active", entry.id().equals(currentActiveId) && "ready".equals(currentActiveStatus))
                .put("downloadedBytes", partialBytes)
                .put("percent", installed ? 100 : percentOf(partialBytes, entry.sizeBytes()));
            if (progress != null && progress.error() != null) {
                item.put("lastError", progress.error());
            }
            models.put(item);
        }
        return new JSONObject()
            .put("mode", mode())
            .put("activeModelId", currentActiveId)
            .put("activeStatus", currentActiveStatus)
            .put("engineAvailable", engineAvailable)
            .put("socketPath", socketPath == null ? JSONObject.NULL : socketPath)
            .put("metered", isNetworkMetered())
            .put("deviceRamMb", totalRamMb)
            .put("freeDiskMb", freeDiskMb)
            .put("ramTier", AlphaLocalLlmCatalog.ramTier(totalRamMb))
            .put("modelsRoot", modelsRoot.getAbsolutePath())
            .put("models", models);
    }

    /** Computes lowercase hexadecimal SHA-256 of {@code file}. */
    public static String sha256Hex(File file) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[65536];
            try (FileInputStream in = new FileInputStream(file)) {
                int read;
                while ((read = in.read(buffer)) != -1) {
                    digest.update(buffer, 0, read);
                }
            }
            byte[] sum = digest.digest();
            StringBuilder hex = new StringBuilder(sum.length * 2);
            for (byte b : sum) {
                hex.append(String.format(Locale.ROOT, "%02x", b & 0xff));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    private AlphaLocalLlmCatalog.ModelEntry requireEntry(String modelId) throws ModelRefusedException {
        AlphaLocalLlmCatalog.ModelEntry entry = AlphaLocalLlmCatalog.byId(modelId);
        if (entry == null) {
            throw new ModelRefusedException("UNKNOWN_MODEL", "Unknown curated model: " + modelId);
        }
        return entry;
    }

    private long existingPartialBytes(AlphaLocalLlmCatalog.ModelEntry entry) {
        File partial = partialFile(entry);
        return partial.isFile() ? partial.length() : 0L;
    }

    private static int percentOf(long downloaded, long total) {
        if (total <= 0L) return 0;
        return (int) Math.min(100L, Math.max(0L, (downloaded * 100L) / total));
    }

    private DownloadProgress recordProgress(ProgressListener listener, DownloadProgress progress) {
        lastProgress.put(progress.modelId(), progress);
        notifyProgress(listener, progress);
        return progress;
    }

    private void notifyProgress(ProgressListener listener, DownloadProgress progress) {
        if (listener != null) {
            try {
                listener.onProgress(progress);
            } catch (RuntimeException ignored) {
            }
        }
        for (ProgressListener subscriber : progressListeners) {
            if (subscriber == listener) continue;
            try {
                subscriber.onProgress(progress);
            } catch (RuntimeException ignored) {
            }
        }
    }

    private void triggerMemoryRelease() {
        Runnable hook = memoryReleaseHook;
        if (hook != null) {
            hook.run();
        }
    }

    private void loadState() {
        if (!stateFile.isFile()) return;
        try {
            String raw = new String(Files.readAllBytes(stateFile.toPath()), StandardCharsets.UTF_8);
            JSONObject obj = new JSONObject(raw);
            String savedMode = obj.optString("mode", "cloud");
            String savedModel = obj.optString("activeModelId", AlphaLocalLlmCatalog.DEFAULT_MODEL_ID);
            synchronized (stateLock) {
                if (VALID_MODES.contains(savedMode)) mode = savedMode;
                if (AlphaLocalLlmCatalog.byId(savedModel) != null) activeModelId = savedModel;
            }
        } catch (IOException | JSONException ignored) {
        }
    }

    private void persistStateLocked() {
        try {
            if (!modelsRoot.isDirectory()) modelsRoot.mkdirs();
            JSONObject obj = new JSONObject()
                .put("mode", mode)
                .put("activeModelId", activeModelId)
                .put("activeStatus", activeStatus);
            File temp = new File(modelsRoot, "state.json.tmp");
            Files.write(temp.toPath(), (obj.toString(2) + "\n").getBytes(StandardCharsets.UTF_8));
            Files.move(temp.toPath(), stateFile.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException | JSONException ignored) {
        }
    }

    private static void deleteRecursively(File target) {
        if (target == null || !target.exists()) return;
        if (target.isDirectory()) {
            File[] children = target.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        target.delete();
    }

    private static boolean isAndroidNetworkMetered(Context context) {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        return manager != null && manager.isActiveNetworkMetered();
    }

    private static DeviceMetricsProvider androidMetricsProvider(Context context, File root) {
        return new DeviceMetricsProvider() {
            @Override public long totalRamMb() {
                ActivityManager manager = context.getSystemService(ActivityManager.class);
                if (manager == null) return 8192L;
                ActivityManager.MemoryInfo info = new ActivityManager.MemoryInfo();
                manager.getMemoryInfo(info);
                return info.totalMem > 0L ? info.totalMem / (1024L * 1024L) : 8192L;
            }

            @Override public long freeDiskMb() {
                File dir = root.isDirectory() ? root : root.getParentFile();
                if (dir == null || !dir.exists()) return 0L;
                StatFs stat = new StatFs(dir.getAbsolutePath());
                return stat.getAvailableBytes() / (1024L * 1024L);
            }
        };
    }

    private static HttpRangeTransport urlConnectionTransport() {
        return (url, resumeFrom) -> {
            HttpURLConnection conn = (HttpURLConnection) URI.create(url).toURL().openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(60_000);
            conn.setRequestProperty("User-Agent", "AlphaPhone-LocalLLM/1.0");
            if (resumeFrom > 0L) {
                conn.setRequestProperty("Range", "bytes=" + resumeFrom + "-");
            }
            int status = conn.getResponseCode();
            long length = conn.getContentLengthLong();
            InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            return new HttpRangeTransport.Response() {
                @Override public int statusCode() { return status; }
                @Override public long contentLength() { return length; }
                @Override public InputStream stream() throws IOException {
                    if (stream == null) throw new IOException("Empty HTTP response body");
                    return stream;
                }
                @Override public void close() throws IOException {
                    if (stream != null) stream.close();
                    conn.disconnect();
                }
            };
        };
    }
}
