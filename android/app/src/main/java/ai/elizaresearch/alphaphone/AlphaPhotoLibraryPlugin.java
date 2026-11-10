package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.media.DeviceLibraryPlugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/** Alpha's registration of the shared agent album facade (plugins/plugin-native-media
 * DeviceLibraryPlugin) over AlphaPhotos' catalog and review: one epoch, one observer, one review at
 * a time, no index of its own and no URI-only destructive requests. Capacitor queues permission
 * calls by originating plugin, so this registration declares the library aliases itself. */
@CapacitorPlugin(name="AlphaPhotoLibrary",permissions={
 @Permission(alias="libraryLegacy",strings={"android.permission.READ_EXTERNAL_STORAGE"}),
 @Permission(alias="libraryImages",strings={"android.permission.READ_MEDIA_IMAGES"}),
 @Permission(alias="libraryVideos",strings={"android.permission.READ_MEDIA_VIDEO"}),
 @Permission(alias="librarySelected",strings={"android.permission.READ_MEDIA_VISUAL_USER_SELECTED"})
})
public class AlphaPhotoLibraryPlugin extends DeviceLibraryPlugin {
 @Override protected String photosPluginName(){return "AlphaPhotos";}
 @Override protected String closedMessage(){return LateLaunch.CLOSED;}
}
