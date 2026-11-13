import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {javaBinary, jsonJar, jvmSkip, jvmTimeout} from './fixtures/jvm-tools.mjs';

const world = 'vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/BrowserReadingWorld.java';

test('the actual isolated-world callback refuses retired readiness and evaluator replies', {skip:jvmSkip('javac','json')}, () => {
  const root = mkdtempSync(join(tmpdir(), 'alpha-reading-world-'));
  const sources = {
    'android/net/Uri.java': `package android.net;
      public record Uri(java.net.URI value) {
        public static Uri parse(String value) { return new Uri(java.net.URI.create(value)); }
        public String getScheme() { return value.getScheme(); }
        public String getHost() { return value.getHost(); }
        public String getUserInfo() { return value.getUserInfo(); }
        public int getPort() { return value.getPort(); }
        public String toString() { return value.toString(); }
      }`,
    'android/webkit/WebView.java': `package android.webkit;
      public class WebView {
        public String url;
        public String getUrl() { return url; }
        public WebBackForwardList copyBackForwardList() { throw new AssertionError("unexpected history read"); }
      }`,
    'android/webkit/WebBackForwardList.java': `package android.webkit;
      public class WebBackForwardList {
        public int getCurrentIndex() { return 0; }
        public int getSize() { return 0; }
        public WebHistoryItem getItemAtIndex(int index) { throw new AssertionError(); }
        public static class WebHistoryItem { public String getUrl() { throw new AssertionError(); } }
      }`,
    'androidx/webkit/WebViewFeature.java': `package androidx.webkit;
      public class WebViewFeature {
        public static final String JS_INJECTION_IN_FRAME_AND_WORLD = "isolated";
        public static boolean isFeatureSupported(String feature) { return feature.equals("isolated"); }
      }`,
    'androidx/webkit/JavaScriptExecutionWorld.java': `package androidx.webkit; public class JavaScriptExecutionWorld {}`,
    'androidx/webkit/JavaScriptExecutionException.java': `package androidx.webkit; public class JavaScriptExecutionException extends Exception {}`,
    'androidx/webkit/ScriptHandler.java': `package androidx.webkit; public interface ScriptHandler { void remove(); }`,
    'androidx/webkit/WebViewOutcomeReceiver.java': `package androidx.webkit;
      public interface WebViewOutcomeReceiver<V,E> { void onResult(V value); void onError(E error); }`,
    'androidx/webkit/WebMessageCompat.java': `package androidx.webkit;
      public record WebMessageCompat(String data) {
        public static final int TYPE_STRING = 0;
        public int getType() { return TYPE_STRING; }
        public String getData() { return data; }
      }`,
    'androidx/webkit/JavaScriptReplyProxy.java': `package androidx.webkit;
      public class JavaScriptReplyProxy {
        public WebViewOutcomeReceiver<String,JavaScriptExecutionException> pending;
        public void executeJavaScript(String script, WebViewOutcomeReceiver<String,JavaScriptExecutionException> reply) {
          if (pending != null) throw new AssertionError("unsettled previous evaluation");
          pending = reply;
        }
        public void reply(String value) {
          var callback = pending;
          pending = null;
          callback.onResult(value);
        }
      }`,
    'androidx/webkit/WebViewCompat.java': `package androidx.webkit;
      import android.net.Uri;
      import android.webkit.WebView;
      import java.util.Set;
      public class WebViewCompat {
        public static final int INJECTION_EVENT_DOCUMENT_END = 1;
        public static WebMessageListener listener;
        public static String installedScript;
        private static final JavaScriptExecutionWorld isolated = new JavaScriptExecutionWorld();
        public interface WebMessageListener {
          void onPostMessage(WebView web, WebMessageCompat message, Uri origin, boolean main, JavaScriptReplyProxy reply);
        }
        public static JavaScriptExecutionWorld getExecutionWorld(WebView web, String name) { return isolated; }
        public static void addWebMessageListener(WebView web, String name, Set<String> origins, JavaScriptExecutionWorld world, WebMessageListener callback) {
          if (world != isolated || listener != null) throw new AssertionError("unowned listener");
          listener = callback;
        }
        public static ScriptHandler addJavaScriptOnEvent(WebView web, String script, int event, Set<String> origins, JavaScriptExecutionWorld world) {
          if (world != isolated || event != INJECTION_EVENT_DOCUMENT_END) throw new AssertionError("unowned script");
          installedScript = script;
          return () -> {};
        }
        public static void removeWebMessageListener(WebView web, JavaScriptExecutionWorld world, String channel) {
          if (world != isolated) throw new AssertionError("unowned listener removal");
          listener = null;
        }
      }`,
    'ReadingWorldReplay.java': `import ai.eliza.plugins.browsersurface.BrowserReadingWorld;
      import android.net.Uri;
      import android.webkit.WebView;
      import androidx.webkit.*;
      import java.util.concurrent.atomic.AtomicInteger;
      import org.json.JSONArray;
      public class ReadingWorldReplay {
        static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
        static String nonce() { return WebViewCompat.installedScript.split("'")[3].replace("|", ""); }
        static void post(WebView view, String nonce, String doc, JavaScriptReplyProxy proxy) {
          WebViewCompat.listener.onPostMessage(view, new WebMessageCompat(nonce+"|"+doc), Uri.parse("https://reading.invalid"), true, proxy);
        }
        public static void main(String[] args) {
          WebView web = new WebView();
          BrowserReadingWorld world = new BrowserReadingWorld(web);
          String first = "https://reading.invalid/first", second = "https://reading.invalid/second";
          world.prepare(first); web.url = first; world.pageStarted(first);
          String oldNonce = nonce(), oldDoc = "first-document";
          JavaScriptReplyProxy oldProxy = new JavaScriptReplyProxy();
          post(web, oldNonce, oldDoc, oldProxy);
          check(world.ready(), "first document adopted");
          for (String newDoc : new String[]{"second-document", "reloaded-document"}) {
            AtomicInteger retired = new AtomicInteger(), fresh = new AtomicInteger();
            world.evaluate("fixture", value -> { throw new AssertionError("retired excerpt published"); }, retired::incrementAndGet);
            oldProxy.reply(new JSONArray().put(oldDoc).put(web.url).toString());
            check(oldProxy.pending != null, "old source evaluation was issued");
            world.prepare(second); web.url = second; world.pageStarted(second);
            post(web, oldNonce, oldDoc, oldProxy);
            check(!world.ready(), "stale prepared readiness refused");
            JavaScriptReplyProxy newProxy = new JavaScriptReplyProxy();
            String newNonce = nonce();
            post(web, newNonce, newDoc, newProxy);
            check(world.ready(), "successor readiness accepted");
            oldProxy.reply("retired text");
            check(retired.get() == 1, "old evaluation settled once as refused");
            world.evaluate("fixture", value -> fresh.incrementAndGet(), () -> { throw new AssertionError("current excerpt refused"); });
            newProxy.reply(new JSONArray().put(newDoc).put(second).toString());
            newProxy.reply("current text");
            check(fresh.get() == 1, "current evaluation settled once");
            oldDoc = newDoc; oldNonce = newNonce; oldProxy = newProxy;
          }
          world.close();
          check(WebViewCompat.listener == null, "listener retired with its owner");
        }
      }`,
  };
  try {
    const ports = Object.entries(sources).map(([name, source]) => {
      const path = join(root,name);
      mkdirSync(dirname(path),{recursive:true});
      writeFileSync(path,source);
      return path;
    });
    execFileSync(javaBinary('javac'), ['--release','17','-cp',jsonJar,'-d',root,world,...ports], {timeout:jvmTimeout});
    assert.doesNotThrow(() => execFileSync(javaBinary('java'), ['-cp',root+':'+jsonJar,'ReadingWorldReplay'], {timeout:jvmTimeout}));
  } finally {rmSync(root,{recursive:true,force:true});}
});
