package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.media.OwnedMediaConfig;

/**
 * Alpha's installed media identities for the shared native media module. These names predate the
 * shared engines and stay fixed so installed receipts, journals, pending video snapshots and
 * published copies keep resolving: preferences {@code alpha-photo-edit-results},
 * {@code alpha-kept-captures} and {@code alpha-video-copy-results-v1}, the cache directory
 * {@code alpha-video-edits}, and the MediaStore folders and display-name prefixes below (the capture
 * folder moved from Pictures/ to DCIM/Camera/ with the camera redesign).
 */
final class AlphaMediaConfig {
 static final OwnedMediaConfig MEDIA=OwnedMediaConfig.builder("alpha")
   // A scan reserved by an earlier install under Pictures/ is still recovered there.
   .edits("Pictures/Alpha Phone/Edits/","Alpha-edit-").captures("DCIM/Camera/","SCAN_").legacyCaptures("Pictures/")
   .videoEdits("Movies/Alpha Phone/Edits/","Alpha-video-edit-").build();
 /** Same-origin path of video playback capabilities served to the renderer. */
 static final String PLAYBACK_PATH="/_alpha_owned_video/";
 private AlphaMediaConfig(){}
}
