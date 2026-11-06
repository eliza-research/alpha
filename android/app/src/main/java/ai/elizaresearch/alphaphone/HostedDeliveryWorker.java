package ai.elizaresearch.alphaphone;
import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.*;
import java.util.concurrent.TimeUnit;
/** Ordinary best-effort work, never exact alarms or a foreground service. */
public final class HostedDeliveryWorker extends Worker {
 private static final String PERIODIC="alpha-hosted-results-periodic",CATCHUP="alpha-hosted-results-catchup";
 private final String generation;
 public HostedDeliveryWorker(@NonNull Context context,@NonNull WorkerParameters params){super(context,params);generation=params.getInputData().getString("generation");}
 static void schedule(Context context,String generation,boolean resident){Data data=new Data.Builder().putString("generation",generation).build();Constraints constraints=new Constraints.Builder().setRequiredNetworkType(resident?NetworkType.NOT_REQUIRED:NetworkType.CONNECTED).build();WorkManager manager=WorkManager.getInstance(context);manager.enqueueUniquePeriodicWork(PERIODIC,ExistingPeriodicWorkPolicy.UPDATE,new PeriodicWorkRequest.Builder(HostedDeliveryWorker.class,15,TimeUnit.MINUTES).setInputData(data).setConstraints(constraints).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build());manager.enqueueUniqueWork(CATCHUP,ExistingWorkPolicy.REPLACE,new OneTimeWorkRequest.Builder(HostedDeliveryWorker.class).setInputData(data).setConstraints(constraints).build());}
 private static String renewalWork(String sourceId){return "alpha-source-renewal-"+HostedResultNotices.sourceId(sourceId);}
 /** Best-effort WorkManager delay; the in-app notice remains the reliable surface. */
 static void scheduleRenewal(Context context,String sourceId,long expiresAt,long now){long delay=HostedResultNotices.renewalDelay(expiresAt,now);WorkManager manager=WorkManager.getInstance(context);if(delay<0){manager.cancelUniqueWork(renewalWork(sourceId));return;}manager.enqueueUniqueWork(renewalWork(sourceId),ExistingWorkPolicy.REPLACE,new OneTimeWorkRequest.Builder(HostedDeliveryWorker.class).setInputData(new Data.Builder().putString("renewalSource",sourceId).putLong("expiresAt",expiresAt).build()).setInitialDelay(delay,TimeUnit.MILLISECONDS).build());}
 static void cancelRenewal(Context context,String sourceId){WorkManager.getInstance(context).cancelUniqueWork(renewalWork(sourceId));new HostedNoticePoster(context).cancelRenewal(sourceId);}
 static void cancel(Context context){WorkManager manager=WorkManager.getInstance(context);manager.cancelUniqueWork(PERIODIC);manager.cancelUniqueWork(CATCHUP);}
 @NonNull @Override public Result doWork(){
  String renewal=getInputData().getString("renewalSource");
  if(renewal!=null){try{SourceRenewalHost.get(getApplicationContext()).post(HostedResultNotices.sourceId(renewal),System.currentTimeMillis());}catch(SourceRenewalNotices.RenewalUnverifiable unknown){/* Resident not ready: back off while the source is still valid. */return getInputData().getLong("expiresAt",0)>System.currentTimeMillis()?Result.retry():Result.success();}catch(Exception ignored){/* A denied channel or stale source posts nothing. */}return Result.success();}
  if(generation==null)return Result.failure();try{HostedDelivery.get(getApplicationContext()).syncBackground(generation);return Result.success();}catch(SecurityException disabled){return Result.success();}catch(Exception unavailable){return Result.retry();}}
 @Override public void onStopped(){if(generation!=null)HostedDelivery.get(getApplicationContext()).stop(generation);}
}
