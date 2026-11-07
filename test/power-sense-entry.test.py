"""Current shared-Sense Power shell tests. No device, permission grant, microphone or provider use."""
from pathlib import Path
import subprocess, tempfile, unittest, xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
JAVA=ROOT/'android/app/src/main/java/ai/elizaresearch/alphaphone'
JDK=Path('/opt/homebrew/opt/openjdk@21/bin')
API=Path('/Users/nubs/Library/Android/sdk/platforms/android-36/android.jar')

def write(root,name,text):
    p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)

class PowerSenseEntry(unittest.TestCase):
    def test_manifest_protects_only_explicit_power_child(self):
        ns='{http://schemas.android.com/apk/res/android}'
        root=ET.parse(ROOT/'android/app/src/main/AndroidManifest.xml').getroot()
        child=root.find("application/activity[@"+ns+"name='.AlphaPowerVoiceActivity']")
        self.assertIsNotNone(child);self.assertEqual(child.get(ns+'exported'),'true')
        self.assertEqual(child.get(ns+'permission'),'android.permission.STATUS_BAR_SERVICE')
        self.assertEqual(child.get(ns+'launchMode'),'singleTask');self.assertEqual(list(child),[])
        ordinary=root.find("application/activity[@"+ns+"name='.AlphaAssistActivity']")
        self.assertIsNone(ordinary.get(ns+'permission'))
        self.assertEqual(ordinary.find('intent-filter/action').get(ns+'name'),'android.intent.action.ASSIST')

    def test_real_activity_warm_same_instance_and_cold_restore_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix='alpha-power-sense-jvm-')as temp:
            out=Path(temp)
            write(out,'android/os/Bundle.java','package android.os; public class Bundle {}')
            write(out,'android/os/Build.java','package android.os; public class Build {public static class VERSION {public static int SDK_INT=36;}public static class VERSION_CODES {public static final int UPSIDE_DOWN_CAKE=34,VANILLA_ICE_CREAM=35;}}')
            write(out,'android/content/Intent.java','package android.content; public class Intent {public static final String ACTION_ASSIST="android.intent.action.ASSIST";public Class<?> target;public String action;public int extras;public Intent(Object c,Class<?> t){target=t;}public Intent setAction(String a){action=a;return this;}public Intent putExtra(String k,boolean v){extras++;return this;}}')
            write(out,'android/app/ComponentCaller.java','package android.app;public class ComponentCaller {private final String name;public ComponentCaller(String n){name=n;}public String getPackage(){return name;}}')
            write(out,'androidx/annotation/RequiresApi.java','package androidx.annotation;public @interface RequiresApi {int value();}')
            write(out,'ai/eliza/plugins/system/SenseListenerClient.java',r'''package ai.eliza.plugins.system;
public class SenseListenerClient {
 public static int ordinary,powerAttempts,powerAccepted;public static String caller,origin;public static boolean bound,ownsActivity=true;
 public SenseListenerClient(Object context){}
 public static int coldBegins,cancels,focusChanges;public boolean beginProtectedPowerLaunch(Object pin){coldBegins++;return true;}public void protectedPowerWindowFocusChanged(boolean focus){focusChanges++;}public void cancelProtectedPowerLaunch(){cancels++;}
 public static void reset(){ordinary=powerAttempts=powerAccepted=0;caller=origin=null;bound=false;ownsActivity=true;}
 public void recordInvocation(String from){ordinary++;caller=from;origin="assist";}
 public boolean recordProtectedPower(){powerAttempts++;if(!ownsActivity)return false;if(!bound){origin=null;return false;}origin="power";powerAccepted++;return true;}
}''')
            write(out,'ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java','package ai.elizaresearch.alphaphone;class AlphaLocalAgentPlugin {static class PowerLaunchPin {}static PowerLaunchPin pin;static PowerLaunchPin capturePowerLaunchPin(Object context){return pin;}}')
            write(out,'ai/elizaresearch/alphaphone/MainActivity.java',r'''package ai.elizaresearch.alphaphone;
import android.os.Bundle;import android.content.Intent;import android.app.ComponentCaller;
public class MainActivity {
 public static class Bridge {public int events;public void triggerWindowJSEvent(String name){events++;}}
 public Bridge bridge;public Intent intent;public int superNew;public String caller="foreign.package";
 protected boolean isAssistantSurface(){return false;}public Bridge getBridge(){return bridge;}
 public void onWindowFocusChanged(boolean f){}public void onPause(){}public void onDestroy(){}
 public void onCreate(Bundle b){}public void onNewIntent(Intent i){superNew++;}public void onNewIntent(Intent i,ComponentCaller c){onNewIntent(i);}
 public void setIntent(Intent i){intent=i;}public String getLaunchedFromPackage(){return caller;}
}''')
            for name in ['AlphaAssistActivity.java','AlphaPowerVoiceActivity.java']:
                write(out,'ai/elizaresearch/alphaphone/'+name,(JAVA/name).read_text())
            write(out,'ai/elizaresearch/alphaphone/PowerEntryTest.java',r'''package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.system.SenseListenerClient;import android.content.Intent;import android.app.ComponentCaller;import android.os.Bundle;
public final class PowerEntryTest {
 static void check(boolean b){if(!b)throw new AssertionError();}
 public static void main(String[]args){SenseListenerClient.reset();AlphaPowerVoiceActivity p=new AlphaPowerVoiceActivity();
  // Even an unrelated activity's established package lease cannot turn cold creation into Power.
  SenseListenerClient.bound=true;p.onCreate(null);check(SenseListenerClient.powerAttempts==0);check(SenseListenerClient.caller==null);check(p.intent.target==AlphaPowerVoiceActivity.class&&p.intent.extras==1);
  p.bridge=new MainActivity.Bridge();p.onNewIntent(new Intent(p,AlphaPowerVoiceActivity.class));check(SenseListenerClient.powerAttempts==1&&SenseListenerClient.powerAccepted==1);check(p.bridge.events==1&&p.superNew==1);check(p.intent.target==AlphaPowerVoiceActivity.class&&p.intent.extras==1);
  // API35's two-argument callback delegates once through the actual override, not twice.
  p.onNewIntent(new Intent(p,AlphaPowerVoiceActivity.class),new ComponentCaller("foreign.package"));check(SenseListenerClient.powerAttempts==2&&p.bridge.events==2&&p.superNew==2);
  // Session/owner reset makes the shared offer fail; no queued Power survives for a later bind.
  SenseListenerClient.bound=false;p.onNewIntent(new Intent(p,AlphaPowerVoiceActivity.class));check(SenseListenerClient.powerAccepted==2&&SenseListenerClient.origin==null);
  // Another Activity owns a newer valid listener lease. Stale child rejection has no foreign effect.
  SenseListenerClient.bound=true;SenseListenerClient.ownsActivity=false;SenseListenerClient.origin="listener";int ordinaryBefore=SenseListenerClient.ordinary;p.onNewIntent(new Intent(p,AlphaPowerVoiceActivity.class));check(SenseListenerClient.origin.equals("listener")&&SenseListenerClient.ordinary==ordinaryBefore);SenseListenerClient.ownsActivity=true;
  AlphaPowerVoiceActivity restored=new AlphaPowerVoiceActivity();SenseListenerClient.bound=true;int offered=SenseListenerClient.powerAttempts;restored.onCreate(new Bundle());check(SenseListenerClient.powerAttempts==offered&&SenseListenerClient.origin.equals("assist"));
  restored.onNewIntent(new Intent(restored,AlphaPowerVoiceActivity.class));check(SenseListenerClient.powerAttempts==offered); // no bridge
  AlphaAssistActivity ordinary=new AlphaAssistActivity();ordinary.bridge=new MainActivity.Bridge();ordinary.onCreate(null);ordinary.onNewIntent(new Intent(ordinary,AlphaAssistActivity.class),new ComponentCaller("foreign.package"));check(SenseListenerClient.powerAttempts==offered);check(ordinary.intent.target==AlphaAssistActivity.class&&ordinary.intent.extras==1);check(ordinary.takeInvocation().equals("assist")&&p.takeInvocation().equals("assist"));
  AlphaLocalAgentPlugin.pin=new AlphaLocalAgentPlugin.PowerLaunchPin();AlphaPowerVoiceActivity fresh=new AlphaPowerVoiceActivity();fresh.onCreate(null);check(SenseListenerClient.coldBegins==1);fresh.onWindowFocusChanged(true);fresh.onWindowFocusChanged(false);check(SenseListenerClient.focusChanges==2);fresh.onPause();fresh.onDestroy();check(SenseListenerClient.cancels==2);
  AlphaPowerVoiceActivity recreated=new AlphaPowerVoiceActivity();recreated.onCreate(new Bundle());check(SenseListenerClient.coldBegins==1);new AlphaAssistActivity().onCreate(null);check(SenseListenerClient.coldBegins==1);
  System.out.println("PASS actual Power shell: cold/restored/no-bridge/ordinary fail closed; same-bound-instance callback once; owner reset clears offer");
 }
}''')
            sources=[str(p)for p in out.rglob('*.java')]
            subprocess.run([str(JDK/'javac'),'--release','17','-d',str(out),*sources],check=True,capture_output=True)
            output=subprocess.check_output([str(JDK/'java'),'-cp',str(out),'ai.elizaresearch.alphaphone.PowerEntryTest'],text=True)
            self.assertIn('PASS actual Power shell',output)

    def test_activity_compiles_with_real_android36_api(self):
        self.assertTrue(API.is_file(),'Android36 API is required for this source check')
        with tempfile.TemporaryDirectory(prefix='alpha-power-sense-api36-')as temp:
            out=Path(temp)
            write(out,'androidx/annotation/RequiresApi.java','package androidx.annotation;public @interface RequiresApi {int value();}')
            write(out,'ai/eliza/plugins/system/SenseListenerClient.java','package ai.eliza.plugins.system;public class SenseListenerClient {public SenseListenerClient(android.content.Context c){}public void recordInvocation(String c){}public boolean recordProtectedPower(){return false;}public boolean beginProtectedPowerLaunch(Object pin){return false;}public void protectedPowerWindowFocusChanged(boolean f){}public void cancelProtectedPowerLaunch(){}}')
            write(out,'ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java','package ai.elizaresearch.alphaphone;class AlphaLocalAgentPlugin {static class PowerLaunchPin {}static PowerLaunchPin capturePowerLaunchPin(Object context){return null;}}')
            write(out,'ai/elizaresearch/alphaphone/MainActivity.java',r'''package ai.elizaresearch.alphaphone;
public class MainActivity extends android.app.Activity {protected boolean isAssistantSurface(){return false;}public static class Bridge {public void triggerWindowJSEvent(String n){}}public Bridge getBridge(){return null;}@Override public void onCreate(android.os.Bundle b){super.onCreate(b);}@Override public void onNewIntent(android.content.Intent i){super.onNewIntent(i);}}
''')
            sources=[str(p)for p in out.rglob('*.java')]+[str(JAVA/name)for name in ['AlphaAssistActivity.java','AlphaPowerVoiceActivity.java']]
            subprocess.run([str(JDK/'javac'),'--release','17','-cp',str(API),'-d',str(out),*sources],check=True,capture_output=True)

if __name__=='__main__':unittest.main()
