package ai.eliza.voice;

import android.content.Context;
import android.speech.SpeechRecognizer;
import org.json.JSONObject;

/** Compares availability after current and retired recognition callbacks. */
public final class RecognizerRetirementProbe {
 public static void main(String[] args)throws Exception {
  String mode=args[0];Context context=new Context();
  if(!OnDeviceRecognizer.available(context))throw new AssertionError("Fixture model should be installed");
  OnDeviceRecognizer recognizer=new OnDeviceRecognizer(context);recognizer.feed(new byte[]{1,2});
  SpeechRecognizer service=OnDeviceRecognizerSessionTest.listening(null);
  if(mode.equals("answered")){
   service.listener.onResults(OnDeviceRecognizerSessionTest.heard("hello"));
   if(!recognizer.finish(5000).equals("hello"))throw new AssertionError("First answer not retained");
   OnDeviceRecognizerSessionTest.released(service);
  }else if(mode.equals("cancelled")){
   recognizer.cancel();OnDeviceRecognizerSessionTest.released(service);
  }
  service.listener.onError(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE);
  boolean available=OnDeviceRecognizer.available(context);
  System.out.println(new JSONObject().put("mode",mode).put("answered",recognizer.answered())
   .put("availabilityAfterError",available).put("supportProbes",SpeechRecognizer.probes.get()));
 }
}
