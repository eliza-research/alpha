import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { awaitChildService, keptAgentState } from "../src/services.ts";

describe("eliza harness services", () => {
  // spec/agent/index.md, "The wallet can be made only on a launch with the signed-in account's storage key"
  it("reopens the same developer's sealed state across simultaneous launches while keeping accounts separate", async () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-custody-"));
    try {
      const account = { accountId: "owner", organizationId: "alpha" };
      const module = new URL("../src/services.ts", import.meta.url).href;
      const script = `import { keptAgentState } from ${JSON.stringify(module)};
        import { createHash } from "node:crypto";
        const { storageKey } = keptAgentState(process.argv[1], ${JSON.stringify(account)});
        process.stdout.write(createHash("sha256").update(storageKey).digest("hex"));`;
      const start = () => promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, state]);
      const launches = await Promise.all([start(), start()]);
      const original = keptAgentState(state, account);
      const fingerprint = createHash("sha256").update(original.storageKey).digest("hex");
      expect(launches.map(({ stdout }) => stdout)).toEqual([fingerprint, fingerprint]);
      fs.mkdirSync(path.join(original.home, "wallet"));
      fs.writeFileSync(path.join(original.home, "wallet", "keys.sealed"), "held");
      for (const identity of [{ ...account, organizationId: "other" }, { ...account, accountId: "other" }]) {
        const separate = keptAgentState(state, identity);
        expect(separate.storageKey === original.storageKey).toBe(false);
        expect(fs.existsSync(path.join(separate.home, "wallet", "keys.sealed"))).toBe(false);
      }
      const legacy = { account: { userId: "previous", organizationId: "alpha" } };
      fs.writeFileSync(path.join(state, "launch.json"), JSON.stringify(legacy));
      expect(keptAgentState(state, { accountId: "previous", organizationId: "alpha" }).home).toBe(path.join(state, "agent"));
      expect(keptAgentState(state, account).home).toBe(original.home);
    } finally {
      fs.rmSync(state, { recursive: true, force: true });
    }
  });

  // spec/cloud/local.md, "Story: Check Alpha's contract on my computer"
  it("fails awaitChildService promptly when the child process is killed by a signal, and resolves when healthy", async () => {
    const killed = spawn(process.execPath, ["-e", 'require("node:net").createServer().listen(0, "127.0.0.1");'], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    try {
      const waiting = awaitChildService(killed, "http://127.0.0.1:1/api/health", "the agent", () => "").then(
        () => "started",
        (cause: unknown) => `rejected:${cause instanceof Error ? cause.message : String(cause)}`,
      );
      killed.kill("SIGKILL");
      const outcome = await Promise.race([
        waiting,
        Effect.runPromise(Effect.sleep(2_500)).then(() => "hung"),
      ]);
      expect(outcome).toMatch(/^rejected:the agent stopped with SIGKILL:/);
    } finally {
      if (killed.exitCode === null && killed.signalCode === null) killed.kill("SIGKILL");
    }

    const server = http.createServer((_req, res) => { res.writeHead(200).end("ok"); });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as AddressInfo).port;
    const healthy = spawn(process.execPath, ["-e", 'require("node:net").createServer().listen(0, "127.0.0.1");'], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    try {
      await expect(awaitChildService(healthy, `http://127.0.0.1:${port}/api/health`, "the agent", () => "")).resolves.toBeUndefined();
    } finally {
      healthy.kill("SIGKILL");
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
