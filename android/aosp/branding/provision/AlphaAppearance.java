package com.android.provision;

import android.app.Activity;
import android.app.WallpaperManager;
import android.graphics.Color;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.Toast;
import java.io.IOException;

/** A normal user action for applying the image's wallpaper after an in-place update. */
public final class AlphaAppearance extends Activity {
    static boolean applyPalette(Activity activity) {
        // Android's existing theme engine owns colors, contrast, light/dark and control states.
        return Settings.Secure.putString(activity.getContentResolver(),
                Settings.Secure.THEME_CUSTOMIZATION_OVERLAY_PACKAGES,
                "{\"android.theme.customization.system_palette\":\"0000FF\","
                + "\"android.theme.customization.accent_color\":\"0000FF\","
                + "\"android.theme.customization.theme_style\":\"TONAL_SPOT\","
                + "\"android.theme.customization.color_source\":\"preset\"}");
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        float density = getResources().getDisplayMetrics().density;
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER);
        column.setPadding((int)(28*density), (int)(32*density), (int)(28*density), (int)(32*density));
        column.setBackgroundColor(Color.rgb(5,5,5));
        ImageView preview = new ImageView(this);
        preview.setImageResource(R.drawable.alpha_wallpaper);
        preview.setContentDescription(getString(R.string.alpha_wallpaper_preview));
        preview.setAdjustViewBounds(true);
        column.addView(preview, new LinearLayout.LayoutParams(-1, 0, 1));
        Button apply = new Button(this);
        apply.setText(R.string.alpha_apply_wallpaper);
        apply.setAllCaps(false);
        apply.setTextColor(Color.WHITE);
        apply.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.BLUE));
        apply.setMinHeight((int)(56*density));
        column.addView(apply, new LinearLayout.LayoutParams(-1, -2));
        apply.setOnClickListener(view -> {
            try {
                WallpaperManager.getInstance(this).setResource(R.drawable.alpha_wallpaper,
                        WallpaperManager.FLAG_SYSTEM | WallpaperManager.FLAG_LOCK);
                if (!applyPalette(this)) throw new IOException("Palette update failed");
                Toast.makeText(this, R.string.alpha_wallpaper_applied, Toast.LENGTH_SHORT).show();
                finish();
            } catch (IOException | SecurityException error) {
                Toast.makeText(this, R.string.alpha_wallpaper_failed, Toast.LENGTH_LONG).show();
            }
        });
        setContentView(column);
    }
}
