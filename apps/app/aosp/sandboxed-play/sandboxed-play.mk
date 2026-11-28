alpha_sandboxed_play_dir := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))
PRODUCT_PACKAGES += \
    GmsCompat \
    GmsCompatLib \
    GmsCompatConfig \
    AlphaPlayInstaller \
    AlphaPlayInstallerPrivappPermissions \
    AlphaWebViewConfigOverlay
