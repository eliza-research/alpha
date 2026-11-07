package ai.elizaresearch.alphaphone;
import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.*;
import java.util.concurrent.TimeUnit;
/** Best-effort ordinary work; Doze/battery saver may defer it. No permanent connection. */
public final class GmailDeliveryWorker extends Worker {
 static final String PERIODIC="alpha-gmail-periodic",CATCHUP="alpha-gmail-catchup";
 public GmailDeliveryWorker(@NonNull Context context,@NonNull WorkerParameters params){super(context,params);}
 static void schedule(Context context,String generation){Data data=new Data.Builder().putString("generation",generation).build();Constraints constraints=new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();WorkManager manager=WorkManager.getInstance(context);manager.enqueueUniquePeriodicWork(PERIODIC,ExistingPeriodicWorkPolicy.UPDATE,new PeriodicWorkRequest.Builder(GmailDeliveryWorker.class,15,TimeUnit.MINUTES).setInputData(data).setConstraints(constraints).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build());manager.enqueueUniqueWork(CATCHUP,ExistingWorkPolicy.KEEP,new OneTimeWorkRequest.Builder(GmailDeliveryWorker.class).setInputData(data).setConstraints(constraints).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build());}
 static void cancel(Context context){WorkManager manager=WorkManager.getInstance(context);manager.cancelUniqueWork(PERIODIC);manager.cancelUniqueWork(CATCHUP);}
 @NonNull @Override public Result doWork(){String generation=getInputData().getString("generation");if(generation==null)return Result.failure();try{return GmailBackground.get(getApplicationContext()).sync(generation,()->{if(isStopped())throw new java.io.IOException("Mail check stopped");})?Result.success():Result.retry();}catch(SecurityException stale){return Result.success();}catch(Exception unavailable){return Result.retry();}}
}
