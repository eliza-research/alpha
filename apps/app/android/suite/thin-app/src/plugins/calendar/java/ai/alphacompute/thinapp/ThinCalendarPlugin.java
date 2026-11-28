package ai.alphacompute.thinapp;

import ai.eliza.plugins.calendar.CalendarConfiguration;
import ai.eliza.plugins.calendar.CalendarPlugin;
import android.Manifest;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/** Thin standalone {@code ElizaCalendar} plugin bound to Alpha Phone's local calendar configuration. */
@CapacitorPlugin(name = "ElizaCalendar", permissions = {
    @Permission(alias = "calendar", strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR }),
    @Permission(alias = "workflowCalendarRead", strings = { Manifest.permission.READ_CALENDAR })
})
public final class ThinCalendarPlugin extends CalendarPlugin {
    private static final CalendarConfiguration CONFIGURATION = new CalendarConfiguration(
        "Alpha Phone",
        "alpha-phone-local",
        "On this phone",
        "alpha-calendar-creations-v1",
        "alphaphone://calendar-creation/",
        0xff0000ff,
        2000
    );

    public ThinCalendarPlugin() {
        super(CONFIGURATION);
    }
}
