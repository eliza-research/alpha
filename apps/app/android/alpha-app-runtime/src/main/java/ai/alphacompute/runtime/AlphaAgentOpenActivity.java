package ai.alphacompute.runtime;

import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.ipc.IAlphaActionCallback;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.RemoteException;
import android.util.Log;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Signature-permission-guarded entry trampoline for {@link AlphaIpcContract#ACTION_AGENT_OPEN}.
 * Verifies {@code AlphaCore} caller identity and hands verified requests in-process to {@link AlphaBaseActivity}.
 */
public final class AlphaAgentOpenActivity extends Activity {
    private static final String TAG = "AlphaThinApp";
    static final String EXTRA_INTERNAL_HANDOFF = "alpha.internal.handoff";

    private static final Map<String, VerifiedOpen> PENDING = new ConcurrentHashMap<>();

    /** Process-private verified handoff record consumed once by {@link AlphaBaseActivity}. */
    record VerifiedOpen(
        String uri,
        String claimId,
        int ticket,
        String nonce,
        String payload,
        IAlphaActionCallback callback
    ) {}

    static VerifiedOpen consumeHandoff(String token) {
        return token == null || token.isEmpty() ? null : PENDING.remove(token);
    }

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            handleIncoming(getIntent());
        } finally {
            finish();
        }
    }

    private void handleIncoming(Intent incoming) {
        if (incoming == null || !AlphaIpcContract.ACTION_AGENT_OPEN.equals(incoming.getAction())) return;
        String claimId = incoming.getStringExtra(AlphaIpcContract.EXTRA_CLAIM_ID);
        if (!isVerifiedCoreCaller()) {
            Log.w(TAG, "event=agent_open_rejected component=trampoline reason=unverified_caller");
            rejectCallback(incoming.getExtras(), claimId, AlphaIpcContract.FAIL_UNAUTHORIZED);
            return;
        }
        String payload = incoming.getStringExtra(AlphaIpcContract.EXTRA_PAYLOAD);
        if (payload != null && payload.getBytes(StandardCharsets.UTF_8).length > AlphaIpcContract.MAX_INTENT_PAYLOAD_BYTES) {
            Log.w(TAG, "event=agent_open_rejected component=trampoline reason=payload_too_large");
            rejectCallback(incoming.getExtras(), claimId, AlphaIpcContract.FAIL_TOO_LARGE);
            return;
        }
        IAlphaActionCallback callback = extractCallback(incoming.getExtras());
        Uri data = incoming.getData();
        String token = UUID.randomUUID().toString();
        PENDING.put(token, new VerifiedOpen(
            data == null ? null : data.toString(),
            claimId,
            incoming.getIntExtra(AlphaIpcContract.EXTRA_TICKET, 0),
            incoming.getStringExtra(AlphaIpcContract.EXTRA_NONCE),
            payload,
            callback
        ));
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch == null) {
            PENDING.remove(token);
            rejectCallback(incoming.getExtras(), claimId, AlphaIpcContract.FAIL_NOT_READY);
            return;
        }
        launch.setAction(AlphaIpcContract.ACTION_AGENT_OPEN);
        launch.setData(data);
        launch.putExtra(EXTRA_INTERNAL_HANDOFF, token);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            startActivity(launch);
        } catch (RuntimeException unavailable) {
            PENDING.remove(token);
            rejectCallback(incoming.getExtras(), claimId, AlphaIpcContract.FAIL_BROKEN);
        }
    }

    private boolean isVerifiedCoreCaller() {
        if (!AlphaIpcContract.hasSameSignatureAsCore(this)) return false;
        if (Build.VERSION.SDK_INT >= 34) {
            String launchedFrom = getLaunchedFromPackage();
            return AlphaIpcContract.CORE_PACKAGE.equals(launchedFrom);
        }
        return true;
    }

    private static IAlphaActionCallback extractCallback(Bundle extras) {
        if (extras == null) return null;
        IBinder binder = extras.getBinder(AlphaIpcContract.EXTRA_CALLBACK);
        return binder == null ? null : IAlphaActionCallback.Stub.asInterface(binder);
    }

    private static void rejectCallback(Bundle extras, String claimId, String errorCode) {
        IAlphaActionCallback callback = extractCallback(extras);
        if (callback == null) return;
        try {
            callback.onResult(claimId == null ? "" : claimId, false, null, errorCode);
        } catch (RemoteException ignored) {
        }
    }
}
