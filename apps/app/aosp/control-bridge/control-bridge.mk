alpha_control_bridge_dir := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))
PRODUCT_PACKAGES += \
    AlphaControlBridge \
    AlphaControlBridgePrivappPermissions
SYSTEM_EXT_PRIVATE_SEPOLICY_DIRS += $(alpha_control_bridge_dir)/sepolicy
