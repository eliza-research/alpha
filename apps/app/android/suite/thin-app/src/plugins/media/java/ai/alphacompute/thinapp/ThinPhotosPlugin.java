package ai.alphacompute.thinapp;

import ai.alphacompute.runtime.AlphaBaseActivity;
import ai.eliza.plugins.media.DocumentBytes;
import ai.eliza.plugins.media.MediaLibraryKey;
import ai.eliza.plugins.media.OwnedMediaConfig;
import ai.eliza.plugins.media.PermittedMediaCatalog;
import ai.eliza.plugins.media.PhotoLibraryAccess;
import ai.eliza.plugins.media.PhotosPlugin;
import ai.eliza.plugins.media.SelectedPhotoCopy;
import android.app.Activity;
import android.content.ContentResolver;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Set;

/** Thin standalone {@code AlphaPhotos} media editing, library, capture, and verified picture attachment plugin. */
@CapacitorPlugin(name = "AlphaPhotos", permissions = {
    @Permission(alias = "libraryLegacy", strings = { "android.permission.READ_EXTERNAL_STORAGE" }),
    @Permission(alias = "libraryImages", strings = { "android.permission.READ_MEDIA_IMAGES" }),
    @Permission(alias = "libraryVideos", strings = { "android.permission.READ_MEDIA_VIDEO" }),
    @Permission(alias = "librarySelected", strings = { "android.permission.READ_MEDIA_VISUAL_USER_SELECTED" })
})
public final class ThinPhotosPlugin extends PhotosPlugin {
    private static final int MAX_MMS_PICTURE_BYTES = 300 * 1024;
    private static final OwnedMediaConfig MEDIA = OwnedMediaConfig.builder("alpha")
        .edits("Pictures/Alpha Phone/Edits/", "Alpha-edit-")
        .captures("DCIM/Camera/", "SCAN_")
        .videoEdits("Movies/Alpha Phone/Edits/", "Alpha-video-edit-")
        .build();

    @Override protected OwnedMediaConfig mediaConfig() {
        return MEDIA;
    }

    @Override protected String playbackPath() {
        return "/_alpha_owned_video/";
    }

    @PluginMethod public void readMessagePicture(PluginCall call) {
        readOriginalPicture(call, MAX_MMS_PICTURE_BYTES, Set.of("image/jpeg", "image/png"));
    }

    @PluginMethod public void readEmailPicture(PluginCall call) {
        readOriginalPicture(call, DocumentBytes.MAX_BYTES, Set.of("image/jpeg", "image/png", "image/webp"));
    }

    private void readOriginalPicture(PluginCall call, int limit, Set<String> types) {
        submitRead(call, () -> {
            String id = call.getString("id", "");
            String revision = call.getString("revision", "");
            if (!PhotoLibraryAccess.permitted(id) || revision.isBlank()) throw new SecurityException();
            MediaLibraryKey key = MediaLibraryKey.parse(id);
            if (key.video) throw new SecurityException();
            PermittedMediaCatalog permitted = permittedCatalog();
            ContentResolver resolver = getContext().getContentResolver();
            Uri uri = permitted.uri(key);
            PermittedMediaCatalog.Fence fence = permitted.fence();
            SelectedPhotoCopy.Guard current = () -> {
                Activity activity = getActivity();
                if (!AlphaBaseActivity.shareForeground(activity)) throw new SecurityException();
                permitted.requireCurrent(fence);
            };
            SelectedPhotoCopy.Copy picture = SelectedPhotoCopy.read(new SelectedPhotoCopy.Source() {
                @Override public SelectedPhotoCopy.Metadata inspect() throws Exception {
                    current.check();
                    JSObject item = permitted.read(id, revision, false);
                    String mime = resolver.getType(uri);
                    long size = item.getLong("size");
                    if (mime == null || !types.contains(mime) || size <= 0 || size > limit) {
                        throw new IOException("The selected photo exceeds its attachment type or size limit");
                    }
                    return new SelectedPhotoCopy.Metadata(
                        item.getString("name"),
                        mime,
                        size,
                        item.getString("revision"),
                        item.getString("identity")
                    );
                }

                @Override public InputStream open() throws IOException {
                    InputStream bytes = resolver.openInputStream(uri);
                    if (bytes == null) throw new IOException("Photo unavailable");
                    Handler main = new Handler(Looper.getMainLooper());
                    Runnable timeout = () -> {
                        Thread closer = new Thread(() -> {
                            try {
                                bytes.close();
                            } catch (IOException ignored) {
                            }
                        }, "ThinPhotoReadTimeout");
                        closer.setDaemon(true);
                        closer.start();
                    };
                    main.postDelayed(timeout, 5_000L);
                    return new FilterInputStream(bytes) {
                        @Override public void close() throws IOException {
                            main.removeCallbacks(timeout);
                            super.close();
                        }
                    };
                }
            }, current);
            if (picture.bytes.length > limit) {
                throw new IOException("The selected picture exceeds its attachment limit");
            }
            DocumentBytes.validate(picture.metadata.name, picture.metadata.mime, picture.bytes);
            current.check();
            return new JSObject()
                .put("name", picture.metadata.name)
                .put("mimeType", picture.metadata.mime)
                .put("size", picture.bytes.length)
                .put("dataBase64", Base64.encodeToString(picture.bytes, Base64.NO_WRAP));
        });
    }
}
