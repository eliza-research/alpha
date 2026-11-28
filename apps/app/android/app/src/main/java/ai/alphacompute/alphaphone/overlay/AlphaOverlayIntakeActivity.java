package ai.alphacompute.alphaphone.overlay;

import ai.alphacompute.alphaphone.ipc.AlphaSuitePolicyLoader;
import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.ipc.AlphaSuitePolicy;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Translucent intake activity receiving signed {@code STAGE_ATTACHMENT} handoffs from thin Alpha apps into the overlay composer. */
public final class AlphaOverlayIntakeActivity extends Activity {
    private static final Set<String> ALLOWED_KINDS = Set.of("file", "transcript", "speech");
    private static final long STAGED_TTL_MS = 60_000L;

    /** Validated cross-app attachment handoff waiting for the Ask Alpha overlay to consume. */
    public record StagedAttachment(
        String sourcePackage,
        String kind,
        String uri,
        String metaJson,
        long stagedAt
    ) {
        JSONObject toJson() {
            JSONObject out = new JSONObject();
            try {
                out.put("sourcePackage", sourcePackage)
                    .put("kind", kind)
                    .put("stagedAt", stagedAt);
                if (uri != null) out.put("uri", uri);
                Object parsedMeta = metaJson == null || metaJson.isBlank()
                    ? new JSONObject()
                    : new JSONTokener(metaJson).nextValue();
                out.put("meta", parsedMeta);
            } catch (JSONException fallback) {
                try {
                    out.put("meta", new JSONObject());
                } catch (JSONException impossible) {
                    throw new IllegalStateException(impossible);
                }
            }
            return out;
        }
    }

    private static final AtomicReference<StagedAttachment> pendingAttachment = new AtomicReference<>();

    /** Atomically consumes the latest unexpired staged attachment, or returns null when absent or stale. */
    public static StagedAttachment takePendingAttachment() {
        StagedAttachment staged = pendingAttachment.getAndSet(null);
        if (staged == null) return null;
        if (System.currentTimeMillis() - staged.stagedAt() > STAGED_TTL_MS) return null;
        return staged;
    }

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            handleIntake(getIntent());
        } finally {
            finish();
        }
    }

    private void handleIntake(Intent intent) {
        if (intent == null || !AlphaIpcContract.ACTION_STAGE_ATTACHMENT.equals(intent.getAction())) return;
        String callerPackage = resolveVerifiedSuiteCaller();
        if (callerPackage == null) return;
        String kind = intent.getStringExtra(AlphaIpcContract.EXTRA_ATTACHMENT_KIND);
        if (kind == null || !ALLOWED_KINDS.contains(kind)) return;
        String metaJson = intent.getStringExtra(AlphaIpcContract.EXTRA_ATTACHMENT_META);
        if (metaJson != null && metaJson.getBytes(StandardCharsets.UTF_8).length > AlphaIpcContract.MAX_INTENT_PAYLOAD_BYTES) {
            return;
        }
        Uri clipUri = extractClipUri(intent);
        if ("file".equals(kind) && clipUri == null) return;
        StagedAttachment staged = new StagedAttachment(
            callerPackage,
            kind,
            clipUri == null ? null : clipUri.toString(),
            metaJson == null ? "{}" : metaJson,
            System.currentTimeMillis()
        );
        pendingAttachment.set(staged);
        Bundle args = new Bundle();
        args.putString(AlphaVoiceInteractionService.EXTRA_ENTRY_SOURCE, "attachment-intake:" + kind);
        AlphaVoiceInteractionService.showOverlay(this, args);
    }

    private String resolveVerifiedSuiteCaller() {
        String pkg = null;
        if (Build.VERSION.SDK_INT >= 34) {
            pkg = getLaunchedFromPackage();
            if (pkg == null) return null;
        } else {
            Uri referrer = getReferrer();
            if (referrer != null && "android-app".equals(referrer.getScheme())) {
                pkg = referrer.getHost();
            }
        }
        AlphaSuitePolicy policy = AlphaSuitePolicyLoader.load(this);
        if (pkg == null || !policy.isKnownPackage(pkg)) return null;
        return AlphaIpcContract.hasCoreSignature(this, pkg) ? pkg : null;
    }

    private static Uri extractClipUri(Intent intent) {
        ClipData clip = intent.getClipData();
        if (clip != null && clip.getItemCount() > 0) {
            ClipData.Item first = clip.getItemAt(0);
            if (first != null && first.getUri() != null) {
                return first.getUri();
            }
        }
        return intent.getData();
    }
}
