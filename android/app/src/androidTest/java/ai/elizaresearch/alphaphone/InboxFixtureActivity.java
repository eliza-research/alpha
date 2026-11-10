package ai.elizaresearch.alphaphone;
import com.getcapacitor.Plugin;
/** MainActivity/layout/WebView unchanged; substitution precedes creation and any JS. */
public final class InboxFixtureActivity extends MainActivity {
 @Override public void registerPlugin(Class<? extends Plugin> plugin){
  super.registerPlugin(plugin==AlphaConnectionPlugin.class?InboxFixtureConnection.class:plugin==AlphaCloudSignInPlugin.class?InboxFixtureSignIn.class:plugin);
 }
}
