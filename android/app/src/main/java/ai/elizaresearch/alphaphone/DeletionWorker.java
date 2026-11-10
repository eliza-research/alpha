package ai.elizaresearch.alphaphone;
import android.content.Context;
import androidx.work.*;
/** Delayed local deletion recovery. A claimed provider mutation is never automatically retried. */
public final class DeletionWorker extends Worker {
 public DeletionWorker(Context context,WorkerParameters parameters){super(context,parameters);}
 // A row that could not be settled (owner offline, storage or effect failure) is retried with
 // WorkManager backoff; only local settlement and idempotent effects run again, never a claimed dispatch.
 @Override public Result doWork(){try{return NativeDeletionCoordinator.get(getApplicationContext()).reconcile()?Result.retry():Result.success();}catch(Exception unavailable){return Result.retry();}}
}
