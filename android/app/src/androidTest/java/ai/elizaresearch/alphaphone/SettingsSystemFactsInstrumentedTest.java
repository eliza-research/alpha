package ai.elizaresearch.alphaphone;
import android.app.NotificationManager;
import android.content.Context;
import android.location.LocationManager;
import android.os.ParcelFileDescriptor;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
/**
 * Read-only: compares the system switch facts Settings and the shade show with what this Android
 * image reports through an independent path (the shell). It changes no setting. A pass on an
 * emulator is not device acceptance of the Settings handoffs.
 */
@RunWith(AndroidJUnit4.class)
public final class SettingsSystemFactsInstrumentedTest {
 private String shell(String command)throws Exception{
  try(InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command))){
   ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int count;while((count=in.read(buffer))!=-1)out.write(buffer,0,count);
   return new String(out.toByteArray(),StandardCharsets.UTF_8).trim();
  }
 }
 @Test public void switchMappingsNeverGuess(){
  assertEquals(Boolean.FALSE,ai.eliza.plugins.system.SystemFacts.wifiSwitch(0));assertEquals(Boolean.TRUE,ai.eliza.plugins.system.SystemFacts.wifiSwitch(1));
  assertEquals(Boolean.TRUE,ai.eliza.plugins.system.SystemFacts.wifiSwitch(2));assertEquals(Boolean.FALSE,ai.eliza.plugins.system.SystemFacts.wifiSwitch(3));
  assertNull(ai.eliza.plugins.system.SystemFacts.wifiSwitch(4));assertNull(ai.eliza.plugins.system.SystemFacts.wifiSwitch(-1));
  assertEquals(Boolean.FALSE,ai.eliza.plugins.system.SystemFacts.binarySwitch(0));assertEquals(Boolean.TRUE,ai.eliza.plugins.system.SystemFacts.binarySwitch(1));
  assertNull(ai.eliza.plugins.system.SystemFacts.binarySwitch(2));assertNull(ai.eliza.plugins.system.SystemFacts.binarySwitch(-1));
  assertEquals(Boolean.TRUE,ai.eliza.plugins.system.SystemFacts.adapterSwitch(android.bluetooth.BluetoothAdapter.STATE_ON));assertEquals(Boolean.FALSE,ai.eliza.plugins.system.SystemFacts.adapterSwitch(android.bluetooth.BluetoothAdapter.STATE_OFF));
  assertNull(ai.eliza.plugins.system.SystemFacts.adapterSwitch(android.bluetooth.BluetoothAdapter.STATE_TURNING_ON));assertNull(ai.eliza.plugins.system.SystemFacts.adapterSwitch(android.bluetooth.BluetoothAdapter.STATE_TURNING_OFF));assertNull(ai.eliza.plugins.system.SystemFacts.adapterSwitch(-1));
  assertEquals("all",ai.eliza.plugins.system.SystemFacts.interruptionName(NotificationManager.INTERRUPTION_FILTER_ALL));
  assertEquals("priority",ai.eliza.plugins.system.SystemFacts.interruptionName(NotificationManager.INTERRUPTION_FILTER_PRIORITY));
  assertEquals("alarms",ai.eliza.plugins.system.SystemFacts.interruptionName(NotificationManager.INTERRUPTION_FILTER_ALARMS));
  assertEquals("none",ai.eliza.plugins.system.SystemFacts.interruptionName(NotificationManager.INTERRUPTION_FILTER_NONE));
  assertNull(ai.eliza.plugins.system.SystemFacts.interruptionName(NotificationManager.INTERRUPTION_FILTER_UNKNOWN));
 }
 @Test public void reportedFactsMatchThisAndroidImage()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  // The snapshot is the shared reader plus Alpha's own build facts, exactly as AlphaDevice.snapshot() merges them.
  JSObject facts=new JSObject();for(java.util.Map.Entry<String,Object> fact:ai.eliza.plugins.system.SystemFacts.read(context).entrySet())facts.put(fact.getKey(),fact.getValue());AlphaDevicePlugin.appFacts(context,facts);
  // A fact may be absent (unknown). When present it must equal Android's own answer.
  // Bluetooth is checked below: its stored switch is the owner's choice, not the radio state.
  String[][] globals={{"wifiEnabled","wifi_on"},{"airplaneMode","airplane_mode_on"}};
  for(String[] row:globals){
   if(!facts.has(row[0]))continue;
   String raw=shell("settings get global "+row[1]);
   boolean expected="wifi_on".equals(row[1])?("1".equals(raw)||"2".equals(raw)):"1".equals(raw);
   assertEquals(row[0]+" matches settings global "+row[1]+"="+raw,expected,facts.getBoolean(row[0]));
  }
  if(facts.has("bluetoothEnabled")){
   // The Bluetooth service's own dump, when this image prints a settled state line.
   java.util.regex.Matcher state=java.util.regex.Pattern.compile("(?m)^\\s*state: (ON|OFF)\\s*$").matcher(shell("dumpsys bluetooth_manager"));
   if(state.find())assertEquals("bluetoothEnabled matches the Bluetooth service state "+state.group(1),"ON".equals(state.group(1)),facts.getBoolean("bluetoothEnabled"));
  }
  if(facts.has("locationEnabled"))assertEquals(context.getSystemService(LocationManager.class).isLocationEnabled(),facts.getBoolean("locationEnabled"));
  if(facts.has("interruptionFilter"))assertEquals(ai.eliza.plugins.system.SystemFacts.interruptionName(context.getSystemService(NotificationManager.class).getCurrentInterruptionFilter()),facts.getString("interruptionFilter"));
  if(facts.has("adaptiveBrightness"))assertEquals("1".equals(shell("settings get system screen_brightness_mode")),facts.getBoolean("adaptiveBrightness"));
  assertEquals(BuildConfig.VERSION_CODE,facts.getInt("appVersionCode"));
  assertTrue("Android recorded an install time",facts.getLong("appUpdatedAt")>0);
  assertTrue("the signing certificate digest is 64 lowercase hex characters",facts.getString("appSigner").matches("[0-9a-f]{64}"));
  // Only these keys: the snapshot never carries a guessed or default switch.
  java.util.Set<String> allowed=new java.util.HashSet<>(java.util.Arrays.asList("wifiEnabled","bluetoothEnabled","airplaneMode","locationEnabled","mobileDataEnabled","interruptionFilter","adaptiveBrightness","wifiActive","cellularActive","internetValidated","batteryPercent","charging","powerSave","appVersionCode","appUpdatedAt","appSigner"));
  for(java.util.Iterator<String> keys=facts.keys();keys.hasNext();)assertTrue(allowed.contains(keys.next()));
 }
 @Test public void everySettingsPageHasASpecificFirstChoice(){
  String[] pages={"accounts","wifi","bluetooth","mobile","airplane","location","display","sound","battery","about","developer","notifications","privacy","default-apps","dnd"};
  java.util.Set<String> first=new java.util.HashSet<>();
  for(String page:pages){
   String[] actions=ai.eliza.plugins.system.SystemSettingsPages.actions(page);
   assertNotNull(page,actions);assertTrue(page,actions.length>0);
   for(String action:actions)assertNotEquals(page,android.provider.Settings.ACTION_SETTINGS,action);
   assertTrue(page+" has its own page",first.add(actions[0]));
  }
  assertNull(ai.eliza.plugins.system.SystemSettingsPages.actions("device"));assertNull(ai.eliza.plugins.system.SystemSettingsPages.actions(""));
 }
}
