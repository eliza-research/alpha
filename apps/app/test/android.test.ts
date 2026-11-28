import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { elizaCloudRoutes, tableProblems } from "@repo/cloud";
import { afterAll, describe, expect, it } from "vitest";
import capacitorConfig from "../capacitor.config.ts";

const host = join(import.meta.dirname, "../android/app/src/main/java/ai/alphacompute/alphaphone");
const javaHome = process.env.JAVA_HOME ?? "/usr/lib/jvm/java-21-openjdk";
const javac = join(javaHome, "bin/javac");
const java = join(javaHome, "bin/java");
const jdk = existsSync(javac) && existsSync(java);

const builds = new Map<string, string>();
afterAll(() => { for (const directory of builds.values()) rmSync(directory, { recursive: true, force: true }); });
function runJava(sources: readonly string[], driver: string, args: readonly string[]): string[] {
  let classes = builds.get(driver);
  if (classes === undefined) {
    classes = mkdtempSync(join(tmpdir(), "alpha-host-jvm-"));
    const main = join(classes, "Driver.java");
    writeFileSync(main, driver);
    execFileSync(javac, ["-d", classes, ...sources.map((name) => join(host, name)), main], { stdio: ["ignore", "pipe", "pipe"] });
    builds.set(driver, classes);
  }
  return execFileSync(java, ["-cp", classes, "ai.alphacompute.alphaphone.Driver", ...args], { encoding: "utf8" }).split("\n").filter((line) => line !== "");
}

const QUERY_DRIVER = `package ai.alphacompute.alphaphone;
public final class Driver {
 public static void main(String[] args) {
  NetworkLocationQuery query = new NetworkLocationQuery();
  System.out.println(query.usable() + " " + query.json());
  for (String[] row : new String[][] {{"A0:B1:C2:D3:E4:F5", "\\"Cafe\\"", "-61", "1200"}, {"a0:b1:c2:d3:e4:f5", "Cafe", "-60", "0"}, {"10:22:33:44:55:66", "Home_nomap", "-50", "0"},
    {"10:22:33:44:55:67", "home_NoMap", "-50", "0"}, {"10:22:33:44:55:68", "", "-50", "0"}, {"12:22:33:44:55:69", "Phone hotspot", "-50", "0"}, {"not-a-mac", "Cafe", "-50", "0"}})
   System.out.println("wifi " + query.addWifi(row[0], row[1], Integer.parseInt(row[2]), Long.parseLong(row[3])) + " " + query.usable());
  System.out.println("wifi " + query.addWifi("a0:b1:c2:d3:e4:f6", "Office", -70, -5) + " " + query.usable());
  System.out.println("cell " + query.addCell("lte", 310, 260, 12345, 123456789L, -95) + " " + query.addCell("nr", 310, 260, 1, 1, -90) + " " + query.addCell("lte", 310, 260, 0, 5, -90));
  System.out.println(query.json());
  NetworkLocationQuery reordered = new NetworkLocationQuery();
  reordered.addWifi("a0:b1:c2:d3:e4:f6", "Office", -40, 0); reordered.addWifi("a0:b1:c2:d3:e4:f5", "Cafe", -80, 0); reordered.addCell("lte", 310, 260, 12345, 123456789L, -80);
  System.out.println(reordered.fingerprint().equals(query.fingerprint()));
  for (String body : args) System.out.println(java.util.Arrays.toString(NetworkLocationQuery.parse(body)));
 }
}
`;

const WORKERS_DRIVER = `package ai.alphacompute.alphaphone;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
public final class Driver {
 public static void main(String[] args) throws Exception {
  AtomicInteger refused = new AtomicInteger();
  ExecutorService live = Executors.newSingleThreadExecutor();
  CountDownLatch ran = new CountDownLatch(1);
  System.out.println("live " + PluginWorkers.submit(live, ran::countDown, refused::incrementAndGet) + " " + ran.await(5, TimeUnit.SECONDS) + " " + refused.get());
  live.shutdown();
  boolean[] after = {false};
  System.out.println("stopped " + PluginWorkers.submit(live, () -> after[0] = true, refused::incrementAndGet) + " " + after[0] + " " + refused.get());
  ExecutorService now = Executors.newSingleThreadExecutor();
  now.shutdownNow();
  System.out.println("stopped now " + PluginWorkers.submit(now, () -> {}, refused::incrementAndGet) + " " + refused.get());
  CountDownLatch release = new CountDownLatch(1);
  ThreadPoolExecutor full = new ThreadPoolExecutor(1, 1, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(1));
  boolean first = PluginWorkers.submit(full, () -> { try { release.await(); } catch (InterruptedException stop) {} }, refused::incrementAndGet);
  boolean second = PluginWorkers.submit(full, () -> {}, refused::incrementAndGet);
  boolean third = PluginWorkers.submit(full, () -> {}, refused::incrementAndGet);
  release.countDown();
  full.shutdown();
  System.out.println("full " + first + " " + second + " " + third + " " + refused.get() + " " + full.awaitTermination(5, TimeUnit.SECONDS));
 }
}
`;

// spec/app/platform/index.md, "Story: Reach the phone's native capabilities"
describe("Reach the phone's native capabilities", () => {
  // spec/cloud/index.md, "Story: Reach my account's services from the app"
  it("hands ElizaCloud the verified route table with WebView debugging disabled", () => {
    expect(capacitorConfig.plugins?.ElizaCloud?.routes).toEqual(elizaCloudRoutes);
    expect(tableProblems()).toEqual([]);
    expect(capacitorConfig.android?.webContentsDebuggingEnabled).toBe(false);
  });

  it.skipIf(!jdk)("asks the network location service only for fixed, opted-in networks, falls back to the address-only answer, and reads only a usable position", () => {
    const answers = ["{\"location\": {\"lat\": 37.7764, \"lng\": -122.4258}, \"accuracy\": 42.5}", "{\"accuracy\":25000,\"fallback\":\"ipf\",\"location\":{\"lat\":37.77,\"lng\":-122.42}}",
      "{\"error\":{\"code\":404,\"message\":\"Not found\"}}", "{\"location\":{\"lat\":91,\"lng\":0},\"accuracy\":5}", "{\"location\":{\"lat\":1,\"lng\":2},\"accuracy\":0}"];
    const [empty, ...rest] = runJava(["NetworkLocationQuery.java"], QUERY_DRIVER, answers);
    expect(empty).toBe("false {\"considerIp\":true,\"fallbacks\":{\"ipf\":true,\"lacf\":true}}");
    expect(rest.slice(0, 9)).toEqual(["wifi true false", "wifi false false", "wifi false false", "wifi false false", "wifi false false", "wifi false false", "wifi false false", "wifi true true", "cell true false false"]);
    const json = rest[9] ?? "";
    expect(json).toContain("{\"macAddress\":\"a0:b1:c2:d3:e4:f5\",\"signalStrength\":-61,\"age\":1200}");
    expect(json).toContain("{\"macAddress\":\"a0:b1:c2:d3:e4:f6\",\"signalStrength\":-70,\"age\":0}");
    expect(json).toContain("{\"radioType\":\"lte\",\"mobileCountryCode\":310,\"mobileNetworkCode\":260,\"locationAreaCode\":12345,\"cellId\":123456789,\"signalStrength\":-95}");
    expect(json).not.toMatch(/Cafe|Office|ssid/);
    expect(rest.slice(10)).toEqual(["true", "[37.7764, -122.4258, 42.5]", "[37.77, -122.42, 25000.0]", "null", "null", "null"]);
  });

  it.skipIf(!jdk)("answers a plugin call its stopped or full worker refuses instead of throwing on the bridge thread", () => {
    expect(runJava(["PluginWorkers.java"], WORKERS_DRIVER, [])).toEqual(["live true true 0", "stopped false false 1", "stopped now false 2", "full true true false 3 true"]);
  });
});
