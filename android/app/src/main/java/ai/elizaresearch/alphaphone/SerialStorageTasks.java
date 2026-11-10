package ai.elizaresearch.alphaphone;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
/** Keep slot work and its bridge serialization in one lane, independent of HTTP requests. */
final class SerialStorageTasks {
 private final ExecutorService executor=Executors.newSingleThreadExecutor();
 private volatile boolean closed;
 boolean submit(Runnable operation,Runnable rejected){
  Task task=new Task(operation,rejected);
  if(closed){task.reject();return false;}
  try{executor.execute(task);return true;}catch(RejectedExecutionException stopped){task.reject();return false;}
 }
 void close(){closed=true;for(Runnable queued:executor.shutdownNow())((Task)queued).reject();}
 private final class Task implements Runnable {
  final Runnable operation,rejected;
  Task(Runnable operation,Runnable rejected){this.operation=operation;this.rejected=rejected;}
  public void run(){if(closed)reject();else operation.run();}
  void reject(){rejected.run();}
 }
}
