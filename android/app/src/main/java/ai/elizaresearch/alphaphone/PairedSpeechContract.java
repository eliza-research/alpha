package ai.elizaresearch.alphaphone;
import java.io.IOException;
import java.util.UUID;
import org.json.JSONObject;
/** Exact explicit development-host contract; never selects a fallback provider. */
final class PairedSpeechContract {
 static final String ASR_PATH="/api/asr/libelizainference",TTS_PATH="/api/tts/paradee";
 static final String ASR_PROVIDER="local-inference",TTS_PROVIDER="libelizainference-paradee";
 static String requestId(String value)throws IOException{try{if(value==null||!UUID.fromString(value).toString().equals(value))throw new IllegalArgumentException();return value;}catch(IllegalArgumentException invalid){throw new IOException("Invalid speech request identity");}}
 static boolean asrReady(JSONObject value){return Boolean.TRUE.equals(value.opt("ready"))&&ASR_PROVIDER.equals(value.optString("provider"))&&"pcm16-wav".equals(value.optString("format"))&&"en".equals(value.optString("language"))&&value.optInt("maxDurationSeconds")==60;}
 static boolean ttsReady(JSONObject value){return Boolean.TRUE.equals(value.opt("ready"))&&TTS_PROVIDER.equals(value.optString("provider"))&&"pcm16-wav".equals(value.optString("format"))&&value.optInt("sampleRate")==24000&&value.optInt("maxCharacters")==500;}
 static String transcript(JSONObject value)throws IOException{Object text=value.opt("text");if(!ASR_PROVIDER.equals(value.optString("provider"))||!(text instanceof String)||((String)text).isBlank()||((String)text).length()>16000)throw new IOException("Invalid selected-agent transcript");return (String)text;}
 static JSONObject ttsBody(String text)throws Exception{if(text==null||text.isBlank()||text.length()>500)throw new IOException("Keep selected-agent speech under 500 characters");return new JSONObject().put("text",text);}
 static void ttsHeaders(String id,String responseId,String provider,String mime)throws IOException{if(!requestId(id).equals(responseId)||!TTS_PROVIDER.equals(provider)||mime==null||!"audio/wav".equalsIgnoreCase(mime.split(";")[0].trim()))throw new IOException("Selected-agent speech response changed");}
}
