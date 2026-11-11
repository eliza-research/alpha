import test from 'node:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {jvmSkip,javaBinary,jvmTimeout} from './fixtures/jvm-tools.mjs';

test('actual deletion review CAS retires queued work, retains admitted work and settles once',{skip:jvmSkip()},()=>{
 const dir=mkdtempSync(join(tmpdir(),'deletion-review-admission-'));
 try{
  const harness=join(dir,'AdmissionTest.java');
  writeFileSync(harness,`package ai.alphacompute.alphaphone;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
public class AdmissionTest {
 static void check(boolean value){if(!value)throw new AssertionError();}
 public static void main(String[] args)throws Exception{
  DeletionReviewAdmission cancelled=new DeletionReviewAdmission();cancelled.retire();
  check(!cancelled.queued()&&!cancelled.admit());check(cancelled.settle()&&!cancelled.settle());
  DeletionReviewAdmission admitted=new DeletionReviewAdmission();check(admitted.admit());admitted.retire();
  check(!admitted.admit()&&!admitted.queued());check(admitted.settle()&&!admitted.settle());
  DeletionReviewAdmission dismissed=new DeletionReviewAdmission();check(dismissed.settle());check(!dismissed.admit());
  // Pause racing the final worker admission has exactly one winner. Neither blocks on durable I/O.
  for(int i=0;i<200;i++){
   DeletionReviewAdmission admission=new DeletionReviewAdmission();CountDownLatch start=new CountDownLatch(1);
   AtomicBoolean won=new AtomicBoolean();AtomicInteger settlements=new AtomicInteger();
   Thread worker=new Thread(()->{try{start.await();won.set(admission.admit());}catch(Exception e){throw new AssertionError(e);}});
   Thread pause=new Thread(()->{try{start.await();admission.retire();}catch(Exception e){throw new AssertionError(e);}});
   worker.start();pause.start();start.countDown();worker.join();pause.join();
   check(!admission.queued()&&!admission.admit());
   // Dismiss/show-error and the worker's late receipt may both attempt completion.
   Thread first=new Thread(()->{if(admission.settle())settlements.incrementAndGet();});
   Thread second=new Thread(()->{if(admission.settle())settlements.incrementAndGet();});
   first.start();second.start();first.join();second.join();check(settlements.get()==1);
   check(!admission.admit());
  }
 }
}`);
  execFileSync(javaBinary('javac'),['-d',dir,resolve('android/app/src/main/java/ai/alphacompute/alphaphone/DeletionReviewAdmission.java'),harness],{timeout:jvmTimeout});
  execFileSync(javaBinary('java'),['-cp',dir,'ai.alphacompute.alphaphone.AdmissionTest'],{timeout:jvmTimeout});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
