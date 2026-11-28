package ai.alphacompute.localllm;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Pinned catalog of Apache-2.0 and MIT on-device GGUF models with hardware-fit checks. */
public final class AlphaLocalLlmCatalog {
    /** Identifier of the default recommended on-device chat model. */
    public static final String DEFAULT_MODEL_ID = "gemma-4-e2b-it-q4";
    /** Identifier of the default on-device embedding model. */
    public static final String DEFAULT_EMBEDDING_ID = "bge-small-en-v1.5";
    /** Minimum usable RAM (MiB) separating constrained 6 GB phones from 8 GB standard devices. */
    public static final long STANDARD_RAM_THRESHOLD_MB = 7168L;
    /** Minimum usable RAM (MiB) for high-memory 12 GB+ devices. */
    public static final long HIGH_RAM_THRESHOLD_MB = 11264L;
    /** Extra disk headroom (MiB) required beyond raw GGUF bytes for safe staging and runtime files. */
    public static final long DISK_HEADROOM_MB = 512L;

    /** Optional companion GGUF artifact (such as an MTP speculative drafter or vision projector). */
    public record Artifact(
        String role,
        String relativePath,
        String fileName,
        String url,
        long sizeBytes,
        String sha256
    ) {
        /** Serializes this companion artifact to JSON. */
        public JSONObject toJson() throws JSONException {
            return new JSONObject()
                .put("role", role)
                .put("relativePath", relativePath)
                .put("fileName", fileName)
                .put("url", url)
                .put("sizeBytes", sizeBytes)
                .put("sha256", sha256);
        }
    }

    /** Pinned curated GGUF catalog entry. */
    public record ModelEntry(
        String id,
        String displayName,
        String family,
        String role,
        String license,
        String repo,
        String fileName,
        String url,
        long sizeBytes,
        String sha256,
        int minRamMb,
        int contextLength,
        boolean recommended,
        List<Artifact> optionalArtifacts,
        String description
    ) {
        /** Relative storage path inside the model's bundle directory for libelizainference compatibility. */
        public String relativePath() {
            return "text/" + fileName;
        }

        /** Minimum free storage (MiB) required to stage and verify this model cleanly. */
        public long requiredDiskMb() {
            long modelMb = (sizeBytes + (1024L * 1024L) - 1L) / (1024L * 1024L);
            return Math.max(256L, modelMb + DISK_HEADROOM_MB);
        }
    }

    /** Device hardware fit verdict for one catalog model. */
    public record DeviceFit(
        boolean fits,
        boolean fitsRam,
        boolean fitsDisk,
        String ramTier,
        String reason,
        int recommendedContextTokens
    ) {
        /** Serializes this device fit verdict to JSON. */
        public JSONObject toJson() throws JSONException {
            return new JSONObject()
                .put("fits", fits)
                .put("fitsRam", fitsRam)
                .put("fitsDisk", fitsDisk)
                .put("ramTier", ramTier)
                .put("reason", reason)
                .put("recommendedContextTokens", recommendedContextTokens);
        }
    }

    private static final List<ModelEntry> ENTRIES = List.of(
        new ModelEntry(
            DEFAULT_MODEL_ID,
            "Gemma 4 E2B IT (Q4_0)",
            "gemma4",
            "chat",
            "Apache-2.0",
            "ggml-org/gemma-4-E2B-it-GGUF",
            "gemma-4-E2B-it-Q4_0.gguf",
            "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_0.gguf",
            2841481184L,
            "8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52",
            6144,
            131072,
            true,
            List.of(
                new Artifact(
                    "mtp",
                    "mtp/mtp-gemma-4-E2B-it-Q4_0.gguf",
                    "mtp-gemma-4-E2B-it-Q4_0.gguf",
                    "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/mtp-gemma-4-E2B-it-Q4_0.gguf",
                    59235872L,
                    "718d3a44057924d5840c65a0aeedf7929366adeeda92a2006955ccabaf645ef4"
                ),
                new Artifact(
                    "vision",
                    "vision/mmproj-gemma-4-E2B-it-Q8_0.gguf",
                    "mmproj-gemma-4-E2B-it-Q8_0.gguf",
                    "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/mmproj-gemma-4-E2B-it-Q8_0.gguf",
                    557368096L,
                    "042cc2561806cd3b5cb5efb25cab76911e3100c43cc09d854904f921924b1429"
                )
            ),
            "Recommended default for 8 GB phones: 2.3B effective parameters with compact KV cache, native tool calling, optional MTP drafter, and vision."
        ),
        new ModelEntry(
            "qwen3.5-4b-q4",
            "Qwen 3.5 4B (Q4_K_M)",
            "qwen35",
            "chat",
            "Apache-2.0",
            "unsloth/Qwen3.5-4B-GGUF",
            "Qwen3.5-4B-Q4_K_M.gguf",
            "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
            2740937888L,
            "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
            6144,
            262144,
            false,
            List.of(),
            "High-precision structured JSON and multi-step tool-calling alternative in a compact 2.74 GB footprint."
        ),
        new ModelEntry(
            "gemma-4-e4b-it-q2xl",
            "Gemma 4 E4B IT (UD-Q2_K_XL)",
            "gemma4",
            "chat",
            "Apache-2.0",
            "unsloth/gemma-4-E4B-it-GGUF",
            "gemma-4-E4B-it-UD-Q2_K_XL.gguf",
            "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-UD-Q2_K_XL.gguf",
            3757419648L,
            "cc92186419be169e992a1df01978828a0d4cf3a5962379ff403c8d55f6faff78",
            7168,
            131072,
            false,
            List.of(),
            "High-capacity opt-in Gemma 4 E4B tier (4.5B effective parameters) for devices with at least 8 GB RAM."
        ),
        new ModelEntry(
            DEFAULT_EMBEDDING_ID,
            "BGE Small EN v1.5 (F16)",
            "embedding",
            "embedding",
            "MIT",
            "CompendiumLabs/bge-small-en-v1.5-gguf",
            "bge-small-en-v1.5-f16.gguf",
            "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/d32f8c040ea3b516330eeb75b72bcc2d3a780ab7/bge-small-en-v1.5-f16.gguf",
            67308128L,
            "f0b2fef971e8366438bfd2d9aefea1b0115919389448806d290237f638bae999",
            2048,
            512,
            true,
            List.of(),
            "Compact 384-dimensional CLS embedding model matching Alpha Cloud vector space for offline memory search."
        )
    );

    private static final Map<String, ModelEntry> BY_ID;

    static {
        Map<String, ModelEntry> index = new LinkedHashMap<>();
        for (ModelEntry entry : ENTRIES) {
            index.put(entry.id(), entry);
        }
        BY_ID = Collections.unmodifiableMap(index);
    }

    private AlphaLocalLlmCatalog() {}

    /** Returns every curated model in display order. */
    public static List<ModelEntry> all() {
        return ENTRIES;
    }

    /** Looks up a curated model by identifier, or null when unknown. */
    public static ModelEntry byId(String id) {
        if (id == null) return null;
        return BY_ID.get(id.trim());
    }

    /** Returns the default recommended chat model entry. */
    public static ModelEntry defaultChatModel() {
        return BY_ID.get(DEFAULT_MODEL_ID);
    }

    /** Classifies total device RAM (MiB) into constrained, standard, or high tiers. */
    public static String ramTier(long totalRamMb) {
        if (totalRamMb < STANDARD_RAM_THRESHOLD_MB) return "constrained";
        if (totalRamMb < HIGH_RAM_THRESHOLD_MB) return "standard";
        return "high";
    }

    /** Computes recommended resident LLM context tokens for the device RAM tier. */
    public static int recommendedContextTokens(ModelEntry entry, long totalRamMb) {
        if ("embedding".equals(entry.role())) return entry.contextLength();
        int byTier = totalRamMb < STANDARD_RAM_THRESHOLD_MB ? 4096
            : totalRamMb < HIGH_RAM_THRESHOLD_MB ? 8192 : 16384;
        return Math.min(entry.contextLength(), byTier);
    }

    /** Evaluates whether {@code entry} fits safely on a device with the given RAM and free disk (MiB). */
    public static DeviceFit deviceFit(ModelEntry entry, long totalRamMb, long freeDiskMb) {
        boolean fitsRam = totalRamMb >= entry.minRamMb();
        long requiredDiskMb = entry.requiredDiskMb();
        boolean fitsDisk = freeDiskMb >= requiredDiskMb;
        String tier = ramTier(totalRamMb);
        int ctx = recommendedContextTokens(entry, totalRamMb);
        String reason;
        if (!fitsRam && !fitsDisk) {
            reason = "Requires at least " + entry.minRamMb() + " MB RAM and " + requiredDiskMb + " MB free storage";
        } else if (!fitsRam) {
            reason = "Requires at least " + entry.minRamMb() + " MB RAM (device reports " + totalRamMb + " MB)";
        } else if (!fitsDisk) {
            reason = "Requires at least " + requiredDiskMb + " MB free storage (device has " + freeDiskMb + " MB)";
        } else {
            reason = "Ready for " + tier + " memory profile (" + ctx + " token context)";
        }
        return new DeviceFit(fitsRam && fitsDisk, fitsRam, fitsDisk, tier, reason, ctx);
    }

    /** Serializes one catalog entry alongside its hardware fit verdict. */
    public static JSONObject toJson(ModelEntry entry, DeviceFit fit) throws JSONException {
        JSONArray optional = new JSONArray();
        for (Artifact artifact : entry.optionalArtifacts()) {
            optional.put(artifact.toJson());
        }
        return new JSONObject()
            .put("id", entry.id())
            .put("displayName", entry.displayName())
            .put("family", entry.family())
            .put("role", entry.role())
            .put("license", entry.license())
            .put("repo", entry.repo())
            .put("fileName", entry.fileName())
            .put("url", entry.url())
            .put("sizeBytes", entry.sizeBytes())
            .put("sha256", entry.sha256())
            .put("minRamMb", entry.minRamMb())
            .put("contextLength", entry.contextLength())
            .put("recommended", entry.recommended())
            .put("description", entry.description())
            .put("optionalArtifacts", optional)
            .put("fit", fit.toJson());
    }

    /** Serializes the full catalog with per-model hardware fit for the given device metrics. */
    public static JSONObject catalogJson(long totalRamMb, long freeDiskMb) throws JSONException {
        JSONArray models = new JSONArray();
        for (ModelEntry entry : ENTRIES) {
            models.put(toJson(entry, deviceFit(entry, totalRamMb, freeDiskMb)));
        }
        return new JSONObject()
            .put("defaultModelId", DEFAULT_MODEL_ID)
            .put("defaultEmbeddingId", DEFAULT_EMBEDDING_ID)
            .put("deviceRamMb", totalRamMb)
            .put("freeDiskMb", freeDiskMb)
            .put("ramTier", ramTier(totalRamMb))
            .put("models", models);
    }
}
