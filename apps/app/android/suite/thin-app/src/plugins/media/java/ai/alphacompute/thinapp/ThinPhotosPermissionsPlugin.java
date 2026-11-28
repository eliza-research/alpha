package ai.alphacompute.thinapp;

import ai.eliza.plugins.media.PermittedPhotosPlugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/** Thin standalone {@code ElizaPhotos} permission-filtered media access plugin. */
@CapacitorPlugin(name = "ElizaPhotos", permissions = {
    @Permission(alias = "libraryLegacy", strings = { "android.permission.READ_EXTERNAL_STORAGE" }),
    @Permission(alias = "libraryImages", strings = { "android.permission.READ_MEDIA_IMAGES" }),
    @Permission(alias = "libraryVideos", strings = { "android.permission.READ_MEDIA_VIDEO" }),
    @Permission(alias = "librarySelected", strings = { "android.permission.READ_MEDIA_VISUAL_USER_SELECTED" })
})
public final class ThinPhotosPermissionsPlugin extends PermittedPhotosPlugin {}
