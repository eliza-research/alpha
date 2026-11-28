package ai.alphacompute.localllm;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.lang.reflect.Method;
import java.net.ProtocolFamily;
import java.net.SocketAddress;
import java.nio.channels.Channels;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Pure-JVM unit tests covering catalog hardware fit, chat templates, resumable SHA-256 downloads, and UDS inference. */
public final class AlphaLocalLlmTest {
    @Test public void catalogPinsApacheAndMitModelsWithAccurateDeviceFit() throws Exception {
        assertEquals(4, AlphaLocalLlmCatalog.all().size());
        AlphaLocalLlmCatalog.ModelEntry gemma2b = AlphaLocalLlmCatalog.byId("gemma-4-e2b-it-q4");
        AlphaLocalLlmCatalog.ModelEntry qwen4b = AlphaLocalLlmCatalog.byId("qwen3.5-4b-q4");
        AlphaLocalLlmCatalog.ModelEntry gemma4b = AlphaLocalLlmCatalog.byId("gemma-4-e4b-it-q2xl");
        AlphaLocalLlmCatalog.ModelEntry bge = AlphaLocalLlmCatalog.byId("bge-small-en-v1.5");
        assertNotNull(gemma2b);
        assertNotNull(qwen4b);
        assertNotNull(gemma4b);
        assertNotNull(bge);
        assertTrue(gemma2b.recommended());
        assertEquals("Apache-2.0", gemma2b.license());
        assertEquals("Apache-2.0", qwen4b.license());
        assertEquals("Apache-2.0", gemma4b.license());
        assertEquals(2, gemma2b.optionalArtifacts().size());

        AlphaLocalLlmCatalog.DeviceFit pixel10aFit = AlphaLocalLlmCatalog.deviceFit(gemma2b, 7326L, 100_000L);
        assertTrue(pixel10aFit.fits());
        assertEquals("standard", pixel10aFit.ramTier());
        assertEquals(8192, pixel10aFit.recommendedContextTokens());

        AlphaLocalLlmCatalog.DeviceFit constrained4b = AlphaLocalLlmCatalog.deviceFit(gemma4b, 5800L, 100_000L);
        assertFalse(constrained4b.fits());
        assertFalse(constrained4b.fitsRam());
        assertTrue(constrained4b.fitsDisk());

        AlphaLocalLlmCatalog.DeviceFit lowDisk = AlphaLocalLlmCatalog.deviceFit(gemma2b, 8192L, 1024L);
        assertFalse(lowDisk.fits());
        assertTrue(lowDisk.fitsRam());
        assertFalse(lowDisk.fitsDisk());

        JSONObject json = AlphaLocalLlmCatalog.catalogJson(7326L, 100_000L);
        assertEquals(AlphaLocalLlmCatalog.DEFAULT_MODEL_ID, json.getString("defaultModelId"));
        assertEquals(4, json.getJSONArray("models").length());
    }

    @Test public void gemma4AndQwen35TemplatesRoundTripToolCalls() throws Exception {
        JSONObject params = new JSONObject()
            .put("type", "object")
            .put("properties", new JSONObject().put("nodeId", new JSONObject().put("type", "string")));
        List<AlphaLocalChatTemplate.ToolSpec> tools = List.of(
            new AlphaLocalChatTemplate.ToolSpec("DEVICE_CONTROL", "Tap or type inside the active app", params)
        );
        List<AlphaLocalChatTemplate.ChatMessage> messages = List.of(
            AlphaLocalChatTemplate.ChatMessage.of("system", "You are Alpha."),
            AlphaLocalChatTemplate.ChatMessage.of("user", "Click More information in Firefox.")
        );

        String gemmaPrompt = AlphaLocalChatTemplate.formatPrompt("gemma4", messages, tools);
        assertTrue(gemmaPrompt.contains("<start_of_turn>system"));
        assertTrue(gemmaPrompt.contains("declaration:DEVICE_CONTROL"));
        assertTrue(gemmaPrompt.endsWith("<start_of_turn>model\n"));

        String gemmaRaw = "<|thought>Plan the tap<thought|>"
            + "<|tool_call>call:DEVICE_CONTROL{\"op\":{\"type\":\"ui_click\",\"nodeId\":\"w1_n0\"}}<tool_call|><end_of_turn>";
        AlphaLocalChatTemplate.ParsedCompletion gemmaParsed = AlphaLocalChatTemplate.parseOutput("gemma4", gemmaRaw, 42, 18);
        assertEquals("", gemmaParsed.text());
        assertEquals("tool_calls", gemmaParsed.finishReason());
        assertEquals(1, gemmaParsed.toolCalls().size());
        assertEquals("DEVICE_CONTROL", gemmaParsed.toolCalls().get(0).name());
        assertEquals("ui_click", gemmaParsed.toolCalls().get(0).arguments().getJSONObject("op").getString("type"));
        assertEquals(60, gemmaParsed.usage().totalTokens());

        String gemmaDirectRaw = "<|call:VIEWS{view:<|\"|>notes<|\"|>}|>";
        AlphaLocalChatTemplate.ParsedCompletion directParsed = AlphaLocalChatTemplate.parseOutput("gemma4", gemmaDirectRaw, 10, 6);
        assertEquals(1, directParsed.toolCalls().size());
        assertEquals("VIEWS", directParsed.toolCalls().get(0).name());
        assertEquals("notes", directParsed.toolCalls().get(0).arguments().getString("view"));

        String qwenPrompt = AlphaLocalChatTemplate.formatPrompt("qwen35", messages, tools);
        assertTrue(qwenPrompt.contains("<|im_start|>system"));
        assertTrue(qwenPrompt.contains("<tools>"));
        assertTrue(qwenPrompt.endsWith("<|im_start|>assistant\n"));

        String qwenRaw = "<think>Checking tool</think>\n<tool_call>\n{\"name\":\"DEVICE_CONTROL\",\"arguments\":{\"op\":{\"type\":\"ui_scroll\",\"direction\":\"down\"}}}\n</tool_call><|im_end|>";
        AlphaLocalChatTemplate.ParsedCompletion qwenParsed = AlphaLocalChatTemplate.parseOutput("qwen35", qwenRaw, 50, 22);
        assertEquals("", qwenParsed.text());
        assertEquals("tool_calls", qwenParsed.finishReason());
        assertEquals(1, qwenParsed.toolCalls().size());
        assertEquals("down", qwenParsed.toolCalls().get(0).arguments().getJSONObject("op").getString("direction"));

        JSONObject openAi = qwenParsed.toOpenAiJson("qwen3.5-4b-q4");
        assertEquals("tool_calls", openAi.getJSONArray("choices").getJSONObject(0).getString("finish_reason"));
    }

    @Test public void modelManagerSupportsResumableRangeSha256MeteredGuardAndTrimMemory() throws Exception {
        Path tempDir = Files.createTempDirectory("alpha-local-llm-mgr-");
        byte[] payload = "GGUF-LOCAL-GEMMA-4-TEST-WEIGHTS-0123456789ABCDEF".repeat(64).getBytes(StandardCharsets.UTF_8);
        String expectedSha = sha256(payload);
        AtomicBoolean metered = new AtomicBoolean(true);
        AtomicBoolean releaseCalled = new AtomicBoolean(false);
        AtomicInteger rangeRequests = new AtomicInteger(0);

        AlphaLocalModelManager.HttpRangeTransport transport = (url, resumeFrom) -> {
            if (resumeFrom > 0L) rangeRequests.incrementAndGet();
            int start = (int) Math.min(resumeFrom, payload.length);
            byte[] slice = Arrays.copyOfRange(payload, start, payload.length);
            int status = resumeFrom > 0L ? 206 : 200;
            return new AlphaLocalModelManager.HttpRangeTransport.Response() {
                @Override public int statusCode() { return status; }
                @Override public long contentLength() { return slice.length; }
                @Override public InputStream stream() { return new ByteArrayInputStream(slice); }
                @Override public void close() {}
            };
        };

        AlphaLocalModelManager manager = new AlphaLocalModelManager(
            tempDir.toFile(),
            metered::get,
            new AlphaLocalModelManager.DeviceMetricsProvider() {
                @Override public long totalRamMb() { return 7326L; }
                @Override public long freeDiskMb() { return 50_000L; }
            },
            transport
        );
        manager.setMemoryReleaseHook(() -> releaseCalled.set(true));

        AlphaLocalLlmCatalog.ModelEntry entry = AlphaLocalLlmCatalog.defaultChatModel();
        try {
            manager.downloadBlockingForTest(entry, "https://example.invalid/model.gguf", payload.length, expectedSha, false, null);
            fail("Expected metered network refusal");
        } catch (AlphaLocalModelManager.ModelRefusedException expected) {
            assertEquals(AlphaLocalModelManager.ERROR_METERED_NETWORK, expected.code);
        }

        metered.set(false);
        File partial = manager.partialFile(entry);
        assertTrue(partial.getParentFile().mkdirs());
        Files.write(partial.toPath(), Arrays.copyOfRange(payload, 0, 128));

        List<AlphaLocalModelManager.DownloadProgress> directEvents = new ArrayList<>();
        List<AlphaLocalModelManager.DownloadProgress> subscribedEvents = new ArrayList<>();
        AutoCloseable subscription = manager.subscribeProgress(subscribedEvents::add);
        AlphaLocalModelManager.DownloadProgress done = manager.downloadBlockingForTest(
            entry,
            "https://example.invalid/model.gguf",
            payload.length,
            expectedSha,
            false,
            directEvents::add
        );
        subscription.close();
        assertEquals("installed", done.phase());
        assertEquals(1, rangeRequests.get());
        assertTrue(manager.modelFile(entry).isFile());
        assertFalse(partial.exists());
        assertFalse(directEvents.isEmpty());
        assertEquals(directEvents.size(), subscribedEvents.size());
        assertTrue(directEvents.stream().anyMatch(p -> "downloading".equals(p.phase())));
        assertTrue(directEvents.stream().anyMatch(p -> "verifying".equals(p.phase())));
        assertTrue(directEvents.stream().anyMatch(p -> "installed".equals(p.phase()) && p.percent() == 100));
        JSONObject lastProgressJson = subscribedEvents.get(subscribedEvents.size() - 1).toJson();
        assertEquals(entry.id(), lastProgressJson.getString("modelId"));
        assertEquals(payload.length, lastProgressJson.getLong("downloadedBytes"));
        assertEquals(payload.length, lastProgressJson.getLong("totalBytes"));
        assertEquals(100, lastProgressJson.getInt("percent"));
        assertEquals("installed", lastProgressJson.getString("phase"));

        int eventsBeforeTampered = subscribedEvents.size();
        AlphaLocalModelManager.DownloadProgress tampered = manager.downloadBlockingForTest(
            AlphaLocalLlmCatalog.byId("qwen3.5-4b-q4"),
            "https://example.invalid/tampered.gguf",
            payload.length,
            "0".repeat(64),
            false,
            null
        );
        assertEquals("failed", tampered.phase());
        assertEquals("DIGEST_MISMATCH", tampered.error());
        assertEquals(eventsBeforeTampered, subscribedEvents.size());
        assertFalse(manager.modelFile(AlphaLocalLlmCatalog.byId("qwen3.5-4b-q4")).exists());

        assertTrue(manager.onTrimMemory(40));
        assertTrue(releaseCalled.get());
        manager.setMode("local", entry.id());
        assertEquals("local", manager.mode());
        manager.delete(entry.id());
        assertFalse(manager.modelFile(entry).exists());
    }

    @Test public void inferenceHostStreamsOverPrivateUnixDomainSocketAndEvictsOnTrim() throws Exception {
        Path tempDir = Files.createTempDirectory("alpha-local-llm-uds-");
        Path socketPath = tempDir.resolve("ipc/local-llm.sock");
        AlphaLocalModelManager manager = new AlphaLocalModelManager(
            tempDir.resolve("models").toFile(),
            () -> false,
            new AlphaLocalModelManager.DeviceMetricsProvider() {
                @Override public long totalRamMb() { return 8192L; }
                @Override public long freeDiskMb() { return 50_000L; }
            },
            (url, resumeFrom) -> { throw new IOException("No network in offline UDS test"); }
        );

        AtomicInteger closedContexts = new AtomicInteger(0);
        AlphaLocalInferenceHost.NativeLlmEngine fakeEngine = new AlphaLocalInferenceHost.NativeLlmEngine() {
            private int step;
            private final List<String> pieces = List.of(
                "Opening ",
                "Firefox ",
                "<|tool_call>call:DEVICE_CONTROL{\"op\":{\"type\":\"ui_click\",\"nodeId\":\"w1_n0\"}}<tool_call|>",
                "<end_of_turn>"
            );

            @Override public boolean isAvailable() { return true; }
            @Override public long openContext(String bundleDir) { return 101L; }
            @Override public void closeContext(long contextHandle) { closedContexts.incrementAndGet(); }
            @Override public int[] tokenize(long contextHandle, byte[] promptUtf8) { return new int[] { 1, 2, 3, 4 }; }
            @Override public long openStream(long contextHandle, int maxTokens, float temperature, float topP, int topK, int nGpuLayers, String drafterPath) {
                step = 0;
                return 202L;
            }
            @Override public void prefill(long streamHandle, int[] tokens) {}
            @Override public String nextStep(long streamHandle, int maxStepTokens) {
                if (step >= pieces.size()) return "{\"text\":\"\",\"done\":true,\"nout\":0}";
                String text = pieces.get(step++);
                boolean done = step >= pieces.size();
                try {
                    return new JSONObject().put("text", text).put("done", done).put("nout", 2).toString();
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            }
            @Override public void resetStream(long streamHandle) {}
            @Override public void closeStream(long streamHandle) {}
        };

        AlphaLocalInferenceHost host = new AlphaLocalInferenceHost(socketPath, manager, fakeEngine, hostUnixSocketServerFactory());
        host.start();
        try {
            assertEquals("rw-------", Files.getPosixFilePermissions(socketPath).toString().length() > 0
                ? java.nio.file.attribute.PosixFilePermissions.toString(Files.getPosixFilePermissions(socketPath))
                : "");
            try (SocketChannel client = openHostUnixClient(socketPath)) {
                BufferedWriter out = new BufferedWriter(new OutputStreamWriter(Channels.newOutputStream(client), StandardCharsets.UTF_8));
                BufferedReader in = new BufferedReader(new InputStreamReader(Channels.newInputStream(client), StandardCharsets.UTF_8));

                JSONObject request = new JSONObject()
                    .put("id", "req-1")
                    .put("op", "generate_stream")
                    .put("modelId", AlphaLocalLlmCatalog.DEFAULT_MODEL_ID)
                    .put("messages", new JSONArray().put(new JSONObject().put("role", "user").put("content", "Click Firefox")));
                out.write(request.toString());
                out.write('\n');
                out.flush();

                List<String> deltas = new ArrayList<>();
                JSONObject done = null;
                String line;
                while ((line = in.readLine()) != null) {
                    JSONObject frame = new JSONObject(line);
                    if ("delta".equals(frame.optString("event"))) {
                        deltas.add(frame.getString("text"));
                    } else if ("done".equals(frame.optString("event"))) {
                        done = frame;
                        break;
                    }
                }
                assertNotNull(done);
                assertTrue(done.getBoolean("ok"));
                assertFalse(deltas.isEmpty());
                assertEquals("tool_calls", done.getString("finishReason"));
                assertEquals(1, done.getJSONArray("toolCalls").length());
                assertEquals("DEVICE_CONTROL", done.getJSONArray("toolCalls").getJSONObject(0).getString("name"));
            }

            assertTrue(host.onTrimMemory(80));
            assertEquals(1, closedContexts.get());
        } finally {
            host.stop();
        }
    }

    private static AlphaLocalInferenceHost.SocketServerFactory hostUnixSocketServerFactory() {
        return path -> {
            try {
                ProtocolFamily unix = unixProtocolFamily();
                SocketAddress address = unixDomainSocketAddress(path);
                Method openServer = ServerSocketChannel.class.getMethod("open", ProtocolFamily.class);
                ServerSocketChannel server = (ServerSocketChannel) openServer.invoke(null, unix);
                server.bind(address);
                return new AlphaLocalInferenceHost.SocketServer() {
                    @Override public AlphaLocalInferenceHost.ClientConnection accept() throws IOException {
                        SocketChannel client = server.accept();
                        return new AlphaLocalInferenceHost.ClientConnection() {
                            @Override public InputStream inputStream() {
                                return Channels.newInputStream(client);
                            }
                            @Override public OutputStream outputStream() {
                                return Channels.newOutputStream(client);
                            }
                            @Override public void close() throws IOException {
                                client.close();
                            }
                        };
                    }

                    @Override public void close() throws IOException {
                        server.close();
                    }
                };
            } catch (ReflectiveOperationException e) {
                throw new IOException("Host JDK Unix domain sockets unavailable", e);
            }
        };
    }

    private static SocketChannel openHostUnixClient(Path path) throws IOException {
        try {
            ProtocolFamily unix = unixProtocolFamily();
            SocketAddress address = unixDomainSocketAddress(path);
            Method openClient = SocketChannel.class.getMethod("open", ProtocolFamily.class);
            SocketChannel client = (SocketChannel) openClient.invoke(null, unix);
            client.connect(address);
            return client;
        } catch (ReflectiveOperationException e) {
            throw new IOException("Host JDK Unix domain sockets unavailable", e);
        }
    }

    private static ProtocolFamily unixProtocolFamily() throws ReflectiveOperationException {
        Class<?> familyEnum = Class.forName("java.net.StandardProtocolFamily");
        return (ProtocolFamily) familyEnum.getField("UNIX").get(null);
    }

    private static SocketAddress unixDomainSocketAddress(Path path) throws ReflectiveOperationException {
        Class<?> addrClass = Class.forName("java.net.UnixDomainSocketAddress");
        Method ofMethod = addrClass.getMethod("of", Path.class);
        return (SocketAddress) ofMethod.invoke(null, path);
    }

    private static String sha256(byte[] data) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] sum = md.digest(data);
        StringBuilder hex = new StringBuilder(sum.length * 2);
        for (byte b : sum) {
            hex.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        }
        return hex.toString();
    }
}
