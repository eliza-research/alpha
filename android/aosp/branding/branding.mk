# Alpha product visuals and navigation policy; retain factory hardware overlays.
alpha_branding_dir := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))
# Preserve secure-camera defaults in the base packages as well as the explicit Alpha overlays.
PRODUCT_ENFORCE_RRO_EXCLUDED_OVERLAYS += vendor/alphaphone/secure-camera/overlay
PRODUCT_PACKAGES += AlphaFrameworkOverlay AlphaSystemUIOverlay AlphaSettingsOverlay AlphaSettingsProviderOverlay AlphaNavigationOverlay
# LatinIME private style attributes are compiled inside the keyboard APK.
PRODUCT_PACKAGE_OVERLAYS += $(alpha_branding_dir)/keyboard-overlay
PRODUCT_ENFORCE_RRO_EXCLUDED_OVERLAYS += $(alpha_branding_dir)/keyboard-overlay
PRODUCT_COPY_FILES += $(alpha_branding_dir)/generated/bootanimation.zip:$(TARGET_COPY_OUT_PRODUCT)/media/bootanimation.zip
