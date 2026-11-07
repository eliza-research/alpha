package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.media.OwnedMediaConfig;
import ai.eliza.plugins.media.PhotosPlugin;

import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Alpha's registration of the shared Photos bridge (plugins/plugin-native-media PhotosPlugin):
 * permission-filtered library reads and explicitly reviewed media management. Alpha keeps only its
 * installed names (plugin name AlphaPhotos, preference files alpha-owned-media-versions and
 * alpha-owned-albums through the "alpha" namespace, MediaStore folders, display-name prefixes,
 * playback path), its debug QA markers and its late-launch answer.
 */
@CapacitorPlugin(name="AlphaPhotos",permissions={
 @Permission(alias="libraryLegacy",strings={"android.permission.READ_EXTERNAL_STORAGE"}),
 @Permission(alias="libraryImages",strings={"android.permission.READ_MEDIA_IMAGES"}),
 @Permission(alias="libraryVideos",strings={"android.permission.READ_MEDIA_VIDEO"}),
 @Permission(alias="librarySelected",strings={"android.permission.READ_MEDIA_VISUAL_USER_SELECTED"})
})
public class AlphaPhotosPlugin extends PhotosPlugin {
 /** Debug QA markers are the shared closed enum: never media data or exception text; release builds stay silent. */
 static void qaMarker(PhotosPlugin.Diagnostic marker){if(BuildConfig.DEBUG)android.util.Log.i("AlphaPhotosQA",marker.name());}
 static final OwnedMediaConfig MEDIA_CONFIG=AlphaMediaConfig.MEDIA;
 @Override protected OwnedMediaConfig mediaConfig(){return MEDIA_CONFIG;}
 @Override protected String playbackPath(){return AlphaMediaConfig.PLAYBACK_PATH;}
 @Override protected void diagnostic(PhotosPlugin.Diagnostic marker){qaMarker(marker);}
 @Override protected String closedMessage(){return LateLaunch.CLOSED;}
 // Native-only reviewed recovery; deliberately absent from the Capacitor/JS API.
 void preserveClosedVideoCopy(String operationId,String expectedRecordHash,PluginCall call){preserveClosedFailure(operationId,expectedRecordHash,call);}
}
