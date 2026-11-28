package ai.alphacompute.localllm;

import android.content.Context;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.net.LocalSocketAddress;
import android.os.Process;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Isolated text-generation host serving {@code apps/agent} over a private owner-only
 * Unix domain socket ({@code files/ipc/local-llm.sock}, {@code 0600}), backed by
 * {@code libelizainference.so} via {@code ai.eliza.voice.VoiceNative} reflection.
 */
public final class AlphaLocalInferenceHost {
    /** Relative path inside the application's files directory for the private local-LLM socket. */
    public static final String SOCKET_RELATIVE_PATH = "ipc/local-llm.sock";
    private static final int DEFAULT_MAX_TOKENS = 1024;
    private static final int DEFAULT_STEP_TOKENS = 8;
    private static final int MAX_STEP_TOKENS = 256;

    /** Native LLM engine abstraction isolating text decode from speech contexts. */
    public interface NativeLlmEngine {
        /** Returns true when the native library supports streaming LLM decode. */
        boolean isAvailable();
        /** Opens a native model context anchored at {@code bundleDir}. */
        long openContext(String bundleDir);
        /** Destroys a native model context. */
        void closeContext(long contextHandle);
        /** Tokenizes UTF-8 prompt bytes with special control tokens parsed. */
        int[] tokenize(long contextHandle, byte[] promptUtf8);
        /** Opens a generation stream on {@code contextHandle}. */
        long openStream(long contextHandle, int maxTokens, float temperature, float topP, int topK, int nGpuLayers, String drafterPath);
        /** Prefills prompt tokens into the stream KV cache. */
        void prefill(long streamHandle, int[] tokens);
        /** Runs one bounded decode step returning JSON {@code {text, done, nout}}. */
        String nextStep(long streamHandle, int maxStepTokens);
        /** Resets KV cache state on an existing stream. */
        void resetStream(long streamHandle);
        /** Closes a generation stream. */
        void closeStream(long streamHandle);
    }

    /** Callback receiving streamed text deltas during local generation. */
    public interface DeltaConsumer {
        /** Receives the next non-empty text chunk. */
        void onDelta(String delta) throws IOException;
    }

    /** Accepted client stream connection on the local inference socket. */
    public interface ClientConnection extends Closeable {
        /** Returns the client input stream. */
        InputStream inputStream() throws IOException;
        /** Returns the client output stream. */
        OutputStream outputStream() throws IOException;
    }

    /** Bound Unix domain socket server accepting local inference connections. */
    public interface SocketServer extends Closeable {
        /** Accepts the next incoming client connection. */
        ClientConnection accept() throws IOException;
    }

    /** Factory binding the Unix domain socket server (Android LocalServerSocket by default). */
    public interface SocketServerFactory {
        /** Binds a Unix domain socket server at {@code socketPath}. */
        SocketServer bind(Path socketPath) throws IOException;
    }

    private static final Object SINGLETON_LOCK = new Object();
    private static AlphaLocalInferenceHost sharedInstance;

    private final Path socketPath;
    private final AlphaLocalModelManager modelManager;
    private final NativeLlmEngine engine;
    private final SocketServerFactory socketFactory;
    private final Object textLock = new Object();
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicBoolean cancelRequested = new AtomicBoolean(false);
    private final ExecutorService workers = Executors.newCachedThreadPool(task -> {
        Thread thread = new Thread(task, "AlphaLocalLlmConn");
        thread.setDaemon(true);
        return thread;
    });

    private volatile SocketServer serverSocket;
    private long textContextHandle;
    private String loadedBundleDir;
    private String loadedModelId;

    /** Returns the process-wide shared inference host bound to {@code files/ipc/local-llm.sock}. */
    public static AlphaLocalInferenceHost shared(Context context) {
        synchronized (SINGLETON_LOCK) {
            if (sharedInstance == null) {
                Context appContext = context.getApplicationContext();
                Path socket = new File(appContext.getFilesDir(), SOCKET_RELATIVE_PATH).toPath();
                AlphaLocalModelManager manager = AlphaLocalModelManager.shared(appContext);
                sharedInstance = new AlphaLocalInferenceHost(socket, manager, new VoiceNativeReflectionEngine());
            }
            return sharedInstance;
        }
    }

    /** Creates a local inference host over {@code socketPath}, {@code modelManager}, and {@code engine}. */
    public AlphaLocalInferenceHost(
        Path socketPath,
        AlphaLocalModelManager modelManager,
        NativeLlmEngine engine
    ) {
        this(socketPath, modelManager, engine, androidSocketServerFactory());
    }

    /** Creates a local inference host with an explicit {@code socketFactory} for JVM tests. */
    public AlphaLocalInferenceHost(
        Path socketPath,
        AlphaLocalModelManager modelManager,
        NativeLlmEngine engine,
        SocketServerFactory socketFactory
    ) {
        this.socketPath = socketPath;
        this.modelManager = modelManager;
        this.engine = engine;
        this.socketFactory = socketFactory;
        this.modelManager.setMemoryReleaseHook(this::unload);
    }

    /** Returns the filesystem path of the private Unix domain socket. */
    public Path socketPath() {
        return socketPath;
    }

    /** Reports whether the underlying native LLM engine is linked and available. */
    public boolean isEngineAvailable() {
        return engine.isAvailable();
    }

    /** Starts listening on the owner-only Unix domain socket ({@code 0600}). Idempotent. */
    public synchronized void start() throws IOException {
        if (running.get()) return;
        Path parent = socketPath.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Files.deleteIfExists(socketPath);
        SocketServer server = socketFactory.bind(socketPath);
        restrictSocketPermissions(socketPath);
        serverSocket = server;
        running.set(true);
        Thread acceptThread = new Thread(this::acceptLoop, "AlphaLocalLlmAccept");
        acceptThread.setDaemon(true);
        acceptThread.start();
    }

    /** Stops the Unix socket server, cancels in-flight generation, and frees the native text context. */
    public synchronized void stop() {
        running.set(false);
        cancel();
        SocketServer server = serverSocket;
        serverSocket = null;
        if (server != null) {
            try {
                server.close();
            } catch (IOException ignored) {
            }
        }
        try {
            Files.deleteIfExists(socketPath);
        } catch (IOException ignored) {
        }
        unload();
    }

    /** Signals cancellation to any in-flight generation loop. */
    public void cancel() {
        cancelRequested.set(true);
    }

    /** Cancels in-flight generation and releases the resident native text model context. */
    public void unload() {
        cancelRequested.set(true);
        synchronized (textLock) {
            closeContextLocked();
        }
    }

    /** Releases native text memory when Android signals memory pressure. */
    public boolean onTrimMemory(int level) {
        return modelManager.onTrimMemory(level);
    }

    /** Loads the model bundle for {@code modelId} into the isolated text context. */
    public JSONObject loadModel(String modelId) throws JSONException {
        AlphaLocalLlmCatalog.ModelEntry entry = AlphaLocalLlmCatalog.byId(modelId);
        if (entry == null) {
            return errorJson("UNKNOWN_MODEL", "Unknown model: " + modelId);
        }
        File bundleDir = modelManager.modelBundleDir(entry.id());
        if (!bundleDir.isDirectory()) {
            return errorJson("MODEL_NOT_INSTALLED", "Model bundle missing on disk: " + entry.id());
        }
        synchronized (textLock) {
            String bundlePath = bundleDir.getAbsolutePath();
            if (textContextHandle != 0L && bundlePath.equals(loadedBundleDir)) {
                return new JSONObject().put("ok", true).put("modelId", entry.id()).put("loaded", true);
            }
            closeContextLocked();
            if (!engine.isAvailable()) {
                return errorJson("ENGINE_UNAVAILABLE", "Native libelizainference text stream is unavailable");
            }
            long ctx = engine.openContext(bundlePath);
            if (ctx == 0L) {
                return errorJson("LOAD_FAILED", "Native context creation failed for " + entry.id());
            }
            textContextHandle = ctx;
            loadedBundleDir = bundlePath;
            loadedModelId = entry.id();
            return new JSONObject().put("ok", true).put("modelId", entry.id()).put("loaded", true);
        }
    }

    /** Runs one text completion directly (used by both the UDS server and {@link AlphaLocalLlmPlugin}). */
    public AlphaLocalChatTemplate.ParsedCompletion generate(
        String requestedModelId,
        List<AlphaLocalChatTemplate.ChatMessage> messages,
        List<AlphaLocalChatTemplate.ToolSpec> tools,
        int maxTokens,
        float temperature,
        DeltaConsumer deltaConsumer
    ) throws IOException {
        String modelId = requestedModelId == null || requestedModelId.isBlank()
            ? modelManager.activeModelId()
            : requestedModelId.trim();
        AlphaLocalLlmCatalog.ModelEntry entry = AlphaLocalLlmCatalog.byId(modelId);
        String family = entry != null ? entry.family() : AlphaLocalChatTemplate.normalizeFamily(modelId);
        String prompt = AlphaLocalChatTemplate.formatPrompt(family, messages, tools);
        List<String> stops = AlphaLocalChatTemplate.stopSequences(family);
        int tokenCap = maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS;

        cancelRequested.set(false);
        synchronized (textLock) {
            if (!engine.isAvailable()) {
                throw new IOException("Native libelizainference text stream is unavailable");
            }
            if (textContextHandle == 0L || (entry != null && !entry.id().equals(loadedModelId))) {
                File bundleDir = modelManager.modelBundleDir(modelId);
                closeContextLocked();
                long opened = engine.openContext(bundleDir.getAbsolutePath());
                if (opened == 0L) {
                    throw new IOException("Could not open local model context for " + modelId);
                }
                textContextHandle = opened;
                loadedBundleDir = bundleDir.getAbsolutePath();
                loadedModelId = modelId;
            }
            byte[] promptUtf8 = prompt.getBytes(StandardCharsets.UTF_8);
            int[] promptTokens = engine.tokenize(textContextHandle, promptUtf8);
            if (promptTokens == null || promptTokens.length == 0) {
                throw new IOException("Prompt tokenization returned no tokens");
            }
            String drafterPath = resolveDrafterPath(entry);
            long stream = engine.openStream(textContextHandle, tokenCap, temperature, 0.95f, 40, 0, drafterPath);
            if (stream == 0L) {
                throw new IOException("Native LLM stream open failed");
            }
            try {
                engine.prefill(stream, promptTokens);
                StringBuilder accumulated = new StringBuilder();
                int emittedOffset = 0;
                int produced = 0;
                int maxStopLen = maxLength(stops);
                while (produced < tokenCap && !cancelRequested.get()) {
                    int stepCap = Math.min(Math.min(DEFAULT_STEP_TOKENS, MAX_STEP_TOKENS), tokenCap - produced);
                    String stepJson = engine.nextStep(stream, stepCap);
                    if (stepJson == null || stepJson.isEmpty()) break;
                    JSONObject step = new JSONObject(stepJson);
                    String piece = step.optString("text", "");
                    int nout = step.optInt("nout", 0);
                    boolean done = step.optBoolean("done", false);
                    accumulated.append(piece);
                    produced += Math.max(0, nout);

                    int stopIndex = firstStopIndex(accumulated, stops);
                    if (stopIndex >= 0) {
                        if (deltaConsumer != null && stopIndex > emittedOffset) {
                            deltaConsumer.onDelta(accumulated.substring(emittedOffset, stopIndex));
                        }
                        accumulated.setLength(stopIndex);
                        emittedOffset = stopIndex;
                        break;
                    }
                    if (deltaConsumer != null) {
                        int safeEnd = Math.max(emittedOffset, accumulated.length() - maxStopLen);
                        if (safeEnd > emittedOffset) {
                            deltaConsumer.onDelta(accumulated.substring(emittedOffset, safeEnd));
                            emittedOffset = safeEnd;
                        }
                    }
                    if (done || nout <= 0) break;
                }
                if (deltaConsumer != null && accumulated.length() > emittedOffset && !cancelRequested.get()) {
                    deltaConsumer.onDelta(accumulated.substring(emittedOffset));
                }
                return AlphaLocalChatTemplate.parseOutput(family, accumulated.toString(), promptTokens.length, produced);
            } catch (JSONException malformedStep) {
                throw new IOException("Malformed native decode step JSON", malformedStep);
            } finally {
                engine.closeStream(stream);
            }
        }
    }

    private void acceptLoop() {
        while (running.get()) {
            SocketServer server = serverSocket;
            if (server == null) break;
            try {
                ClientConnection client = server.accept();
                if (client != null) {
                    workers.execute(() -> serveClient(client));
                }
            } catch (IOException stopped) {
                if (!running.get()) break;
            }
        }
    }

    private void serveClient(ClientConnection client) {
        try (ClientConnection socket = client;
             BufferedReader reader = new BufferedReader(new InputStreamReader(socket.inputStream(), StandardCharsets.UTF_8));
             BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(socket.outputStream(), StandardCharsets.UTF_8))) {
            String line;
            while (running.get() && (line = reader.readLine()) != null) {
                if (line.isBlank()) continue;
                handleFrame(line, writer);
            }
        } catch (IOException ignored) {
        }
    }

    private void handleFrame(String line, BufferedWriter writer) throws IOException {
        String id = "";
        try {
            JSONObject req = new JSONObject(line);
            id = req.optString("id", "");
            String op = req.optString("op", "");
            switch (op) {
                case "status" -> writeLine(writer, modelManager.statusJson(engine.isAvailable(), socketPath.toString())
                    .put("id", id)
                    .put("ok", true)
                    .put("loadedModelId", loadedModelId == null ? JSONObject.NULL : loadedModelId));
                case "catalog" -> writeLine(writer, AlphaLocalLlmCatalog.catalogJson(8192L, 0L)
                    .put("id", id)
                    .put("ok", true));
                case "load" -> writeLine(writer, loadModel(req.optString("modelId", modelManager.activeModelId())).put("id", id));
                case "unload" -> {
                    unload();
                    writeLine(writer, new JSONObject().put("id", id).put("ok", true));
                }
                case "cancel" -> {
                    cancel();
                    writeLine(writer, new JSONObject().put("id", id).put("ok", true));
                }
                case "generate" -> handleGenerate(id, req, false, writer);
                case "generate_stream" -> handleGenerate(id, req, true, writer);
                default -> writeLine(writer, errorJson("OP_REFUSED", "Unsupported operation: " + op).put("id", id));
            }
        } catch (JSONException malformed) {
            try {
                writeLine(writer, errorJson("MALFORMED_JSON", malformed.getMessage()).put("id", id));
            } catch (JSONException ignored) {
            }
        }
    }

    private void handleGenerate(String id, JSONObject req, boolean stream, BufferedWriter writer)
        throws IOException, JSONException {
        String modelId = req.optString("modelId", modelManager.activeModelId());
        List<AlphaLocalChatTemplate.ChatMessage> messages = AlphaLocalChatTemplate.parseMessages(req.optJSONArray("messages"));
        List<AlphaLocalChatTemplate.ToolSpec> tools = AlphaLocalChatTemplate.parseTools(req.optJSONArray("tools"));
        int maxTokens = req.optInt("maxTokens", DEFAULT_MAX_TOKENS);
        float temperature = (float) req.optDouble("temperature", 0.2d);
        try {
            DeltaConsumer consumer = stream ? delta -> {
                try {
                    writeLine(writer, new JSONObject()
                        .put("id", id)
                        .put("event", "delta")
                        .put("text", delta));
                } catch (JSONException ignored) {
                }
            } : null;
            AlphaLocalChatTemplate.ParsedCompletion completion = generate(modelId, messages, tools, maxTokens, temperature, consumer);
            JSONObject reply = completion.toStructuredJson()
                .put("id", id)
                .put("ok", true)
                .put("modelId", modelId);
            if (stream) {
                reply.put("event", "done");
            }
            writeLine(writer, reply);
        } catch (IOException failed) {
            JSONObject err = errorJson("GENERATE_FAILED", failed.getMessage() == null ? "Local generation failed" : failed.getMessage())
                .put("id", id);
            if (stream) {
                err.put("event", "error");
            }
            writeLine(writer, err);
        }
    }

    private void closeContextLocked() {
        if (textContextHandle != 0L) {
            engine.closeContext(textContextHandle);
            textContextHandle = 0L;
        }
        loadedBundleDir = null;
        loadedModelId = null;
    }

    private String resolveDrafterPath(AlphaLocalLlmCatalog.ModelEntry entry) {
        if (entry == null) return "";
        for (AlphaLocalLlmCatalog.Artifact artifact : entry.optionalArtifacts()) {
            if ("mtp".equals(artifact.role())) {
                File drafter = new File(modelManager.modelBundleDir(entry.id()), artifact.relativePath());
                if (drafter.isFile()) return drafter.getAbsolutePath();
            }
        }
        return "";
    }

    private static int firstStopIndex(CharSequence text, List<String> stops) {
        String s = text.toString();
        int earliest = -1;
        for (String stop : stops) {
            int found = s.indexOf(stop);
            if (found >= 0 && (earliest < 0 || found < earliest)) {
                earliest = found;
            }
        }
        return earliest;
    }

    private static int maxLength(List<String> items) {
        int max = 0;
        for (String item : items) {
            if (item.length() > max) max = item.length();
        }
        return max;
    }

    private static void writeLine(BufferedWriter writer, JSONObject payload) throws IOException {
        writer.write(payload.toString());
        writer.write('\n');
        writer.flush();
    }

    private static JSONObject errorJson(String code, String message) throws JSONException {
        return new JSONObject().put("ok", false).put("code", code).put("error", message == null ? code : message);
    }

    private static void restrictSocketPermissions(Path path) {
        try {
            Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
        } catch (IOException | UnsupportedOperationException ignored) {
        }
        try {
            Os.chmod(path.toString(), 0600);
        } catch (ErrnoException | RuntimeException | LinkageError ignored) {
        }
    }

    private static SocketServerFactory androidSocketServerFactory() {
        return path -> {
            LocalSocket bound = new LocalSocket(LocalSocket.SOCKET_STREAM);
            boolean transferred = false;
            try {
                bound.bind(new LocalSocketAddress(path.toString(), LocalSocketAddress.Namespace.FILESYSTEM));
                restrictSocketPermissions(path);
                LocalServerSocket server = new LocalServerSocket(bound.getFileDescriptor());
                transferred = true;
                int ownUid = Process.myUid();
                return new SocketServer() {
                    @Override public ClientConnection accept() throws IOException {
                        LocalSocket client = server.accept();
                        try {
                            if (client.getPeerCredentials().getUid() != ownUid) {
                                client.close();
                                return null;
                            }
                        } catch (IOException | RuntimeException ignored) {
                        }
                        return new ClientConnection() {
                            @Override public InputStream inputStream() throws IOException {
                                return client.getInputStream();
                            }
                            @Override public OutputStream outputStream() throws IOException {
                                return client.getOutputStream();
                            }
                            @Override public void close() throws IOException {
                                client.close();
                            }
                        };
                    }

                    @Override public void close() throws IOException {
                        try {
                            Os.shutdown(server.getFileDescriptor(), OsConstants.SHUT_RDWR);
                        } catch (ErrnoException | RuntimeException ignored) {
                        }
                        try {
                            server.close();
                        } finally {
                            try {
                                bound.close();
                            } catch (IOException ignored) {
                            }
                        }
                    }
                };
            } finally {
                if (!transferred) {
                    try {
                        bound.close();
                    } catch (IOException ignored) {
                    }
                }
            }
        };
    }

    /** Reflection adapter invoking {@code ai.eliza.voice.VoiceNative} without modifying {@code .eliza/}. */
    static final class VoiceNativeReflectionEngine implements NativeLlmEngine {
        private static final String VOICE_NATIVE_CLASS = "ai.eliza.voice.VoiceNative";
        private volatile boolean resolved;
        private Method llmStreamSupported;
        private Method contextCreateUtf8;
        private Method contextDestroy;
        private Method tokenizeWithOptionsUtf8;
        private Method llmStreamOpen;
        private Method llmStreamPrefill;
        private Method llmStreamNext;
        private Method llmStreamReset;
        private Method llmStreamClose;

        private synchronized boolean ensureResolved() {
            if (resolved) return llmStreamSupported != null;
            resolved = true;
            try {
                Class<?> cls = Class.forName(VOICE_NATIVE_CLASS);
                llmStreamSupported = accessible(cls.getDeclaredMethod("nativeLlmStreamSupported"));
                contextCreateUtf8 = accessible(cls.getDeclaredMethod("nativeContextCreateUtf8", byte[].class));
                contextDestroy = accessible(cls.getDeclaredMethod("nativeContextDestroy", long.class));
                tokenizeWithOptionsUtf8 = accessible(cls.getDeclaredMethod("nativeTokenizeWithOptionsUtf8", long.class, byte[].class, boolean.class));
                llmStreamOpen = accessible(cls.getDeclaredMethod("nativeLlmStreamOpen", long.class, int.class, float.class, float.class, int.class, int.class, String.class));
                llmStreamPrefill = accessible(cls.getDeclaredMethod("nativeLlmStreamPrefill", long.class, int[].class));
                llmStreamNext = accessible(cls.getDeclaredMethod("nativeLlmStreamNext", long.class, int.class));
                llmStreamReset = accessible(cls.getDeclaredMethod("nativeLlmStreamReset", long.class));
                llmStreamClose = accessible(cls.getDeclaredMethod("nativeLlmStreamClose", long.class));
                return true;
            } catch (ReflectiveOperationException | LinkageError unavailable) {
                llmStreamSupported = null;
                return false;
            }
        }

        private static Method accessible(Method method) {
            method.setAccessible(true);
            return method;
        }

        @Override public boolean isAvailable() {
            if (!ensureResolved()) return false;
            try {
                Object result = llmStreamSupported.invoke(null);
                return result instanceof Integer code && code == 1;
            } catch (ReflectiveOperationException | LinkageError unavailable) {
                return false;
            }
        }

        @Override public long openContext(String bundleDir) {
            if (!ensureResolved()) return 0L;
            try {
                Object result = contextCreateUtf8.invoke(null, (Object) bundleDir.getBytes(StandardCharsets.UTF_8));
                return result instanceof Long handle ? handle : 0L;
            } catch (ReflectiveOperationException | LinkageError failed) {
                return 0L;
            }
        }

        @Override public void closeContext(long contextHandle) {
            if (!ensureResolved() || contextHandle == 0L) return;
            try {
                contextDestroy.invoke(null, contextHandle);
            } catch (ReflectiveOperationException | LinkageError ignored) {
            }
        }

        @Override public int[] tokenize(long contextHandle, byte[] promptUtf8) {
            if (!ensureResolved()) return new int[0];
            try {
                Object result = tokenizeWithOptionsUtf8.invoke(null, contextHandle, promptUtf8, true);
                return result instanceof int[] tokens ? tokens : new int[0];
            } catch (ReflectiveOperationException | LinkageError failed) {
                return new int[0];
            }
        }

        @Override public long openStream(long contextHandle, int maxTokens, float temperature, float topP, int topK, int nGpuLayers, String drafterPath) {
            if (!ensureResolved()) return 0L;
            try {
                Object result = llmStreamOpen.invoke(null, contextHandle, maxTokens, temperature, topP, topK, nGpuLayers, drafterPath == null ? "" : drafterPath);
                return result instanceof Long handle ? handle : 0L;
            } catch (ReflectiveOperationException | LinkageError failed) {
                return 0L;
            }
        }

        @Override public void prefill(long streamHandle, int[] tokens) {
            if (!ensureResolved()) return;
            try {
                llmStreamPrefill.invoke(null, streamHandle, tokens);
            } catch (ReflectiveOperationException | LinkageError failed) {
                throw new IllegalStateException("nativeLlmStreamPrefill failed", failed);
            }
        }

        @Override public String nextStep(long streamHandle, int maxStepTokens) {
            if (!ensureResolved()) return null;
            try {
                Object result = llmStreamNext.invoke(null, streamHandle, maxStepTokens);
                return result instanceof String json ? json : null;
            } catch (ReflectiveOperationException | LinkageError failed) {
                throw new IllegalStateException("nativeLlmStreamNext failed", failed);
            }
        }

        @Override public void resetStream(long streamHandle) {
            if (!ensureResolved() || streamHandle == 0L) return;
            try {
                llmStreamReset.invoke(null, streamHandle);
            } catch (ReflectiveOperationException | LinkageError ignored) {
            }
        }

        @Override public void closeStream(long streamHandle) {
            if (!ensureResolved() || streamHandle == 0L) return;
            try {
                llmStreamClose.invoke(null, streamHandle);
            } catch (ReflectiveOperationException | LinkageError ignored) {
            }
        }
    }
}
