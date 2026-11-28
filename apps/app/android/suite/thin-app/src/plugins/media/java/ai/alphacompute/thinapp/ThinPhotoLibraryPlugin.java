package ai.alphacompute.thinapp;

import ai.eliza.plugins.media.DeviceLibraryPlugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/** Thin standalone {@code AlphaPhotoLibrary} facade backed by {@link ThinPhotosPlugin}. */
@CapacitorPlugin(name = "AlphaPhotoLibrary", permissions = {
    @Permission(alias = "libraryLegacy", strings = { "android.permission.READ_EXTERNAL_STORAGE" }),
    @Permission(alias = "libraryImages", strings = { "android.permission.READ_MEDIA_IMAGES" }),
    @Permission(alias = "libraryVideos", strings = { "android.permission.READ_MEDIA_VIDEO" }),
    @Permission(alias = "librarySelected", strings = { "android.permission.READ_MEDIA_VISUAL_USER_SELECTED" })
})
public final class ThinPhotoLibraryPlugin extends DeviceLibraryPlugin {
    @Override protected String photosPluginName() {
        return "AlphaPhotos";
    }
}
