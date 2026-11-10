# Cloud-first hardware invocation

AlphaFrameworkOverlay supplies the default assistant package and long-press Power behavior
independently of the optional offline listener. Power + Volume Up retains the power menu;
camera double-press, emergency gestures and short-press behavior retain factory values.
Saved assistant and power preferences remain authoritative. No settings migration or new
microphone permission is added.

The existing exported ACTION_ASSIST activity opens Alpha's assistant surface. This change
does not start recording automatically, trust intent extras, or grant a voice-interaction
service. Talk remains the explicit microphone action until the separate invocation and
Cloud voice acceptance gates pass.

Framework source authority is frameworks/base revision
94b4c163b7dfe5ce3607f7bb8456f9573f7de57d, core/res/res/values/config.xml and
services/core/java/com/android/server/policy/PhoneWindowManager.java.

Before delivery, qualify a fresh simulator image: default assistant resolves Alpha;
long-press opens Alpha once; Power + Volume Up opens shutdown/restart; short-press,
camera double-press and emergency routes retain their behavior. Also verify a returning
user's saved settings survive. Source tests do not establish these runtime results.
