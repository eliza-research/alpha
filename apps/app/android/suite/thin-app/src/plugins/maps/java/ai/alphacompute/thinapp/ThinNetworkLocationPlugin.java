package ai.alphacompute.thinapp;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiManager;
import android.os.SystemClock;
import android.telephony.CellIdentityGsm;
import android.telephony.CellIdentityLte;
import android.telephony.CellIdentityWcdma;
import android.telephony.CellInfo;
import android.telephony.CellInfoGsm;
import android.telephony.CellInfoLte;
import android.telephony.CellInfoWcdma;
import android.telephony.TelephonyManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;

/** Standalone {@code AlphaNetworkLocation} plugin providing Wi-Fi and cell network geolocation for Maps. */
@CapacitorPlugin(name = "AlphaNetworkLocation")
public final class ThinNetworkLocationPlugin extends Plugin {
    private static final String ENDPOINT = "https://api.beacondb.net/v1/geolocate";
    private static final String USER_AGENT = "AlphaPhone-NetworkLocation/1";
    private static final long FRESH_SCAN_MS = 120_000L;
    private static final int MAX_WIFI = 40;
    private static final int MAX_CELLS = 8;
    private static final Pattern MAC = Pattern.compile("^[0-9a-f]{2}(:[0-9a-f]{2}){5}$");

    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private record WifiPoint(String bssid, String ssid, int rssi, long ageMs) {}
    private record CellPoint(String radio, int mcc, int mnc, long area, long cellId, int signal) {}

    private static final class Query {
        final List<WifiPoint> wifi = new ArrayList<>();
        final List<CellPoint> cells = new ArrayList<>();

        void addWifi(String bssid, String ssid, int rssi, long ageMs) {
            if (bssid == null || wifi.size() >= MAX_WIFI) return;
            String mac = bssid.toLowerCase(Locale.ROOT);
            if (!MAC.matcher(mac).matches() || "00:00:00:00:00:00".equals(mac)) return;
            if ((Integer.parseInt(mac.substring(0, 2), 16) & 0x02) != 0) return;
            String name = ssid == null ? "" : ssid.replace("\"", "");
            if (name.isEmpty() || name.toLowerCase(Locale.ROOT).endsWith("_nomap")) return;
            for (WifiPoint seen : wifi) {
                if (seen.bssid().equals(mac)) return;
            }
            wifi.add(new WifiPoint(mac, name, rssi, Math.max(0L, ageMs)));
        }

        void addCell(String radio, int mcc, int mnc, long area, long cellId, int signal) {
            if (cells.size() >= MAX_CELLS || !("gsm".equals(radio) || "wcdma".equals(radio) || "lte".equals(radio))) return;
            if (mcc < 1 || mcc > 999 || mnc < 0 || mnc > 999 || area <= 0 || area >= 0xFFFFFFFL || cellId <= 0 || cellId >= 0xFFFFFFFL) return;
            cells.add(new CellPoint(radio, mcc, mnc, area, cellId, signal));
        }

        boolean usable() {
            return wifi.size() >= 2 || !cells.isEmpty();
        }

        String fingerprint() {
            List<String> ids = new ArrayList<>();
            for (WifiPoint entry : wifi) ids.add(entry.bssid());
            for (CellPoint cell : cells) ids.add(cell.radio() + cell.mcc() + "-" + cell.mnc() + "-" + cell.area() + "-" + cell.cellId());
            Collections.sort(ids);
            return String.join(",", ids);
        }

        String json() {
            StringBuilder out = new StringBuilder("{\"considerIp\":true,\"fallbacks\":{\"ipf\":true,\"lacf\":true}");
            if (!wifi.isEmpty()) {
                out.append(",\"wifiAccessPoints\":[");
                for (int i = 0; i < wifi.size(); i++) {
                    WifiPoint w = wifi.get(i);
                    if (i > 0) out.append(',');
                    out.append("{\"macAddress\":\"").append(w.bssid())
                        .append("\",\"signalStrength\":").append(w.rssi())
                        .append(",\"age\":").append(w.ageMs()).append('}');
                }
                out.append(']');
            }
            if (!cells.isEmpty()) {
                out.append(",\"cellTowers\":[");
                for (int i = 0; i < cells.size(); i++) {
                    CellPoint c = cells.get(i);
                    if (i > 0) out.append(',');
                    out.append("{\"radioType\":\"").append(c.radio())
                        .append("\",\"mobileCountryCode\":").append(c.mcc())
                        .append(",\"mobileNetworkCode\":").append(c.mnc())
                        .append(",\"locationAreaCode\":").append(c.area())
                        .append(",\"cellId\":").append(c.cellId())
                        .append(",\"signalStrength\":").append(c.signal()).append('}');
                }
                out.append(']');
            }
            return out.append('}').toString();
        }
    }

    @PluginMethod public void locate(PluginCall call) {
        try {
            worker.execute(() -> run(call));
        } catch (RejectedExecutionException closed) {
            call.reject("Network location is unavailable", "unavailable");
        }
    }

    private void run(PluginCall call) {
        Context context = getContext();
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Location permission is not granted", "permission-denied");
            return;
        }
        LocationManager location = context.getSystemService(LocationManager.class);
        if (location == null || !location.isLocationEnabled()) {
            call.reject("Device location is off", "location-off");
            return;
        }
        Query query = new Query();
        try {
            addWifi(context, query);
        } catch (RuntimeException ignored) {
        }
        try {
            addCells(context, query);
        } catch (RuntimeException ignored) {
        }
        if (!query.usable()) query = new Query();
        String fingerprint = query.usable() ? Integer.toHexString(query.fingerprint().hashCode()) : "";
        if (Thread.currentThread().isInterrupted()) {
            call.reject("Network location was stopped", "unavailable");
            return;
        }
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Location permission is not granted", "permission-denied");
            return;
        }
        if (!location.isLocationEnabled()) {
            call.reject("Device location is off", "location-off");
            return;
        }
        if (!fingerprint.isEmpty() && fingerprint.equals(call.getString("unchangedFrom", ""))) {
            call.resolve(new JSObject().put("unchanged", true).put("fingerprint", fingerprint));
            return;
        }
        HttpsURLConnection connection = null;
        try {
            connection = (HttpsURLConnection) URI.create(ENDPOINT).toURL().openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(5_000);
            connection.setReadTimeout(8_000);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("User-Agent", USER_AGENT);
            byte[] body = query.json().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body);
            }
            int status = connection.getResponseCode();
            if (status == 404) {
                call.reject("No position is known for these signals", "not-found");
                return;
            }
            if (status != 200) {
                call.reject("Network location service answered " + status, "unavailable");
                return;
            }
            double[] fix;
            try (InputStream in = connection.getInputStream()) {
                fix = parseFix(readBounded(in));
            }
            if (fix == null) {
                call.reject("Network location answer was not usable", "invalid-response");
                return;
            }
            call.resolve(new JSObject()
                .put("latitude", fix[0])
                .put("longitude", fix[1])
                .put("accuracy", fix[2])
                .put("timestamp", System.currentTimeMillis())
                .put("fingerprint", fingerprint)
                .put("wifi", query.wifi.size())
                .put("cells", query.cells.size()));
        } catch (Exception failed) {
            call.reject("Network location service is unreachable", "unavailable");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String readBounded(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[1024];
        int count;
        while ((count = in.read(buffer)) > 0) {
            out.write(buffer, 0, count);
            if (out.size() > 4096) break;
        }
        return out.toString(StandardCharsets.UTF_8);
    }

    private static double[] parseFix(String body) {
        if (body == null || body.length() > 4096) return null;
        Matcher lat = Pattern.compile("\"lat\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?(?:[eE]-?\\d+)?)").matcher(body);
        Matcher lng = Pattern.compile("\"lng\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?(?:[eE]-?\\d+)?)").matcher(body);
        Matcher acc = Pattern.compile("\"accuracy\"\\s*:\\s*(\\d+(?:\\.\\d+)?(?:[eE]\\d+)?)").matcher(body);
        if (!lat.find() || !lng.find() || !acc.find()) return null;
        double latitude = Double.parseDouble(lat.group(1));
        double longitude = Double.parseDouble(lng.group(1));
        double accuracy = Double.parseDouble(acc.group(1));
        if (!(latitude >= -90.0 && latitude <= 90.0 && longitude >= -180.0 && longitude <= 180.0 && accuracy > 0.0 && accuracy <= 100_000.0)) {
            return null;
        }
        return new double[] { latitude, longitude, accuracy };
    }

    private void addWifi(Context context, Query query) {
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            || context.checkSelfPermission(Manifest.permission.ACCESS_WIFI_STATE) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        WifiManager wifi = context.getApplicationContext().getSystemService(WifiManager.class);
        if (wifi == null) return;
        List<ScanResult> results = wifi.getScanResults();
        long now = SystemClock.elapsedRealtime();
        boolean fresh = false;
        for (ScanResult result : results) {
            if (now - result.timestamp / 1000L < FRESH_SCAN_MS) {
                fresh = true;
                break;
            }
        }
        if (!fresh && (wifi.isWifiEnabled() || wifi.isScanAlwaysAvailable())) {
            CountDownLatch done = new CountDownLatch(1);
            BroadcastReceiver receiver = new BroadcastReceiver() {
                @Override public void onReceive(Context c, Intent i) { done.countDown(); }
            };
            context.registerReceiver(receiver, new IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION), Context.RECEIVER_NOT_EXPORTED);
            try {
                @SuppressWarnings("deprecation") boolean started = wifi.startScan();
                if (started) done.await(5L, TimeUnit.SECONDS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } finally {
                context.unregisterReceiver(receiver);
            }
            results = wifi.getScanResults();
            now = SystemClock.elapsedRealtime();
        }
        for (ScanResult result : results) {
            long age = now - result.timestamp / 1000L;
            if (age > FRESH_SCAN_MS * 3L) continue;
            @SuppressWarnings("deprecation") String ssid = result.SSID;
            query.addWifi(result.BSSID, ssid, result.level, age);
        }
    }

    private void addCells(Context context, Query query) {
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        TelephonyManager telephony = context.getSystemService(TelephonyManager.class);
        if (telephony == null) return;
        List<CellInfo> cells = telephony.getAllCellInfo();
        if (cells == null) return;
        for (CellInfo info : cells) {
            if (info instanceof CellInfoLte lte) {
                CellIdentityLte id = lte.getCellIdentity();
                query.addCell("lte", parseIntOrDefault(id.getMccString()), parseIntOrDefault(id.getMncString()), id.getTac(), id.getCi(), lte.getCellSignalStrength().getDbm());
            } else if (info instanceof CellInfoWcdma wcdma) {
                CellIdentityWcdma id = wcdma.getCellIdentity();
                query.addCell("wcdma", parseIntOrDefault(id.getMccString()), parseIntOrDefault(id.getMncString()), id.getLac(), id.getCid(), wcdma.getCellSignalStrength().getDbm());
            } else if (info instanceof CellInfoGsm gsm) {
                CellIdentityGsm id = gsm.getCellIdentity();
                query.addCell("gsm", parseIntOrDefault(id.getMccString()), parseIntOrDefault(id.getMncString()), id.getLac(), id.getCid(), gsm.getCellSignalStrength().getDbm());
            }
        }
    }

    private static int parseIntOrDefault(String value) {
        try {
            return value == null ? -1 : Integer.parseInt(value);
        } catch (NumberFormatException invalid) {
            return -1;
        }
    }

    @Override protected void handleOnDestroy() {
        worker.shutdownNow();
        super.handleOnDestroy();
    }
}
